#!/usr/bin/env python3
"""Safely patch YouTube apps in a complete External Application Launcher export."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any


APP_ARGUMENTS = {
    "audio": 'audio "[PRE_SCRIPT]" "[HREF]"',
    "video": 'video "[PRE_SCRIPT]" "[HREF]"',
    "cut": 'cut "[PRE_SCRIPT]" "[HREF]"',
}
TARGET_APPS = {
    "Download YouTube Audio": "audio",
    "Download YouTube Video": "video",
    "Cut YouTube Audio": "cut",
}
YOUTUBE_DOCUMENT_FILTER = (
    "https://www.youtube.com/*, https://music.youtube.com/*"
)
REQUIRED_TOP_LEVEL_KEYS = {"active", "apps", "last-update", "save"}
REQUIRED_APP_KEYS = {
    "icon",
    "name",
    "path",
    "args",
    "pre",
    "post",
    "toolbar",
    "context",
    "pattern",
    "filters",
}


class SettingsPatchError(ValueError):
    """Raised when input is not a complete export with unique target apps."""


def patch_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Return a patched copy, changing only args, pattern, and filters on targets."""
    if not isinstance(settings, dict):
        raise SettingsPatchError("EAL export must be a JSON object")

    missing_top_level = REQUIRED_TOP_LEVEL_KEYS - settings.keys()
    if missing_top_level:
        missing = ", ".join(sorted(missing_top_level))
        raise SettingsPatchError(f"incomplete EAL export; missing top-level keys: {missing}")
    if not isinstance(settings["active"], str):
        raise SettingsPatchError("incomplete EAL export; 'active' must be a string")
    if not isinstance(settings["apps"], dict):
        raise SettingsPatchError("incomplete EAL export; 'apps' must be an object")
    if isinstance(settings["last-update"], bool) or not isinstance(
        settings["last-update"], (int, float)
    ):
        raise SettingsPatchError("incomplete EAL export; 'last-update' must be a number")
    if not isinstance(settings["save"], str):
        raise SettingsPatchError("incomplete EAL export; 'save' must be a string")

    matches: dict[str, list[tuple[str, dict[str, Any]]]] = {
        name: [] for name in TARGET_APPS
    }
    for app_id, app in settings["apps"].items():
        if not isinstance(app, dict) or not isinstance(app.get("name"), str):
            raise SettingsPatchError(
                f"incomplete EAL export; app {app_id!r} is not a named object"
            )
        if app["name"] in matches:
            matches[app["name"]].append((app_id, app))

    for name, found in matches.items():
        if not found:
            raise SettingsPatchError(f"missing target app: {name}")
        if len(found) > 1:
            raise SettingsPatchError(f"duplicate target app name: {name}")
        missing_fields = REQUIRED_APP_KEYS - found[0][1].keys()
        if missing_fields:
            missing = ", ".join(sorted(missing_fields))
            raise SettingsPatchError(
                f"incomplete target app {name!r}; missing fields: {missing}"
            )

    patched = copy.deepcopy(settings)
    for app_name, mode in TARGET_APPS.items():
        app_id, _ = matches[app_name][0]
        app = patched["apps"][app_id]
        app["args"] = APP_ARGUMENTS[mode]
        app["pattern"] = ""
        app["filters"] = YOUTUBE_DOCUMENT_FILTER
    return patched


def patch_file(source_path: str | Path, output_path: str | Path) -> None:
    """Patch a full export into a new file; never replace an existing output."""
    source = Path(source_path)
    output = Path(output_path)
    with source.open("r", encoding="utf-8") as source_file:
        settings = json.load(source_file)
    patched = patch_settings(settings)

    # Exclusive creation prevents accidental replacement, including a race between
    # an existence check and the actual write.
    with output.open("x", encoding="utf-8") as output_file:
        json.dump(patched, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Patch YouTube apps in a complete EAL settings export."
    )
    parser.add_argument("source", type=Path, help="complete EAL export JSON")
    parser.add_argument("output", type=Path, help="new output path (must not exist)")
    arguments = parser.parse_args(argv)

    try:
        patch_file(arguments.source, arguments.output)
    except (OSError, json.JSONDecodeError, SettingsPatchError) as error:
        print(f"Could not patch EAL settings: {error}", file=sys.stderr)
        return 1
    print(f"Created complete patched EAL export: {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
