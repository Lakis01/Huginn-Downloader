"""Smart out-of-date yt-dlp version detector with a 24h cache."""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable, Mapping


CACHE_TTL_SECONDS = 86400
STALE_AGE_DAYS = 45

_GITHUB_LATEST_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"


def version_tuple(version_str: str) -> tuple[int, ...] | None:
    """Parse a dotted version string into integer segments."""
    if not isinstance(version_str, str):
        return None
    text = version_str.strip()
    if text[:1].lower() == "v":
        text = text[1:]
    if not text:
        return None
    parts = text.split(".")
    numbers: list[int] = []
    for part in parts:
        part = part.strip()
        if not part or not part.isdigit():
            return None
        numbers.append(int(part))
    if not numbers:
        return None
    return tuple(numbers)


def version_age_days(version_str: str, today: date | None = None) -> int | None:
    """Return whole days between a YYYY.MM.DD version and today."""
    parsed = version_tuple(version_str) if isinstance(version_str, str) else None
    if parsed is None or len(parsed) < 3:
        return None
    try:
        released = date(parsed[0], parsed[1], parsed[2])
    except ValueError:
        return None
    reference = today if today is not None else date.today()
    return (reference - released).days


def _normalize_platform(platform_name: str | None = None) -> str:
    if platform_name is None:
        raw = sys.platform
    else:
        raw = platform_name
    token = str(raw).lower()
    if token.startswith("win") or token == "nt" or "windows" in token:
        return "nt"
    if token.startswith("darwin") or token in {"mac", "macos", "osx"} or "darwin" in token:
        return "darwin"
    return "linux"


def _read_os_release() -> str | None:
    for candidate in ("/etc/os-release", "/usr/lib/os-release"):
        try:
            with open(candidate, encoding="utf-8") as handle:
                return handle.read()
        except OSError:
            continue
    return None


def detect_update_command(
    ytdlp_path: str | None = None,
    platform_name: str | None = None,
    os_release_text: str | None = None,
    env: Mapping[str, str] | None = None,
) -> str:
    """Return an OS/packager-specific command to update yt-dlp."""
    platform = _normalize_platform(platform_name)
    resolved = ytdlp_path
    if resolved is None:
        search_path = None
        if env is not None:
            try:
                search_path = env.get("PATH")
            except AttributeError:
                search_path = None
        resolved = shutil.which("yt-dlp", path=search_path) or "yt-dlp"
    text_path = os.path.expanduser(str(resolved))
    lowered = text_path.lower().replace("\\", "/")

    if platform == "nt":
        if "pipx" in lowered:
            return "pipx upgrade yt-dlp"
        if "winget" in lowered:
            return "winget upgrade yt-dlp.yt-dlp"
        if lowered.endswith(".exe"):
            return (
                "Download the latest yt-dlp.exe from "
                "https://github.com/yt-dlp/yt-dlp/releases/latest"
            )
        return "winget upgrade yt-dlp.yt-dlp"

    if platform == "darwin":
        if "pipx" in lowered:
            return "pipx upgrade yt-dlp"
        if (
            lowered.startswith("/opt/homebrew/")
            or lowered.startswith("/usr/local/")
            or "homebrew" in lowered
        ):
            return "brew upgrade yt-dlp"
        return "brew upgrade yt-dlp"

    if "pipx" in lowered:
        return "pipx upgrade yt-dlp"
    if text_path == "/usr/bin/yt-dlp" or text_path.startswith("/usr/bin/"):
        release = os_release_text if os_release_text is not None else _read_os_release()
        blob = (release or "").lower()
        if "fedora" in blob or "rhel" in blob or "centos" in blob:
            return "sudo dnf upgrade yt-dlp"
        if "arch" in blob or "manjaro" in blob:
            return "sudo pacman -Syu yt-dlp"
        return "sudo apt update && sudo apt install -y yt-dlp"
    if ".local/bin" in lowered:
        return "yt-dlp -U"
    if lowered.startswith("/usr/local/bin"):
        return "sudo yt-dlp -U"
    return "yt-dlp -U"


def _cache_path(
    env: Mapping[str, str] | None = None, platform_name: str | None = None
) -> str:
    values = os.environ if env is None else env
    platform = _normalize_platform(platform_name)
    try:
        get = values.get
    except AttributeError:
        get = lambda key, default=None: default  # noqa: E731

    def lookup(key: str, default: str | None = None) -> str | None:  # noqa: ANN202
        try:
            value = get(key, default)
        except Exception:
            return default
        return value if value else default

    if platform == "darwin":
        home = lookup("HOME") or str(Path.home())
        return os.path.join(
            home, "Library", "Caches", "FirefoxYouTubeDownloader", "ytdlp-version.json"
        )
    if platform == "nt":
        base = lookup("LOCALAPPDATA")
        if not base:
            home = lookup("USERPROFILE") or lookup("HOME") or str(Path.home())
            base = os.path.join(home, "AppData", "Local")
        return os.path.join(
            base, "FirefoxYouTubeDownloader", "cache", "ytdlp-version.json"
        )
    xdg_cache = lookup("XDG_CACHE_HOME")
    if xdg_cache:
        base_dir = xdg_cache
    else:
        home = lookup("HOME") or str(Path.home())
        base_dir = os.path.join(home, ".cache")
    return os.path.join(base_dir, "youtube-downloader", "ytdlp-version.json")


