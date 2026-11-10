# YouTube Downloader and Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make YouTube audio/video/cut downloads work reliably from Firefox/KDE and produce properly tagged, ReplayGain-scanned audio.

**Architecture:** Keep maintained source and tests in this repository. yt-dlp downloads audio and its info/thumbnail sidecars; `ytdl_meta.py` parses, tags, names, and cleans each output using Mutagen/Pillow; the wrapper then scans one file at a time with rsgain. KDE launchers resolve active media URLs; Tampermonkey buttons use a registered `yt-dlp://` handler, while External Application Launcher remains responsible for right-click actions.

**Tech Stack:** Python 3, Mutagen, Pillow, yt-dlp, ffmpeg, rsgain, Bash, Tampermonkey JavaScript, KDE desktop entries.

**Spec:** `docs/superpowers/specs/2026-11-10-youtube-downloader-design.md`

## Global Constraints

- Retain `parse_info(info)` compatibility keys used by `~/.local/bin/yt-to-forerunner`: `artist`, `title`, `album`, `date`, `composer`, `is_tagged`, and `duration`.
- `date` and `originaldate` must be `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; use the official description's `Released on:` value before the video upload date. A distinct earlier ℗ year is stored as `originaldate`.
- Preserve a featuring credit verbatim in `artist`; write distinct names as multi-valued `artists`. Do not split `&` within an artist name.
- Save audio/cut outputs with safe `Artist - Title` names; remove temporary info/thumbnail sidecars after tagging.
- Use `rsgain custom -s i` one output file at a time, retaining the default tag mode.
- Never import a partial External Application Launcher export; its import replaces all extension settings.
- On-page buttons use `yt-dlp://` and may trigger Firefox's external-application confirmation.

## Review Focus

1. DDEX artists such as `Simon & Garfunkel` must remain one artist; a feature such as `Artist A feat. Artist B` must preserve its display string and expose individual `artists` values (Task 1 tests).
2. `Released on:` wins over ℗ and upload dates, partial dates stay partial, and an earlier ℗ year maps to `originaldate` (Task 1 tests).
3. Credits with multiple roles and PRO suffixes must map to the right multi-value tags without duplication (Task 1 tests).
4. Container-specific free-form fields and front-cover image dimensions must be correct for Opus and M4A (Task 2 tests).
5. Failed downloads, filename collisions, apostrophes in URLs, custom-scheme URLs, and unavailable MPRIS must fail safely or use the documented fallback (Tasks 3-4 tests).
6. Repeated YouTube SPA navigation must not duplicate buttons; a direct click must encode the current watch URL into the custom scheme (Task 5 tests).

---

### Task 1: Parse Art Track and fallback metadata

