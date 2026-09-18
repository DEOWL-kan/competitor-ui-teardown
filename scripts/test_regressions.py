#!/usr/bin/env python3
"""Regression samples for the bugs the 2026-09-18 cross-case run found.

Every assert here corresponds to an entry in references/pitfalls.md (9-14).
stdlib only, no framework:  python3 scripts/test_regressions.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apk_assets
import frame_diff
import image_probe


def test_short_token_boundaries():
    """pitfall 9 — `ble` must not match drawable/variable/double/cable."""
    for name in ("res/drawable/ic_cog.png",
                 "assets/fonts/InterVariable.ttf",
                 "assets/double_color_ball_animation.json",
                 "assets/images/cable_sync_blue.png",
                 "assets/icons/repair_flow.png"):
        assert apk_assets.classify_screen(name) != "device", name
    for name in ("assets/ble_scan.png", "assets/bt/ble/pairing_hint.png",
                 "assets/device_reset_step1.png"):
        assert apk_assets.classify_screen(name) == "device", name
    # `auth` still wins for real auth assets but not for an author avatar.
    assert apk_assets.classify_screen("assets/auth/apple.png") == "login"
    assert apk_assets.classify_screen("assets/oauth_google.png") == "login"
    assert apk_assets.classify_screen("assets/author_avatar.png") is None
    # fonts are app-wide and must never be bucketed by screen
    assert apk_assets.classify_screen("assets/fonts/InterVariable.ttf", "font") is None
    assert apk_assets.classify_screen("assets/empty_text/Inter-Bold.ttf", "font") is None


def test_percentile_extremes_ignore_text():
    """pitfall 10 — one very dark cell (text) must not become 'the background'.

    170 background cells plus 10 near-black text cells: the shape of a 9x20
    grid taken off a real screenshot with a headline on it.
    """
    cells = ["#E3E7EE"] * 170 + ["#16181A"] * 10
    darkest, lightest, abs_d, abs_l = image_probe.background_extremes(cells)
    assert darkest == "#E3E7EE", darkest      # background, not the headline
    assert abs_d == "#16181A", abs_d          # still reported, just not used
    # the whole point: the verdict flips depending on which pair you use
    assert image_probe.contrast("#111111", abs_d) < 1.5
    assert image_probe.contrast("#111111", darkest) > 4.5


def test_chroma_peak_role():
    """pitfall 8 sibling — chroma peak on a LIGHT image is not the light."""
    light = ["#FFFFFF"] * 8 + ["#EAF0F7"] * 8 + ["#BDD8F7"]
    assert "FAR END" in image_probe.peak_role("#BDD8F7", light)
    dark = ["#0B1014"] * 8 + ["#16202A"] * 8 + ["#3E6EA8"]
    assert "light source" in image_probe.peak_role("#3E6EA8", dark)


def test_not_a_loop():
    """pitfall 11 — a one-shot launch sequence is not a cycle."""
    assert frame_diff.loop_verdict([2.05, 1.15]) == "not-a-loop"   # measured cold start
    assert frame_diff.loop_verdict([3.00, 2.95, 3.05]) == "loop"   # measured crossfade
    assert frame_diff.loop_verdict([1.60]) == "one-gap"            # can't tell yet


def test_min_run_follows_sample_rate():
    """pitfall 7 — a hard-coded 0.2s floor eats real 0.10s static holds."""
    fps, quiet = 20.0, 0.1
    diffs, t = [], 0.0
    for _ in range(3):                      # hold 0.10s, move 0.60s, three times
        for v in [0.0, 0.0] + [5.0] * 12:
            t += 1 / fps
            diffs.append((t, v))
    runs = frame_diff.segments(diffs, fps, quiet)
    holds = [r for r in runs if r[0] == "quiet"]
    assert len(holds) >= 2, runs             # 0.2s floor would merge them all away
    # and the same series with a 0.2s floor collapses, which is the bug
    assert len([r for r in frame_diff.segments(diffs, fps, quiet, min_run=0.2)
                if r[0] == "quiet"]) < len(holds)


def test_chroma_not_hls_saturation():
    """pitfall 8 — a near-white tinted pixel must not hijack the peak.

    Cell 0 is near-white with a faint tint (HLS saturation ~100%, chroma 2),
    cell 1 is the real tint (chroma 58). The peak must be cell 1.
    """
    import colorsys
    grid = [(0xFD, 0xFD, 0xFF), (0xBD, 0xD8, 0xF7), (0xFF, 0xFF, 0xFF)]
    hls_sat = [colorsys.rgb_to_hls(*[c / 255 for c in px])[2] for px in grid]
    assert hls_sat[0] > hls_sat[1], hls_sat          # the trap is real
    data = bytes(b for px in grid for b in px)
    chroma, x, y, hx = image_probe.saturation_peak(data, 3, 1)
    assert (x, hx) == (1, "#BDD8F7"), (x, hx)        # chroma picks the right one


def test_suggest_crop_finds_the_moving_region():
    """roadmap 4 — the box must cover what moved and nothing else."""
    sw = sh = 10
    flat = bytearray([100]) * (sw * sh)
    moved = bytearray(flat)
    for y in range(2, 5):                       # cells x=4..6, y=2..4
        for x in range(4, 7):
            moved[y * sw + x] = 255
    box = frame_diff.suggest_crop([bytes(flat), bytes(moved)], sw, sh, 100, 100)
    assert box == (30, 30, 40, 20), box
    # a clip where nothing changes has no region to suggest
    assert frame_diff.suggest_crop([bytes(flat), bytes(flat)], sw, sh, 100, 100) is None


def test_nb_frames_is_not_frame_count():
    """pitfall 13 — the header must not echo the container's nb_frames."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "frame_diff.py")).read()
    header = src.split("frames = sample(")[0]
    assert "nb_frames')} frames" not in header
    assert re.search(r"len\(frames\)\} frames sampled", src)


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"ok    {name}")
            except AssertionError as e:
                failed += 1
                print(f"FAIL  {name}  {e}")
    print(f"\n{'all regression samples pass' if not failed else str(failed) + ' FAILED'}")
    sys.exit(1 if failed else 0)
