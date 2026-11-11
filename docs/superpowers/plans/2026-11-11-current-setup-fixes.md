# Current YouTube Downloader Setup Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the user's current sidecar, protected-video diagnostics, EAL context targeting, sidebar preview targeting, and YouTube button styling without changing unrelated browser or yt-dlp settings.

**Architecture:** Update the existing wrapper to locate both yt-dlp info-sidecar conventions and produce clear, optionally cookie-authenticated metadata errors. Make the KDE/EAL launch path accept multiple validated candidate URLs. Update the userscript to target YouTube's newer recommendation cards and autoplay overlays, and size/stylize its controls to match the screenshot. Modify the real EAL app preferences only from a complete settings export or safe real-profile UI access; never edit its live IndexedDB directly.

**Tech Stack:** Existing Python/Mutagen/yt-dlp wrapper, Firefox/Tampermonkey userscript, KDE/Bash launcher, External Application Launcher configuration, current test suites.

**Spec:** `docs/superpowers/specs/2026-11-10-youtube-downloader-design.md` plus this approved follow-up request.

## Global Constraints

- The info JSON may be either `<media-stem>.info.json` or `<media-path>.info.json`; use a same-directory file only and clean the one used after successful tagging.
- When an auth-gated metadata request fails, retry once with `--cookies-from-browser firefox`. Do not log or persist cookies. A members-only error after retry means the browser account lacks channel access; do not bypass it.
- Show yt-dlp's actual actionable error and exit without a Python traceback.
- EAL arguments may provide more than one URL candidate; select the first valid YouTube URL (Pre Script first, `[HREF]` fallback) without shell interpolation.
- Do not overwrite or create another `~/.config/yt-dlp/config`; the current installer must leave configuration files untouched. For later machines, create a config only when none exists, and preserve an existing file.
- Do not import a partial EAL export, do not modify its live IndexedDB, and do not overwrite unrelated apps/preferences. A real settings update requires a complete export from the real profile or safe UI access.
- Use the user's screenshots as the visual reference: compact YouTube-tonal buttons, slightly larger than current, with real SVG icons and dark/light contrast.

## Review Focus

1. Both yt-dlp info sidecar naming patterns resolve without reading a path outside the media directory; failed tagging still preserves source and sidecar files.
2. A cookie retry is limited to auth-classified errors; a members-only failure after retry explains that account membership is required and never emits a traceback.
3. Multiple URL candidates with empty/invalid Pre Script values select a valid `[HREF]`; malformed custom URIs fail closed and never launch a fallback download.
4. Right-click on a recommendation card covered by a video preview selects the card's URL; playlist/music cards and `yt-lockup-view-model` are covered.
5. Button dimensions, contrast and spacing are checked against the supplied screenshot; repeated SPA events still do not duplicate buttons.
6. A full EAL config update preserves unrelated apps and icons; if a complete export/real profile isn't available, do not fabricate a replacement export.

---

### Task 1: Fix info sidecars and yt-dlp access diagnostics

**Files:**
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Preserve `finalize_audio_download(media_path, filename_suffix="")` and `parse_audio(url)` call behavior for existing callers.
- Add a same-directory info-sidecar resolver that prefers `<stem>.info.json` and falls back to `<media-name>.info.json`.

- [ ] Add a red regression with `Tommo - The Liam Lawson problem.opus` plus `Tommo - The Liam Lawson problem.info.json`; assert tagging succeeds, cleans only that sidecar, and calls rsgain once.
- [ ] Add a regression for the appended `<media-name>.info.json` convention to preserve compatibility.
- [ ] Add mocked metadata-fetch tests: unauthenticated auth error retries once with `--cookies-from-browser firefox`; successful retry supplies credentials to the ensuing download; a still-blocked members-only result reports the yt-dlp reason without traceback.
- [ ] Implement same-directory candidate lookup and a clear `YtDlpError`/CLI error path. Never print cookie contents; don't retry unrelated errors.
- [ ] Run the wrapper tests red before implementation and green afterward; run the full Python suite.

### Task 2: Fix EAL candidate selection and saved app settings

**Files:**
- Modify: `bin/yt-dlp-shortcut.sh`
- Modify: `tests/test_shortcut.sh`
- Modify: `firefox/external-application-launcher-setup.md`

**Interfaces:**
- Launcher accepts `[mode] [candidate-url ...]` and chooses the first valid YouTube URL before normal clipboard/MPRIS fallback.
- EAL args are `audio "[PRE_SCRIPT]" "[HREF]"`, `video "[PRE_SCRIPT]" "[HREF]"`, and `cut "[PRE_SCRIPT]" "[HREF]"`.

- [ ] Add tests for empty/invalid Pre Script URL followed by valid HREF, preserving apostrophes and ampersands as separate safe argv values.
- [ ] Update the guide to explain that YouTube domains belong in the lower document/page filter box; leave the upper target pattern empty/broad for blob and thumbnail contexts.
- [ ] Fix the three stored EAL apps only from a complete export or controlled real-profile options UI. Preserve icons and every unrelated app/setting; no partial import or direct live IndexedDB writes. If neither safe access method is available, stop and ask the user for the full export or real-profile access.
- [ ] Verify the installed values use the candidate args, broad target pattern, and YouTube document filter.

### Task 3: Improve YouTube recommendation targeting and button fit

**Files:**
- Modify: `firefox/youtube-ytdlp-buttons.user.js`
- Modify: `tests/test_youtube_buttons.js`

- [ ] Add red fixture cases for `yt-lockup-view-model`, a right-column recommendation under a `ytd-video-preview` overlay, and the hovered card URL obtained through `document.elementsFromPoint()`.
- [ ] Add a fixture assertion for the screenshot-matched slightly larger tonal button dimensions and dark/light fallback colors.
- [ ] Implement selectors/point-through behavior and compact button sizing (40px control height, 20px SVG, 16px horizontal padding, 20px radius) while preserving current text, ARIA labels, keyboard focus, route handling, and click URIs.
- [ ] Run Node fixture/syntax tests and Impeccable detector. Live render remains manual if Firefox MCP can't attach to the real profile.

### Task 4: Preserve future-host yt-dlp configuration

**Files:**
- Modify: `README.md`
- Modify: `install.sh` only if needed.

- [ ] Document that future cross-distro installation must use a user-selected download directory and never create/overwrite `~/.config/yt-dlp/config` when one already exists.
- [ ] Add or retain an installer test proving an existing yt-dlp config is unchanged and that no duplicate config is created by the current install.

### Task 5: Verify and hand off current machine

- [ ] Run Python, Bash, Node, desktop validation, installer dry-run, compatibility smoke checks, and the style detector.
- [ ] Install only after test/review gates; preserve timestamped backups and do not touch existing downloads or run rsgain against unrelated files.
- [ ] Review the complete diff; document live Firefox/EAL checks that could not be done through the isolated MCP profile.
