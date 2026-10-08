#!/usr/bin/env python3
"""Optional real-tool test of the already built self-authored fixture; no device."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import apk_profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    out = Path(args.out).resolve()
    if out == repo or repo in out.parents:
        parser.error('Output must be new and outside repository')
    analyzer, jadx = shutil.which('apkanalyzer'), shutil.which('jadx')
    if not analyzer or not jadx:
        parser.error('Requires explicitly installed apkanalyzer and JADX')
    out.mkdir(mode=0o700)
    fixture = Path(args.fixture)
    results = {}
    for name, files, expected_identity in [('single', ['base.apk'], 'consistent'), ('split', ['base.apk', 'feature.apk'], 'consistent'), ('conflict', ['base.apk', 'conflict.apk'], 'conflict')]:
        result = apk_profile.profile([str(fixture / f) for f in files], tool=analyzer)
        assert result['identity_status'] == expected_identity, name
        assert all(p['manifest'] for p in result['packages']), name
        (out / (name + '.json')).write_text(json.dumps(result, indent=2))
        results[name] = expected_identity
    for name in ('base', 'bad-dex'):
        result = apk_profile.run_tool([jadx, '-d', str(out / name), str(fixture / (name + '.apk'))], timeout=45)
        (out / (name + '-jadx.json')).write_text(json.dumps(result, indent=2))
        target = out / name / 'sources/demo/fixture/MainActivity.java'
        if name == 'base':
            assert result['status'] == 'ok' and 'ERROR -' not in result['stdout'] + result['stderr']
            source = target.read_text()
            for needle in ('setOnClickListener', 'saveNote("fixture text")', 'putString("last", str).apply()', 'native String nativeSummarize'):
                assert needle in source, needle
            sdk = (out / name / 'sources/vendor/sdk/Unused.java').read_text()
            assert 'Save note' in sdk and 'Class.forName' in sdk
            results['trace_sha256'] = hashlib.sha256(source.encode()).hexdigest()
        else:
            assert not target.exists(), 'Damaged dex unexpectedly recovered target class'
            assert result['status'] != 'ok' or 'ERROR' in result['stdout'] + result['stderr']
            results['bad_dex'] = {'returncode': result.get('returncode'), 'code_coverage': 'unavailable; not a feature absence'}
    results['jadx_version'] = apk_profile.run_tool([jadx, '--version'])
    results['device'] = 'not contacted; runtime unverified'
    (out / 'validation.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == '__main__':
    main()
