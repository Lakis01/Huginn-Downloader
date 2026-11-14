#!/usr/bin/env python3
"""Install the Huginn Downloader companion on Windows."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
BIN_SOURCE = ROOT / "bin"
BUILD_SCRIPT = ROOT / "scripts/build_xpi.py"
APP_NAME = "FirefoxYouTubeDownloader"
HOST_NAME = "firefox_youtube_downloader"
EXTENSION_ID = "firefox-youtube-downloader@lakis01.github.io"

sys.path.insert(0, str(BIN_SOURCE))
import ytdl_config


def _is_windows() -> bool:
    return os.name == "nt"


def _local_app_data(environment: dict[str, str]) -> Path:
    home = environment.get("HOME") or environment.get("USERPROFILE") or str(Path.home())
    return Path(
        environment.get("LOCALAPPDATA")
        or (Path(home) / "AppData" / "Local")
    )


def _windows_paths(environment: dict[str, str]) -> dict[str, Path]:
    app_dir = _local_app_data(environment) / APP_NAME
    bin_dir = app_dir / "bin"
    manifest = app_dir / f"{HOST_NAME}.json"
    config = ytdl_config.config_path(environment, "nt")
    return {
        "app": app_dir,
        "bin": bin_dir,
        "host": bin_dir / "yt-dlp-native-host.py",
        "trampoline": bin_dir / "yt-dlp-native-host.cmd",
        "manifest": manifest,
        "config": config,
        "xpi": ROOT / "dist/firefox-youtube-downloader.xpi",
    }


def _existing_ytdlp_config(environment: dict[str, str]) -> bool:
    return ytdl_config.ytdlp_config_exists(environment, "nt")


def _check_deps() -> int:
    print("Windows prerequisites (install these yourself; this command makes no changes):")
    print("  yt-dlp: winget install yt-dlp.yt-dlp")
    print("  FFmpeg: winget install Gyan.FFmpeg.Shared")
    print("  Python 3: winget install Python.Python.3.12")
    print("  Python libraries: py -3 -m pip install mutagen Pillow")
    print("  Optional ReplayGain: install rsgain with Scoop or another trusted package source")
    return 0


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Install the Huginn Downloader Windows companion."
    )
    parser.add_argument("--install", action="store_true", help="apply the installation")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    parser.add_argument("--download-dir", help="path or 'ytdlp-default'")
    parser.add_argument("--auto-tag", choices=("true", "false"))
    parser.add_argument("--rsgain", choices=("true", "false"))
    parser.add_argument("--check-deps", action="store_true", help="show prerequisites")
    args = parser.parse_args(argv)
    if args.check_deps and (
        args.install or args.yes or args.download_dir is not None
        or args.auto_tag is not None or args.rsgain is not None
    ):
        parser.error("--check-deps cannot be combined with installation options")
    if not args.install and (
        args.yes or args.download_dir is not None or args.auto_tag is not None
        or args.rsgain is not None
    ):
        parser.error("installation options require --install")
    return args


def _preflight(paths: dict[str, Path], sources: list[Path]) -> None:
    destinations = [paths["bin"] / source.name for source in sources]
    destinations.extend(
        [paths["trampoline"], paths["manifest"], paths["config"], paths["xpi"]]
    )
    for destination in destinations:
        if destination.is_dir():
            raise IsADirectoryError(f"Destination is a directory: {destination}")


def _write_json(destination: Path, value: dict) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _register_native_host(manifest_path: Path) -> None:
    import winreg

    registry_path = rf"Software\Mozilla\NativeMessagingHosts\{HOST_NAME}"
    key = winreg.CreateKeyEx(
        winreg.HKEY_CURRENT_USER, registry_path, 0, winreg.KEY_WRITE
    )
    try:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
    finally:
        winreg.CloseKey(key)


def _configuration(paths: dict[str, Path], args, environment: dict[str, str]) -> dict:
    if paths["config"].is_file():
        config = ytdl_config.load_config(environment, "nt")
    else:
        config = {
            "download_dir": (
                None
                if _existing_ytdlp_config(environment)
                else ytdl_config.DEFAULT_FRESH_DOWNLOAD_DIR
            ),
            "auto_tag": True,
            "rsgain": False,
        }
    if args.download_dir is not None:
        config["download_dir"] = (
            None if args.download_dir == "ytdlp-default" else args.download_dir
        )
    if args.auto_tag is not None:
        config["auto_tag"] = args.auto_tag == "true"
    if args.rsgain is not None:
        config["rsgain"] = args.rsgain == "true"
    return config


def _install_windows(args, environment: dict[str, str]) -> int:
    paths = _windows_paths(environment)
    sources = sorted(BIN_SOURCE.glob("*.py"), key=lambda item: item.name)
    _preflight(paths, sources)

    config = _configuration(paths, args, environment)

    paths["bin"].mkdir(parents=True, exist_ok=True)
    for source in sources:
        destination = paths["bin"] / source.name
        shutil.copy2(source, destination)
        print(f"Installed {source.name} -> {destination}")

    trampoline = (
        "@echo off\r\n"
        f'"{sys.executable}" "%~dp0yt-dlp-native-host.py" %*\r\n'
    )
    with paths["trampoline"].open("w", encoding="utf-8", newline="") as stream:
        stream.write(trampoline)
    manifest = {
        "name": HOST_NAME,
        "description": "Native Messaging host for Huginn Downloader",
        "path": str(paths["trampoline"]),
        "type": "stdio",
        "allowed_extensions": [EXTENSION_ID],
    }
    _write_json(paths["manifest"], manifest)
    _register_native_host(paths["manifest"])

    subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), str(ROOT / "extension"), str(paths["xpi"])],
        check=True,
    )
    config_destination = ytdl_config.save_config(config, environment, "nt")
    print(f"Saved plugin configuration to {config_destination}")
    print(f"Installed native messaging manifest -> {paths['manifest']}")
    print(f"Registered HKCU native host: {HOST_NAME}")
    print(f"Built {paths['xpi']}")
    return 0


def main(argv=None) -> int:
    args = _parse_args(argv)
    if args.check_deps:
        return _check_deps()

    if not _is_windows():
        if args.install:
            print("install.py --install is for Windows; use ./install.sh on Linux or macOS.", file=sys.stderr)
            return 2
        print("Dry run: install.py applies changes only on Windows with --install.")
        return 0

    environment = dict(os.environ)
    paths = _windows_paths(environment)
    if not args.install:
        print("Dry run: no files, configuration, registry entries, or build artifacts will be changed.")
        for source in sorted(BIN_SOURCE.glob("*.py"), key=lambda item: item.name):
            print(f"  {source} -> {paths['bin'] / source.name}")
        print(f"  Write trampoline: {paths['trampoline']}")
        print(f"  Write native messaging manifest: {paths['manifest']}")
        print(f"  Register HKCU native host: {HOST_NAME}")
        print(f"  Config: {paths['config']}")
        print(f"  Build {paths['xpi']}")
        return 0

    if not args.yes:
        answer = input("Install the Windows companion now? [y/N] ").strip().lower()
        if answer not in {"y", "yes"}:
            print("Installation cancelled.")
            return 1
    try:
        return _install_windows(args, environment)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Installation failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
