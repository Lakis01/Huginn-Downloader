# Firefox YouTube Downloader Plugin — Polish, WebP, Autoplay Menu, Version Check & Cross-Platform Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the YouTube watch-page pill vertically with Subscribe/Like, fix inline autoplay preview right-click menus, embed native `.webp` covers without `.jpg` conversion, silence `yt-dlp` extractor/thumbnail-probing noise, detect outdated `yt-dlp` versions smartly, add macOS/Windows companion support, and document AMO signing & store publishing.

**Architecture:** `bin/ytdl_meta.py` embeds `image/webp` directly for Opus, Ogg, and MP3 (keeping native uncropped `.webp` bytes verbatim, encoding once to WebP when cropping or converting legacy `.jpg`/`.png` thumbnails, and keeping `FORMAT_JPEG` only for M4A/MP4 `covr`). `bin/yt-dlp-wrapper.py` passes `--quiet --progress` without `--convert-thumbnails jpg` and queries `bin/ytdl_version.py` (24h cached GitHub release + 45-day calendar-age check + OS/packager-specific update hints). `extension/` switches to static `documentUrlPatterns` menus (no `onShown` race), captures `ytd-video-preview` on `pointerdown` + `contextmenu`, aligns `[data-ytdl-controls]` via `margin-top: 12px; align-self: center;`, and surfaces `yt_dlp_status` in the popup. `install.py` + `install.ps1` + updated `install.sh` / `yt-dlp-native-host.py` add macOS and Windows support alongside Linux.

**Tech Stack:** Python 3 (`mutagen`, `Pillow`, `urllib.request`, `termios`/`msvcrt`, `winreg`), Bash, PowerShell, Firefox WebExtensions (Manifest V2), `yt-dlp`, `ffmpeg`, `rsgain`.

**Spec:** `docs/superpowers/specs/2026-11-12-plugin-polish-and-crossplatform-design.md`.

## Global Constraints

- Never create, modify, or overwrite `~/.config/yt-dlp/config`.
- Never modify Firefox profile databases (`places.sqlite`, `prefs.js`, IndexedDB).
- Embed `image/webp` cover art in Opus, Ogg, and MP3 outputs (preserving original file bytes untouched when `thumbnail_path` is already an uncropped WebP, otherwise encoding once with `WEBP`, `quality=88, method=6`). Keep `image/jpeg` (`quality=88, optimize=True`) solely for `.m4a`/`.mp4`/`.m4b` `MP4Cover` compatibility.
- Do not pass `--convert-thumbnails jpg` to `yt-dlp` in audio or cut modes; pass `--quiet --progress` so noisy extractor and missing-thumbnail lines are suppressed while live `[download]` progress bars and `ERROR:` stderr messages remain intact.
- Preserve `language`/`lang` tag stripping across all containers and preserve `parse_info()` keys for `yt-to-forerunner`.
- Never block or fail offline downloads during `yt-dlp` version checks; `ping`/`get_config` in the native host must use `allow_network=False` (cached/age check only).
- Never use emoji or Unicode glyphs as icons in extension HTML/CSS/JS/SVG, and never use kicker/eyebrow labels above headings.
- Pass `--` before URLs in every `yt-dlp` invocation and pass all process arguments as separate array items without shell evaluation.

## Review Focus

1. **Corrupted or non-WebP sidecars named `.webp` vs genuine `.webp`:** `_cover_image_bytes` must inspect `image.format == "WEBP"` via Pillow before passing raw file bytes through untouched, and still crop 16:9 Official Art Track `.webp` files to 1:1 square WebP (Task 1 tests).
2. **`--quiet --progress` must still surface `ERROR:` stderr for auth-cookie retries:** Verify with `yt-dlp` and wrapper unit tests that `-q --progress` keeps stderr error strings intact so `_is_auth_error()` still retries `--cookies-from-browser firefox` (Task 1 tests).
3. **Zero-padded `yt-dlp` calendar versions (`2026.03.04` vs `2026.3.4`) and offline timeouts:** `version_tuple` must normalize integer segments and `check_ytdlp_update(allow_network=True)` must catch `URLError`/`TimeoutError`/malformed JSON cleanly and fall back to the 45-day calendar-age check (Task 2 tests).
4. **Hover-autoplay preview right-click when background event page wakes from idle:** Menu items must be created via `runtime.onInstalled` / `runtime.onStartup` with static `documentUrlPatterns` and **no** `menus.onShown` hiding logic, while `content.js` resolves `div#video-preview > ... > ytd-video-preview` on right-button `pointerdown` as well as `contextmenu` (Task 3 tests).
5. **Cross-platform path quoting on macOS & Windows:** Launching terminals on macOS/Windows with apostrophes, spaces, and `&` in URLs must pass arguments safely without shell command injection (Task 4 tests).

