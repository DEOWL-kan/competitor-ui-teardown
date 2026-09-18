# AGENTS.md

Instructions for any coding agent working in — or with — this repository.
Follows the [agents.md](https://agents.md) convention, so Codex, Cursor, Windsurf,
Gemini CLI, opencode, Amp and friends pick it up automatically.

Claude Code users: `SKILL.md` is the same thing in skill form, and it is the
fuller document (in Chinese). Everything below still applies.

## What this repo is

Three stdlib-only Python scripts plus a written workflow for **reverse-engineering
how a competitor's screen is actually built**, so you can hand someone a spec
instead of an adjective.

The governing rule: **measure what can be measured, label the rest as inference.**
"It uses a big photo and soft light" is not an output. "2.7s eased crossfade
between five JPEGs, light centred at 58% height" is.

## Using it on a teardown task

The full five-step workflow is in `SKILL.md`. The short version:

1. **Pick targets.** Two or three torn down properly beats ten surveyed. Prefer apps
   already installed on the device you have access to — no download, no authorization.
2. **Observe on a real device first.** The asset list tells you *what exists*; only the
   running app tells you *which screen uses it*. Record entry animations from a cold
   start (`am force-stop`, start the recorder *before* launching) — an app already
   sitting on the screen will look static no matter how long you record.
3. **Get the package — ask the user first** (see Boundaries). `base.apk` is normally
   the whole answer even when `pm path` returns six lines.
4. **Quantify.** `apk_assets.py` for composition, `frame_diff.py` for motion,
   `image_probe.py` for pixels.
5. **Write the spec**, and end it with a PASS / PLAUSIBLE / SKIP table. Anything you
   could not measure is labelled, never quietly upgraded to a measurement.

`references/pitfalls.md` is the highest-value file here. Every entry is a mistake
that actually happened. **Read it before you start**, not after you are stuck.

## Boundaries — these are not negotiable

| Action | |
|---|---|
| Analysing mechanism, timing, colour, structure, asset types | ✅ that is the point |
| Turning findings into your own spec and rebuilding it yourself | ✅ |
| Screenshots and frames, for analysis and comparison | ✅ label them |
| **Downloading an app package** | ⚠️ **ask the user first** |
| Driving an app-store account on the user's behalf | ⛔ never |
| Shipping a competitor's assets in your product | ⛔ never |
| Committing competitor assets to any repo | ⛔ never |
| Bypassing paywalls, patching clients, circumventing DRM | ⛔ never — public packages only |

Extracted assets are analysis scratch. Keep them outside the repo; `.gitignore`
blocks the obvious extensions, which is a backstop, not permission to try.

## Changing this repo

- **Python 3.8+, standard library only.** `ffmpeg`/`ffprobe` on PATH are the only
  external tools. Do not add a dependency — Pillow and numpy are deliberately absent
  so this runs anywhere.
- **Run the checks:** `python3 scripts/test_regressions.py` (no framework, ~1s).
- **Fixing a bug means adding a sample for it** in `scripts/test_regressions.py`, and
  writing the story into `references/pitfalls.md` — what happened, what the numbers
  actually were, and the criterion that would have caught it.
- **Verify the sample actually fails without your fix.** Revert the fix, watch the test
  go red, put it back. A test that passes both ways is measuring nothing. Assert that
  your mutation landed on the target line — one silently missed and the suite stayed
  green.
- Do not soften a stated limitation to make the tool sound better. `README.md`
  says what this cannot do on purpose.

## Explicit non-goals

- **iOS.** There is no adb for iPhone, so the whole device-to-package chain is missing
  and the asset inventory — the most decisive step — cannot run. Recording and
  screenshot analysis still work; package composition does not. Say so rather than
  guessing.
- Merging split APKs, scraping stores, or anything that downloads on its own.
