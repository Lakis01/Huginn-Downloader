import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import ytdl_config
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
            {
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
            },
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
            expected = {
                "download_dir": "~/Music/custom",
                "auto_tag": False,
                "rsgain": True,
                "audio_format": "best",
                "mp3_quality": "V0",
                "embed_thumbnail": True,
                "thumbnail_jpg": False,
                "channel_mode": "stereo",
                "long_audio_enabled": False,
                "long_audio_minutes": 30,
                "long_audio_dir": "~/Podcasts",
            }

            saved_path = save_config(expected, env)
            actual = load_config(env)

            self.assertEqual(saved_path, config_path(env))
            self.assertEqual(actual, expected)
            self.assertEqual(json.loads(saved_path.read_text(encoding="utf-8")), expected)

    def test_audio_format_and_mp3_quality_have_supported_defaults(self):
        self.assertEqual(
            getattr(ytdl_config, "SUPPORTED_AUDIO_FORMATS", None),
            ("best", "opus", "mp3", "m4a", "ogg", "flac"),
        )
        self.assertEqual(
            getattr(ytdl_config, "SUPPORTED_MP3_QUALITIES", None),
            ("V0", "320k", "V2", "V5"),
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = config_path({"HOME": tmp})
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"audio_format": "invalid", "mp3_quality": "bad"}))

            config = load_config({"HOME": tmp})

        self.assertEqual(config["audio_format"], "best")
        self.assertEqual(config["mp3_quality"], "V0")

    def test_save_config_round_trips_audio_format_and_mp3_quality(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            expected = {
                "download_dir": None,
                "auto_tag": True,
                "rsgain": False,
                "audio_format": "mp3",
                "mp3_quality": "320k",
                "embed_thumbnail": True,
                "thumbnail_jpg": False,
                "channel_mode": "stereo",
                "long_audio_enabled": False,
                "long_audio_minutes": 30,
                "long_audio_dir": "~/Podcasts",
            }

            save_config(expected, env)

            self.assertEqual(load_config(env), expected)

    def test_save_config_rejects_unsupported_audio_format_and_mp3_quality(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            for key, invalid_value in (
                ("audio_format", "wav"),
                ("audio_format", None),
                ("mp3_quality", "256k"),
                ("mp3_quality", 0),
            ):
                with self.subTest(key=key, value=invalid_value):
                    with self.assertRaises((TypeError, ValueError)):
                        save_config({key: invalid_value}, env)

            self.assertFalse(config_path(env).exists())

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



    def test_new_pipeline_defaults_and_legacy_mp3_alias(self):
        import ytdl_config
        self.assertEqual(ytdl_config.SUPPORTED_MP3_QUALITIES, ("V0", "320k", "V2", "V5"))
        self.assertEqual(ytdl_config.SUPPORTED_AUDIO_FORMATS, ("best", "opus", "mp3", "m4a", "ogg", "flac"))
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            config = load_config(env)
            self.assertTrue(config["embed_thumbnail"])
            self.assertFalse(config["thumbnail_jpg"])
            self.assertEqual(config["channel_mode"], "stereo")
            self.assertFalse(config["long_audio_enabled"])
            self.assertEqual(config["long_audio_minutes"], 30)
            self.assertEqual(config["long_audio_dir"], "~/Podcasts")
            path = config_path(env)
            path.parent.mkdir(parents=True, exist_ok=True)
            import json
            path.write_text(json.dumps({"mp3_quality": "128k"}))
            self.assertEqual(load_config(env)["mp3_quality"], "V5")
            save_config({"audio_format": "opus", "mp3_quality": "128k", "embed_thumbnail": False, "thumbnail_jpg": True, "channel_mode": "mono", "long_audio_enabled": True, "long_audio_minutes": 45, "long_audio_dir": "~/Audiobooks"}, env)
            reloaded = load_config(env)
            self.assertEqual(reloaded["audio_format"], "opus")
            self.assertEqual(reloaded["mp3_quality"], "V5")
            self.assertFalse(reloaded["embed_thumbnail"])
            self.assertTrue(reloaded["thumbnail_jpg"])
            self.assertEqual(reloaded["channel_mode"], "mono")
            self.assertNotIn("mono_audio", reloaded)
            self.assertTrue(reloaded["long_audio_enabled"])
            self.assertEqual(reloaded["long_audio_minutes"], 45)
            self.assertEqual(reloaded["long_audio_dir"], "~/Audiobooks")
            with self.assertRaises((TypeError, ValueError)):
                save_config({"long_audio_minutes": 0}, env)
            with self.assertRaises((TypeError, ValueError)):
                save_config({"long_audio_dir": "   "}, env)

    def test_legacy_mono_audio_migrates_and_channel_mode_takes_precedence(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"mono_audio": True, "audio_format": "mp3", "mp3_quality": "128k"}))

            migrated = load_config(env)
            save_config(migrated, env)
            persisted = json.loads(path.read_text())
            path.write_text(json.dumps({"mono_audio": True, "channel_mode": "ask"}))
            overridden = load_config(env)

        self.assertEqual(migrated["channel_mode"], "mono")
        self.assertEqual(migrated["audio_format"], "mp3")
        self.assertEqual(migrated["mp3_quality"], "V5")
        self.assertEqual(persisted["channel_mode"], "mono")
        self.assertNotIn("mono_audio", persisted)
        self.assertEqual(overridden["channel_mode"], "ask")

    def test_legacy_false_mono_audio_migrates_to_stereo_and_old_alias_saves_as_v5(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"mono_audio": False}))

            self.assertEqual(load_config(env)["channel_mode"], "stereo")
            save_config({"mp3_quality": "128k"}, env)
            persisted = json.loads(path.read_text())

        self.assertEqual(persisted["mp3_quality"], "V5")
        self.assertNotIn("mono_audio", persisted)

    def test_save_config_validates_channel_mode_and_new_audio_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            for value, error in (("surround", ValueError), (True, TypeError), (None, TypeError)):
                with self.subTest(value=value), self.assertRaises(error):
                    save_config({"channel_mode": value}, env)
            save_config({"audio_format": "opus", "channel_mode": "ask"}, env)
            config = load_config(env)

        self.assertEqual(config["audio_format"], "opus")
        self.assertEqual(config["channel_mode"], "ask")


if __name__ == "__main__":
    unittest.main()
