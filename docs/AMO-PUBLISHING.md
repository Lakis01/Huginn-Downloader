# AMO signing and publishing

This guide covers both free Mozilla signing for direct distribution and public
listing in the Firefox Add-ons catalog. Both routes use Mozilla's signing
service. An **Unlisted** add-on is signed but does not appear in catalog search;
a **Listed** add-on is signed and reviewed for public discovery.

Huginn Downloader is a two-part application. The XPI contains the Gecko/Firefox
browser frontend (matching the companion shared with Chromium-family builds);
downloading is performed by the user's locally installed companion
(`install.sh` on Linux/macOS or `install.ps1` on Windows) and `yt-dlp`. Users
also need FFmpeg; automatic audio tagging uses Python, Mutagen, and Pillow, and
ReplayGain is optional (`rsgain`). The browser add-on does not bundle or
download those programs.

## Before the first submission

1. Create or sign in to a Firefox Account.
2. Open <https://addons.mozilla.org/developers/> and accept the developer terms.
3. Review the extension version and ID in `extension/manifest.json`. The add-on
   uses the stable Gecko ID `huginn-downloader@lakis01.github.io` for the Huginn
   Downloader brand (renamed from the legacy unlisted
   `firefox-youtube-downloader@lakis01.github.io` ID). Keep `gecko.id` constant
   once your Listed AMO store page is created so updates seamlessly go to the
   same listing.

   > **ID change = new AMO add-on.** AMO binds every add-on to its GUID for
   > life; a name change is fine, an ID change is not. The legacy add-on
   > (dashboard slug `804876058bfd4ecea544`, versions up to 2.5.2) belongs to
   > `firefox-youtube-downloader@lakis01.github.io`, so uploading a
   > `huginn-downloader@lakis01.github.io` build there fails with an ID
   > mismatch. Publish Huginn versions to the add-on that owns the new ID
   > (created by the first 2.5.9 signing), not to the legacy page.
4. Run the repository checks in `README.md` and build the deterministic package:

   ```sh
   ./scripts/build-xpi.sh
   ```

5. Do not put API secrets, local user data, `.env` files, or build credentials
   in the source archive or GitHub release.

For either route, create AMO API credentials from the developer dashboard's
**Manage API Keys** page. Store the issuer and secret in environment variables
in your local shell or CI secret store; never commit them:

```sh
export AMO_JWT_ISSUER='user:...'
export AMO_JWT_SECRET='...'
```

The credential names above are examples of local environment variable names;
copy the issuer and secret exactly as AMO displays them. If either value is
rotated, replace it in every local/CI secret store that uses it.

## Option A — signed Unlisted XPI for GitHub Releases and personal devices

An Unlisted signing request returns an AMO-signed XPI without publishing a
catalog page. It is the right choice for a small direct-release workflow or
personal laptops: users still receive Mozilla's signature, but they install the
file themselves and cannot discover it by searching AMO.

1. Install Node.js/npm and run the signing command from the repository root.
   `web-ext` can be run through `npx` without a global install:

   ```sh
   npx web-ext sign \
     --source-dir extension \
     --artifacts-dir web-ext-artifacts \
     --channel=unlisted \
     --api-key "$AMO_JWT_ISSUER" \
     --api-secret "$AMO_JWT_SECRET"
   ```

   On PowerShell, use `$env:AMO_JWT_ISSUER` and
   `$env:AMO_JWT_SECRET` for the last two values. The command submits the
   extension source to AMO's signing API; it does not publish a listing.

