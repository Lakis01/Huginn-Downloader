import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class KWalletSigningTests(unittest.TestCase):
    @staticmethod
    def _install_kwallet_stub(stub_dir: Path) -> None:
        stub_dir.mkdir(parents=True)
        script = stub_dir / "kwallet-query"
        script.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "with open(os.environ['KWALLET_CALLS'], 'a', encoding='utf-8') as log:\n"
            "    log.write(json.dumps(args) + '\\n')\n"
            "if '--read-password' in args:\n"
            "    entry = args[args.index('--read-password') + 1]\n"
            "    path = pathlib.Path(os.environ['KWALLET_VALUES']) / entry\n"
            "    try:\n"
            "        value = path.read_bytes()\n"
            "    except FileNotFoundError:\n"
            "        print(f'Failed to read entry {entry} from wallet')\n"
            "        raise SystemExit(4)\n"
            "    if os.environ.get('KWALLET_ERROR'):\n"
            "        print(os.environ['KWALLET_ERROR'])\n"
            "        raise SystemExit(int(os.environ.get('KWALLET_EXIT_CODE', '2')))\n"
            "    sys.stdout.buffer.write(value)\n"
            "else:\n"
            "    raise SystemExit(2)\n",
            encoding="utf-8",
        )
        script.chmod(0o755)

    def test_amo_publishing_keeps_kwallet_guidance_inside_unlisted_steps(self):
        text = (ROOT / "docs/AMO-PUBLISHING.md").read_text(encoding="utf-8")
        section = text.split("## Option A", 1)[1].split("## Option B", 1)[0]
        lines = section.splitlines()
        step_two = next(index for index, line in enumerate(lines) if "2. Wait for the command" in line)
        kwallet = next(index for index, line in enumerate(lines) if "On a KDE workstation" in line)
        step_three = next(index for index, line in enumerate(lines) if "3. Verify it is a valid archive" in line)

        self.assertLess(step_two, kwallet)
        self.assertLess(kwallet, step_three)
        self.assertTrue(lines[kwallet].startswith("    "), "KWallet guidance remains inside step 2")
        self.assertTrue(lines[step_three].startswith(" 3."), "step 3 continues the signing checklist")

    def test_kwallet_signer_passes_credentials_to_signer_without_printing(self):
        issuer = "user:12345:67"
        secret = "jwt secret with $shell; chars and = signs"
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout with spaces"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            if (ROOT / "scripts/sign-xpi-kwallet.sh").is_file():
                sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            stub_signer = scripts_dir / "sign-xpi.sh"
            capture_path = tmp_path / "signer-capture.json"
            stub_signer.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "with open(os.environ['SIGNER_CAPTURE'], 'w', encoding='utf-8') as out:\n"
                "    json.dump({'issuer': os.environ.get('AMO_JWT_ISSUER'), 'secret': os.environ.get('AMO_JWT_SECRET'), 'argv': sys.argv[1:]}, out)\n"
                "print('signed fixture')\n",
                encoding="utf-8",
            )
            stub_signer.chmod(0o755)
            stub_dir = tmp_path / "bin"
            self._install_kwallet_stub(stub_dir)
            values_dir = tmp_path / "wallet-values"
            values_dir.mkdir()
            (values_dir / "AMO_JWT_ISSUER").write_text(issuer, encoding="utf-8")
            (values_dir / "AMO_JWT_SECRET").write_text(secret, encoding="utf-8")
            calls_path = tmp_path / "wallet-calls.jsonl"
            env = os.environ | {
                "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
                "KWALLET_CALLS": str(calls_path),
                "KWALLET_VALUES": str(values_dir),
                "SIGNER_CAPTURE": str(capture_path),
                "HUGINN_AMO_WALLET": "test-wallet",
            }

            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper), "--channel=unlisted", "argument with spaces"],
                text=True,
                capture_output=True,
                env=env,
                cwd=tmp_path,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            captured = json.loads(capture_path.read_text(encoding="utf-8"))
            calls = [json.loads(line) for line in calls_path.read_text().splitlines()]

        self.assertEqual(captured["issuer"], issuer)
        self.assertEqual(captured["secret"], secret)
        self.assertEqual(captured["argv"], ["--channel=unlisted", "argument with spaces"])
        self.assertEqual(
            calls,
            [
                ["--read-password", "AMO_JWT_ISSUER", "--folder", "Huginn Downloader", "test-wallet"],
                ["--read-password", "AMO_JWT_SECRET", "--folder", "Huginn Downloader", "test-wallet"],
            ],
        )
        self.assertNotIn(issuer, result.stdout + result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertNotIn(issuer, " ".join(arg for call in calls for arg in call))
        self.assertNotIn(secret, " ".join(arg for call in calls for arg in call))

    def test_kwallet_signer_fails_closed_when_credentials_are_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            if (ROOT / "scripts/sign-xpi-kwallet.sh").is_file():
                sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            signer = scripts_dir / "sign-xpi.sh"
            signer.write_text("#!/bin/bash\ntouch \"$SIGNER_CALLED\"\n", encoding="utf-8")
            signer.chmod(0o755)
            stub_dir = tmp_path / "bin"
            self._install_kwallet_stub(stub_dir)
            values_dir = tmp_path / "wallet-values"
            values_dir.mkdir()
            (values_dir / "AMO_JWT_SECRET").write_text("fixture-secret", encoding="utf-8")
            signer_called = tmp_path / "signer-called"
            env = os.environ | {
                "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
                "KWALLET_CALLS": str(tmp_path / "wallet-calls.jsonl"),
                "KWALLET_VALUES": str(values_dir),
                "SIGNER_CALLED": str(signer_called),
            }

            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper)],
                text=True,
                capture_output=True,
                env=env,
                cwd=tmp_path,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("KWallet Manager", result.stderr)
        self.assertIn("Huginn Downloader", result.stderr)
        self.assertIn("AMO_JWT_ISSUER", result.stderr)
        self.assertNotIn("setup-amo-credentials-kwallet.sh", result.stderr)
        self.assertFalse(signer_called.exists())
        self.assertNotIn("fixture-secret", result.stdout + result.stderr)
        self.assertNotIn("Failed to read entry", result.stdout + result.stderr)

    def test_kwallet_signer_fails_closed_when_kwallet_query_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            signer_called = tmp_path / "signer-called"
            (scripts_dir / "sign-xpi.sh").write_text(
                "#!/bin/bash\ntouch \"$SIGNER_CALLED\"\n", encoding="utf-8"
            )
            (scripts_dir / "sign-xpi.sh").chmod(0o755)
            stub_dir = tmp_path / "bin"
            stub_dir.mkdir()
            (stub_dir / "dirname").write_text(
                "#!/bin/bash\nprintf '%s\\n' \"$FIXTURE_SCRIPTS\"\n", encoding="utf-8"
            )
            (stub_dir / "pwd").write_text("#!/bin/bash\nbuiltin pwd\n", encoding="utf-8")
            (stub_dir / "dirname").chmod(0o755)
            (stub_dir / "pwd").chmod(0o755)
            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper)],
                text=True,
                capture_output=True,
                env=os.environ | {
                    "PATH": str(stub_dir),
                    "FIXTURE_SCRIPTS": str(scripts_dir),
                    "SIGNER_CALLED": str(signer_called),
                },
                cwd=tmp_path,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("kwallet-query was not found", result.stderr)
        self.assertFalse(signer_called.exists())

    def test_kwallet_signer_rejects_empty_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            signer_called = tmp_path / "signer-called"
            (scripts_dir / "sign-xpi.sh").write_text(
                "#!/bin/bash\ntouch \"$SIGNER_CALLED\"\n", encoding="utf-8"
            )
            (scripts_dir / "sign-xpi.sh").chmod(0o755)
            stub_dir = tmp_path / "bin"
            self._install_kwallet_stub(stub_dir)
            values_dir = tmp_path / "wallet-values"
            values_dir.mkdir()
            (values_dir / "AMO_JWT_ISSUER").write_text("fixture-issuer", encoding="utf-8")
            (values_dir / "AMO_JWT_SECRET").write_text("", encoding="utf-8")
            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper)],
                text=True,
                capture_output=True,
                env=os.environ | {
                    "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
                    "KWALLET_CALLS": str(tmp_path / "wallet-calls.jsonl"),
                    "KWALLET_VALUES": str(values_dir),
                    "SIGNER_CALLED": str(signer_called),
                },
                cwd=tmp_path,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AMO_JWT_SECRET", result.stderr)
        self.assertFalse(signer_called.exists())
        self.assertNotIn("fixture-issuer", result.stdout + result.stderr)

    def test_kwallet_signer_fails_closed_when_wallet_is_locked(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            signer_called = tmp_path / "signer-called"
            (scripts_dir / "sign-xpi.sh").write_text(
                "#!/bin/bash\ntouch \"$SIGNER_CALLED\"\n", encoding="utf-8"
            )
            (scripts_dir / "sign-xpi.sh").chmod(0o755)
            stub_dir = tmp_path / "bin"
            self._install_kwallet_stub(stub_dir)
            values_dir = tmp_path / "wallet-values"
            values_dir.mkdir()
            (values_dir / "AMO_JWT_ISSUER").write_text("fixture-issuer", encoding="utf-8")
            (values_dir / "AMO_JWT_SECRET").write_text("fixture-secret", encoding="utf-8")

            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper)],
                text=True,
                capture_output=True,
                env=os.environ | {
                    "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
                    "KWALLET_CALLS": str(tmp_path / "wallet-calls.jsonl"),
                    "KWALLET_VALUES": str(values_dir),
                    "KWALLET_ERROR": "KWallet is locked",
                    "KWALLET_EXIT_CODE": "2",
                    "SIGNER_CALLED": str(signer_called),
                },
                cwd=tmp_path,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("KWallet Manager", result.stderr)
        self.assertFalse(signer_called.exists())
        self.assertNotIn("KWallet is locked", result.stdout + result.stderr)
        self.assertNotIn("fixture-secret", result.stdout + result.stderr)

    def test_kwallet_signer_propagates_signer_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            repo = tmp_path / "checkout"
            scripts_dir = repo / "scripts"
            scripts_dir.mkdir(parents=True)
            sign_wrapper = scripts_dir / "sign-xpi-kwallet.sh"
            sign_wrapper.write_bytes((ROOT / "scripts/sign-xpi-kwallet.sh").read_bytes())
            (scripts_dir / "sign-xpi.sh").write_text("#!/bin/bash\nexit 23\n", encoding="utf-8")
            (scripts_dir / "sign-xpi.sh").chmod(0o755)
            stub_dir = tmp_path / "bin"
            self._install_kwallet_stub(stub_dir)
            values_dir = tmp_path / "wallet-values"
            values_dir.mkdir()
            (values_dir / "AMO_JWT_ISSUER").write_text("fixture-issuer", encoding="utf-8")
            (values_dir / "AMO_JWT_SECRET").write_text("fixture-secret", encoding="utf-8")
            result = subprocess.run(
                ["/bin/bash", str(sign_wrapper)],
                text=True,
                capture_output=True,
                env=os.environ | {
                    "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
                    "KWALLET_CALLS": str(tmp_path / "wallet-calls.jsonl"),
                    "KWALLET_VALUES": str(values_dir),
                },
                cwd=tmp_path,
            )

        self.assertEqual(result.returncode, 23)
        self.assertNotIn("fixture-secret", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
