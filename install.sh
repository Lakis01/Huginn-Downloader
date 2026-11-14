#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BIN_SOURCE="$ROOT/bin"
DESKTOP_SOURCE="$ROOT/desktop"
TARGET_HOME=${HOME:-}
XPI_TARGET="$ROOT/dist/firefox-youtube-downloader.xpi"
IS_MACOS=false
[[ $(uname -s) == Darwin ]] && IS_MACOS=true

usage() {
    cat <<EOF
Usage: ${0##*/} [--install [--download-dir=<path|ytdlp-default>] [--auto-tag=<true|false>] [--rsgain=<true|false>] [--install-deps [--with-rsgain]] [--yes]]
       ${0##*/} --check-deps
       ${0##*/} [--help]

Without --install, show a no-write installation plan. --check-deps reports
the current platform and dependency suggestions without installing anything.
EOF
}

lowercase() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

INSTALL=false
CHECK_DEPS=false
ASSUME_YES=false
INSTALL_DEPS=false
WITH_RSGAIN=false
DOWNLOAD_DIR_SET=false
AUTO_TAG_SET=false
RSGAIN_SET=false
DOWNLOAD_DIR_VALUE=
AUTO_TAG_VALUE=
RSGAIN_VALUE=

set_boolean_option() {
    local name=$1 value=$2
    case $value in
        true|false) ;;
        *) printf '%s must be true or false.\n' "$name" >&2; exit 2 ;;
    esac
    case $name in
        auto-tag) AUTO_TAG_SET=true; AUTO_TAG_VALUE=$value ;;
        rsgain) RSGAIN_SET=true; RSGAIN_VALUE=$value ;;
    esac
}

for argument in "$@"; do
    case $argument in
        --install) INSTALL=true ;;
        --check-deps) CHECK_DEPS=true ;;
        --install-deps) INSTALL_DEPS=true ;;
        --with-rsgain) WITH_RSGAIN=true ;;
        --yes) ASSUME_YES=true ;;
        --download-dir=*)
            DOWNLOAD_DIR_SET=true
            DOWNLOAD_DIR_VALUE=${argument#*=}
            [[ -n $DOWNLOAD_DIR_VALUE ]] || { printf '%s\n' '--download-dir must not be empty.' >&2; exit 2; }
            ;;
        --auto-tag=*) set_boolean_option auto-tag "${argument#*=}" ;;
        --rsgain=*) set_boolean_option rsgain "${argument#*=}" ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

if $CHECK_DEPS; then
    if $INSTALL || $ASSUME_YES || $DOWNLOAD_DIR_SET || $AUTO_TAG_SET || $RSGAIN_SET || $INSTALL_DEPS || $WITH_RSGAIN; then
        printf '%s\n' '--check-deps cannot be combined with install or configuration options.' >&2
        exit 2
    fi
elif ! $INSTALL && { $ASSUME_YES || $DOWNLOAD_DIR_SET || $AUTO_TAG_SET || $RSGAIN_SET || $INSTALL_DEPS || $WITH_RSGAIN; }; then
    printf '%s\n' 'Installation and configuration options require --install.' >&2
    exit 2
fi
if $WITH_RSGAIN && ! $INSTALL_DEPS; then
    printf '%s\n' '--with-rsgain requires --install-deps.' >&2
    exit 2
fi

