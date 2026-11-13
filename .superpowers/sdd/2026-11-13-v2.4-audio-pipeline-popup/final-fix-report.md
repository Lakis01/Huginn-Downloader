# Firefox YouTube Downloader Plugin v2.4 — Final Fix Report

Date: 2026-11-13
Branch: `feature/plugin-v23-rebuild`

## RED — regression tests before implementation

Added regression tests before changing production behavior for generated-media
mono conversion, native AAC/M4A mono conversion, actual cut Opus encoding,
collision fallback, same-directory symlink routing, ReplayGain readback, popup
minute normalization, and native-host version/removal of its obsolete YouTube
gate.

- `python3 -m unittest discover -s tests -p test_ytdl_meta.py -v`: 78 tests;
  expected RED with 6 failures and 3 errors. The failures demonstrated missing
  mono stream conversion and final `.opus` cut encoding, the old forced-Opus
  selector/bitrate, missing FLAC ReplayGain readback, symlink alias collision
  suffixes, and the hard-link-only fallback. The two generated-media cases
  failed because `_ensure_audio_properties` was not implemented.
- `node tests/test_firefox_extension.js`: expected RED; invalid `0` minutes was
  sent in the batched settings save instead of normalizing to `30`.
- `python3 -m unittest discover -s tests -p test_native_host.py -v`: expected
  RED with 2 failures for the companion's old `2.0.0` version and its obsolete
  YouTube-only helper/constants.

The failures were on the targeted missing behaviors, not test syntax or setup.

## GREEN — implementation and final verification

Implemented the downstream ffprobe/FFmpeg audio-property pass with all-stream
and metadata mapping, format-aware mono encoding, safe same-directory output,
and clear errors when a destination container cannot retain a stream. Opus cuts
now use a cut/remux intermediate and one final `libopus` encode with the chosen
bitrate, channels, and application. Also fixed popup normalization, forced-Opus
source preference, exclusive-copy collision fallback, same-directory routing,
FLAC ReplayGain readback, companion version, permissions/install documentation,
and README test count.

Final checks:

- `python3 -m unittest discover -s tests -v` — **149 tests passed**.
- `bash tests/test_shortcut.sh` — **41 checks passed**.
- `node tests/test_firefox_extension.js` — passed.
- `bash scripts/build-xpi.sh` — passed; deterministic XPI contains 11 files.
- Python compile checks, Node syntax checks, and Bash syntax checks — passed.
- `desktop-file-validate desktop/*.desktop` — passed.
- `git diff --check` — passed.

Generated-media tests use only temporary synthetic FFmpeg inputs and ffprobe;
they do not access the network or user downloads.