---

### Task 1: Native WebP Cover Embedding & Quiet `yt-dlp` Progress Output

**Files:**
- Modify: `bin/ytdl_meta.py`
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces in `bin/ytdl_meta.py`:
  - `_cover_image_bytes(thumbnail_path, is_official, prefer_webp=True) -> tuple[bytes, str, int, int]`
    - When `prefer_webp=True` (used by `tag_audio_file` for `.opus`, `.ogg`, `.mp3`):
      - If `not (is_official and width > height)` and Pillow reports `image.format == "WEBP"`: returns `(Path(thumbnail_path).read_bytes(), "image/webp", width, height)` verbatim without re-encoding.
      - Otherwise (cropped square Art Track or non-WebP input such as `.jpg`/`.png`): converts to `"RGB"`, crops if `is_official and width > height`, encodes once via `frame.save(buffer, "WEBP", quality=88, method=6)`, and returns `(bytes, "image/webp", width, height)`.
    - When `prefer_webp=False` (used by `tag_audio_file` for `.m4a`, `.mp4`, `.m4b`): crops if `is_official and width > height` and encodes `JPEG` (`quality=88, optimize=True`), returning `(bytes, "image/jpeg", width, height)`.
- Produces in `bin/yt-dlp-wrapper.py`:
  - `download_audio`, `interactive_cut`, and `download_video` pass `"--quiet", "--progress"` (replacing `"--no-warnings", "--progress"`) so `[youtube]` API JSON and `[info] Video Thumbnail xx does not exist` lines are suppressed while live download progress bars and `ERROR:` stderr remain active.
  - `download_audio` and `interactive_cut` omit `"--convert-thumbnails", "jpg"` so native `.webp` thumbnails are written directly without FFmpeg conversion to `.jpg`.

- [ ] **Step 1: Write failing tests in `tests/test_ytdl_meta.py`**
  - Assert `tag_audio_file` on `.opus` and `.mp3` embeds `mime == "image/webp"` (`RIFF....WEBP` header):
    - Standard upload (`is_tagged=False`) with a native `.webp` thumbnail embeds the **exact byte-identical** `.webp` file bytes untouched.
    - Official Art Track (`is_tagged=True`) with a `1600x900` `.webp` crops to `900x900` `image/webp`.
    - `.jpg` thumbnail on `.opus`/`.mp3` transcodes once to `image/webp`.
  - Assert `tag_audio_file` on `.m4a` still embeds `MP4Cover.FORMAT_JPEG` (`image/jpeg`).
  - Assert `download_audio`, `interactive_cut`, and `download_video` pass `"--quiet"` and `"--progress"`, and that `download_audio` and `interactive_cut` do **not** pass `"--convert-thumbnails"`.
- [ ] **Step 2: Run `python3 -m unittest tests/test_ytdl_meta.py -v` to verify RED**
- [ ] **Step 3: Implement WebP cover handling in `bin/ytdl_meta.py` and quiet/native-thumbnail flags in `bin/yt-dlp-wrapper.py`**
- [ ] **Step 4: Run `python3 -m unittest discover -s tests -v` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 2: Smart Out-of-Date `yt-dlp` Version Detector

