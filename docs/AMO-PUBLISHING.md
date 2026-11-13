# AMO signing and publishing

This guide covers both free Mozilla signing for direct distribution and public
listing in the Firefox Add-ons catalog. Both routes use Mozilla's signing
service. An **Unlisted** add-on is signed but does not appear in catalog search;
a **Listed** add-on is signed and reviewed for public discovery.

The add-on is one part of a two-part application. The XPI contains the Firefox
interface; downloading is performed by the user's locally installed companion
(`install.sh` on Linux/macOS or `install.ps1` on Windows) and `yt-dlp`. Users
also need FFmpeg; automatic audio tagging uses Python, Mutagen, and Pillow, and
ReplayGain is optional (`rsgain`). The browser add-on does not bundle or
download those programs.

## Before the first submission

1. Create or sign in to a Firefox Account.
2. Open <https://addons.mozilla.org/developers/> and accept the developer terms.
3. Review the extension version and ID in `extension/manifest.json`. Keep the
   stable ID `firefox-youtube-downloader@lakis01.github.io` for every release.
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
   `dist/firefox-youtube-downloader.xpi`, as the user-facing download.
   Maintainers can run the same flow as a one-command script instead:

    ```sh
    export AMO_JWT_ISSUER='user:...'
    export AMO_JWT_SECRET='...'
    ./scripts/sign-xpi.sh
    ```

    `scripts/sign-xpi.sh` submits `extension/` with
    `npx web-ext sign --channel=unlisted`, validates the newest artifact in
    `web-ext-artifacts/`, and copies it to the deterministic release path
    `dist/firefox-youtube-downloader-signed.xpi`. It exits non-zero when the
    two `AMO_JWT_*` variables are unset or when no signed `.xpi` appears.
3. Verify it is a valid archive and contains the expected manifest/version:

   ```sh
   SIGNED_XPI=$(find web-ext-artifacts -maxdepth 1 -name '*.xpi' -print -quit)
   python3 -m zipfile -t "$SIGNED_XPI"
   ```

   Record the exact signed artifact name and its SHA-256 in the release notes
   if you want users to be able to verify downloads.
4. Create a GitHub Release for the same source tag/version and attach the
   signed XPI. Include a short release note, the companion installation link,
   and the locally required `yt-dlp`/FFmpeg dependencies. Never attach API
   credentials.
5. On each release, increment `manifest.json`'s `version`, rerun tests, and
   submit the new source with `--channel=unlisted`. Replace the old attached
   artifact with the newly signed XPI; AMO signatures are per submitted
   version.
6. Install on each laptop with Firefox's **Add-ons and themes → gear → Install
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

   > Requires the free Firefox YouTube Downloader companion installer
   > (`install.sh` on Linux/macOS or `install.ps1` on Windows), plus locally
   > installed `yt-dlp` and FFmpeg. The companion runs on your computer; it is
   > not bundled with this add-on. Python, Mutagen, and Pillow are needed for
   > automatic tagging; `rsgain` is optional for ReplayGain.

3. Upload clear screenshots of the extension's context menu, watch-page
   controls, and settings popup. Make sure screenshots correspond to the
   uploaded version and do not include private URLs or account information.
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
   | `nativeMessaging` | Sends a user-selected mode and YouTube URL to the user's locally installed companion, receives its settings/status, and starts a local `yt-dlp` download. It is the extension's only connection to the companion; the companion is installed and run by the user. |
   | `menus` | Adds the YouTube Downloader submenu and its Audio, Video, and Cut Audio actions to Firefox's right-click menu. |
   | `activeTab` | Reads the active page URL only in response to a user action so the extension can choose the current YouTube page when no link/card URL is available. It is not used to inspect unrelated browsing history. |
   | `*://*.youtube.com/*`, `*://youtube.com/*` | Loads the download controls on YouTube pages and allows the context action to use YouTube page URLs. The content script is limited to YouTube pages. |
   | `*://*.youtu.be/*`, `*://youtu.be/*` | Permits short YouTube links in browser context actions and validates them before passing a user-selected URL to the local companion. |

   Enter these explanations in AMO's permission-purpose fields, adjusting
   only if the manifest or implementation changes. Do not claim that a
   permission is unused or omit a requested host pattern.
