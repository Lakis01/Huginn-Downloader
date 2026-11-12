#!/usr/bin/env python3
"""Firefox Native Messaging host for the YouTube Downloader."""

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
    effective_download_dir,
    load_config,
    save_config,
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


VERSION = "2.0.0"
MAX_MESSAGE_SIZE = 1024 * 1024
MODES = {"audio", "video", "cut"}
YOUTUBE_HOSTS = ("youtube.com", "youtu.be", "youtube-nocookie.com")


def _is_windows():
    return os.name == "nt"


def _is_youtube_url(value):
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
        if not hostname or not any(
            hostname == domain or hostname.endswith("." + domain)
            for domain in YOUTUBE_HOSTS
        ):
            return False
        if hostname.endswith(".") or len(hostname) > 253:
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


def _launch_download(mode: str, chosen_url: str) -> None:
    """Launch a download in a user-visible terminal on the current OS."""
    wrapper_py = Path(__file__).with_name("yt-dlp-wrapper.py")
    if sys.platform.startswith("linux"):
        shortcut = Path(
            os.environ.get(
                "YTDL_SHORTCUT", str(Path(__file__).with_name("yt-dlp-shortcut.sh"))
            )
        )
        subprocess.Popen(
            [str(shortcut), mode, chosen_url],
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
            command = (
                "#!/bin/sh\n"
                'rm -f -- "$0"\n'
                f"exec {shlex.quote(sys.executable)} "
                f"{shlex.quote(str(wrapper_py))} --wait-keypress "
                f"{shlex.quote(mode)} {shlex.quote(chosen_url)}\n"
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


def _config_response():
    config = load_config()
    try:
        yt_dlp_status = check_ytdlp_update(allow_network=False)
    except Exception:
        yt_dlp_status = {
            "installed": None,
            "latest": None,
            "outdated": False,
            "age_days": None,
            "reason": "unknown",
            "update_hint": "yt-dlp -U",
        }
    return {
        "ok": True,
        "version": VERSION,
        "config": config,
        "effective_download_dir": effective_download_dir(config),
        "ytdlp_config_exists": ytdlp_config_exists(),
        "deps": _dependencies(),
        "yt_dlp_status": yt_dlp_status,
    }


def _handle_download(message):
    mode = message.get("mode")
    if mode not in MODES:
        return {"ok": False, "error": "mode must be audio, video, or cut"}

    fallbacks = message.get("fallbacks") or []
    if not isinstance(fallbacks, list):
        return {"ok": False, "error": "fallbacks must be a list"}

    candidates = [message.get("url"), *fallbacks]
    chosen_url = next((url for url in candidates if _is_youtube_url(url)), None)
    if chosen_url is None:
        return {"ok": False, "error": "no valid YouTube URL was provided"}

    try:
        _launch_download(mode, chosen_url)
    except OSError as error:
        return {"ok": False, "error": str(error)}
    return {"ok": True, "launched": True, "mode": mode, "url": chosen_url}


def handle_message(message):
    if not isinstance(message, dict):
        return {"ok": False, "error": "message must be a JSON object"}
    action = message.get("action")
    try:
        if action in {"ping", "get_config"}:
            return _config_response()
        if action == "set_config":
            updates = message.get("config", {})
            if not isinstance(updates, dict):
                return {"ok": False, "error": "config must be a JSON object"}
            config = load_config()
            config.update(updates)
            if config.get("download_dir") == "":
                config["download_dir"] = None
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