2. Wait for the command to finish. The signed XPI is written under
   `web-ext-artifacts/` (the filename includes the extension name/version).
   Keep the signed result, not the unsigned
   `dist/huginn-firefox.xpi`, as the user-facing download.
   Maintainers can run the same flow as a one-command script instead:

    ```sh
    export AMO_JWT_ISSUER='user:...'
    export AMO_JWT_SECRET='...'
    ./scripts/sign-xpi.sh
    ```

    `scripts/sign-xpi.sh` submits `extension/` with
    `npx web-ext sign --channel=unlisted`, validates the newest artifact in
    `web-ext-artifacts/`, and copies it to the deterministic release path
    `dist/huginn-signed.xpi`. It exits non-zero when the
    two `AMO_JWT_*` variables are unset or when no signed `.xpi` appears.

    On a KDE workstation, maintainers may store AMO credentials in KWallet
    instead of exporting them for each signing run:

    ```sh
    ./scripts/sign-xpi-kwallet.sh
    ```

    Before the first local signing run, open KWallet Manager and create a
    `Huginn Downloader` folder in your unlocked wallet. Add password entries
    named `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, using the values from your saved
    AMO credentials. Enter them in KWallet Manager, not in a terminal or chat.
    The wrapper retrieves them locally, does not write them to the repository,
    `.env`, command arguments, or output, then calls the existing signer.
    KWallet protects values at rest, not from malware or other processes running
    as the same user while the wallet is unlocked. The environment-variable
    flow remains available for CI. If the AMO secret was not saved, do not
    assume it can be shown again; create a new credential pair through AMO's
    credential manager and save it.

 3. Verify it is a valid archive and contains the expected manifest/version:

    ```sh
    SIGNED_XPI=$(find web-ext-artifacts -maxdepth 1 -name '*.xpi' -print -quit)
    python3 -m zipfile -t "$SIGNED_XPI"
    ```

    Record the exact signed artifact name and its SHA-256 in the release notes
    if you want users to be able to verify downloads.

 4. Create a **draft** GitHub Release for the matching source tag/version,
    attaching `dist/huginn-signed.xpi`. Create and push the tag explicitly
    first so the `push.tags` package workflow has a ref to run against; then
    create the draft for that existing tag. For example:

    ```sh
    VERSION=2.5.2
    TAG="v$VERSION"
    git tag -a "$TAG" -m "$TAG"
    git push origin "$TAG"
    gh release create "$TAG" dist/huginn-signed.xpi \
      --draft --verify-tag --target main \
      --title "Huginn Downloader $VERSION" \
      --notes-file release-notes.md
    ```

    Include a short release note, the companion installation link, and the
    locally required `yt-dlp` and FFmpeg dependencies. Never attach API
    credentials. The tag starts the Linux package workflow; it waits for this
    draft before uploading packages.

 5. Wait for **Build Linux release packages** to finish. It builds and attaches
    the Debian `.deb`, Fedora `.rpm`, a tagged source archive, and an Arch
    `PKGBUILD`/`.SRCINFO` recipe archive. If the tag-push run did not start,
    manually dispatch it with `upload_to_draft=true` and the release tag:

    ```sh
    gh workflow run release-linux-packages.yml --ref v2.5.2 \
      -f upload_to_draft=true -f release_tag=v2.5.2
    ```

    Verify all assets and their displayed SHA-256 digests, then publish the
    draft. The workflow never publishes the release or submits to a distro
    repository.

 6. For the next update, increment `manifest.json`'s `version` before building
    or signing, rerun tests, and submit the new source with `--channel=unlisted`.
    Replace the old attached XPI; AMO signatures are per submitted version.

 7. Install on each laptop with Firefox's **Add-ons and themes → gear → Install
    Add-on From File…** action, then install the matching OS companion using the
    README instructions. On managed Firefox installations, follow the
    organization's extension policy.

The direct XPI is still subject to Mozilla signing and review policies. Do not
promise that signing is instantaneous; AMO can queue or reject a submission.

## Option B — Listed add-on in the Firefox Add-ons Store

Choose Listed publication when users should find and install the add-on from
<https://addons.mozilla.org/>. A listing makes the add-on public and subjects
it to AMO's review and content policies.

1. Open <https://addons.mozilla.org/developers/> and choose **Submit a New
   Add-on**. Select Firefox as the target application and upload the XPI built
   from the `extension/` source (or let `web-ext` build/package it). The upload
   is submitted for signing and review; do not upload a previous AMO-signed
   XPI as the source for a new release.
2. Select **On this site** / **Listed** as the distribution channel. Complete
   the name, summary, description, categories, support contact, and license.
   Include the full companion requirement prominently in the description, for
   example:

    > Requires the free Huginn Downloader companion installer
   > (`install.sh` on Linux/macOS or `install.ps1` on Windows), plus locally
   > installed `yt-dlp` and FFmpeg. The companion runs on your computer; it is
   > not bundled with this add-on. Python, Mutagen, and Pillow are needed for
   > automatic tagging; `rsgain` is optional for ReplayGain.

3. Upload clear screenshots of the extension in action under **Edit Product Page
   -> Images / Screenshots** on AMO (`docs/screenshots/watch-page-pill.png`,
   `docs/screenshots/context-menu.png`, and `docs/screenshots/toolbar-popup.png`).
   AMO supports up to 10 PNG/JPG screenshots directly on the public listing
   page. Make sure screenshots correspond to the uploaded version and do not
   include private URLs or account information.
4. Complete the source-code section with the repository URL and a version tag
   that matches the submitted add-on. Provide reviewer instructions that say
   the extension intentionally requires a local Native Messaging companion,
   link to this guide and `README.md`, and describe how to install the
   companion and test a download. Reviewers should not need your credentials
   or access to your personal account.
5. Answer the permissions and privacy questions truthfully. The manifest
   permissions have these purposes:

   | Permission | Suggested explanation for the form |
   | --- | --- |
   | `nativeMessaging` | After an explicit user action, sends the selected mode and safe HTTP(S) URL to the user's locally installed companion and receives its settings/status. The local companion runs `yt-dlp` on the user's computer; the extension does not send URLs to a project server. |
   | `menus` | Adds Audio, Video, and Cut Audio actions to Firefox's right-click context menu. A user may explicitly select a safe HTTP(S) page or link on any site. |
   | `activeTab` | Reads the active page URL only after the user invokes a context action and only when no link/card URL is available. The user-selected URL may be from any site; this permission is not used to inspect browsing history. |
   | `*://*.youtube.com/*`, `*://youtube.com/*` | Loads the content script and watch-page download controls on YouTube pages. These controls remain scoped to `youtube.com`; the context menu can also pass a user-selected safe HTTP(S) URL from another site. |
   | `*://*.youtu.be/*`, `*://youtu.be/*` | Supports short YouTube links in context actions. This host access does not expand the content script beyond `youtube.com`; context actions on other safe HTTP(S) sites are handled through the user-selected context URL. |

   Enter these explanations in AMO's permission-purpose fields, adjusting
   only if the manifest or implementation changes. Do not claim that a
   permission is unused or omit a requested host pattern.
