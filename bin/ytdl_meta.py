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
_INSTRUMENT_ROLES = {
    "accordion", "acoustic guitar", "backing vocals", "bass", "bass guitar",
    "cello", "drums", "electric guitar", "guitar", "keyboard", "keyboards",
    "organ", "piano", "saxophone", "strings", "synthesizer", "violin", "vocals",
}
_ART_TRACK_ROLE_LABELS = {
    "composer", "composer lyricist", "composer music", "composition", "lyricist",
    "lyrics", "lyric writer", "writer", "producer", "co-producer",
    "executive producer", "associate producer", "arranger", "conductor",
    "recording engineer", "mixing engineer", "mastering engineer", "engineer",
    "audio engineer", "performer", "associated performer", "artist", "instrument",
} | _INSTRUMENT_ROLES
_ART_TRACK_METADATA_LABELS = {
    "isrc", "genre", "recording date", "recordingdate", "studio", "label",
    "music publisher", "publisher",
}


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
            elif role in _INSTRUMENT_ROLES:
                recognized_roles = True
                _append_unique(credits["instruments"], label_parts[-1].title())
                for person in people:
                    _append_unique(credits["performers"], person)

        if "associated performer" in roles:
            for role in roles:
                if role in _INSTRUMENT_ROLES:
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


def _is_art_track_metadata_line(line):
    if line.startswith(("℗", "©", "Released on:")):
        return True
    if ":" not in line:
        return False

    label = line.split(":", 1)[0].casefold().strip()
    label_parts = [part.strip() for part in label.split(",") if part.strip()]
    if label in _ART_TRACK_METADATA_LABELS or label.startswith("studio personnel"):
        return True
    return any(
        part in _ART_TRACK_ROLE_LABELS or part in _ART_TRACK_METADATA_LABELS
        for part in label_parts
    )


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
        else:
            # Keep the source's co-credit separator instead of inventing a feature.
            display = " · ".join(artist_displays)
        if feature_phrase:
            # Any additional co-credits stay distinct from the explicit feature.
            displayed_entities = _artist_entities(display)
            for entity in artist_entities:
                if entity.casefold() not in {item.casefold() for item in displayed_entities}:
                    display += f" · {entity}"
                    displayed_entities.append(entity)
        _set_artist_metadata(result, display, artist_entities)

    album = ""
    for line in content_lines[title_line_index + 1:] if title_line_index >= 0 else []:
        if _is_art_track_metadata_line(line):
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


_VORBIS_CLEAR_KEYS = frozenset(
    {"description", "purl", "synopsis", "comment", "webpage_url"}
)
_MP4_CLEAR_FREEFORMS = frozenset({
    "----:com.apple.iTunes:DESCRIPTION",
    "----:com.apple.iTunes:PURL",
    "----:com.apple.iTunes:SYNOPSIS",
    "----:com.apple.iTunes:COMMENT",
    "----:com.apple.iTunes:URL",
    "----:com.apple.iTunes:WEBPAGE_URL",
    "----:com.apple.iTunes:ARTISTS",
    "----:com.apple.iTunes:LYRICIST",
    "----:com.apple.iTunes:PRODUCER",
    "----:com.apple.iTunes:ENGINEER",
    "----:com.apple.iTunes:LABEL",
    "----:com.apple.iTunes:ORIGINALDATE",
    "----:com.apple.iTunes:ARRANGER",
    "----:com.apple.iTunes:CONDUCTOR",
    "----:com.apple.iTunes:PERFORMER",
    "----:com.apple.iTunes:PUBLISHER",
    "----:com.apple.iTunes:ISRC",
    "----:com.apple.iTunes:DISTRIBUTOR",
    "----:com.apple.iTunes:RECORDINGDATE",
    "----:com.apple.iTunes:STUDIO",
    "----:com.apple.iTunes:INSTRUMENT",
})
_MP4_CLEAR_ATOMS = frozenset({"desc", "©cmt", "purl", "©url"})


