# Huginn Downloader 2.5.2

Huginn Downloader is the Firefox frontend for the locally installed Native
Messaging companion and `yt-dlp` backend. Both the extension and companion are
required. Existing Firefox add-on, Native Messaging, package, configuration,
and install identifiers remain unchanged for in-place upgrades.

## Changes

- Replaced the raven artwork with the new layered vector logo across the
  Firefox toolbar button, add-on metadata, context-menu root item, and GitHub
  README header (`SVG`, lossless `WebP`, and archival lossless `AVIF`).
- Refreshed the context-menu screenshot for the Huginn Downloader branding and
  added a toolbar-popup screenshot showing live companion connection status and
  format/tagging controls.
- Documented that each triggered download starts an independent `yt-dlp`
  session, allowing multiple audio, video, or cut downloads to run in parallel
  without waiting for an active download to finish.

## Release files

- `huginn-signed.xpi`
- `huginn-companion_2.5.2_all.deb`
- `huginn-companion-2.5.2-1.noarch.rpm`
- `huginn-downloader-2.5.2-source.tar.gz`
- `huginn-downloader-2.5.2-arch-pkgbuild.tar.gz`

Use Huginn Downloader only for content you are authorized to download. Running
the companion locally does not itself grant download rights.
