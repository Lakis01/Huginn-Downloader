#!/usr/bin/env python3
"""Download YouTube audio, video, or an interactively selected audio cut."""

import errno
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from collections.abc import Mapping
from typing import Any

from ytdl_config import effective_download_dir, effective_video_download_dir, load_config
from ytdl_meta import parse_info, sanitize_filename, strip_language_tags, tag_audio_file

try:
    from ytdl_version import check_ytdlp_update
except ImportError:  # pragma: no cover - helper ships alongside the wrapper

    def check_ytdlp_update(*args, **kwargs):
        return {
            "installed": None,
            "latest": None,
            "outdated": False,
            "age_days": None,
            "reason": "unknown",
            "update_hint": "yt-dlp -U",
        }


_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
_AUTH_ERROR_MARKERS = (
    "members-only",
    "members only",
    "available to members",
    "members of this channel",
    "sign in",
    "sign-in",
    "signin",
    "confirm your age",
    "age-restricted",
    "age restricted",
    "private video",
    "this video is private",
    "login required",
    "log in to",
    "authentication required",
)
_LOAD_INFO_RETRY_MARKERS = (
    "load-info-json",
    "load info json",
    "infojson",
    "info-json",
    "info json",
    "http error 403",
    "403: forbidden",
    "expired",
    "no video formats",
    "requested format is not available",
    "video unavailable",
    "missing media url",
    "missing a url",
    "no media url",
    "unable to extract",
)
_POSTPROCESSING_ERROR_MARKERS = ("postprocessing:", "ffmpeg")


class _YtDlpError(RuntimeError):
    """A user-facing yt-dlp failure without subprocess traceback details."""


def _yt_dlp_error_text(error):
    for output in (getattr(error, "stderr", None), getattr(error, "output", None)):
        if isinstance(output, bytes):
            output = output.decode(errors="replace")
        if isinstance(output, str) and output.strip():
            return output.strip()
    if isinstance(error, subprocess.CalledProcessError):
        return f"yt-dlp exited with status {error.returncode}"
    return str(error)


def _is_auth_error(error):
    if not isinstance(error, subprocess.CalledProcessError):
        return False
    message = "\n".join(
        output.decode(errors="replace") if isinstance(output, bytes) else str(output)
        for output in (getattr(error, "stderr", None), getattr(error, "output", None))
        if output
    ).lower()
    return any(marker in message for marker in _AUTH_ERROR_MARKERS)


def _is_retryable_load_info_error(error):
    if not isinstance(error, subprocess.CalledProcessError):
        return False
    message = "\n".join(
        output.decode(errors="replace") if isinstance(output, bytes) else str(output)
        for output in (getattr(error, "stderr", None), getattr(error, "output", None))
        if output
    ).casefold()
    if any(marker in message for marker in _POSTPROCESSING_ERROR_MARKERS):
        return False
    if _is_auth_error(error):
        return True
    return any(marker in message for marker in _LOAD_INFO_RETRY_MARKERS)


_YOUTUBE_HOSTS = ("youtube.com", "youtu.be", "youtube-nocookie.com")


def is_youtube_url(url: str) -> bool:
    """Check whether a URL belongs to YouTube (including subdomains)."""
    try:
        host = urllib.parse.urlsplit(url).hostname or ""
    except ValueError:
        return False
    host = host.lower().rstrip(".")
    return any(host == base or host.endswith(f".{base}") for base in _YOUTUBE_HOSTS)


def wait_for_keypress(prompt: str = "\nPress any key to close...") -> None:
    """Wait for a single keypress in raw/cbreak mode (interactive TTY only)."""
    if not sys.stdin.isatty():
        return
    sys.stdout.write(prompt)
    sys.stdout.flush()
    if os.name == "nt":
        import msvcrt

        msvcrt.getch()
        return

    import termios
    import tty

    descriptor = sys.stdin.fileno()
    attributes = termios.tcgetattr(descriptor)
    try:
        tty.setcbreak(descriptor)
        sys.stdin.read(1)
    finally:
        termios.tcsetattr(descriptor, termios.TCSADRAIN, attributes)


def _metadata_command(url, browser=None):
    command = ["yt-dlp"]
    if browser:
        command.extend(["--cookies-from-browser", browser])
    if is_youtube_url(url):
        command.extend(["--ies", "youtube,youtube:tab"])
    command.extend(["--dump-json", "--no-warnings", "--no-playlist", "--", url])
    return command


def _fetch_info_with_access(url):
    """Return raw info JSON and whether browser cookies were needed to read it."""
    command = _metadata_command(url)
    use_browser_cookies = False
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as error:
        if not _is_auth_error(error):
            raise _YtDlpError(_yt_dlp_error_text(error)) from None
        use_browser_cookies = True
        try:
            result = subprocess.run(
                _metadata_command(url, "firefox"),
                capture_output=True,
                text=True,
                check=True,
            )
        except Exception as retry_error:
            raise _YtDlpError(_yt_dlp_error_text(retry_error)) from None
    except Exception as error:
        raise _YtDlpError(_yt_dlp_error_text(error)) from None

    try:
        info = json.loads(result.stdout)
    except Exception as error:
        raise _YtDlpError(f"yt-dlp returned invalid metadata: {error}") from None
    return info, use_browser_cookies