**Files:**
- Create: `bin/ytdl_version.py`
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `bin/yt-dlp-native-host.py`
- Create: `tests/test_ytdl_version.py`
- Modify: `tests/test_native_host.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces in `bin/ytdl_version.py`:
  - `CACHE_TTL_SECONDS = 86400`
  - `STALE_AGE_DAYS = 45`
  - `version_tuple(version_str: str) -> tuple[int, ...] | None`
  - `version_age_days(version_str: str, today: date | None = None) -> int | None`
  - `detect_update_command(ytdlp_path: str | None = None, platform_name: str | None = None, os_release_text: str | None = None, env: Mapping[str, str] | None = None) -> str`
  - `check_ytdlp_update(*, allow_network: bool = False, force_refresh: bool = False, env: Mapping[str, str] | None = None, fetch_latest: Callable[[], str | None] | None = None, installed_version: str | None = None, ytdlp_path: str | None = None, today: date | None = None) -> dict[str, Any]`
    - Returns `{"installed": str | None, "latest": str | None, "outdated": bool, "age_days": int | None, "reason": str, "update_hint": str}`
    - Cache path: `${XDG_CACHE_HOME:-$HOME/.cache}/youtube-downloader/ytdlp-version.json` on Linux, `~/Library/Caches/FirefoxYouTubeDownloader/ytdlp-version.json` on `darwin`, `%LOCALAPPDATA%/FirefoxYouTubeDownloader/cache/ytdlp-version.json` on `nt`.
    - Never performs network I/O when `allow_network=False`. When `allow_network=True` and cache is missing/older than 24h (or `force_refresh=True`), queries `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` with `timeout=1.8`, caching `{checked_at, latest_version}` on success and swallowing network/JSON errors cleanly.
- Consumed in `bin/yt-dlp-wrapper.py`:
  - On `_YtDlpError` in `main()`: calls `check_ytdlp_update(allow_network=True)` and if `status["outdated"]` is True, prints an actionable update hint to `sys.stderr` showing `installed`, `latest` (or age in days), and `update_hint`.
  - After a successful run in `main()`: calls `check_ytdlp_update(allow_network=True)` (uses 24h cache so 0 network calls when fresh) and if `status["outdated"]` is True, prints a concise 1-line update notice.
- Consumed in `bin/yt-dlp-native-host.py`:
  - `_config_response()` adds `"yt_dlp_status": check_ytdlp_update(allow_network=False)`.

- [ ] **Step 1: Write failing tests in `tests/test_ytdl_version.py`, `tests/test_native_host.py`, and `tests/test_ytdl_meta.py`**
  - Test `version_tuple` (`"2026.03.04" == (2026, 3, 4)`), 24h cache hit skipping `fetch_latest`, `allow_network=False` never calling `fetch_latest`, network error falling back to 45-day `STALE_AGE_DAYS` check, and `detect_update_command` across Debian/LMDE `/usr/bin/yt-dlp`, `pipx`, `~/.local/bin/yt-dlp`, macOS Homebrew `/opt/homebrew/bin/yt-dlp`, and Windows `WinGet` / standalone `yt-dlp.exe`.
  - Test `main()` in `yt-dlp-wrapper.py` prints the update hint on `_YtDlpError` when `yt-dlp` is outdated and omits it when up to date.
  - Test `yt-dlp-native-host.py` `ping` includes `yt_dlp_status` without network access.
- [ ] **Step 2: Run tests to verify RED**
- [ ] **Step 3: Implement `bin/ytdl_version.py` and wire into `bin/yt-dlp-wrapper.py` and `bin/yt-dlp-native-host.py`**
- [ ] **Step 4: Run `python3 -m unittest discover -s tests -v` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 3: Watch-Page Pill Vertical Alignment, Autoplay Right-Click Fix & Popup `yt-dlp` Update Notice

**Files:**
- Modify: `extension/content.css`
- Modify: `extension/content.js`
- Modify: `extension/background.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.css`
- Modify: `extension/popup.js`
- Modify: `extension/manifest.json`
- Modify: `tests/test_firefox_extension.js`

**Interfaces:**
- `extension/manifest.json`: bump `"version": "2.1.0"`.
- `extension/content.css`:
  - `[data-ytdl-controls]` adds `margin-top: 12px;` and `align-self: center;` (keeping `height: 40px; border-radius: 20px;`) so its vertical center aligns with YouTube's `#owner` (`margin-top: 12px`) and `#actions` (`margin-top: 12px`).
- `extension/content.js`:
  - Add `'ytd-video-preview'` and `'#video-preview'` to `CARD_SELECTOR`.
  - Listen to right-button `pointerdown` (`event.button === 2`) and `mousedown` (`event.button === 2`) in capture phase (`true`) in addition to `contextmenu` so `lastContextUrl` is captured even if YouTube's inline preview player intercepts `contextmenu`.
