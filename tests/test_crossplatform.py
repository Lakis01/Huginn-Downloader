import builtins
import hashlib
import importlib.util
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin"
sys.path.insert(0, str(BIN))

import ytdl_config


def load_script(test_case, name, filename):
    path = ROOT / filename
    test_case.assertTrue(path.is_file(), f"{filename} must exist")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WindowsConfigTests(unittest.TestCase):
    def test_windows_config_defaults_to_local_appdata_and_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                "HOME": str(Path(tmp) / "home"),
                "LOCALAPPDATA": str(Path(tmp) / "LocalAppData"),
            }
            expected = (
                Path(tmp) / "LocalAppData/FirefoxYouTubeDownloader/config.json"
            )

            self.assertEqual(ytdl_config.config_path(env, "nt"), expected)
            saved = ytdl_config.save_config(
                {"download_dir": None, "auto_tag": False, "rsgain": True, "audio_format": "best", "mp3_quality": "V0", "embed_thumbnail": True, "thumbnail_jpg": False, "channel_mode": "stereo", "long_audio_enabled": False, "long_audio_minutes": 30, "long_audio_dir": "~/Podcasts"},
                env,
                "nt",
            )
            self.assertEqual(saved, expected)
            self.assertEqual(
                ytdl_config.load_config(env, "nt"),
                {
                    "download_dir": None,
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
                },
            )
            self.assertEqual(
                ytdl_config.effective_download_dir({"download_dir": None}, env, "nt"),
                str(Path(tmp) / "home/Music/Youtube Downloads"),
            )

    def test_video_download_dir_expands_home_on_windows(self):
        resolver = getattr(ytdl_config, "effective_video_download_dir", None)
        self.assertTrue(callable(resolver), "video folder resolver is available")
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": str(Path(tmp) / "home")}
            self.assertEqual(
                resolver({"video_download_dir": "~/Videos/Youtube Downloads"}, env, "nt"),
                str(Path(tmp) / "home/Videos/Youtube Downloads"),
            )

    def test_windows_xdg_override_and_appdata_yt_dlp_configs_are_respected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            env = {
                "HOME": str(root / "home"),
                "LOCALAPPDATA": str(root / "local"),
                "APPDATA": str(root / "roaming"),
                "XDG_CONFIG_HOME": str(root / "xdg"),
            }
            self.assertEqual(
                ytdl_config.config_path(env, "nt"),
                root / "xdg/youtube-downloader/config.json",
            )
            config_dir = root / "roaming/yt-dlp"
            config_dir.mkdir(parents=True)
            for filename in ("config", "config.txt"):
                with self.subTest(filename=filename):
                    config = config_dir / filename
                    config.write_text("--no-playlist\n", encoding="utf-8")
                    self.assertTrue(ytdl_config.ytdlp_config_exists(env, "nt"))
                    self.assertIsNone(
                        ytdl_config.effective_download_dir(
                            {"download_dir": None}, env, "nt"
                        )
                    )
                    config.unlink()

    def test_video_download_dir_expands_home_on_windows(self):
        resolver = getattr(ytdl_config, "effective_video_download_dir", None)
        self.assertTrue(callable(resolver), "video folder resolver is available")
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": str(Path(tmp) / "home")}
            self.assertEqual(
                resolver({"video_download_dir": "~/Videos/Youtube Downloads"}, env, "nt"),
                str(Path(tmp) / "home/Videos/Youtube Downloads"),
            )

    def test_windows_home_fallback_and_existing_call_signatures_remain_compatible(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HOME": tmp}
            self.assertEqual(
                ytdl_config.config_path(env),
                Path(tmp) / ".config/youtube-downloader/config.json",
            )
            self.assertEqual(
                ytdl_config.config_path(env, "nt"),
                Path(tmp) / "AppData/Local/FirefoxYouTubeDownloader/config.json",
            )
            self.assertEqual(
                ytdl_config.effective_download_dir({"download_dir": "~/Music"}, env),
                str(Path(tmp) / "Music"),
            )


class CrossPlatformWrapperTests(unittest.TestCase):
    def test_wrapper_imports_when_termios_is_unavailable(self):
        real_import = builtins.__import__

        def without_termios(name, *args, **kwargs):
            if name in {"termios", "tty"}:
                raise ImportError(f"No module named {name}")
            return real_import(name, *args, **kwargs)

        path = ROOT / "bin/yt-dlp-wrapper.py"
        spec = importlib.util.spec_from_file_location("windows_wrapper_import", path)
        wrapper = importlib.util.module_from_spec(spec)
        with mock.patch("builtins.__import__", side_effect=without_termios):
            spec.loader.exec_module(wrapper)
        self.assertTrue(callable(wrapper.wait_for_keypress))

    def test_wait_for_keypress_uses_msvcrt_on_windows(self):
        wrapper = load_script(self, "windows_wrapper", "bin/yt-dlp-wrapper.py")
        fake_stdin = mock.Mock()
        fake_stdin.isatty.return_value = True
        fake_msvcrt = types.SimpleNamespace(getch=mock.Mock(return_value=b"x"))
        with mock.patch.object(wrapper.sys, "stdin", fake_stdin):
            with mock.patch.object(wrapper.sys, "stdout", new_callable=mock.Mock):
                with mock.patch.object(wrapper.os, "name", "nt"):
                    with mock.patch.dict(sys.modules, {"msvcrt": fake_msvcrt}):
                        wrapper.wait_for_keypress(prompt="")
        fake_msvcrt.getch.assert_called_once_with()
        fake_stdin.read.assert_not_called()


class NativeHostLaunchTests(unittest.TestCase):
    def setUp(self):
        self.host = load_script(self, "crossplatform_native_host", "bin/yt-dlp-native-host.py")

    def test_linux_launch_keeps_detached_shortcut_argv(self):
        with mock.patch.dict(os.environ, {"YTDL_SHORTCUT": "/tmp/shortcut.sh"}):
            with mock.patch.object(self.host, "_is_windows", return_value=False):
                with mock.patch.object(self.host.sys, "platform", "linux"):
                    with mock.patch.object(self.host.subprocess, "Popen") as popen:
                        self.host._launch_download("audio", "https://youtube.com/watch?v=1")
        popen.assert_called_once_with(
            ["/tmp/shortcut.sh", "audio", "https://youtube.com/watch?v=1"],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    @unittest.skipIf(os.name == "nt", "macOS launcher permissions require POSIX")
    def test_macos_launcher_is_private_quoted_and_opened_in_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://www.youtube.com/watch?v=O'Reilly&next=$(touch /tmp/injected)"
            created = []
            real_mkstemp = self.host.tempfile.mkstemp

            def make_temp(*args, **kwargs):
                kwargs["dir"] = tmp
                result = real_mkstemp(*args, **kwargs)
                created.append(result[1])
                return result

            with mock.patch.object(self.host.sys, "platform", "darwin"):
                with mock.patch.object(self.host.tempfile, "mkstemp", side_effect=make_temp):
                    with mock.patch.object(self.host.subprocess, "Popen") as popen:
                        self.host._launch_download("cut", url)

            command_path = Path(created[0])
            try:
                self.assertTrue(command_path.name.startswith("ytdl-launch-"))
                self.assertTrue(command_path.name.endswith(".command"))
                self.assertEqual(command_path.stat().st_mode & 0o777, 0o700)
                expected = (
                    "#!/bin/sh\n"
                    'rm -f -- "$0"\n'
                    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"\n'
                    f"exec {shlex.quote(sys.executable)} "
                    f"{shlex.quote(str(ROOT / 'bin/yt-dlp-wrapper.py'))} "
                    f"--wait-keypress cut {shlex.quote(url)}\n"
                )
                self.assertEqual(command_path.read_text(encoding="utf-8"), expected)
                popen.assert_called_once_with(
                    ["open", "-a", "Terminal", str(command_path)],
                    start_new_session=True,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            finally:
                command_path.unlink(missing_ok=True)

    @unittest.skipIf(os.name == "nt", "macOS PATH behavior requires POSIX")
    def test_macos_gui_path_and_terminal_launcher_work_with_minimal_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_bin = Path(tmp) / ".local/bin"
            local_bin.mkdir(parents=True)
            yt_dlp = local_bin / "yt-dlp"
            yt_dlp.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            yt_dlp.chmod(0o755)
            real_isdir = os.path.isdir

            def isdir(path):
                if path in {"/opt/homebrew/bin", "/usr/local/bin"}:
                    return True
                return real_isdir(path)

            with mock.patch.dict(
                os.environ,
                {"HOME": tmp, "PATH": "/usr/bin:/bin"},
                clear=True,
            ):
                self.assertTrue(
                    callable(getattr(self.host, "_ensure_macos_gui_path", None))
                )
                with mock.patch.object(self.host.sys, "platform", "darwin"):
                    with mock.patch.object(
                        self.host.os.path, "isdir", side_effect=isdir
                    ):
                        self.host._ensure_macos_gui_path()
                path_entries = os.environ["PATH"].split(os.pathsep)
                self.assertEqual(path_entries[:2], ["/usr/bin", "/bin"])
                self.assertIn("/opt/homebrew/bin", path_entries)
                self.assertIn("/usr/local/bin", path_entries)
                self.assertIn(str(local_bin), path_entries)
                self.assertEqual(
                    self.host.shutil.which("yt-dlp", path=str(local_bin)),
                    str(yt_dlp),
                )

                command_path = None
                created = []
                real_mkstemp = self.host.tempfile.mkstemp

                def make_temp(*args, **kwargs):
                    kwargs["dir"] = tmp
                    result = real_mkstemp(*args, **kwargs)
                    created.append(result[1])
                    return result

                try:
                    with mock.patch.object(self.host.sys, "platform", "darwin"):
                        with mock.patch.object(
                            self.host.tempfile, "mkstemp", side_effect=make_temp
                        ):
                            with mock.patch.object(self.host.subprocess, "Popen"):
                                self.host._launch_download(
                                    "audio", "https://youtu.be/abc"
                                )
                    command_path = Path(created[0])
                    command_text = command_path.read_text(encoding="utf-8")
                    export = (
                        'export PATH="/opt/homebrew/bin:/usr/local/bin:'
                        '$HOME/.local/bin:$PATH"'
                    )
                    self.assertIn(export, command_text)
                    result = subprocess.run(
                        ["/bin/sh", "-c", f"{export}\ncommand -v yt-dlp"],
                        check=True,
                        capture_output=True,
                        text=True,
                        env={"HOME": tmp, "PATH": "/usr/bin:/bin"},
                    )
                    self.assertEqual(result.stdout.strip(), str(yt_dlp))
                finally:
                    if command_path is not None:
                        command_path.unlink(missing_ok=True)

    @unittest.skipIf(os.name == "nt", "install.sh is a POSIX installer")
    def test_macos_install_pins_install_time_python_in_native_host_shebang(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            root.mkdir()
            for name in ("install.sh",):
                shutil.copy2(ROOT / name, root / name)
            shutil.copytree(ROOT / "bin", root / "bin")
            shutil.copytree(ROOT / "extension", root / "extension")
            (root / "scripts").mkdir()
            for name in ("build-xpi.sh", "build_xpi.py"):
                shutil.copy2(ROOT / "scripts" / name, root / "scripts" / name)
            (root / "dist").mkdir()

            fake_bin = Path(tmp) / "fake-bin"
            fake_bin.mkdir()
            uname = fake_bin / "uname"
            uname.write_text("#!/bin/sh\nprintf 'Darwin\\n'\n", encoding="utf-8")
            uname.chmod(0o755)
            python3 = fake_bin / "python3"
            python3.write_text(
                f"#!/bin/sh\nexec {shlex.quote(sys.executable)} \"$@\"\n",
                encoding="utf-8",
            )
            python3.chmod(0o755)
            environment = os.environ.copy()
            environment.update(
                {
                    "HOME": str(Path(tmp) / "home"),
                    "PATH": os.pathsep.join((str(fake_bin), os.environ["PATH"])),
                }
            )
            completed = subprocess.run(
                ["/bin/bash", str(root / "install.sh"), "--install", "--yes"],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            installed_host = Path(environment["HOME"]) / ".local/bin/yt-dlp-native-host.py"
            self.assertEqual(
                installed_host.read_text(encoding="utf-8").splitlines()[0],
                f"#!{python3}",
            )
            manifest = json.loads(
                (
                    Path(environment["HOME"])
                    / "Library/Application Support/Mozilla/NativeMessagingHosts/firefox_youtube_downloader.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["path"], str(installed_host))

    def test_windows_terminal_and_console_fallback_launches(self):
        wrapper_path = str(ROOT / "bin/yt-dlp-wrapper.py")
        with mock.patch.object(self.host, "_is_windows", return_value=True):
            with mock.patch.object(self.host.sys, "platform", "win32"):
                with mock.patch.object(self.host.shutil, "which", return_value="C:/Windows/wt.exe"):
                    with mock.patch.object(self.host.subprocess, "Popen") as popen:
                        self.host._launch_download("video", "https://youtu.be/abc")
                self.assertEqual(
                    popen.call_args.args[0],
                    ["C:/Windows/wt.exe", sys.executable, wrapper_path, "--wait-keypress", "video", "https://youtu.be/abc"],
                )
                self.assertEqual(popen.call_args.kwargs["stdin"], subprocess.DEVNULL)

                with mock.patch.object(self.host.shutil, "which", return_value=None):
                    with mock.patch.object(self.host.subprocess, "Popen") as popen:
                        self.host._launch_download("audio", "https://youtu.be/abc")
                self.assertEqual(
                    popen.call_args.args[0],
                    [sys.executable, wrapper_path, "--wait-keypress", "audio", "https://youtu.be/abc"],
                )
                self.assertEqual(
                    popen.call_args.kwargs["creationflags"],
                    getattr(subprocess, "CREATE_NEW_CONSOLE", 0x10),
                )


class WindowsInstallerTests(unittest.TestCase):
    @staticmethod
    def _fake_winreg(registry_values):
        class FakeRegistry:
            HKEY_CURRENT_USER = object()
            KEY_WRITE = 2
            REG_SZ = 1

            @staticmethod
            def CreateKeyEx(root, key, reserved, access):
                registry_values["key"] = key
                registry_values["access"] = access
                return object()

            @staticmethod
            def SetValueEx(handle, name, reserved, value_type, value):
                registry_values["value"] = value
                registry_values["value_type"] = value_type

            @staticmethod
            def CloseKey(_handle):
                registry_values["closed"] = True

        return FakeRegistry

    def test_install_py_default_is_dry_run(self):
        installer = load_script(self, "windows_installer_dry", "install.py")
        with tempfile.TemporaryDirectory() as tmp:
            env = {"LOCALAPPDATA": str(Path(tmp) / "Local"), "APPDATA": str(Path(tmp) / "Roaming")}
            xpi = ROOT / "dist/huginn-firefox.xpi"
            xpi_before = xpi.read_bytes() if xpi.exists() else None
            with mock.patch.dict(os.environ, env, clear=True):
                with mock.patch.object(installer, "_is_windows", return_value=True):
                    with mock.patch("sys.stdout", new_callable=io.StringIO):
                        result = installer.main([])
            self.assertEqual(result, 0)
            self.assertFalse(Path(env["LOCALAPPDATA"]).exists())
            self.assertEqual(xpi.read_bytes() if xpi.exists() else None, xpi_before)

    def test_failed_windows_install_does_not_save_partial_config(self):
        installer = load_script(self, "windows_installer_failure", "install.py")
        with tempfile.TemporaryDirectory() as tmp:
            environment = {
                "LOCALAPPDATA": str(Path(tmp) / "Local"),
                "APPDATA": str(Path(tmp) / "Roaming"),
                "HOME": str(Path(tmp) / "home"),
            }
            config_path = ytdl_config.config_path(environment, "nt")
            with mock.patch.dict(os.environ, environment, clear=True):
                with mock.patch.object(installer, "_is_windows", return_value=True):
                    with mock.patch.object(installer, "_register_native_host"):
                        with mock.patch.object(
                            installer.subprocess,
                            "run",
                            side_effect=subprocess.CalledProcessError(1, ["build_xpi"]),
                        ):
                            result = installer.main(["--install", "--yes"])
            self.assertEqual(result, 1)
            self.assertFalse(config_path.exists())

    def test_simulated_windows_install_writes_trampoline_manifest_registry_config_and_xpi(self):
        installer = load_script(self, "windows_installer", "install.py")
        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "Local"
            roaming = Path(tmp) / "Roaming"
            home = Path(tmp) / "home"
            ytdlp_config = roaming / "yt-dlp/config"
            ytdlp_config.parent.mkdir(parents=True)
            ytdlp_config.write_text("--no-mtime\n", encoding="utf-8")
            original_ytdlp_config = ytdlp_config.read_bytes()
            registry_values = {}
            fake_winreg = self._fake_winreg(registry_values)
            environment = {
                "LOCALAPPDATA": str(local),
                "APPDATA": str(roaming),
                "HOME": str(home),
            }
            with mock.patch.dict(os.environ, environment, clear=True):
                with mock.patch.object(installer, "_is_windows", return_value=True):
                    with mock.patch.dict(sys.modules, {"winreg": fake_winreg}):
                        result = installer.main(["--install", "--yes"])

            self.assertEqual(result, 0)
            app = local / "FirefoxYouTubeDownloader"
            binary_dir = app / "bin"
            for name in ("ytdl_config.py", "ytdl_meta.py", "ytdl_version.py", "yt-dlp-wrapper.py", "yt-dlp-native-host.py"):
                self.assertTrue((binary_dir / name).is_file(), name)
            trampoline = (binary_dir / "yt-dlp-native-host.cmd").read_text(encoding="utf-8")
            self.assertIn("@echo off", trampoline)
            self.assertIn(f'"{sys.executable}" "%~dp0yt-dlp-native-host.py" %*', trampoline)
            manifest_path = app / "firefox_youtube_downloader.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["name"], "firefox_youtube_downloader")
            self.assertEqual(manifest["path"], str(binary_dir / "yt-dlp-native-host.cmd"))
            self.assertEqual(manifest["allowed_extensions"], ["firefox-youtube-downloader@lakis01.github.io"])
            self.assertEqual(registry_values["key"], "Software\\Mozilla\\NativeMessagingHosts\\firefox_youtube_downloader")
            self.assertEqual(registry_values["value"], str(manifest_path))
            self.assertTrue(registry_values["closed"])
            config = json.loads((app / "config.json").read_text(encoding="utf-8"))
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
            self.assertEqual(ytdlp_config.read_bytes(), original_ytdlp_config)
            xpi = ROOT / "dist/huginn-firefox.xpi"
            with zipfile.ZipFile(xpi) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.namelist()[0], "manifest.json")
            with tempfile.TemporaryDirectory() as build_tmp:
                second_xpi = Path(build_tmp) / "same-build.xpi"
                subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/build_xpi.py"),
                        str(ROOT / "extension"),
                        str(second_xpi),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                )
                self.assertEqual(
                    hashlib.sha256(xpi.read_bytes()).digest(),
                    hashlib.sha256(second_xpi.read_bytes()).digest(),
                )

            with mock.patch.dict(os.environ, environment, clear=True):
                with mock.patch.object(installer, "_is_windows", return_value=True):
                    with mock.patch.dict(sys.modules, {"winreg": fake_winreg}):
                        installer.main([
                            "--install", "--yes", "--download-dir=~/Custom",
                            "--auto-tag=false", "--rsgain=true",
                        ])
            self.assertEqual(
                json.loads((app / "config.json").read_text(encoding="utf-8")),
                {
                    "download_dir": "~/Custom",
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
                },
            )


if __name__ == "__main__":
    unittest.main()
