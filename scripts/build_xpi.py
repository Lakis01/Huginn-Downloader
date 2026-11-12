#!/usr/bin/env python3
"""Build a deterministic Firefox extension package from the extension tree."""

import json
from pathlib import Path
import sys
import zipfile


REQUIRED = [
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "icons/plugin.svg",
    "icons/audio.svg",
    "icons/video.svg",
    "icons/cut.svg",
]


def build_xpi(source: Path, output: Path) -> list[str]:
    missing = [name for name in REQUIRED if not (source / name).is_file()]
    if missing:
        raise ValueError("missing required files: " + ", ".join(missing))

    try:
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"manifest.json is not valid JSON: {error}") from error

    for key in ("manifest_version", "name", "version"):
        if key not in manifest:
            raise ValueError(f"manifest.json is missing required key: {key}")

    files = sorted(
        (path for path in source.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(source).as_posix(),
    )
    names = [path.relative_to(source).as_posix() for path in files]
    if names[0] != "manifest.json" and "manifest.json" in names:
        names.remove("manifest.json")
        names.insert(0, "manifest.json")
    by_name = {path.relative_to(source).as_posix(): path for path in files}

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, by_name[name].read_bytes())

    with zipfile.ZipFile(output) as archive:
        archived = archive.namelist()
        if archived[0] != "manifest.json":
            raise ValueError("manifest.json must be the first archive entry")
        if archived[1:] != sorted(archived[1:]):
            raise ValueError("entries after manifest must be sorted")
        bad = archive.testzip()
        if bad is not None:
            raise ValueError(f"corrupt entry in xpi: {bad}")
    return names


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    root = Path(__file__).resolve().parents[1]
    source = Path(args[0]) if len(args) > 0 else root / "extension"
    output = Path(args[1]) if len(args) > 1 else root / "dist/firefox-youtube-downloader.xpi"
    try:
        names = build_xpi(source, output)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"wrote {output} ({len(names)} files)")
    for name in names:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
