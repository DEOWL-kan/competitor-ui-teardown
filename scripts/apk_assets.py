#!/usr/bin/env python3
"""List an APK's asset inventory so you can tell what a screen is actually made of.

The single most useful question this answers: is that beautiful animated
background a video, a frame sequence, a Lottie file, or just a handful of JPEGs
being cross-faded? You cannot tell from the running app. You can tell instantly
from the asset list.

The second most useful thing it does is warn you about the trap that costs the
most rework: assets named `onboarding_*` belong to the ONBOARDING flow, not the
login screen. Attributing one to the other produces a confident, wrong
recommendation. This script separates them and says so out loud.

stdlib-only (uses `zipfile`). No APK is modified; nothing is extracted unless
you pass --extract.

Usage:
    apk_assets.py app.apk                      # inventory + screen grouping
    apk_assets.py app.apk --screen login       # focus one screen
    apk_assets.py app.apk --min-kb 100         # only the heavyweights
    apk_assets.py app.apk --extract login bg   # extract matching files to ./out
"""
import argparse
import os
import re
import zipfile
from collections import defaultdict

VIDEO = {".mp4", ".webm", ".mov", ".mkv"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
VECTOR = {".svg", ".xml"}
ANIM = {".json", ".riv", ".lottie"}
FONT = {".ttf", ".otf", ".woff", ".woff2"}

# Screen buckets. Order matters — first match wins, so the more specific
# patterns sit above the generic ones.
SCREENS = [
    ("onboarding", r"onboard|intro|tutorial|walkthrough|guide|coach"),
    ("login",      r"login|signin|sign_in|sign-in|auth|register|signup|sign_up"),
    ("paywall",    r"paywall|subscri|premium|upgrade|purchase|pricing|billing"),
    ("splash",     r"splash|launch|startup"),
    ("empty",      r"empty|placeholder|nodata|no_data"),
    ("device",     r"device|hardware|bluetooth|ble|pair"),
]


def classify_ext(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in VIDEO:
        return "video"
    if ext in IMAGE:
        return "image"
    if ext in ANIM:
        return "anim/json"
    if ext in VECTOR:
        return "vector"
    if ext in FONT:
        return "font"
    return None


def classify_screen(name):
    low = name.lower()
    for screen, pat in SCREENS:
        if re.search(pat, low):
            return screen
    return None


def human(n):
    return f"{n/1024:.0f} KB" if n < 1024 * 1024 else f"{n/1024/1024:.1f} MB"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("apk")
    ap.add_argument("--min-kb", type=float, default=20, help="ignore entries below this (default 20)")
    ap.add_argument("--screen", help="only show this screen bucket")
    ap.add_argument("--extract", nargs="+", metavar="TERM",
                    help="extract entries whose path contains ALL these terms")
    ap.add_argument("--out", default="./out", help="extract destination (default ./out)")
    ap.add_argument("--top", type=int, default=14, help="entries per bucket (default 14)")
    a = ap.parse_args()

    if not zipfile.is_zipfile(a.apk):
        raise SystemExit(f"{a.apk} is not a zip/apk")

    with zipfile.ZipFile(a.apk) as z:
        infos = z.infolist()

        if a.extract:
            terms = [t.lower() for t in a.extract]
            hits = [i for i in infos
                    if all(t in i.filename.lower() for t in terms) and not i.is_dir()]
            if not hits:
                raise SystemExit(f"nothing matched {terms}")
            os.makedirs(a.out, exist_ok=True)
            for i in hits:
                dest = os.path.join(a.out, os.path.basename(i.filename))
                with z.open(i) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
                print(f"  extracted {dest}  ({human(i.file_size)})")
            print(f"\n{len(hits)} file(s) -> {a.out}")
            print("REMINDER: extracted competitor assets are for analysis only.")
            print("Do not ship them, and do not commit them to your repo.")
            return

        total = sum(i.file_size for i in infos)
        print(f"# {os.path.basename(a.apk)}")
        print(f"  {len(infos)} entries, {human(total)} uncompressed\n")

        by_screen = defaultdict(list)
        by_kind = defaultdict(int)
        floor = a.min_kb * 1024
        for i in infos:
            if i.is_dir() or i.file_size < floor:
                continue
            kind = classify_ext(i.filename)
            if not kind:
                continue
            by_kind[kind] += i.file_size
            screen = classify_screen(i.filename)
            if screen:
                by_screen[screen].append((i.file_size, i.filename, kind))

        print("## Asset weight by type")
        for kind, size in sorted(by_kind.items(), key=lambda kv: -kv[1]):
            print(f"  {kind:<11} {human(size)}")

        buckets = [a.screen] if a.screen else [s for s, _ in SCREENS]
        for screen in buckets:
            rows = sorted(by_screen.get(screen, []), reverse=True)
            if not rows:
                continue
            print(f"\n## {screen}  ({len(rows)} assets over {a.min_kb:g} KB)")
            kinds = {k for _, _, k in rows}
            for size, name, kind in rows[:a.top]:
                print(f"  {human(size):>9}  {kind:<9}  {name}")
            if len(rows) > a.top:
                print(f"  ... {len(rows) - a.top} more")
            # The conclusion that actually matters, stated explicitly.
            if screen == "login":
                if "video" in kinds:
                    print("  => login carries VIDEO — check whether it plays on the login screen itself")
                elif "anim/json" in kinds:
                    print("  => login carries Lottie/JSON animation")
                else:
                    loops = [n for _, n, _ in rows if re.search(r"loop|bg_\d|slide|carousel", n.lower())]
                    if len(loops) >= 2:
                        print(f"  => login is STATIC IMAGES ({len(loops)} loop-ish files) — almost certainly a crossfade,")
                        print("     not a video. Measure the rhythm with frame_diff.py.")
                    else:
                        print("  => login looks like static imagery only")

        if "onboarding" in by_screen and "login" in by_screen:
            print("\n" + "!" * 68)
            print("! Both `onboarding` and `login` assets exist.")
            print("! These are DIFFERENT SCREENS. Onboarding routinely ships video and")
            print("! heavy animation that the login screen never uses. Attributing an")
            print("! onboarding_*.mp4 to the login screen is the most common way to end")
            print("! up recommending a technique the competitor does not actually use")
            print("! on the screen you are studying.")
            print("! Confirm on a real device which screen each asset appears on.")
            print("!" * 68)


if __name__ == "__main__":
    main()
