# Firefox YouTube Downloader Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the downloader into the shareable **Firefox YouTube Downloader Plugin** (`.xpi` + cross-desktop Linux native host & CLI) with a segmented `#272727` YouTube watch-page pill, icon-equipped right-click submenu, single-pass downloads with live progress bars, any-key terminal close, no `language` tags, configurable `download_dir`/`auto_tag`/`rsgain`, and safe Debian 13.7 GNOME / LMDE 7 Cinnamon portability.

**Architecture:** `bin/ytdl_config.py` stores plugin preferences in `~/.config/youtube-downloader/config.json` without ever touching `~/.config/yt-dlp/config`. `bin/yt-dlp-wrapper.py` runs single-pass `yt-dlp` downloads with TTY progress bars (`--print-to-file`), strips unwanted `language` tags via `bin/ytdl_meta.py`, runs `rsgain` conditionally, and waits for a single raw keypress when `--wait-keypress` is set. `extension/` provides a Manifest V2 Firefox WebExtension (`YouTube Downloader` context submenu with SVG icons, Style A segmented watch-page pill, and settings/onboarding popup) talking over stdio Native Messaging to `bin/yt-dlp-native-host.py`, which invokes the cross-desktop `bin/yt-dlp-shortcut.sh`.

**Tech Stack:** Python 3 (`mutagen`, `Pillow`, stdlib `termios`/`tty`/`struct`), Bash, Firefox WebExtensions API (Manifest V2, SVG icons, Native Messaging), `yt-dlp`, `ffmpeg`, `rsgain`, Node.js (for test fixtures).

**Spec:** `docs/superpowers/specs/2026-11-11-firefox-youtube-downloader-plugin-design.md` and `docs/superpowers/specs/2026-11-10-youtube-downloader-design.md`.

## Global Constraints

- Never create, modify, or overwrite `~/.config/yt-dlp/config`.
- Never modify Firefox profile databases (`places.sqlite`, `prefs.js`, IndexedDB); register Native Messaging exclusively via standalone JSON manifests in `~/.mozilla/native-messaging-hosts/` and `${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts/`.
- Never leave `language` or `lang` tags in tagged or untagged audio outputs (`language`/`lang` in Vorbis, `TLAN`/`TXXX:LANGUAGE`/`TXXX:LANG` in ID3, `elng`/`----:com.apple.iTunes:LANGUAGE`/`LANG` in MP4).
- Keep embedded audio cover art as `image/jpeg` (`quality=88, optimize=True`); never embed WebP in audio containers. Keep WebP thumbnails for MKV video downloads.
- Preserve `parse_info()` return keys (`artist`, `title`, `album`, `date`, `composer`, `is_tagged`, `duration`, plus structured credits) for `yt-to-forerunner` compatibility.
- Fresh-install defaults in `~/.config/youtube-downloader/config.json`: `auto_tag: true`, `rsgain: false`, and `download_dir: "~/Music/Youtube Downloads"` when no `~/.config/yt-dlp/config` exists (`null` when `~/.config/yt-dlp/config` exists). On the user's current machine, deploy with `auto_tag: true`, `rsgain: true`, `download_dir: null`.
- Never use emoji or Unicode glyphs as icons in the Firefox extension UI, popup, or context menu; use authored SVGs in consistent stroke/fill geometry, and never use kicker/eyebrow labels above headings.
- Pass `--` before URLs in every `yt-dlp` invocation and pass all process arguments as separate array items without shell evaluation.

## Review Focus

1. **Stream-copied `language` metadata survives when `auto_tag=false`:** `yt-dlp --embed-metadata` / FFmpeg copies `language=eng` from YouTube's audio stream even when custom Art Track parsing is disabled; `strip_language_tags()` must clean the output in both `auto_tag=true` and `auto_tag=false` paths (Task 1 & Task 2 tests).
2. **Single-pass `audio` mode auth retry without losing TTY progress:** Using `--print-to-file after_move:filepath` keeps `stdout` on the TTY while `stderr` is captured/echoed so an auth-classified failure still retries once with `--cookies-from-browser firefox` and never leaks a Python traceback (Task 2 tests).
3. **Non-YouTube URLs via shortcut/CLI vs hostile strings:** Shortcut/CLI (Source A) accepts valid `https://soundcloud.com/...` or `https://vimeo.com/...` URLs without passing `--ies youtube,youtube:tab`, while rejecting `file:///etc/passwd`, `javascript:alert(1)`, `https://user:pass@example.com`, whitespace/control chars, and `-o` flag-like strings (Task 2 & Task 3 tests).
4. **Native Messaging framing & detached terminal spawn:** `yt-dlp-native-host.py` must frame 4-byte native-endian length headers accurately, reject oversized or malformed payloads cleanly, and spawn `yt-dlp-shortcut.sh` in a new session with closed stdio pipes so Firefox never hangs waiting for the terminal window to close (Task 3 tests).
5. **Watch-page pill contrast & SPA resilience:** The segmented pill must use explicit `rgba(255, 255, 255, 0.1)` (`#272727`) dark / `rgba(0, 0, 0, 0.05)` (`#f2f2f2`) light surfaces (never `--yt-spec-badge-chip-background`), avoid duplicating on YouTube SPA navigation, and show clear feedback if the native host is not yet installed (Task 4 tests + live Firefox MCP visual verification).

