#!/usr/bin/env python3
"""Build unsigned, self-authored static APK fixtures with an existing Android SDK.
No downloads, signing or installation. Output directory must be new and external.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', required=True)
    parser.add_argument('--build-tools', required=True)
    parser.add_argument('--platform', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    out = Path(args.out).resolve()
    if out == repo or repo in out.parents:
        parser.error('Output must be outside repository')
    sdk = Path(args.sdk)
    build = sdk / 'build-tools' / args.build_tools
    android = sdk / 'platforms' / args.platform / 'android.jar'
    for target in (build / 'aapt2', build / 'd8', android):
        if not target.is_file():
            parser.error('Missing installed SDK file: ' + str(target))
    if not shutil.which('javac'):
        parser.error('javac is required')
    out.mkdir(mode=0o700)
    fixture = repo / 'examples' / 'android-fixture'
    def run(*command):
        subprocess.run([str(v) for v in command], check=True, timeout=60)
    run(build / 'aapt2', 'compile', '--dir', fixture / 'res', '-o', out / 'resources.zip')
    run(build / 'aapt2', 'link', '-I', android, '--manifest', fixture / 'AndroidManifest.xml', '-o', out / 'base.apk', out / 'resources.zip')
    (out / 'classes').mkdir()
    run('javac', '--release', '8', '-classpath', android, '-d', out / 'classes', *sorted((fixture / 'src').rglob('*.java')))
    run(build / 'd8', '--lib', android, '--output', out, *sorted((out / 'classes').rglob('*.class')))
    with zipfile.ZipFile(out / 'base.apk', 'a', zipfile.ZIP_DEFLATED) as archive:
        archive.write(out / 'classes.dex', 'classes.dex')
    for name, version in (('feature', '7'), ('conflict', '8')):
        manifest = out / (name + '-manifest.xml')
        manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="demo.fixture" split="feature_demo" android:versionCode="' + version + '" android:versionName="1.0"><uses-sdk android:minSdkVersion="23"/><application android:hasCode="false"/></manifest>')
        run(build / 'aapt2', 'link', '-I', android, '--manifest', manifest, '-o', out / (name + '.apk'))
    with zipfile.ZipFile(out / 'base.apk') as base, zipfile.ZipFile(out / 'bad-dex.apk', 'w') as damaged:
        for entry in base.infolist():
            damaged.writestr(entry, b'broken-dex' if entry.filename == 'classes.dex' else base.read(entry))
    (out / 'expected.txt').write_text('base.apk\nfeature.apk\n')
    print(str(out))


if __name__ == '__main__':
    main()
