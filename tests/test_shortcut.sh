#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHORTCUT="$ROOT/bin/yt-dlp-shortcut.sh"
SOURCE_WRAPPER="$ROOT/bin/yt-dlp-wrapper.py"
INSTALLER="$ROOT/install.sh"
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
unset XDG_CONFIG_HOME

PASS=0
fail() {
    printf 'not ok - %s\n' "$1" >&2
    exit 1
}

assert_eq() {
    local expected=$1 actual=$2 label=$3
    [[ "$actual" == "$expected" ]] || fail "$label (expected [$expected], got [$actual])"
}

assert_file_contains() {
    local file=$1 text=$2 label=$3
    grep -Fq -- "$text" "$file" || fail "$label (missing [$text] in $file)"
}

pass() {
    printf 'ok - %s\n' "$1"
    PASS=$((PASS + 1))
}

mkdir -p "$TMP/stubs"
cat > "$TMP/stubs/konsole" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CALL_ARGS"
STUB
cat > "$TMP/stubs/notify-send" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$TMP/stubs/wl-paste" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
    -p|--primary) printf '%s' "${WL_PRIMARY_SELECTION:-${PRIMARY_SELECTION:-}}" ;;
    *) printf '%s' "${WL_CLIPBOARD_SELECTION:-${CLIPBOARD_SELECTION:-}}" ;;
esac
STUB
cat > "$TMP/stubs/qdbus6" <<'STUB'
#!/usr/bin/env bash
[[ -n "${MPRIS_OUTPUT:-}" ]] || exit 1
printf '%s\n' "$MPRIS_OUTPUT"
STUB
cat > "$TMP/stubs/playerctl" <<'STUB'
#!/usr/bin/env bash
[[ ${1:-} == metadata && ${2:-} == xesam:url && -n ${MPRIS_OUTPUT:-} ]] || exit 1
printf '%s\n' "$MPRIS_OUTPUT"
STUB
cat > "$TMP/stubs/xclip" <<'STUB'
#!/usr/bin/env bash
case " $* " in
    *' primary '*) printf '%s' "${PRIMARY_SELECTION:-}" ;;
    *) printf '%s' "${CLIPBOARD_SELECTION:-}" ;;
esac
STUB
cat > "$TMP/stubs/xsel" <<'STUB'
#!/usr/bin/env bash
case " $* " in
    *' --primary '*) printf '%s' "${PRIMARY_SELECTION:-}" ;;
    *) printf '%s' "${CLIPBOARD_SELECTION:-}" ;;
esac
STUB
chmod +x "$TMP/stubs/"*

export PATH="$TMP/stubs:$PATH"
export CALL_ARGS="$TMP/call-args"
export CALL_TERMINAL="$TMP/call-terminal"

run_shortcut() {
    rm -f -- "$CALL_ARGS"
    HOME="$TMP/home" YTDL_TERMINAL=${YTDL_TERMINAL:-konsole} "$SHORTCUT" "$@"
}

assert_launch() {
    local mode=$1 url=$2 label=$3
    [[ -f "$CALL_ARGS" ]] || fail "$label (terminal was not launched)"
    mapfile -t args < "$CALL_ARGS"
    assert_eq '-e' "${args[0]:-}" "$label: Konsole execute option"
    assert_eq "$SOURCE_WRAPPER" "${args[1]:-}" "$label: wrapper path"
    assert_eq '--wait-keypress' "${args[2]:-}" "$label: wait-keypress option"
    assert_eq "$mode" "${args[3]:-}" "$label: mode argument"
    assert_eq "$url" "${args[4]:-}" "$label: URL argument"
    assert_eq 5 "${#args[@]}" "$label: argument count"
}

assert_terminal_args() {
    local terminal=$1 separator=$2 mode=$3 url=$4 label=$5
    [[ -f "$CALL_ARGS" ]] || fail "$label (terminal was not launched)"
    mapfile -t args < "$CALL_ARGS"
    if [[ $separator == '-e' || $separator == '-x' ]]; then
        assert_eq "$separator" "${args[0]:-}" "$label: terminal separator"
        assert_eq "$SOURCE_WRAPPER" "${args[1]:-}" "$label: wrapper path"
        assert_eq '--wait-keypress' "${args[2]:-}" "$label: wait-keypress option"
        assert_eq "$mode" "${args[3]:-}" "$label: mode argument"
        assert_eq "$url" "${args[4]:-}" "$label: URL argument"
        assert_eq 5 "${#args[@]}" "$label: argument count"
    else
        assert_eq '--' "${args[0]:-}" "$label: terminal separator"
        assert_eq "$SOURCE_WRAPPER" "${args[1]:-}" "$label: wrapper path"
        assert_eq '--wait-keypress' "${args[2]:-}" "$label: wait-keypress option"
        assert_eq "$mode" "${args[3]:-}" "$label: mode argument"
        assert_eq "$url" "${args[4]:-}" "$label: URL argument"
        assert_eq 5 "${#args[@]}" "$label: argument count"
    fi
    [[ -n $terminal ]] || fail "$label (terminal name was empty)"
}

add_terminal_stub() {
    local terminal=$1
    cat > "$TMP/stubs/$terminal" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "${0##*/}" > "$CALL_TERMINAL"
printf '%s\n' "$@" > "$CALL_ARGS"
STUB
    chmod +x "$TMP/stubs/$terminal"
}

