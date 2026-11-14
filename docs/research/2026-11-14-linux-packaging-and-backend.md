# Linux packaging & backend research (2026-11-14)

Scope: Firefox Native Messaging companion (Python/Bash, `install.sh` per-user installer).
Primary/first-party sources only. Facts first, recommendations marked **[REC]**.
No code, tests, README, or plan/spec files were changed for this note.

## 1. Firefox Native Messaging manifest paths (fact)

Per MDN "Native manifests" (accessed 2026-11-14):

- Linux **system-wide**: `/usr/lib/mozilla/native-messaging-hosts/<name>.json`
  **or** `/usr/lib64/mozilla/native-messaging-hosts/<name>.json`
  (same two prefixes for `managed-storage/` and `pkcs11-modules/`).
- Linux **per-user**: `~/.mozilla/native-messaging-hosts/<name>.json`.
- On Linux/macOS the manifest `path` **must be absolute**; `type` is `"stdio"`;
  `allowed_extensions` pins the add-on ID.
- Source: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests>

Do **not** infer other system paths (`/usr/share`, `/etc/…`): MDN documents
only the two prefixes above. Today's `install.sh` writes per-user manifests
only, which matches the per-user path. **[REC]** A distro package
(.deb/.rpm) should install the manifest system-wide plus the host to an
absolute path (e.g. `/usr/libexec/…` or `/usr/bin/…`), while keeping the
curl/git `install.sh` per-user flow as the low-friction default. Both are
supported/appropriate in their context.

## 2. Linux distribution deliverables (fact → recommendation)

Recipe = build instructions hosted by a distro community; binary release
artifact = installable file the project (or a build service) publishes and
re-signs per release. They have different maintenance costs.

