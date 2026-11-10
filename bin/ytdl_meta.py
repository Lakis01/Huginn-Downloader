"""Parse yt-dlp metadata and YouTube Music Art Track descriptions."""

from datetime import date as calendar_date
import re


_DATE_PATTERN = re.compile(r"\d{4}(?:-\d{2}(?:-\d{2})?)?")
_FEATURE_PATTERN = re.compile(
    r"(?i)(?:^|[\s(\[])(feat(?:uring)?\.?|ft\.?)\s+(.+?)\s*[)\]]*\s*$"
)
_UNSAFE_FILENAME_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_CLEAN_SUFFIX_PATTERNS = (
    re.compile(
        r"\s*[\[(]\s*(?:official\s+)?(?:music\s+video|lyric(?:s)?\s+video|"
        r"lyric(?:s)?|audio|visuali[sz]er|4k|8k|1080p|720p)\s*[\])]\s*$",
        re.IGNORECASE,
    ),
    re.compile(r"\s+\[?(?:4k|8k|1080p|720p)\]?\s*$", re.IGNORECASE),
)


def _normalize_date(value):
    """Return a valid YYYY, YYYY-MM, or YYYY-MM-DD date, or an empty string."""
    match = _DATE_PATTERN.fullmatch(str(value).strip())
    if not match:
        return ""

    normalized = match.group(0)
    parts = [int(part) for part in normalized.split("-")]
    try:
        if len(parts) == 1:
            calendar_date(parts[0], 1, 1)
        elif len(parts) == 2:
            calendar_date(parts[0], parts[1], 1)
        else:
            calendar_date(*parts)
    except ValueError:
        return ""
    return normalized