shortcut_path_home="$TMP/shortcut-path-home"
shortcut_path_stubs="$TMP/shortcut-path-stubs"
mkdir -p "$shortcut_path_home/.local/bin" "$shortcut_path_stubs"
printf '#!/bin/bash\nexit 0\n' > "$shortcut_path_home/.local/bin/yt-dlp"
chmod +x "$shortcut_path_home/.local/bin/yt-dlp"
cat > "$shortcut_path_stubs/konsole" <<'STUB'
#!/bin/bash
printf '%s\n' "$PATH" > "$PATH_CAPTURE"
STUB
chmod +x "$shortcut_path_stubs/konsole"
shortcut_path_capture="$TMP/shortcut-path.capture"
HOME="$shortcut_path_home" PATH="$shortcut_path_stubs:/usr/bin" \
    PATH_CAPTURE="$shortcut_path_capture" YTDL_TERMINAL="$shortcut_path_stubs/konsole" \
    "$SHORTCUT" audio 'https://example.invalid/path-test'
assert_eq "$shortcut_path_home/.local/bin" "$(head -n 1 "$shortcut_path_capture" | cut -d: -f1)" \
    'direct hotkey prefers user-local tools'
pass 'direct desktop shortcuts find yt-dlp installed under ~/.local/bin'

valid_url='https://www.youtube.com/watch?v=video123&list=PL123'
other_url='https://youtu.be/short123'

run_shortcut audio "$valid_url"
assert_launch audio "$valid_url" 'explicit URL and mode'
pass 'passes explicit URLs and mode as separate arguments'

PRIMARY_SELECTION=$other_url MPRIS_OUTPUT='no active media' \
    CLIPBOARD_SELECTION='' run_shortcut audio 'not a URL'
assert_launch audio "$other_url" 'invalid explicit URL fallback'
pass 'rejects plain-text explicit arguments before using the primary selection'

for non_youtube_url in 'https://soundcloud.com/example/track' 'https://vimeo.com/12345'; do
    run_shortcut video "$non_youtube_url"
    assert_launch video "$non_youtube_url" 'non-YouTube explicit URL'
done
pass 'launches arbitrary safe HTTP(S) sites without a hold flag'