| Deliverable | Nature | Deps / NM host | Burden |
|---|---|---|---|
| Debian `.deb` (+ Ubuntu) | Source pkg (`orig.tar` + `debian/` + `.dsc`) → binary `.deb`; workflow per Debian New Maintainers' Guide (<https://www.debian.org/doc/manuals/maint-guide/first.en.html>). apt auto-resolves declared deps at install | `Depends`/`Recommends`/`Suggests` per Policy §7.2 (<https://www.debian.org/doc/debian-policy/ch-relationships.html>); system-wide NM manifest natural | Medium-high: sponsor/DD upload, lintian, per-release updates |
| Fedora `.rpm` / openSUSE `.rpm` | SPEC recipe → SRPM + binary RPM (RPM Packaging Guide, <https://rpm-packaging-guide.github.io/>); core `Requires` vs weak `Recommends`/`Suggests` per `rpm-dependencies(7)` (<https://rpm-software-management.github.io/rpm/man/rpm-dependencies.7.html>) | System-wide manifest; OBS (<https://openbuildservice.org/>) builds for many distros/arches reproducibly | Medium: SPEC upkeep; COPR/OBS publish per release |
| Arch `PKGBUILD`/AUR | Bash recipe (`pkgname/pkgver/pkgrel/arch`, `depends`/`makedepends`/`optdepends`; <https://wiki.archlinux.org/title/PKGBUILD>). AUR hosts **recipes only**; users build with `makepkg`, install with `pacman` (<https://wiki.archlinux.org/title/Arch_User_Repository>) | `depends` = required, `optdepends` = optional features | **Low**: single file + `.SRCINFO`, community updates |
| Alpine `apk` | `APKBUILD` recipe (`pkgname/pkgver/pkgrel`, `depends`/`makedepends`) built with `abuild` (official mirror/sample: <https://github.com/alpinelinux/abuild>, `sample.APKBUILD`) | `depends` required; musl note: upstream yt-dlp ships `musllinux` binaries | Low-medium |
| Nix | Declarative expression; `nixpkgs` already packages `yt-dlp` (optional JS runtimes, `makeWrapper` PATH for `ffmpeg`) and `rsgain` v3.8: <https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/yt/yt-dlp/package.nix>, <https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/by-name/rs/rsgain/package.nix> | Deps declared, wrapped at build time | Medium; reproducible, good secondary target |
| AppImage | Upstream single-file format; bundles non-system deps, "build old, run new" (<https://docs.appimage.org/introduction/index.html>). No dep solver | NM absolute path into a FUSE mount is fragile | Medium build/test burden; integration risk |
| Flatpak | Sandbox denies host files/net/devices by default; access via `finish-args`/portals (<https://docs.flatpak.org/en/latest/sandbox-permissions.html>); Flathub/single-bundle distribution (<https://docs.flatpak.org/en/latest/>) | Host-side NM manifest + host exec from sandbox is the hard part; portals don't cover NM | High; needs bridge design |
| Snap | Self-contained snap via `snapcraft`, Snap Store publish (<https://documentation.ubuntu.com/snapcraft/stable/>); strict vs **classic** confinement exists (how-to "Enable classic confinement" listed in Snapcraft docs) | Classic likely needed for arbitrary host paths/exec; store review burden | High |

**[REC] Small sustainable matrix for v2.5.0:** (1) **AUR `PKGBUILD` recipe first**
(cheapest, matches Arch users in README); (2) **Debian/Ubuntu packaging second**
(source + binary, system-wide manifest, §3 metadata); (3) **Nix expression
third** if a contributor steps up. Keep publishing **GitHub tarball +
checksums** as the only binary artifact for now. **[REC] Explicitly not
shipping yet:** AppImage, Flatpak, Snap, Fedora COPR, openSUSE OBS
packages — each needs sandbox/confinement or review work disproportionate to
v2.5.0; revisit after .deb + AUR land.

Limitations (2026-11-14): Fedora packaging-guidelines and Alpine wiki were
bot-walled; openSUSE packaging-guidelines returned 403; Snap
"classic confinement" detail pages required login (index listed the topic).
Debian claims above use the accessible first-party equivalents cited.

## 3. Core deps on Debian + `Suggests` vs `Recommends` (fact)

Debian tracker (accessed 2026-11-14): `yt-dlp` 2026.10.26-1
(<https://tracker.debian.org/pkg/yt-dlp>), `ffmpeg` 7:9.0.2-6 (stable 7.1.5,
<https://tracker.debian.org/pkg/ffmpeg>), `rsgain` 3.8-1 in unstable/testing
(stable 3.6-1, <https://tracker.debian.org/pkg/rsgain>), `mutagen` source →
binary `python3-mutagen` (<https://tracker.debian.org/pkg/mutagen>), `pillow`
source → binary `python3-pil` (<https://tracker.debian.org/pkg/pillow>),
`nodejs` present (<https://tracker.debian.org/pkg/nodejs>). Upstream rsgain
confirms official Debian package since 13/trixie and Ubuntu 24.04 noble
(<https://github.com/complexlogic/rsgain>).

- Policy §7.2: `Depends` = absolute (required for significant functionality);
  `Recommends` = strong but not absolute ("found together in all but unusual
  installs"); `Suggests` = related, "can perhaps enhance", "installing …
  without them is perfectly reasonable".
- apt behavior: `--no-install-recommends` ("do not consider recommended
  packages as a dependency") vs `--install-suggests` ("consider suggested
  packages…") — i.e. **Recommends install by default, Suggests do not**
  (apt-get manpage, <https://manpages.ubuntu.com/manpages/noble/en/man8/apt-get.8.html>).
  So installing the package pulls `Depends` (+ `Recommends` unless opted out)
  automatically.

**[REC]** `Depends`: `python3`, `yt-dlp`, `ffmpeg`, `python3-mutagen`,
`python3-pil` (+ `nodejs` only if the host path truly needs it — the host is
Python, `nodejs` in README/`--check-deps` looks like a JS-runtime fallback,
so verify before hard-depending). **rsgain → `Suggests`** (default-off,
matches today's opt-in popup toggle); use `Recommends` only if the project
decides ReplayGain should be default-on. Same mapping in RPM weak deps
(`Recommends`/`Suggests` are hints for higher-level managers, unenforced by
rpm itself) and Arch (`optdepends`).

## 4. yt-dlp `bestaudio/best` + `-x` (fact)

- Upstream README "Format selection": default is
  `-f bestvideo*+bestaudio/best`; `b`/`best` = combined A+V,
  `ba`/`bestaudio` = audio-only, and `/` = left-preferred fallback
  (<https://github.com/yt-dlp/yt-dlp>).
- Post-processing options: `-x/--extract-audio` converts via ffmpeg;
  `--audio-format best (default)` keeps the native stream
  (same page). Code confirms the `-x` default:
  `if opts.extractaudio and not opts.keepvideo and opts.format is None:
  opts.format = 'bestaudio/best'`
  (<https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/__init__.py>).
- Conclusion: **`bestaudio/best` is the safe fallback for extractors exposing
  only muxed A/V** — audio-only when present, combined file otherwise, which
  `-x` then converts. **[REC]** Keep it as the default audio path.

## 5. ytgrab-rs — scope, state, wording (fact)

Project: <https://github.com/fitzypopper/ytgrab-rs> (raw README/PROJECT_NOTES/Cargo.toml read 2026-11-14).

- **Scope: YouTube-only.** Speaks YouTube's InnerTube JSON API (no browser,
  no HTML scraping); primary ANDROID client returns unciphered URLs, TV
  client + vendored QuickJS solver as fallback. No general-extractor
  architecture like yt-dlp's 1000+ extractors.
- **Working:** format listing/selection, segmented/resumable downloads,
  ffmpeg muxing + audio extraction, subtitles (SRT/VTT), thumbnails, info
  JSON, playlists, yt-dlp-style output templates, `--download-archive`.
- **Gaps (its own words):** "Not yet: cookie support (file parsed, browser
  extraction missing), format-specific rate limiting, DASH manifest support,
  DRM"; TODO list also holds open items. Own README: "independent
  implementation… yt-dlp … stays the more feature-complete tool".
  `Cargo.toml` v0.1.0, ~19 commits — early, single-maintainer stage.
- **[REC] Cautious wording** (docs only, no integration claim): *"A
  YouTube-only Rust backend (ytgrab-rs) exists as a possible future backend
  under evaluation; it is experimental, covers only YouTube, and is not
  integrated. yt-dlp remains the supported backend."*

## Project decision after user review (2026-11-14)

The user explicitly requested a Debian/Ubuntu `.deb`, Fedora `.rpm`, an Arch
`PKGBUILD`, and release assets kept current on each update. This overrides the
smaller initial matrix recommendation in §2. The v2.5 implementation will
ship those three package-family deliverables plus `install.sh` as the fallback;
it will not auto-publish to AUR/COPR/OBS.

Fedora package names were confirmed against Fedora's first-party package pages
(accessed 2026-11-14):

- `yt-dlp`: <https://packages.fedoraproject.org/pkgs/yt-dlp/yt-dlp/>
- `ffmpeg-free`: <https://packages.fedoraproject.org/pkgs/ffmpeg/ffmpeg-free/>
  (Fedora notes this build is codec-limited; document that users needing
  additional codecs may install a compatible FFmpeg build from their chosen
  repository.)
- `python3-mutagen`: <https://packages.fedoraproject.org/pkgs/python-mutagen/python3-mutagen/>
- `python3-pillow`: <https://packages.fedoraproject.org/pkgs/python-pillow/python3-pillow/>

The Fedora RPM will declare those as core runtime requirements. `rsgain` is
not a hard requirement, to keep ReplayGain truly optional. The project defers
Nix, AppImage, Flatpak, Snap, and Alpine APK for this release because their
additional integration/build burden is not justified alongside the three
requested native package families and per-user installer.
