"""Shared configuration helpers for Huginn Downloader."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any


DEFAULT_FRESH_DOWNLOAD_DIR = "~/Music/Youtube Downloads"
DEFAULT_VIDEO_DOWNLOAD_DIR = "~/Videos/Youtube Downloads"
ALT_FRESH_DOWNLOAD_DIR = "~/Downloads/Youtube"
SUPPORTED_AUDIO_FORMATS = ("best", "opus", "mp3", "m4a", "ogg", "flac")
SUPPORTED_MP3_QUALITIES = ("V0", "320k", "V2", "V5")
LEGACY_MP3_QUALITY_ALIASES = {"128k": "V5"}

_DEFAULT_CONFIG = {
    "download_dir": None,
    "video_download_dir": DEFAULT_VIDEO_DOWNLOAD_DIR,
    "verbose_output": False,
    "auto_tag": True,
    "rsgain": False,
    "audio_format": "best",
    "mp3_quality": "V0",
    "embed_thumbnail": True,
    "thumbnail_jpg": False,
    "channel_mode": "stereo",
    "long_audio_enabled": False,
    "long_audio_minutes": 30,
    "long_audio_dir": "~/Podcasts",
}


def _environment(env: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if env is None else env


def _home(env: Mapping[str, str] | None) -> Path:
    values = _environment(env)
    return Path(values.get("HOME") or Path.home())


def _expand_user(value: str | Path, env: Mapping[str, str] | None) -> str:
    path = str(value)
    if path == "~":
        return str(_home(env))
    if path.startswith("~/"):
        return str(_home(env) / path[2:])
    return path


_XDG_USER_DIRS = {
    "MUSIC": ("XDG_MUSIC_DIR", "Music"),
    "VIDEOS": ("XDG_VIDEOS_DIR", "Videos"),
    "DOWNLOAD": ("XDG_DOWNLOAD_DIR", "Downloads"),
}


def _is_linux_platform(platform_name: str | None) -> bool:
    if platform_name is None:
        return sys.platform.startswith("linux")
    return platform_name.startswith("linux") or platform_name == "posix"


def _expand_xdg_path(value: str, env: Mapping[str, str] | None) -> Path | None:
    """Expand only HOME syntax in an XDG user-dir value; never evaluate it."""
    home = str(_home(env))
    value = value.replace("${HOME}", home).replace("$HOME", home)
    if value == "~":
        value = home
    elif value.startswith("~/"):
        value = str(Path(home) / value[2:])
    path = Path(value)
    return path if path.is_absolute() else None


def _read_user_dir_file(
    key: str, path: Path, env: Mapping[str, str] | None
) -> Path | None:
    """Read one quoted user-dirs.dirs assignment without sourcing shell code."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return None

    result = None
    for line in lines:
        name, separator, raw_value = line.partition("=")
        if not separator or name.strip() != key:
            continue
        raw_value = raw_value.strip()
        if raw_value.startswith('"'):
            if len(raw_value) < 2 or not raw_value.endswith('"'):
                continue
            raw_value = raw_value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        elif raw_value.startswith("'"):
            if len(raw_value) < 2 or not raw_value.endswith("'"):
                continue
            raw_value = raw_value[1:-1]
        else:
            raw_value = raw_value.split("#", 1)[0].strip()
        candidate = _expand_xdg_path(raw_value, env)
        if candidate is not None:
            result = candidate
    return result


def xdg_user_dir(
    kind: str,
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
) -> Path:
    """Resolve an XDG Music, Videos, or Downloads directory safely."""
    normalized_kind = str(kind).upper()
    if normalized_kind not in _XDG_USER_DIRS:
        raise ValueError("kind must be MUSIC, VIDEOS, or DOWNLOAD")
    key, fallback_name = _XDG_USER_DIRS[normalized_kind]
    home = _home(env)
    fallback = home / fallback_name
    if not _is_linux_platform(platform_name):
        return fallback

    values = _environment(env)
    explicit = values.get(key)
    if isinstance(explicit, str) and explicit.strip():
        expanded = _expand_xdg_path(explicit.strip(), env)
        if expanded is not None:
            return expanded

    config_home_value = values.get("XDG_CONFIG_HOME")
    if config_home_value:
        config_home = _expand_xdg_path(config_home_value, env)
    else:
        config_home = home / ".config"
    if config_home is not None:
        configured = _read_user_dir_file(
            key, config_home / "user-dirs.dirs", env
        )
        if configured is not None:
            return configured
    return fallback


def _display_path(path: Path, env: Mapping[str, str] | None) -> str:
    home = _home(env)
    try:
        relative = path.relative_to(home)
    except ValueError:
        return str(path)
    return "~" if not relative.parts else f"~/{relative.as_posix()}"