for terminal_spec in \
    'ptyxis --' 'kgx --' 'gnome-terminal --' 'xfce4-terminal -x' \
    'mate-terminal --' 'tilix -e' 'alacritty -e' 'kitty -e' \
    'xterm -e' 'x-terminal-emulator -e'; do
    terminal=${terminal_spec%% *}
    separator=${terminal_spec#* }
    add_terminal_stub "$terminal"
    rm -f "$CALL_ARGS" "$CALL_TERMINAL"
    YTDL_TERMINAL=$terminal run_shortcut cut 'https://vimeo.com/12345'
    assert_eq "$terminal" "$(<"$CALL_TERMINAL")" "$terminal override selection"
    assert_terminal_args "$terminal" "$separator" cut 'https://vimeo.com/12345' "$terminal argv"
done
pass 'uses the required argv shape for every supported terminal emulator'

system_package_dir="$TMP/usr/lib/firefox-youtube-downloader"
mkdir -p "$system_package_dir" "$TMP/system-package-home"
cp -- "$SHORTCUT" "$system_package_dir/yt-dlp-shortcut.sh"
cp -- "$SOURCE_WRAPPER" "$system_package_dir/yt-dlp-wrapper.py"
rm -f -- "$CALL_ARGS"
HOME="$TMP/system-package-home" YTDL_TERMINAL=konsole \
    "$system_package_dir/yt-dlp-shortcut.sh" audio "$valid_url"
mapfile -t package_args < "$CALL_ARGS"
assert_eq "$system_package_dir/yt-dlp-wrapper.py" "${package_args[1]:-}" \
    'system package shortcut resolves its sibling wrapper'
pass 'system package shortcut uses the wrapper installed beside it'

for unsafe_url in \
    'file:///etc/passwd' \
    'javascript:alert(1)' \
    'ftp://example.com/file' \
    'https://user:pass@example.com/x' \
    'https://example.com../x' \
    'plain text' \
    $'https://example.com/a\tb'; do
    if run_shortcut audio "$unsafe_url" > "$TMP/unsafe.out" 2>&1; then
        fail "unsafe URL unexpectedly succeeded: $unsafe_url"
    fi
    [[ ! -e "$CALL_ARGS" ]] || fail "unsafe URL launched a terminal: $unsafe_url"
done
pass 'rejects unsafe schemes, userinfo, whitespace, and plain text'

run_shortcut audio --bogus "$valid_url"
assert_launch audio "$valid_url" 'option-like first argument fallback'
pass 'treats unknown option-like arguments as invalid candidates and uses the next valid URL'

symlink_home="$TMP/symlink-home"
outside_directory="$TMP/outside-destination"
mkdir -p "$symlink_home/.local/bin" "$symlink_home/.local/share/applications" "$outside_directory"
ln -s "$outside_directory" "$symlink_home/.local/bin/ytdl_meta.py"
if HOME="$symlink_home" "$INSTALLER" --install > "$TMP/symlink.out" 2>&1; then
    fail 'installer unexpectedly accepted a symlink to a directory destination'
fi
[[ ! -e "$symlink_home/.local/bin/yt-dlp-wrapper.py" ]] \
    || fail 'installer wrote earlier files before detecting a symlinked directory destination'
[[ -z "$(find "$outside_directory" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || fail 'installer wrote through a symlink-to-directory destination'
assert_file_contains "$TMP/symlink.out" 'is a directory' 'symlink destination conflict report'
pass 'installer rejects symlink-to-directory destinations before writing through them'

run_shortcut audio 'gopher://example.com/x' "$valid_url"
assert_launch audio "$valid_url" 'unsupported-scheme first candidate fallback'
pass 'unsupported-scheme first candidate falls through to the next valid URL'

PRIMARY_SELECTION=$other_url \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut audio 'not a URL' 'gopher://example.com/x'
assert_launch audio "$other_url" 'all-invalid candidates fallback'
pass 'all-invalid candidates fall through to the primary selection'

shell_payload="https://www.youtube.com/watch?v=1&title=O'Brien&next=\$(touch\${IFS}$TMP/injected)"
run_shortcut video "$shell_payload"
assert_launch video "$shell_payload" 'shell metacharacter URL'
[[ ! -e "$TMP/injected" ]] || fail 'URL data was evaluated by a shell'
pass 'preserves apostrophes, ampersands, and shell-like payloads without evaluation'

PRIMARY_SELECTION=$other_url MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut audio "$valid_url"
assert_launch audio "$valid_url" 'explicit URL precedence'
pass 'valid explicit URL takes precedence over all fallbacks'

run_shortcut audio 'not a URL' "$valid_url"
assert_launch audio "$valid_url" 'invalid first candidate fallback'
pass 'invalid first candidate falls through to valid second candidate'

run_shortcut audio '' "$other_url"
assert_launch audio "$other_url" 'empty first candidate fallback'
pass 'empty first candidate falls through to valid second candidate'

run_shortcut audio "$valid_url" "$other_url"
assert_launch audio "$valid_url" 'first valid candidate ordering'
pass 'first valid candidate wins over a different valid second candidate'

second_payload="https://www.youtube.com/watch?v=2&title=O'Brien&x=1"
run_shortcut video 'not a URL' "$second_payload"
assert_launch video "$second_payload" 'second candidate shell metacharacters'
[[ ! -e "$TMP/injected" ]] || fail 'second-candidate URL data was evaluated by a shell'
pass 'second candidate preserves apostrophes and ampersands without evaluation'

if PRIMARY_SELECTION='not a URL' MPRIS_OUTPUT='not a URL' CLIPBOARD_SELECTION='file:///etc/passwd' \
    run_shortcut audio 'not a URL' 'gopher://example.com/x' > "$TMP/invalid.out" 2>&1; then
    fail 'all-invalid candidates unexpectedly succeeded'
fi
[[ ! -e "$CALL_ARGS" ]] || fail 'all-invalid candidates launched a terminal'
pass 'all-invalid candidates remain fail-closed when no fallback URL is valid'

PRIMARY_SELECTION=$other_url MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut video
assert_launch video "$other_url" 'primary selection precedence'
pass 'valid primary selection takes precedence over MPRIS and clipboard'

PRIMARY_SELECTION='https://youtube.com.evil.invalid/watch?v=bad' \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut cut
assert_launch cut 'https://youtube.com.evil.invalid/watch?v=bad' 'non-YouTube primary selection'
pass 'accepts safe non-YouTube primary-selection URLs'

WAYLAND_DISPLAY=wayland-test WL_PRIMARY_SELECTION='https://vimeo.com/wayland-primary' \
    PRIMARY_SELECTION="$other_url" MPRIS_OUTPUT='not a URL' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut audio
assert_launch audio 'https://vimeo.com/wayland-primary' 'Wayland primary selection priority'
pass 'prefers wl-paste for primary selection under Wayland'

PRIMARY_SELECTION='not a URL' \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut cut
assert_launch cut 'https://www.youtube.com/watch?v=mpris123' 'MPRIS fallback'
pass 'uses MPRIS after invalid primary selection and extracts xesam:url'

live_mpris_url='https://www.youtube.com/watch?v=WQF8jqYn7xw'
PRIMARY_SELECTION='not a URL' \
    MPRIS_OUTPUT="xesam:url: $live_mpris_url" \
    CLIPBOARD_SELECTION="$valid_url" run_shortcut video
assert_launch video "$live_mpris_url" 'plain-text qdbus MPRIS output'
pass 'extracts a plain-text xesam:url field from qdbus6 metadata'

PRIMARY_SELECTION='not a URL' MPRIS_OUTPUT='no active media' \
    CLIPBOARD_SELECTION="$other_url" run_shortcut audio
assert_launch audio "$other_url" 'clipboard fallback'
pass 'uses validated clipboard after invalid primary and MPRIS values'

PRIMARY_SELECTION='not a URL' MPRIS_OUTPUT='not a URL' \
    CLIPBOARD_SELECTION='https://soundcloud.com/example/track' run_shortcut audio
assert_launch audio 'https://soundcloud.com/example/track' 'non-YouTube clipboard URL'
pass 'accepts safe non-YouTube clipboard URLs'

PRIMARY_SELECTION='not a URL' \
    MPRIS_OUTPUT='not a URL' \
    CLIPBOARD_SELECTION='file:///etc/passwd' run_shortcut audio && fail 'invalid fallback URLs unexpectedly launched'
[[ ! -e "$CALL_ARGS" ]] || fail 'invalid primary, MPRIS, and clipboard values launched the wrapper'
pass 'does not launch when every fallback URL is invalid'

make_x11_path() {
    local dir=$1 terminal=$2
    mkdir -p "$dir"
    ln -sf "$(command -v bash)" "$dir/bash"
    ln -sf "$(command -v python3)" "$dir/python3"
    for command_name in notify-send xclip playerctl "$terminal"; do
        cat > "$dir/$command_name" <<'STUB'
#!/usr/bin/env bash
name=${0##*/}
if [[ $name == xclip ]]; then
    case " $* " in
        *' primary '*) printf '%s' "${PRIMARY_SELECTION:-}" ;;
        *) printf '%s' "${CLIPBOARD_SELECTION:-}" ;;
    esac
elif [[ $name == playerctl ]]; then
    [[ ${1:-} == metadata && ${2:-} == xesam:url && -n ${MPRIS_OUTPUT:-} ]] || exit 1
    printf '%s\n' "$MPRIS_OUTPUT"
elif [[ $name == notify-send ]]; then
    exit 0
else
    printf '%s\n' "$@" > "$CALL_ARGS"
    printf '%s\n' "$name" > "$TMP/terminal-name"
fi
STUB
        chmod +x "$dir/$command_name"
    done
}

x11_gnome_bin="$TMP/x11-gnome-bin"
make_x11_path "$x11_gnome_bin" gnome-terminal
rm -f "$CALL_ARGS"
env -u WAYLAND_DISPLAY -u YTDL_TERMINAL \
    PATH="$x11_gnome_bin" HOME="$TMP/home" XDG_CURRENT_DESKTOP=GNOME \
    PRIMARY_SELECTION='' MPRIS_OUTPUT='https://soundcloud.com/example/track' \
    CLIPBOARD_SELECTION='' CALL_ARGS="$CALL_ARGS" TMP="$TMP" \
    "$SHORTCUT" video
assert_eq gnome-terminal "$(<"$TMP/terminal-name")" 'GNOME terminal selection'
assert_terminal_args gnome-terminal -- video 'https://soundcloud.com/example/track' 'X11 gnome fallback'
pass 'uses xclip and playerctl with gnome-terminal when Wayland tools and Konsole are absent'

x11_kgx_bin="$TMP/x11-kgx-bin"
make_x11_path "$x11_kgx_bin" kgx
rm -f "$CALL_ARGS"
env -u WAYLAND_DISPLAY -u YTDL_TERMINAL \
    PATH="$x11_kgx_bin" HOME="$TMP/home" XDG_CURRENT_DESKTOP=GNOME \
    PRIMARY_SELECTION='https://vimeo.com/12345' MPRIS_OUTPUT='' \
    CLIPBOARD_SELECTION='' CALL_ARGS="$CALL_ARGS" TMP="$TMP" \
    "$SHORTCUT" audio
assert_eq kgx "$(<"$TMP/terminal-name")" 'GNOME kgx terminal fallback'
assert_terminal_args kgx -- audio 'https://vimeo.com/12345' 'X11 kgx fallback'
pass 'falls back to kgx and accepts non-YouTube X11 selection URLs'

x11_xsel_bin="$TMP/x11-xsel-bin"
make_x11_path "$x11_xsel_bin" gnome-terminal
rm -f "$x11_xsel_bin/xclip"
cat > "$x11_xsel_bin/xsel" <<'STUB'
#!/usr/bin/env bash
case " $* " in
    *' --primary '*) printf '%s' "${PRIMARY_SELECTION:-}" ;;
    *) printf '%s' "${CLIPBOARD_SELECTION:-}" ;;
