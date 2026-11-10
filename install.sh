#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BIN_SOURCE="$ROOT/bin"
DESKTOP_SOURCE="$ROOT/desktop"
TARGET_HOME=${HOME:-}

usage() {
    printf 'Usage: %s [--install]\n' "${0##*/}"
    printf 'Without --install, only show the planned changes.\n'
}

INSTALL=false
case $# in
    0) ;;
    1)
        case $1 in
            --install) INSTALL=true ;;
            --help|-h) usage; exit 0 ;;
            *) usage >&2; exit 2 ;;
        esac
        ;;
    *) usage >&2; exit 2 ;;
esac

if [[ -z $TARGET_HOME || $TARGET_HOME != /* ]]; then
    printf 'HOME must be set to an absolute path.\n' >&2
    exit 1
fi

BIN_TARGET="$TARGET_HOME/.local/bin"
DESKTOP_TARGET="$TARGET_HOME/.local/share/applications"
BIN_FILES=(ytdl_meta.py yt-dlp-wrapper.py yt-dlp-shortcut.sh)
DESKTOP_FILES=(
    net.local.yt-dlp-shortcut.sh.desktop
    net.local.yt-dlp-shortcut.sh-2.desktop
    net.local.yt-dlp-shortcut.sh-3.desktop
    net.local.yt-dlp-uri.desktop
)

for file in "${BIN_FILES[@]}"; do
    [[ -f $BIN_SOURCE/$file ]] || { printf 'Missing source: %s\n' "$BIN_SOURCE/$file" >&2; exit 1; }
done
for file in "${DESKTOP_FILES[@]}"; do
    [[ -f $DESKTOP_SOURCE/$file ]] || { printf 'Missing source: %s\n' "$DESKTOP_SOURCE/$file" >&2; exit 1; }
done

if ! $INSTALL; then
    printf 'Dry run: no files or MIME registrations will be changed.\n'
    for file in "${BIN_FILES[@]}"; do
        printf '  %s -> %s/%s\n' "$BIN_SOURCE/$file" "$BIN_TARGET" "$file"
    done
    for file in "${DESKTOP_FILES[@]}"; do
        printf '  %s -> %s/%s\n' "$DESKTOP_SOURCE/$file" "$DESKTOP_TARGET" "$file"
    done
    printf '  Register x-scheme-handler/yt-dlp -> net.local.yt-dlp-uri.desktop\n'
    printf 'Run with --install to apply these changes.\n'
    exit 0
fi

check_destination() {
    local destination=$1
    if [[ -d $destination && ! -L $destination ]]; then
        printf 'Destination is a directory: %s\n' "$destination" >&2
        return 1
    fi
}

for file in "${BIN_FILES[@]}"; do
    check_destination "$BIN_TARGET/$file"
done
for file in "${DESKTOP_FILES[@]}"; do
    check_destination "$DESKTOP_TARGET/$file"
done

command -v xdg-mime >/dev/null 2>&1 || { printf 'xdg-mime is required to register the URI handler.\n' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { printf 'python3 is required to stage desktop entries.\n' >&2; exit 1; }

timestamp=$(date '+%Y%m%d-%H%M%S')
staging_dir=$(mktemp -d)
cleanup() {
    rm -rf -- "$staging_dir"
}
trap cleanup EXIT

stage_desktop() {
    local source=$1 output=$2 shortcut_path=$3
    python3 - "$source" "$output" "$shortcut_path" <<'PY'
import sys

source, output, shortcut_path = sys.argv[1:]
with open(source, encoding="utf-8") as stream:
    lines = stream.readlines()

if any(char.isspace() or char in '"\\`$' for char in shortcut_path):
    quoted_path = '"' + shortcut_path.replace("\\", "\\\\").replace('"', '\\"')
    quoted_path = quoted_path.replace("`", "\\`").replace("$", "\\$") + '"'
else:
    quoted_path = shortcut_path

old_prefix = "Exec=/home/gratis01/.local/bin/yt-dlp-shortcut.sh"
new_prefix = "Exec=" + quoted_path
for index, line in enumerate(lines):
    if line.startswith(old_prefix):
        lines[index] = new_prefix + line[len(old_prefix):]

with open(output, "w", encoding="utf-8") as stream:
    stream.writelines(lines)
PY
}

backup_if_present() {
    local destination=$1 backup suffix=1
    if [[ -e $destination || -L $destination ]]; then
        backup="$destination.bak.$timestamp"
        while [[ -e $backup || -L $backup ]]; do
            backup="$destination.bak.$timestamp.$suffix"
            suffix=$((suffix + 1))
        done
        cp -a -- "$destination" "$backup"
        printf 'Backed up %s -> %s\n' "$destination" "$backup"
    fi
}

install_source() {
    local source=$1 destination=$2 mode=$3
    mkdir -p -- "$(dirname -- "$destination")"
    backup_if_present "$destination"
    install -m "$mode" -- "$source" "$destination"
    printf 'Installed %s -> %s\n' "$source" "$destination"
}

for file in "${BIN_FILES[@]}"; do
    install_source "$BIN_SOURCE/$file" "$BIN_TARGET/$file" 755
done

for file in "${DESKTOP_FILES[@]}"; do
    staged="$staging_dir/$file"
    stage_desktop "$DESKTOP_SOURCE/$file" "$staged" "$BIN_TARGET/yt-dlp-shortcut.sh"
    install_source "$staged" "$DESKTOP_TARGET/$file" 644
done

HOME="$TARGET_HOME" xdg-mime default net.local.yt-dlp-uri.desktop x-scheme-handler/yt-dlp
printf 'Registered x-scheme-handler/yt-dlp with net.local.yt-dlp-uri.desktop.\n'
