#!/usr/bin/env bash
# Build the signed-ready Firefox WebExtension artifact (.xpi).
# Uses Python's zipfile so no `zip` CLI is required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extension"
OUT="$ROOT/dist/firefox-youtube-downloader.xpi"

python3 - "$SRC" "$OUT" <<'PY'
import json
import sys
from pathlib import Path
import zipfile

src = Path(sys.argv[1])
out = Path(sys.argv[2])

required = [
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "icons/plugin.svg",
    "icons/audio.svg",
    "icons/video.svg",
    "icons/cut.svg",
]

missing = [name for name in required if not (src / name).is_file()]
if missing:
    print("missing required files: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)

try:
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
except json.JSONDecodeError as error:
    print(f"manifest.json is not valid JSON: {error}", file=sys.stderr)
    sys.exit(1)

for key in ("manifest_version", "name", "version"):
    if key not in manifest:
        print(f"manifest.json is missing required key: {key}", file=sys.stderr)
        sys.exit(1)

files = sorted(
    (path for path in src.rglob("*") if path.is_file()),
    key=lambda path: path.relative_to(src).as_posix(),
)
names = [path.relative_to(src).as_posix() for path in files]
if names[0] != "manifest.json" and "manifest.json" in names:
    names.remove("manifest.json")
    names.insert(0, "manifest.json")
by_name = {path.relative_to(src).as_posix(): path for path in files}

out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in names:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, by_name[name].read_bytes())

with zipfile.ZipFile(out) as archive:
    archived = archive.namelist()
    assert archived[0] == "manifest.json", "manifest.json must be the first archive entry"
    assert archived[1:] == sorted(archived[1:]), "entries after manifest must be sorted"
    bad = archive.testzip()
    if bad is not None:
        print(f"corrupt entry in xpi: {bad}", file=sys.stderr)
        sys.exit(1)

print(f"wrote {out} ({len(names)} files)")
for name in names:
    print(f"  {name}")
PY