esac
STUB
chmod +x "$x11_xsel_bin/xsel"
rm -f "$CALL_ARGS"
env -u WAYLAND_DISPLAY -u YTDL_TERMINAL \
    PATH="$x11_xsel_bin" HOME="$TMP/home" XDG_CURRENT_DESKTOP=GNOME \
    PRIMARY_SELECTION='not a URL' MPRIS_OUTPUT='' \
    CLIPBOARD_SELECTION='https://soundcloud.com/example/track' \
    CALL_ARGS="$CALL_ARGS" TMP="$TMP" \
    "$SHORTCUT" audio
assert_eq gnome-terminal "$(<"$TMP/terminal-name")" 'GNOME terminal with xsel fallback'
assert_terminal_args gnome-terminal -- audio 'https://soundcloud.com/example/track' 'X11 xsel fallback'
pass 'uses xsel after xclip is unavailable'

for desktop in \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-2.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-3.desktop"; do
    [[ -f "$desktop" ]] || fail "missing staged desktop entry: $desktop"
    desktop-file-validate "$desktop" || fail "invalid desktop entry: $desktop"
done
for desktop in \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-2.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-3.desktop"; do
    assert_file_contains "$desktop" 'Exec=/home/gratis01/.local/bin/yt-dlp-shortcut.sh ' 'absolute launcher Exec path'
done
pass 'staged desktop entries validate and use absolute launcher paths'

dry_home="$TMP/dry-home"
HOME="$dry_home" "$INSTALLER" > "$TMP/dry-run.out"
assert_file_contains "$TMP/dry-run.out" 'Dry run' 'installer dry-run message'
for planned_file in ytdl_config.py ytdl_meta.py ytdl_version.py yt-dlp-wrapper.py yt-dlp-shortcut.sh yt-dlp-native-host.py; do
    assert_file_contains "$TMP/dry-run.out" "$planned_file" "installer dry-run lists $planned_file"
done
assert_file_contains "$TMP/dry-run.out" '.mozilla/native-messaging-hosts/firefox_youtube_downloader.json' \
    'installer dry-run lists home native-messaging manifest'
assert_file_contains "$TMP/dry-run.out" '.config/mozilla/native-messaging-hosts/firefox_youtube_downloader.json' \
    'installer dry-run lists XDG native-messaging manifest'
assert_file_contains "$TMP/dry-run.out" 'dist/firefox-youtube-downloader.xpi' 'installer dry-run lists XPI target'
[[ ! -e "$dry_home/.local/bin" ]] || fail 'default installer invocation created the bin directory'
[[ ! -e "$dry_home/.local/share/applications" ]] || fail 'default installer invocation created the applications directory'
pass 'installer defaults to a no-write dry run'

install_home="$TMP/install-home"
mkdir -p "$install_home/.local/bin" "$install_home/.local/share/applications"
printf 'pre-existing shortcut\n' > "$install_home/.local/bin/yt-dlp-shortcut.sh"
HOME="$install_home" "$INSTALLER" --install > "$TMP/install.out"
cmp -s "$ROOT/bin/yt-dlp-shortcut.sh" "$install_home/.local/bin/yt-dlp-shortcut.sh" \
    || fail 'installer did not deploy the shortcut source'