---

### Task 1: Plugin Config Module, Language-Tag Stripping, and Optimized JPEG Covers

**Files:**
- Create: `bin/ytdl_config.py`
- Modify: `bin/ytdl_meta.py`
- Create: `tests/test_ytdl_config.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces in `bin/ytdl_config.py`:
  - ` DEFAULT_FRESH_DOWNLOAD_DIR = "~/Music/Youtube Downloads"`
  - `ALT_FRESH_DOWNLOAD_DIR = "~/Downloads/Youtube"`
  - `config_path(env: Mapping[str, str] | None = None) -> Path` (`${XDG_CONFIG_HOME:-$HOME/.config}/youtube-downloader/config.json`)
  - `ytdlp_config_exists(env: Mapping[str, str] | None = None) -> bool` (checks `${XDG_CONFIG_HOME:-$HOME/.config}/yt-dlp/config` and `~/.yt-dlp.conf`)
  - `load_config(env: Mapping[str, str] | None = None) -> dict` returning `{"download_dir": str | None, "auto_tag": bool, "rsgain": bool}`
  - `save_config(config: Mapping[str, Any], env: Mapping[str, str] | None = None) -> Path` (validates types, writes atomically)
  - `effective_download_dir(config: Mapping[str, Any], env: Mapping[str, str] | None = None) -> str | None` (expanded `download_dir` if set; `None` if `download_dir is None` and `ytdlp_config_exists(env)`; expanded `DEFAULT_FRESH_DOWNLOAD_DIR` if `download_dir is None` and not `ytdlp_config_exists(env)`)
- Produces in `bin/ytdl_meta.py`:
  - `strip_language_tags(filepath: str) -> None` (removes `language`/`lang` in Opus/Ogg Vorbis, `TLAN` + `TXXX:LANGUAGE`/`LANG` in MP3, `elng` + `----:com.apple.iTunes:LANGUAGE`/`LANG` in M4A/MP4; no-op for unsupported extensions)
  - `tag_audio_file()` strips those language tags automatically and embeds `image/jpeg` covers encoded with `quality=88, optimize=True`.

- [ ] **Step 1: Write failing tests in `tests/test_ytdl_config.py` and `tests/test_ytdl_meta.py`**
  - Test `load_config` defaults (`auto_tag=True`, `rsgain=False`, `download_dir=None`), `save_config` round-trip and validation errors on bad types, and `effective_download_dir` both when `.config/yt-dlp/config` exists (`None`) and when absent (`<HOME>/Music/Youtube Downloads`).
  - Seed `LANGUAGE=eng` and `LANG=en` on Opus, `TLAN=eng` + `TXXX:LANGUAGE=en` on MP3, and `elng` / `----:com.apple.iTunes:LANGUAGE` on M4A; assert both `tag_audio_file()` and standalone `strip_language_tags()` remove them completely.
  - Assert `_cover_image_bytes` returns `("image/jpeg")` and never WebP, with valid JPEG SOI/EOI markers.
- [ ] **Step 2: Run tests to verify RED**
  - Run: `python3 -m unittest tests/test_ytdl_config.py tests/test_ytdl_meta.py -v`
- [ ] **Step 3: Implement `bin/ytdl_config.py` and update `bin/ytdl_meta.py`**
- [ ] **Step 4: Run full Python test suite to verify GREEN**
  - Run: `python3 -m unittest discover -s tests -v`
- [ ] **Step 5: Commit**

---

### Task 2: Single-Pass Wrapper, Stage Progress UI, Config Integration, and Any-Key Close

**Files:**
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Consumes: `ytdl_config.load_config`, `ytdl_config.effective_download_dir`, `ytdl_meta.parse_info`, `ytdl_meta.sanitize_filename`, `ytdl_meta.tag_audio_file`, `ytdl_meta.strip_language_tags`.
- Produces:
  - `is_youtube_url(url: str) -> bool`
  - `wait_for_keypress(prompt: str = "\nPress any key to close...") -> None` (uses `termios` + `tty.setcbreak` to read 1 char when `sys.stdin.isatty()`, restoring termios attributes in `finally`)
  - `finalize_audio_download(media_path, filename_suffix="", config=None) -> str` (preserves backward-compatible 1- and 2-arg calls; prints track-type summary & tagging stage, respects `config["auto_tag"]` and `config["rsgain"]`, reads back and prints applied ReplayGain dB when `rsgain` runs)
  - `download_audio(url, config=None) -> str`:
    - Single `yt-dlp` pass (no pre-flight `--dump-json`!), using `--print-to-file after_move:filepath <temp_path>`, `--progress`, `--ies youtube,youtube:tab` when `is_youtube_url(url)` is True, `-P <effective_dir>` when `effective_download_dir(cfg)` is non-None, and `--` before `url`.
    - Keeps `stdout` attached to terminal TTY (`stdout=None`) while capturing `stderr` (`stderr=subprocess.PIPE`, printing stderr on failure) so auth-classified failures retry once with `--cookies-from-browser firefox`.
    - When `auto_tag=True`: writes `.info.json` + jpg thumbnail, then runs `finalize_audio_download`.
    - When `auto_tag=False`: passes `--embed-metadata --embed-thumbnail --convert-thumbnails jpg -o "%(title)s.%(ext)s"`, runs `strip_language_tags(filepath)`, and conditionally runs `rsgain` if `config["rsgain"]` is True.
  - `interactive_cut(url, config=None) -> str`:
    - Fetches metadata once for duration prompt, writes raw info JSON to a temp file, passes `--load-info-json <temp_info_path>` to the cut `yt-dlp` command (retrying with `-- <url>` if `--load-info-json` fails), and finalizes with `config`.
  - `download_video(url, config=None) -> None`:
    - Prints `[1/2] Downloading video & audio streams...`, passes `--progress` and `--print "post_process:[Stage] Merging video + audio into MKV & embedding thumbnail/metadata..."`, `-P <effective_dir>` if set, `--ies youtube,youtube:tab` if YouTube, `--` before `url`, retries Firefox cookies once on auth error, and prints `[2/2] Video download complete.`.
  - `main(argv=None) -> int`:
    - Accepts optional `--wait-keypress` flag before `[audio|video|cut] <url>`. Calls `wait_for_keypress()` in a `finally` block whenever `--wait-keypress` (or `YTDL_WAIT_KEYPRESS=1`) is active and `sys.stdin.isatty()` is True, on both return `0` and return `1`.

- [ ] **Step 1: Write failing wrapper tests in `tests/test_ytdl_meta.py`**
  - Assert `download_audio` makes **only 1** `yt-dlp` subprocess call (no `--dump-json`), passes `--print-to-file` instead of capturing `stdout`, passes `--ies youtube,youtube:tab` for YouTube URLs and omits `--ies` for `https://soundcloud.com/artist/track`, and passes `--` before the URL.
  - Assert `download_audio` still retries once with `--cookies-from-browser firefox` on an auth-classified failure.
  - Assert `auto_tag=False` skips `tag_audio_file` retagging, calls `strip_language_tags`, and honors `rsgain=False` vs `rsgain=True`.
  - Assert `rsgain=False` skips `rsgain` while `rsgain=True` invokes `["rsgain", "custom", "-s", "i", final_path]`.
  - Assert `main(["yt-dlp-wrapper.py", "--wait-keypress", "audio", url])` invokes `wait_for_keypress()` on both success and `_YtDlpError` failure when `stdin.isatty()` is True, and does not invoke it without `--wait-keypress`.
