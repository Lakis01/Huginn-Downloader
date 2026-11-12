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
    def test_ping_and_get_config_use_native_message_framing(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ, {"HOME": tmp}, clear=False
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
            self.assertEqual(response["version"], "2.0.0")
            self.assertEqual(
                response["config"],
                {"download_dir": None, "auto_tag": True, "rsgain": False},
            )
            self.assertEqual(response["effective_download_dir"], str(Path(tmp) / "Music/Youtube Downloads"))
            self.assertFalse(response["ytdlp_config_exists"])
            self.assertEqual(response["deps"], {"yt_dlp": True, "ffmpeg": True, "rsgain": True})

    def test_set_config_merges_partial_updates_and_persists_empty_dir_as_none(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            os.environ, {"HOME": tmp}, clear=False
        ):
            responses = run_host(
                [
                    {
                        "action": "set_config",
                        "config": {"auto_tag": False, "download_dir": ""},
                    }
                ]
            )
            persisted = HOST.load_config()

        self.assertEqual(len(responses), 1)
        self.assertTrue(responses[0]["ok"])
        self.assertEqual(
            responses[0]["config"],
            {"download_dir": None, "auto_tag": False, "rsgain": False},
        )
        self.assertEqual(persisted, responses[0]["config"])

    def test_download_selects_first_valid_youtube_fallback_and_spawns_detached(self):
        request = {
            "action": "download",
            "mode": "cut",
            "url": "https://soundcloud.com/example/track",
            "fallbacks": [
                "https://youtube.com.evil.invalid/watch?v=no",
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
                    "url": "https://m.youtube.com/watch?v=yes",
                }
            ],
        )
        popen.assert_called_once_with(
            ["/tmp/fake-shortcut", "cut", "https://m.youtube.com/watch?v=yes"],
            start_new_session=True,
            stdin=HOST.subprocess.DEVNULL,
            stdout=HOST.subprocess.DEVNULL,
            stderr=HOST.subprocess.DEVNULL,
        )

    def test_download_rejects_non_youtube_and_invalid_mode_cleanly(self):
        responses = run_host(
            [
                {"action": "download", "mode": "audio", "url": "https://vimeo.com/123"},
                {"action": "download", "mode": "shell", "url": "https://youtube.com/watch?v=x"},
            ]
        )

        self.assertEqual(len(responses), 2)
        self.assertTrue(all(response["ok"] is False for response in responses))
        self.assertTrue(all(isinstance(response["error"], str) for response in responses))

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


class NativeHostPresenceTests(unittest.TestCase):
    def test_native_host_entrypoint_exists(self):
        self.assertTrue(HOST_PATH.is_file(), f"missing native host: {HOST_PATH}")


if __name__ == "__main__":
    unittest.main()
