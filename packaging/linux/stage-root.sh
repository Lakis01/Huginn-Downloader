#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    printf 'Usage: %s <source-root> <destination-root> <native-manifest-root>\n' "${0##*/}" >&2
    exit 2
fi

SOURCE_ROOT=$(cd -- "$1" && pwd)
DEST_ROOT=$2
NATIVE_MANIFEST_ROOT=$3
APP_ROOT=/usr/lib/firefox-youtube-downloader
HOST_PATH="$APP_ROOT/yt-dlp-native-host.py"
EXTENSION_ID=firefox-youtube-downloader@lakis01.github.io
CHROMIUM_ORIGIN=chrome-extension://hlekndcccbgmhlablldcddddmknkjomg/

[[ $NATIVE_MANIFEST_ROOT == /* ]] || {
    printf 'Native Messaging manifest root must be absolute: %s\n' "$NATIVE_MANIFEST_ROOT" >&2
    exit 2
}

runtime_files=(
    ytdl_config.py
    ytdl_meta.py
    ytdl_version.py
    yt-dlp-wrapper.py
    yt-dlp-shortcut.sh
    yt-dlp-native-host.py
)
for file in "${runtime_files[@]}"; do
    [[ -f $SOURCE_ROOT/bin/$file ]] || {
        printf 'Missing companion source: %s\n' "$SOURCE_ROOT/bin/$file" >&2
        exit 1
    }
    install -Dm755 "$SOURCE_ROOT/bin/$file" "$DEST_ROOT$APP_ROOT/$file"
done

for desktop_file in "$SOURCE_ROOT"/desktop/*.desktop; do
    [[ -f $desktop_file ]] || continue
    destination="$DEST_ROOT/usr/share/applications/${desktop_file##*/}"
    mkdir -p -- "$(dirname -- "$destination")"
    python3 - "$desktop_file" "$destination" <<'PY'
from pathlib import Path
import sys

source, destination = map(Path, sys.argv[1:])
lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
for index, line in enumerate(lines):
    if line.startswith("Exec=") and "yt-dlp-shortcut.sh" in line:
        _, _, args = line.partition("yt-dlp-shortcut.sh")
        lines[index] = "Exec=/usr/lib/firefox-youtube-downloader/yt-dlp-shortcut.sh" + args
destination.write_text("".join(lines), encoding="utf-8")
PY
    chmod 644 "$destination"
done

manifest_destination="$DEST_ROOT$NATIVE_MANIFEST_ROOT/firefox_youtube_downloader.json"
mkdir -p -- "$(dirname -- "$manifest_destination")"
python3 - "$manifest_destination" "$HOST_PATH" "$EXTENSION_ID" <<'PY'
import json
from pathlib import Path
import sys

destination, host_path, extension_id = sys.argv[1:]
manifest = {
    "name": "firefox_youtube_downloader",
    "description": "Native Messaging host for Huginn Downloader",
    "path": host_path,
    "type": "stdio",
    "allowed_extensions": [extension_id],
}
Path(destination).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY
chmod 644 "$manifest_destination"

if [[ $NATIVE_MANIFEST_ROOT == /usr/lib64/* ]]; then
    librewolf_manifest="$DEST_ROOT/usr/lib64/librewolf/native-messaging-hosts/firefox_youtube_downloader.json"
else
    librewolf_manifest="$DEST_ROOT/usr/lib/librewolf/native-messaging-hosts/firefox_youtube_downloader.json"
fi
mkdir -p -- "$(dirname -- "$librewolf_manifest")"
cp "$manifest_destination" "$librewolf_manifest"
chmod 644 "$librewolf_manifest"

for chromium_dir in \
    /etc/chromium/native-messaging-hosts \
    /etc/opt/chrome/native-messaging-hosts \
    /etc/brave/native-messaging-hosts \
    /etc/vivaldi/native-messaging-hosts \
    /etc/opt/edge/native-messaging-hosts; do
    chromium_manifest="$DEST_ROOT$chromium_dir/firefox_youtube_downloader.json"
    mkdir -p -- "$(dirname -- "$chromium_manifest")"
    python3 - "$chromium_manifest" "$HOST_PATH" "$CHROMIUM_ORIGIN" <<'PY'
import json
from pathlib import Path
import sys

destination, host_path, origin = sys.argv[1:]
manifest = {
    "name": "firefox_youtube_downloader",
    "description": "Native Messaging host for Huginn Downloader",
    "path": host_path,
    "type": "stdio",
    "allowed_origins": [origin],
}
Path(destination).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY
    chmod 644 "$chromium_manifest"
done

install -Dm644 "$SOURCE_ROOT/LICENSE" \
    "$DEST_ROOT/usr/share/licenses/firefox-youtube-downloader-companion/LICENSE"
install -Dm644 "$SOURCE_ROOT/README.md" \
    "$DEST_ROOT/usr/share/doc/firefox-youtube-downloader-companion/README.md"
