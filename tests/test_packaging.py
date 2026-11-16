import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "extension/manifest.json"
PACKAGE_ROOT_SCRIPT = ROOT / "packaging/linux/stage-root.sh"


class LinuxPackageStagingTests(unittest.TestCase):
    def test_system_stage_uses_absolute_native_host_and_desktop_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / "stage"
            result = subprocess.run(
                [
                    "bash", str(PACKAGE_ROOT_SCRIPT), str(ROOT), str(stage),
                    "/usr/lib64/mozilla/native-messaging-hosts",
                ],
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            app_dir = stage / "usr/lib/firefox-youtube-downloader"
            expected_runtime_files = {
                "ytdl_config.py",
                "ytdl_meta.py",
                "ytdl_version.py",
                "yt-dlp-wrapper.py",
                "yt-dlp-shortcut.sh",
                "yt-dlp-native-host.py",
            }
            self.assertEqual({path.name for path in app_dir.iterdir()}, expected_runtime_files)
            self.assertFalse((app_dir / "install-apt-deps.sh").exists())
            manifest_path = stage / "usr/lib64/mozilla/native-messaging-hosts/firefox_youtube_downloader.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["name"], "firefox_youtube_downloader")
            self.assertEqual(manifest["type"], "stdio")
            self.assertEqual(manifest["path"], "/usr/lib/firefox-youtube-downloader/yt-dlp-native-host.py")
            self.assertEqual(
                manifest["allowed_extensions"],
                ["firefox-youtube-downloader@lakis01.github.io"],
            )
            librewolf_manifest = json.loads(
                (stage / "usr/lib64/librewolf/native-messaging-hosts/firefox_youtube_downloader.json").read_text(encoding="utf-8")
            )
            self.assertEqual(librewolf_manifest, manifest)
            for chromium_dir in (
                "etc/chromium/native-messaging-hosts",
                "etc/opt/chrome/native-messaging-hosts",
                "etc/brave/native-messaging-hosts",
                "etc/vivaldi/native-messaging-hosts",
                "etc/opt/edge/native-messaging-hosts",
            ):
                cr_manifest = json.loads(
                    (stage / chromium_dir / "firefox_youtube_downloader.json").read_text(encoding="utf-8")
                )
                self.assertEqual(cr_manifest["name"], "firefox_youtube_downloader")
                self.assertEqual(cr_manifest["path"], "/usr/lib/firefox-youtube-downloader/yt-dlp-native-host.py")
                self.assertEqual(
                    cr_manifest["allowed_origins"],
                    ["chrome-extension://hlekndcccbgmhlablldcddddmknkjomg/"],
                )
            desktop_dir = stage / "usr/share/applications"
            desktop_files = sorted(desktop_dir.glob("*.desktop"))
            self.assertEqual(len(desktop_files), 3)
            desktop_text = "\n".join(path.read_text(encoding="utf-8") for path in desktop_files)
            self.assertIn("Name=Huginn Audio Download", desktop_text)
            self.assertIn("Name=Huginn Video Download", desktop_text)
            self.assertIn("Name=Huginn Interactive Audio Cut", desktop_text)
            self.assertIn("Exec=/usr/lib/firefox-youtube-downloader/yt-dlp-shortcut.sh audio", desktop_text)
            self.assertIn("Exec=/usr/lib/firefox-youtube-downloader/yt-dlp-shortcut.sh video", desktop_text)
            self.assertIn("Exec=/usr/lib/firefox-youtube-downloader/yt-dlp-shortcut.sh cut", desktop_text)
            self.assertNotIn("/home/", desktop_text)
            self.assertNotIn("/.local/", desktop_text)

    def test_deb_builder_requires_only_python_and_suggests_media_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            capture = tmp / "captured-root"
            output_dir = tmp / "out"
            stubs = tmp / "stubs"
            stubs.mkdir()
            fake_dpkg = stubs / "dpkg-deb"
            fake_dpkg.write_text(
                "#!/usr/bin/env python3\n"
                "import os, shutil, sys\n"
                "args=sys.argv[1:]\n"
                "root=args[-2]\n"
                "shutil.copytree(root, os.environ['CAPTURE_ROOT'], dirs_exist_ok=True)\n"
                "open(args[-1], 'wb').write(b'fake package')\n",
                encoding="utf-8",
            )
            fake_dpkg.chmod(0o755)
            env = os.environ | {
                "PATH": f"{stubs}{os.pathsep}{os.environ['PATH']}",
                "CAPTURE_ROOT": str(capture),
            }
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build-deb.sh"), str(output_dir)],
                env=env,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            version = json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]
            tag = f"v{version}"
            package = output_dir / f"huginn-companion_{version}_all.deb"
            self.assertEqual(package.read_bytes(), b"fake package")
            self.assertEqual({path.name for path in (capture / "DEBIAN").iterdir()}, {"control"})
            control = (capture / "DEBIAN/control").read_text(encoding="utf-8")
            self.assertIn("Package: firefox-youtube-downloader-companion", control)
            self.assertIn(f"Version: {version}", control)
            self.assertIn("Architecture: all", control)
            self.assertIn("Depends: python3", control)
            self.assertIn(
                "Suggests: yt-dlp, ffmpeg, python3-mutagen, python3-pil, rsgain",
                control,
            )
            manifest_path = capture / "usr/lib/mozilla/native-messaging-hosts/firefox_youtube_downloader.json"
            self.assertTrue(manifest_path.is_file())
            self.assertEqual(
                json.loads(manifest_path.read_text(encoding="utf-8"))["path"],
                "/usr/lib/firefox-youtube-downloader/yt-dlp-native-host.py",
            )
            self.assertTrue(
                (capture / "usr/lib/firefox-youtube-downloader/install-apt-deps.sh").is_file()
            )

    def test_rpm_builder_emits_python_requirement_and_media_suggestions(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source_tarball = tmp / "source.tar.gz"
            source_tarball.write_bytes(b"source archive fixture\n")
            output_dir = tmp / "out"
            stubs = tmp / "stubs"
            stubs.mkdir()
            fake_rpmbuild = stubs / "rpmbuild"
            fake_rpmbuild.write_text(
                "#!/usr/bin/env python3\n"
                "import os, shutil, sys\n"
                "args=sys.argv[1:]\n"
                "topdir=next(args[i+1].split(' ',1)[1] for i,arg in enumerate(args[:-1]) if arg == '--define' and args[i+1].startswith('_topdir '))\n"
                "spec=args[-1]\n"
                "shutil.copy2(spec, os.environ['CAPTURE_SPEC'])\n"
                "version=os.environ['PACKAGE_VERSION']\n"
                "out=os.path.join(topdir, 'RPMS/noarch/firefox-youtube-downloader-companion-'+version+'-1.noarch.rpm')\n"
                "os.makedirs(os.path.dirname(out), exist_ok=True)\n"
                "open(out, 'wb').write(b'fake rpm')\n",
                encoding="utf-8",
            )
            fake_rpmbuild.chmod(0o755)
            env = os.environ | {
                "PATH": f"{stubs}{os.pathsep}{os.environ['PATH']}",
                "PACKAGE_VERSION": json.loads(MANIFEST.read_text(encoding="utf-8"))["version"],
                "CAPTURE_SPEC": str(tmp / "captured.spec"),
            }
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build-rpm.sh"), str(source_tarball), str(output_dir)],
                env=env,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            version = env["PACKAGE_VERSION"]
            package = output_dir / f"huginn-companion-{version}-1.noarch.rpm"
            self.assertEqual(package.read_bytes(), b"fake rpm")
            spec = (tmp / "captured.spec").read_text(encoding="utf-8")
            self.assertIn("BuildArch:      noarch", spec)
            self.assertIn("Requires:       python3", spec)
            self.assertIn("Suggests:       yt-dlp", spec)
            self.assertIn("Suggests:       ffmpeg-free", spec)
            self.assertIn("Suggests:       python3-mutagen", spec)
            self.assertIn("Suggests:       python3-pillow", spec)
            self.assertIn("Suggests:       rsgain", spec)
            self.assertNotIn("Requires:       yt-dlp", spec)
            self.assertNotIn("Requires:       ffmpeg-free", spec)
            self.assertNotIn("Requires:       rsgain", spec)
            self.assertNotIn("%post", spec)
            self.assertNotIn("%postun", spec)

    def test_arch_recipe_keeps_media_dependencies_optional(self):
        recipe = (ROOT / "packaging/arch/PKGBUILD.in").read_text(encoding="utf-8")
        self.assertIn("depends=('python')", recipe)
        self.assertIn("'yt-dlp: downloader backend'", recipe)
        self.assertIn("'ffmpeg: media conversion and probing'", recipe)
        self.assertIn("'python-mutagen: automatic audio tagging'", recipe)
        self.assertIn("'python-pillow: thumbnail handling'", recipe)
        self.assertIn("'rsgain: optional ReplayGain normalization'", recipe)

    def test_source_tarball_builder_rejects_a_tag_that_disagrees_with_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build-source-tarball.sh"), tmp],
                cwd=ROOT,
                env=os.environ | {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": "v0.0.0"},
                text=True,
                capture_output=True,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match release tag", result.stderr)

    def test_source_tarball_uses_the_committed_version_and_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            committed_manifest = subprocess.check_output(
                ["git", "-C", str(ROOT), "show", "HEAD:extension/manifest.json"],
                text=True,
            )
            committed_version = json.loads(committed_manifest)["version"]
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/build-source-tarball.sh"), tmp],
                cwd=ROOT,
                env=os.environ | {"GITHUB_REF_TYPE": "branch", "GITHUB_REF_NAME": "main"},
                text=True,
                capture_output=True,
            )
            archive_path = Path(tmp) / f"huginn-downloader-{committed_version}-source.tar.gz"

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(archive_path.is_file())
            with tarfile.open(archive_path, "r:gz") as archive:
                manifest_name = next(
                    name for name in archive.getnames()
                    if name.endswith("/extension/manifest.json")
                )
                archived_manifest = json.loads(archive.extractfile(manifest_name).read())

        self.assertEqual(archived_manifest["version"], committed_version)

    @unittest.skipUnless(shutil.which("makepkg"), "Arch makepkg not installed")
    def test_arch_recipe_archive_is_versioned_and_sha_pinned(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source_archive = tmp / "source.tar.gz"
            source_archive.write_bytes(b"tagged source archive fixture\n")
            output_dir = tmp / "out"
            result = subprocess.run(
                [
                    "bash", str(ROOT / "scripts/build-arch-recipe.sh"),
                    str(source_archive), str(output_dir),
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            version = json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]
            recipe_archive = output_dir / f"huginn-downloader-{version}-arch-pkgbuild.tar.gz"
            with tarfile.open(recipe_archive, "r:gz") as archive:
                recipe = archive.extractfile("PKGBUILD").read().decode("utf-8")
                srcinfo = archive.extractfile(".SRCINFO").read().decode("utf-8")
            expected_sha = hashlib.sha256(source_archive.read_bytes()).hexdigest()
            self.assertIn(f"pkgver={version}", recipe)
            self.assertIn(f"sha256sums=('{expected_sha}')", recipe)
            self.assertIn(f"pkgver = {version}", srcinfo)
            self.assertIn(f"sha256sums = {expected_sha}", srcinfo)
            self.assertIn("depends = python", srcinfo)
            self.assertNotIn("\tdepends = yt-dlp\n", srcinfo)
            self.assertIn("optdepends = yt-dlp: downloader backend", srcinfo)
            self.assertIn("optdepends = ffmpeg: media conversion and probing", srcinfo)
            self.assertIn("optdepends = python-mutagen: automatic audio tagging", srcinfo)
            self.assertIn("optdepends = python-pillow: thumbnail handling", srcinfo)
            self.assertIn("optdepends = rsgain", srcinfo)


class ReleaseAssetUploadTests(unittest.TestCase):
    def test_package_assets_upload_only_to_draft_with_signed_xpi(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            stubs = tmp / "stubs"
            stubs.mkdir()
            log = tmp / "gh.log"
            fake_gh = stubs / "gh"
            fake_gh.write_text(
                "#!/usr/bin/env python3\n"
                "import os, sys\n"
                "args=sys.argv[1:]\n"
                "open(os.environ['GH_LOG'], 'a').write(' '.join(args)+'\\n')\n"
                "if args[:2] == ['release', 'view'] and '--json' in args and 'isDraft' in args:\n"
                " print(os.environ.get('GH_DRAFT', 'true'))\n"
                "elif args[:2] == ['release', 'view'] and '--json' in args and 'assets' in args:\n"
                " print(os.environ.get('GH_ASSETS', 'huginn-signed.xpi'))\n"
                "elif args[:2] == ['release', 'upload']:\n"
                " open(os.environ['GH_UPLOAD_LOG'], 'w').write('\\n'.join(os.path.basename(p) for p in args[3:-1]))\n"
                "else:\n"
                " raise SystemExit(2)\n",
                encoding="utf-8",
            )
            fake_gh.chmod(0o755)
            assets = tmp / "assets"
            assets.mkdir()
            version = json.loads(MANIFEST.read_text(encoding="utf-8"))["version"]
            tag = f"v{version}"
            for name in (
                f"huginn-companion_{version}_all.deb",
                f"huginn-companion-{version}-1.noarch.rpm",
                f"huginn-downloader-{version}-source.tar.gz",
                f"huginn-downloader-{version}-arch-pkgbuild.tar.gz",
            ):
                (assets / name).write_bytes(b"fixture")
            (assets / "huginn-firefox.xpi").write_bytes(b"unsigned local build")
            env = os.environ | {
                "PATH": f"{stubs}{os.pathsep}{os.environ['PATH']}",
                "GH_LOG": str(log),
                "GH_UPLOAD_LOG": str(tmp / "uploaded-assets.log"),
                "YTDL_RELEASE_WAIT_ATTEMPTS": "1",
                "YTDL_RELEASE_WAIT_SECONDS": "0",
            }
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/upload-release-packages.sh"), tag, str(assets)],
                env=env,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            calls = log.read_text(encoding="utf-8")
            self.assertIn(f"release view {tag}", calls)
            self.assertIn(f"release upload {tag}", calls)
            self.assertNotIn("release edit", calls)
            uploaded = (tmp / "uploaded-assets.log").read_text(encoding="utf-8").splitlines()
            self.assertEqual(
                set(uploaded),
                {
                    f"huginn-companion_{version}_all.deb",
                    f"huginn-companion-{version}-1.noarch.rpm",
                    f"huginn-downloader-{version}-source.tar.gz",
                    f"huginn-downloader-{version}-arch-pkgbuild.tar.gz",
                },
            )

            log.write_text("", encoding="utf-8")
            env["GH_DRAFT"] = "false"
            published = subprocess.run(
                ["bash", str(ROOT / "scripts/upload-release-packages.sh"), tag, str(assets)],
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(published.returncode, 0)
            self.assertNotIn("release upload", log.read_text(encoding="utf-8"))

            log.write_text("", encoding="utf-8")
            env["GH_DRAFT"] = "true"
            env["GH_ASSETS"] = "unrelated.xpi"
            missing_xpi = subprocess.run(
                ["bash", str(ROOT / "scripts/upload-release-packages.sh"), tag, str(assets)],
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(missing_xpi.returncode, 0)
            self.assertNotIn("release upload", log.read_text(encoding="utf-8"))


class BumpVersionTests(unittest.TestCase):
    def test_bump_version_updates_manifest_host_tests_and_readme_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            for rel in (
                "extension/manifest.json",
                "bin/yt-dlp-native-host.py",
                "tests/test_firefox_extension.js",
                "tests/test_native_host.py",
                "README.md",
            ):
                dst = tmp_root / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / rel, dst)

            old_version = json.loads((tmp_root / "extension/manifest.json").read_text(encoding="utf-8"))["version"]
            major, minor, patch = (int(x) for x in old_version.split("."))
            expected = f"{major}.{minor}.{patch + 1}"

            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/bump_version.py"), "--root", str(tmp_root), "--patch"],
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(result.stdout.strip(), expected)
            self.assertEqual(
                json.loads((tmp_root / "extension/manifest.json").read_text(encoding="utf-8"))["version"],
                expected,
            )
            self.assertIn(f'VERSION = "{expected}"', (tmp_root / "bin/yt-dlp-native-host.py").read_text(encoding="utf-8"))
            self.assertIn(f"huginn-companion_{expected}_all.deb", (tmp_root / "README.md").read_text(encoding="utf-8"))
            self.assertIn(f"manifest.version, '{expected}'", (tmp_root / "tests/test_firefox_extension.js").read_text(encoding="utf-8"))
            self.assertIn(f'HOST.VERSION, "{expected}"', (tmp_root / "tests/test_native_host.py").read_text(encoding="utf-8"))