6. For the current manifest's data-collection question, select **No data is
   collected** (or the equivalent option that means none). The Gecko manifest
   declares `data_collection_permissions.required: ["none"]`. The add-on has
   no analytics, advertising, account, or telemetry service and does not send
   browsing data to its author or any project server. A user-selected safe
   HTTP(S) URL and chosen mode cross Firefox's Native Messaging boundary to the
   user's own companion only after an explicit click; the local companion and
   `yt-dlp` handle the URL and make the media request from that computer.
   Re-answer if a future version adds analytics, cloud services, or other
   collection.
7. Submit for review. Respond to AMO reviewer questions in the developer
   dashboard and make requested changes in source before uploading a new
   version. Do not work around a policy or validation finding by hiding
   behavior from reviewers.
8. After approval, verify the public listing page, install the listed version
   from AMO in a clean Firefox profile, and test the companion onboarding,
   context menu, watch-page controls, and settings. Link the store page from
   GitHub and README; users should install the companion separately.

### Listed updates (automatic via GitHub Actions)

Once your first Listed version is approved under `huginn-downloader@lakis01.github.io`
on AMO, set the GitHub repository variable `AMO_CHANNEL` to `listed` in
**Settings -> Secrets and variables -> Actions -> Variables**. From that point
on, every push to `main` automatically runs `.github/workflows/auto-release.yml`
to bump the version, test, sign/submit the new Listed version to AMO using your
`AMO_JWT_ISSUER` and `AMO_JWT_SECRET` secrets, and publish the GitHub Release
with zero manual steps. For manual uploads, always increment `manifest.json`
version first and include a concise changelog.

## AMO review and intellectual-property notes

- **Describe the Native Messaging design factually.** The XPI contains the
  Firefox interface (menus, watch-page controls, settings popup) and passes a
  user-selected mode and URL to the locally installed companion. It bundles no
  downloader, ships no media-handling binary, sends nothing to a
  project-owned server, and declares `data_collection_permissions.required:
  ["none"]`. Mozilla independently reviews each submission and can reject,
  require updates to, or remove it; this architecture does not guarantee
  approval.
- **Keep the XPI and companion responsibilities clear.** Do not bundle
  `yt-dlp`, FFmpeg, `rsgain`, or Python libraries inside the signed package.
  The XPI is the Firefox frontend; the companion and user-installed `yt-dlp`
  perform downloads locally. This describes the software architecture, not a
  legal conclusion: using an external backend or presenting a frontend does
  not by itself decide copyright or anti-circumvention liability.
- **Use the Huginn Downloader brand consistently.** Releases go to the AMO
  add-on that owns `huginn-downloader@lakis01.github.io`; the legacy
  `firefox-youtube-downloader@` add-on receives no further versions. Describe YouTube as
  a compatible site rather than implying affiliation with YouTube or Google.
- **Why `--channel=unlisted` signed `.xpi`s on GitHub Releases are still
  subject to Mozilla policy.** Unlisted signing produces a Mozilla signature
  without a catalog page, and the signed artifact is attached to a GitHub
   Release that this project controls — but unlisted signing only means no
  public catalog listing; signing does not grant policy immunity. Mozilla may
  revoke or blocklist signatures or prevent installs under policy or security
  action, and GitHub hosting doesn't override AMO/Firefox decisions. If a
  Listed catalog page were ever removed, Release-attached
   `dist/huginn-signed.xpi` installs are not automatically
  protected: keep Listed and Unlisted versions clearly distinguished and do
  not promise users that direct installs cannot be affected.

## Release checklist

- [ ] Manifest ID is unchanged and version is incremented.
- [ ] `data_collection_permissions.required` is still `['none']` if the add-on
      still collects no data.
- [ ] Tests and deterministic local XPI build pass.
- [ ] The tag package workflow completed; the expected `.deb`, Fedora `.rpm`, source archive, and Arch recipe are attached to the draft.
- [ ] Permission explanations match actual code and reviewer instructions.
- [ ] Store text explains that the companion and local `yt-dlp`/FFmpeg are
      required.
- [ ] Signed artifact is tested and attached without API credentials.
- [ ] GitHub release notes and AMO listing link to current installation docs.
