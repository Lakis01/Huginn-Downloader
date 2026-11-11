"""Shared configuration helpers for the YouTube Downloader plugins."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
import tempfile
from typing import Any


DEFAULT_FRESH_DOWNLOAD_DIR = "~/Music/Youtube Downloads"
ALT_FRESH_DOWNLOAD_DIR = "~/Downloads/Youtube"

_DEFAULT_CONFIG = {
    "download_dir": None,
    "auto_tag": True,
    "rsgain": False,
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


def config_path(env: Mapping[str, str] | None = None) -> Path:
    """Return the application config path for the supplied environment."""
    values = _environment(env)
    config_home = values.get("XDG_CONFIG_HOME") or str(_home(env) / ".config")
    return Path(_expand_user(config_home, env)) / "youtube-downloader" / "config.json"


def ytdlp_config_exists(env: Mapping[str, str] | None = None) -> bool:
    """Check the standard yt-dlp config locations under the supplied home."""
    values = _environment(env)
    config_home = values.get("XDG_CONFIG_HOME") or str(_home(env) / ".config")
    xdg_config = Path(_expand_user(config_home, env)) / "yt-dlp" / "config"
    legacy_config = _home(env) / ".yt-dlp.conf"
    return xdg_config.exists() or legacy_config.exists()


def load_config(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Load the persisted options, applying defaults to missing/invalid values."""
    config = dict(_DEFAULT_CONFIG)
    try:
        stored = json.loads(config_path(env).read_text(encoding="utf-8"))
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
    return config


def save_config(
    config: Mapping[str, Any], env: Mapping[str, str] | None = None
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

    destination = config_path(env)
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
    config: Mapping[str, Any], env: Mapping[str, str] | None = None
) -> str | None:
    """Resolve the app override, or defer to yt-dlp's configured paths."""
    download_dir = config.get("download_dir")
    if download_dir is not None:
        return _expand_user(download_dir, env)
    if ytdlp_config_exists(env):
        return None
    return _expand_user(DEFAULT_FRESH_DOWNLOAD_DIR, env)