- [ ] **Step 2: Run wrapper tests to verify RED**
- [ ] **Step 3: Implement single-pass wrapper, stage banners, `--load-info-json` cut reuse, config flags, and `wait_for_keypress`**
- [ ] **Step 4: Run full Python test suite (`python3 -m unittest discover -s tests -v`) to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 3: Cross-Desktop Launcher (Any `yt-dlp` Site) and Native Messaging Host

**Files:**
- Modify: `bin/yt-dlp-shortcut.sh`
- Create: `bin/yt-dlp-native-host.py`
- Modify: `tests/test_shortcut.sh`
- Create: `tests/test_native_host.py`

**Interfaces:**
- Produces in `bin/yt-dlp-shortcut.sh`:
  - Positional / selection / MPRIS / clipboard URLs accept any safe `http://` or `https://` URL (valid non-empty hostname, no whitespace/control chars `<= 0x20` or `0x7f`, no `username`/`password` userinfo, does not start with `-`).
  - `yt-dlp://<audio|video|cut>?url=<encoded>` remains restricted to YouTube hosts and fails closed on empty/malformed URIs.
  - Clipboard & primary selection order: `wl-paste` (when `WAYLAND_DISPLAY` is set or `xclip`/`xsel` absent) -> `xclip` -> `xsel`.
  - MPRIS order: `playerctl metadata xesam:url` -> `qdbus6`/`qdbus` (`org.mpris.MediaPlayer2.plasma-browser-integration`).
  - Terminal auto-detection (`$YTDL_TERMINAL` override, else desktop-aware search across `konsole`, `ptyxis`, `kgx`, `gnome-terminal`, `xfce4-terminal`, `mate-terminal`, `tilix`, `alacritty`, `kitty`, `xterm`, `x-terminal-emulator`) launching `"$WRAPPER" --wait-keypress "$MODE" "$URL"` with separate argv items and **no `--hold` flag**.
