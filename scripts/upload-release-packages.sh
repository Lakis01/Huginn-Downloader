#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    printf 'Usage: %s <tag> <asset-directory>\n' "${0##*/}" >&2
    exit 2
fi

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TAG=$1
ASSET_DIR=$2
VERSION=$(python3 - "$ROOT/extension/manifest.json" <<'PY'
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["version"])
PY
)

[[ $TAG == "v$VERSION" ]] || {
    printf 'Tag %s does not match manifest version %s.\n' "$TAG" "$VERSION" >&2
    exit 1
}
[[ -d $ASSET_DIR ]] || {
    printf 'Asset directory does not exist: %s\n' "$ASSET_DIR" >&2
    exit 1
}
command -v gh >/dev/null 2>&1 || {
    printf '%s\n' 'GitHub CLI (gh) is required to upload release assets.' >&2
    exit 1
}

expected_assets=(
    "firefox-youtube-downloader-companion_${VERSION}_all.deb"
    "firefox-youtube-downloader-companion-${VERSION}-1.noarch.rpm"
    "firefox-youtube-downloader-${VERSION}-source.tar.gz"
    "firefox-youtube-downloader-${VERSION}-arch-pkgbuild.tar.gz"
)
upload_paths=()
for asset in "${expected_assets[@]}"; do
    [[ -f $ASSET_DIR/$asset ]] || {
        printf 'Missing release asset: %s\n' "$ASSET_DIR/$asset" >&2
        exit 1
    }
    upload_paths+=("$ASSET_DIR/$asset")
done

attempts=${YTDL_RELEASE_WAIT_ATTEMPTS:-30}
delay=${YTDL_RELEASE_WAIT_SECONDS:-5}
draft=
for ((attempt = 1; attempt <= attempts; attempt++)); do
    draft=$(gh release view "$TAG" --json isDraft --jq .isDraft 2>/dev/null || true)
    [[ $draft == true || $draft == false ]] && break
    sleep "$delay"
done
[[ $draft == true ]] || {
    printf 'Expected an existing draft release for %s before package upload.\n' "$TAG" >&2
    exit 1
}

release_assets=$(gh release view "$TAG" --json assets --jq '.assets[].name')
grep -Fxq 'firefox-youtube-downloader-signed.xpi' <<<"$release_assets" || {
    printf 'Draft release %s is missing firefox-youtube-downloader-signed.xpi.\n' "$TAG" >&2
    exit 1
}

gh release upload "$TAG" "${upload_paths[@]}" --clobber
printf 'Uploaded Linux package assets to draft release %s.\n' "$TAG"
