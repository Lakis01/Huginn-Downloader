#!/usr/bin/env python3
"""Browser Native Messaging host for Huginn Downloader."""

import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

from ytdl_config import (
    detected_cpu_threads,
    effective_download_dir,
    effective_postprocess_threads,
    effective_video_download_dir,
    load_config,
    recommended_postprocess_threads,
    save_config,
    user_download_directories,
    ytdlp_config_exists,
)

try:
    from ytdl_version import check_ytdlp_update
except ImportError:  # pragma: no cover - helper ships alongside the host

    def check_ytdlp_update(*args, **kwargs):
        return {
            "installed": None,
            "latest": None,
            "outdated": False,
            "age_days": None,
            "reason": "unknown",
            "update_hint": "yt-dlp -U",
        }


VERSION = "2.5.10"
MAX_MESSAGE_SIZE = 1024 * 1024
MODES = {"audio", "video", "cut"}


def _is_windows():
    return os.name == "nt"


def _ensure_macos_gui_path():
    """Add common package-manager paths missing from GUI-launched processes."""
    if sys.platform != "darwin":
        return
    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    directories = (
        "/opt/homebrew/bin",
        "/usr/local/bin",
        os.path.expanduser("~/.local/bin"),
    )
    for directory in directories:
        if os.path.isdir(directory) and directory not in path_entries:
            path_entries.append(directory)
    os.environ["PATH"] = os.pathsep.join(path_entries)


def _ensure_linux_gui_path():
    """Prefer user-installed tools in GUI-launched browser processes."""
    if not sys.platform.startswith("linux"):
        return
    path_entries = os.environ.get("PATH", "").split(os.pathsep)
    for directory in reversed(
        (os.path.expanduser("~/.local/bin"), "/usr/local/bin")
    ):
        if os.path.isdir(directory):
            path_entries = [entry for entry in path_entries if entry != directory]
            path_entries.insert(0, directory)
    os.environ["PATH"] = os.pathsep.join(path_entries)


if sys.platform == "darwin":
    _ensure_macos_gui_path()
elif sys.platform.startswith("linux"):
    _ensure_linux_gui_path()


def _is_allowed_url(value):
    """Accept any safe http(s) URL (no whitespace/control chars, no userinfo)."""
    if not isinstance(value, str) or not value or value.startswith("-"):
        return False
    if any(ord(char) <= 0x20 or ord(char) == 0x7F for char in value):
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.username is not None or parsed.password is not None:
            return False
        hostname = (parsed.hostname or "").lower()
        if hostname.endswith("."):
            hostname = hostname[:-1]
        if not hostname or len(hostname) > 253:
            return False
        for label in hostname.split("."):
            ascii_label = label.encode("idna").decode("ascii")
            if not ascii_label or len(ascii_label) > 63 or not re.fullmatch(
                r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", ascii_label
            ):
                return False
        if parsed.port not in {None, 80, 443}:
            return False
    except (ValueError, UnicodeError):
        return False
    return True


def _dependencies():
    return {
        "yt_dlp": shutil.which("yt-dlp") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "rsgain": shutil.which("rsgain") is not None,
    }


def _normalize_playlist_items(value):
    """Validate and normalize a yt-dlp --playlist-items / -I specification."""
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("playlist_items must be a string")
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) > 256:
        raise ValueError("invalid playlist_items specification")
    tokens = []
    for raw_token in stripped.split(","):
        token = re.sub(r"\s*([-:])\s*", r"\1", raw_token.strip())
        if not token:
            raise ValueError("invalid playlist_items specification")
        if not re.fullmatch(r"(?:-?\d+|(?:-?\d+)?:-?\d*(?::-?\d*)?|\d+-\d+)", token):
            raise ValueError("invalid playlist_items specification")
        if not any(ch.isdigit() for ch in token):
            raise ValueError("invalid playlist_items specification")
        tokens.append(token)
    return ",".join(tokens)


