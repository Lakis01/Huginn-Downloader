# Audio Formats, Live `rsgain` Check, Tampermonkey Guard, Auto-Signing & Shipping Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable audio formats (`best` native Opus/M4A default, `mp3` with `V0`/`320k`/`V2`/`128k` selector, native-first `m4a`, `ogg`, `flac`), live `rsgain` installation checking on popup toggle, automatic Tampermonkey DOM cleanup, `scripts/sign-xpi.sh` automatic AMO signing, and comprehensive user/developer documentation.

**Architecture:** `bin/ytdl_config.py` persists `audio_format` (`"best"` default) and `mp3_quality` (`"V0"` default) with full backward compatibility. `bin/yt-dlp-wrapper.py` translates those settings into `yt-dlp` format/postprocessor flags, and `bin/ytdl_meta.py` adds `.flac` tagging alongside `.opus`, `.ogg`, `.mp3`, and `.m4a`. `extension/` (`v2.2.0`) exposes format/bitrate controls in the popup, blocks enabling ReplayGain when `deps.rsgain === false` with an inline install hint, and replaces any legacy Tampermonkey `[data-ytdl-controls]` DOM on YouTube watch pages.

**Tech Stack:** Python 3 (`mutagen`, `Pillow`), Bash, Firefox WebExtensions (Manifest V2), `web-ext`, `yt-dlp`, `ffmpeg`, `rsgain`.

**Spec:** `docs/superpowers/specs/2026-11-13-audio-formats-popup-signing-design.md`.

## Global Constraints

- Never create, modify, or overwrite `~/.config/yt-dlp/config`.
- Never modify Firefox profile databases (`places.sqlite`, `prefs.js`, IndexedDB).
- Keep `audio_format: "best"` (native Opus / M4A, no conversion) and `mp3_quality: "V0"` as the defaults.
- Preserve `image/webp` cover embedding on `.opus`, `.ogg`, `.mp3`, and `.flac`, and `image/jpeg` on `.m4a`/`.mp4`/`.m4b`, while stripping `language`/`lang` tags across all supported containers.
- Never print or log `AMO_JWT_ISSUER` or `AMO_JWT_SECRET` values.
- Never use emoji or Unicode glyphs as icons in extension HTML/CSS/JS/SVG, and never use kicker/eyebrow labels above headings.

## Review Focus

1. **Backward compatibility with existing 3-key `config.json` files:** `load_config()` and `save_config()` must accept existing `{"download_dir", "auto_tag", "rsgain"}` dicts and fill `"audio_format": "best"` and `"mp3_quality": "V0"` without breaking any existing callers or tests (Task 1 tests).
2. **Native-first M4A vs MP3 LAME quality flags:** `audio_format="m4a"` must pass `-f bestaudio[ext=m4a]/bestaudio -x --audio-format m4a` (avoiding re-encoding when YouTube has stream 140), while `audio_format="mp3"` passes `-f bestaudio -x --audio-format mp3 --audio-quality <0|320K|2|128K>` (Task 1 tests).
3. **Popup `rsgain` toggle guard when `deps.rsgain === false`:** Toggling `#rsgain` ON when `deps.rsgain` is `false` must uncheck `#rsgain`, skip enabling `rsgain` in `set_config`, and reveal `#rsgainMissingNote` (Task 2 tests).
4. **Tampermonkey DOM collision on YouTube watch pages:** If a legacy `<div data-ytdl-controls="true"><a ...>` and `<style id="ytdl-controls-style">` exist in `#top-row` before `extension/content.js` runs, `syncControls()` must remove both and mount the extension's `<button>` pill (`data-ytdl-ext="true"`) (Task 2 tests).

---

### Task 1: Audio Format & MP3 Quality Pipeline (`ytdl_config.py`, `ytdl_meta.py`, `yt-dlp-wrapper.py`)

