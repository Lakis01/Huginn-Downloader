#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf 'Usage: %s [--with-rsgain] [--check]\n' "${0##*/}" >&2
}

WITH_RSGAIN=false
CHECK_ONLY=false
for argument in "$@"; do
    case $argument in
        --with-rsgain) WITH_RSGAIN=true ;;
        --check) CHECK_ONLY=true ;;
        --help|-h) usage; exit 0 ;;
        *) usage; exit 2 ;;
    esac
done

if [[ -n ${HOME:-} && -d $HOME/.local/bin ]]; then
    PATH="$HOME/.local/bin:$PATH"
    export PATH
fi

MISSING_PACKAGES=()
add_missing_package() {
    local package=$1 existing
    for existing in "${MISSING_PACKAGES[@]}"; do
        [[ $existing == "$package" ]] && return 0
    done
    MISSING_PACKAGES+=("$package")
}

command_available() {
    command -v "$1" >/dev/null 2>&1
}

command_available yt-dlp || add_missing_package yt-dlp
if ! command_available ffmpeg || ! command_available ffprobe; then
    add_missing_package ffmpeg
fi

if command_available python3; then
    python3 -c 'import mutagen' >/dev/null 2>&1 || add_missing_package python3-mutagen
    python3 -c 'import PIL' >/dev/null 2>&1 || add_missing_package python3-pil
else
    add_missing_package python3
    add_missing_package python3-mutagen
    add_missing_package python3-pil
fi

if $WITH_RSGAIN && ! command_available rsgain; then
    add_missing_package rsgain
fi

if ((${#MISSING_PACKAGES[@]} == 0)); then
    printf '%s\n' 'All requested dependencies are available.'
    exit 0
fi

if $CHECK_ONLY; then
    printf 'Missing dependencies; apt packages to install: %s\n' "${MISSING_PACKAGES[*]}"
    exit 0
fi

if ! command_available apt-get; then
    printf '%s\n' 'apt-get is required to install missing dependencies.' >&2
    exit 1
fi

if [[ $EUID -eq 0 ]]; then
    APT=(apt-get)
elif command_available sudo; then
    APT=(sudo apt-get)
else
    printf '%s\n' 'Install dependencies as root or install sudo first.' >&2
    exit 1
fi

"${APT[@]}" update
"${APT[@]}" install -y "${MISSING_PACKAGES[@]}"
