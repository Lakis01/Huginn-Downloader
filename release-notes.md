# Huginn Downloader 2.5.1

Huginn Downloader is the renamed Firefox frontend for the locally installed
Native Messaging companion and `yt-dlp` backend. Both the extension and
companion are required. Existing Firefox add-on, Native Messaging, package,
configuration, and install identifiers remain unchanged for upgrades.

## Changes

- Debian dependency setup checks commands and Python imports before installing
  missing packages, so a PATH-installed `yt-dlp` is not replaced by an older
  apt copy. Debian's companion package only hard-depends on Python 3.
- Downloads prefer `~/.local/bin` tools when Firefox is launched from the
  desktop. An outdated `yt-dlp` version is reported as a warning, not a
  download gate.
- Linux audio, video, and downloads presets follow XDG user directories,
  including localized paths such as `~/Musik`. Populated legacy folders and
  custom paths are preserved; files are not moved.
- Turning off automatic tagging while a download is running skips the tagging
  copy step and removes generated sidecars. Files with no usable tag metadata
  or cover art also avoid an unnecessary copy. Long-audio routing remains
  supported.
- The settings popup uses concise audio-format labels and puts forced Opus last.
  Pin Huginn Downloader to Firefox's toolbar for one-click access to settings.
- Updated visible names, raven icon, repository links, and release asset names.

## Release files

- `huginn-signed.xpi`
- `huginn-companion_2.5.1_all.deb`
- `huginn-companion-2.5.1-1.noarch.rpm`
- `huginn-downloader-2.5.1-source.tar.gz`
- `huginn-downloader-2.5.1-arch-pkgbuild.tar.gz`

Use Huginn Downloader only for content you are authorized to download. Running
the companion locally does not itself grant download rights.