backup=$(find "$install_home/.local/bin" -maxdepth 1 -name 'yt-dlp-shortcut.sh.bak.*' -print -quit)
[[ -n "$backup" ]] || fail 'installer did not back up the replaced shortcut'
assert_eq 'pre-existing shortcut' "$(<"$backup")" 'backup preserves the prior file'
[[ -x "$install_home/.local/bin/yt-dlp-shortcut.sh" ]] || fail 'installed shortcut is not executable'
[[ -f "$install_home/.local/bin/yt-dlp-wrapper.py" ]] || fail 'wrapper was not installed'
[[ -f "$install_home/.local/bin/ytdl_meta.py" ]] || fail 'metadata helper was not installed'
[[ -f "$install_home/.local/bin/ytdl_version.py" ]] || fail 'version helper was not installed'
assert_file_contains "$install_home/.local/share/applications/net.local.yt-dlp-shortcut.sh.desktop" \
    "Exec=$install_home/.local/bin/yt-dlp-shortcut.sh audio" 'installed desktop Exec path rewrite'
pass 'installer backs up replaced files and installs staged sources without a URI handler'

assert_installer_preflight_conflict() {
    local label=$1 home=$2 conflict_destination=$3 xdg_config_home=${4:-}
    local xpi_before xpi_existed=false
    if [[ -e "$ROOT/dist/firefox-youtube-downloader.xpi" ]]; then
        xpi_existed=true
        xpi_before=$(sha256sum "$ROOT/dist/firefox-youtube-downloader.xpi")
    fi
    mkdir -p -- "$conflict_destination"
    if HOME="$home" XDG_CONFIG_HOME="$xdg_config_home" "$INSTALLER" --install --yes > "$TMP/preflight.out" 2>&1; then
        fail "$label unexpectedly accepted a directory destination"
    fi
    assert_file_contains "$TMP/preflight.out" 'is a directory' "$label conflict report"
    [[ ! -e "$home/.local/bin" ]] || fail "$label wrote binaries before preflight completed"
    if $xpi_existed; then
        assert_eq "$xpi_before" "$(sha256sum "$ROOT/dist/firefox-youtube-downloader.xpi")" "$label did not rebuild XPI before preflight"
    else
        [[ ! -e "$ROOT/dist/firefox-youtube-downloader.xpi" ]] || fail "$label built XPI before preflight"
    fi
}

home_manifest_conflict_home="$TMP/home-manifest-conflict"
assert_installer_preflight_conflict 'home manifest preflight' "$home_manifest_conflict_home" \
    "$home_manifest_conflict_home/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json"
pass 'installer preflights home native-messaging manifest before writes or XPI build'

xdg_manifest_conflict_home="$TMP/xdg-manifest-conflict"
assert_installer_preflight_conflict 'XDG manifest preflight' "$xdg_manifest_conflict_home" \
    "$xdg_manifest_conflict_home/.config/mozilla/native-messaging-hosts/firefox_youtube_downloader.json" \
    "$xdg_manifest_conflict_home/.config"
pass 'installer preflights XDG native-messaging manifest before writes or XPI build'

plugin_config_conflict_home="$TMP/plugin-config-conflict"
assert_installer_preflight_conflict 'plugin config preflight' "$plugin_config_conflict_home" \
    "$plugin_config_conflict_home/.config/youtube-downloader/config.json"
pass 'installer preflights plugin config before writes or XPI build'

deduplicated_manifest_home="$TMP/deduplicated-manifest-home"
mkdir -p "$deduplicated_manifest_home/.config" "$deduplicated_manifest_home/.mozilla/native-messaging-hosts"
ln -s ../.mozilla "$deduplicated_manifest_home/.config/mozilla"
HOME="$deduplicated_manifest_home" XDG_CONFIG_HOME="$deduplicated_manifest_home/.config" \
    "$INSTALLER" --install --yes > "$TMP/deduplicated-manifest.out"
assert_eq 1 "$(grep -c 'Installed .*firefox_youtube_downloader.json' "$TMP/deduplicated-manifest.out")" \
    'deduplicated native-messaging manifest write count'
[[ -f "$deduplicated_manifest_home/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json" ]] \
    || fail 'deduplicated native-messaging manifest was not installed'
pass 'installer deduplicates native-messaging manifest destinations resolving to the same path'

config_home="$TMP/config-home"
mkdir -p "$config_home/.config/yt-dlp"
printf -- '--no-mtime\n-o ~/Downloads/%%(title)s.%%(ext)s\n' > "$config_home/.config/yt-dlp/config"
cp -- "$config_home/.config/yt-dlp/config" "$TMP/yt-dlp-config.orig"
HOME="$config_home" "$INSTALLER" --install > "$TMP/config-preserve.out"
cmp -s "$TMP/yt-dlp-config.orig" "$config_home/.config/yt-dlp/config" \
    || fail 'installer modified the pre-existing yt-dlp config'
pass 'installer preserves a pre-existing yt-dlp config byte-for-byte'

fresh_home="$TMP/fresh-home"
HOME="$fresh_home" "$INSTALLER" --install --yes > "$TMP/fresh-config.out"
[[ ! -e "$fresh_home/.config/yt-dlp/config" ]] \
    || fail 'installer created a yt-dlp config in a fresh HOME'
pass 'installer creates no yt-dlp config in a fresh HOME'

config_install_home="$TMP/config-install-home"
HOME="$config_install_home" "$INSTALLER" --install --yes > "$TMP/config-install.out"
python3 - "$config_install_home" <<'PY'
import json
import sys
from pathlib import Path

