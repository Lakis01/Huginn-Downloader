# YouTube Downloader

Maintained source for the user's yt-dlp wrapper, description-derived music tags, KDE launchers, and Firefox integration.

The implementation plan is in `docs/superpowers/plans/2026-11-10-youtube-downloader.md`; its design is in `docs/superpowers/specs/2026-11-10-youtube-downloader-design.md`.

Installation, Firefox setup, and rollback instructions will be completed with the implementation.

## KDE launchers

The audio, video, and interactive-cut desktop launchers are intended for the
global shortcuts `Meta+Alt+A`, `Meta+Alt+V`, and `Meta+Alt+C` rather than the
existing `Ctrl+Alt` bindings. Set these in KDE System Settings if they are
available on your system; the installer does not change existing KDE key
bindings. The `yt-dlp://` URI handler is installed alongside the launchers.

`./install.sh` shows the files and URI registration that would be applied.
Use `./install.sh --install` to install into `~/.local/bin` and
`~/.local/share/applications`; existing destination files are backed up before
replacement. The installer does not alter KDE shortcuts.
