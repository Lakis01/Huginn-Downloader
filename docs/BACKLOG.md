# Backlog

## Next build cycle

- Redesign the Firefox extension's raven icon. Review the five prompt directions prepared for the maintainer, choose a direction, and produce polished icon assets that remain recognizable at toolbar sizes.
- Explain in the README that users can start multiple downloads in parallel and do not need to wait for one download to finish before starting another.
- Audit the GitHub branch `feature/youtube-downloader-sdd`. At the v2.5.1 release it is 48 commits behind `main` with no unique commits; confirm there is no open PR or other dependency, then delete the remote branch if it is no longer needed.
- After the maintainer provides three updated screenshots, replace `docs/screenshots/watch-page-pill.png` and `docs/screenshots/context-menu.png`, and add a screenshot of the popup opened from the Firefox toolbar.

## Companion distribution

- Investigate standalone companion installers for Windows (`.exe`) and macOS (signed/notarized `.pkg` or app bundle), including browser Native Messaging registration and update/removal behavior. Keep the signed Firefox XPI as a separate release asset.
- Document and test upgrades within each package family, plus migration between the per-user `install.sh` install and system `.deb`/`.rpm`/Arch packages without touching user configuration.

## Additional browser extensions

- Build browser-specific extension shells that can share the existing Native Messaging companion. Start by investigating Chromium-family manifest origins and registration paths; treat Safari's app-extension and packaging model as a separate compatibility question rather than assuming the Firefox manifest works everywhere.
