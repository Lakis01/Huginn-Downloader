#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHORTCUT="$ROOT/bin/yt-dlp-shortcut.sh"
INSTALLER="$ROOT/install.sh"
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT

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
cat > "$TMP/stubs/xdg-mime" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$XDG_MIME_ARGS"
STUB
chmod +x "$TMP/stubs/"*

export PATH="$TMP/stubs:$PATH"
export CALL_ARGS="$TMP/call-args"
export CALL_TERMINAL="$TMP/call-terminal"
export XDG_MIME_ARGS="$TMP/xdg-mime-args"

run_shortcut() {
    rm -f -- "$CALL_ARGS"
    HOME="$TMP/home" YTDL_TERMINAL=${YTDL_TERMINAL:-konsole} "$SHORTCUT" "$@"
}

assert_launch() {
    local mode=$1 url=$2 label=$3
    [[ -f "$CALL_ARGS" ]] || fail "$label (terminal was not launched)"
    mapfile -t args < "$CALL_ARGS"
    assert_eq '-e' "${args[0]:-}" "$label: Konsole execute option"
    assert_eq "$TMP/home/.local/bin/yt-dlp-wrapper.py" "${args[1]:-}" "$label: wrapper path"
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
        assert_eq "$TMP/home/.local/bin/yt-dlp-wrapper.py" "${args[1]:-}" "$label: wrapper path"
        assert_eq '--wait-keypress' "${args[2]:-}" "$label: wait-keypress option"
        assert_eq "$mode" "${args[3]:-}" "$label: mode argument"
        assert_eq "$url" "${args[4]:-}" "$label: URL argument"
        assert_eq 5 "${#args[@]}" "$label: argument count"
    else
        assert_eq '--' "${args[0]:-}" "$label: terminal separator"
        assert_eq "$TMP/home/.local/bin/yt-dlp-wrapper.py" "${args[1]:-}" "$label: wrapper path"
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

uri_url='https://www.youtube.com/watch?v=uri123&list=PL456'
uri="yt-dlp://cut?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Duri123%26list%3DPL456"
run_shortcut --uri "$uri"
assert_launch cut "$uri_url" 'URI decoding'
pass 'decodes supported yt-dlp URI mode and URL'

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

for malformed_uri in \
    'yt-dlp://cut?url=%ZZ' \
    'yt-dlp://audio?url=https%3A%2F%2Fexample.invalid%2Fwatch' \
    'yt-dlp://unknown?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dbad'; do
    if PRIMARY_SELECTION=$other_url \
        MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
        CLIPBOARD_SELECTION="$valid_url" \
        run_shortcut --uri "$malformed_uri" > "$TMP/malformed.out" 2>&1; then
            fail "malformed explicit URI unexpectedly succeeded: $malformed_uri"
    fi
    [[ ! -e "$CALL_ARGS" ]] || fail "malformed explicit URI launched Konsole: $malformed_uri"
    assert_file_contains "$TMP/malformed.out" 'Invalid yt-dlp URI' 'explicit URI error report'
done
for malformed_uri in 'yt-dlp://cut?url=%ZZ' 'yt-dlp://bad-mode?url=https%3A%2F%2Fwww.youtube.com'; do
    if PRIMARY_SELECTION=$other_url \
        MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
        CLIPBOARD_SELECTION="$valid_url" \
        run_shortcut "$malformed_uri" > "$TMP/malformed.out" 2>&1; then
            fail "malformed custom-scheme URI unexpectedly succeeded: $malformed_uri"
    fi
    [[ ! -e "$CALL_ARGS" ]] || fail "malformed custom URI launched Konsole: $malformed_uri"
done
pass 'rejects malformed explicit and custom-scheme URIs without trying valid fallbacks'

if PRIMARY_SELECTION=$other_url \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" \
    run_shortcut --uri '' > "$TMP/malformed.out" 2>&1; then
    fail 'empty explicit URI unexpectedly succeeded'
fi
[[ ! -e "$CALL_ARGS" ]] || fail 'empty explicit URI launched Konsole'
assert_file_contains "$TMP/malformed.out" 'Invalid yt-dlp URI' 'empty URI error report'
pass 'empty explicit URI remains fail-closed without trying valid fallbacks'

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

if PRIMARY_SELECTION=$other_url \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" \
    run_shortcut audio 'yt-dlp://cut?url=%ZZ' "$valid_url" > "$TMP/malformed.out" 2>&1; then
    fail 'invalid custom-scheme first candidate unexpectedly succeeded'
fi
[[ ! -e "$CALL_ARGS" ]] || fail 'invalid custom-scheme first candidate launched Konsole'
assert_file_contains "$TMP/malformed.out" 'Invalid yt-dlp URI' 'candidate URI error report'
pass 'invalid custom-scheme first candidate remains fail-closed'

if PRIMARY_SELECTION=$other_url \
    MPRIS_OUTPUT='QString "xesam:url": "https://www.youtube.com/watch?v=mpris123"' \
    CLIPBOARD_SELECTION="$valid_url" \
    run_shortcut audio 'not a URL' 'yt-dlp://cut?url=%ZZ' > "$TMP/malformed-second.out" 2>&1; then
    fail 'invalid custom-scheme second candidate unexpectedly succeeded'
fi
[[ ! -e "$CALL_ARGS" ]] || fail 'invalid custom-scheme second candidate launched Konsole'
assert_file_contains "$TMP/malformed-second.out" 'Invalid yt-dlp URI' 'second candidate URI error report'
pass 'malformed second custom-scheme candidate remains fail-closed after an invalid first'

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
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-3.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-uri.desktop"; do
    [[ -f "$desktop" ]] || fail "missing staged desktop entry: $desktop"
    desktop-file-validate "$desktop" || fail "invalid desktop entry: $desktop"
done
for desktop in \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-2.desktop" \
    "$ROOT/desktop/net.local.yt-dlp-shortcut.sh-3.desktop"; do
    assert_file_contains "$desktop" 'Exec=/home/gratis01/.local/bin/yt-dlp-shortcut.sh ' 'absolute launcher Exec path'
done
assert_file_contains "$ROOT/desktop/net.local.yt-dlp-uri.desktop" 'MimeType=x-scheme-handler/yt-dlp;' 'URI scheme registration'
pass 'staged desktop entries validate and use absolute launcher paths'

dry_home="$TMP/dry-home"
HOME="$dry_home" "$INSTALLER" > "$TMP/dry-run.out"
assert_file_contains "$TMP/dry-run.out" 'Dry run' 'installer dry-run message'
[[ ! -e "$dry_home/.local/bin" ]] || fail 'default installer invocation created the bin directory'
[[ ! -e "$dry_home/.local/share/applications" ]] || fail 'default installer invocation created the applications directory'
[[ ! -e "$XDG_MIME_ARGS" ]] || fail 'default installer invocation registered a MIME handler'
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
assert_file_contains "$install_home/.local/share/applications/net.local.yt-dlp-shortcut.sh.desktop" \
    "Exec=$install_home/.local/bin/yt-dlp-shortcut.sh audio" 'installed desktop Exec path rewrite'
assert_eq 'default' "$(sed -n '1p' "$XDG_MIME_ARGS")" 'xdg-mime subcommand'
assert_eq 'net.local.yt-dlp-uri.desktop' "$(sed -n '2p' "$XDG_MIME_ARGS")" 'xdg-mime desktop id'
assert_eq 'x-scheme-handler/yt-dlp' "$(sed -n '3p' "$XDG_MIME_ARGS")" 'xdg-mime scheme'
pass 'installer backs up replaced files, installs staged sources, and registers the URI handler'

conflict_home="$TMP/conflict-home"
mkdir -p "$conflict_home/.local/share/applications/net.local.yt-dlp-uri.desktop"
if HOME="$conflict_home" "$INSTALLER" --install > "$TMP/conflict.out" 2>&1; then
    fail 'installer unexpectedly accepted a directory where the URI desktop file belongs'
fi
[[ ! -e "$conflict_home/.local/bin" ]] || fail 'installer wrote binaries before detecting a destination conflict'
assert_file_contains "$TMP/conflict.out" 'is a directory' 'installer destination conflict report'
pass 'installer detects conflicting destination directories before making changes'

config_home="$TMP/config-home"
mkdir -p "$config_home/.config/yt-dlp"
printf -- '--no-mtime\n-o ~/Downloads/%%(title)s.%%(ext)s\n' > "$config_home/.config/yt-dlp/config"
cp -- "$config_home/.config/yt-dlp/config" "$TMP/yt-dlp-config.orig"
HOME="$config_home" "$INSTALLER" --install > "$TMP/config-preserve.out"
cmp -s "$TMP/yt-dlp-config.orig" "$config_home/.config/yt-dlp/config" \
    || fail 'installer modified the pre-existing yt-dlp config'
pass 'installer preserves a pre-existing yt-dlp config byte-for-byte'

fresh_home="$TMP/fresh-home"
HOME="$fresh_home" "$INSTALLER" --install > "$TMP/fresh-config.out"
[[ ! -e "$fresh_home/.config/yt-dlp/config" ]] \
    || fail 'installer created a yt-dlp config in a fresh HOME'
pass 'installer creates no yt-dlp config in a fresh HOME'

printf '1..%s\n' "$PASS"
