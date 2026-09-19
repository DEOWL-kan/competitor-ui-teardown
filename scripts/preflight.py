#!/usr/bin/env python3
"""Say up front what is missing, instead of failing at step four.

Checks the three external tools this skill needs and whether a device is attached.
Exit code 0 = everything needed for an App teardown is present; 1 = something is
missing (the printed lines say what and how to install it).

    python3 scripts/preflight.py
"""
import platform
import shutil
import subprocess
import sys

HINTS = {
    "Darwin":  {"ffmpeg": "brew install ffmpeg",
                "adb":    "brew install --cask android-platform-tools"},
    "Linux":   {"ffmpeg": "sudo apt install ffmpeg",
                "adb":    "sudo apt install adb"},
    "Windows": {"ffmpeg": "winget install Gyan.FFmpeg",
                "adb":    "winget install Google.PlatformTools"},
}


def main():
    os_name = platform.system()
    hints = HINTS.get(os_name, {})
    missing = []

    print(f"# preflight ({os_name}, python {platform.python_version()})")
    for tool, key in (("ffmpeg", "ffmpeg"), ("ffprobe", "ffmpeg"), ("adb", "adb")):
        path = shutil.which(tool)
        if path:
            print(f"  ok       {tool:<8} {path}")
        else:
            missing.append(tool)
            print(f"  MISSING  {tool:<8} -> {hints.get(key, 'install ' + tool + ' and put it on PATH')}")

    if "adb" not in missing:
        out = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
        devices = [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith("device")]
        if devices:
            print(f"  ok       device   {len(devices)} attached")
        else:
            print("  none     device   no Android device in `adb devices` — recording, screenshots")
            print("                    and package pulls need one; image_probe.py still works without")

    if missing:
        print("\n  Not ready for an App teardown. Web teardowns only need a browser tool")
        print("  (see references/web.md); image_probe.py needs ffmpeg only.")
        sys.exit(1)
    print("\n  ready.")


if __name__ == "__main__":
    main()