def user_download_directories(
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
) -> dict[str, str]:
    """Return the popup's display-ready project subfolders."""
    music = xdg_user_dir("MUSIC", env, platform_name) / "Youtube Downloads"
    videos = xdg_user_dir("VIDEOS", env, platform_name) / "Youtube Downloads"
    downloads = xdg_user_dir("DOWNLOAD", env, platform_name) / "Youtube"
    return {
        "music": _display_path(music, env),
        "videos": _display_path(videos, env),
        "downloads": _display_path(downloads, env),
    }


def _legacy_directory_is_populated(path: Path) -> bool:
    try:
        next(path.iterdir())
    except StopIteration:
        return False
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True


def _normalize_legacy_default(
    value: str | None,
    folder_kind: str,
    env: Mapping[str, str] | None,
    platform_name: str | None,
) -> str | None:
    if not isinstance(value, str) or not _is_linux_platform(platform_name):
        return value
    candidates = {
        "audio": {
            DEFAULT_FRESH_DOWNLOAD_DIR: "music",
            ALT_FRESH_DOWNLOAD_DIR: "downloads",
        },
        "video": {
            DEFAULT_VIDEO_DOWNLOAD_DIR: "videos",
            ALT_FRESH_DOWNLOAD_DIR: "downloads",
        },
    }.get(folder_kind, {})
    normalized_value = os.path.normpath(os.path.abspath(_expand_user(value, env)))
    for old_value, new_key in candidates.items():
        old_path = os.path.normpath(os.path.abspath(_expand_user(old_value, env)))
        if normalized_value != old_path:
            continue
        if _legacy_directory_is_populated(Path(old_path)):
            return value
        return user_download_directories(env, platform_name)[new_key]
    return value


def config_path(
    env: Mapping[str, str] | None = None, platform_name: str | None = None
) -> Path:
    """Return the application config path for the supplied environment."""
    values = _environment(env)
    platform_name = os.name if platform_name is None else platform_name
    if platform_name == "nt" and not values.get("XDG_CONFIG_HOME"):
        local_app_data = values.get("LOCALAPPDATA") or str(
            _home(env) / "AppData" / "Local"
        )
        return Path(local_app_data) / "FirefoxYouTubeDownloader" / "config.json"
    config_home = values.get("XDG_CONFIG_HOME") or str(_home(env) / ".config")
    return Path(_expand_user(config_home, env)) / "youtube-downloader" / "config.json"


def ytdlp_config_exists(
    env: Mapping[str, str] | None = None, platform_name: str | None = None
) -> bool:
    """Check the standard yt-dlp config locations under the supplied home."""
    values = _environment(env)
    platform_name = os.name if platform_name is None else platform_name
    config_home = values.get("XDG_CONFIG_HOME") or str(_home(env) / ".config")
    xdg_config = Path(_expand_user(config_home, env)) / "yt-dlp" / "config"
    legacy_config = _home(env) / ".yt-dlp.conf"
    if xdg_config.exists() or legacy_config.exists():
        return True
    if platform_name == "nt" and values.get("APPDATA"):
        roaming_config = Path(values["APPDATA"]) / "yt-dlp"
        return (roaming_config / "config").exists() or (
            roaming_config / "config.txt"
        ).exists()
    return False


