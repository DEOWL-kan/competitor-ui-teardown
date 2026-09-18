# Contributing

The useful contribution here is usually **a pitfall, not a feature**. This repo exists
because measuring beats guessing; the scripts are just the enforcement mechanism.

## Setup

None. Python 3.8+ and `ffmpeg`/`ffprobe` on PATH.

```bash
python3 scripts/test_regressions.py     # the whole test suite, ~1s, no framework
```

**Standard library only.** No Pillow, no numpy, no pytest. Someone should be able to
`curl` a single script onto a machine and have it work. A patch that adds a dependency
needs to argue why a few lines of stdlib cannot do it.

## Fixing a bug

Three things, not one:

1. **The fix.**
2. **A sample in `scripts/test_regressions.py`** — one function, plain `assert`s, named
   after the failure.
3. **The story in `references/pitfalls.md`** — what you believed, what the numbers
   actually said, and the criterion that would have caught it earlier. Include the real
   values. "The regex was too loose" teaches nothing; "`ble` matched `drawable`, which
   is 1976 of 2886 assets in one app" teaches the class of mistake.

### Prove the sample fails without the fix

Revert your fix, run the suite, watch **that specific test** go red, then restore it.
A test that passes both ways is measuring nothing, and this is the exact failure mode
the repo is about — see pitfalls 3, 8 and 11.

While doing that, confirm your mutation actually landed on the line you meant. One
mutation here silently missed its target and the suite stayed green, which looked
exactly like "the fix wasn't needed".

## Adding to the workflow

`SKILL.md` and `AGENTS.md` are two views of the same workflow. If you change the
procedure, change both, and keep `README.md`'s limitations honest — understating what
the tool can do is fine, overstating it is the one thing this project cannot afford.

## What will get turned down

- New dependencies for something stdlib already covers.
- Anything that downloads a package on its own, drives a store account, or touches DRM.
- Competitor assets in the repository, in any form, for any reason.
- Softening a documented limitation without measurements that justify it.
