# Firefox-Youtube-Downloader-Plugin

A Firefox WebExtension and user-level Linux companion for downloading YouTube
audio, video, or a selected audio cut with `yt-dlp`. The extension provides a
YouTube context-menu submenu, watch-page download controls, and a settings
popup. Its Python Native Messaging host starts the existing download wrapper
without an external-application confirmation dialog.

The source tree is self-contained: build the XPI from `extension/`, then
install the companion with `install.sh`. The installer uses per-user paths and
does not modify Firefox profiles or `~/.config/yt-dlp/config`.

## Features

- Context menu: **YouTube Downloader → Audio / Video / Cut Audio**.
- Watch-page segmented controls for Audio, Video, and Cut.
- Popup settings for default download directory, automatic tag extraction,
  and ReplayGain (`rsgain`) normalization.
- A standard Native Messaging host and manifests for Firefox.
- Fast, single-pass audio downloads, stage/progress reporting, metadata and
  cover-art handling, and optional ReplayGain processing.
- Desktop-independent shortcut launcher with terminal, clipboard, selection,
  and MPRIS auto-detection.

## Prerequisites and porting

The installer can inspect the current desktop and session without installing
anything:

```sh
./install.sh --check-deps
```

It reports available and missing commands and prints these suggested package
commands. Review the list first; the installer never runs `apt` for you:

```sh
# Debian 13.7 (GNOME)
sudo apt install yt-dlp ffmpeg rsgain python3 python3-mutagen python3-pil nodejs gnome-terminal libnotify-bin wl-clipboard xclip xsel playerctl qt6-tools-dev-tools xdg-utils desktop-file-utils

# LMDE 7 (Cinnamon)
sudo apt install yt-dlp ffmpeg rsgain python3 python3-mutagen python3-pil nodejs gnome-terminal libnotify-bin wl-clipboard xclip xsel playerctl qt6-tools-dev-tools xdg-utils desktop-file-utils
```

The downloader also needs `ffmpeg`, Python 3 with `mutagen` and Pillow,
`yt-dlp`, and a JavaScript runtime such as Node.js. `rsgain` is optional; it
is needed only when ReplayGain normalization is enabled. `desktop-file-utils`
provides `desktop-file-validate`. Package availability and names can vary
between Debian-family releases, so use the package manager for your release.

Runtime selection is automatic:

- **Terminals:** prefers `konsole` on KDE, `ptyxis`, `kgx`, then
  `gnome-terminal` on GNOME, and `xfce4-terminal` or `mate-terminal` for those
  desktops. It falls back through supported installed terminals. Set
  `YTDL_TERMINAL` to choose a specific supported executable.
- **Wayland:** uses `wl-paste` for clipboard and primary selection.
- **X11:** uses `xclip` or `xsel` for clipboard and primary selection.
- **MPRIS:** reads the active media URL with `playerctl`, then tries the
  `qdbus6` / `qdbus` Plasma Browser Integration interface.

For a new GNOME or Cinnamon keyboard shortcut, open **Settings → Keyboard →
Keyboard Shortcuts → Custom Shortcuts** (the wording can vary by release) and
add these commands, assigning any unused key combinations:

```sh
~/.local/bin/yt-dlp-shortcut.sh audio
~/.local/bin/yt-dlp-shortcut.sh video
~/.local/bin/yt-dlp-shortcut.sh cut
```

KDE users can add the installed **YouTube Audio Download**, **YouTube Video
Download**, and **YouTube Interactive Cut Audio** desktop launchers under
**System Settings → Keyboard → Shortcuts → Custom Shortcuts**. The shortcut
uses the active media URL first, then selection/clipboard fallbacks; use the
Firefox context menu for a specific hovered video card.

## Build and install

### 1. Install the Firefox extension

Build `dist/firefox-youtube-downloader.xpi` from the checked-out extension
source:

```sh
./scripts/build-xpi.sh
```

Firefox Release requires Mozilla signing before a packaged XPI can be
permanently installed. Signing through Mozilla Add-ons (AMO) is free. For an
AMO-distributed release, submit the add-on for signing; for an unlisted XPI,
use Mozilla's signing API with `web-ext` and your AMO API credentials, for
example:

```sh
npx web-ext sign --source-dir extension \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

The signed XPI can then be installed in Firefox Release. `npx web-ext sign`
uses the free signing service; it does not mean an add-on is automatically
listed in the AMO catalog. Firefox Nightly is useful for development and
temporary loading through `about:debugging`. Debian's `firefox-esr` and LMDE's
Firefox ESR can also be used for development/policy-managed installs; a
normally distributed, permanent XPI should still be Mozilla-signed.

### 2. Install the Linux companion

Preview all planned paths first. A plain invocation is a no-write dry run:

```sh
./install.sh
```

Then install the companion and configure a fresh setup:

```sh
./install.sh --install
```

On a fresh interactive terminal, the installer asks for a download directory,
automatic tagging, and ReplayGain. For automation, `--yes` accepts defaults;
individual settings can be supplied explicitly:

```sh
./install.sh --install --yes \
  --download-dir='~/Downloads/Youtube' --auto-tag=true --rsgain=false
