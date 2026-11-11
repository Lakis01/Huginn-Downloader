# Firefox setup: YouTube context actions and player controls

This setup keeps the existing External Application Launcher apps and adds a
Tampermonkey control group to YouTube watch pages. The extension's Pre JavaScript
reads the most recently right-clicked YouTube card link from the page; it is not
a direct page-script bridge for launching a saved extension app.

## Import the corrected External Application Launcher settings

Import the generated file
`~/Downloads/external-application-button-preferences-fixed.json` using the
extension's full settings import:

1. In Firefox, open `about:addons`.
2. Select **External Application Launcher** and open its **Options** or
   **Preferences** page.
3. Choose **Import Settings**.
4. Select `external-application-button-preferences-fixed.json` from Downloads
   and confirm the import.

This generated JSON is a **complete export** based on the existing settings,
not a partial import or hand-built settings fragment. Import replaces all
External Application Launcher settings, so use this complete file only. It
retains all existing app records, IDs, icons, executable paths, Pre JavaScript,
contexts, toolbar settings, and unrelated preferences. Only the three YouTube
apps' arguments, target pattern, and document filter are changed.

The corrected arguments are:

| Existing app | Arguments |
| --- | --- |
| Download YouTube Audio | `audio "[PRE_SCRIPT]" "[HREF]"` |
| Download YouTube Video | `video "[PRE_SCRIPT]" "[HREF]"` |
| Cut YouTube Audio | `cut "[PRE_SCRIPT]" "[HREF]"` |

Each quoted placeholder is passed as a separate argument with no shell
evaluation. The launcher uses the first candidate that is a valid YouTube
watch/shorts/music URL: `[PRE_SCRIPT]` (the right-clicked card link, or the
current page URL) first, then `[HREF]` (the clicked link target) as a safe
fallback. Invalid or empty first candidates fall through to the second; if
neither is valid, the launcher keeps its existing primary-selection, active
media, and clipboard fallbacks.

The imported apps have an empty **target pattern** and a **document/page URL
filter** of `https://www.youtube.com/*, https://music.youtube.com/*`. The
target pattern is intentionally cleared: image and video previews can use
`blob:` URLs even though the containing document is YouTube. The existing
Pre JavaScript is preserved and should not need to be re-entered:

```javascript
document.currentScript.output = window.__ytdlLastContextHref || location.href;
```

The `[PRE_SCRIPT]` argument is replaced with the value assigned to
`document.currentScript.output`, and `[HREF]` is replaced with the clicked
link's URL. The Audio, Video, and Cut modes then pass those two candidates to
the existing `yt-dlp-shortcut.sh` launcher. A right-click on a card uses its
own `/watch` or `/shorts/` link; a right-click elsewhere uses the current
page URL. Keep the quotes exactly as shown so URLs containing `&` or `'`
arrive intact as separate arguments.

Do not import the unmodified export or any partial/hand-built JSON. The
extension's import replaces all settings; the generated `*-fixed.json` file is
safe to import because it is the patched complete export.

Firefox may group the app entries under the External Application Launcher
extension submenu in its right-click menu rather than showing them at the top
level.

## Import the Tampermonkey userscript

1. Save `firefox/youtube-ytdlp-buttons.user.js` from this repository as a local
   `.user.js` file.
2. In Firefox, open the Tampermonkey toolbar menu and choose **Dashboard**.
3. Open the **Utilities** tab, choose **Import from file**, select the saved
   `youtube-ytdlp-buttons.user.js`, and choose **Import**.
4. Review the script in the editor and choose **Install**. Confirm that the
   script is enabled in the Tampermonkey Dashboard.
5. Reload a YouTube or YouTube Music watch page. The compact **Download audio**,
   **Download video**, and **Cut audio** links appear between Subscribe and the
   Like/Dislike controls.

Clicking a link opens a `yt-dlp://audio`, `yt-dlp://video`, or `yt-dlp://cut`
URI for the current watch URL. On first use, Firefox may ask whether to open the
external application. Confirm the registered YouTube Downloader / `yt-dlp://`
handler (and choose to remember the decision only if desired). If Firefox does
not offer the handler, check that the system URI handler is installed and
registered before changing browser settings.

## KDE shortcuts and URL selection

Set these bindings in KDE System Settings if they are available:

- `Meta+Alt+A` — audio
- `Meta+Alt+V` — video
- `Meta+Alt+C` — cut audio

KDE global hotkeys resolve the **active media** URL (with the launcher's
documented fallbacks), not the card under the pointer. Right-click context
actions capture the **hovered YouTube card** link instead. Use the right-click
menu when you want a specific feed/sidebar card rather than the active player.
