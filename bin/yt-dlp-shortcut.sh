#!/usr/bin/env bash
set -u

SCRIPT_NAME=${0##*/}
MODE=audio
EXPLICIT_URL=
URI_ARGUMENT=
URI_SUPPLIED=

usage() {
    printf 'Usage: %s [audio|video|cut] [URL1 [URL2]]\n       %s [--uri] yt-dlp://<audio|video|cut>?url=<encoded-URL>\n' \
        "$SCRIPT_NAME" "$SCRIPT_NAME" >&2
}

CANDIDATES=()

if [[ ${1:-} == audio || ${1:-} == video || ${1:-} == cut ]]; then
    MODE=$1
    shift
fi

case $# in
    0)
        ;;
    1)
        if [[ $1 == --uri ]]; then
            usage
            exit 2
        elif [[ $1 == yt-dlp://* ]]; then
            URI_ARGUMENT=$1
            URI_SUPPLIED=1
        else
            CANDIDATES=("$1")
        fi
        ;;
    2)
        if [[ $1 == --uri ]]; then
            URI_ARGUMENT=$2
            URI_SUPPLIED=1
        else
            CANDIDATES=("$1" "$2")
        fi
        ;;
    *)
        usage
        exit 2
        ;;
esac

is_youtube_url() {
    python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit

raw = sys.argv[1]
allowed_hosts = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}

try:
    if not raw or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in raw):
        raise ValueError("empty URL or whitespace/control character")
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("unsupported scheme")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("userinfo is not allowed")
    if (parsed.hostname or "").lower() not in allowed_hosts:
        raise ValueError("host is not an allowed YouTube host")
    port = parsed.port
    if port is not None and port not in {80, 443}:
        raise ValueError("unsupported port")
except (ValueError, UnicodeError):
    sys.exit(1)

sys.exit(0)
PY
}

parse_uri() {
    local parsed
    parsed=$(python3 - "$1" <<'PY'
import re
import sys
from urllib.parse import parse_qsl, urlsplit

uri = sys.argv[1]
try:
    if re.search(r"%(?![0-9A-Fa-f]{2})", uri):
        raise ValueError("malformed percent escape")
    parsed = urlsplit(uri)
    mode = parsed.netloc
    if parsed.scheme != "yt-dlp" or mode not in {"audio", "video", "cut"}:
        raise ValueError("unsupported scheme or mode")
    if parsed.path or parsed.fragment or parsed.netloc != mode:
        raise ValueError("unexpected URI components")
    fields = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    if len(fields) != 1 or fields[0][0] != "url":
        raise ValueError("URI must contain exactly one url parameter")
    url = fields[0][1]
    if not url or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in url):
        raise ValueError("invalid URL value")
    from urllib.parse import urlsplit as split_url
    target = split_url(url)
    allowed_hosts = {
        "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
        "youtu.be", "www.youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
    }
    if target.scheme not in {"http", "https"}:
        raise ValueError("unsupported target scheme")
    if target.username is not None or target.password is not None:
        raise ValueError("userinfo is not allowed")
    if (target.hostname or "").lower() not in allowed_hosts:
        raise ValueError("target host is not allowed")
    if target.port is not None and target.port not in {80, 443}:
        raise ValueError("unsupported target port")
except (ValueError, UnicodeError):
    sys.exit(1)

print(mode + "\t" + url)
PY
) || return 1

    [[ $parsed == *$'\t'* ]] || return 1
    MODE=${parsed%%$'\t'*}
    EXPLICIT_URL=${parsed#*$'\t'}
    [[ $EXPLICIT_URL != *$'\t'* ]]
}

if [[ -n $URI_SUPPLIED ]]; then
    if ! parse_uri "$URI_ARGUMENT"; then
        printf 'Invalid yt-dlp URI: %s\n' "$URI_ARGUMENT" >&2
        exit 2
    fi
fi

URL=
if [[ -n $EXPLICIT_URL ]]; then
    URL=$EXPLICIT_URL
fi
if [[ -z $URL ]]; then
    for candidate in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
        if [[ $candidate == yt-dlp://* ]]; then
            if ! parse_uri "$candidate"; then
                printf 'Invalid yt-dlp URI: %s\n' "$candidate" >&2
                exit 2
            fi
            URL=$EXPLICIT_URL
            break
        fi
        if [[ -n $candidate ]] && is_youtube_url "$candidate"; then
            URL=$candidate
            break
        fi
    done
fi

if [[ -z $URL ]]; then
    primary_url=$(wl-paste -p 2>/dev/null || true)
    if [[ -n $primary_url ]] && is_youtube_url "$primary_url"; then
        URL=$primary_url
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
        if [[ -n $mpris_url ]] && is_youtube_url "$mpris_url"; then
            URL=$mpris_url
        fi
    fi
fi

if [[ -z $URL ]]; then
    clipboard_url=$(wl-paste 2>/dev/null || true)
    if [[ -n $clipboard_url ]] && is_youtube_url "$clipboard_url"; then
        URL=$clipboard_url
    fi
fi

if [[ -z $URL ]]; then
    notify-send -u normal 'yt-dlp auto-download' \
        'No valid YouTube URL found in the explicit argument, primary selection, active media, or clipboard.' \
        >/dev/null 2>&1 || true
    exit 1
fi

notify-send -u low 'yt-dlp auto-download' "Starting $MODE task for: $URL" \
    >/dev/null 2>&1 || true

HOME_DIR=${HOME:-}
WRAPPER=${YT_DLP_WRAPPER:-$HOME_DIR/.local/bin/yt-dlp-wrapper.py}
exec konsole --hold -e "$WRAPPER" "$MODE" "$URL"