def _cover_image_bytes(thumbnail_path, is_official):
    """Return (data, mime, width, height) for the thumbnail to embed."""
    from PIL import Image

    with Image.open(thumbnail_path) as image:
        frame = image.convert("RGB")
        width, height = frame.size
        if is_official and width > height:
            side = height
            left = (width - side) // 2
            frame = frame.crop((left, 0, left + side, side))
            width, height = frame.size
        import io

        buffer = io.BytesIO()
        frame.save(buffer, "JPEG", quality=90)
        return buffer.getvalue(), "image/jpeg", width, height


def _vorbis_list(meta, *keys):
    values = []
    for key in keys:
        value = meta.get(key)
        if isinstance(value, (list, tuple)):
            for item in value:
                _append_unique(values, str(item))
        elif value:
            for part in str(value).split(";"):
                _append_unique(values, part)
    return values


def _vorbis_single(meta, *keys):
    for key in keys:
        value = meta.get(key)
        if isinstance(value, (list, tuple)):
            cleaned = [str(item).strip() for item in value if str(item).strip()]
            if cleaned:
                return cleaned[0]
        elif str(value or "").strip():
            return str(value).strip()
    return ""


def _tag_vorbis_comments(audio, meta, cover):
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for key in list(tags.keys()):
        if key.lower() in _VORBIS_CLEAR_KEYS:
            del tags[key]

    single_map = {
        "title": _vorbis_single(meta, "title"),
        "artist": _vorbis_single(meta, "artist"),
        "album": _vorbis_single(meta, "album"),
        "albumartist": _vorbis_single(meta, "albumartist"),
        "date": _vorbis_single(meta, "date"),
        "originaldate": _vorbis_single(meta, "originaldate"),
        "recordingdate": _vorbis_single(meta, "recordingdate"),
        "copyright": _vorbis_single(meta, "copyright"),
        "publisher": _vorbis_single(meta, "publisher"),
        "isrc": _vorbis_single(meta, "isrc"),
        "genre": _vorbis_single(meta, "genre"),
        "studio": _vorbis_single(meta, "studio"),
        "label": _vorbis_single(meta, "label"),
        "distributor": _vorbis_single(meta, "distributor"),
    }
    multi_map = {
        "artists": _vorbis_list(meta, "artists"),
        "composer": _vorbis_list(meta, "composers", "composer"),
        "lyricist": _vorbis_list(meta, "lyricists"),
        "producer": _vorbis_list(meta, "producers"),
        "arranger": _vorbis_list(meta, "arrangers"),
        "conductor": _vorbis_list(meta, "conductors"),
        "engineer": _vorbis_list(meta, "engineers"),
        "performer": _vorbis_list(meta, "performers"),
        "instrument": _vorbis_list(meta, "instruments"),
    }
    # A single credited artist lives in `artist`; `artists` is multi-value only.
    # An empty value deletes any stale tag from a previous tagging pass.

    for key, value in single_map.items():
        if value:
            tags[key] = [value]
        elif key in tags:
            del tags[key]
    for key, values in multi_map.items():
        if key == "artists" and len(values) < 2:
            values = []
        if values:
            tags[key] = list(values)
        elif key in tags:
            del tags[key]

    # Re-clear in case the source file stored junk under odd casing.
    for key in list(tags.keys()):
        if key.lower() in _VORBIS_CLEAR_KEYS:
            del tags[key]

    if cover is not None:
        import base64

        from mutagen.flac import Picture

        data, mime, width, height = cover
        picture = Picture()
        picture.type = 3
        picture.mime = mime
        picture.desc = ""
        picture.width = width
        picture.height = height
        picture.data = data
        tags["metadata_block_picture"] = [
            base64.b64encode(picture.write()).decode("ascii")
        ]


def _mp4_freeform(text):
    from mutagen.mp4 import MP4FreeForm

    if isinstance(text, bytes):
        raw = text
    else:
        raw = str(text).encode("utf-8")
    return MP4FreeForm(raw, dataformat=MP4FreeForm.FORMAT_TEXT)


