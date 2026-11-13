#!/usr/bin/env bash
# Sign the Firefox WebExtension with Mozilla AMO (unlisted channel).
# Requires AMO_JWT_ISSUER and AMO_JWT_SECRET from addons.mozilla.org API keys.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n ${AMO_JWT_ISSUER:-} && -n ${AMO_JWT_SECRET:-} ]]; then
  true
else
  echo 'error: AMO_JWT_ISSUER and AMO_JWT_SECRET must be set' >&2
  exit 1
fi

npx --yes web-ext sign --source-dir "$ROOT/extension" --artifacts-dir "$ROOT/web-ext-artifacts" --channel=unlisted --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"

newest="$(ls -t "$ROOT/web-ext-artifacts"/*.xpi 2>/dev/null | head -n 1 || true)"
if [[ -z "${newest:-}" ]]; then
  echo 'error: no signed .xpi found in web-ext-artifacts' >&2
  exit 1
fi

python3 -m zipfile -t "$newest"

OUT="$ROOT/dist/firefox-youtube-downloader-signed.xpi"
mkdir -p "$(dirname "$OUT")"
cp "$newest" "$OUT"
echo "$OUT"