```

Use `--download-dir=ytdlp-default` to defer to an existing yt-dlp config.
The installer makes timestamped `.bak.*` copies of replaced files, builds the
XPI, installs binaries and desktop entries under `~/.local`, writes the
Firefox Native Messaging manifest to both `~/.mozilla/native-messaging-hosts/`
and `${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts/`, and
registers the `yt-dlp://` URI desktop handler. If both manifest paths resolve
to the same file, it installs that file once.

Before writing anything or building the XPI, it checks all target files for
directory conflicts, including symlinks that resolve to directories. The
default dry run does not build the XPI or write configuration, binaries,
manifests, desktop entries, or MIME registrations.

## Configuration

The companion and extension share
`~/.config/youtube-downloader/config.json` (or the equivalent under
`$XDG_CONFIG_HOME`). Supported fields:

| Field | Fresh-install default | Meaning |
| --- | --- | --- |
| `download_dir` | `"~/Music/Youtube Downloads"` when there is no yt-dlp config; otherwise `null` | A custom path, or `null` to let yt-dlp choose its configured path. `~/Downloads/Youtube` is the other interactive quick choice. |
| `auto_tag` | `true` | Extract description-derived tags and attach cover art for audio/cut downloads. |
| `rsgain` | `false` | Run `rsgain` on finished audio/cut files. |

An explicit `--download-dir=ytdlp-default` stores `null`. If the plugin config
already exists, `--install` preserves it byte-for-byte unless one or more
configuration flags are provided. The installer never creates or modifies
`~/.config/yt-dlp/config` (including when it exists already). If that yt-dlp
config exists and the plugin config is fresh, the default `download_dir` is
`null` so yt-dlp's existing destination rules remain in control.

## Retiring the previous Firefox setup

Do this only after confirming the new XPI and native host work. Keep unrelated
Firefox extensions and userscripts.

### External Application Launcher

- [ ] Remove the old **External Application Launcher** add-on from Firefox.
- [ ] Retire its native host only after checking no other extension uses it.
      Its shared system files are commonly located at
      `/usr/share/com.add0n.node` and
      `/usr/share/com.add0n.node/com.add0n.node.json`; remove the package or
      files through the mechanism that installed them rather than deleting
      files blindly.
- [ ] Remove the old YouTube application entries/settings from the add-on if
      you are keeping it for another purpose.

**`ff2mpv` / *Play in MPV* is separate and unaffected.** Do not uninstall its
Firefox add-on or native host as part of retiring External Application
Launcher.

### Tampermonkey

- [ ] Verify the new extension's on-page controls on a YouTube watch page.
- [ ] Remove or disable only the old YouTube downloader userscript in
      Tampermonkey. Keep Tampermonkey and unrelated scripts if you still use
      them.
- [ ] Uninstall Tampermonkey only if it is no longer needed for any other
      userscripts.

## Troubleshooting and rollback

- **No host connection in the popup:** confirm both manifests exist, their
  `path` points to `~/.local/bin/yt-dlp-native-host.py`, and that file is
  executable. Re-run `./install.sh --install` if needed.
- **Shortcut reports no supported terminal:** install a supported terminal or
  set `YTDL_TERMINAL` to its executable name.
- **No clipboard/MPRIS fallback:** install the matching Wayland/X11 clipboard
  tool and `playerctl` (or Plasma's `qdbus6` / `qdbus` integration).
- **Missing tag or ReplayGain stage:** check `auto_tag` and `rsgain` in the
  plugin popup/config and verify `mutagen`, Pillow, and `rsgain` are installed.

Replaced files are backed up beside their destinations as
`<name>.bak.<YYYYMMDD-HHMMSS>` (with a numeric suffix if necessary). To roll
back, restore the exact backup files and remove the two Native Messaging
manifests if they did not previously exist. Restore the previous
`x-scheme-handler/yt-dlp` association in your desktop's default-application
settings if necessary. No Firefox profile database or yt-dlp config needs to
be edited.

## Verification

Run the repository checks from its root:

```sh
python3 -m unittest discover -s tests -v  # 71 tests
bash tests/test_shortcut.sh               # 42 checks: launcher, desktop entries, installer
node tests/test_firefox_extension.js
node tests/test_youtube_buttons.js
bash -n install.sh bin/yt-dlp-shortcut.sh tests/test_shortcut.sh
desktop-file-validate desktop/*.desktop
./install.sh                              # no-write dry run
```

The browser-facing fixtures are Node DOM tests; manually confirm installation
and behavior in Firefox on the target desktop after porting.