- `extension/background.js`:
  - `YT_DOC_PATTERNS = ['*://*.youtube.com/*', '*://youtube.com/*', '*://*.youtu.be/*', '*://youtu.be/*']`.
  - `MENU_CONTEXTS = ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection']`.
  - All four menu items (`ytdl-root`, `ytdl-audio`, `ytdl-video`, `ytdl-cut`) declare `documentUrlPatterns: YT_DOC_PATTERNS` and `contexts: MENU_CONTEXTS` with **no** `targetUrlPatterns` and **no** `menus.onShown` listener hiding them.
  - Register `setupMenus` on `runtime.onInstalled` and `runtime.onStartup` (plus initial call guarded cleanly) so waking from event-page suspension never races with menu display.
  - `isYouTubeUrl(value)` unwraps leading `blob:` (`blob:https://www.youtube.com/...`) before parsing hostname.
- `extension/popup.{html,css,js}`:
  - Displays a clean `#ytdlpUpdateNote` warning banner (with copyable `update_hint` code line) when `response.yt_dlp_status && response.yt_dlp_status.outdated` is `true`, hidden otherwise.

- [ ] **Step 1: Write failing assertions in `tests/test_firefox_extension.js`**
  - Assert `content.css` includes `margin-top: 12px` and `align-self: center` on `[data-ytdl-controls]` while retaining `height: 40px` and `#272727` / `rgba(255, 255, 255, 0.1)`.
  - Assert `background.js` creates the 4 menu items with `documentUrlPatterns` covering YouTube/youtu.be, `contexts` including `'video'` and `'selection'`, **no** `targetUrlPatterns`, and **no** `menus.onShown` listener hiding `ytdl-root`.
  - Assert `isYouTubeUrl('blob:https://www.youtube.com/ab-cd')` returns `true`.
  - Assert right-button `pointerdown` (`button: 2`) on `div#video-preview > ytd-video-preview-loader > div > ytd-video-preview` (containing `<a href="/watch?v=preview999">` and sibling `yt-inline-player-controls`) captures `https://www.youtube.com/watch?v=preview999` even if `contextmenu` is not dispatched to document.
  - Assert `popup.js` renders `#ytdlpUpdateNote` with the installed version and `update_hint` when `yt_dlp_status.outdated === true` and hides it when `outdated === false`.
- [ ] **Step 2: Run `node tests/test_firefox_extension.js` to verify RED**
- [ ] **Step 3: Implement updates in `extension/*` and rebuild `dist/firefox-youtube-downloader.xpi`**
- [ ] **Step 4: Run `node tests/test_firefox_extension.js`, `bash scripts/build-xpi.sh`, `node --check` on all extension JS, and `/home/gratis01/.config/opencode/skills/impeccable/scripts/impeccable detect --json extension` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 4: Cross-Platform Support (Linux, macOS, Windows) & AMO Store Signing / GitHub Documentation

**Files:**
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `bin/yt-dlp-native-host.py`
- Create: `install.py`
- Create: `install.ps1`
- Modify: `install.sh`
- Create: `docs/AMO-PUBLISHING.md`
- Modify: `README.md`
- Create: `tests/test_crossplatform.py`
- Modify: `tests/test_shortcut.sh`

**Interfaces:**
- `bin/yt-dlp-wrapper.py`:
  - `wait_for_keypress()` uses `msvcrt.getch()` when `os.name == "nt"` and `termios`/`tty.setcbreak` on POSIX (`linux`, `darwin`), importing `termios`/`tty` lazily so importing `yt-dlp-wrapper.py` on Windows never fails with `ModuleNotFoundError: No module named 'termios'`.
- `bin/yt-dlp-native-host.py`:
  - `_launch_download(mode: str, chosen_url: str) -> None`:
    - `sys.platform.startswith("linux")`: spawns `[shortcut_sh, mode, chosen_url]` detached (unchanged).
    - `sys.platform == "darwin"`: writes an executable `0o700` launcher script in a private temp file (which unlinks itself on startup and `exec`s `[sys.executable, wrapper_py, "--wait-keypress", mode, chosen_url]` with `shlex.quote`d separate arguments — zero AppleScript injection risk!) and launches `["open", "-a", "Terminal", temp_command_path]`.
    - `os.name == "nt"`: spawns `[wt_exe, sys.executable, str(wrapper_py), "--wait-keypress", mode, chosen_url]` if `shutil.which("wt")` exists, else `[sys.executable, str(wrapper_py), "--wait-keypress", mode, chosen_url]` with `creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0x10)`.