_FORMAT_SELECTOR_RE = re.compile(r"^[A-Za-z0-9_+./:<=>^\[\]*,-]+$")
_SUPPORTED_CONVERT_FORMATS = {
    "native", "mp3", "flac", "wav", "alac", "aiff", "opus", "m4a", "ogg", "ac3",
}
_CONVERT_BITRATE_RE = re.compile(r"^(?:V0|V2|V5|\d{2,4}k)$")
_SUPPORTED_SAMPLE_RATES = {"44100", "48000", "96000"}
_SUPPORTED_CHANNELS = {"1", "2"}
_SUPPORTED_BIT_DEPTHS = {"16", "24", "32f"}
_SUPPORTED_VIDEO_CONTAINERS = {"mkv", "mp4", "webm"}
_WRAPPER_MODULE = None


def _load_wrapper_module():
    global _WRAPPER_MODULE
    if _WRAPPER_MODULE is None:
        wrapper_path = Path(__file__).with_name("yt-dlp-wrapper.py")
        spec = importlib.util.spec_from_file_location("yt_dlp_wrapper", wrapper_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _WRAPPER_MODULE = module
    return _WRAPPER_MODULE


def _normalize_download_options(message: dict) -> dict[str, str]:
    """Validate optional per-download format and FFmpeg pipeline flags."""
    opts: dict[str, str] = {}
    raw_selector = message.get("format_selector")
    if raw_selector is not None and raw_selector != "":
        if not isinstance(raw_selector, str):
            raise ValueError("format_selector must be a string")
        sel = raw_selector.strip()
        if (
            not sel
            or len(sel) > 256
            or sel.startswith("-")
            or not _FORMAT_SELECTOR_RE.fullmatch(sel)
        ):
            raise ValueError("invalid format_selector specification")
        opts["format_selector"] = sel

    raw_fmt = message.get("convert_format")
    if raw_fmt is not None and raw_fmt != "":
        if not isinstance(raw_fmt, str):
            raise ValueError("convert_format must be a string")
        fmt = raw_fmt.strip().lower()
        if fmt not in _SUPPORTED_CONVERT_FORMATS:
            raise ValueError("invalid convert_format specification")
        opts["convert_format"] = fmt

    raw_bitrate = message.get("convert_bitrate")
    if raw_bitrate is not None and raw_bitrate != "":
        if not isinstance(raw_bitrate, str):
            raise ValueError("convert_bitrate must be a string")
        br = raw_bitrate.strip()
        if not _CONVERT_BITRATE_RE.fullmatch(br):
            raise ValueError("invalid convert_bitrate specification")
        opts["convert_bitrate"] = br

    raw_sr = message.get("convert_sample_rate")
    if raw_sr is not None and raw_sr != "":
        if isinstance(raw_sr, bool) or not isinstance(raw_sr, (int, str)):
            raise ValueError("convert_sample_rate must be an integer or string")
        sr = str(raw_sr).strip()
        if sr not in _SUPPORTED_SAMPLE_RATES:
            raise ValueError("invalid convert_sample_rate specification")
        opts["convert_sample_rate"] = sr

    raw_ch = message.get("convert_channels")
    if raw_ch is not None and raw_ch != "":
        if isinstance(raw_ch, bool) or not isinstance(raw_ch, (int, str)):
            raise ValueError("convert_channels must be 1 or 2")
        ch = str(raw_ch).strip()
        if ch not in _SUPPORTED_CHANNELS:
            raise ValueError("convert_channels must be 1 or 2")
        opts["convert_channels"] = ch

    raw_bd = message.get("convert_bit_depth")
    if raw_bd is not None and raw_bd != "":
        if not isinstance(raw_bd, str):
            raise ValueError("convert_bit_depth must be a string")
        bd = raw_bd.strip().lower()
        if bd not in _SUPPORTED_BIT_DEPTHS:
            raise ValueError("invalid convert_bit_depth specification")
        opts["convert_bit_depth"] = bd

    raw_vc = message.get("video_container")
    if raw_vc is not None and raw_vc != "":
        if not isinstance(raw_vc, str):
            raise ValueError("video_container must be a string")
        vc = raw_vc.strip().lower()
        if vc not in _SUPPORTED_VIDEO_CONTAINERS:
            raise ValueError("invalid video_container specification")
        opts["video_container"] = vc
    return opts


def _launch_download(
    mode: str,
    chosen_url: str,
    *,
    playlist: bool | None = None,
    playlist_items: str | None = None,
    extra_options: dict[str, str] | None = None,
) -> None:
    """Launch a download in a user-visible terminal on the current OS."""
    extra_args: list[str] = []
    if playlist is True:
        extra_args.append("--playlist")
    elif playlist is False:
        extra_args.append("--no-playlist")
    if playlist_items:
        extra_args.extend(["--playlist-items", playlist_items])
    if extra_options:
        flag_map = (
            ("format_selector", "--format-selector"),
            ("convert_format", "--convert-format"),
            ("convert_bitrate", "--convert-bitrate"),
            ("convert_sample_rate", "--convert-sample-rate"),
            ("convert_channels", "--convert-channels"),
            ("convert_bit_depth", "--convert-bit-depth"),
            ("video_container", "--video-container"),
        )
        for key, flag in flag_map:
            value = extra_options.get(key)
            if value:
                extra_args.extend([flag, value])

    wrapper_py = Path(__file__).with_name("yt-dlp-wrapper.py")
    if sys.platform.startswith("linux"):
        shortcut = Path(
            os.environ.get(
                "YTDL_SHORTCUT", str(Path(__file__).with_name("yt-dlp-shortcut.sh"))
            )
        )
        subprocess.Popen(
            [str(shortcut), *extra_args, mode, chosen_url],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return

    if sys.platform == "darwin":
        descriptor, command_path = tempfile.mkstemp(
            prefix="ytdl-launch-", suffix=".command"
        )
        try:
            os.fchmod(descriptor, 0o700)
            quoted_args = " ".join(
                shlex.quote(arg) for arg in [*extra_args, mode, chosen_url]
            )
            command = (
                "#!/bin/sh\n"
                'rm -f -- "$0"\n'
                'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"\n'
                f"exec {shlex.quote(sys.executable)} "
                f"{shlex.quote(str(wrapper_py))} --wait-keypress "
                f"{quoted_args}\n"
            )
            stream = os.fdopen(descriptor, "w", encoding="utf-8")
            descriptor = -1
            with stream:
                stream.write(command)
            subprocess.Popen(
                ["open", "-a", "Terminal", command_path],
                start_new_session=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            if descriptor >= 0:
                os.close(descriptor)
            try:
                os.unlink(command_path)
            except OSError:
                pass
            raise
        return

    if _is_windows():
        command = [
            sys.executable,
            str(wrapper_py),
            "--wait-keypress",
            *extra_args,
            mode,
            chosen_url,
        ]
        terminal = shutil.which("wt")
        if terminal:
            command.insert(0, terminal)
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            subprocess.Popen(
                command,
                creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0x10),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        return

    raise OSError(f"Unsupported platform: {sys.platform}")


def _safe_ytdlp_status(*, allow_network=False):
    try:
        return check_ytdlp_update(allow_network=allow_network)
    except Exception:
        return {
            "installed": None,
            "latest": None,
            "outdated": False,
            "age_days": None,
            "reason": "unknown",
            "update_hint": "yt-dlp -U",
        }


def _config_response():
    config = load_config()
    yt_dlp_status = _safe_ytdlp_status(allow_network=False)
    return {
        "ok": True,
        "version": VERSION,
        "config": config,
        "effective_download_dir": effective_download_dir(config),
        "effective_video_download_dir": effective_video_download_dir(config),
        "user_download_directories": user_download_directories(),
        "ytdlp_config_exists": ytdlp_config_exists(),
        "deps": _dependencies(),
        "yt_dlp_status": yt_dlp_status,
        "cpu_threads": detected_cpu_threads(),
        "recommended_threads": recommended_postprocess_threads(),
        "effective_threads": effective_postprocess_threads(config),
    }


def _pick_allowed_url(message):
    fallbacks = message.get("fallbacks") or []
    if not isinstance(fallbacks, list):
        raise ValueError("fallbacks must be a list")
    candidates = [message.get("url"), *fallbacks]
    chosen_url = next((url for url in candidates if _is_allowed_url(url)), None)
    if chosen_url is None:
        raise ValueError("no valid URL was provided")
    return chosen_url


def _handle_list_formats(message):
    try:
        chosen_url = _pick_allowed_url(message)
    except ValueError as error:
        return {"ok": False, "error": str(error)}
    try:
        wrapper = _load_wrapper_module()
        data = wrapper.list_formats_for_url(chosen_url)
    except Exception as error:
        return {"ok": False, "error": str(error)}
    return {"ok": True, "url": chosen_url, **data}


def _handle_download(message):
    mode = message.get("mode")
    if mode not in MODES:
        return {"ok": False, "error": "mode must be audio, video, or cut"}

    playlist = message.get("playlist")
    if playlist is not None and not isinstance(playlist, bool):
        return {"ok": False, "error": "playlist must be a boolean"}

    try:
        playlist_items = _normalize_playlist_items(message.get("playlist_items"))
        chosen_url = _pick_allowed_url(message)
        extra_options = {} if mode == "cut" else _normalize_download_options(message)
    except ValueError as error:
        return {"ok": False, "error": str(error)}

    if playlist is False:
        playlist_items = None

    try:
        kwargs = {}
        if playlist is not None:
            kwargs["playlist"] = playlist
        if playlist_items is not None:
            kwargs["playlist_items"] = playlist_items
        if extra_options:
            kwargs["extra_options"] = extra_options
        _launch_download(mode, chosen_url, **kwargs)
    except OSError as error:
        return {"ok": False, "error": str(error)}
    response = {"ok": True, "launched": True, "mode": mode, "url": chosen_url}
    if playlist is not None:
        response["playlist"] = playlist
    if playlist_items is not None:
        response["playlist_items"] = playlist_items
    for key, value in extra_options.items():
        response[key] = value
    return response


def handle_message(message):
    if not isinstance(message, dict):
        return {"ok": False, "error": "message must be a JSON object"}
    action = message.get("action")
    try:
        if action in {"ping", "get_config"}:
            return _config_response()
        if action == "check_ytdlp_update":
            return {"ok": True, "yt_dlp_status": _safe_ytdlp_status(allow_network=True)}
        if action == "list_formats":
            return _handle_list_formats(message)
        if action == "set_config":
            updates = message.get("config", {})
            if not isinstance(updates, dict):
                return {"ok": False, "error": "config must be a JSON object"}
            config = load_config()
            config.update(updates)
            if config.get("download_dir") == "":
                config["download_dir"] = None
            if config.get("video_download_dir") == "":
                config["video_download_dir"] = None
            if config.get("postprocess_threads") in (0, None):
                config.pop("postprocess_threads", None)
            save_config(config)
            return _config_response()
        if action == "download":
            return _handle_download(message)
        return {"ok": False, "error": "unknown action"}
    except (OSError, TypeError, ValueError) as error:
        return {"ok": False, "error": str(error)}


def _read_exact(stream, size):
    chunks = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _write_message(stream, message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    stream.write(struct.pack("=I", len(payload)))
    stream.write(payload)
    stream.flush()


def main():
    source = sys.stdin.buffer
    destination = sys.stdout.buffer
    while True:
        header = _read_exact(source, 4)
        if not header:
            return 0
        if len(header) != 4:
            _write_message(destination, {"ok": False, "error": "incomplete message header"})
            return 1
        message_size = struct.unpack("=I", header)[0]
        if message_size > MAX_MESSAGE_SIZE:
            _write_message(destination, {"ok": False, "error": "message size exceeds 1 MiB"})
            return 1
        payload = _read_exact(source, message_size)
        if len(payload) != message_size:
            _write_message(destination, {"ok": False, "error": "incomplete message body"})
            return 1
        try:
            message = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            _write_message(destination, {"ok": False, "error": f"invalid JSON message: {error}"})
            continue
        _write_message(destination, handle_message(message))


if __name__ == "__main__":
    raise SystemExit(main())