def _parse_audio_with_access(url):
    """Return metadata and whether the browser cookies were needed to read it."""
    info, use_browser_cookies = _fetch_info_with_access(url)
    return parse_info(info), use_browser_cookies


def parse_audio(url):
    """Fetch metadata without downloading media and parse it for the prompts."""
    try:
        meta, _ = _parse_audio_with_access(url)
    except _YtDlpError as error:
        print("Failed to get info:", error)
        raise SystemExit(1) from None
    return meta


def parse_time(time_str):
    parts = time_str.strip().split(":")
    parts.reverse()
    seconds = 0
    try:
        for index, part in enumerate(parts):
            seconds += float(part) * (60 ** index)
        return seconds
    except ValueError:
        return -1


def format_time(seconds):
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def _info_sidecar_path(media_path):
    media_path = Path(media_path)
    stem_sidecar = media_path.with_suffix(".info.json")
    if stem_sidecar.is_file():
        return stem_sidecar
    return Path(f"{media_path}.info.json")


def _iter_thumbnail_references(info):
    for key in ("thumbnail_filepath", "thumbnail_path", "thumbnail"):
        value = info.get(key)
        if isinstance(value, str):
            yield value

    for thumbnail in info.get("thumbnails", []):
        if not isinstance(thumbnail, dict):
            continue
        for key in ("filepath", "filename", "_filename", "thumbnail_filepath"):
            value = thumbnail.get(key)
            if isinstance(value, str):
                yield value


def _find_thumbnail(media_path, info):
    """Find yt-dlp's image sidecar next to its post-move media filepath."""
    media_path = Path(media_path)
    parent = media_path.parent
    candidates = []

    def add_candidate(path):
        if "://" in os.fspath(path):
            return
        reference = Path(path).expanduser()
        path = reference if reference.is_absolute() else parent / reference
        try:
            resolved = path.resolve()
        except OSError:
            resolved = None
        if resolved is not None and resolved.parent == parent:
            candidates.append(resolved)
        # yt-dlp can record the pre-move directory in info JSON. Its basename
        # remains useful after the media and sidecars have moved together. Only
        # consider sidecars in the media directory, never an arbitrary path
        # from downloaded info JSON.
        candidates.append(parent / reference.name)

    for reference in _iter_thumbnail_references(info):
        add_candidate(reference)

    for key in ("_filename", "filepath"):
        value = info.get(key)
        if isinstance(value, str) and value:
            original = Path(value)
            add_candidate(original)
            for suffix in _IMAGE_SUFFIXES:
                candidates.append(parent / f"{original.stem}{suffix}")

    for stem in (media_path.stem, media_path.name):
        for suffix in _IMAGE_SUFFIXES:
            candidates.append(parent / f"{stem}{suffix}")

    seen = set()
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key in seen:
            continue
        seen.add(key)
        if candidate.suffix.lower() not in _IMAGE_SUFFIXES:
            continue
        try:
            if candidate.resolve().parent == parent and candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _final_stem(meta, suffix=""):
    title = sanitize_filename(meta.get("title") or "untitled")
    artist = str(meta.get("artist") or "").strip()
    if artist:
        stem = f"{sanitize_filename(artist)} - {title}"
    else:
        stem = title
    return sanitize_filename(stem + suffix)


def _collision_candidate(target, number):
    if number == 0:
        return target
    return target.with_name(f"{target.stem} ({number}){target.suffix}")


def _move_collision_safe(source_path, target_path):
    """Move a file without replacing an existing destination, even across mounts."""
    source_path = Path(source_path)
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    number = 0
    while True:
        candidate = _collision_candidate(target_path, number)
        try:
            os.link(source_path, candidate)
        except FileExistsError:
            number += 1
            continue
        except OSError as error:
            if error.errno not in {
                errno.EXDEV, errno.EPERM, errno.EACCES, errno.ENOTSUP,
            }:
                raise
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=".yt-dlp-routing-", dir=target_path.parent
            )
            os.close(descriptor)
            temporary_path = Path(temporary_name)
            try:
                shutil.copy2(source_path, temporary_path)
                try:
                    descriptor = os.open(
                        candidate,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                        0o600,
                    )
                except FileExistsError:
                    number += 1
                    continue
                try:
                    with os.fdopen(descriptor, "wb") as destination:
                        with temporary_path.open("rb") as source:
                            shutil.copyfileobj(source, destination)
                        destination.flush()
                        os.fsync(destination.fileno())
                    shutil.copystat(temporary_path, candidate)
                except Exception:
                    candidate.unlink(missing_ok=True)
                    raise
            finally:
                temporary_path.unlink(missing_ok=True)
        source_path.unlink()
        return candidate


