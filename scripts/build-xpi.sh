#!/usr/bin/env bash
# Build the signed-ready Firefox WebExtension artifact (.xpi).
# Uses the shared Python zipfile builder to validate manifest.json and write
# deterministic sorted archive entries; no `zip` CLI is required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extension"
OUT="$ROOT/dist/firefox-youtube-downloader.xpi"

"${PYTHON:-python3}" "$ROOT/scripts/build_xpi.py" "$SRC" "$OUT"
