import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
from ytdl_config import (
    ALT_FRESH_DOWNLOAD_DIR,
    DEFAULT_FRESH_DOWNLOAD_DIR,
    config_path,
    effective_download_dir,
    load_config,
    save_config,
    ytdlp_config_exists,
)


class ConfigTests(unittest.TestCase):
    def test_load_config_returns_defaults_without_reading_user_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}

            config = load_config(env)

        self.assertEqual(
            config,
            {"download_dir": None, "auto_tag": True, "rsgain": False},
        )
        self.assertEqual(DEFAULT_FRESH_DOWNLOAD_DIR, "~/Music/Youtube Downloads")
        self.assertEqual(ALT_FRESH_DOWNLOAD_DIR, "~/Downloads/Youtube")

    def test_config_path_uses_xdg_config_home_from_supplied_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": str(Path(tmp) / "home"), "XDG_CONFIG_HOME": str(Path(tmp) / "xdg")}

            result = config_path(env)

        self.assertEqual(result, Path(tmp) / "xdg/youtube-downloader/config.json")

    def test_config_path_defaults_to_config_directory_under_supplied_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = config_path({"HOME": tmp})

        self.assertEqual(result, Path(tmp) / ".config/youtube-downloader/config.json")

    def test_save_config_round_trips_valid_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            expected = {"download_dir": "~/Music/custom", "auto_tag": False, "rsgain": True}

            saved_path = save_config(expected, env)
            actual = load_config(env)

            self.assertEqual(saved_path, config_path(env))
            self.assertEqual(actual, expected)
            self.assertEqual(json.loads(saved_path.read_text(encoding="utf-8")), expected)

    def test_save_config_rejects_invalid_value_types(self):
        invalid_configs = (
            {"download_dir": 12, "auto_tag": True, "rsgain": False},
            {"download_dir": None, "auto_tag": "yes", "rsgain": False},
            {"download_dir": None, "auto_tag": True, "rsgain": 1},
        )
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            for config in invalid_configs:
                with self.subTest(config=config):
                    with self.assertRaises((TypeError, ValueError)):
                        save_config(config, env)

            self.assertFalse(config_path(env).exists())

    def test_effective_download_dir_is_none_when_yt_dlp_config_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            yt_dlp_config = Path(tmp) / ".config/yt-dlp/config"
            yt_dlp_config.parent.mkdir(parents=True)
            yt_dlp_config.write_text("--paths home:~/Music/Existing\n", encoding="utf-8")

            self.assertTrue(ytdlp_config_exists(env))
            self.assertIsNone(effective_download_dir({"download_dir": None}, env))

    def test_effective_download_dir_expands_default_using_supplied_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}

            result = effective_download_dir({"download_dir": None}, env)

        self.assertEqual(result, str(Path(tmp) / "Music/Youtube Downloads"))

    def test_effective_download_dir_expands_custom_tilde_using_supplied_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}

            result = effective_download_dir({"download_dir": "~/Downloads/custom"}, env)

        self.assertEqual(result, str(Path(tmp) / "Downloads/custom"))

    def test_ytdlp_config_detection_checks_legacy_config_under_supplied_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            legacy_config = Path(tmp) / ".yt-dlp.conf"
            legacy_config.write_text("--no-playlist\n", encoding="utf-8")

            self.assertTrue(ytdlp_config_exists(env))


if __name__ == "__main__":
    unittest.main()