6. For the current manifest's data-collection question, select **No data is
   collected** (or the equivalent option that means none). The Gecko manifest
   declares `data_collection_permissions.required: ["none"]`. The add-on has
   no analytics, advertising, account, or telemetry service and does not send
   browsing data to its author. A URL and chosen mode cross Firefox's Native
   Messaging boundary to the user's own companion only after the user selects
   a download action; `yt-dlp` then makes the media request from that computer.
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

### Listed updates

For every update, increment the manifest version, run tests, build and upload
the new source package, include a concise changelog, and complete any updated
privacy/permission questions. Wait for signing/review before describing the
version as available. Keep the previous GitHub release and store listing
clearly distinguished; a Listed version is installed through AMO, while an
Unlisted release is installed from its signed XPI.

## AMO store survival, copyright & trademark best practices

- **Why Mozilla permits Native Messaging bridges.** This add-on follows the
  same architecture as long-standing AMO-hosted extensions such as `ff2mpv`
  and *Video DownloadHelper*'s companion mode: the XPI itself contains only a
  Firefox interface (menus, watch-page controls, settings popup) and talks to
  a user-installed local program over Native Messaging. It bundles no
  downloader, ships no media-handling binary, sends nothing to a
  project-owned server, and declares `data_collection_permissions.required:
  ["none"]`. Reviewers evaluate the XPI on what it does — pass a
  user-selected mode and URL to the user's own companion — which is why
  bridges of this shape survive review.
- **Why keeping `yt-dlp` external to the `.xpi` is essential.** Never bundle
  `yt-dlp`, FFmpeg, `rsgain`, or Python libraries inside the signed package.
  The XPI must remain a thin client: any downloading, transcoding, or tagging
  capability that shipped inside the archive would be reviewed as the
  add-on's own behavior and could trigger copyright-related rejection. With
  `yt-dlp` installed separately by the user via their OS package manager, the
  add-on never distributes or controls the fetching tool — the same boundary
  that keeps the `ff2mpv` model viable.
- **How to phrase public store titles (nominative fair use).** Do not prefix
  the listing name with the brand (`"YouTube Downloader ..."` reads as an
  official YouTube product). Use the `"... for YouTube"` form instead — e.g.
  *"Downloader for YouTube (yt-dlp companion)"* — which nominatively names the
  site the add-on interoperates with without claiming affiliation. The same
  rule applies to icons, screenshots, and descriptions: describe compatibility
  ("works on YouTube pages") rather than adopting YouTube branding.
- **Why `--channel=unlisted` signed `.xpi`s on GitHub Releases cannot be
  broken by store delisting.** Unlisted signing produces a Mozilla signature
  without a catalog page, and the signed artifact is attached to a GitHub
  Release that this project controls. If a Listed catalog page were ever
  removed or delisted, installs from the Release-attached
  `dist/firefox-youtube-downloader-signed.xpi` keep working: the signature is
  already issued and verified locally by Firefox, and distribution never
  depended on the store page. Keep Listed and Unlisted versions clearly
  distinguished so a store action can never silently break direct installs.

## Release checklist

- [ ] Manifest ID is unchanged and version is incremented.
- [ ] `data_collection_permissions.required` is still `['none']` if the add-on
      still collects no data.
- [ ] Tests and deterministic local XPI build pass.
- [ ] Permission explanations match actual code and reviewer instructions.
- [ ] Store text explains that the companion and local `yt-dlp`/FFmpeg are
      required.
- [ ] Signed artifact is tested and attached without API credentials.
- [ ] GitHub release notes and AMO listing link to current installation docs.
