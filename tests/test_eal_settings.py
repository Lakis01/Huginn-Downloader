import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "firefox"))
from patch_eal_settings import (  # noqa: E402
    SettingsPatchError,
    patch_file,
    patch_settings,
)


TARGETS = {
    "audio-id": ("Download YouTube Audio", "audio"),
    "video-id": ("Download YouTube Video", "video"),
    "cut-id": ("Cut YouTube Audio", "cut"),
}
EXPECTED_ARGUMENTS = {
    "audio": 'audio "[PRE_SCRIPT]" "[HREF]"',
    "video": 'video "[PRE_SCRIPT]" "[HREF]"',
    "cut": 'cut "[PRE_SCRIPT]" "[HREF]"',
}
EXPECTED_FILTER = "https://www.youtube.com/*, https://music.youtube.com/*"


def full_export():
    apps = {}
    for index, (app_id, (name, mode)) in enumerate(TARGETS.items()):
        apps[app_id] = {
            "icon": f"data:image/png;base64,unique-icon-{index}",
            "errors": True,
            "quotes": False,
            "closeme": False,
            "changestate": "minimize",
            "name": name,
            "path": f"/custom/bin/{mode}",
            "args": f'{mode} "[HREF]"',
            "pre": "document.currentScript.output = location.href;",
            "post": f"post-{mode}",
            "toolbar": True,
            "context": ["page", "frame", "link", "image", "audio", "video"],
            "pattern": "*://*.youtube.com/*",
            "filters": "",
            "redirects": f"redirect-{mode}",
            "index": str(index),
            "vendor-option": {"keep": [index, mode]},
        }
    apps["other-app-id"] = {
        "icon": "data:image/png;base64,other-icon",
        "errors": False,
        "quotes": True,
        "closeme": False,
        "changestate": "none",
        "name": "Unrelated App",
        "path": "/custom/bin/other",
        "args": "--keep-me",
        "pre": "preserve-this-pre-script",
        "post": "preserve-this-post-script",
        "toolbar": False,
        "context": ["link"],
        "pattern": "*",
        "filters": "other-document-filter",
        "redirects": "",
        "index": "3",
        "unrelated": {"preference": 17},
    }
    return {
        "active": "video-id",
        "apps": apps,
        "last-update": 1730000000,
        "save": "options-page-selection",
        "global-preference": {"keep": True},
    }


class PatchSettingsTests(unittest.TestCase):
    def test_changes_only_three_target_fields_and_preserves_full_export(self):
        source = full_export()
        original = copy.deepcopy(source)

        patched = patch_settings(source)

        self.assertEqual(set(patched), set(original))
        self.assertEqual(patched["active"], original["active"])
        self.assertEqual(patched["last-update"], original["last-update"])
        self.assertEqual(patched["save"], original["save"])
        self.assertEqual(patched["global-preference"], original["global-preference"])
        self.assertEqual(set(patched["apps"]), set(original["apps"]))
        for app_id, app in original["apps"].items():
            expected = copy.deepcopy(app)
            if app["name"] in {name for name, _ in TARGETS.values()}:
                mode = next(mode for name, mode in TARGETS.values() if name == app["name"])
                expected["args"] = EXPECTED_ARGUMENTS[mode]
                expected["pattern"] = ""
                expected["filters"] = EXPECTED_FILTER
            self.assertEqual(patched["apps"][app_id], expected)
        self.assertEqual(source, original, "patch_settings must not mutate its input")

    def test_refuses_export_missing_required_top_level_field(self):
        source = full_export()
        del source["save"]

        with self.assertRaises(SettingsPatchError):
            patch_settings(source)

    def test_refuses_export_missing_target_app(self):
        source = full_export()
        del source["apps"]["cut-id"]

        with self.assertRaises(SettingsPatchError):
            patch_settings(source)

    def test_refuses_duplicate_target_app_name(self):
        source = full_export()
        source["apps"]["duplicate-id"] = copy.deepcopy(source["apps"]["audio-id"])

        with self.assertRaises(SettingsPatchError):
            patch_settings(source)

    def test_refuses_unrelated_app_missing_required_core_field(self):
        source = full_export()
        del source["apps"]["other-app-id"]["pre"]

        with self.assertRaisesRegex(SettingsPatchError, "pre"):
            patch_settings(source)

    def test_refuses_unrelated_app_with_invalid_core_field_type(self):
        source = full_export()
        source["apps"]["other-app-id"]["toolbar"] = "enabled"

        with self.assertRaisesRegex(SettingsPatchError, "toolbar"):
            patch_settings(source)

    def test_patch_file_refuses_existing_output_and_does_not_change_source(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            source_path = directory / "full-export.json"
            output_path = directory / "fixed-export.json"
            source = full_export()
            output_path.write_text("user data", encoding="utf-8")
            source_path.write_text(json.dumps(source), encoding="utf-8")

            with self.assertRaises(FileExistsError):
                patch_file(source_path, output_path)

            self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), source)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "user data")


if __name__ == "__main__":
    unittest.main()
