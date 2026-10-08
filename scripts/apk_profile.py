#!/usr/bin/env python3
"""Bounded APK inventory and optional installed apkanalyzer evidence. Never extracts.

python3 scripts/apk_profile.py base.apk split.apk --json /outside/repo/profile.json
--expected lists expected APK basenames (one per line, or adb pm path output).
A matching list covers the supplied inventory, not all possible dynamic modules.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile

ANDROID = "{http://schemas.android.com/apk/res/android}"
MAX_OUTPUT = 8 * 1024 * 1024


def digest(filename):
    h = hashlib.sha256()
    with open(filename, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_tool(command, timeout=20, limit=MAX_OUTPUT):
    """No shell; bound time and collected output, including stderr."""
    result = {"command": command, "status": "unavailable", "stdout": "", "stderr": ""}
    try:
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            process = subprocess.Popen(command, stdout=out, stderr=err, start_new_session=(os.name == "posix"))
            started = time.monotonic()
            reason = None
            while process.poll() is None:
                if time.monotonic() - started > timeout:
                    reason = "timeout"
                if os.fstat(out.fileno()).st_size + os.fstat(err.fileno()).st_size > limit:
                    reason = "truncated"
                if reason:
                    try:
                        if os.name == "posix":
                            os.killpg(process.pid, signal.SIGKILL)
                        else:
                            process.kill()
                    except ProcessLookupError:
                        pass
                    break
                time.sleep(0.02)
            process.wait()
            if os.fstat(out.fileno()).st_size + os.fstat(err.fileno()).st_size > limit:
                reason = "truncated"
            out.seek(0)
            err.seek(0)
            stdout = out.read(limit)
            stderr = err.read(max(0, limit - len(stdout)))
            result.update(status=reason or ("ok" if process.returncode == 0 else "failed"),
                          returncode=process.returncode, stdout=stdout.decode("utf-8", "replace"),
                          stderr=stderr.decode("utf-8", "replace"))
    except OSError as exc:
        result["error"] = str(exc)
    return result


def parse_manifest(xml):
    if len(xml.encode("utf-8")) > MAX_OUTPUT or re.search(r"<!\s*(DOCTYPE|ENTITY)", xml, re.I):
        raise ValueError("Manifest too large or contains DTD/entity declarations")
    root = ET.fromstring(xml)
    if root.tag != "manifest":
        raise ValueError("Expected manifest root")
    def attr(node, name):
        return node.get(ANDROID + name) if node is not None else None
    sdk = root.find("uses-sdk")
    components = []
    app = root.find("application")
    for node in ([] if app is None else app):
        if node.tag not in ("activity", "activity-alias", "service", "receiver", "provider"):
            continue
        filters = []
        for item in node.findall("intent-filter"):
            filters.append({"action": [attr(v, "name") for v in item.findall("action")],
                            "category": [attr(v, "name") for v in item.findall("category")],
                            "data": [{k.replace(ANDROID, ""): v for k, v in n.attrib.items()} for n in item.findall("data")]})
        components.append({"type": node.tag, "name": attr(node, "name"),
                           "exported": attr(node, "exported") or "unresolved",
                           "intent_filters": filters})
    return {"package": root.get("package"), "split": root.get("split"),
            "version_code": attr(root, "versionCode"), "version_name": attr(root, "versionName"),
            "min_sdk": attr(sdk, "minSdkVersion"), "target_sdk": attr(sdk, "targetSdkVersion"),
            "permissions": [attr(n, "name") for n in root if n.tag in ("uses-permission", "uses-permission-sdk-23")],
            "components": components}


def identity_status(packages):
    identities = [(p.get("manifest") or {}) for p in packages]
    known = {(p.get("package"), p.get("version_code")) for p in identities
             if p.get("package") and p.get("version_code")}
    names = {p.get("version_name") for p in identities if p.get("version_name")}
    if len(known) > 1 or len(names) > 1:
        return "conflict"
    if not identities or any(not p.get("package") or not p.get("version_code") for p in identities):
        return "unknown"
    return "consistent"


def inventory(filename, tool):
    row = {"path": str(Path(filename).resolve()), "status": "invalid", "manifest": None,
           "tool": {"status": "unavailable", "commands": []}, "signature_verification": "not_performed"}
    try:
        row.update(size_bytes=os.path.getsize(filename), sha256=digest(filename))
        with zipfile.ZipFile(filename) as archive:
            entries = archive.infolist()
            if len(entries) > 200000:
                raise ValueError("ZIP directory exceeds 200000 entries")
            names = [entry.filename for entry in entries]
            row["inventory"] = {"entries": len(entries), "declared_uncompressed_bytes": sum(e.file_size for e in entries),
                                "dex": [n for n in names if re.fullmatch(r"classes\d*\.dex", n)],
                                "resources": [n for n in names if n.startswith("res/") or n == "resources.arsc"],
                                "native": [n for n in names if n.startswith("lib/") and n.endswith(".so")],
                                "abis": sorted({n.split("/")[1] for n in names if n.startswith("lib/") and len(n.split("/")) > 2})}
            row["stack_clues"] = []
            flutter = [n for n in names if n.endswith(("/libflutter.so", "/libapp.so")) or n.startswith("assets/flutter_assets/")]
            rn = [n for n in names if n.endswith(("/libreactnative.so", "/libhermes.so", "/index.android.bundle"))]
            for name, files in (("Flutter", flutter), ("React Native", rn)):
                if len(files) > 1:
                    row["stack_clues"].append({"name": name, "files": files, "interpretation": "bundled clues; UI ownership and execution unknown"})
            if not row["stack_clues"]:
                row["stack_clues"].append({"name": "unknown", "files": [], "interpretation": "No combined stack clue; absence does not prove a native-only app"})
            row["status"] = "inventoried"
            # A directory listing does not CRC-check or decompress entries.
            row["archive_validation"] = "directory only; contents not extracted or CRC-verified"
            if sum(e.file_size for e in entries) > 4 * 1024**3 or any(e.file_size > 512 * 1024**2 for e in entries):
                row["tool"]["reason"] = "declared ZIP size exceeds optional-tool budget"
                return row
        if tool:
            commands = [("manifest", ["manifest", "print"]), ("dex", ["dex", "packages", "--defined-only"]),
                        ("resources", ["resources", "packages"]), ("string_configs", ["resources", "configs", "--type", "string"]),
                        ("string_names_default", ["resources", "names", "--config", "default", "--type", "string"])]
            for label, args in commands:
                result = run_tool([tool] + args + [row["path"]])
                result["kind"] = label
                row["tool"]["commands"].append(result)
                if label == "resources" and result["status"] == "ok" and not result["stdout"].strip():
                    row["tool"]["resource_scope"] = "no resource packages returned; string configs/names not attempted"
                    break
                if label == "manifest" and result["status"] == "ok":
                    try:
                        row["manifest"] = parse_manifest(result["stdout"])
                    except (ValueError, ET.ParseError) as exc:
                        result["status"] = "parse_failed"
                        result["error"] = str(exc)
            row["tool"]["status"] = "ok" if all(r["status"] == "ok" for r in row["tool"]["commands"]) else "partial"
    except (OSError, ValueError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        row["error"] = str(exc)
    return row


def profile(files, expected=None, tool=None):
    basenames = [Path(f).name for f in files]
    expected = sorted(set(expected)) if expected is not None else None
    packages = [inventory(filename, tool) for filename in files]
    metadata = {"path": tool, "version": "unknown"}
    if tool:
        properties = Path(tool).resolve().parent.parent / "source.properties"
        if properties.is_file() and properties.stat().st_size < 65536:
            metadata["sdk_source_properties"] = properties.read_text(errors="replace")
        try:
            metadata["executable_sha256"] = digest(tool)
        except OSError as exc:
            metadata["identity_error"] = str(exc)
    return {"schema_version": 1, "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "packages": packages, "tool": metadata, "identity_status": identity_status(packages),
            "coverage": {"provided": basenames, "expected": expected,
                         "missing": sorted(set(expected or []) - set(basenames)),
                         "unexpected": sorted(set(basenames) - set(expected or basenames)),
                         "ambiguous_basenames": len(set(basenames)) != len(basenames),
                         "scope": "matches supplied list only; dynamic modules and runtime behavior unknown"},
            "limitations": ["Static declarations and bundled files do not prove runtime availability.",
                            "Resources: package list, string configs and default string names only; other resource types/config values not decoded.",
                            "A SHA256 is identity, not proof of authenticity; signatures are not verified."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apks", nargs="+")
    parser.add_argument("--expected", help="Expected package filenames / pm path output file")
    parser.add_argument("--no-tools", action="store_true")
    parser.add_argument("--json", dest="output", help="New JSON file outside the repository")
    args = parser.parse_args()
    try:
        output = Path(args.output).resolve() if args.output else None
        repo = Path(__file__).resolve().parent.parent
        if output and (output == repo or repo in output.parents or output.exists()):
            raise ValueError("Output must be new and outside the repository")
        expected = None
        if args.expected:
            with open(args.expected) as handle:
                raw = handle.read(MAX_OUTPUT + 1)
            if len(raw) > MAX_OUTPUT:
                raise ValueError("Expected list too large")
            expected = [Path(re.sub(r"^package:", "", line.strip())).name for line in raw.splitlines() if line.strip()]
        result = profile(args.apks, expected, None if args.no_tools else shutil.which("apkanalyzer"))
        if output:
            with open(os.open(str(output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=2)
            print(str(output))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if any(p["status"] == "invalid" for p in result["packages"]) or result["identity_status"] == "conflict" else 0
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