- `install.py` + `install.ps1` + `install.sh`:
  - `install.sh` adds `ytdl_version.py` to `BIN_FILES` on Linux (so all 6 `bin/` files are installed to `~/.local/bin/`) and supports macOS (`uname -s == Darwin`) native-messaging manifest path `~/Library/Application Support/Mozilla/NativeMessagingHosts/firefox_youtube_downloader.json`.
  - `install.py` supports Windows (`--install`, `--yes`, `--download-dir=...`, `--auto-tag=...`, `--rsgain=...`, `--check-deps`, dry-run default): copies `bin/*.py` + generates `yt-dlp-native-host.cmd` (`@echo off` / `"<python_exe>" "%~dp0yt-dlp-native-host.py" %*`) into `%LOCALAPPDATA%\FirefoxYouTubeDownloader\bin`, writes `%LOCALAPPDATA%\FirefoxYouTubeDownloader\firefox_youtube_downloader.json`, registers `HKCU\Software\Mozilla\NativeMessagingHosts\firefox_youtube_downloader` via `winreg`, builds `dist/firefox-youtube-downloader.xpi`, and writes `%LOCALAPPDATA%\FirefoxYouTubeDownloader\config.json` (simultaneously updating `bin/ytdl_config.py` so on `os.name == "nt"` `config_path` resolves under `LOCALAPPDATA` when `XDG_CONFIG_HOME` is unset!). `install.ps1` forwards arguments to `py -3 install.py` / `python install.py`.
- `docs/AMO-PUBLISHING.md` & `README.md`:
  - `docs/AMO-PUBLISHING.md`: Complete developer walkthrough for signing **Unlisted** `.xpi` builds (`web-ext sign --channel=unlisted`) and publishing a **Listed** extension to the Firefox Add-ons Store (`addons.mozilla.org`), including AMO API key creation, exact privacy/data-collection questionnaire answers, permissions justification (`nativeMessaging`, `menus`, `activeTab`, YouTube host permissions), and release updates.
  - `README.md`: Clear user installation guides for **Debian 13.7 (GNOME)**, **LMDE 7 (Cinnamon)**, **General Linux**, **macOS**, and **Windows**, explaining the 2-part architecture (Firefox Add-on + lightweight companion host) and EAL/Tampermonkey retirement.

- [ ] **Step 1: Write failing tests in `tests/test_crossplatform.py` and `tests/test_shortcut.sh`**
  - Test `wait_for_keypress` Windows `msvcrt` branch (mocked `os.name = "nt"` + fake `msvcrt` module) and confirm `yt-dlp-wrapper.py` imports cleanly when `termios` is absent.
  - Test `_launch_download` on mocked `darwin` (verifies `0o700` `.command` file uses `shlex.quote` safely around apostrophes/`&`/`$()` and invokes `open -a Terminal`) and mocked `nt` (`wt.exe` vs `CREATE_NEW_CONSOLE`).
  - Test `install.py` dry-run and simulated Windows `--install --yes` (with mocked `winreg` and temp `LOCALAPPDATA`), verifying `.cmd` trampoline, manifest JSON, config JSON, `.xpi`, and zero `~/.config/yt-dlp/config` changes.
  - Test `install.sh --install --yes` installs `ytdl_version.py` alongside the other 5 binaries in `tests/test_shortcut.sh`.
- [ ] **Step 2: Run tests to verify RED**
- [ ] **Step 3: Implement cross-platform support, `install.py`, `install.ps1`, `install.sh` (`ytdl_version.py`), `docs/AMO-PUBLISHING.md`, and `README.md`**
- [ ] **Step 4: Run full verification (`python3 -m unittest discover -s tests -v`, `bash tests/test_shortcut.sh`, `node tests/test_firefox_extension.js`, `node tests/test_youtube_buttons.js`, `bash scripts/build-xpi.sh`, `desktop-file-validate desktop/*.desktop`, `./install.sh`)**
- [ ] **Step 5: Commit**