def _date_from_info(value):
    """Normalize yt-dlp upload dates, including its compact YYYYMMDD form."""
    text = str(value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return _normalize_date(text)


def _append_unique(values, value):
    value = str(value).strip()
    if value and value.casefold() not in {item.casefold() for item in values}:
        values.append(value)


def _extract_feature(text):
    """Remove a trailing featuring credit and return its name and wording."""
    match = _FEATURE_PATTERN.search(text)
    if not match:
        return text.strip(), "", ""

    prefix = text[:match.start()].rstrip(" ([").strip()
    name = match.group(2).strip().rstrip(")] ").strip()
    if not name:
        return text.strip(), "", ""
    return prefix, name, f"{match.group(1)} {name}"


def _clean_title(text):
    title = text.strip()
    previous = None
    while title and previous != title:
        previous = title
        for pattern in _CLEAN_SUFFIX_PATTERNS:
            title = pattern.sub("", title).strip()
    return title.rstrip(" .")


def _artist_entities(display):
    """Split only explicit featuring phrasing; ampersands/and remain intact."""
    base, feature, _ = _extract_feature(display)
    if feature:
        return [name for name in (base, feature) if name]
    return [display.strip()] if display.strip() else []


def _clean_channel(value):
    name = str(value or "").strip()
    name = re.sub(r"\s+-\s+Topic$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+VEVO$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+-\s+Official Artist Channel$", "", name, flags=re.IGNORECASE)
    return name.strip()


def _parse_artists_from_title(title):
    """Read a conventional leading ``Artist - Title`` fallback form."""
    match = re.match(r"^(.+?)\s+-\s+(.+)$", title.strip())
    if not match:
        return "", title.strip()
    return match.group(1).strip(), match.group(2).strip()


def _description_credits(lines):
    credits = {
        "composers": [],
        "lyricists": [],
        "producers": [],
        "arrangers": [],
        "conductors": [],
        "engineers": [],
        "performers": [],
        "instruments": [],
    }
    publisher_values = []
    explicit_label = ""
    isrc = ""
    genre = ""
    recordingdate = ""
    studio = ""
    copyright_lines = []
    p_line = ""

    instrument_roles = {
        "accordion", "acoustic guitar", "backing vocals", "bass", "bass guitar",
        "cello", "drums", "electric guitar", "guitar", "keyboard", "keyboards",
        "organ", "piano", "saxophone", "strings", "synthesizer", "violin", "vocals",
    }

    for line in lines:
        stripped = line.strip()
        lower = stripped.casefold()
        if lower.startswith("℗") or lower.startswith("©"):
            _append_unique(copyright_lines, stripped)
            if lower.startswith("℗") and not p_line:
                p_line = stripped
            continue

        if ":" not in stripped:
            continue
        label, raw_value = stripped.split(":", 1)
        label_parts = [part.strip() for part in label.split(",") if part.strip()]
        value = raw_value.strip()
        if not value:
            continue

        primary_label = label_parts[-1].casefold() if label_parts else ""
        if primary_label == "isrc":
            isrc = value
            continue
        if primary_label == "genre":
            genre = value
            continue
        if primary_label in {"recording date", "recordingdate"}:
            recordingdate = _normalize_date(value) or value
            continue
        if primary_label == "studio":
            studio = value
            continue
        if primary_label == "label":
            explicit_label = value
            continue
        if primary_label in {"music publisher", "publisher"}:
            _append_unique(publisher_values, value)
            continue

        roles = [part.casefold() for part in label_parts]
        if "composer lyricist" in roles:
            roles.extend(("composer", "lyricist"))
        if "composer music" in roles:
            roles.append("composer")
        people = re.split(r"\s*;\s*|\s+\|\s+", value)
        people = [person.strip() for person in people if person.strip()]

        if "writer" in roles:
            people = [re.split(r"\s{2,}", person, maxsplit=1)[0].strip() for person in people]
            for person in people:
                _append_unique(credits["composers"], person)

        recognized_roles = False
        for role in roles:
            if role in {"composer", "composer music", "composition"}:
                recognized_roles = True
                for person in people:
                    _append_unique(credits["composers"], person)
            elif role in {"lyricist", "lyrics", "lyric writer"}:
                recognized_roles = True
                for person in people:
                    _append_unique(credits["lyricists"], person)
            elif role in {"producer", "co-producer", "executive producer", "associate producer"}:
                recognized_roles = True
                for person in people:
                    _append_unique(credits["producers"], person)
            elif role == "arranger":
                recognized_roles = True
                for person in people:
                    _append_unique(credits["arrangers"], person)
            elif role == "conductor":
                recognized_roles = True
                for person in people:
                    _append_unique(credits["conductors"], person)
            elif role in {
                "recording engineer", "mixing engineer", "mastering engineer",
                "engineer", "audio engineer",
            }:
                recognized_roles = True
                for person in people:
                    _append_unique(credits["engineers"], person)
            elif role in {"performer", "associated performer", "artist"}:
                recognized_roles = True
                for person in people:
                    _append_unique(credits["performers"], person)
            elif role == "instrument":
                recognized_roles = True
                for instrument in people:
                    _append_unique(credits["instruments"], instrument)
            elif role in instrument_roles:
                recognized_roles = True
                _append_unique(credits["instruments"], label_parts[-1].title())
                for person in people:
                    _append_unique(credits["performers"], person)

        if "associated performer" in roles:
            for role in roles:
                if role in instrument_roles:
                    _append_unique(credits["instruments"], role.title())
        if "writer" in roles:
            recognized_roles = True
        # Studio Personnel is a prefix used with an actual role, not a credit itself.
        if not recognized_roles:
            continue

    label = explicit_label
    if not label and p_line:
        match = re.match(r"℗\s*\d{4}\s*(.*)$", p_line)
        if match:
            label = match.group(1).strip()

    return {
        **credits,
        "publisher": "; ".join(publisher_values),
        "isrc": isrc,
        "genre": genre,
        "recordingdate": recordingdate,
        "studio": studio,
        "copyright": "; ".join(copyright_lines),
        "label": label,
        "p_year": re.search(r"℗\s*(\d{4})", p_line).group(1)
        if re.search(r"℗\s*(\d{4})", p_line)
        else "",
    }


def _default_metadata(info, title):
    return {
        "artist": "",
        "title": title,
        "album": "",
        "date": "",
        "composer": "",
        "is_tagged": False,
        "duration": info.get("duration", 0),
        "artists": [],
        "albumartist": "",
        "originaldate": "",
        "label": "",
        "copyright": "",
        "distributor": "",
        "publisher": "",
        "isrc": "",
        "genre": "",
        "recordingdate": "",
        "studio": "",
        "composers": [],
        "lyricists": [],
        "producers": [],
        "arrangers": [],
        "conductors": [],
        "engineers": [],
        "performers": [],
        "instruments": [],
    }


def _set_artist_metadata(result, display, entities):
    for entity in entities:
        _append_unique(result["artists"], entity)
    result["artist"] = display
    if result["artists"]:
        result["albumartist"] = result["artists"][0]


def _parse_art_track(info, result, description):
    lines = [line.strip() for line in description.splitlines() if line.strip()]
    distributor_match = re.search(r"Provided to YouTube by\s+([^\r\n]+)", description)
    if distributor_match:
        result["distributor"] = distributor_match.group(1).strip()

    auto_index = next(
        (index for index, line in enumerate(lines) if line.startswith("Auto-generated by YouTube.")),
        len(lines),
    )
    content_lines = lines[:auto_index]
    title_line_index = next(
        (index for index, line in enumerate(content_lines) if " · " in line),
        -1,
    )
    title_line = content_lines[title_line_index] if title_line_index >= 0 else ""
    if title_line:
        title_parts = [part.strip() for part in title_line.split(" · ")]
        raw_title = title_parts[0]
        raw_artist_entries = [part for part in title_parts[1:] if part]
    else:
        raw_title = str(info.get("title") or "")
        raw_artist_entries = []

    track_title, featured_name, feature_phrase = _extract_feature(_clean_title(raw_title))
    result["title"] = _clean_title(track_title)

    artist_entities = []
    artist_displays = []
    for entry in raw_artist_entries:
        artist_displays.append(entry)
        for entity in _artist_entities(entry):
            _append_unique(artist_entities, entity)
    if featured_name:
        _append_unique(artist_entities, featured_name)

    if artist_displays:
        primary_display = artist_displays[0]
        primary_entities = _artist_entities(primary_display)
        primary = primary_entities[0] if primary_entities else primary_display
        if feature_phrase:
            display = f"{primary} {feature_phrase}"
        elif len(artist_entities) > 1:
            display = f"{primary} feat. {' feat. '.join(artist_entities[1:])}"
        else:
            display = primary_display
        # Any additional credited entities not already in the display remain visible.
        displayed_entities = _artist_entities(display)
        for entity in artist_entities:
            if entity.casefold() not in {item.casefold() for item in displayed_entities}:
                display += f" feat. {entity}"
                displayed_entities.append(entity)
        _set_artist_metadata(result, display, artist_entities)

    album = ""
    for line in content_lines[title_line_index + 1:] if title_line_index >= 0 else []:
        if line.startswith(("℗", "©", "Released on:")):
            continue
        if ":" in line and line.split(":", 1)[0].casefold() in {
            "composer", "composer, lyricist", "composer lyricist", "composer music", "writer",
            "producer", "lyricist", "isrc", "genre", "studio", "recording date",
        }:
            continue
        album = line
        break
    result["album"] = album

    release_match = re.search(r"(?im)^\s*Released on:\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?)", description)
    release_date = _normalize_date(release_match.group(1)) if release_match else ""
    role_data = _description_credits(content_lines)
    result.update({key: role_data[key] for key in (
        "composers", "lyricists", "producers", "arrangers", "conductors",
        "engineers", "performers", "instruments", "publisher", "isrc", "genre",
        "recordingdate", "studio", "copyright", "label",
    )})

    copyright_year = role_data["p_year"]
    result["date"] = release_date or copyright_year
    if release_date and copyright_year and int(copyright_year) < int(release_date[:4]):
        result["originaldate"] = copyright_year
    result["composer"] = "; ".join(result["composers"])
    result["is_tagged"] = True


def _parse_fallback(info, result):
    title = str(info.get("title") or "")
    artist_from_title, title = _parse_artists_from_title(title)
    title, featured_name, feature_phrase = _extract_feature(_clean_title(title))
    result["title"] = _clean_title(title)

    channel = _clean_channel(info.get("channel"))
    uploader = _clean_channel(info.get("uploader"))
    main_artist = artist_from_title or channel or uploader

    if artist_from_title:
        artist_base, feature_from_artist, phrase_from_artist = _extract_feature(artist_from_title)
        display = artist_from_title
        entities = _artist_entities(artist_from_title)
        if feature_from_artist:
            feature_phrase = phrase_from_artist
            featured_name = feature_from_artist
            main_artist = artist_base
    else:
        display = main_artist
        entities = [main_artist] if main_artist else []

    if featured_name:
        if not feature_phrase:
            feature_phrase = f"feat. {featured_name}"
        display = f"{main_artist} {feature_phrase}".strip()
        _append_unique(entities, featured_name)
    if display:
        _set_artist_metadata(result, display, entities)

    upload_date = _date_from_info(info.get("upload_date"))
    if not upload_date:
        upload_date = _date_from_info(info.get("release_date"))
    result["date"] = upload_date


def parse_info(info: dict) -> dict:
    """Return backward-compatible fields and structured music metadata."""
    info = info or {}
    initial_title = str(info.get("title") or "")
    result = _default_metadata(info, initial_title)
    description = str(info.get("description") or "")

    is_art_track = (
        "Provided to YouTube by" in description
        and "Auto-generated by YouTube." in description
    )
    if is_art_track:
        _parse_art_track(info, result, description)
    else:
        _parse_fallback(info, result)
    return result


def sanitize_filename(text: str) -> str:
    """Replace path/control characters and remove unsafe trailing dots/spaces."""
    safe = _UNSAFE_FILENAME_PATTERN.sub("_", str(text))
    safe = re.sub(r"\s+", " ", safe).rstrip(". ")
    return safe or "untitled"