if [[ -z $TARGET_HOME || $TARGET_HOME != /* ]]; then
    printf 'HOME must be set to an absolute path.\n' >&2
    exit 1
fi

BIN_TARGET="$TARGET_HOME/.local/bin"
DESKTOP_TARGET="$TARGET_HOME/.local/share/applications"
BIN_FILES=(ytdl_config.py ytdl_meta.py ytdl_version.py yt-dlp-wrapper.py yt-dlp-shortcut.sh yt-dlp-native-host.py)
DESKTOP_FILES=(
    net.local.yt-dlp-shortcut.sh.desktop
    net.local.yt-dlp-shortcut.sh-2.desktop
    net.local.yt-dlp-shortcut.sh-3.desktop
)

for file in "${BIN_FILES[@]}"; do
    [[ -f $BIN_SOURCE/$file ]] || { printf 'Missing source: %s\n' "$BIN_SOURCE/$file" >&2; exit 1; }
done
if ! $IS_MACOS; then
    for file in "${DESKTOP_FILES[@]}"; do
        [[ -f $DESKTOP_SOURCE/$file ]] || { printf 'Missing source: %s\n' "$DESKTOP_SOURCE/$file" >&2; exit 1; }
    done
fi

if $CHECK_DEPS; then
    if $IS_MACOS; then
        printf 'Platform: macOS (%s)\n' "$(sw_vers -productVersion 2>/dev/null || printf 'version unknown')"
        printf 'Suggested dependencies (review; this command is not run):\n'
        printf 'brew install yt-dlp ffmpeg rsgain python pillow\n'
        exit 0
    fi
    desktop_session=${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}
    case $(lowercase "$desktop_session") in
        *kde*|*plasma*) desktop_label=KDE ;;
        *gnome*) desktop_label=GNOME ;;
        *cinnamon*) desktop_label=Cinnamon ;;
        *) desktop_label=${desktop_session:-unknown} ;;
    esac
    if [[ -n ${WAYLAND_DISPLAY:-} ]]; then
        display_server=Wayland
    elif [[ -n ${DISPLAY:-} ]]; then
        display_server=X11
    else
        display_server=unknown
    fi
    printf 'Desktop session: %s (%s)\n' "$desktop_label" "$desktop_session"
    printf 'Display server: %s\n' "$display_server"
    printf 'Prerequisite tools (present / missing):\n'
    for tool in yt-dlp ffmpeg rsgain python3 node nodejs konsole ptyxis kgx gnome-terminal xfce4-terminal x-terminal-emulator notify-send wl-paste xclip xsel playerctl qdbus6 qdbus desktop-file-validate; do
        if command -v "$tool" >/dev/null 2>&1; then
            printf '  present: %s (%s)\n' "$tool" "$(command -v "$tool")"
        else
            printf '  missing: %s\n' "$tool"
        fi
    done
    if python3 -c 'import mutagen, PIL' >/dev/null 2>&1; then
        printf '  present: Python libraries mutagen, Pillow\n'
    else
        printf '  missing: Python libraries mutagen, Pillow\n'
    fi
    printf '\nSuggested dependencies (review; this command is not run):\n'
    printf 'Debian 13.7 (GNOME) [Wayland default]: sudo apt install yt-dlp ffmpeg python3 python3-mutagen python3-pil nodejs libnotify-bin wl-clipboard playerctl qt6-tools-dev-tools desktop-file-utils\n'
    printf 'LMDE 7 (Cinnamon) [X11 default]: sudo apt install yt-dlp ffmpeg python3 python3-mutagen python3-pil nodejs gnome-terminal libnotify-bin xclip xsel playerctl qt6-tools-dev-tools desktop-file-utils\n'
    printf 'Optional ReplayGain: sudo apt install rsgain\n'
    printf 'GNOME usually includes kgx or ptyxis; install gnome-terminal only if desired. Clipboard tools: wl-clipboard on Wayland, xclip or xsel on X11.\n'
    exit 0
fi

if $INSTALL_DEPS; then
    if $IS_MACOS || [[ ! -r /etc/os-release ]]; then
        printf '%s\n' 'Automatic apt dependency installation is only supported on Debian-family Linux.' >&2
        exit 1
    fi
    . /etc/os-release
    distro_ids=" ${ID:-} ${ID_LIKE:-} "
    case $distro_ids in
        *" debian "*|*" ubuntu "*) ;;
        *)
            printf '%s\n' 'Automatic apt dependency installation is only supported on Debian-family Linux.' >&2
            exit 1
            ;;
    esac
    command -v apt-get >/dev/null 2>&1 || {
        printf '%s\n' 'apt-get was not found; install dependencies with this distribution’s package manager.' >&2
        exit 1
    }
    apt_args=()
    $WITH_RSGAIN && apt_args+=(--with-rsgain)
    bash "$ROOT/scripts/install-apt-deps.sh" "${apt_args[@]}"
fi

CONFIG_DEST=$(PYTHONPATH="$BIN_SOURCE" HOME="$TARGET_HOME" python3 -c 'from ytdl_config import config_path; print(config_path())')
XDG_CONFIG_HOME_RESOLVED=$(PYTHONPATH="$BIN_SOURCE" HOME="$TARGET_HOME" python3 -c 'from ytdl_config import config_path; print(config_path().parents[1])')
if $IS_MACOS; then
    HOME_NATIVE_MANIFEST="$TARGET_HOME/Library/Application Support/Mozilla/NativeMessagingHosts/firefox_youtube_downloader.json"
    XDG_NATIVE_MANIFEST=
    NATIVE_MANIFESTS_SAME=true
else
    HOME_NATIVE_MANIFEST="$TARGET_HOME/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json"
    XDG_NATIVE_MANIFEST="$XDG_CONFIG_HOME_RESOLVED/mozilla/native-messaging-hosts/firefox_youtube_downloader.json"
    NATIVE_MANIFESTS_SAME=$(python3 - "$HOME_NATIVE_MANIFEST" "$XDG_NATIVE_MANIFEST" <<'PY'
from pathlib import Path
import sys
print("true" if Path(sys.argv[1]).resolve() == Path(sys.argv[2]).resolve() else "false")
PY
)
fi
YTDLP_CONFIG_EXISTS=$(PYTHONPATH="$BIN_SOURCE" HOME="$TARGET_HOME" python3 -c 'from ytdl_config import ytdlp_config_exists; print("true" if ytdlp_config_exists() else "false")')
PLUGIN_CONFIG_EXISTS=false
[[ -e $CONFIG_DEST || -L $CONFIG_DEST ]] && PLUGIN_CONFIG_EXISTS=true

if ! $INSTALL; then
    printf 'Dry run: no files, configuration, or build artifacts will be changed.\n'
    for file in "${BIN_FILES[@]}"; do
        printf '  %s -> %s/%s\n' "$BIN_SOURCE/$file" "$BIN_TARGET" "$file"
    done
    if ! $IS_MACOS; then
        for file in "${DESKTOP_FILES[@]}"; do
            printf '  %s -> %s/%s\n' "$DESKTOP_SOURCE/$file" "$DESKTOP_TARGET" "$file"
        done
    fi
    printf '  Write native-messaging manifest: %s\n' "$HOME_NATIVE_MANIFEST"
    if ! $IS_MACOS && [[ $NATIVE_MANIFESTS_SAME == false ]]; then
        printf '  Write native-messaging manifest: %s\n' "$XDG_NATIVE_MANIFEST"
    fi
    printf '  Build %s\n' "$XPI_TARGET"
    printf '  Config: %s\n' "$CONFIG_DEST"
    if $PLUGIN_CONFIG_EXISTS; then
        printf '    Preserve existing plugin config unless an explicit option is supplied.\n'
    elif [[ $YTDLP_CONFIG_EXISTS == true ]]; then
        printf '    Fresh config defaults to download_dir=null (defer to existing yt-dlp config).\n'
    else
        printf '    Fresh config defaults to download_dir=~/Music/Youtube Downloads.\n'
    fi
    printf '    Never create or modify %s/.config/yt-dlp/config.\n' "$TARGET_HOME"
    printf 'Run with --install to apply these changes.\n'
    exit 0
fi

if $DOWNLOAD_DIR_SET && [[ $DOWNLOAD_DIR_VALUE == ytdlp-default ]]; then
    DOWNLOAD_DIR_VALUE=null
fi

check_destination() {
    local destination=$1
    if [[ -d $destination ]]; then
        printf 'Destination is a directory: %s\n' "$destination" >&2
        return 1
    fi
}

# Preflight every final path before building the XPI or writing any files.
for file in "${BIN_FILES[@]}"; do
    check_destination "$BIN_TARGET/$file"
done
if ! $IS_MACOS; then
    for file in "${DESKTOP_FILES[@]}"; do
        check_destination "$DESKTOP_TARGET/$file"
    done
fi
check_destination "$HOME_NATIVE_MANIFEST"
if ! $IS_MACOS && [[ $NATIVE_MANIFESTS_SAME == false ]]; then
    check_destination "$XDG_NATIVE_MANIFEST"
fi
check_destination "$CONFIG_DEST"
check_destination "$XPI_TARGET"

command -v python3 >/dev/null 2>&1 || { printf 'python3 is required to install configuration and stage desktop entries.\n' >&2; exit 1; }
if $IS_MACOS; then
    PYTHON_BIN=$(command -v python3)
fi

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
STAGING_DIR=$(mktemp -d)
cleanup() { rm -rf -- "$STAGING_DIR"; }
trap cleanup EXIT

if $IS_MACOS; then
    STAGED_NATIVE_HOST="$STAGING_DIR/yt-dlp-native-host.py"
    python3 - "$BIN_SOURCE/yt-dlp-native-host.py" "$STAGED_NATIVE_HOST" "$PYTHON_BIN" <<'PY'
from pathlib import Path
import sys

source, destination, python_bin = sys.argv[1:]
contents = Path(source).read_text(encoding="utf-8")
first_line, separator, remainder = contents.partition("\n")
if first_line.rstrip("\r") != "#!/usr/bin/env python3":
    raise SystemExit(f"Unexpected native host shebang: {first_line!r}")
Path(destination).write_text(f"#!{python_bin}\n{remainder}", encoding="utf-8")
PY
fi

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
        backup="$destination.bak.$TIMESTAMP"
        while [[ -e $backup || -L $backup ]]; do
            backup="$destination.bak.$TIMESTAMP.$suffix"
            suffix=$((suffix + 1))
        done
        cp -pPR "$destination" "$backup"
        printf 'Backed up %s -> %s\n' "$destination" "$backup"
    fi
}

install_source() {
    local source=$1 destination=$2 mode=$3
    mkdir -p -- "$(dirname -- "$destination")"
    backup_if_present "$destination"
    install -m "$mode" "$source" "$destination"
    printf 'Installed %s -> %s\n' "$source" "$destination"
}

save_configuration() {
    local download_dir=$1 auto_tag=$2 rsgain=$3
    backup_if_present "$CONFIG_DEST"
    PYTHONPATH="$BIN_SOURCE" HOME="$TARGET_HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME_RESOLVED" \
        python3 - "$download_dir" "$auto_tag" "$rsgain" "$PLUGIN_CONFIG_EXISTS" <<'PY'
import sys
from ytdl_config import DEFAULT_FRESH_DOWNLOAD_DIR, load_config, save_config, ytdlp_config_exists

download_dir, auto_tag, rsgain, had_config = sys.argv[1:]
if had_config == "true":
    config = load_config()
else:
    config = {
        "download_dir": None if ytdlp_config_exists() else DEFAULT_FRESH_DOWNLOAD_DIR,
        "auto_tag": True,
        "rsgain": False,
    }
if download_dir not in ("__unchanged__", "__default__"):
    config["download_dir"] = None if download_dir == "null" else download_dir
if auto_tag != "__unchanged__":
    config["auto_tag"] = auto_tag == "true"
if rsgain != "__unchanged__":
    config["rsgain"] = rsgain == "true"
save_config(config)
PY
    printf 'Saved plugin configuration to %s\n' "$CONFIG_DEST"
}

if ! $PLUGIN_CONFIG_EXISTS; then
    selected_download_dir=__default__
    selected_auto_tag=true
    selected_rsgain=false
    if [[ -t 0 && $ASSUME_YES == false && $DOWNLOAD_DIR_SET == false && $AUTO_TAG_SET == false && $RSGAIN_SET == false ]]; then
        printf 'Choose the default download directory:\n'
        if [[ $YTDLP_CONFIG_EXISTS == true ]]; then
            printf '  [0] Keep existing yt-dlp config (default)\n'
        fi
        printf '  [1] ~/Music/Youtube Downloads%s\n' "$([[ $YTDLP_CONFIG_EXISTS == false ]] && printf ' (default)')"
        printf '  [2] ~/Downloads/Youtube\n'
        printf '  [3] Custom path\n'
        read -r -p 'Choice: ' download_choice
        if [[ $YTDLP_CONFIG_EXISTS == true ]]; then
            case $download_choice in
                ''|0) selected_download_dir=null ;;
                1) selected_download_dir='~/Music/Youtube Downloads' ;;
                2) selected_download_dir='~/Downloads/Youtube' ;;
                3)
                    read -r -p 'Custom download path: ' selected_download_dir
                    [[ -n $selected_download_dir ]] || { printf 'Download path must not be empty.\n' >&2; exit 2; }
                    ;;
                *) printf 'Invalid download directory choice.\n' >&2; exit 2 ;;
            esac
        else
            case $download_choice in
                ''|1) selected_download_dir='~/Music/Youtube Downloads' ;;
                2) selected_download_dir='~/Downloads/Youtube' ;;
                3)
                    read -r -p 'Custom download path: ' selected_download_dir
                    [[ -n $selected_download_dir ]] || { printf 'Download path must not be empty.\n' >&2; exit 2; }
                    ;;
                *) printf 'Invalid download directory choice.\n' >&2; exit 2 ;;
            esac
        fi
        read -r -p 'Automatic tag extraction? [Y/n] ' auto_tag_choice
        case $(lowercase "$auto_tag_choice") in
            ''|y|yes) selected_auto_tag=true ;;
            n|no) selected_auto_tag=false ;;
            *) printf 'Invalid automatic tag choice.\n' >&2; exit 2 ;;
        esac
        read -r -p 'ReplayGain rsgain normalization? [y/N] ' rsgain_choice
        case $(lowercase "$rsgain_choice") in
            y|yes) selected_rsgain=true ;;
            ''|n|no) selected_rsgain=false ;;
            *) printf 'Invalid ReplayGain choice.\n' >&2; exit 2 ;;
        esac
    fi
    if $DOWNLOAD_DIR_SET; then selected_download_dir=$DOWNLOAD_DIR_VALUE; fi
    if $AUTO_TAG_SET; then selected_auto_tag=$AUTO_TAG_VALUE; fi
    if $RSGAIN_SET; then selected_rsgain=$RSGAIN_VALUE; fi
    save_configuration "$selected_download_dir" "$selected_auto_tag" "$selected_rsgain"
elif $DOWNLOAD_DIR_SET || $AUTO_TAG_SET || $RSGAIN_SET; then
    selected_download_dir=__unchanged__
    selected_auto_tag=__unchanged__
    selected_rsgain=__unchanged__
    if $DOWNLOAD_DIR_SET; then selected_download_dir=$DOWNLOAD_DIR_VALUE; fi
    if $AUTO_TAG_SET; then selected_auto_tag=$AUTO_TAG_VALUE; fi
    if $RSGAIN_SET; then selected_rsgain=$RSGAIN_VALUE; fi
    save_configuration "$selected_download_dir" "$selected_auto_tag" "$selected_rsgain"
else
    printf 'Preserved existing plugin configuration at %s\n' "$CONFIG_DEST"
fi

"$ROOT/scripts/build-xpi.sh"

for file in "${BIN_FILES[@]}"; do
    source_file="$BIN_SOURCE/$file"
    if $IS_MACOS && [[ $file == yt-dlp-native-host.py ]]; then
        source_file=$STAGED_NATIVE_HOST
    fi
    install_source "$source_file" "$BIN_TARGET/$file" 755
done
if ! $IS_MACOS; then
    for file in "${DESKTOP_FILES[@]}"; do
        staged="$STAGING_DIR/$file"
        stage_desktop "$DESKTOP_SOURCE/$file" "$staged" "$BIN_TARGET/yt-dlp-shortcut.sh"
        install_source "$staged" "$DESKTOP_TARGET/$file" 644
    done
fi

manifest_template="$STAGING_DIR/firefox_youtube_downloader.json"
python3 - "$manifest_template" "$BIN_TARGET/yt-dlp-native-host.py" <<'PY'
import json
import sys

destination, host_path = sys.argv[1:]
manifest = {
    "name": "firefox_youtube_downloader",
    "description": "Native Messaging host for Firefox YouTube Downloader Plugin",
    "path": host_path,
    "type": "stdio",
    "allowed_extensions": ["firefox-youtube-downloader@lakis01.github.io"],
}
with open(destination, "w", encoding="utf-8") as stream:
    json.dump(manifest, stream, indent=2)
    stream.write("\n")
PY
install_source "$manifest_template" "$HOME_NATIVE_MANIFEST" 644
if ! $IS_MACOS && [[ $NATIVE_MANIFESTS_SAME == false ]]; then
    install_source "$manifest_template" "$XDG_NATIVE_MANIFEST" 644
fi