home = Path(sys.argv[1])
config = json.loads((home / ".config/youtube-downloader/config.json").read_text())
assert config == {
    "download_dir": "~/Music/Youtube Downloads",
    "video_download_dir": "~/Videos/Youtube Downloads",
    "verbose_output": False,
    "auto_tag": True,
    "rsgain": False,
    "audio_format": "best",
    "mp3_quality": "V0",
    "embed_thumbnail": True,
    "thumbnail_jpg": False,
    "channel_mode": "stereo",
    "long_audio_enabled": False,
    "long_audio_minutes": 30,
    "long_audio_dir": "~/Podcasts",
}, config
for manifest in (
    home / ".mozilla/native-messaging-hosts/firefox_youtube_downloader.json",
    home / ".config/mozilla/native-messaging-hosts/firefox_youtube_downloader.json",
):
    value = json.loads(manifest.read_text())
    assert value == {
        "name": "firefox_youtube_downloader",
        "description": "Native Messaging host for Huginn Downloader",
        "path": str(home / ".local/bin/yt-dlp-native-host.py"),
        "type": "stdio",
        "allowed_extensions": ["firefox-youtube-downloader@lakis01.github.io"],
    }, value
PY
[[ -s "$ROOT/dist/firefox-youtube-downloader.xpi" ]] || fail 'installer did not build the XPI'
python3 - "$ROOT/dist/firefox-youtube-downloader.xpi" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
PY
[[ ! -e "$config_install_home/.config/yt-dlp/config" ]] \
    || fail 'installer created a yt-dlp config during the fresh install'
pass 'fresh --yes install saves defaults, installs both manifests, builds XPI, and leaves yt-dlp config untouched'

interactive_home="$TMP/interactive-home"
python3 - "$INSTALLER" "$interactive_home" <<'PY'
import json
import os
import pty
import select
import subprocess
import sys
import time
from pathlib import Path

installer, home = sys.argv[1:]
environment = os.environ.copy()
environment["HOME"] = home
environment.pop("XDG_CONFIG_HOME", None)
master, slave = pty.openpty()
process = subprocess.Popen(
    [installer, "--install"], stdin=slave, stdout=slave, stderr=slave,
    env=environment, close_fds=True,
)
os.close(slave)
transcript = bytearray()
answers = [
    (b"[3] Custom path", b"2\n"),
    (b"Automatic tag extraction", b"n\n"),
    (b"ReplayGain", b"y\n"),
]
deadline = time.monotonic() + 45
try:
    for expected, answer in answers:
        while expected not in transcript:
            if time.monotonic() > deadline:
                raise AssertionError(f"installer did not prompt for {expected!r}: {transcript.decode(errors='replace')}")
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try:
                    transcript.extend(os.read(master, 4096))
                except OSError:
                    break
            if process.poll() is not None:
                break
        if expected not in transcript:
            raise AssertionError(f"installer exited before {expected!r}: {transcript.decode(errors='replace')}")
        os.write(master, answer)
    while process.poll() is None:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                transcript.extend(os.read(master, 4096))
            except OSError:
                break
    process.wait(timeout=5)
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)

output = transcript.decode(errors="replace")
if process.returncode != 0:
    raise AssertionError(f"interactive installer failed ({process.returncode}): {output}")
config = json.loads((Path(home) / ".config/youtube-downloader/config.json").read_text())
assert config == {
    "download_dir": "~/Downloads/Youtube",
    "video_download_dir": "~/Videos/Youtube Downloads",
    "verbose_output": False,
    "auto_tag": False,
    "rsgain": True,
    "audio_format": "best",
    "mp3_quality": "V0",
    "embed_thumbnail": True,
    "thumbnail_jpg": False,
    "channel_mode": "stereo",
    "long_audio_enabled": False,
    "long_audio_minutes": 30,
    "long_audio_dir": "~/Podcasts",
}, config
PY
pass 'interactive TTY installer accepts download-dir, auto-tag, and ReplayGain choices'

existing_ytdlp_home="$TMP/existing-ytdlp-home"
mkdir -p "$existing_ytdlp_home/.config/yt-dlp"
printf -- '--no-mtime\n-o ~/Archive/%%(title)s.%%(ext)s\n' > "$existing_ytdlp_home/.config/yt-dlp/config"
cp -- "$existing_ytdlp_home/.config/yt-dlp/config" "$TMP/existing-ytdlp.orig"
HOME="$existing_ytdlp_home" "$INSTALLER" --install --yes > "$TMP/existing-ytdlp.out"
cmp -s "$TMP/existing-ytdlp.orig" "$existing_ytdlp_home/.config/yt-dlp/config" \
    || fail 'installer modified the existing yt-dlp config with --yes'
python3 - "$existing_ytdlp_home/.config/youtube-downloader/config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
assert config["download_dir"] is None, config
assert config["video_download_dir"] == "~/Videos/Youtube Downloads", config
assert config["auto_tag"] is True, config
assert config["rsgain"] is False, config
assert config["audio_format"] == "best", config
assert config["mp3_quality"] == "V0", config
assert config["embed_thumbnail"] is True, config
assert config["thumbnail_jpg"] is False, config
assert config["channel_mode"] == "stereo", config
PY
HOME="$existing_ytdlp_home" "$INSTALLER" --install --yes \
    --download-dir=ytdlp-default --auto-tag=true --rsgain=true > "$TMP/existing-ytdlp-overrides.out"
python3 - "$existing_ytdlp_home/.config/youtube-downloader/config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)
assert config == {
    "download_dir": None,
    "video_download_dir": "~/Videos/Youtube Downloads",
    "verbose_output": False,
    "auto_tag": True,
    "rsgain": True,
    "audio_format": "best",
    "mp3_quality": "V0",
    "embed_thumbnail": True,
    "thumbnail_jpg": False,
    "channel_mode": "stereo",
    "long_audio_enabled": False,
    "long_audio_minutes": 30,
    "long_audio_dir": "~/Podcasts",
}, config
PY
cmp -s "$TMP/existing-ytdlp.orig" "$existing_ytdlp_home/.config/yt-dlp/config" \
    || fail 'installer modified existing yt-dlp config while applying overrides'
