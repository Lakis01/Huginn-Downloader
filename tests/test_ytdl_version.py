"""Tests for bin/ytdl_version.py — smart out-of-date yt-dlp detector."""

import json
import os
import sys
import tempfile
import unittest
from datetime import date
from unittest import mock
from urllib.error import URLError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import ytdl_version


class ConstantsTests(unittest.TestCase):
    def test_cache_ttl_is_24h_and_stale_age_is_45_days(self):
        self.assertEqual(ytdl_version.CACHE_TTL_SECONDS, 86400)
        self.assertEqual(ytdl_version.STALE_AGE_DAYS, 45)


class VersionTupleTests(unittest.TestCase):
    def test_zero_padded_calendar_version(self):
        self.assertEqual(ytdl_version.version_tuple("2026.03.04"), (2026, 3, 4))

    def test_non_padded_segments(self):
        self.assertEqual(ytdl_version.version_tuple("2026.3.4"), (2026, 3, 4))

    def test_invalid_versions_return_none(self):
        for bad in ("", "   ", "not-a-version", "2026..04", "2026.03.x", None, 123):
            with self.subTest(value=bad):
                self.assertIsNone(ytdl_version.version_tuple(bad))


class VersionAgeDaysTests(unittest.TestCase):
    def test_age_in_days(self):
        self.assertEqual(
            ytdl_version.version_age_days("2026.03.04", today=date(2026, 4, 18)),
            45,
        )

    def test_invalid_version_returns_none(self):
        self.assertIsNone(
            ytdl_version.version_age_days("bogus", today=date(2026, 4, 18))
        )


class DetectUpdateCommandTests(unittest.TestCase):
    DEBIAN_RELEASE = (
        'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n'
        'NAME="Debian GNU/Linux"\nID=debian\nID_LIKE=debian\n'
    )
    LMDE_RELEASE = (
        'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n'
    )

    def test_debian_usr_bin_uses_apt(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path="/usr/bin/yt-dlp",
            platform_name="linux",
            os_release_text=self.DEBIAN_RELEASE,
        )
        self.assertIn("apt", hint)
        self.assertIn("yt-dlp", hint)

    def test_lmde_usr_bin_uses_apt(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path="/usr/bin/yt-dlp",
            platform_name="linux",
            os_release_text=self.LMDE_RELEASE,
        )
        self.assertIn("apt", hint)

    def test_pipx_path_uses_pipx_upgrade(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path="/home/user/.local/share/pipx/venvs/yt-dlp/bin/yt-dlp",
            platform_name="linux",
        )
        self.assertEqual(hint, "pipx upgrade yt-dlp")

    def test_local_bin_uses_self_update(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path="/home/user/.local/bin/yt-dlp",
            platform_name="linux",
            os_release_text=self.DEBIAN_RELEASE,
        )
        self.assertIn("yt-dlp", hint)
        self.assertIn("-U", hint)

    def test_macos_homebrew_uses_brew(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path="/opt/homebrew/bin/yt-dlp",
            platform_name="darwin",
        )
        self.assertEqual(hint, "brew upgrade yt-dlp")

    def test_windows_winget_upgrade(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path=r"C:\Users\user\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp\yt-dlp.exe",
            platform_name="nt",
        )
        self.assertIn("winget", hint)
        self.assertIn("yt-dlp", hint)

    def test_windows_standalone_exe_points_to_github(self):
        hint = ytdl_version.detect_update_command(
            ytdlp_path=r"C:\tools\yt-dlp.exe",
            platform_name="nt",
        )
        self.assertIn("yt-dlp", hint)
        self.assertTrue(
            "github.com" in hint or "-U" in hint,
            f"standalone hint should mention GitHub or -U: {hint!r}",
        )


