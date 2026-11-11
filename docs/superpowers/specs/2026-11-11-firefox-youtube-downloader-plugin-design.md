# Firefox YouTube Downloader Plugin — Design Specification

## Intent

Evolve the YouTube Downloader workflow into **Firefox YouTube Downloader Plugin**: a shareable, self-contained Firefox WebExtension paired with a cross-desktop Linux companion (`yt-dlp`, `mutagen`, optional `rsgain`) that replaces both Tampermonkey and External Application Launcher, runs fast single-pass downloads with clear stage progress bars and single-keypress terminal dismissal, and ports cleanly to **Debian 13.7 (GNOME)** and **LMDE 7 (Cinnamon)** without risking existing Firefox or `yt-dlp` configurations.

## Goals

1. **Unified Firefox Extension (`extension/` -> `dist/firefox-youtube-downloader.xpi`):**
   - **Right-click context menu:** One parent item **`YouTube Downloader`** (with custom SVG plugin icon) containing three child items with crisp authored SVG icons: **`Audio`**, **`Video`**, and **`Cut Audio`**. Resolves hovered YouTube lockup cards and video-preview overlays via `elementsFromPoint()` before falling back to `linkUrl` / `pageUrl`. Also works when right-clicking YouTube links on non-YouTube pages.
   - **Watch-page UI (Style A — Segmented YouTube Pill):** Cohesive tonal segmented pill (`[ Audio | Video | Cut ]` with authored 24×24 YouTube-weight SVG icons and subtle vertical dividers) mounted between `#owner` and `#actions` in `ytd-watch-metadata #top-row`. Uses YouTube's true action-button tonal surface (`rgba(255, 255, 255, 0.1)` / `#272727` in dark mode, `rgba(0, 0, 0, 0.05)` / `#f2f2f2` in light mode; `rgba(255, 255, 255, 0.2)` / `rgba(0, 0, 0, 0.1)` hover) instead of `--yt-spec-badge-chip-background`.
   - **Toolbar Popup & Preferences UI:** Displays Native Host connection status (with copyable setup instructions when not yet installed) and live toggles for **Automatic Tag Extraction**, **ReplayGain (`rsgain`) Normalization**, and **Default Download Path**, synced with `~/.config/youtube-downloader/config.json`.
   - **Native Messaging Host (`bin/yt-dlp-native-host.py`):** Launches downloads directly without browser `"Open external application?"` confirmation dialogs and reads/updates plugin settings safely.

2. **Tagging & Cover Art Refinements (`bin/ytdl_meta.py`):**
   - **Never retain `language` tags:** Strip `language` and `lang` in Vorbis comments (Opus/Ogg), `TLAN` and `TXXX:LANGUAGE`/`TXXX:LANG` in ID3 (MP3), and `elng` plus `----:com.apple.iTunes:LANGUAGE`/`LANG` in MP4/M4A — including when `auto_tag` is disabled.
   - **Cover art:** Keep universal `image/jpeg` (`quality=88, optimize=True`) for audio files so M4A (`MP4Cover`), Opus, and MP3 remain 100% compatible across hardware/mobile/desktop players while reducing cover payload by ~25%. Keep WebP thumbnails for MKV video mode.
   - Preserve `parse_info()` return keys required by `~/.local/bin/yt-to-forerunner`.

3. **Fast Single-Pass Execution, Stage Progress UI & Any-Key Terminal Close (`bin/yt-dlp-wrapper.py`):**
   - **Eliminate duplicate network extraction:**
     - `audio` mode performs a **single** `yt-dlp` invocation (`--print-to-file after_move:filepath`), eliminating the pre-flight `--dump-json` network call.
     - Whenever the target URL is a YouTube host (`youtube.com`, `youtu.be`, `youtube-nocookie.com` and subdomains), pass `--ies youtube,youtube:tab` to skip loading unrelated extractors.
     - `cut` mode fetches metadata once to display duration before timestamp prompts, saves the JSON to a temporary file, and passes `--load-info-json` to the cut download (falling back to URL only if `yt-dlp` requires re-extraction).
   - **Transparent stages & live progress bars:**
     - Keep `yt-dlp` `stdout` connected directly to the terminal TTY with `--progress` so real-time download progress bars render smoothly.
     - Show numbered stage banners and progress indicators for each active phase:
       - Audio / Cut: `Downloading audio` → `Automatic tag extraction & cover art` (when `auto_tag=true`, printing detected *Official Art Track* vs *Standard Track* summary) → `ReplayGain normalization (rsgain: analyzing -> applying)` (when `rsgain=true`, showing live `rsgain` scan bar and printed `dB` gain result).
       - Video: `Downloading video & audio streams` → explicit `[Merging streams into MKV & embedding metadata/thumbnail...]` post-processor stage notice → `Complete`.
   - **Press any key to close:** When invoked with `--wait-keypress` on an interactive TTY, prompt `Press any key to close...` in raw/cbreak terminal mode on both success and failure so any single keypress immediately exits and closes the terminal window. Remove `konsole --hold`.