def _commit_tagged_file(temp_path, original_path, target_path):
    """Install a tagged copy without clobbering an existing target."""
    if target_path == original_path:
        os.replace(temp_path, original_path)
        return original_path

    final_path = _move_collision_safe(temp_path, target_path)
    try:
        original_path.unlink()
    except OSError:
        # The tagged output is valid; don't remove it if source cleanup
        # cannot complete. The caller still gets the final output path.
        pass
    return final_path


def _read_track_gain(final_path):
    """Best-effort read-back of the applied ReplayGain value for the summary."""
    try:
        suffix = Path(final_path).suffix.lower()
        if suffix == ".opus":
            from mutagen.oggopus import OggOpus

            tags = OggOpus(final_path).tags
            values = tags.get("REPLAYGAIN_TRACK_GAIN", []) if tags is not None else []
            return values[0] if values else None
        if suffix == ".ogg":
            from mutagen.oggvorbis import OggVorbis

            tags = OggVorbis(final_path).tags
            values = tags.get("REPLAYGAIN_TRACK_GAIN", []) if tags is not None else []
            return values[0] if values else None
        if suffix == ".flac":
            from mutagen.flac import FLAC

            values = FLAC(final_path).tags.get("REPLAYGAIN_TRACK_GAIN", [])
            return values[0] if values else None
        if suffix == ".mp3":
            from mutagen.mp3 import MP3

            audio = MP3(final_path)
            if audio.tags is None:
                return None
            for frame in audio.tags.getall("TXXX:REPLAYGAIN_TRACK_GAIN"):
                if frame.text:
                    return str(frame.text[0])
            return None
        if suffix in {".m4a", ".mp4", ".m4b"}:
            from mutagen.mp4 import MP4

            values = MP4(final_path).get(
                "----:com.apple.iTunes:REPLAYGAIN_TRACK_GAIN", []
            )
            if values:
                raw = bytes(values[0])
                return raw.decode("utf-8", errors="replace")
            return None
        return None
    except Exception:
        return None


def _run_rsgain(final_path):
    """Apply ReplayGain normalization and report the resulting gain."""
    subprocess.run(["rsgain", "custom", "-s", "i", str(final_path)], check=True)
    gain = _read_track_gain(final_path)
    if gain:
        print(f"ReplayGain applied: {gain} ({final_path})")
    else:
        print(f"ReplayGain normalization complete: {final_path}")


def _long_audio_target_dir(cfg, duration_seconds) -> Path | None:
    """Return the long-audio directory when routing applies, else None."""
    try:
        enabled = bool(cfg.get("long_audio_enabled", False))
        minutes = cfg.get("long_audio_minutes", 30)
        long_dir = cfg.get("long_audio_dir", "~/Podcasts")
    except Exception:
        return None
    if not enabled:
        return None
    try:
        threshold = float(minutes) * 60.0
        duration = float(duration_seconds or 0)
    except (TypeError, ValueError):
        return None
    if duration < threshold or threshold <= 0 or not math.isfinite(duration):
        return None
    if not isinstance(long_dir, str) or not long_dir.strip():
        return None
    path = Path(os.path.expanduser(long_dir)).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