class CheckUpdateTests(unittest.TestCase):
    def test_allow_network_false_never_calls_fetch_latest(self):
        fetch = mock.Mock(side_effect=AssertionError("must not be called"))
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            status = ytdl_version.check_ytdlp_update(
                allow_network=False,
                env=env,
                fetch_latest=fetch,
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
            )
        fetch.assert_not_called()
        self.assertFalse(status["outdated"])
        self.assertEqual(status["reason"], "up_to_date")

    def test_fresh_cache_skips_fetch_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_home = os.path.join(tmp, ".cache")
            env = {"HOME": tmp, "XDG_CACHE_HOME": cache_home}
            cache_path = (
                ytdl_version._cache_path(env, "linux")
                if hasattr(ytdl_version, "_cache_path")
                else None
            )
            # Prime the cache through a first successful network fetch.
            first = ytdl_version.check_ytdlp_update(
                allow_network=True,
                env=env,
                fetch_latest=lambda: "2026.10.26",
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
            self.assertEqual(first["latest"], "2026.10.26")
            if cache_path is not None:
                self.assertTrue(os.path.isfile(cache_path))
            # A fresh cache must not consult the network again.
            fetch = mock.Mock(side_effect=AssertionError("must not be called"))
            second = ytdl_version.check_ytdlp_update(
                allow_network=True,
                env=env,
                fetch_latest=fetch,
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
            fetch.assert_not_called()
            self.assertEqual(second["latest"], "2026.10.26")
            self.assertFalse(second["outdated"])

    def test_behind_latest_marks_outdated(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            status = ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env=env,
                fetch_latest=lambda: "2026.10.26",
                installed_version="2026.09.01",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
        self.assertTrue(status["outdated"])
        self.assertEqual(status["reason"], "behind_latest")
        self.assertEqual(status["installed"], "2026.09.01")
        self.assertEqual(status["latest"], "2026.10.26")
        self.assertIn("yt-dlp", status["update_hint"])

    def test_network_error_falls_back_to_stale_age_check(self):
        def boom():
            raise URLError("offline")

        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            old = ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env=env,
                fetch_latest=boom,
                installed_version="2024.01.01",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
            fresh = ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env=env,
                fetch_latest=boom,
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
        self.assertTrue(old["outdated"])
        self.assertEqual(old["reason"], "stale_age")
        self.assertGreater(old["age_days"], ytdl_version.STALE_AGE_DAYS)
        self.assertFalse(fresh["outdated"])
        self.assertEqual(fresh["reason"], "up_to_date")

    def test_unknown_version_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            status = ytdl_version.check_ytdlp_update(
                allow_network=False,
                env=env,
                fetch_latest=lambda: (_ for _ in ()).throw(
                    AssertionError("must not be called")
                ),
                installed_version="bogus",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
        self.assertFalse(status["outdated"])
        self.assertEqual(status["reason"], "unknown")

    def test_installed_version_param_avoids_subprocess(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            with mock.patch.object(
                ytdl_version.subprocess, "run",
                side_effect=AssertionError("must not spawn yt-dlp"),
            ):
                status = ytdl_version.check_ytdlp_update(
                    allow_network=False,
                    env=env,
                    installed_version="2026.10.26",
                    today=date(2026, 10, 27),
                    platform_name="linux",
                )
        self.assertEqual(status["installed"], "2026.10.26")

    def test_executable_version_wins_over_python_package(self):
        # A stale `yt_dlp` Python package must not shadow the `yt-dlp`
        # executable the wrapper actually runs (or vice versa).
        from types import SimpleNamespace

        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, ".cache")}
            fake_binary = os.path.join(tmp, "yt-dlp")
            with mock.patch.object(
                ytdl_version.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=0, stdout="2026.10.26\n"
                ),
            ) as run:
                with mock.patch.dict(
                    "sys.modules",
                    {"yt_dlp.version": SimpleNamespace(__version__="2024.01.01")},
                ):
                    status = ytdl_version.check_ytdlp_update(
                        allow_network=False,
                        env=env,
                        ytdlp_path=fake_binary,
                        today=date(2026, 10, 27),
                        platform_name="linux",
                    )
        run.assert_called_once_with(
            [fake_binary, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(status["installed"], "2026.10.26")

    def test_cache_paths_are_platform_specific(self):
        with tempfile.TemporaryDirectory() as tmp:
            linux_env = {"HOME": tmp, "XDG_CACHE_HOME": os.path.join(tmp, "xdg")}
            ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env=linux_env,
                fetch_latest=lambda: "2026.10.26",
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="linux",
            )
            self.assertTrue(
                os.path.isfile(
                    os.path.join(tmp, "xdg", "youtube-downloader", "ytdlp-version.json")
                )
            )

            darwin_home = os.path.join(tmp, "mac-home")
            os.makedirs(darwin_home)
            ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env={"HOME": darwin_home},
                fetch_latest=lambda: "2026.10.26",
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="darwin",
            )
            self.assertTrue(
                os.path.isfile(
                    os.path.join(
                        darwin_home,
                        "Library",
                        "Caches",
                        "FirefoxYouTubeDownloader",
                        "ytdlp-version.json",
                    )
                )
            )

            win_base = os.path.join(tmp, "win-local")
            os.makedirs(win_base)
            ytdl_version.check_ytdlp_update(
                allow_network=True,
                force_refresh=True,
                env={"LOCALAPPDATA": win_base, "HOME": tmp},
                fetch_latest=lambda: "2026.10.26",
                installed_version="2026.10.26",
                today=date(2026, 10, 27),
                platform_name="nt",
            )
            self.assertTrue(
                os.path.isfile(
                    os.path.join(
                        win_base,
                        "FirefoxYouTubeDownloader",
                        "cache",
                        "ytdlp-version.json",
                    )
                )
            )


if __name__ == "__main__":
    unittest.main()
