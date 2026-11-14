#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OUT_DIR=${1:-$ROOT/dist}
PACKAGE_NAME=firefox-youtube-downloader-companion
VERSION=$(python3 - "$ROOT/extension/manifest.json" <<'PY'
import json
import sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["version"])
PY
)

command -v dpkg-deb >/dev/null 2>&1 || {
    printf '%s\n' 'dpkg-deb is required to build the Debian package.' >&2
    exit 1
}

mkdir -p -- "$OUT_DIR"
temporary_root=$(mktemp -d)
cleanup() { rm -rf -- "$temporary_root"; }
trap cleanup EXIT
package_root="$temporary_root/package"
mkdir -p -- "$package_root/DEBIAN"
bash "$ROOT/packaging/linux/stage-root.sh" \
    "$ROOT" "$package_root" /usr/lib/mozilla/native-messaging-hosts
cat > "$package_root/DEBIAN/control" <<EOF
Package: $PACKAGE_NAME
Version: $VERSION
Section: video
Priority: optional
Architecture: all
Depends: yt-dlp, ffmpeg, python3, python3-mutagen, python3-pil
Suggests: rsgain
Maintainer: Firefox YouTube Downloader contributors <noreply@github.com>
Description: Local Native Messaging companion for the Firefox downloader add-on
 Installs the per-machine host and desktop launchers. Install the signed XPI
 separately in Firefox. ReplayGain support is optional.
EOF
chmod 755 "$package_root/DEBIAN"
chmod 644 "$package_root/DEBIAN/control"

output="$OUT_DIR/${PACKAGE_NAME}_${VERSION}_all.deb"
dpkg-deb --build --root-owner-group "$package_root" "$output"
printf '%s\n' "$output"