**Files:**
- Modify: `bin/ytdl_config.py`
- Modify: `bin/ytdl_meta.py`
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `tests/test_ytdl_config.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- `bin/ytdl_config.py`:
  - `SUPPORTED_AUDIO_FORMATS = ("best", "mp3", "m4a", "ogg", "flac")`
  - `SUPPORTED_MP3_QUALITIES = ("V0", "320k", "V2", "128k")`
  - `_DEFAULT_CONFIG` includes `"audio_format": "best"` and `"mp3_quality": "V0"`.
  - `load_config` keeps defaults when stored values are missing/invalid; `save_config` raises `ValueError` (or `TypeError` if non-str) when `audio_format` or `mp3_quality` is outside the supported tuple.
- `bin/ytdl_meta.py`:
  - `tag_audio_file()` and `strip_language_tags()` support `.flac` (`from mutagen.flac import FLAC, Picture`, clearing/setting Vorbis comments via `_tag_vorbis_comments(audio, meta, None)` and writing `Picture` via `audio.clear_pictures()` + `audio.add_picture(picture)` with `prefer_webp=True`).
- `bin/yt-dlp-wrapper.py`:
  - `_audio_format_args(config: Mapping[str, Any] | None = None) -> list[str]`:
    - `"best"` -> `["-f", "bestaudio", "-x", "--audio-format", "best"]`
    - `"mp3"` -> `["-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", {"V0": "0", "320k": "320K", "V2": "2", "128k": "128K"}[mp3_quality]]`
    - `"m4a"` -> `["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a"]`
    - `"ogg"` -> `["-f", "bestaudio", "-x", "--audio-format", "vorbis", "--audio-quality", "0"]`
    - `"flac"` -> `["-f", "bestaudio", "-x", "--audio-format", "flac"]`
  - `download_audio(url, config=None)` uses `*_audio_format_args(cfg)` in place of hardcoded `"-f", "bestaudio", "-x", "--audio-format", "best"`.

- [ ] **Step 1: Write failing tests in `tests/test_ytdl_config.py` and `tests/test_ytdl_meta.py`**
- [ ] **Step 2: Run tests to verify RED**
- [ ] **Step 3: Implement config, FLAC tagging, and wrapper format flags**
- [ ] **Step 4: Run `python3 -m unittest discover -s tests -v` and `bash tests/test_shortcut.sh` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 2: Extension v2.2.0 (Audio Format UI, Live `rsgain` Toggle Guard, Tampermonkey Cleanup) & `scripts/sign-xpi.sh`

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/content.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.css`
- Modify: `extension/popup.js`
- Create: `scripts/sign-xpi.sh`
- Modify: `.gitignore`
- Modify: `tests/test_firefox_extension.js`

**Interfaces:**
- `extension/manifest.json`: `"version": "2.2.0"`.
- `extension/content.js`:
  - `makeGroup()` sets `group.setAttribute('data-ytdl-ext', 'true')`.
  - `syncControls()` removes any `#ytdl-controls-style` element and any `[data-ytdl-controls]` element lacking `data-ytdl-ext="true"` (such as a leftover Tampermonkey `<a>` group) before checking/mounting the extension's `<button>` group.
- `extension/popup.{html,css,js}`:
  - Adds `<select id="audioFormat">` (`best`, `mp3`, `m4a`, `ogg`, `flac`) and `<div id="mp3QualityRow" hidden>` with `<select id="mp3Quality">` (`V0`, `320k`, `V2`, `128k`) plus `<p class="note" id="formatNote">` explaining native Opus/M4A vs lossy conversion.
  - Adds `<p class="warn-note" id="rsgainMissingNote" hidden></p>`. When `#rsgain` is toggled ON while `lastDeps && lastDeps.rsgain === false`, sets `rsgainEl.checked = false`, shows `#rsgainMissingNote` with install instructions (`rsgain is not installed...`), and does NOT send `rsgain: true` to `set_config`.
- `scripts/sign-xpi.sh` (`chmod +x`) & `.gitignore` (`web-ext-artifacts/`):
  - Verifies `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are non-empty, runs `npx --yes web-ext sign --source-dir "$ROOT/extension" --artifacts-dir "$ROOT/web-ext-artifacts" --channel=unlisted --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"`, validates the resulting `.xpi` with `python3 -m zipfile -t`, and copies the newest signed `.xpi` to `$ROOT/dist/firefox-youtube-downloader-signed.xpi`.

