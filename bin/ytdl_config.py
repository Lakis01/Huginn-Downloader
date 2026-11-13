"""Shared configuration helpers for the YouTube Downloader plugins."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
import tempfile
from typing import Any


DEFAULT_FRESH_DOWNLOAD_DIR = "~/Music/Youtube Downloads"
ALT_FRESH_DOWNLOAD_DIR = "~/Downloads/Youtube"
SUPPORTED_AUDIO_FORMATS = ("best", "opus", "mp3", "m4a", "ogg", "flac")
SUPPORTED_MP3_QUALITIES = ("V0", "320k", "V2", "V5")
LEGACY_MP3_QUALITY_ALIASES = {"128k": "V5"}

_DEFAULT_CONFIG = {
    "download_dir": None,
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
    for key in ("auto_tag", "rsgain"):
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
    for key in ("auto_tag", "rsgain"):
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
        return _expand_user(download_dir, env)
    if ytdlp_config_exists(env, platform_name):
        return None
    return _expand_user(DEFAULT_FRESH_DOWNLOAD_DIR, env)
