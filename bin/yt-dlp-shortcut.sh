#!/usr/bin/env bash
set -u

if [[ ${OSTYPE:-} == linux* ]]; then
    preferred_path=()
    [[ -n ${HOME:-} && -d $HOME/.local/bin ]] && preferred_path+=("$HOME/.local/bin")
    [[ -d /usr/local/bin ]] && preferred_path+=(/usr/local/bin)
    current_path=()
    IFS=: read -r -a current_path <<< "${PATH:-}"
    filtered_path=()
    for entry in "${current_path[@]}"; do
        duplicate=false
        for preferred in "${preferred_path[@]}"; do
            [[ $entry == "$preferred" ]] && duplicate=true && break
        done
        if [[ $duplicate == false ]]; then
            filtered_path+=("$entry")
        fi
    done
    PATH=
    path_separator=
    for entry in "${preferred_path[@]}" "${filtered_path[@]}"; do
        PATH+="$path_separator$entry"
        path_separator=:
    done
    export PATH
fi

SCRIPT_NAME=${0##*/}
MODE=audio

usage() {
    printf 'Usage: %s [--playlist|--no-playlist] [--playlist-items SPEC] [audio|video|cut] [URL1 [URL2]]\n' "$SCRIPT_NAME" >&2
}

PLAYLIST_ARGS=()
POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --playlist)
            PLAYLIST_ARGS+=(--playlist)
            shift
            ;;
        --no-playlist)
            PLAYLIST_ARGS+=(--no-playlist)
            shift
            ;;
        --playlist-items=*)
            spec=${1#*=}
            if [[ ! $spec =~ ^[0-9:,-]+$ || ! $spec =~ [0-9] ]]; then
                printf 'Invalid playlist items specification: %s\n' "$spec" >&2
                exit 2
            fi
            PLAYLIST_ARGS+=(--playlist-items "$spec")
            shift
            ;;
        --playlist-items)
            if [[ $# -lt 2 || ! $2 =~ ^[0-9:,-]+$ || ! $2 =~ [0-9] ]]; then
                printf 'Invalid playlist items specification.\n' >&2
                exit 2
            fi
            PLAYLIST_ARGS+=(--playlist-items "$2")
            shift 2
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done
set -- ${POSITIONAL[@]+"${POSITIONAL[@]}"}

CANDIDATES=()

if [[ ${1:-} == audio || ${1:-} == video || ${1:-} == cut ]]; then
    MODE=$1
    shift
fi

if [[ $# -gt 2 ]]; then
    usage
    exit 2
fi
CANDIDATES=("$@")

is_safe_http_url() {
    python3 - "$1" <<'PY'
import ipaddress
import re
import sys
from urllib.parse import urlsplit

raw = sys.argv[1]

try:
    if not raw or raw.startswith("-") or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in raw):
        raise ValueError("empty URL, option-like value, or whitespace/control character")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("unsupported scheme")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("userinfo is not allowed")
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("hostname is required")
    parsed.port  # Accessing the property validates its syntax and range.
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        if hostname.endswith("."):
            hostname = hostname[:-1]
        if not hostname or hostname.endswith("."):
            raise ValueError("hostname contains an empty label")
        if len(hostname) > 253:
            raise ValueError("hostname is too long")
        labels = hostname.split(".")
        if any(not label for label in labels):
            raise ValueError("hostname contains an empty label")
        for label in labels:
            ascii_label = label.encode("idna").decode("ascii")
            if len(ascii_label) > 63 or not re.fullmatch(
                r"[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?", ascii_label
            ):
                raise ValueError("invalid hostname")
except (ValueError, UnicodeError):
    sys.exit(1)

sys.exit(0)
PY
}

URL=
if [[ -z $URL ]]; then
    for candidate in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
        if [[ -n $candidate ]] && is_safe_http_url "$candidate"; then
            URL=$candidate
            break
        fi
    done
fi

selection_url() {
    local selection=$1 output= use_wl_paste=0
    if [[ -n ${WAYLAND_DISPLAY:-} ]] || \
        { ! command -v xclip >/dev/null 2>&1 && ! command -v xsel >/dev/null 2>&1; }; then
        use_wl_paste=1
    fi

    if ((use_wl_paste)) && command -v wl-paste >/dev/null 2>&1; then
        if [[ $selection == primary ]]; then
            output=$(wl-paste -p 2>/dev/null || true)
        else
            output=$(wl-paste 2>/dev/null || true)
        fi
        if [[ -n $output ]] && is_safe_http_url "$output"; then
            printf '%s' "$output"
            return
        fi
    fi

    if command -v xclip >/dev/null 2>&1; then
        if [[ $selection == primary ]]; then
            output=$(xclip -o -selection primary 2>/dev/null || true)
        else
            output=$(xclip -o -selection clipboard 2>/dev/null || true)
        fi
        if [[ -n $output ]] && is_safe_http_url "$output"; then
            printf '%s' "$output"
            return
        fi
    fi

    if command -v xsel >/dev/null 2>&1; then
        if [[ $selection == primary ]]; then
            output=$(xsel --primary --output 2>/dev/null || true)
        else
            output=$(xsel --clipboard --output 2>/dev/null || true)
        fi
        if [[ -n $output ]] && is_safe_http_url "$output"; then
            printf '%s' "$output"
        fi
    fi
}

if [[ -z $URL ]]; then
    primary_url=$(selection_url primary)
    if [[ -n $primary_url ]]; then
        URL=$primary_url
    fi
fi

if [[ -z $URL ]]; then
    if command -v playerctl >/dev/null 2>&1; then
        mpris_url=$(playerctl metadata xesam:url 2>/dev/null || true)
        if [[ -n $mpris_url ]] && is_safe_http_url "$mpris_url"; then
            URL=$mpris_url
        fi
    fi

    if [[ -z $URL ]]; then
        qdbus_command=
        if command -v qdbus6 >/dev/null 2>&1; then
            qdbus_command=qdbus6
        elif command -v qdbus >/dev/null 2>&1; then
            qdbus_command=qdbus
        fi

        if [[ -n $qdbus_command ]]; then
            metadata=$(
                "$qdbus_command" \
                    org.mpris.MediaPlayer2.plasma-browser-integration \
                    /org/mpris/MediaPlayer2 \
                    org.freedesktop.DBus.Properties.Get \
                    org.mpris.MediaPlayer2.Player Metadata 2>/dev/null || true
            )
            mpris_url=$(python3 - "$metadata" <<'PY'
import json
import re
import sys

metadata = sys.argv[1]
field_pattern = re.compile(r'''^\s*(?:QString\s+)?["']?xesam:url["']?\s*:\s*(.*?)\s*$''')
json_string = re.compile(r'"(?:\\.|[^"\\])*"')

for line in metadata.splitlines():
    field = field_pattern.match(line)
    if not field:
        continue

    value = field.group(1)
    if value.startswith("QVariant"):
        quoted = json_string.search(value)
        if not quoted:
            break
        value = quoted.group(0)
    if value.startswith('"'):
        try:
            value, _ = json.JSONDecoder().raw_decode(value)
        except (ValueError, json.JSONDecodeError):
            break

    print(value, end="")
    break
PY
            )
            if [[ -n $mpris_url ]] && is_safe_http_url "$mpris_url"; then
                URL=$mpris_url
            fi
        fi
    fi
fi

if [[ -z $URL ]]; then
    clipboard_url=$(selection_url clipboard)
    if [[ -n $clipboard_url ]]; then
        URL=$clipboard_url
    fi
fi

if [[ -z $URL ]]; then
    notify-send -u normal 'yt-dlp auto-download' \
        'No safe HTTP(S) URL found in the explicit argument, primary selection, active media, or clipboard.' \
        >/dev/null 2>&1 || true
    exit 1
fi

notify-send -u low 'yt-dlp auto-download' "Starting $MODE task for: $URL" \
    >/dev/null 2>&1 || true

HOME_DIR=${HOME:-}
SCRIPT_PATH=${BASH_SOURCE[0]}
case $SCRIPT_PATH in
    */*) SCRIPT_DIR=${SCRIPT_PATH%/*}; [[ -n $SCRIPT_DIR ]] || SCRIPT_DIR=/ ;;
    *) SCRIPT_DIR=. ;;
esac
SCRIPT_DIR=$(cd -- "$SCRIPT_DIR" && pwd)
DEFAULT_WRAPPER="$HOME_DIR/.local/bin/yt-dlp-wrapper.py"
if [[ -f $SCRIPT_DIR/yt-dlp-wrapper.py ]]; then
    DEFAULT_WRAPPER="$SCRIPT_DIR/yt-dlp-wrapper.py"
fi
WRAPPER=${YT_DLP_WRAPPER:-$DEFAULT_WRAPPER}

terminal_name=${YTDL_TERMINAL:-}
if [[ -z $terminal_name ]]; then
    desktop=${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-}}
    desktop=${desktop,,}
    case $desktop in
        *kde*) preferred_terminals=(konsole) ;;
        *gnome*) preferred_terminals=(ptyxis kgx gnome-terminal) ;;
        *xfce*) preferred_terminals=(xfce4-terminal) ;;
        *mate*) preferred_terminals=(mate-terminal) ;;
        *tilix*) preferred_terminals=(tilix) ;;
        *) preferred_terminals=() ;;
    esac
    all_terminals=(
        konsole ptyxis kgx gnome-terminal xfce4-terminal mate-terminal
        tilix alacritty kitty xterm x-terminal-emulator
    )
    search_terminals=("${preferred_terminals[@]}")
    for terminal in "${all_terminals[@]}"; do
        already_preferred=0
        for preferred in "${preferred_terminals[@]}"; do
            [[ $terminal == "$preferred" ]] && already_preferred=1 && break
        done
        ((already_preferred)) || search_terminals+=("$terminal")
    done
    for terminal in "${search_terminals[@]}"; do
        if command -v "$terminal" >/dev/null 2>&1; then
            terminal_name=$terminal
            break
        fi
    done
fi

if [[ -z $terminal_name ]] || ! command -v "$terminal_name" >/dev/null 2>&1; then
    printf 'No supported terminal emulator was found.\n' >&2
    exit 1
fi

case ${terminal_name##*/} in
    konsole|tilix|alacritty|kitty|xterm|x-terminal-emulator)
        exec "$terminal_name" -e "$WRAPPER" --wait-keypress ${PLAYLIST_ARGS[@]+"${PLAYLIST_ARGS[@]}"} "$MODE" "$URL"
        ;;
    xfce4-terminal)
        exec "$terminal_name" -x "$WRAPPER" --wait-keypress ${PLAYLIST_ARGS[@]+"${PLAYLIST_ARGS[@]}"} "$MODE" "$URL"
        ;;
    ptyxis|kgx|gnome-terminal|mate-terminal)
        exec "$terminal_name" -- "$WRAPPER" --wait-keypress ${PLAYLIST_ARGS[@]+"${PLAYLIST_ARGS[@]}"} "$MODE" "$URL"
        ;;
    *)
        printf 'Unsupported terminal emulator: %s\n' "$terminal_name" >&2
        exit 1
        ;;
esac
