#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_TARBALL=${1:-}
OUT_DIR=${2:-$ROOT/dist}
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
command -v sha256sum >/dev/null 2>&1 || {
    printf '%s\n' 'sha256sum is required to pin the Arch source archive.' >&2
    exit 1
}

source_sha=$(sha256sum "$SOURCE_TARBALL" | awk '{print $1}')
mkdir -p -- "$OUT_DIR"
recipe_dir=$(mktemp -d)
cleanup() { rm -rf -- "$recipe_dir"; }
trap cleanup EXIT

sed -e "s/@VERSION@/$VERSION/g" -e "s/@SOURCE_SHA256@/$source_sha/g" \
    "$ROOT/packaging/arch/PKGBUILD.in" > "$recipe_dir/PKGBUILD"
sed -e "s/@VERSION@/$VERSION/g" -e "s/@SOURCE_SHA256@/$source_sha/g" \
    "$ROOT/packaging/arch/SRCINFO.in" > "$recipe_dir/.SRCINFO"
cp -- "$ROOT/packaging/arch/README.md" "$recipe_dir/README.md"

if command -v makepkg >/dev/null 2>&1; then
    makepkg --printsrcinfo --dir "$recipe_dir" > "$recipe_dir/.SRCINFO.generated"
    diff -u "$recipe_dir/.SRCINFO" "$recipe_dir/.SRCINFO.generated"
    mv -- "$recipe_dir/.SRCINFO.generated" "$recipe_dir/.SRCINFO"
fi

output="$OUT_DIR/firefox-youtube-downloader-${VERSION}-arch-pkgbuild.tar.gz"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
    -czf "$output" -C "$recipe_dir" PKGBUILD .SRCINFO README.md
printf '%s\n' "$output"