def load_config(
    env: Mapping[str, str] | None = None, platform_name: str | None = None
) -> dict[str, Any]:
    """Load the persisted options, applying defaults to missing/invalid values."""
    config = dict(_DEFAULT_CONFIG)
    config["video_download_dir"] = _normalize_legacy_default(
        config["video_download_dir"], "video", env, platform_name
    )
    try:
        stored = json.loads(
            config_path(env, platform_name).read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return config
    if not isinstance(stored, dict):
        return config

    download_dir = stored.get("download_dir", config["download_dir"])
    if download_dir is None or isinstance(download_dir, str):
        config["download_dir"] = download_dir
    video_download_dir = stored.get("video_download_dir", config["video_download_dir"])
    if video_download_dir is None or isinstance(video_download_dir, str):
        config["video_download_dir"] = video_download_dir
    for key in ("auto_tag", "rsgain", "verbose_output"):
        value = stored.get(key, config[key])
        if isinstance(value, bool):
            config[key] = value
    for key, supported_values in (
        ("audio_format", SUPPORTED_AUDIO_FORMATS),
        ("mp3_quality", SUPPORTED_MP3_QUALITIES),
    ):
        value = stored.get(key, config[key])
        if isinstance(value, str) and value in LEGACY_MP3_QUALITY_ALIASES:
            value = LEGACY_MP3_QUALITY_ALIASES[value]
        if isinstance(value, str) and value in supported_values:
            config[key] = value
    for key in ("embed_thumbnail", "thumbnail_jpg", "long_audio_enabled"):
        value = stored.get(key, config[key])
        if isinstance(value, bool):
            config[key] = value
    channel_mode = stored.get("channel_mode")
    if isinstance(channel_mode, str) and channel_mode in {"stereo", "ask", "mono"}:
        config["channel_mode"] = channel_mode
    elif isinstance(stored.get("mono_audio"), bool):
        config["channel_mode"] = "mono" if stored["mono_audio"] else "stereo"
    minutes = stored.get("long_audio_minutes", config["long_audio_minutes"])
    if isinstance(minutes, int) and not isinstance(minutes, bool) and minutes > 0:
        config["long_audio_minutes"] = minutes
    long_dir = stored.get("long_audio_dir", config["long_audio_dir"])
    if isinstance(long_dir, str) and long_dir.strip():
        config["long_audio_dir"] = long_dir
    config["download_dir"] = _normalize_legacy_default(
        config["download_dir"], "audio", env, platform_name
    )
    config["video_download_dir"] = _normalize_legacy_default(
        config["video_download_dir"], "video", env, platform_name
    )
    return config


def save_config(
    config: Mapping[str, Any],
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
) -> Path:
    """Validate and atomically write the supported application options."""
    if not isinstance(config, Mapping):
        raise TypeError("config must be a mapping")

    normalized = dict(_DEFAULT_CONFIG)
    if "download_dir" in config:
        value = config["download_dir"]
        if value is not None and not isinstance(value, str):
            raise TypeError("download_dir must be a string or None")
        normalized["download_dir"] = value
    if "video_download_dir" in config:
        value = config["video_download_dir"]
        if value is not None and not isinstance(value, str):
            raise TypeError("video_download_dir must be a string or None")
        normalized["video_download_dir"] = value
    for key in ("auto_tag", "rsgain", "verbose_output"):
        if key in config:
            value = config[key]
            if not isinstance(value, bool):
                raise TypeError(f"{key} must be a bool")
            normalized[key] = value
    for key, supported_values in (
        ("audio_format", SUPPORTED_AUDIO_FORMATS),
        ("mp3_quality", SUPPORTED_MP3_QUALITIES),
    ):
        if key in config:
            value = config[key]
            if not isinstance(value, str):
                raise TypeError(f"{key} must be a string")
            if value in LEGACY_MP3_QUALITY_ALIASES:
                value = LEGACY_MP3_QUALITY_ALIASES[value]
            if value not in supported_values:
                raise ValueError(f"{key} must be one of {supported_values}")
            normalized[key] = value
    for key in ("embed_thumbnail", "thumbnail_jpg", "long_audio_enabled"):
        if key in config:
            value = config[key]
            if not isinstance(value, bool):
                raise TypeError(f"{key} must be a bool")
            normalized[key] = value
    if "channel_mode" in config:
        value = config["channel_mode"]
        if not isinstance(value, str):
            raise TypeError("channel_mode must be a string")
        if value not in {"stereo", "ask", "mono"}:
            raise ValueError("channel_mode must be one of ('stereo', 'ask', 'mono')")
        normalized["channel_mode"] = value
    elif "mono_audio" in config:
        value = config["mono_audio"]
        if not isinstance(value, bool):
            raise TypeError("mono_audio must be a bool")
        normalized["channel_mode"] = "mono" if value else "stereo"
    if "long_audio_minutes" in config:
        value = config["long_audio_minutes"]
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ValueError("long_audio_minutes must be a positive integer")
        normalized["long_audio_minutes"] = value
    if "long_audio_dir" in config:
        value = config["long_audio_dir"]
        if not isinstance(value, str) or not value.strip():
            raise ValueError("long_audio_dir must be a non-empty string")
        normalized["long_audio_dir"] = value

    destination = config_path(env, platform_name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(normalized, temporary_file, indent=2)
            temporary_file.write("\n")
        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
    return destination


def effective_download_dir(
    config: Mapping[str, Any],
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
) -> str | None:
    """Resolve the app override, or defer to yt-dlp's configured paths."""
    download_dir = config.get("download_dir")
    if download_dir is not None:
        download_dir = _normalize_legacy_default(
            download_dir, "audio", env, platform_name
        )
        return _expand_user(download_dir, env)
    if ytdlp_config_exists(env, platform_name):
        return None
    return _expand_user(user_download_directories(env, platform_name)["music"], env)


def effective_video_download_dir(
    config: Mapping[str, Any],
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
) -> str | None:
    """Resolve the video override, or use yt-dlp's configured paths when selected."""
    download_dir = config.get("video_download_dir", DEFAULT_VIDEO_DOWNLOAD_DIR)
    if download_dir is not None:
        download_dir = _normalize_legacy_default(
            download_dir, "video", env, platform_name
        )
        return _expand_user(download_dir, env)
    if ytdlp_config_exists(env, platform_name):
        return None
    return _expand_user(user_download_directories(env, platform_name)["videos"], env)
