import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
HOST_PATH = ROOT / "bin" / "yt-dlp-native-host.py"
sys.path.insert(0, str(ROOT / "bin"))

if HOST_PATH.is_file():
    spec = importlib.util.spec_from_file_location("yt_dlp_native_host", HOST_PATH)
    HOST = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(HOST)
else:
    HOST = None


def frame(message):
    payload = json.dumps(message).encode("utf-8")
    return struct.pack("=I", len(payload)) + payload


def run_host(messages, trailing=b""):
    incoming = io.BytesIO(b"".join(frame(message) for message in messages) + trailing)
    outgoing = io.BytesIO()
    fake_stdin = mock.Mock(buffer=incoming)
    fake_stdout = mock.Mock(buffer=outgoing)
    with mock.patch.object(HOST.sys, "stdin", fake_stdin), mock.patch.object(
        HOST.sys, "stdout", fake_stdout
    ):
        HOST.main()
    result = io.BytesIO(outgoing.getvalue())
    responses = []
    while True:
        header = result.read(4)
        if not header:
            break
        if len(header) != 4:
            raise AssertionError("host wrote a truncated response header")
        size = struct.unpack("=I", header)[0]
        payload = result.read(size)
        if len(payload) != size:
            raise AssertionError("host wrote a truncated response body")
        responses.append(json.loads(payload.decode("utf-8")))
    return responses


