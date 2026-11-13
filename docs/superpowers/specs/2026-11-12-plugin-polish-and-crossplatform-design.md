# Firefox YouTube Downloader Plugin — Polish, Native WebP, Autoplay Menu, Version Check & Cross-Platform Design

## Intent

Polish the live user experience based on real-world testing and prepare the repository for cross-platform sharing and Mozilla Add-ons (`addons.mozilla.org`) store publication:
1. Vertically align the watch-page segmented pill onto the exact horizontal centerline of YouTube's Subscribe and Like/Dislike/Share controls.
2. Silence noisy `yt-dlp` extractor/thumbnail-probing console lines while preserving real-time download progress bars.
3. Download and embed YouTube's native `.webp` thumbnails directly as `image/webp` without converting `.webp -> .jpg`.
4. Fix the right-click context menu disappearing after YouTube's inline hover-autoplay preview activates.
5. Detect out-of-date `yt-dlp` installations smartly (cached latest-release check + release-date age fallback + install-method-specific update command) and surface clear guidance when downloads fail or in the popup.
6. Support Linux (Debian 13.7 GNOME, LMDE 7 Cinnamon, KDE, etc.), macOS, and Windows, and document Firefox extension signing and AMO Store publication.

## Root Causes Confirmed

1. **Watch-page pill vertical offset:** Measurement of `Screenshot_20261112_094053.png` (`1798×118`) showed `[data-ytdl-controls]` at `top=41px, center=67.0px` while Subscribe (`top=55px, center=83.5px`) and Like (`top=58px, center=86.5px`) sit lower because YouTube applies `margin-top: 12px` to `#owner` and `#actions` inside `ytd-watch-metadata #top-row`. Adding `margin-top: 12px; align-self: center;` moves our 40px pill's center to `86.0px` (within 0.5px of Like/Share).
2. **`yt-dlp` log noise & double thumbnail conversion:**
   - `tv samsung player API JSON`, `visionos player API JSON`, and `[jsc:deno]` are `yt-dlp`'s modern multi-client anti-throttling/SABR signature solvers. Passing `-q --progress` (`--quiet --progress`) silences all `[youtube]`/`[info] Video Thumbnail xx does not exist` chatter while keeping live `[download]` progress bars and `ERROR:` stderr diagnostics.
   - Passing `--convert-thumbnails jpg` forced FFmpeg to convert YouTube's native `.webp` thumbnail to `.jpg` before Pillow re-encoded it to JPEG. Removing `--convert-thumbnails jpg` keeps YouTube's native `.webp` file; Opus, Ogg, and MP3 embed `image/webp` directly (preserving original uncropped `.webp` bytes untouched, and encoding cropped Art Track squares once to `WEBP quality=88`). M4A/MP4 retains `FORMAT_JPEG` only because the MP4 `covr` atom specification defines integer type codes solely for JPEG (`13`) and PNG (`14`).
3. **Hover-autoplay right-click menu disappearance:**
   - Live YouTube DOM inspection showed inline hover-autoplay mounts `div#video-preview > ytd-video-preview-loader > div > ytd-video-preview` over the card with `<video src="blob:...">` and sibling `yt-inline-player-controls` (`info.linkUrl` becomes `undefined`).
   - Because `manifest.json` has `"activeTab"` (not `"tabs"`), `info.pageUrl` is not populated during `menus.onShown` when `info.linkUrl` is absent, and `persistent: false` wake-ups re-ran `menus.create()` concurrently with `menus.onShown`, hiding `ytdl-root`.
   - Replacing `onShown` visibility gating with static parent-process `documentUrlPatterns` (`*://*.youtube.com/*`, `*://youtube.com/*`, `*://*.youtu.be/*`, `*://youtu.be/*`) on `contexts: ['page', 'frame', 'link', 'image', 'video', 'audio', 'selection']` (created once in `onInstalled`/`onStartup` with zero `onShown` toggling, plus `'ytd-video-preview'` + `'#video-preview'` in `CARD_SELECTOR`, `blob:` URL unwrapping in `isYouTubeUrl`, and right-button `pointerdown` + `contextmenu` capture) guarantees 0ms synchronous menu display on YouTube pages, embedded YouTube frames, and inline autoplay previews without needing `"tabs"` permission.

## Smart Out-of-Date `yt-dlp` Detection (`bin/ytdl_version.py`)

- **Zero slowdown on normal runs:** Stores a 24-hour TTL cache in the OS user cache directory (`~/.cache/youtube-downloader/ytdlp-version.json` on Linux, `~/Library/Caches/...` on macOS, `%LOCALAPPDATA%\...` on Windows).
- **Popup & post-success check:** Uses the cached status (`allow_network=False` in `ping`/`get_config` so popup opens instantaneously; refreshes at most once per 24h on CLI runs with a 1.8s timeout that never fails offline runs). Also flags versions whose `YYYY.MM.DD` calendar date is > 45 days old when offline.
- **On download failure (`_YtDlpError`):** Performs a live release check (if cache is absent/stale) and prints a prominent warning with a tailored update command matching the detected installation (`apt`/backports/`pipx` guidance on Debian & LMDE, `pacman`/`dnf`/`zypper`, `brew upgrade yt-dlp` on macOS, `winget upgrade yt-dlp.yt-dlp` / `scoop` on Windows, or `yt-dlp -U` for standalone binaries).

## Cross-Platform & Store Publishing Scope

- **Linux, macOS, and Windows:**
  - `wait_for_keypress()` supports POSIX (`termios`/`tty`) on Linux/macOS and `msvcrt.getch()` on Windows.
  - `yt-dlp-native-host.py` launches `yt-dlp-shortcut.sh` on Linux, `Terminal.app` (`.command` / `osascript` argv-safe launcher) on macOS, and Windows Terminal (`wt.exe`) or `CREATE_NEW_CONSOLE` on Windows.
  - `install.py` provides portable installation for macOS (`~/Library/Application Support/Mozilla/NativeMessagingHosts/`) and Windows (`%LOCALAPPDATA%\FirefoxYouTubeDownloader\` + `HKCU\Software\Mozilla\NativeMessagingHosts\firefox_youtube_downloader`, wrapped by `install.ps1`), while `install.sh` continues serving Linux (and delegates macOS Native Messaging manifest paths cleanly).
- **AMO Store & Signing Guide (`docs/AMO-PUBLISHING.md` + `README.md`):** Step-by-step walkthrough for signing unlisted `.xpi` releases and submitting a listed extension to `addons.mozilla.org`, plus multi-OS user setup documentation.
