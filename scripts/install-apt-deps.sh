#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf 'Usage: %s [--with-rsgain]\n' "${0##*/}" >&2
}

WITH_RSGAIN=false
for argument in "$@"; do
    case $argument in
        --with-rsgain) WITH_RSGAIN=true ;;
        --help|-h) usage; exit 0 ;;
        *) usage; exit 2 ;;
    esac
done

if ! command -v apt-get >/dev/null 2>&1; then
    printf '%s\n' 'apt-get is required for automatic dependency installation.' >&2
    exit 1
fi

if [[ $EUID -eq 0 ]]; then
    APT=(apt-get)
elif command -v sudo >/dev/null 2>&1; then
    APT=(sudo apt-get)
else
    printf '%s\n' 'Install dependencies as root or install sudo first.' >&2
    exit 1
fi

PACKAGES=(yt-dlp ffmpeg python3 python3-mutagen python3-pil)
$WITH_RSGAIN && PACKAGES+=(rsgain)

"${APT[@]}" update
"${APT[@]}" install -y "${PACKAGES[@]}"