- Produces in `bin/yt-dlp-native-host.py`:
  - Native Messaging host named `firefox_youtube_downloader` reading/writing 4-byte native-endian `uint32` length-prefixed UTF-8 JSON messages.
  - Handles `ping`, `get_config`, `set_config` (updates `auto_tag`, `rsgain`, `download_dir` via `ytdl_config.save_config`), and `download` (`mode` in `audio|video|cut`, chooses first valid YouTube `http(s)` URL from `[url, *fallbacks]`, spawns `yt-dlp-shortcut.sh` in a detached session with `DEVNULL` stdio, returns `{"ok": True, "launched": True, "mode": mode, "url": chosen}`).

- [ ] **Step 1: Write failing tests in `tests/test_shortcut.sh` and `tests/test_native_host.py`**
  - Update/add shell tests proving: non-YouTube `https://soundcloud.com/example/track` and `https://vimeo.com/12345` launch `"$WRAPPER" --wait-keypress <mode> <url>` without `--hold`; `file:///etc/passwd`, `javascript:alert(1)`, `https://user:pass@example.com/x`, and plain text are rejected; X11 `xclip` + `playerctl` + `gnome-terminal` / `kgx` fallbacks work when `konsole` and `wl-paste` are absent.
  - Add Python tests for `yt-dlp-native-host.py` framing (`ping`, `get_config`, `set_config` persistence, `download` URL validation & detached spawn without blocking stdout, and clean `{"ok": False, "error": ...}` responses on invalid mode/non-YouTube URL).