def _tag_mp4_atoms(audio, meta, cover):
    from mutagen.mp4 import MP4Cover

    for key in list(audio.keys()):
        if key in _MP4_CLEAR_ATOMS or key in _MP4_CLEAR_FREEFORMS:
            del audio[key]

    def set_atom(key, value):
        if isinstance(value, (list, tuple)):
            values = [item for item in value if str(item).strip()]
        else:
            values = [value] if value else []
        if values:
            audio[key] = values
        elif key in audio:
            del audio[key]

    composers = _vorbis_list(meta, "composers", "composer")
    set_atom("\xa9nam", _vorbis_single(meta, "title"))
    set_atom("\xa9ART", _vorbis_single(meta, "artist"))
    set_atom("\xa9alb", _vorbis_single(meta, "album"))
    set_atom("\xa9day", _vorbis_single(meta, "date"))
    set_atom("aART", _vorbis_single(meta, "albumartist"))
    set_atom("\xa9wrt", composers)
    set_atom("\xa9gen", _vorbis_single(meta, "genre"))
    set_atom("cprt", _vorbis_single(meta, "copyright"))

    freeform_map = {
        "----:com.apple.iTunes:ARTISTS": _vorbis_list(meta, "artists"),
        "----:com.apple.iTunes:LYRICIST": _vorbis_list(meta, "lyricists"),
        "----:com.apple.iTunes:PRODUCER": _vorbis_list(meta, "producers"),
        "----:com.apple.iTunes:ENGINEER": _vorbis_list(meta, "engineers"),
        "----:com.apple.iTunes:LABEL": (
            [_vorbis_single(meta, "label")] if _vorbis_single(meta, "label") else []
        ),
        "----:com.apple.iTunes:ORIGINALDATE": (
            [_vorbis_single(meta, "originaldate")]
            if _vorbis_single(meta, "originaldate")
            else []
        ),
        "----:com.apple.iTunes:ARRANGER": _vorbis_list(meta, "arrangers"),
        "----:com.apple.iTunes:CONDUCTOR": _vorbis_list(meta, "conductors"),
        "----:com.apple.iTunes:PERFORMER": _vorbis_list(meta, "performers"),
        "----:com.apple.iTunes:PUBLISHER": (
            [_vorbis_single(meta, "publisher")]
            if _vorbis_single(meta, "publisher")
            else []
        ),
        "----:com.apple.iTunes:DISTRIBUTOR": (
            [_vorbis_single(meta, "distributor")]
            if _vorbis_single(meta, "distributor")
            else []
        ),
        "----:com.apple.iTunes:ISRC": (
            [_vorbis_single(meta, "isrc")] if _vorbis_single(meta, "isrc") else []
        ),
        "----:com.apple.iTunes:RECORDINGDATE": (
            [_vorbis_single(meta, "recordingdate")]
            if _vorbis_single(meta, "recordingdate")
            else []
        ),
        "----:com.apple.iTunes:STUDIO": (
            [_vorbis_single(meta, "studio")] if _vorbis_single(meta, "studio") else []
        ),
        "----:com.apple.iTunes:INSTRUMENT": _vorbis_list(meta, "instruments"),
    }
    if len(freeform_map["----:com.apple.iTunes:ARTISTS"]) < 2:
        freeform_map["----:com.apple.iTunes:ARTISTS"] = []
    for key, values in freeform_map.items():
        if values:
            audio[key] = [_mp4_freeform(value) for value in values]
        elif key in audio:
            del audio[key]

    if cover is not None:
        data, _, _, _ = cover
        audio["covr"] = [
            MP4Cover(data, imageformat=MP4Cover.FORMAT_JPEG)
        ]