@unittest.skipUnless(HOST is not None, "native messaging host has not been implemented")
class NativeHostTests(unittest.TestCase):
    def test_version_is_current_and_youtube_only_gate_is_removed(self):
        self.assertEqual(HOST.VERSION, "2.5.6")
        self.assertFalse(hasattr(HOST, "_is_youtube_url"))
        self.assertFalse(hasattr(HOST, "YOUTUBE_HOSTS"))

    def test_ping_and_get_config_use_native_message_framing(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {
                "HOME": tmp,
                "XDG_CONFIG_HOME": str(Path(tmp) / ".config"),
                "XDG_MUSIC_DIR": "",
                "XDG_VIDEOS_DIR": "",
                "XDG_DOWNLOAD_DIR": "",
            },
            clear=False,
        ), mock.patch.object(
            HOST.shutil,
            "which",
            side_effect=lambda name: "/usr/bin/" + name
            if name in {"yt-dlp", "ffmpeg", "rsgain"}
            else None,
        ):
            responses = run_host([{"action": "ping"}, {"action": "get_config"}])

        self.assertEqual(len(responses), 2)
        for response in responses:
            self.assertTrue(response["ok"])
            self.assertEqual(response["version"], "2.5.6")
            self.assertEqual(
                response["config"],
                {
                    "download_dir": None,
                    "video_download_dir": "~/Videos/Youtube Downloads",
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
                },
            )
            self.assertEqual(response["effective_download_dir"], str(Path(tmp) / "Music/Youtube Downloads"))
            self.assertEqual(
                response["effective_video_download_dir"],
                str(Path(tmp) / "Videos/Youtube Downloads"),
            )
            self.assertFalse(response["ytdlp_config_exists"])
            self.assertEqual(response["deps"], {"yt_dlp": True, "ffmpeg": True, "rsgain": True})

    def test_set_config_merges_partial_updates_and_persists_empty_dir_as_none(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {
                "HOME": tmp,
                "XDG_CONFIG_HOME": str(Path(tmp) / ".config"),
                "XDG_MUSIC_DIR": "",
                "XDG_VIDEOS_DIR": "",
                "XDG_DOWNLOAD_DIR": "",
            },
            clear=False,
        ):
            responses = run_host(
                [
                    {
                        "action": "set_config",
                        "config": {
                            "auto_tag": False,
                            "download_dir": "",
                            "verbose_output": True,
                        },
                    }
                ]
            )
            persisted = HOST.load_config()

        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0]["ok"])
        self.assertEqual(
            responses[0]["config"],
            {
                "download_dir": None,
                "video_download_dir": "~/Videos/Youtube Downloads",
                "verbose_output": True,
                "auto_tag": False,
                "rsgain": False,
                "audio_format": "best",
                "mp3_quality": "V0",
                "embed_thumbnail": True,
                "thumbnail_jpg": False,
                "channel_mode": "stereo",
                "long_audio_enabled": False,
                "long_audio_minutes": 30,
                "long_audio_dir": "~/Podcasts",
            },
        )
        self.assertEqual(persisted, responses[0]["config"])

    def test_download_selects_first_valid_youtube_fallback_and_spawns_detached(self):
        request = {
            "action": "download",
            "mode": "cut",
            "url": "file:///etc/passwd",
            "fallbacks": [
                "https://soundcloud.com/example/track",
                "https://m.youtube.com/watch?v=yes",
            ],
        }
        with mock.patch.dict(os.environ, {"YTDL_SHORTCUT": "/tmp/fake-shortcut"}), mock.patch.object(
            HOST.subprocess, "Popen"
        ) as popen:
            responses = run_host([request])

        self.assertEqual(
            responses,
            [
                {
                    "ok": True,
                    "launched": True,
                    "mode": "cut",
                    "url": "https://soundcloud.com/example/track",
                }
            ],
        )
        popen.assert_called_once_with(
            ["/tmp/fake-shortcut", "cut", "https://soundcloud.com/example/track"],
            start_new_session=True,
            stdin=HOST.subprocess.DEVNULL,
            stdout=HOST.subprocess.DEVNULL,
            stderr=HOST.subprocess.DEVNULL,
        )

    def test_download_forwards_playlist_and_items_and_rejects_invalid_specs(self):
        with mock.patch.dict(os.environ, {"YTDL_SHORTCUT": "/tmp/fake-shortcut"}), mock.patch.object(
            HOST.subprocess, "Popen"
        ) as popen:
            responses = run_host(
                [
                    {
                        "action": "download",
                        "mode": "audio",
                        "url": "https://www.youtube.com/watch?v=1&list=PL123",
                        "playlist": True,
                        "playlist_items": "1-5, 8",
                    },
                    {
                        "action": "download",
                        "mode": "video",
                        "url": "https://www.youtube.com/watch?v=1&list=PL123",
                        "playlist": False,
                    },
                    {
                        "action": "download",
                        "mode": "audio",
                        "url": "https://www.youtube.com/watch?v=1&list=PL123",
                        "playlist": True,
                        "playlist_items": "1; rm -rf /",
                    },
                    {
                        "action": "download",
                        "mode": "audio",
                        "url": "https://www.youtube.com/watch?v=1&list=PL123",
                        "playlist": True,
                        "playlist_items": "--exec",
                    },
                ]
            )

        self.assertEqual(len(responses), 4)
        self.assertTrue(responses[0]["ok"])
        self.assertEqual(responses[0]["playlist"], True)
        self.assertEqual(responses[0]["playlist_items"], "1-5,8")
        self.assertTrue(responses[1]["ok"])
        self.assertEqual(responses[1]["playlist"], False)
        self.assertFalse(responses[2]["ok"])
        self.assertFalse(responses[3]["ok"])
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(
            popen.call_args_list[0].args[0],
            [
                "/tmp/fake-shortcut",
                "--playlist",
                "--playlist-items",
                "1-5,8",
                "audio",
                "https://www.youtube.com/watch?v=1&list=PL123",
            ],
        )
        self.assertEqual(
            popen.call_args_list[1].args[0],
            [
                "/tmp/fake-shortcut",
                "--no-playlist",
                "video",
                "https://www.youtube.com/watch?v=1&list=PL123",
            ],
        )

    def test_download_accepts_safe_arbitrary_http_sites_and_rejects_invalid_mode(self):
        with mock.patch.dict(os.environ, {"YTDL_SHORTCUT": "/tmp/fake-shortcut"}), mock.patch.object(
            HOST.subprocess, "Popen"
        ):
            responses = run_host(
                [
                    {"action": "download", "mode": "audio", "url": "https://vimeo.com/123"},
                    {"action": "download", "mode": "shell", "url": "https://youtube.com/watch?v=x"},
                    {"action": "download", "mode": "audio", "url": "file:///etc/passwd"},
                ]
            )

        self.assertEqual(len(responses), 3)
        self.assertTrue(responses[0]["ok"] is True and responses[0]["url"] == "https://vimeo.com/123")
        self.assertTrue(all(response["ok"] is False for response in responses[1:]))
        self.assertTrue(all(isinstance(response["error"], str) for response in responses[1:]))

    def test_download_rejects_unsafe_generic_http_urls(self):
        unsafe_urls = (
            "file:///etc/passwd",
            "https://user:pass@example.com/video",
            "https://example.com:444/video",
            "https://example.com../video",
            "https://example.com/a\tb",
            "https://-bad.example/video",
        )
        with mock.patch.object(HOST.subprocess, "Popen") as popen:
            responses = run_host([
                {"action": "download", "mode": "audio", "url": url}
                for url in unsafe_urls
            ])

        self.assertEqual(len(responses), len(unsafe_urls))
        self.assertTrue(all(response["ok"] is False for response in responses))
        popen.assert_not_called()

    def test_download_rejects_userinfo_and_nonstandard_ports(self):
        with mock.patch.object(HOST.subprocess, "Popen") as popen:
            responses = run_host(
                [
                    {
                        "action": "download",
                        "mode": "video",
                        "url": "https://user:pass@youtube.com/watch?v=x",
                        "fallbacks": [
                            "https://youtube.com:444/watch?v=x",
                            "https://youtube.com../watch?v=x",
                        ],
                    }
                ]
            )

        self.assertFalse(responses[0]["ok"])
        popen.assert_not_called()

    def test_oversized_frame_returns_error_without_waiting_for_its_body(self):
        oversized = struct.pack("=I", 1024 * 1024 + 1)
        responses = run_host([], trailing=oversized)

        self.assertEqual(len(responses), 1)
        self.assertFalse(responses[0]["ok"])
        self.assertIn("size", responses[0]["error"].lower())

    def test_ping_includes_ytdlp_status_without_network(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ, {"HOME": tmp}, clear=False
        ):
            with mock.patch(
                "urllib.request.urlopen",
                side_effect=AssertionError("ping must not use the network"),
            ):
                responses = run_host([{"action": "ping"}])

        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0]["ok"])
        status = responses[0].get("yt_dlp_status")
        self.assertIsInstance(status, dict)
        for key in (
            "installed",
            "latest",
            "outdated",
            "age_days",
            "reason",
            "update_hint",
        ):
            self.assertIn(key, status)
        self.assertIsInstance(status["outdated"], bool)
        self.assertIn(status["reason"], ("behind_latest", "stale_age", "up_to_date", "unknown"))

    def test_config_response_calls_version_check_without_network(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ, {"HOME": tmp}, clear=False
        ):
            sentinel = {
                "installed": "2026.10.26",
                "latest": "2026.10.26",
                "outdated": False,
                "age_days": 1,
                "reason": "up_to_date",
                "update_hint": "yt-dlp -U",
            }
            with mock.patch.object(
                HOST, "check_ytdlp_update", return_value=dict(sentinel)
            ) as check:
                responses = run_host([{"action": "ping"}])

        check.assert_called_once_with(allow_network=False)
        self.assertEqual(responses[0]["yt_dlp_status"], sentinel)

    def test_config_response_includes_localized_download_presets(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ,
            {
                "HOME": tmp,
                "XDG_CONFIG_HOME": str(Path(tmp) / ".config"),
                "XDG_MUSIC_DIR": "$HOME/Musik",
                "XDG_VIDEOS_DIR": "$HOME/Filme",
                "XDG_DOWNLOAD_DIR": "$HOME/Heruntergeladen",
            },
            clear=False,
        ):
            response = run_host([{"action": "ping"}])[0]

        self.assertEqual(
            response["user_download_directories"],
            {
                "music": "~/Musik/Youtube Downloads",
                "videos": "~/Filme/Youtube Downloads",
                "downloads": "~/Heruntergeladen/Youtube",
            },
        )