pass 'existing yt-dlp config remains byte-identical and ytdlp-default plus explicit flags are honored'

deps_home="$TMP/deps-home"
HOME="$deps_home" "$INSTALLER" --check-deps > "$TMP/check-deps.out"
assert_file_contains "$TMP/check-deps.out" 'Desktop session:' '--check-deps desktop detection'
assert_file_contains "$TMP/check-deps.out" 'Display server:' '--check-deps display detection'
assert_file_contains "$TMP/check-deps.out" 'Debian 13.7 (GNOME)' '--check-deps Debian instructions'
assert_file_contains "$TMP/check-deps.out" 'LMDE 7 (Cinnamon)' '--check-deps LMDE instructions'
assert_file_contains "$TMP/check-deps.out" 'Core media dependencies (probe only):' \
    '--check-deps explains media dependency probe'
if grep -Fq 'sudo apt install yt-dlp' "$TMP/check-deps.out"; then
    fail '--check-deps must not suggest replacing an existing yt-dlp command'
fi
grep -Eq 'All requested dependencies are available|Missing dependencies; apt packages to install:' \
    "$TMP/check-deps.out" || fail '--check-deps includes the read-only apt helper result'
[[ ! -e "$deps_home/.local" && ! -e "$deps_home/.config" && ! -e "$deps_home/.mozilla" ]] \
    || fail '--check-deps wrote files into HOME'
pass '--check-deps detects session prerequisites without writing files'

macos_stubs="$TMP/macos-stubs"
mkdir -p "$macos_stubs"
cat > "$macos_stubs/uname" <<'STUB'
#!/usr/bin/env bash
printf 'Darwin\n'
STUB
chmod +x "$macos_stubs/uname"
macos_home="$TMP/macos-home"
HOME="$macos_home" PATH="$macos_stubs:$PATH" "$INSTALLER" --check-deps > "$TMP/macos-check-deps.out"
assert_file_contains "$TMP/macos-check-deps.out" 'brew install yt-dlp ffmpeg python pillow' \
    'macOS dependency suggestions'
assert_file_contains "$TMP/macos-check-deps.out" 'Optional ReplayGain: brew install rsgain' \
    'macOS rsgain remains optional'
HOME="$macos_home" PATH="$macos_stubs:$PATH" "$INSTALLER" --install --yes > "$TMP/macos-install.out"
macos_manifest="$macos_home/Library/Application Support/Mozilla/NativeMessagingHosts/firefox_youtube_downloader.json"
[[ -f "$macos_manifest" ]] || fail 'macOS Native Messaging manifest was not installed'
[[ ! -e "$macos_home/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json" ]] \
    || fail 'macOS installer also wrote the Linux native-messaging manifest'
[[ ! -e "$macos_home/.local/share/applications" ]] \
    || fail 'macOS installer staged Linux desktop entries'
pass 'macOS check-deps and install use the Library manifest without Linux desktop staging'

apt_stubs="$TMP/apt-stubs"
mkdir -p "$apt_stubs"
cat > "$apt_stubs/apt-get" <<'STUB'
#!/bin/bash
printf 'apt-get %s\n' "$*" >> "$APT_LOG"
STUB
cat > "$apt_stubs/sudo" <<'STUB'
#!/bin/bash
printf 'sudo %s\n' "$*" >> "${SUDO_LOG:-/dev/null}"
exec "$@"
STUB
cat > "$apt_stubs/python3" <<'STUB'
#!/bin/bash
if [[ ${1:-} == -c ]]; then
    case ${2:-} in
        *'import mutagen'*) [[ " ${PYTHON_MODULES:-} " == *' mutagen '* ]] ;;
        *'import PIL'*) [[ " ${PYTHON_MODULES:-} " == *' PIL '* ]] ;;
        *) exit 1 ;;
    esac
fi
STUB
chmod +x "$apt_stubs/apt-get" "$apt_stubs/sudo" "$apt_stubs/python3"

apt_log="$TMP/apt-helper.log"
sudo_log="$TMP/apt-sudo.log"
for command_name in yt-dlp ffmpeg ffprobe rsgain; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$apt_stubs/$command_name"
    chmod +x "$apt_stubs/$command_name"
done
: > "$apt_log"
: > "$sudo_log"
if ! HOME="$TMP/apt-home" PYTHON_MODULES='mutagen PIL' APT_LOG="$apt_log" \
    SUDO_LOG="$sudo_log" PATH="$apt_stubs" /bin/bash \
    "$ROOT/scripts/install-apt-deps.sh" --check > "$TMP/apt-all-present.out" 2>&1; then
    fail 'apt helper checks an already satisfied dependency set'
fi
[[ ! -s "$apt_log" && ! -s "$sudo_log" ]] \
    || fail 'apt helper used apt or sudo when all requested dependencies were present'
if ! HOME="$TMP/apt-home" PYTHON_MODULES='mutagen PIL' APT_LOG="$apt_log" \
    SUDO_LOG="$sudo_log" PATH="$apt_stubs" /bin/bash \
    "$ROOT/scripts/install-apt-deps.sh" > "$TMP/apt-all-present-install.out" 2>&1; then
    fail 'apt helper skips installation when dependencies are already present'
fi
[[ ! -s "$apt_log" && ! -s "$sudo_log" ]] \
    || fail 'apt helper used apt or sudo during an all-present install'
pass 'apt dependency check and install are no-ops when complete'

