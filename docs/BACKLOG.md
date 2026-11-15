# Backlog

## Completed since last cycle

- Removed the remote `feature/youtube-downloader-sdd` branch after confirming its PR (#1) was merged and it had no unique commits versus `main`.
- Replaced the raven artwork with the maintainer-selected generated logo. Added an identically cropped transparent SVG, lossless WebP, and lossless AVIF in `docs/logo/`, embedded `docs/logo/huginn-logo.webp` at the top of `README.md`, and wired `extension/icons/huginn-logo.svg` directly into the toolbar and context-menu root.
- Documented in `README.md` that downloads launch independent sessions and can run in parallel without waiting for an earlier download to finish.
- Replaced `docs/screenshots/context-menu.png` with the rebranded Huginn context-menu capture and added `docs/screenshots/toolbar-popup.png` to `README.md`.

## Companion distribution

- Investigate standalone companion installers for Windows (`.exe`) and macOS (signed/notarized `.pkg` or app bundle), including browser Native Messaging registration and update/removal behavior. Keep the signed Firefox XPI as a separate release asset.
- Document and test upgrades within each package family, plus migration between the per-user `install.sh` install and system `.deb`/`.rpm`/Arch packages without touching user configuration.

## Additional browser extensions

- Build browser-specific extension shells that can share the existing Native Messaging companion. Start by investigating Chromium-family manifest origins and registration paths; treat Safari's app-extension and packaging model as a separate compatibility question rather than assuming the Firefox manifest works everywhere.