**Files:**
- Create: `bin/ytdl_meta.py` (porting the user's existing parser)
- Create: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces `parse_info(info: dict) -> dict` with backward-compatible keys plus `artists`, `albumartist`, `originaldate`, `label`, `copyright`, `distributor`, `publisher`, `isrc`, `genre`, `recordingdate`, `studio`, and multi-value `composers`, `lyricists`, `producers`, `arrangers`, `conductors`, `engineers`, `performers`, and `instruments`.
- Produces `sanitize_filename(text: str) -> str`.

- [ ] Write parser tests for official Art Track detection, metadata and role credits, artist display/multi-value behavior, partial/full date handling, fallback cleanup, and safe filenames.
- [ ] The official fixture must include `Provided to YouTube by Sony`, `Stay (feat. Earth, Wind & Fire) · Rihanna · Earth, Wind & Fire`, album `Unapologetic`, `℗ 1979 Def Jam Recordings`, `Released on: 2012-11-19`, `Composer, Lyricist: Mikky Ekko`, `Writer: Justin Parker   BMI`, `Producer: Mikky Ekko`, `Mixing Engineer: Manny Marroquin`, `Music Publisher: Kobalt Music Publishing`, `ISRC: USUM71212345`, `Genre: Pop`, `Recording Date: 2012`, and `Studio: Example Studios`. Assert `title == "Stay"`, `artist == "Rihanna feat. Earth, Wind & Fire"`, `artists == ["Rihanna", "Earth, Wind & Fire"]`, primary `albumartist == "Rihanna"`, album/date/originaldate/label/distributor, composers and lyricists both include Mikky Ekko, writer is included as composer, producer/engineer/publisher/isrc/genre/recordingdate/studio values.
- [ ] Add an Art Track co-credit fixture `Mountains Falling · David Lynch · John Neff` and assert the two artists stay distinct. Add `The Sound of Silence · Simon & Garfunkel` and assert `Simon & Garfunkel` stays one entity.
- [ ] Add labelled `Arranger`, `Conductor`, `Associated Performer`, `Studio Personnel, Recording Engineer`, `Studio Personnel, Mastering Engineer`, and instrument-role lines and assert their values are retained under their corresponding structured credit keys.
- [ ] Test `Released on: 2020-05` → `date == "2020-05"`; ℗ only `2004` → `date == "2004"` and blank `originaldate`; `upload_date: "20240315"` → fallback date `2024-03-15`.
- [ ] Test fallback title `Artist A featuring Artist B - My Song (Official Music Video) [4K]` → artist retains `Artist A featuring Artist B`, artists are the two names, title is `My Song`; also test `Cool Track (Lyrics) (feat. Guest)` with uploader/channel `MainActVEVO` / `Main Act - Topic` → artist `Main Act feat. Guest`, artists `Main Act` and `Guest`, title `Cool Track`.
- [ ] Test `sanitize_filename('AC/DC: What\'s "Up"?*')` leaves no `/\\:*?"<>|` characters and strips trailing dots/spaces.
- [ ] Run `python3 -m unittest discover -s tests -v` and confirm the new cases fail before implementation.
- [ ] Implement the parser and sanitizer with conservative, role-labelled description parsing; do not split DDEX artist entities blindly on `&` or `and`.
- [ ] Re-run the focused tests and verify legacy compatibility keys remain present.

### Task 2: Write container-native tags and artwork

**Files:**
- Modify: `bin/ytdl_meta.py`
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces `tag_audio_file(filepath, meta, thumbnail_path=None) -> None`.

- [ ] Add generated-media tests for Vorbis/Opus and M4A tags, including multivalue `artists` and credits, clean comment/URL fields, and front-cover metadata.
- [ ] In Opus, assert `artist`, `artists`, `album`, `albumartist`, normalized dates, `composer`, `lyricist`, `producer`, `engineer`, and `label` are true multi-value Vorbis comments; verify description/purl/synopsis/comment/webpage_url are absent and an official 1280×720 thumbnail embeds as 720×720. In M4A, assert standard title/artist/album/date atoms, artists as `----:com.apple.iTunes:ARTISTS` freeforms, and `covr` exists.
- [ ] For a fallback non-Art-Track file, assert a 1280×720 thumbnail remains uncropped and single-artist metadata omits an `artists` field.
- [ ] Run the focused tests and confirm they fail before implementation.
- [ ] Implement native Mutagen tag mappings for Vorbis comments, MP4 free-form tags, and ID3 where available; center-crop only official landscape Art Track thumbnails.
- [ ] Re-run tests and verify `yt-to-forerunner --help` can still import the compatibility parser once installed.

### Task 3: Finalize audio, video, and cut downloads

**Files:**
- Create: `bin/yt-dlp-wrapper.py` (porting the user's existing wrapper)
- Modify: `tests/test_ytdl_meta.py`

**Interfaces:**
- Produces CLI `yt-dlp-wrapper.py [audio|video|cut] <url>` and testable `finalize_audio_download(...)`.

- [ ] Add tests for info/thumbnail sidecar discovery, output rename/collision behavior, one-file rsgain invocation, and failure preservation.
- [ ] Assert audio and cut omit `--embed-metadata`, include info JSON and thumbnail sidecars, use the post-move filepath, call `rsgain custom -s i` once per output file, and retain each cut's requested bitrate/channel/application args. Verify a failed retag leaves the downloaded original intact and a collision gets a numeric suffix.
- [ ] Run the focused tests and confirm they fail before implementation.
- [ ] Implement audio and cut downloads without `--embed-metadata`; tag using the saved yt-dlp info JSON, then run `rsgain custom -s i <file>` individually. Preserve the cut bitrate/channel/application FFmpeg arguments. Keep video mode's existing stream/thumbnail behavior.
- [ ] Run unit tests and a mocked end-to-end wrapper test without downloading real media.

### Task 4: KDE launchers, URI handler, and safe installation

**Files:**
- Create: `bin/yt-dlp-shortcut.sh`
- Create: `desktop/net.local.yt-dlp-shortcut.sh.desktop`, `desktop/net.local.yt-dlp-shortcut.sh-2.desktop`, `desktop/net.local.yt-dlp-shortcut.sh-3.desktop`, and `desktop/net.local.yt-dlp-uri.desktop`
- Create: `install.sh`
- Create: `tests/test_shortcut.sh`

**Interfaces:**
- Shortcut mode resolution: explicit URL/URI first; otherwise validated primary selection, Plasma Browser Integration MPRIS active-media URL, then clipboard.
- URI format: `yt-dlp://<audio|video|cut>?url=<percent-encoded-YouTube-URL>`.
- Installer stages `bin/ytdl_meta.py`, `bin/yt-dlp-wrapper.py`, and `bin/yt-dlp-shortcut.sh` into `~/.local/bin`, and all four desktop entries into `~/.local/share/applications`.
- Installation is dry-run by default; `--install` makes timestamped backups before replacing/deploying files.

- [ ] Test mode/URI parsing, valid YouTube URL filtering, apostrophes and ampersands, MPRIS extraction, and clipboard fallback.
- [ ] Shortcut URL precedence is explicit URL/URI, validated primary selection, Plasma Browser Integration MPRIS `xesam:url`, then validated clipboard; verify bad primary/clipboard values fall through and shell arguments are never evaluated.
- [ ] Fix desktop `Exec=` paths to absolute paths and add the custom URL protocol entry.
- [ ] Implement safe argument passing without shell interpolation, active-media URL lookup, and one-time backup installation behavior.
- [ ] Verify `bash -n`, `desktop-file-validate`, and the shell tests.
- [ ] Document the available KDE shortcuts `Meta+Alt+A`, `Meta+Alt+V`, and `Meta+Alt+C`; do not silently change KDE bindings.

### Task 5: Firefox context menu and persistent player buttons

**Files:**
- Create: `firefox/youtube-ytdlp-buttons.user.js`
- Create: `firefox/external-application-launcher-setup.md`
- Create: `tests/test_youtube_buttons.js`

- [ ] Test userscript URL encoding, current-watch URL selection, button de-duplication, and route/re-render reattachment with a lightweight DOM test harness.
- [ ] A simulated watch page has one persistent button group after subscribe and before the like/dislike actions; repeated route events and DOM mutations do not duplicate it, and each click creates the correct audio/video/cut URI with the current canonical watch URL.
- [ ] Implement Tampermonkey controls between Subscribe and Like/Dislike, inline icons, SPA listeners, and a debounced mutation observer.
- [ ] Make each direct user click navigate to a URI in the documented `yt-dlp://` format.
- [ ] Document safe manual External Application Launcher setup for the three existing apps with YouTube page/frame/link/image/audio/video contexts and no destructive partial import; document Tampermonkey import and Firefox's URI confirmation.
- [ ] Run JS syntax/tests and verify the setup guide names exact KDE shortcut bindings and limitations (global shortcuts resolve active media; right-click handles hovered links).

### Task 6: Package and verify the finished workflow

**Files:**
- Modify: `README.md`
- Modify: `install.sh`
- Modify: all tests above as needed.

- [ ] Document installation, rollback backups, manual browser setup, shortcut bindings, metadata rules, and troubleshooting.
- [ ] Run all Python and JavaScript/shell tests, syntax checks, desktop validation, and a dry-run installation check.
- [ ] Review the final diff for unrelated files and verify `yt-to-forerunner` compatibility.
