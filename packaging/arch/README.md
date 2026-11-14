# Arch Linux recipe

This archive contains the `PKGBUILD` and `.SRCINFO` for building the
Firefox YouTube Downloader companion with `makepkg`. It is a recipe, not a
prebuilt package and not an AUR submission. The build downloads the source
tarball attached to the matching GitHub release and verifies its SHA-256.

```sh
makepkg -si
```

The package registers a system-wide Firefox Native Messaging host. Install the
signed XPI separately. `rsgain` is an optional dependency for ReplayGain.