def _tag_id3_frames(audio, meta, cover):
    from mutagen.id3 import APIC, TCOM, TCON, TCOP, TDOR, TDRC, TEXT, TIT2, TSRC
    from mutagen.id3 import TIPL, TPE1, TPE2, TALB, TPUB, TXXX

    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for frame in list(tags.getall("COMM")):
        del tags[frame.HashKey]
    for frame_id in (
        "WXXX", "WCOM", "WCOP", "WOAF", "WOAR", "WOAS", "WORS", "WPAY",
        "WPUB", "WFED",
    ):
        tags.delall(frame_id)

    user_descriptions = {
        "ARTISTS", "LABEL", "DISTRIBUTOR", "RECORDINGDATE", "STUDIO", "INSTRUMENT",
        "DESCRIPTION", "URL", "SYNOPSIS", "COMMENT", "PURL", "WEBPAGE_URL",
    }
    for frame in list(tags.getall("TXXX")):
        if str(frame.desc).strip().upper() in user_descriptions:
            del tags[frame.HashKey]

    def set_text(frame_class, value):
        tags.delall(frame_class.__name__)
        if value:
            text = list(value) if isinstance(value, (list, tuple)) else [value]
            tags.add(frame_class(encoding=3, text=text))

    def set_user_text(description, values):
        values = [str(value).strip() for value in values if str(value).strip()]
        if values:
            tags.add(TXXX(encoding=3, desc=description, text=values))

    artists = _vorbis_list(meta, "artists")
    involved = [["producer", name] for name in _vorbis_list(meta, "producers")]
    involved += [["arranger", name] for name in _vorbis_list(meta, "arrangers")]
    involved += [["conductor", name] for name in _vorbis_list(meta, "conductors")]
    involved += [["engineer", name] for name in _vorbis_list(meta, "engineers")]
    involved += [["performer", name] for name in _vorbis_list(meta, "performers")]
    set_text(TIT2, _vorbis_single(meta, "title"))
    set_text(TPE1, _vorbis_single(meta, "artist"))
    set_text(TALB, _vorbis_single(meta, "album"))
    set_text(TPE2, _vorbis_single(meta, "albumartist"))
    set_text(TDRC, _vorbis_single(meta, "date"))
    set_text(TDOR, _vorbis_single(meta, "originaldate"))
    set_text(TCOM, _vorbis_list(meta, "composers", "composer"))
    set_text(TEXT, _vorbis_list(meta, "lyricists"))
    set_text(TPUB, _vorbis_single(meta, "publisher"))
    set_text(TCON, _vorbis_single(meta, "genre"))
    set_text(TCOP, _vorbis_single(meta, "copyright"))
    set_text(TSRC, _vorbis_single(meta, "isrc"))
    tags.delall("TIPL")
    if involved:
        tags.add(TIPL(encoding=3, people=involved))
    if len(artists) >= 2:
        set_user_text("ARTISTS", artists)
    user_fields = {
        "LABEL": _vorbis_single(meta, "label"),
        "DISTRIBUTOR": _vorbis_single(meta, "distributor"),
        "RECORDINGDATE": _vorbis_single(meta, "recordingdate"),
        "STUDIO": _vorbis_single(meta, "studio"),
    }
    for description, value in user_fields.items():
        set_user_text(description, [value] if value else [])
    set_user_text("INSTRUMENT", _vorbis_list(meta, "instruments"))
    if cover is not None:
        data, mime, _, _ = cover
        tags.delall("APIC:")
        tags.add(
            APIC(encoding=3, mime=mime, type=3, desc="", data=data)
        )


def tag_audio_file(filepath, meta, thumbnail_path=None) -> None:
    """Write container-native music tags and front-cover art in place."""
    import os

    suffix = os.path.splitext(str(filepath))[1].lower()
    cover = None
    if thumbnail_path:
        cover = _cover_image_bytes(thumbnail_path, bool((meta or {}).get("is_tagged")))

    if suffix == ".opus":
        from mutagen.oggopus import OggOpus

        audio = OggOpus(filepath)
        _tag_vorbis_comments(audio, meta or {}, cover)
        audio.save()
    elif suffix == ".ogg":
        from mutagen.oggvorbis import OggVorbis

        audio = OggVorbis(filepath)
        _tag_vorbis_comments(audio, meta or {}, cover)
        audio.save()
    elif suffix in {".m4a", ".mp4", ".m4b"}:
        from mutagen.mp4 import MP4

        audio = MP4(filepath)
        _tag_mp4_atoms(audio, meta or {}, cover)
        audio.save()
    elif suffix == ".mp3":
        from mutagen.mp3 import MP3

        audio = MP3(filepath)
        _tag_id3_frames(audio, meta or {}, cover)
        audio.save()
    else:
        raise ValueError(f"Unsupported audio container: {filepath!r}")
