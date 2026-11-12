# Current YouTube Setup Follow-up

## Intent

Resolve the failures reported after installing the downloader, improve the on-page buttons to match the supplied YouTube screenshot, and restore stable right-click selection for new recommendation/preview markup.

## Scope

- Find either yt-dlp info-JSON naming convention beside a completed audio file and clean only that local sidecar after successful tagging.
- Surface yt-dlp's real access error without a traceback. Retry an auth-classified metadata fetch once using the user's Firefox cookies; if the request still says members-only, explain that channel membership is required rather than attempting to bypass it.
- Allow External Application Launcher calls to pass `[PRE_SCRIPT]` first and `[HREF]` as a safe fallback.
- Recognize YouTube's current lockup recommendation cards and hover-preview overlays.
- Increase the three player action controls modestly and use clearly visible light/dark tonal surfaces matching the screenshot.
- Do not create or replace `~/.config/yt-dlp/config`; current installation already leaves it untouched. On future hosts, create a config only when none exists.

## External Application Launcher safety

The existing extension preferences must be changed without losing icons or unrelated extension data. A partial export import is unsafe because the extension clears all settings on import. Prefer its full Export Settings/Import Settings workflow or supported live options UI. Do not write its active Firefox IndexedDB directly. If a full export or safe UI connection is unavailable, stop and ask for the full export or access needed to apply it.

## Verification

- Use a generated temporary audio/sidecar fixture for the info-JSON naming regression; never retag or delete the user's existing downloaded files as a test.
- Mock yt-dlp responses in unit tests for auth retry; the live cookie check confirmed 2,162 Firefox cookies were read but did not grant access to the reported members-only video.
- Test candidate URL ordering and overlay/card selection with the existing shell/DOM fixture suites.
- Live rendering and real EAL settings changes require the user's real Firefox profile and cannot be claimed from the isolated MCP profile.
