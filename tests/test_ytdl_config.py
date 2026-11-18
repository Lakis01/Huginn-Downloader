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
    def test_xdg_user_dir_prefers_environment_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".config").mkdir()
            (home / ".config/user-dirs.dirs").write_text(
                'XDG_MUSIC_DIR="$HOME/Config Music"\n', encoding="utf-8"
            )
            env = {"HOME": tmp, "XDG_MUSIC_DIR": "${HOME}/Env Music"}

            resolver = getattr(ytdl_config, "xdg_user_dir", None)
            self.assertTrue(callable(resolver), "XDG user directory resolver is available")
            result = resolver("MUSIC", env)

        self.assertEqual(result, Path(tmp) / "Env Music")

    def test_xdg_user_dir_parses_user_dirs_file_without_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config_home = home / ".config"
            config_home.mkdir()
            (config_home / "user-dirs.dirs").write_text(
                'XDG_MUSIC_DIR="$HOME/Musik"\n'
                'XDG_VIDEOS_DIR="${HOME}/Eigene Videos"\n'
                'XDG_DOWNLOAD_DIR="$(touch ${HOME}/executed)"\n',
                encoding="utf-8",
            )
            env = {"HOME": tmp}
            resolver = getattr(ytdl_config, "xdg_user_dir", None)
            self.assertTrue(callable(resolver), "XDG user directory resolver is available")

            music = resolver("MUSIC", env)
            videos = resolver("VIDEOS", env)
            downloads = resolver("DOWNLOAD", env)

        self.assertEqual(music, home / "Musik")
        self.assertEqual(videos, home / "Eigene Videos")
        self.assertEqual(downloads, home / "Downloads")
        self.assertFalse((home / "executed").exists(), "user-dirs.dirs must never be evaluated")

    def test_xdg_user_dir_reads_config_home_user_dirs_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config_home = home / "settings"
            config_home.mkdir()
            (config_home / "user-dirs.dirs").write_text(
                'XDG_DOWNLOAD_DIR="$HOME/Heruntergeladen"\n', encoding="utf-8"
            )
            resolver = getattr(ytdl_config, "xdg_user_dir", None)
            self.assertTrue(callable(resolver), "XDG user directory resolver is available")

            result = resolver(
                "DOWNLOAD", {"HOME": tmp, "XDG_CONFIG_HOME": str(config_home)}
            )

        self.assertEqual(result, home / "Heruntergeladen")

    def test_empty_legacy_default_paths_migrate_to_localized_xdg_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            env = {
                "HOME": tmp,
                "XDG_MUSIC_DIR": "$HOME/Musik",
                "XDG_VIDEOS_DIR": "$HOME/Filme",
                "XDG_DOWNLOAD_DIR": "$HOME/Heruntergeladen",
            }
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps(
                    {
                        "download_dir": str(home / "Music/Youtube Downloads"),
                        "video_download_dir": "~/Videos/Youtube Downloads",
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(env)
            get_dirs = getattr(ytdl_config, "user_download_directories", None)
            self.assertTrue(callable(get_dirs), "popup directory presets are available")
            audio_dirs = get_dirs(env)
            effective_audio = effective_download_dir({"download_dir": None}, env)

        self.assertEqual(config["download_dir"], "~/Musik/Youtube Downloads")
        self.assertEqual(config["video_download_dir"], "~/Filme/Youtube Downloads")
        self.assertEqual(audio_dirs["music"], "~/Musik/Youtube Downloads")
        self.assertEqual(audio_dirs["videos"], "~/Filme/Youtube Downloads")
        self.assertEqual(audio_dirs["downloads"], "~/Heruntergeladen/Youtube")
        self.assertEqual(effective_audio, str(home / "Musik/Youtube Downloads"))

    def test_populated_legacy_default_paths_are_preserved_including_hidden_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            legacy_music = home / "Music/Youtube Downloads"
            legacy_videos = home / "Videos/Youtube Downloads"
            legacy_music.mkdir(parents=True)
            legacy_videos.mkdir(parents=True)
            (legacy_music / ".keep").touch()
            (legacy_videos / ".hidden-cache").touch()
            env = {"HOME": tmp, "XDG_MUSIC_DIR": "$HOME/Musik", "XDG_VIDEOS_DIR": "$HOME/Filme"}
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps(
                    {
                        "download_dir": "~/Music/Youtube Downloads",
                        "video_download_dir": str(legacy_videos),
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(env)

        self.assertEqual(config["download_dir"], "~/Music/Youtube Downloads")
        self.assertEqual(config["video_download_dir"], str(legacy_videos))

    def test_custom_paths_are_not_localized_or_moved(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            custom = home / "Archive/Audio"
            custom.mkdir(parents=True)
            env = {"HOME": tmp, "XDG_MUSIC_DIR": "$HOME/Musik"}
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"download_dir": str(custom)}), encoding="utf-8")

            config = load_config(env)
            custom_exists = custom.is_dir()

        self.assertEqual(config["download_dir"], str(custom))
        self.assertTrue(custom_exists)

    def test_load_config_returns_defaults_without_reading_user_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}

            config = load_config(env)

        self.assertEqual(
            config,
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
        self.assertEqual(DEFAULT_FRESH_DOWNLOAD_DIR, "~/Music/Youtube Downloads")
        self.assertEqual(ALT_FRESH_DOWNLOAD_DIR, "~/Downloads/Youtube")
        self.assertEqual(
            getattr(ytdl_config, "DEFAULT_VIDEO_DOWNLOAD_DIR", None),
            "~/Videos/Youtube Downloads",
        )

    def test_legacy_config_migrates_video_folder_without_changing_audio_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            path = config_path(env)
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps({"download_dir": "~/Music/Existing", "auto_tag": False}),
                encoding="utf-8",
            )

            config = load_config(env)

        self.assertEqual(config["download_dir"], "~/Music/Existing")
        self.assertEqual(config.get("video_download_dir"), "~/Videos/Youtube Downloads")
        self.assertFalse(config["verbose_output"])

    def test_verbose_output_defaults_false_and_round_trips_as_a_boolean(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            self.assertFalse(load_config(env)["verbose_output"])
            save_config({"verbose_output": True}, env)
            self.assertTrue(load_config(env)["verbose_output"])

            with self.assertRaises(TypeError):
                save_config({"verbose_output": "true"}, env)

    def test_effective_video_dir_uses_project_default_only_for_explicit_keep(self):
        resolver = getattr(ytdl_config, "effective_video_download_dir", None)
        self.assertTrue(callable(resolver), "video folder resolver is available")
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            expected = str(Path(tmp) / "Videos/Youtube Downloads")
            self.assertEqual(
                resolver({"video_download_dir": "~/Videos/Youtube Downloads"}, env),
                expected,
            )
            self.assertEqual(resolver({"video_download_dir": None}, env), expected)

    def test_effective_video_dir_defers_to_existing_ytdlp_config_when_selected(self):
        resolver = getattr(ytdl_config, "effective_video_download_dir", None)
        self.assertTrue(callable(resolver), "video folder resolver is available")
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            ytdlp_config_file = Path(tmp) / ".config/yt-dlp/config"
            ytdlp_config_file.parent.mkdir(parents=True)
            ytdlp_config_file.write_text("--paths home:~/Videos/FromYtDlp\n", encoding="utf-8")
            self.assertIsNone(resolver({"video_download_dir": None}, env))
            self.assertEqual(
                resolver({"video_download_dir": "~/Videos/Override"}, env),
                str(Path(tmp) / "Videos/Override"),
            )

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
                "video_download_dir": "~/Videos/Youtube Downloads",
                "verbose_output": False,
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
                "video_download_dir": "~/Videos/Youtube Downloads",
                "verbose_output": False,
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

    def test_save_config_rejects_invalid_video_download_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            with self.assertRaises(TypeError):
                save_config({"video_download_dir": 12}, env)
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

    def test_postprocess_threads_recommendation_and_round_trip(self):
        from ytdl_config import (
            effective_postprocess_threads,
            recommended_postprocess_threads,
        )

        self.assertEqual(recommended_postprocess_threads(1), 1)
        self.assertEqual(recommended_postprocess_threads(2), 1)
        self.assertEqual(recommended_postprocess_threads(12), 10)
        self.assertEqual(effective_postprocess_threads({}, cpu_threads=8), 6)
        self.assertEqual(
            effective_postprocess_threads({"postprocess_threads": 3}, cpu_threads=8),
            3,
        )

        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            baseline = load_config(env)
            self.assertNotIn("postprocess_threads", baseline)
            save_config({"postprocess_threads": 6}, env)
            self.assertEqual(load_config(env)["postprocess_threads"], 6)
            save_config({"postprocess_threads": 0}, env)
            self.assertNotIn("postprocess_threads", load_config(env))
            with self.assertRaises(ValueError):
                save_config({"postprocess_threads": 99}, env)

    def test_ui_mode_show_cut_button_and_video_dir_enabled_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            baseline = load_config(env)
            self.assertNotIn("ui_mode", baseline)
            self.assertNotIn("show_cut_button", baseline)
            self.assertNotIn("video_dir_enabled", baseline)

            save_config(
                {
                    "ui_mode": "advanced",
                    "show_cut_button": True,
                    "video_dir_enabled": False,
                    "download_dir": "~/Music/Main",
                    "video_download_dir": "~/Videos/Separate",
                },
                env,
            )
            loaded = load_config(env)
            self.assertEqual(loaded["ui_mode"], "advanced")
            self.assertTrue(loaded["show_cut_button"])
            self.assertIs(loaded["video_dir_enabled"], False)
            self.assertEqual(
                ytdl_config.effective_video_download_dir(loaded, env),
                str(Path(tmp) / "Music/Main"),
            )

            save_config(
                {
                    "ui_mode": "simple",
                    "show_cut_button": False,
                    "video_dir_enabled": True,
                    "download_dir": "~/Music/Main",
                    "video_download_dir": "~/Videos/Separate",
                },
                env,
            )
            reloaded = load_config(env)
            self.assertNotIn("ui_mode", reloaded)
            self.assertNotIn("show_cut_button", reloaded)
            self.assertIs(reloaded["video_dir_enabled"], True)
            self.assertEqual(
                ytdl_config.effective_video_download_dir(reloaded, env),
                str(Path(tmp) / "Videos/Separate"),
            )

            for bad_cfg, exc in (
                ({"ui_mode": "expert"}, ValueError),
                ({"ui_mode": 123}, TypeError),
                ({"show_cut_button": "yes"}, TypeError),
                ({"video_dir_enabled": "no"}, TypeError),
                ({"video_codec": "divx"}, ValueError),
                ({"video_codec": 42}, TypeError),
            ):
                with self.subTest(bad_cfg=bad_cfg), self.assertRaises(exc):
                    save_config(bad_cfg, env)

    def test_video_codec_preference_round_trip_and_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            baseline = load_config(env)
            self.assertNotIn("video_codec", baseline)

            save_config({"video_codec": "hevc"}, env)
            self.assertEqual(load_config(env)["video_codec"], "h265")
            save_config({"video_codec": "AV01"}, env)
            self.assertEqual(load_config(env)["video_codec"], "av1")
            save_config({"video_codec": "avc1"}, env)
            self.assertEqual(load_config(env)["video_codec"], "h264")
            save_config({"video_codec": "vp9"}, env)
            self.assertEqual(load_config(env)["video_codec"], "vp9")
            save_config({"video_codec": "auto"}, env)
            self.assertNotIn("video_codec", load_config(env))


if __name__ == "__main__":
    unittest.main()
