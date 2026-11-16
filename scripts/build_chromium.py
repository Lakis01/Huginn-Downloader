#!/usr/bin/env python3
"""Build a deterministic Chromium/Brave/Vivaldi MV3 extension directory and zip."""

import base64
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile


CHROMIUM_PUBLIC_KEY = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtkU3iZB9lZz1etcCtXKLLQHaPouy"
    "9aaGFlHEdokck0ujR1CMGz371F017mshK/5QUpeUiL21UzWa02Mp0r31CElGm1rQB+wRuh7c"
    "Whc7fz9niS4z/FU5i6FBBULD5TPT7tyS1A1fGoU6hvST1s3EPccJ4avavCNmu7iExn+HqOjE"
    "3ryg9WR/9fuO0a/+Tqd97KFZGSPwmeEqgy4QqpSHaEn7kgEnxO9LTq8jMs0mYoeoAR8vmK7W"
    "26J19TEprAak8hXlXFnqgrHYT3MWuxRUKnRZ4TXxGypJAIZitGLj4x6WE4RrDdrOqS/lfmku"
    "mPSN+l16VOUqGvqN/kqZHDGjbQIDAQAB"
)
CHROMIUM_EXTENSION_ID = "hlekndcccbgmhlablldcddddmknkjomg"
CHROMIUM_ALLOWED_ORIGIN = f"chrome-extension://{CHROMIUM_EXTENSION_ID}/"

PNG_ICON_NAMES = (
    "huginn-logo-16.png",
    "huginn-logo-32.png",
    "huginn-logo-48.png",
    "huginn-logo-128.png",
)

REQUIRED_SOURCE_FILES = (
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "icons/huginn-logo.svg",
    "icons/audio.svg",
    "icons/video.svg",
    "icons/cut.svg",
)


def derive_extension_id(pubkey_b64: str) -> str:
    """Derive Chromium's 32-character a-p extension ID from a base64 DER public key."""
    der = base64.b64decode(pubkey_b64.encode("ascii"))
    digest = hashlib.sha256(der).hexdigest()[:32]
    derived = "".join(chr(ord("a") + int(char, 16)) for char in digest)
    if derived != CHROMIUM_EXTENSION_ID:
        raise ValueError(
            f"Derived Chromium extension ID {derived} != expected {CHROMIUM_EXTENSION_ID}"
        )
    return derived


def build_chromium_manifest(firefox_manifest: dict) -> dict:
    """Translate the shared Firefox MV2 manifest into a Chromium MV3 manifest."""
    derive_extension_id(CHROMIUM_PUBLIC_KEY)
    icon_map = {
        "16": "icons/huginn-logo-16.png",
        "32": "icons/huginn-logo-32.png",
        "48": "icons/huginn-logo-48.png",
        "128": "icons/huginn-logo-128.png",
    }
    return {
        "manifest_version": 3,
        "name": firefox_manifest["name"],
        "version": firefox_manifest["version"],
        "description": firefox_manifest["description"],
        "homepage_url": firefox_manifest["homepage_url"],
        "key": CHROMIUM_PUBLIC_KEY,
        "permissions": ["nativeMessaging", "contextMenus", "activeTab", "scripting"],
        "host_permissions": [
            "*://*.youtube.com/*",
            "*://youtube.com/*",
            "*://*.youtu.be/*",
            "*://youtu.be/*",
        ],
        "background": {"service_worker": "background.js"},
        "action": {
            "default_title": firefox_manifest["name"],
            "default_popup": "popup.html",
            "default_icon": dict(icon_map),
        },
        "options_ui": {
            "page": "popup.html?view=options",
            "open_in_tab": False,
        },
        "content_scripts": firefox_manifest["content_scripts"],
        "icons": dict(icon_map),
    }


def build_chromium(
    source: Path,
    unpacked_dir: Path,
    zip_output: Path,
    logo_dir: Path | None = None,
) -> list[str]:
    """Build an unpacked MV3 directory and a deterministic zip archive."""
    missing = [
        name for name in REQUIRED_SOURCE_FILES if not (source / name).is_file()
    ]
    if missing:
        raise ValueError("missing required extension files: " + ", ".join(missing))

    resolved_logo_dir = (
        logo_dir
        if logo_dir is not None
        else Path(__file__).resolve().parents[1] / "docs/logo"
    )
    missing_pngs = [
        name
        for name in PNG_ICON_NAMES
        if not (resolved_logo_dir / name).is_file()
    ]
    if missing_pngs:
        raise ValueError("missing required PNG icons: " + ", ".join(missing_pngs))

    try:
        firefox_manifest = json.loads(
            (source / "manifest.json").read_text(encoding="utf-8")
        )
    except json.JSONDecodeError as error:
        raise ValueError(f"manifest.json is not valid JSON: {error}") from error

    for key in ("manifest_version", "name", "version", "description", "homepage_url"):
        if key not in firefox_manifest:
            raise ValueError(f"manifest.json is missing required key: {key}")

    mv3_manifest = build_chromium_manifest(firefox_manifest)

    if unpacked_dir.exists():
        shutil.rmtree(unpacked_dir)
    unpacked_dir.mkdir(parents=True, exist_ok=True)
    (unpacked_dir / "icons").mkdir(parents=True, exist_ok=True)

    for rel_path in REQUIRED_SOURCE_FILES:
        if rel_path == "manifest.json":
            continue
        src_file = source / rel_path
        dst_file = unpacked_dir / rel_path
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dst_file)

    for png_name in PNG_ICON_NAMES:
        shutil.copy2(
            resolved_logo_dir / png_name,
            unpacked_dir / "icons" / png_name,
        )

    (unpacked_dir / "manifest.json").write_text(
        json.dumps(mv3_manifest, indent=2) + "\n", encoding="utf-8"
    )

    files = sorted(
        (
            path
            for path in unpacked_dir.rglob("*")
            if path.is_file()
            and not any(
                part.startswith(".") for part in path.relative_to(unpacked_dir).parts
            )
        ),
        key=lambda path: path.relative_to(unpacked_dir).as_posix(),
    )
    names = [path.relative_to(unpacked_dir).as_posix() for path in files]
    if names[0] != "manifest.json" and "manifest.json" in names:
        names.remove("manifest.json")
        names.insert(0, "manifest.json")
    by_name = {path.relative_to(unpacked_dir).as_posix(): path for path in files}

    zip_output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, by_name[name].read_bytes())

    with zipfile.ZipFile(zip_output) as archive:
        archived = archive.namelist()
        if archived[0] != "manifest.json":
            raise ValueError("manifest.json must be the first archive entry")
        if archived[1:] != sorted(archived[1:]):
            raise ValueError("entries after manifest must be sorted")
        bad = archive.testzip()
        if bad is not None:
            raise ValueError(f"corrupt entry in chromium zip: {bad}")
    return names


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    root = Path(__file__).resolve().parents[1]
    source = Path(args[0]) if len(args) > 0 else root / "extension"
    unpacked = Path(args[1]) if len(args) > 1 else root / "dist/huginn-chromium"
    zip_out = Path(args[2]) if len(args) > 2 else root / "dist/huginn-chromium.zip"
    try:
        names = build_chromium(source, unpacked, zip_out)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"wrote {unpacked} and {zip_out} ({len(names)} files, id={CHROMIUM_EXTENSION_ID})")
    for name in names:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