- [ ] **Step 2: Run tests to verify RED**
- [ ] **Step 3: Implement `bin/yt-dlp-shortcut.sh` and `bin/yt-dlp-native-host.py`**
- [ ] **Step 4: Run `bash tests/test_shortcut.sh` and `python3 -m unittest discover -s tests -v` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 4: Firefox WebExtension (Segmented Watch-Page Pill, Icon Context Menu, Settings Popup & `.xpi` Builder)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/plugin.svg`
- Create: `extension/icons/audio.svg`
- Create: `extension/icons/video.svg`
- Create: `extension/icons/cut.svg`
- Create: `extension/background.js`
- Create: `extension/content.css`
- Create: `extension/content.js`
- Create: `extension/popup.html`
- Create: `extension/popup.css`
- Create: `extension/popup.js`
- Create: `scripts/build-xpi.sh`
- Create: `tests/test_firefox_extension.js`

**Interfaces:**
- Extension ID: `"firefox-youtube-downloader@lakis01.github.io"`, Native Host ID: `"firefox_youtube_downloader"`.
- Context menu (`extension/background.js`):
  - Root item `id: "ytdl-root"`, `title: "YouTube Downloader"`, `icons: { "16": "icons/plugin.svg", "32": "icons/plugin.svg" }`.
  - Child items:
    - `id: "ytdl-audio"`, `parentId: "ytdl-root"`, `title: "Audio"`, `icons: { "16": "icons/audio.svg", "32": "icons/audio.svg" }`
    - `id: "ytdl-video"`, `parentId: "ytdl-root"`, `title: "Video"`, `icons: { "16": "icons/video.svg", "32": "icons/video.svg" }`
    - `id: "ytdl-cut"`, `parentId: "ytdl-root"`, `title: "Cut Audio"`, `icons: { "16": "icons/cut.svg", "32": "icons/cut.svg" }`
  - Uses `elementsFromPoint()` context URL from `content.js` (`{ type: "ytdl-get-context-url" }`), with `[info.linkUrl, info.pageUrl, tab.url]` fallbacks, and calls `browser.runtime.sendNativeMessage("firefox_youtube_downloader", { action: "download", mode, url, fallbacks })`.
  - Also listens for `{ type: "ytdl-trigger-download", mode, url }` from the watch-page segmented pill; if `sendNativeMessage` rejects (companion missing), opens `popup.html?onboarding=1` in a tab so the user immediately sees the 1-line companion install command.
- Watch-page UI (`extension/content.js`, `extension/content.css`):
  - Mounts `[data-ytdl-controls]` between `#owner` and `#actions` inside `ytd-watch-metadata #top-row` on `/watch`, `/shorts/`, and `/live/` routes.
  - **Style A Segmented YouTube Pill:**
    - Outer pill: `height: 38px; border-radius: 19px; background: rgba(0, 0, 0, 0.05)` in light mode (`#f2f2f2` fallback) and `rgba(255, 255, 255, 0.1)` in dark mode (`html[dark]`, `#272727` fallback) — matching YouTube's `👍 | 👎` segmented pill rather than `--yt-spec-badge-chip-background`.
    - Three `<button type="button">` segments (`Audio`, `Video`, `Cut`) with `aria-label` (`Download audio`, `Download video`, `Cut audio`), crisp `20px` (`viewBox="0 0 24 24"`, `stroke-width: 2`) authored inline SVGs, `500 14px/20px Roboto, Arial, sans-serif`, `0 15px` horizontal padding, `18px` tall `1px` vertical dividers (`rgba(255, 255, 255, 0.2)` dark / `rgba(0, 0, 0, 0.12)` light), segment hover `rgba(255, 255, 255, 0.12)` / `rgba(0, 0, 0, 0.08)`, `:focus-visible` ring, and brief `[data-launching="true"]` visual confirmation state.
- Popup / Preferences (`extension/popup.html`, `popup.css`, `popup.js`):
  - Clean Operate-mode tool panel (no emoji, no kicker/eyebrow labels, themed focus/selection/inputs).
  - Queries `ping` via `sendNativeMessage`:
    - When connected: displays status indicator, toggles for **Automatic tag extraction** and **ReplayGain normalization (rsgain)**, and **Download folder** quick-select (`Keep yt-dlp config`, `~/Music/Youtube Downloads`, `~/Downloads/Youtube`, or custom path) saving via `set_config`.
    - When disconnected: displays clear setup instructions with a 1-click Copy button for `./install.sh --install` and a Retry Connection button.
- Packaging (`scripts/build-xpi.sh`):
  - Builds `dist/firefox-youtube-downloader.xpi` (`dist/` added to `.gitignore`) with `manifest.json` at archive root and validates JSON & required files.

- [ ] **Step 1: Write failing Node tests in `tests/test_firefox_extension.js`**
  - Verify `manifest.json` schema/permissions/icons, `background.js` menu creation (`YouTube Downloader` -> `Audio`, `Video`, `Cut Audio` with SVG icons) and `sendNativeMessage` dispatch + onboarding fallback, `content.js` + `content.css` segmented pill mounting, `#272727` / `rgba(255, 255, 255, 0.1)` surface (asserting `--yt-spec-badge-chip-background` is NOT used), `<button>` click message dispatch, `elementsFromPoint` lockup-under-preview hit-testing, `popup.js` connected config toggles + disconnected onboarding state, and `scripts/build-xpi.sh` archive structure.
- [ ] **Step 2: Run `node tests/test_firefox_extension.js` to verify RED**
- [ ] **Step 3: Implement `extension/*`, `.gitignore` (`dist/`), and `scripts/build-xpi.sh`**
- [ ] **Step 4: Run `node tests/test_firefox_extension.js`, `bash scripts/build-xpi.sh`, `node --check` on all JS files, and Impeccable detector (`/home/gratis01/.config/opencode/skills/impeccable/scripts/impeccable detect --json extension`)**
- [ ] **Step 5: Commit**

