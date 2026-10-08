# Self-authored Android static-analysis fixture

No competitor package or asset is included. This source builds unsigned APKs outside the repository using an **already installed** SDK. It does not install onto a device.

```sh
python3 tools/build_android_fixture.py --sdk /path/to/sdk --build-tools 35.0.0 --platform android-36 --out /scratch/new-android-fixture
python3 scripts/apk_profile.py /scratch/new-android-fixture/base.apk /scratch/new-android-fixture/feature.apk --expected /scratch/new-android-fixture/expected.txt --json /scratch/profile.json
jadx --version
jadx -d /scratch/new-jadx /scratch/new-android-fixture/base.apk
rg -n 'Save note|saveNote|putString|nativeSummarize|Class.forName' /scratch/new-jadx/sources
```

Run `python3 tools/test_android_integration.py --fixture /scratch/new-android-fixture --out /scratch/new-integration` for real optional-tool assertions and logs. It checks the known trace, conflicts and damaged DEX without a device.

The builder emits base.apk (versionCode 7), a code-free feature split (7), and a deliberately conflicting split (8). It also emits bad-dex.apk by deliberately corrupting the self-authored classes.dex. JADX may log an error yet exit 0; missing MainActivity remains uncovered. The conflicting split should produce `identity_status: conflict` and a nonzero profile exit. Missing the feature while supplying expected.txt must list it as uncovered.

## Known trace and counterexamples

| Question | Static evidence | Verdict |
|---|---|---|
| What does the button handler call? | MainActivity.onCreate → click listener → saveNote → SharedPreferences.edit.putString.apply | PASS for code content after actual decoding; runtime remains SKIP |
| Does every “Save note” match belong to that button? | vendor.sdk.Unused.label returns the same string but is not the registered handler | No; a text hit alone is insufficient |
| Does nativeSummarize implement summarization? | A native declaration without supplied implementation | SKIP; declaration is not algorithm or runtime evidence |
| What class does Unused.dynamic load? | Class.forName uses a runtime argument | SKIP; target not statically established |
| Does declared Worker run? | Manifest declares a service with no provided class and no explicit exported value | SKIP; intentionally demonstrates that declarations do not prove reachability |

An INTERNET permission exists even though the known save method writes preferences. It does not establish cloud storage. Conversely, one local save method does not establish that an entire product is offline.

## Validation scope

Validated with aapt2/build-tools 35.0.0, Android platform 36, SDK command-line tools 22.0 and JADX 1.5.6 in the development task on 2026-10-08. The actual decoded output showed the listener (renamed synthetic lambda) calling saveNote, then putString/apply. These generated files and their hashes are kept outside the repo. Source line numbers are not a substitute for the decoded artifact's line numbers.

No Android device was available. No installation, UI click, data persistence or runtime behavior was verified. No protected/paid package or native binary was decompiled. Design advice: keep persistent state behind a small interface and test actual lifecycle/persistence on a device before treating the static trace as a shipped behavior.
