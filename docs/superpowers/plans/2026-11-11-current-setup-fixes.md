# Current YouTube Setup Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reported current-machine download failures and improve YouTube controls/menu targeting while preserving existing user settings.

**Architecture:** The wrapper recognizes both info sidecar names and reports yt-dlp errors cleanly, retrying auth failures once with Firefox cookies. The launcher accepts ordered URL candidates. The userscript targets new YouTube lockups and preview overlays and uses slightly larger tonal controls. The real External Application Launcher profile is updated only through a safe full export or its official options UI.

**Tech Stack:** Python 3, yt-dlp, Mutagen, Bash, Firefox/Tampermonkey JavaScript, External Application Launcher.

**Spec:** `docs/superpowers/specs/2026-11-11-current-setup-fixes.md` and `docs/superpowers/specs/2026-11-10-youtube-downloader-design.md`.

## Global Constraints

- Keep all info-sidecar candidates in the media directory; do not touch existing Downloads as test data.
- Retry `--cookies-from-browser firefox` only for recognized authentication errors; never log cookie contents or bypass a members-only entitlement.
- Report yt-dlp stderr to the user instead of a generic `CalledProcessError` traceback.
- EAL arguments prefer a valid `[PRE_SCRIPT]` URL, then valid `[HREF]`; arguments remain separate and shell-safe.
- Keep the on-page controls between Subscribe and Like/Dislike with accessible names, keyboard focus, inline SVGs, dark/light contrast, and no duplicated SPA mounts.
- Never import a partial EAL export or write the live Firefox IndexedDB. If real-profile access/full export is unavailable, ask before altering EAL preferences.
- Preserve an existing `~/.config/yt-dlp/config`; don't create a second one. Cross-machine download-directory configuration is future scope, not current deployment.

## Review Focus

1. `stem.info.json` and `media-path.info.json` both tag and clean correctly, while failures preserve media and sidecars (Task 1 tests).
2. Auth retry is exactly once and only for auth markers; cookies that still receive a membership error produce that clear message (Task 1 tests).
3. `[PRE_SCRIPT]` blank/invalid values fall through to a valid `[HREF]`; hostile strings are never evaluated by the shell (Task 2 tests).
4. A preview overlay above a `yt-lockup-view-model` recommendation still resolves the card URL; the page fallback remains correct (Task 3 tests).
5. Larger button geometry and high-contrast dark/light surfaces are asserted, with route and de-duplication behavior unchanged (Task 3 tests).

---

### Task 1: Info sidecars and yt-dlp access diagnostics

**Files:**
- Modify: `bin/yt-dlp-wrapper.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Keep `finalize_audio_download(media_path, filename_suffix="")` and existing CLI modes.
- Resolve `<media-stem>.info.json` before the appended `<media-path>.info.json` fallback.

- [ ] Add generated-file regression for `Tommo - The Liam Lawson problem.opus` plus `Tommo - The Liam Lawson problem.info.json`; assert sidecar cleanup after successful tag, and preserve existing appended-sidecar test.
- [ ] Add mocked tests for metadata auth retry once with `--cookies-from-browser firefox`, cookie use on the ensuing audio/cut command, and a final members-only message with no traceback.
- [ ] Run focused tests red before implementation.
- [ ] Implement sidecar resolution and a clear CLI exception path; never expose cookie values.
- [ ] Run wrapper and complete Python suites; don't run real downloads or rsgain as tests.

### Task 2: Candidate URLs for right-click launcher calls

**Files:**
- Modify: `bin/yt-dlp-shortcut.sh`
- Modify: `tests/test_shortcut.sh`
- Modify: `firefox/external-application-launcher-setup.md`

- [ ] Add shell tests proving invalid/empty first candidate falls through to valid second candidate, preserves query ampersands/apostrophes, and malformed URI remains fail-closed.
- [ ] Implement first-valid-candidate selection for `mode [PRE_SCRIPT] [HREF]` without shell evaluation.
- [ ] Update the guide to use quoted `[PRE_SCRIPT]` followed by quoted `[HREF]` for all three existing apps.
- [ ] Run shell tests and syntax check.

### Task 3: YouTube recommendation targeting and button sizing

**Files:**
- Modify: `firefox/youtube-ytdlp-buttons.user.js`
- Modify: `tests/test_youtube_buttons.js`

- [ ] Extend the DOM fixture to place a `yt-lockup-view-model` card beneath a `ytd-video-preview` overlay; assert context capture returns the card's URL via hit-testing.
- [ ] Add style assertions for 42px controls, 22px icons, 16px horizontal padding, 21px radius, 15px labels, and visible dark/light tonal fallbacks.
- [ ] Bump the Tampermonkey userscript version to `1.1.0` so importing the updated file is recognized as an update.
- [ ] Add new card selectors and inspect `document.elementsFromPoint()` entries to find the underlying card; preserve existing `/watch`/`/shorts/` fallback.
- [ ] Restyle the buttons to 42px high, 22px SVGs, 16px side padding, 21px radius, 15px labels, and YouTube-compatible dark/light backgrounds.
- [ ] Run Node fixture, syntax checks, and Impeccable detector. Record that live rendering is still manual if the MCP profile is not the user's real Firefox.

### Task 4: Safe update of the real External Application Launcher apps

**Files:**
- Update the user's three existing EAL app records only via a complete export/import or official options UI.

- [ ] Confirm the real profile contains the three expected apps and retain their icons and all unrelated settings.
- [ ] Update only their argument candidates and page/target filter fields.
- [ ] If the full export or safe real-profile UI is unavailable, stop before importing/writing and request the full settings export or needed browser access; do not fabricate a partial export.

### Task 5: Compatibility and final verification

- [ ] Confirm the installer does not create or overwrite `~/.config/yt-dlp/config`.
- [ ] Run Python, shell, Node, syntax, desktop, and dry-run installer checks; verify `yt-to-forerunner` still imports the parser.
- [ ] Review complete diff and report any live Firefox/EAL checks not possible with the isolated profile.