---

### Task 5: Safe Cross-Distro Installer (`install.sh`), Porting & Cleanup Documentation (`README.md`)

**Files:**
- Modify: `install.sh`
- Modify: `README.md`
- Modify: `tests/test_shortcut.sh`

**Interfaces:**
- `install.sh` modes & flags:
  - `./install.sh` (default dry run): prints planned binaries (`ytdl_config.py`, `ytdl_meta.py`, `yt-dlp-wrapper.py`, `yt-dlp-shortcut.sh`, `yt-dlp-native-host.py`), desktop entries, native-messaging manifests (`~/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json` and `${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts/firefox_youtube_downloader.json`), `.xpi` build target, and config behavior without writing anything.
  - `./install.sh --check-deps`: inspects current session (`KDE`/`GNOME`/`Cinnamon`, `Wayland`/`X11`), reports present/missing tools, and prints the exact non-destructive `apt install` line for **Debian 13.7 (GNOME)** and **LMDE 7 (Cinnamon)**.
  - `./install.sh --install [--download-dir=<path|ytdlp-default>] [--auto-tag=<true|false>] [--rsgain=<true|false>] [--yes]`:
    - Never creates or modifies `~/.config/yt-dlp/config`.
    - When `~/.config/youtube-downloader/config.json` does not exist and stdin is a TTY (without `--yes` or explicit flags), interactively prompts for:
      1. Download path (`~/Music/Youtube Downloads` default, `~/Downloads/Youtube` option 2, custom path option 3; or `Keep existing yt-dlp config` default when `~/.config/yt-dlp/config` already exists),
      2. Automatic tag extraction (`[Y/n]`, default `true`),
      3. ReplayGain `rsgain` normalization (`[y/N]`, default `false`).
    - Writes `~/.config/youtube-downloader/config.json` (preserving an existing file when no override flags are given, or applying explicit `--download-dir` / `--auto-tag` / `--rsgain` flags).
    - Installs binaries with `.bak.<timestamp>` backups, builds `dist/firefox-youtube-downloader.xpi`, writes the two Firefox native-messaging host manifests pointing to `$HOME/.local/bin/yt-dlp-native-host.py` for `"firefox-youtube-downloader@lakis01.github.io"`, and installs desktop launchers.
- `README.md`:
  - Documents **Firefox YouTube Downloader Plugin** architecture, 2-step installation (`.xpi` + `./install.sh --install`), Mozilla AMO free signing (`npx web-ext sign`), porting guide for **Debian 13.7 + GNOME** and **LMDE 7 + Cinnamon**, configuration options (`download_dir`, `auto_tag`, `rsgain`), and step-by-step cleanup guide for retiring External Application Launcher (`com.add0n.node`, noting `ff2mpv` is separate and unaffected) and Tampermonkey.

- [ ] **Step 1: Write failing installer tests in `tests/test_shortcut.sh`**
  - Test fresh-HOME `--install --yes` creates `.config/youtube-downloader/config.json` with `download_dir: "~/Music/Youtube Downloads"`, `auto_tag: true`, `rsgain: false`, creates both `~/.mozilla/native-messaging-hosts/firefox_youtube_downloader.json` and `~/.config/mozilla/native-messaging-hosts/firefox_youtube_downloader.json`, builds `dist/firefox-youtube-downloader.xpi`, and creates **no** `.config/yt-dlp/config`.
  - Test interactive TTY stdin simulation choosing option `2` (`~/Downloads/Youtube`), `n` (`auto_tag: false`), `y` (`rsgain: true`).
  - Test HOME with pre-existing `.config/yt-dlp/config` preserves it byte-for-byte and defaults `download_dir` to `null` when `--install --yes` runs, and honors `--rsgain=true --auto-tag=true --download-dir=ytdlp-default`.
  - Test `--check-deps` exits cleanly without writing files.
- [ ] **Step 2: Run `bash tests/test_shortcut.sh` to verify RED**
- [ ] **Step 3: Implement `install.sh` and rewrite/update `README.md`**
- [ ] **Step 4: Run all test suites (`python3 -m unittest discover -s tests -v`, `bash tests/test_shortcut.sh`, `node tests/test_firefox_extension.js`, `node tests/test_youtube_buttons.js`, `desktop-file-validate desktop/*.desktop`, `./install.sh`)**
- [ ] **Step 5: Commit**
