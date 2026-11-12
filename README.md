# Firefox YouTube Downloader

A Firefox add-on and local companion for sending YouTube pages, links, and
watch-page controls to `yt-dlp` for audio, video, or a selected audio cut. The
add-on supplies the interface; a small Native Messaging host and `yt-dlp` run
on your own computer. The companion is not bundled with the add-on, and the
extension sends nothing to a project-owned server.

## What you need

- Firefox 115 or newer.
- The signed XPI from a GitHub Release or the [Firefox Add-ons listing](https://addons.mozilla.org/).
- The matching local companion installed with `install.sh` (Linux/macOS) or
  `install.ps1` (Windows).
- `yt-dlp` and FFmpeg installed locally. Python 3, Mutagen, and Pillow enable
  audio tagging and cover art; `rsgain` is optional and only used when
  ReplayGain is enabled.

The extension provides a YouTube right-click submenu, watch-page Audio/Video/
Cut controls, and a settings popup. It uses Firefox Native Messaging to pass a
user-selected mode and URL to the local companion. It does not download media
itself.

## Install the extension

Install the **signed** XPI from the latest GitHub Release using Firefox's
**Add-ons and themes → gear → Install Add-on From File…** action, or install
the Listed version from AMO if the store listing is available. An unsigned
local build is for development and cannot be permanently installed in normal
Firefox Release. Developers can build it with `./scripts/build-xpi.sh` and
temporarily load it from `about:debugging`.

Project maintainers can create signed Unlisted release files or publish a
Listed AMO add-on by following [docs/AMO-PUBLISHING.md](docs/AMO-PUBLISHING.md).

## Install the local companion

Clone this repository, install the platform dependencies below, then run the
OS-specific companion installer from the repository directory. Each installer
has a dry-run default or a `--check-deps` command; neither installs operating
system packages automatically.

### Debian 13.7 (GNOME, Wayland)

```sh
sudo apt update
sudo apt install yt-dlp ffmpeg rsgain python3 python3-mutagen python3-pil \
  nodejs libnotify-bin wl-clipboard playerctl qt6-tools-dev-tools \
  xdg-utils desktop-file-utils
git clone https://github.com/Lakis01/Firefox-Youtube-Downloader-Plugin.git
cd Firefox-Youtube-Downloader-Plugin
./install.sh --check-deps
./install.sh --install --yes
```

GNOME normally includes `kgx` or `ptyxis`; `gnome-terminal` is only needed if
you want it as an additional terminal option. `wl-clipboard` supplies
Wayland clipboard/primary-selection support.

### LMDE 7 (Cinnamon, X11)

```sh
sudo apt update
sudo apt install yt-dlp ffmpeg rsgain python3 python3-mutagen python3-pil \
  nodejs gnome-terminal libnotify-bin xclip xsel playerctl \
  qt6-tools-dev-tools xdg-utils desktop-file-utils
git clone https://github.com/Lakis01/Firefox-Youtube-Downloader-Plugin.git
cd Firefox-Youtube-Downloader-Plugin
./install.sh --check-deps
./install.sh --install --yes
```

`xclip` or `xsel` supports clipboard access, and `gnome-terminal` is the
suggested terminal. ReplayGain is optional; omit `rsgain` if you do not use it.

### General Linux

Install `yt-dlp`, FFmpeg, Python 3 with Mutagen and Pillow, and a terminal
emulator. For the full shortcut integration, also install the clipboard and
MPRIS tools for your session: `wl-clipboard` on Wayland; `xclip` or `xsel` on
X11; and `playerctl` (or KDE's `qdbus6`). `rsgain` is optional. On Debian-based
systems, for example:

```sh
sudo apt install yt-dlp ffmpeg python3 python3-mutagen python3-pil \
  xdg-utils desktop-file-utils
# Optional features / desktop integrations:
sudo apt install rsgain wl-clipboard xclip xsel playerctl
git clone https://github.com/Lakis01/Firefox-Youtube-Downloader-Plugin.git
cd Firefox-Youtube-Downloader-Plugin
./install.sh --check-deps
./install.sh --install --yes
```

On Fedora, Arch, openSUSE, or another distribution, use its package manager and
package names instead. `./install.sh --check-deps` prints the detected desktop
session and Debian/LMDE package suggestions; it never runs the package manager.
The installer stages user-level binaries under `~/.local/bin`, the Firefox
Native Messaging manifest, desktop shortcuts, and the `yt-dlp://` handler.

### macOS

Install Homebrew if needed, then install the command-line dependencies and
Python libraries. `rsgain` is optional:

```sh
brew install yt-dlp ffmpeg python pillow
python3 -m pip install --user mutagen
# Optional ReplayGain support, if available for your Homebrew setup:
brew install rsgain
git clone https://github.com/Lakis01/Firefox-Youtube-Downloader-Plugin.git
cd Firefox-Youtube-Downloader-Plugin
./install.sh --check-deps
./install.sh --install --yes
```

The macOS installer writes the Native Messaging manifest to
`~/Library/Application Support/Mozilla/NativeMessagingHosts/` and skips
Linux-only desktop/MIME registration. If Homebrew Python refuses a `--user`
package install because of its environment policy, install Mutagen using your
preferred Python package workflow for that Homebrew interpreter. Then install
the signed XPI from a GitHub Release or AMO in Firefox.

### Windows 10/11

Open PowerShell, install Python 3 and the local command-line dependencies, then
run the companion installer. Scoop or another trusted package source can be
used for optional `rsgain` if desired.

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg.Shared
winget install Python.Python.3.12
py -3 -m pip install mutagen Pillow
git clone https://github.com/Lakis01/Firefox-Youtube-Downloader-Plugin.git
cd Firefox-Youtube-Downloader-Plugin
.\install.ps1 --check-deps
.\install.ps1 --install --yes
```

The installer copies the Python host and helpers to
`%LOCALAPPDATA%\FirefoxYouTubeDownloader\bin`, writes its manifest and config
under `%LOCALAPPDATA%\FirefoxYouTubeDownloader`, registers the host for the
current Windows user, and builds `dist\firefox-youtube-downloader.xpi` without
requiring Bash. Install the **AMO-signed** XPI in Firefox separately; the local
installer's XPI is an unsigned build artifact. If Windows Terminal (`wt.exe`)
is installed, downloads open there; otherwise the host opens a new console.

## Configuration and installer behavior

The popup stores these options in the user's config file:

| Option | Fresh-install default | Meaning |
| --- | --- | --- |
| Download directory | `~/Music/Youtube Downloads` when yt-dlp has no config; otherwise use yt-dlp's configured path | Choose another directory or select `ytdlp-default`. |
| Automatic tagging | On | Extract description metadata and attach cover art to audio/cut downloads. |
| ReplayGain | Off | Run `rsgain` on finished audio/cut files. |

Linux/macOS use `~/.config/youtube-downloader/config.json` or the equivalent
under `$XDG_CONFIG_HOME`. Windows uses
`%LOCALAPPDATA%\FirefoxYouTubeDownloader\config.json` unless
`XDG_CONFIG_HOME` is explicitly set. The installers never create or modify an
existing yt-dlp config such as `~/.config/yt-dlp/config` or
`%APPDATA%\yt-dlp\config`.

On Linux and macOS, a plain `./install.sh` invocation is a no-write dry run;
`./install.sh --install` applies the install. On Windows,
`py -3 install.py` is the no-write dry run and
`py -3 install.py --install --yes` applies it (or use the PowerShell wrapper).
`--download-dir=ytdlp-default`, `--auto-tag=true|false`, and
`--rsgain=true|false` set values explicitly. Existing plugin configuration is
preserved unless an option is provided.

## Shortcuts and desktop integration

On Linux, the shortcut resolves a URL in this order: explicit argument,
primary selection, active media URL (MPRIS), then clipboard. It chooses a
supported terminal automatically; set `YTDL_TERMINAL` to select one. A GNOME
or Cinnamon custom keyboard shortcut can run:

```sh
~/.local/bin/yt-dlp-shortcut.sh audio
~/.local/bin/yt-dlp-shortcut.sh video
~/.local/bin/yt-dlp-shortcut.sh cut
```

On macOS the native host opens Terminal for the download and removes its
temporary launcher script after launch. On Windows it prefers Windows Terminal
and falls back to a separate console window.

KDE users can assign the installed **YouTube Audio Download**, **YouTube Video
Download**, and **YouTube Interactive Cut Audio** launchers under **System
Settings → Shortcuts → Custom Shortcuts**. On GNOME or Cinnamon, add the three
commands above under **Settings → Keyboard → Keyboard Shortcuts → Custom
Shortcuts** and choose unused key combinations.

## Retiring the previous Firefox setup

Only do this after verifying the new add-on and companion. Remove or disable
only the old YouTube downloader userscript in Tampermonkey; keep unrelated
scripts and Tampermonkey if still needed. External Application Launcher is a
separate old add-on: remove it only if no other extension uses its native host.
The `ff2mpv` / *Play in MPV* add-on is separate and unaffected. Do not remove
it as part of this migration.

The Linux installer keeps timestamped `.bak.*` copies beside replaced files.
To roll back, restore those files, remove only the Native Messaging manifests
that did not exist before the install, and restore the previous `yt-dlp://`
desktop association if needed. It does not modify Firefox profiles or yt-dlp
configuration.

## Troubleshooting

- **Popup says the companion is unavailable:** confirm the Native Messaging
  manifest and host path. Re-run the matching companion installer.
- **Download command is missing:** confirm `yt-dlp` and FFmpeg are on `PATH`;
  open a new terminal after installing them.
- **Tagging fails:** verify Python can import Mutagen and Pillow. Disable
  automatic tagging in settings if you do not need it.
- **No ReplayGain stage:** install `rsgain` and turn its option on.
- **Terminal or clipboard fallback is unavailable on Linux:** install a
  supported terminal and the clipboard/MPRIS tool matching Wayland or X11.

## Verification

Run these checks from the repository root. Counts should be updated with the
suite if tests are added or removed:

```sh
python3 -m unittest discover -s tests -v  # 121 Python tests
bash tests/test_shortcut.sh               # 43 launcher/installer checks
node tests/test_firefox_extension.js
node tests/test_youtube_buttons.js
bash scripts/build-xpi.sh
bash -n install.sh bin/yt-dlp-shortcut.sh scripts/build-xpi.sh tests/test_shortcut.sh
desktop-file-validate desktop/*.desktop
./install.sh
python3 install.py
git diff --check
```

The Node fixtures do not replace a final manual check in Firefox on each target
OS. Test a signed XPI, companion install, menu action, watch-page controls, and
popup settings before releasing.