: > "$apt_log"
: > "$sudo_log"
rm -f "$apt_stubs/yt-dlp" "$apt_stubs/ffprobe"
if ! HOME="$TMP/apt-home" PYTHON_MODULES='PIL' APT_LOG="$apt_log" \
    SUDO_LOG="$sudo_log" PATH="$apt_stubs" /bin/bash \
    "$ROOT/scripts/install-apt-deps.sh" --check > "$TMP/apt-partial-check.out" 2>&1; then
    fail 'apt helper checks a partially missing dependency set'
fi
assert_file_contains "$TMP/apt-partial-check.out" 'yt-dlp ffmpeg python3-mutagen' \
    'apt package mapping for missing yt-dlp, ffprobe and Mutagen'
[[ ! -s "$apt_log" && ! -s "$sudo_log" ]] \
    || fail '--check invoked a package manager'
if ! HOME="$TMP/apt-home" PYTHON_MODULES='PIL' APT_LOG="$apt_log" \
    SUDO_LOG="$sudo_log" PATH="$apt_stubs" /bin/bash \
    "$ROOT/scripts/install-apt-deps.sh" > "$TMP/apt-helper.out" 2>&1; then
    fail 'apt helper installs only missing dependencies'
fi
assert_file_contains "$apt_log" 'apt-get update' 'apt metadata refresh when dependencies are missing'
assert_file_contains "$apt_log" 'apt-get install -y yt-dlp ffmpeg python3-mutagen' \
    'apt helper installs only missing packages and maps ffprobe to ffmpeg'
! grep -q 'python3-pil\|rsgain' "$apt_log" \
    || fail 'apt helper installed already-present Pillow or opt-in rsgain'
pass 'apt helper maps missing commands/imports and installs only missing packages'

rm -f "$apt_stubs/rsgain"
: > "$apt_log"
for command_name in yt-dlp ffprobe; do
    printf '#!/bin/bash\nexit 0\n' > "$apt_stubs/$command_name"
    chmod +x "$apt_stubs/$command_name"
done
if ! HOME="$TMP/apt-home" PYTHON_MODULES='mutagen PIL' APT_LOG="$apt_log" \
    SUDO_LOG="$sudo_log" PATH="$apt_stubs" /bin/bash \
    "$ROOT/scripts/install-apt-deps.sh" --with-rsgain > "$TMP/apt-rsgain.out" 2>&1; then
    fail 'apt helper accepts the explicit optional rsgain choice'
fi
assert_file_contains "$apt_log" 'install -y rsgain' 'rsgain is included only by the explicit helper option'
pass 'apt helper includes rsgain only when explicitly requested'

rm -f "$apt_stubs/python3" "$apt_stubs/yt-dlp" "$apt_stubs/ffmpeg" \
    "$apt_stubs/ffprobe" "$apt_stubs/rsgain"

apt_default_log="$TMP/apt-default-install.log"
HOME="$TMP/no-apt-home" APT_LOG="$apt_default_log" PATH="$apt_stubs:$PATH" \
    "$INSTALLER" --install --yes > "$TMP/no-apt-install.out"
[[ ! -e "$apt_default_log" ]] || fail 'ordinary install invoked apt without --install-deps'
pass 'ordinary --install never invokes apt implicitly'

for invalid_args in '--install-deps' '--install --with-rsgain' '--with-rsgain --install-deps'; do
    if HOME="$TMP/invalid-apt-home" APT_LOG="$apt_default_log" PATH="$apt_stubs:$PATH" \
        "$INSTALLER" $invalid_args > "$TMP/invalid-apt-flags.out" 2>&1; then
        fail "invalid apt dependency flags unexpectedly succeeded: $invalid_args"
    fi
done
pass 'apt dependency flags require --install and --with-rsgain requires --install-deps'

. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
    *" debian "*|*" ubuntu "*)
        for optional in false true; do
            apt_log="$TMP/apt-installer-$optional.log"
            install_home="$TMP/apt-installer-home-$optional"
            args=(--install --yes --install-deps)
            [[ $optional == true ]] && args+=(--with-rsgain)
            HOME="$install_home" APT_LOG="$apt_log" PATH="$apt_stubs:$PATH" \
                "$INSTALLER" "${args[@]}" > "$TMP/apt-installer-$optional.out"
            if [[ -s $apt_log ]]; then
                assert_file_contains "$apt_log" 'apt-get update' \
                    "apt update runs only when dependencies are missing ($optional)"
                if [[ $optional == true ]]; then
                    assert_file_contains "$apt_log" 'rsgain' 'installer includes missing opt-in rsgain'
                else
                    ! grep -q 'rsgain' "$apt_log" || fail 'default installer unexpectedly included rsgain'
                fi
            else
                assert_file_contains "$TMP/apt-installer-$optional.out" \
                    'All requested dependencies are available.' \
                    "installer reports complete dependencies ($optional)"
            fi
        done
        pass 'Debian-family installer uses explicit apt opt-in and optional rsgain'
        ;;
    *)
        apt_reject_log="$TMP/apt-reject.log"
        if HOME="$TMP/unsupported-apt-home" APT_LOG="$apt_reject_log" PATH="$apt_stubs:$PATH" \
            "$INSTALLER" --install --yes --install-deps > "$TMP/unsupported-apt.out" 2>&1; then
            fail 'non-Debian installer unexpectedly accepted --install-deps'
        fi
        assert_file_contains "$TMP/unsupported-apt.out" 'only supported on Debian-family Linux' \
            'non-Debian dependency-installation message'
        [[ ! -e "$apt_reject_log" ]] || fail 'non-Debian installer invoked apt-get'
        pass 'non-Debian installer refuses apt dependency installation without invoking apt'
        ;;
esac

printf '1..%s\n' "$PASS"
