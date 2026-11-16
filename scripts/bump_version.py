#!/usr/bin/env python3
"""Atomically bump the Huginn Downloader version across manifest, host, tests, and README."""

import argparse
import json
from pathlib import Path
import re
import sys


SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def compute_next_version(current: str, mode: str | None, explicit: str | None) -> str:
    """Compute the next semantic version string."""
    match = SEMVER_RE.fullmatch(current.strip())
    if not match:
        raise ValueError(f"Current version {current!r} is not X.Y.Z")
    major, minor, patch = (int(part) for part in match.groups())

    if explicit is not None:
        if not SEMVER_RE.fullmatch(explicit.strip()):
            raise ValueError(f"Explicit version {explicit!r} must be X.Y.Z")
        return explicit.strip()

    if mode == "major":
        return f"{major + 1}.0.0"
    if mode == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def _replace_bounded_version(text: str, old_version: str, new_version: str) -> str:
    pattern = re.compile(rf"(?<![0-9.]){re.escape(old_version)}(?![0-9.])")
    return pattern.sub(new_version, text)


def bump_version(
    root: Path,
    *,
    mode: str | None = "patch",
    explicit: str | None = None,
    dry_run: bool = False,
) -> str:
    """Bump version in extension manifest, native host, tests, and README."""
    manifest_path = root / "extension/manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old_version = manifest["version"]
    new_version = compute_next_version(old_version, mode, explicit)
    if new_version == old_version:
        return new_version

    targets = [
        manifest_path,
        root / "bin/yt-dlp-native-host.py",
        root / "tests/test_firefox_extension.js",
        root / "tests/test_native_host.py",
        root / "README.md",
    ]
    updates: list[tuple[Path, str]] = []

    for path in targets:
        if not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        if path == manifest_path:
            updated = re.sub(
                rf'("version"\s*:\s*"){re.escape(old_version)}(")',
                rf"\g<1>{new_version}\g<2>",
                original,
                count=1,
            )
        elif path.name == "yt-dlp-native-host.py":
            updated = re.sub(
                rf'(VERSION\s*=\s*"){re.escape(old_version)}(")',
                rf"\g<1>{new_version}\g<2>",
                original,
                count=1,
            )
        elif path.name == "README.md":
            updated = original
            for prefix, suffix in (
                ("huginn-companion_", "_all.deb"),
                ("huginn-companion-", "-1.noarch.rpm"),
                ("huginn-downloader-", "-arch-pkgbuild.tar.gz"),
                ("huginn-downloader-", "-source.tar.gz"),
                ("huginn-chromium-", ".zip"),
            ):
                updated = updated.replace(
                    f"{prefix}{old_version}{suffix}",
                    f"{prefix}{new_version}{suffix}",
                )
        else:
            updated = _replace_bounded_version(original, old_version, new_version)

        if updated != original:
            updates.append((path, updated))

    if not dry_run:
        for path, content in updates:
            path.write_text(content, encoding="utf-8")

    return new_version


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Bump Huginn Downloader version across repository files."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--patch", action="store_const", const="patch", dest="mode")
    group.add_argument("--minor", action="store_const", const="minor", dest="mode")
    group.add_argument("--major", action="store_const", const="major", dest="mode")
    parser.add_argument("version", nargs="?", help="Optional explicit X.Y.Z version")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    try:
        new_version = bump_version(
            args.root,
            mode=args.mode or "patch",
            explicit=args.version,
            dry_run=args.dry_run,
        )
    except (OSError, ValueError, KeyError) as error:
        print(error, file=sys.stderr)
        return 1
    print(new_version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