4. **General `yt-dlp` Site Support on Shortcut/CLI & Safe Cross-Distro Porting (`bin/yt-dlp-shortcut.sh`, `bin/ytdl_config.py`, `install.sh`):**
   - **Source A (Keyboard shortcut & CLI):** Accept any safe `http://` or `https://` URL (no control chars, whitespace, or userinfo; `--` passed before URLs) so any `yt-dlp`-supported site works via shortcut or terminal. Keep Firefox extension triggers scoped to YouTube / YouTube Music / `youtu.be`.
   - **User Preferences (`~/.config/youtube-downloader/config.json`):**
     - `download_dir`: `null` (defer to existing `~/.config/yt-dlp/config`, or `~/Music/Youtube Downloads` when no `yt-dlp` config exists) or an explicit directory path passed via `-P`.
     - `auto_tag`: `true` by default on fresh installs and on the current machine.
     - `rsgain`: `false` by default on fresh installs; **`true` on the current machine**.
   - **Interactive Fresh-Install Setup & Cross-Desktop Runtime:**
     - Never create, overwrite, or modify `~/.config/yt-dlp/config`.
     - On fresh `./install.sh --install` (interactive TTY without existing plugin config), prompt for:
       1. Default download path (`~/Music/Youtube Downloads` default, `~/Downloads/Youtube` quick option, custom path, plus `Keep existing yt-dlp config` when `~/.config/yt-dlp/config` exists).
       2. Automatic tag extraction (`[Y/n]`, default `Y`).
       3. ReplayGain normalization via `rsgain` (`[y/N]`, default `N`).
     - Support non-interactive CLI flags (`--download-dir=...`, `--auto-tag=true|false`, `--rsgain=true|false`, `--yes`, `--check-deps`).
     - Auto-detect desktop terminal (`konsole`, `ptyxis`, `kgx`, `gnome-terminal`, `xfce4-terminal`, `x-terminal-emulator`), clipboard/selection (`wl-paste` on Wayland, `xclip`/`xsel` on X11), and MPRIS (`playerctl` + `qdbus6`/`qdbus`).
     - Install the Firefox Native Messaging manifest to both `~/.mozilla/native-messaging-hosts/` and `${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts/`.

5. **Repository Rename & Cleanup Documentation:**
   - Rename private GitHub repository `Lakis01/Graphical-Youtube-Downloader` to `Lakis01/Firefox-Youtube-Downloader-Plugin` and update local git `origin`.
   - Document sharing/AMO signing (`web-ext sign`), Debian 13.7 GNOME & LMDE 7 Cinnamon porting, and post-migration cleanup of External Application Launcher + Tampermonkey.

## Non-Goals & Anti-Goals

- **Anti-goal:** Modifying Firefox SQLite/IndexedDB/`prefs.js` files or modifying `~/.config/yt-dlp/config`.
- **Anti-goal:** Using emoji or Unicode characters in place of authored SVG icons in the web UI or context menus.
- **Anti-goal:** Transcoding embedded audio cover art to WebP (breaks MP4 `covr` and hardware/mobile players).
- **Non-goal:** Bypassing YouTube channel memberships or DRM.

## Approaches Considered

1. **Selected — Unified Firefox WebExtension + User-Level Python Native Messaging Host:**
   - *Pros:* Replaces both Tampermonkey and External Application Launcher with one `.xpi`; crisp icons on parent and child right-click entries; segmented YouTube watch-page pill with zero browser URI confirmation dialogs; built-in Firefox popup for toggling `auto_tag` and `rsgain`; clean user-level install across KDE, GNOME, and Cinnamon.
   - *Cons:* Standard Firefox Release requires free Mozilla AMO signing (`web-ext sign`) for permanent installation (Nightly and Debian/LMDE `firefox-esr` also support developer/policy installs).
2. **Rejected — Three Separate Extensions for Top-Level Context Menu Items:**
   - *Reason:* Requires building, signing, and installing three `.xpi` packages just to avoid a single `YouTube Downloader ▸` submenu.
3. **Rejected — Keeping External Application Launcher + Tampermonkey:**
   - *Reason:* Requires two third-party extensions, an external Node.js native host, manual JSON imports, missing submenu icons, and browser `yt-dlp://` popups.