def _read_cache(cache_file: str) -> tuple[str | None, float | None]:
    try:
        with open(cache_file, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None, None
    if not isinstance(payload, dict):
        return None, None
    latest = payload.get("latest_version")
    checked_at = payload.get("checked_at")
    if not isinstance(latest, str) or not latest.strip():
        latest = None
    else:
        latest = latest.strip()
    try:
        checked = float(checked_at)
    except (TypeError, ValueError):
        checked = None
    return latest, checked


def _write_cache(cache_file: str, latest_version: str, checked_at: float) -> None:
    try:
        parent = os.path.dirname(cache_file)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as handle:
            json.dump(
                {"checked_at": checked_at, "latest_version": latest_version}, handle
            )
            handle.write("\n")
    except OSError:
        pass


def _installed_version(ytdlp_path: str | None = None) -> str | None:
    # Query the executable first: the wrapper runs `yt-dlp` from PATH, so a
    # stale `yt_dlp` Python package (e.g. system python3-yt-dlp) must not
    # shadow a newer ~/.local/bin/yt-dlp or pipx binary (or vice versa).
    candidates: list[str] = []
    if ytdlp_path:
        candidates.append(str(ytdlp_path))
    else:
        try:
            found = shutil.which("yt-dlp")
        except Exception:
            found = None
        candidates.append(found or "yt-dlp")
    for binary in candidates:
        try:
            completed = subprocess.run(
                [binary, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except Exception:
            continue
        if completed.returncode == 0 and completed.stdout.strip():
            return completed.stdout.strip().splitlines()[0].strip()
    try:
        from yt_dlp.version import __version__ as bundled
    except Exception:
        return None
    if isinstance(bundled, str) and bundled.strip():
        return bundled.strip()
    return None


def _fetch_latest_from_github(timeout: float = 1.8) -> str | None:
    import urllib.request

    request = urllib.request.Request(
        _GITHUB_LATEST_URL,
        headers={
            "User-Agent": "youtube-downloader",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    tag = payload.get("tag_name") or payload.get("name")
    if tag is None:
        return None
    text = str(tag).strip()
    if text[:1].lower() == "v":
        text = text[1:]
    return text.strip() or None


def check_ytdlp_update(
    *,
    allow_network: bool = False,
    force_refresh: bool = False,
    env: Mapping[str, str] | None = None,
    fetch_latest: Callable[[], str | None] | None = None,
    installed_version: str | None = None,
    ytdlp_path: str | None = None,
    today: date | None = None,
    platform_name: str | None = None,
    os_release_text: str | None = None,
) -> dict[str, Any]:
    """Check whether the installed yt-dlp is outdated (cached, offline-safe)."""
    values: Mapping[str, str] = os.environ if env is None else env
    if isinstance(installed_version, str):
        installed = installed_version.strip() or None
    elif installed_version is None:
        installed = _installed_version(ytdlp_path)
    else:
        installed = None

    reference = today if today is not None else date.today()
    age_days = version_age_days(installed, today=reference) if installed else None

    cache_file = _cache_path(values, platform_name)
    cached_latest, checked_at = _read_cache(cache_file)
    now = time.time()
    cache_fresh = (
        (not force_refresh)
        and cached_latest is not None
        and checked_at is not None
        and (now - checked_at) < CACHE_TTL_SECONDS
    )

    latest: str | None
    if cache_fresh:
        latest = cached_latest
    elif allow_network:
        fetched: str | None = None
        try:
            if fetch_latest is not None:
                fetched = fetch_latest()
            else:
                fetched = _fetch_latest_from_github(timeout=1.8)
        except Exception:
            fetched = None
        if isinstance(fetched, str):
            fetched = fetched.strip()
            if fetched[:1].lower() == "v":
                fetched = fetched[1:]
            fetched = fetched or None
        else:
            fetched = None
        if fetched:
            latest = fetched
            _write_cache(cache_file, latest, now)
        else:
            latest = cached_latest
    else:
        latest = cached_latest

    installed_tuple = version_tuple(installed) if installed else None
    latest_tuple = version_tuple(latest) if latest else None

    outdated = False
    if installed is None:
        reason = "unknown"
    elif latest is not None and installed_tuple is not None and latest_tuple is not None:
        if latest_tuple > installed_tuple:
            outdated = True
            reason = "behind_latest"
        else:
            reason = "up_to_date"
    elif latest is None:
        if age_days is not None and age_days > STALE_AGE_DAYS:
            outdated = True
            reason = "stale_age"
        elif age_days is not None:
            reason = "up_to_date"
        else:
            reason = "unknown"
    else:
        if installed == latest:
            reason = "up_to_date"
        else:
            reason = "unknown"

    update_hint = detect_update_command(
        ytdlp_path=ytdlp_path,
        platform_name=platform_name,
        os_release_text=os_release_text,
        env=values,
    )

    return {
        "installed": installed,
        "latest": latest,
        "outdated": outdated,
        "age_days": age_days,
        "reason": reason,
        "update_hint": update_hint,
    }