class NativeHostPresenceTests(unittest.TestCase):
    def test_native_host_entrypoint_exists(self):
        self.assertTrue(HOST_PATH.is_file(), f"missing native host: {HOST_PATH}")

    def test_linux_native_host_prefers_user_local_bin_before_usr_bin(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            user_bin = home / ".local" / "bin"
            system_bin = home / "system-bin"
            user_bin.mkdir(parents=True)
            system_bin.mkdir()
            user_ytdlp = user_bin / "yt-dlp"
            system_ytdlp = system_bin / "yt-dlp"
            user_ytdlp.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            system_ytdlp.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            user_ytdlp.chmod(0o755)
            system_ytdlp.chmod(0o755)
            initial_path = os.pathsep.join((str(system_bin), "/usr/bin"))

            with mock.patch.dict(
                os.environ, {"HOME": str(home), "PATH": initial_path}, clear=False
            ), mock.patch.object(HOST.sys, "platform", "linux"):
                HOST._ensure_linux_gui_path()
                resolved = HOST.shutil.which("yt-dlp")
                path_entries = os.environ["PATH"].split(os.pathsep)

            self.assertEqual(resolved, str(user_ytdlp))
            self.assertEqual(path_entries[0], str(user_bin))

    def test_ping_exposes_thread_metadata_and_live_ytdlp_check_action(self):
        sentinel = {
            "installed": "2026.11.01",
            "latest": "2026.11.15",
            "outdated": True,
            "age_days": 14,
            "reason": "behind_latest",
            "update_hint": "yt-dlp -U",
        }
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ, {"HOME": tmp}, clear=False
        ), mock.patch(
            "ytdl_config.os.cpu_count", return_value=12
        ), mock.patch.object(
            HOST, "check_ytdlp_update", return_value=sentinel
        ) as check:
            responses = run_host([
                {"action": "ping"},
                {"action": "check_ytdlp_update"},
                {"action": "set_config", "config": {"postprocess_threads": 4}},
                {"action": "set_config", "config": {"postprocess_threads": 0}},
            ])

        self.assertEqual(responses[0]["cpu_threads"], 12)
        self.assertEqual(responses[0]["recommended_threads"], 10)
        self.assertEqual(responses[0]["effective_threads"], 10)
        self.assertEqual(responses[1]["yt_dlp_status"], sentinel)
        self.assertEqual(responses[2]["effective_threads"], 4)
        self.assertEqual(responses[3]["effective_threads"], 10)
        self.assertNotIn("postprocess_threads", responses[3]["config"])
        check.assert_any_call(allow_network=False)
        check.assert_any_call(allow_network=True)


if __name__ == "__main__":
    unittest.main()
