#!/usr/bin/env bash
# Build the Chromium/Brave/Vivaldi/Chrome/Edge MV3 unpacked extension and zip archive.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extension"
UNPACKED="$ROOT/dist/huginn-chromium"
OUT="$ROOT/dist/huginn-chromium.zip"

"${PYTHON:-python3}" "$ROOT/scripts/build_chromium.py" "$SRC" "$UNPACKED" "$OUT"
