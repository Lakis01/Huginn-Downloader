# Audio Format Pipeline, Live `rsgain` Check, Tampermonkey Guard, Auto-Signing & Comprehensive Docs — Design Spec

## Intent

Complete `v2.2.0` of the **Firefox YouTube Downloader Plugin**:
1. Keep **Native Opus / M4A (`best`, zero conversion)** as the default while adding optional **MP3 (`V0` VBR default, `320k` CBR, `V2` VBR, `128k` CBR)**, **M4A (native-first AAC)**, **Ogg Vorbis**, and **FLAC** conversion in the pipeline and popup UI.
2. Check whether `rsgain` is installed when the user toggles ReplayGain ON in the Firefox popup, blocking activation with a helpful install message if `rsgain` is missing.
3. Prevent any leftover Tampermonkey `YouTube yt-dlp controls` userscript DOM (`<a>` links / `#ytdl-controls-style`) from blocking or clashing with the extension's segmented `<button>` pill.
4. Provide `scripts/sign-xpi.sh` so builds automatically produce an AMO-signed `.xpi` (`dist/firefox-youtube-downloader-signed.xpi`) whenever `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are exported in the environment.
5. Rewrite `README.md` for both technical and non-technical users: Official Art Tracks (`Provided to YouTube by ...`), native `.opus`/`.m4a` vs. 320 kbps `.mp3` transcoding truth, `Cut Audio` defaults (`117 kbps` Opus VBR, 2ch, `audio`), any-site global shortcuts, screenshot sections, AI-assisted dependency installation, AMO store survival/trademark guidance, and forking for Brave/Chrome/Edge/Safari.

## Architecture & Contracts

### 1. Configuration (`bin/ytdl_config.py`)
- `SUPPORTED_AUDIO_FORMATS = ("best", "mp3", "m4a", "ogg", "flac")`
- `SUPPORTED_MP3_QUALITIES = ("V0", "320k", "V2", "128k")`
- Default config:
  ```json
  {
    "download_dir": null,
    "auto_tag": true,
    "rsgain": false,
    "audio_format": "best",
    "mp3_quality": "V0"
  }
  ```
- Existing config files missing `audio_format` or `mp3_quality` default to `"best"` and `"V0"`.

### 2. Audio Format Pipeline (`bin/yt-dlp-wrapper.py` & `bin/ytdl_meta.py`)
- `_audio_format_args(config)`:
  - `"best"`: `["-f", "bestaudio", "-x", "--audio-format", "best"]` (downloads YouTube's highest-quality native stream — Opus 251 or M4A 140 on past livestreams — with zero FFmpeg audio re-encoding).
  - `"mp3"`: `["-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", {"V0": "0", "320k": "320K", "V2": "2", "128k": "128K"}[mp3_quality]]`.
  - `"m4a"`: `["-f", "bestaudio[ext=m4a]/bestaudio", "-x", "--audio-format", "m4a"]` (prefers YouTube's native AAC `.m4a` stream without re-encoding when available, transcoding only if absent).
  - `"ogg"`: `["-f", "bestaudio", "-x", "--audio-format", "vorbis", "--audio-quality", "0"]`.
  - `"flac"`: `["-f", "bestaudio", "-x", "--audio-format", "flac"]`.
- `bin/ytdl_meta.py` adds `.flac` support (`mutagen.flac.FLAC`, Vorbis comments + `Picture` block with `image/webp` cover art and `language`/`lang` stripping).

### 3. Extension UI (`extension/` v2.2.0) & Auto-Signing (`scripts/sign-xpi.sh`)
- `extension/content.js`: marks extension-mounted pill with `data-ytdl-ext="true"`, strips legacy `#ytdl-controls-style`, and replaces any legacy Tampermonkey `[data-ytdl-controls]:not([data-ytdl-ext="true"])` element.
- `extension/popup.{html,css,js}`:
  - Audio Format dropdown (`best`, `mp3`, `m4a`, `ogg`, `flac`) and conditional MP3 Quality dropdown (`V0` recommended, `320k`, `V2`, `128k`) with a concise note explaining why native Opus/M4A avoids lossy re-encoding.
  - Live `rsgain` dependency check when toggling `#rsgain` ON: if `deps.rsgain === false`, keeps `#rsgain` unchecked and displays `#rsgainMissingNote` with install instructions.
- `scripts/sign-xpi.sh`: signs `extension/` via `npx web-ext sign --channel=unlisted` when `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are set in the environment and copies the signed archive to `dist/firefox-youtube-downloader-signed.xpi`.
