#!/usr/bin/env python3
"""Download YouTube audio, video, or an interactively selected audio cut."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from ytdl_meta import parse_info, sanitize_filename, tag_audio_file


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


def _metadata_command(url, browser=None):
    command = ["yt-dlp"]
    if browser:
        command.extend(["--cookies-from-browser", browser])
    command.extend(["--dump-json", "--no-warnings", "--no-playlist", url])
    return command


def _parse_audio_with_access(url):
    """Return metadata and whether the browser cookies were needed to read it."""
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


def _commit_tagged_file(temp_path, original_path, target_path):
    """Install a tagged copy without clobbering an existing target."""
    if target_path == original_path:
        os.replace(temp_path, original_path)
        return original_path

    number = 0
    while True:
        candidate = _collision_candidate(target_path, number)
        try:
            # The temp file is in the same directory, so linking is atomic and
            # fails rather than replacing a file created by another process.
            os.link(temp_path, candidate)
        except FileExistsError:
            number += 1
            continue
        os.unlink(temp_path)
        try:
            original_path.unlink()
        except OSError:
            # The tagged output is valid; don't remove it if source cleanup
            # cannot complete. The caller still gets the final output path.
            pass
        return candidate


def finalize_audio_download(media_path, filename_suffix=""):
    """Tag an audio download transactionally, rename it, clean sidecars, gain."""
    media_path = Path(media_path).expanduser().resolve()
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
    thumbnail_path = _find_thumbnail(media_path, info)

    target_path = media_path.with_name(
        f"{_final_stem(meta, filename_suffix)}{media_path.suffix}"
    )
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".yt-dlp-tagging-", suffix=media_path.suffix, dir=media_path.parent
    )
    os.close(descriptor)
    temp_path = Path(temporary_name)

    try:
        shutil.copy2(media_path, temp_path)
        tag_audio_file(
            str(temp_path), meta, str(thumbnail_path) if thumbnail_path else None
        )
        final_path = _commit_tagged_file(temp_path, media_path, target_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    info_path.unlink(missing_ok=True)
    if thumbnail_path:
        thumbnail_path.unlink(missing_ok=True)
    subprocess.run(
        ["rsgain", "custom", "-s", "i", str(final_path)], check=True
    )
    return str(final_path)


def _audio_output_template(meta, suffix=""):
    return f"{_final_stem(meta, suffix)}.%(ext)s"


def _download_audio_and_finalize(command, filename_suffix=""):
    try:
        result = subprocess.run(
            command,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as error:
        raise _YtDlpError(_yt_dlp_error_text(error)) from None
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        raise _YtDlpError("yt-dlp did not report the post-move media filepath")
    return finalize_audio_download(lines[-1], filename_suffix)


def download_audio(url):
    print(f"Analyzing {url}...")
    meta, use_browser_cookies = _parse_audio_with_access(url)

    if meta["is_tagged"]:
        print("\n\033[1;32mDetected High-Quality Auto-Generated Audio track.\033[0m")
        print(
            f"  Title:    {meta['title']}\n  Artist:   {meta['artist']}"
            f"\n  Album:    {meta['album']}\n  Date:     {meta['date']}\n"
        )
    else:
        print("\n\033[1;34mStandard track detected. Downloading normally.\033[0m\n")

    # Leave yt-dlp config discovery and configured output paths enabled; the
    # user's installed config directs downloads to ~/Downloads.
    command = [
        "yt-dlp",
        "-f", "bestaudio",
        "-x", "--audio-format", "best",
        "--no-warnings",
        "--no-playlist",
        "--write-info-json",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "-o", _audio_output_template(meta),
        "--print", "after_move:filepath",
        url,
    ]
    if use_browser_cookies:
        command[1:1] = ["--cookies-from-browser", "firefox"]
    _download_audio_and_finalize(command)


def download_video(url):
    print(f"Downloading video: {url}")
    command = [
        "yt-dlp",
        "-f", "bestvideo+bestaudio/best",
        "--merge-output-format", "mkv",
        "--embed-thumbnail",
        "--convert-thumbnails", "webp",
        "--embed-metadata",
        "--no-warnings",
        "-o", "%(title)s.%(ext)s",
        url,
    ]
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        raise _YtDlpError(_yt_dlp_error_text(error)) from None


def interactive_cut(url):
    print(f"Fetching metadata for {url}...")
    meta, use_browser_cookies = _parse_audio_with_access(url)
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
    bitrate = input("Bitrate in kbps (VBR is forced on) [Default: 117]: ").strip() or "117"
    channels_in = input("Number of channels (1 or 2) [Default: 2]: ").strip() or "2"
    channels = "1" if channels_in == "1" else "2"
    app_in = input("Application flag (voip or audio) [Default: audio]: ").strip().lower() or "audio"
    app_type = "voip" if app_in in ["voip", "v"] else "audio"

    ffmpeg_args = [
        "-b:a", f"{bitrate}k",
        "-vbr", "on",
        "-ac", channels,
        "-application", app_type,
    ]
    ffmpeg_options = " ".join(ffmpeg_args)
    print(f"\nProceeding with cut: {format_time(start_sec)} to {format_time(end_sec)}")
    print(f"Applying FFmpeg overrides: {ffmpeg_options}\n")

    command = [
        "yt-dlp",
        "--download-sections", f"*{start_sec}-{end_sec}",
        "--force-keyframes-at-cuts",
        "-f", "bestaudio",
        "-x", "--audio-format", "opus",
        "--no-warnings",
        "--no-playlist",
        "--write-info-json",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--postprocessor-args", f"ExtractAudio:{ffmpeg_options}",
        "-o", _audio_output_template(
            meta, f"_cut_{int(start_sec)}_{int(end_sec)}"
        ),
        "--print", "after_move:filepath",
        url,
    ]
    if use_browser_cookies:
        command[1:1] = ["--cookies-from-browser", "firefox"]
    _download_audio_and_finalize(command, f"_cut_{int(start_sec)}_{int(end_sec)}")


def main(argv=None):
    argv = sys.argv if argv is None else argv
    if len(argv) < 3:
        print("Usage: yt-dlp-wrapper.py [audio|video|cut] <url>")
        return 1

    mode, url = argv[1], argv[2]
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
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