- [ ] **Step 1: Write failing tests in `tests/test_firefox_extension.js`**
- [ ] **Step 2: Run `node tests/test_firefox_extension.js` to verify RED**
- [ ] **Step 3: Implement `extension/*` v2.2.0, `scripts/sign-xpi.sh`, and `.gitignore`**
- [ ] **Step 4: Run `node tests/test_firefox_extension.js`, `bash scripts/build-xpi.sh`, `node --check` on all JS files, and `/home/gratis01/.config/opencode/skills/impeccable/scripts/impeccable detect --json extension` to verify GREEN**
- [ ] **Step 5: Commit**

---

### Task 3: Shipping `README.md` & `docs/AMO-PUBLISHING.md` (Art Tracks, Audio Truth, Non-Technical Guide, Browser Forks)

**Files:**
- Modify: `README.md`
- Modify: `docs/AMO-PUBLISHING.md`

**Interfaces:**
- `README.md` covers:
  1. **Overview & Screenshots section** (with clean markdown image placeholders under `docs/screenshots/` for Watch-Page Pill, Right-Click Context Menu, Extension Popup, and Global Shortcuts).
  2. **Why Choose Official Audio Uploads ("Art Tracks"):** How to identify videos with `Provided to YouTube by ...` and `Auto-generated by YouTube.`, and why they give the highest audio quality + rich automatic metadata (Album, Release Date, Label, Composer, Producer, Engineer, and square 1:1 WebP cover art).
  3. **Audio Quality, Native Opus/M4A vs. MP3 Conversion & Cut Settings:**
     - Why YouTube's native streams (`.opus` ~160 kbps VBR, or `.m4a` AAC on past livestreams) are the highest quality available on YouTube's servers (zero conversion, zero generation loss).
     - Why converting 160 kbps Opus to 320 kbps MP3 cannot recover lost audio data and only creates a larger file with a second lossy pass — and why **LAME `V0` (`~245 kbps VBR`)** is the recommended choice when MP3 is required for older car stereos or hardware players (with `320k` CBR, `V2` VBR, and `128k` CBR also selectable).
     - Exact **`Cut Audio` defaults:** **Opus `117 kbps` VBR (`-vbr on`), 2-channel stereo (`-ac 2`), `-application audio`** (customizable interactively per cut, including `1` channel mono and `voip` mode for speech).
  4. **Global Shortcuts for Any `yt-dlp` Site:** How `yt-dlp-shortcut.sh` works on almost any media site supported by `yt-dlp` (YouTube, SoundCloud, Vimeo, Bandcamp, Twitch, etc.).
  5. **Beginner-Friendly Dependency & Setup Guide (Linux / Debian 13.7 GNOME / LMDE 7 Cinnamon / macOS / Windows):** Plain-language explanation of where to get `yt-dlp`, `ffmpeg`, and `rsgain`, plus a dedicated tip encouraging non-technical users to paste the prerequisites block into their AI assistant for guided step-by-step installation on their system.
  6. **Forking for Brave, Chrome, Edge & Safari:** How the `extension/` WebExtension and `yt-dlp-native-host.py` architecture can be adapted to Chromium (`chrome.runtime.sendNativeMessage` + Chromium `NativeMessagingHosts` paths) and Safari (`xcrun safari-web-extension-converter`).
- `docs/AMO-PUBLISHING.md`:
  - Adds a section on **AMO Store Policy, Copyright & Trademark Best Practices** (why Mozilla allows Native Messaging bridges like `ff2mpv`, why `scripts/sign-xpi.sh` unlisted signing is takedown-proof, and how to phrase public store titles using `"for YouTube"` nominative fair use).

- [ ] **Step 1: Update `README.md` and `docs/AMO-PUBLISHING.md`**
- [ ] **Step 2: Run full test & validation suite (`python3 -m unittest discover -s tests`, `bash tests/test_shortcut.sh`, `node tests/test_firefox_extension.js`, `git diff --check`)**
- [ ] **Step 3: Commit**
