# Backlog

## Companion distribution

- Investigate standalone companion installers for Windows (`.exe`) and macOS (signed/notarized `.pkg` or app bundle), including browser Native Messaging registration and update/removal behavior. Keep the signed Firefox XPI as a separate release asset.
- Document and test upgrades within each package family, plus migration between the per-user `install.sh` install and system `.deb`/`.rpm`/Arch packages without touching user configuration.
- Investigate loading AMO signing credentials from an OS keyring/password manager or CI secret store so future signing does not require manual environment exports. Keep signing an explicit release action; never put the JWT secret in the repository or source/release archives.

## Additional browser extensions

- Build browser-specific extension shells that can share the existing Native Messaging companion. Start by investigating Chromium-family manifest origins and registration paths; treat Safari's app-extension and packaging model as a separate compatibility question rather than assuming the Firefox manifest works everywhere.
