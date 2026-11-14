#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OUT_DIR=${1:-$ROOT/dist}
COMMITTED_MANIFEST=$(git -C "$ROOT" show HEAD:extension/manifest.json)
VERSION=$(python3 - "$COMMITTED_MANIFEST" <<'PY'
import json
import sys
print(json.loads(sys.argv[1])["version"])
PY
)
TAG="v$VERSION"
if [[ ${GITHUB_REF_TYPE:-} == tag && -n ${GITHUB_REF_NAME:-} && ${GITHUB_REF_NAME} != "$TAG" ]]; then
    printf 'Manifest version %s does not match release tag %s.\n' "$VERSION" "$GITHUB_REF_NAME" >&2
    exit 1
fi
git -C "$ROOT" rev-parse --verify HEAD >/dev/null
mkdir -p -- "$OUT_DIR"
output="$OUT_DIR/huginn-downloader-${VERSION}-source.tar.gz"
git -C "$ROOT" archive --format=tar --prefix="huginn-downloader-${VERSION}/" HEAD \
    | gzip -n > "$output"
gzip -t "$output"
printf '%s\n' "$output"
