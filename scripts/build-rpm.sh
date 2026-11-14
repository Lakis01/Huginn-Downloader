#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_TARBALL=${1:-}
OUT_DIR=${2:-$ROOT/dist}
PACKAGE_NAME=firefox-youtube-downloader-companion
VERSION=$(python3 - "$ROOT/extension/manifest.json" <<'PY'
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["version"])
PY
)

if [[ -z $SOURCE_TARBALL || ! -f $SOURCE_TARBALL ]]; then
    printf 'Usage: %s <tagged-source-tarball> [output-dir]\n' "${0##*/}" >&2
    exit 2
fi
command -v rpmbuild >/dev/null 2>&1 || {
    printf '%s\n' 'rpmbuild is required to build the Fedora RPM.' >&2
    exit 1
}

mkdir -p -- "$OUT_DIR"
topdir=$(mktemp -d)
cleanup() { rm -rf -- "$topdir"; }
trap cleanup EXIT
for subdir in BUILD BUILDROOT RPMS SOURCES SPECS SRPMS; do
    mkdir -p -- "$topdir/$subdir"
done
cp -- "$SOURCE_TARBALL" \
    "$topdir/SOURCES/huginn-downloader-${VERSION}-source.tar.gz"
spec="$topdir/SPECS/firefox-youtube-downloader-companion.spec"
cp -- "$ROOT/packaging/fedora/firefox-youtube-downloader-companion.spec" "$spec"
rpmbuild --define "_topdir $topdir" --define "app_version $VERSION" -bb "$spec"

rpm_file="$topdir/RPMS/noarch/${PACKAGE_NAME}-${VERSION}-1.noarch.rpm"
[[ -f $rpm_file ]] || {
    printf 'rpmbuild did not produce the expected package: %s\n' "$rpm_file" >&2
    exit 1
}
cp -- "$rpm_file" "$OUT_DIR/"
output="$OUT_DIR/huginn-companion-${VERSION}-1.noarch.rpm"
mv -- "$OUT_DIR/${rpm_file##*/}" "$output"
printf '%s\n' "$output"