def finalize_audio_download(
    media_path, filename_suffix="", config=None, duration_seconds=None
) -> str:
    """Tag, name, and route a downloaded audio file before optional ReplayGain."""
    cfg = dict(config) if config is not None else load_config()
    auto_tag = cfg.get("auto_tag", True)
    do_rsgain = cfg.get("rsgain", False)
    embed_thumbnail = cfg.get("embed_thumbnail", True)
    thumbnail_jpg = cfg.get("thumbnail_jpg", False)
    media_path = Path(media_path).expanduser().resolve()
    if not auto_tag:
        print("Skipping automatic tag extraction (auto_tag=false).")
        strip_language_tags(str(media_path))
        info_path = _info_sidecar_path(media_path) if cfg.get("long_audio_enabled") else None
        sidecar_duration = None
        if info_path is not None:
            try:
                with info_path.open("r", encoding="utf-8") as sidecar:
                    sidecar_duration = json.load(sidecar).get("duration")
            except (OSError, json.JSONDecodeError, AttributeError):
                pass
        duration = duration_seconds if duration_seconds is not None else sidecar_duration
        long_dir = _long_audio_target_dir(cfg, duration)
        final_path = media_path
        if long_dir is not None and media_path.parent.resolve() != long_dir.resolve():
            final_path = _move_collision_safe(media_path, long_dir / media_path.name)
        if info_path is not None:
            info_path.unlink(missing_ok=True)
        if do_rsgain:
            print("ReplayGain normalization (rsgain: analyzing -> applying)...")
            _run_rsgain(str(final_path))
        return str(final_path)
    info_path = _info_sidecar_path(media_path)
    try:
        with info_path.open("r", encoding="utf-8") as sidecar:
            info = json.load(sidecar)
    except OSError as error:
        reason = error.strerror or str(error)
        raise _YtDlpError(
            f"Unable to read yt-dlp info sidecar '{info_path}': {reason}"
        ) from None
    meta = parse_info(info)
    duration = duration_seconds if duration_seconds is not None else meta.get("duration", 0)
    if meta["is_tagged"]:
        print("\n\033[1;32mDetected High-Quality Auto-Generated Audio track.\033[0m")
        print(
            f"  Title:    {meta['title']}\n  Artist:   {meta['artist']}"
            f"\n  Album:    {meta['album']}\n  Date:     {meta['date']}\n"
        )
    else:
        print("\n\033[1;34mStandard track detected.\033[0m\n")
    thumbnail_path = _find_thumbnail(media_path, info) if embed_thumbnail else None

    target_path = media_path.with_name(
        f"{_final_stem(meta, filename_suffix)}{media_path.suffix}"
    )
    long_dir = _long_audio_target_dir(cfg, duration)
    if long_dir is not None and media_path.parent.resolve() != long_dir.resolve():
        target_path = long_dir / target_path.name
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".yt-dlp-tagging-", suffix=media_path.suffix, dir=media_path.parent
    )
    os.close(descriptor)
    temp_path = Path(temporary_name)

    try:
        shutil.copy2(media_path, temp_path)
        print("[2/2] Automatic tag extraction & cover art...")
        # thumbnail_jpg=True forces JPEG across all containers for legacy players;
        # otherwise tag_audio_file picks WebP for Opus/Ogg/MP3/FLAC and JPEG for M4A.
        prefer_webp = False if thumbnail_jpg else None
        tag_audio_file(
            str(temp_path), meta, str(thumbnail_path) if thumbnail_path else None,
            prefer_webp=prefer_webp,
        )
        final_path = _commit_tagged_file(temp_path, media_path, target_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    info_path.unlink(missing_ok=True)
    if thumbnail_path:
        thumbnail_path.unlink(missing_ok=True)
    if do_rsgain:
        print("ReplayGain normalization (rsgain: analyzing -> applying)...")
        _run_rsgain(str(final_path))
    return str(final_path)


def _audio_output_template(meta, suffix=""):
    return f"{_final_stem(meta, suffix)}.%(ext)s"


def _move_audio_sidecar(source_path, target_path):
    """Move yt-dlp's info JSON when a post-download encode changes the suffix."""
    source_path = Path(source_path)
    target_path = Path(target_path)
    source_info = _info_sidecar_path(source_path)
    if not source_info.is_file():
        return
    target_info = target_path.with_suffix(".info.json")
    if source_info.resolve() == target_info.resolve():
        return
    if target_info.exists():
        raise _YtDlpError(
            f"Unable to preserve yt-dlp metadata: sidecar already exists at '{target_info}'"
        )
    os.replace(source_info, target_info)


def _ensure_audio_properties(
    media_path,
    config,
    *,
    requested_bitrate=None,
    application="audio",
    force_opus_cut=False,
):
    """Enforce final audio channels/codec after yt-dlp's possible stream-copy."""
    media_path = Path(media_path).expanduser()
    cfg = dict(config) if config is not None else load_config()
    try:
        probe_result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_streams", "-show_format",
                "-of", "json", str(media_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        probe = json.loads(probe_result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        detail = _yt_dlp_error_text(error)
        raise _YtDlpError(f"Unable to inspect completed audio '{media_path}': {detail}") from None

    container_info = probe.get("format", {})
    container_name = container_info.get("format_name") or media_path.suffix.lstrip(".")
    streams = probe.get("streams", [])
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if not audio_streams:
        raise _YtDlpError(
            f"No audio stream found in completed media '{media_path}' ({container_name})"
        )

    audio_format = cfg.get("audio_format", "best")
    channel_mode = cfg.get("channel_mode")
    if channel_mode not in {"stereo", "ask", "mono"}:
        channel_mode = "mono" if cfg.get("mono_audio") is True else "stereo"
    mono = channel_mode == "mono"
    if not mono and not force_opus_cut:
        return media_path

    if force_opus_cut or audio_format in {"best", "opus"}:
        output_suffix = ".opus"
        encoder = "libopus"
        target_codec = "opus"
    elif audio_format == "mp3":
        output_suffix = ".mp3"
        encoder = "libmp3lame"
        target_codec = "mp3"
    elif audio_format == "m4a":
        output_suffix = ".m4a"
        encoder = "aac"
        target_codec = "aac"
    elif audio_format == "ogg":
        output_suffix = ".ogg"
        encoder = "libvorbis"
        target_codec = "vorbis"
    elif audio_format == "flac":
        output_suffix = ".flac"
        encoder = "flac"
        target_codec = "flac"
    else:
        return media_path

    desired_channels = 1 if mono else 2
    source_codec = audio_streams[0].get("codec_name")
    needs_encode = force_opus_cut or any(
        stream.get("channels") != desired_channels for stream in audio_streams
    ) or source_codec != target_codec
    target_path = media_path.with_suffix(output_suffix)
    needs_remux = target_path.suffix.lower() != media_path.suffix.lower()
    if not needs_encode and not needs_remux:
        return media_path

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".yt-dlp-audio-", suffix=output_suffix, dir=media_path.parent
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    temporary_path.unlink(missing_ok=True)
    preserved_streams = [
        stream for stream in streams
        if stream.get("codec_type") == "audio"
        or (
            stream.get("codec_type") == "video"
            and stream.get("disposition", {}).get("attached_pic") == 1
        )
    ]
    command = ["ffmpeg", "-y", "-v", "error", "-i", str(media_path)]
    for stream in preserved_streams:
        stream_index = stream.get("index")
        if stream_index is not None:
            command.extend(["-map", f"0:{stream_index}"])
    command.extend(["-map_metadata", "0", "-c", "copy"])
    if needs_encode:
        command.extend(["-c:a", encoder])
        if encoder == "libopus":
            default_bitrate = 128 if force_opus_cut and desired_channels == 2 else (
                75 if force_opus_cut else 96
            )
            bitrate = str(requested_bitrate or default_bitrate).strip().lower()
            if bitrate.endswith("k"):
                bitrate = bitrate[:-1]
            if not bitrate.isdecimal() or int(bitrate) <= 0:
                raise _YtDlpError("Opus bitrate must be a positive integer in kbps")
            command.extend(["-b:a", f"{bitrate}k"])
            if force_opus_cut:
                command.extend([
                    "-vbr", "on", "-ac", str(desired_channels),
                    "-application", application if application in {"audio", "voip"} else "audio",
                ])
        elif encoder == "libmp3lame":
            quality = cfg.get("mp3_quality", "V0")
            if quality == "128k":
                quality = "V5"
            if quality == "320k":
                command.extend(["-b:a", "192K" if mono else "320K"])
            else:
                command.extend(["-q:a", {"V0": "0", "V2": "2", "V5": "5"}.get(quality, "0")])
        elif encoder == "libvorbis":
            command.extend(["-q:a", "0"])
        elif encoder == "aac":
            # Match yt-dlp's default AAC quality (preferredquality=5).
            command.extend(["-q:a", "2.05"])
        if mono:
            command.extend(["-ac", "1"])
    command.append(str(temporary_path))

    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
        if not temporary_path.is_file() or temporary_path.stat().st_size == 0:
            raise _YtDlpError(f"FFmpeg produced no output while converting '{media_path}'")
        if target_path == media_path:
            os.replace(temporary_path, media_path)
            return media_path
        final_path = _move_collision_safe(temporary_path, target_path)
        media_path.unlink()
        return final_path
    except subprocess.CalledProcessError as error:
        detail = _yt_dlp_error_text(error)
        raise _YtDlpError(
            "FFmpeg could not preserve the audio stream(s), metadata, and attached artwork "
            f"while converting '{media_path}' ({container_name}, {source_codec}): {detail}"
        ) from None
    finally:
        temporary_path.unlink(missing_ok=True)


def _audio_format_args(config: Mapping[str, Any] | None = None) -> list[str]:
    cfg = dict(config) if config is not None else load_config()
    audio_format = cfg.get("audio_format", "best")
    mp3_quality = cfg.get("mp3_quality", "V0")
    if mp3_quality == "128k":
        mp3_quality = "V5"
    channel_mode = cfg.get("channel_mode")
    if channel_mode not in {"stereo", "ask", "mono"}:
        channel_mode = "mono" if cfg.get("mono_audio") is True else "stereo"
    mono = channel_mode == "mono"
    if audio_format == "opus":
        args = [
            "-f", "bestaudio[acodec=opus]/bestaudio/best", "-x", "--audio-format", "opus",
            "--audio-quality", "96K" if mono else "128K",
        ]
        if mono:
            args += ["--postprocessor-args", "ExtractAudio:-ac 1"]
        return args
    if audio_format == "mp3":
        quality = {
            "V0": "0",
            "320k": "192K" if mono else "320K",
            "V2": "2",
            "V5": "5",
        }.get(mp3_quality, "0")
        args = [
            "-f", "bestaudio/best", "-x", "--audio-format", "mp3",
            "--audio-quality", quality,
        ]
        if mono:
            args += ["--postprocessor-args", "ExtractAudio:-ac 1"]
        return args
    if audio_format == "m4a":
        args = [
            "-f", "bestaudio[ext=m4a]/bestaudio/best", "-x",
            "--audio-format", "m4a",
        ]
        if mono:
            args += ["--postprocessor-args", "ExtractAudio:-ac 1"]
        return args
    if audio_format == "ogg":
        args = [
            "-f", "bestaudio/best", "-x", "--audio-format", "vorbis",
            "--audio-quality", "0",
        ]
        if mono:
            args += ["--postprocessor-args", "ExtractAudio:-ac 1"]
        return args
    if audio_format == "flac":
        args = ["-f", "bestaudio/best", "-x", "--audio-format", "flac"]
        if mono:
            args += ["--postprocessor-args", "ExtractAudio:-ac 1"]
        return args
    if mono:
        return [
            "-f", "bestaudio/best", "-x", "--audio-format", "opus",
            "--audio-quality", "96K",
            "--postprocessor-args", "ExtractAudio:-ac 1",
        ]
    return ["-f", "bestaudio/best", "-x", "--audio-format", "best"]


def _choose_channel_mode(config: Mapping[str, Any] | None = None) -> str:
    """Resolve ask once; non-interactive invocations remain non-blocking."""
    cfg = dict(config) if config is not None else load_config()
    mode = cfg.get("channel_mode")
    if mode not in {"stereo", "ask", "mono"}:
        mode = "mono" if cfg.get("mono_audio") is True else "stereo"
    if mode != "ask":
        return mode
    if not sys.stdin.isatty():
        return "stereo"
    answer = input("Audio channels: (s)tereo or (m)ono [s]: ").strip().casefold()
    return "mono" if answer in {"m", "mono", "1"} else "stereo"


def _run_with_auth_retry(command):
    """Run yt-dlp with TTY progress, retrying once with Firefox cookies on auth errors."""
    try:
        subprocess.run(command, check=True, text=True, stdout=None, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        print(_yt_dlp_error_text(error), file=sys.stderr)
        if _is_auth_error(error) and "--cookies-from-browser" not in command:
            retry = [*command[:1], "--cookies-from-browser", "firefox", *command[1:]]
            try:
                subprocess.run(
                    retry, check=True, text=True, stdout=None, stderr=subprocess.PIPE
                )
            except subprocess.CalledProcessError as retry_error:
                print(_yt_dlp_error_text(retry_error), file=sys.stderr)
                raise _YtDlpError(_yt_dlp_error_text(retry_error)) from None
        else:
            raise _YtDlpError(_yt_dlp_error_text(error)) from None


def _read_print_to_file(print_path):
    """Return the post-move media filepath yt-dlp reported via --print-to-file."""
    try:
        with open(print_path, encoding="utf-8") as handle:
            lines = [line.strip() for line in handle if line.strip()]
    except OSError:
        lines = []
    if not lines:
        raise _YtDlpError("yt-dlp did not report the post-move media filepath")
    return lines[-1]


def _read_duration_print_to_file(print_path):
    """Return yt-dlp's post-move duration, or None when it was unavailable."""
    try:
        with open(print_path, encoding="utf-8") as handle:
            lines = [line.strip() for line in handle if line.strip()]
        duration = float(lines[-1]) if lines else None
    except (OSError, ValueError):
        return None
    return duration if duration is not None and 0 < duration < float("inf") else None


def _new_print_to_file():
    """Create a temp file for yt-dlp --print-to-file reporting."""
    handle = tempfile.NamedTemporaryFile(
        mode="w", prefix="yt-dlp-filepath-", suffix=".txt", delete=False
    )
    print_path = handle.name
    handle.close()
    return print_path


def _remove_temp_file(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def download_audio(url, config=None):
    cfg = dict(config) if config is not None else load_config()
    cfg["channel_mode"] = _choose_channel_mode(cfg)
    cfg.pop("mono_audio", None)
    auto_tag = cfg.get("auto_tag", True)
    embed_thumbnail = cfg.get("embed_thumbnail", True)
    thumbnail_jpg = cfg.get("thumbnail_jpg", False)
    effective_dir = effective_download_dir(cfg)
    print(f"[1/2] Downloading audio from {url}...")
    print_path = _new_print_to_file()
    duration_path = _new_print_to_file()
    try:
        extras = []
        if is_youtube_url(url):
            extras.extend(["--ies", "youtube,youtube:tab"])
        if effective_dir is not None:
            extras.extend(["-P", effective_dir])
        if auto_tag or cfg.get("long_audio_enabled", False):
            extras.append("--write-info-json")
        if auto_tag:
            if embed_thumbnail:
                extras.append("--write-thumbnail")
                if thumbnail_jpg:
                    extras.extend(["--convert-thumbnails", "jpg"])
        else:
            extras.extend([
                "--embed-metadata",
            ])
            if embed_thumbnail:
                extras.append("--embed-thumbnail")
                if thumbnail_jpg:
                    extras.extend(["--convert-thumbnails", "jpg"])
        command = [
            "yt-dlp",
            *extras,
            *_audio_format_args(cfg),
            "--quiet",
            "--no-playlist",
            "--progress",
            "-o", "%(title)s.%(ext)s",
            "--print-to-file", "after_move:filepath", print_path,
            "--print-to-file", "after_move:duration", duration_path,
            "--", url,
        ]
        _run_with_auth_retry(command)
        filepath = _read_print_to_file(print_path)
        original_filepath = filepath
        filepath = _ensure_audio_properties(filepath, cfg)
        if Path(filepath) != Path(original_filepath):
            _move_audio_sidecar(original_filepath, filepath)
        duration = _read_duration_print_to_file(duration_path)
        return finalize_audio_download(filepath, "", cfg, duration)
    finally:
        _remove_temp_file(print_path)
        _remove_temp_file(duration_path)


def download_video(url, config=None):
    cfg = dict(config) if config is not None else load_config()
    effective_dir = effective_video_download_dir(cfg)
    print("[1/2] Downloading video & audio streams...")
    extras = []
    if is_youtube_url(url):
        extras.extend(["--ies", "youtube,youtube:tab"])
    if effective_dir is not None:
        extras.extend(["-P", effective_dir])
    command = [
        "yt-dlp",
        *extras,
        "-f", "bestvideo+bestaudio/best",
        "--merge-output-format", "mkv",
        "--embed-thumbnail",
        "--convert-thumbnails", "webp",
        "--embed-metadata",
        "--quiet",
        "--progress",
        "--print",
        "post_process:[Stage] Merging video + audio into MKV & embedding thumbnail/metadata...",
        "-o", "%(title)s.%(ext)s",
        "--", url,
    ]
    _run_with_auth_retry(command)
    print("[2/2] Video download complete.")


def interactive_cut(url, config=None):
    cfg = dict(config) if config is not None else load_config()
    auto_tag = cfg.get("auto_tag", True)
    print(f"Fetching metadata for {url}...")
    info, use_browser_cookies = _fetch_info_with_access(url)
    meta = parse_info(info)
    cfg["channel_mode"] = _choose_channel_mode(cfg)
    cfg.pop("mono_audio", None)
    duration = meta.get("duration", 0)

    if duration == 0:
        print("\nWarning: Could not detect video duration. Bounds checking disabled.")
        duration = float("inf")
        max_time_str = "unknown"
    else:
        max_time_str = format_time(duration)
        print(f"\nVideo detected. Total duration: {max_time_str}")

    while True:
        start_in = input(f"Start time (e.g., 0:30, max {max_time_str}): ")
        start_sec = parse_time(start_in)
        if 0 <= start_sec < duration:
            break
        print(
            "\033[1;31mError:\033[0m Invalid start time. Must be a valid "
            "timestamp within the video.\n"
        )

    while True:
        end_in = input("End time (e.g., 1:45): ")
        end_sec = parse_time(end_in)
        if start_sec < end_sec <= duration:
            break
        print(
            "\033[1;31mError:\033[0m Invalid end time. Must be greater "
            "than start time and within video bounds.\n"
        )

    print("\n--- Encoding Settings ---")
    channels = "1" if cfg["channel_mode"] == "mono" else "2"
    cut_config = dict(cfg)
    audio_format = cfg.get("audio_format", "best")
    force_opus_cut = audio_format in {"best", "opus"}
    if audio_format in {"best", "opus"}:
        default_bitrate = "75" if channels == "1" else "128"
        bitrate = input(
            f"Bitrate in kbps (VBR is forced on) [Default: {default_bitrate}]: "
        ).strip() or default_bitrate
        app_in = input("Application flag (voip or audio) [Default: audio]: ").strip().lower() or "audio"
        app_type = "voip" if app_in in ["voip", "v"] else "audio"
        ffmpeg_args = [
            "-b:a", f"{bitrate}k", "-vbr", "on", "-ac", channels,
            "-application", app_type,
        ]
        ffmpeg_options = " ".join(ffmpeg_args)
        format_args = ["-f", "bestaudio[acodec=opus]/bestaudio/best"]
        postprocessor_args = None
        print(f"Applying FFmpeg overrides: {ffmpeg_options}")
    else:
        format_args = _audio_format_args(cut_config)
        postprocessor_args = None
        ffmpeg_options = "configured format settings"
    print(f"\nProceeding with cut: {format_time(start_sec)} to {format_time(end_sec)}")
    if not force_opus_cut and postprocessor_args is None:
        print(f"Applying FFmpeg overrides: {ffmpeg_options}\n")
    else:
        print()

    filename_suffix = f"_cut_{int(start_sec)}_{int(end_sec)}"
    info_handle = tempfile.NamedTemporaryFile(
        mode="w", prefix="yt-dlp-info-", suffix=".info.json",
        delete=False, encoding="utf-8",
    )
    temp_info_path = info_handle.name
    try:
        json.dump(info, info_handle)
        info_handle.close()
        print_path = _new_print_to_file()
        try:
            extras = []
            if use_browser_cookies:
                extras.extend(["--cookies-from-browser", "firefox"])
            if is_youtube_url(url):
                extras.extend(["--ies", "youtube,youtube:tab"])
            effective_dir = effective_download_dir(cfg)
            if effective_dir is not None:
                extras.extend(["-P", effective_dir])
            embed_thumbnail = cfg.get("embed_thumbnail", True)
            thumbnail_jpg = cfg.get("thumbnail_jpg", False)
            if auto_tag or cfg.get("long_audio_enabled", False):
                extras.append("--write-info-json")
            if auto_tag:
                if embed_thumbnail:
                    extras.append("--write-thumbnail")
                    if thumbnail_jpg:
                        extras.extend(["--convert-thumbnails", "jpg"])
            else:
                extras.extend([
                    "--embed-metadata",
                ])
                if embed_thumbnail:
                    extras.append("--embed-thumbnail")
                    if thumbnail_jpg:
                        extras.extend(["--convert-thumbnails", "jpg"])
            output_template = _audio_output_template(meta, filename_suffix)
            section_args = ["--download-sections", f"*{start_sec}-{end_sec}"]
            if not force_opus_cut:
                section_args.append("--force-keyframes-at-cuts")
            rest = [
                *extras,
                *section_args,
                *format_args,
                "--quiet",
                "--no-playlist",
                "--progress",
                "-o", output_template,
                "--print-to-file", "after_move:filepath", print_path,
            ]
            if postprocessor_args is not None:
                rest.extend(["--postprocessor-args", postprocessor_args])
            print("[1/2] Downloading cut...")
            try:
                subprocess.run(
                    ["yt-dlp", "--load-info-json", temp_info_path, *rest],
                    check=True, text=True, stdout=None, stderr=subprocess.PIPE,
                )
            except subprocess.CalledProcessError as error:
                if not _is_retryable_load_info_error(error):
                    raise _YtDlpError(_yt_dlp_error_text(error)) from None
                _run_with_auth_retry(["yt-dlp", *rest, "--", url])
            filepath = _read_print_to_file(print_path)
            original_filepath = filepath
            if force_opus_cut:
                filepath = _ensure_audio_properties(
                    filepath,
                    cfg,
                    requested_bitrate=bitrate,
                    application=app_type,
                    force_opus_cut=True,
                )
            else:
                filepath = _ensure_audio_properties(filepath, cfg)
            if Path(filepath) != Path(original_filepath):
                _move_audio_sidecar(original_filepath, filepath)
            return finalize_audio_download(
                filepath, filename_suffix, cfg, end_sec - start_sec
            )
        finally:
            _remove_temp_file(print_path)
    finally:
        _remove_temp_file(temp_info_path)


def _print_update_hint(status):
    """Print an actionable out-of-date notice to stderr."""
    installed = status.get("installed") or "unknown"
    latest = status.get("latest")
    age_days = status.get("age_days")
    hint = status.get("update_hint") or "yt-dlp -U"
    if latest:
        print(
            f"Your yt-dlp is out of date (installed {installed}, "
            f"latest {latest}). Update with: {hint}",
            file=sys.stderr,
        )
    elif isinstance(age_days, int):
        print(
            f"Your yt-dlp is out of date (installed {installed}, "
            f"{age_days} days old). Update with: {hint}",
            file=sys.stderr,
        )
    else:
        print(
            f"Your yt-dlp may be out of date (installed {installed}). "
            f"Update with: {hint}",
            file=sys.stderr,
        )


def _print_update_notice(status):
    """Print a concise one-line out-of-date notice to stderr."""
    installed = status.get("installed") or "unknown"
    latest = status.get("latest")
    age_days = status.get("age_days")
    hint = status.get("update_hint") or "yt-dlp -U"
    if latest:
        print(
            f"Note: yt-dlp {installed} is outdated "
            f"(latest {latest}); update with: {hint}",
            file=sys.stderr,
        )
    elif isinstance(age_days, int):
        print(
            f"Note: yt-dlp {installed} is outdated "
            f"({age_days} days old); update with: {hint}",
            file=sys.stderr,
        )
    else:
        print(
            f"Note: yt-dlp {installed} may be outdated; update with: {hint}",
            file=sys.stderr,
        )


def main(argv=None):
    argv = sys.argv if argv is None else argv
    args = list(argv[1:])
    wait_keypress = False
    if args and args[0] == "--wait-keypress":
        wait_keypress = True
        args = args[1:]
    if os.environ.get("YTDL_WAIT_KEYPRESS") == "1":
        wait_keypress = True
    try:
        if len(args) < 2:
            print("Usage: yt-dlp-wrapper.py [--wait-keypress] [audio|video|cut] <url>")
            return 1

        mode, url = args[0], args[1]
        try:
            if mode == "audio":
                download_audio(url)
            elif mode == "video":
                download_video(url)
            elif mode == "cut":
                interactive_cut(url)
            else:
                print("Unknown mode.")
                return 1
        except _YtDlpError as error:
            print(f"yt-dlp failed: {error}", file=sys.stderr)
            try:
                status = check_ytdlp_update(allow_network=True)
            except Exception:
                status = None
            if status and status.get("outdated"):
                _print_update_hint(status)
            return 1
        try:
            status = check_ytdlp_update(allow_network=True)
        except Exception:
            status = None
        if status and status.get("outdated"):
            _print_update_notice(status)
        return 0
    finally:
        if wait_keypress and sys.stdin.isatty():
            wait_for_keypress()


if __name__ == "__main__":
    raise SystemExit(main())
