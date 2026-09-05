#!/usr/bin/env python3
"""
build-multimedia-data.py — build a single catalog file describing every photo
and video under a trip's photos/*/, one entry per file.

SHARED SCRIPT — lives once at <travel-journals>/scripts/python/ and is used
by every travel-journal-YYYY-MM-DD/ trip (as of August 2026, this was moved
here from being duplicated inside each trip's own scripts/python/ folder,
keeping the newer of the two copies' logic — see the "subject_inferred"
preservation check in build() below, which the older copy was missing and
which used to silently wipe no-gps-location-resolver results on every
rebuild). Because one copy now serves every trip, the trip to act on is a
required first argument, <journal-folder> (see "USAGE" below), rather than
being inferred from this script's own location the way it used to be.
This script used to import build-photo-maps.py (a per-trip sibling script)
at runtime for a handful of small EXIF/GPS-reading helpers; as of August
2026 that code (IMAGE_EXT/VIDEO_EXT/GENERATED_FILENAMES/DATE_RE,
dms_to_dd(), read_image_gps(), read_video_gps(), discover_folders()) was
extracted and inlined here instead (see "EXIF / GPS reading helpers"
below), so this script now has no dependency on build-photo-maps.py at
all. build-photo-maps.py itself is unaffected — it's still a per-trip
script (clustering, write-up matching, map rendering), one copy per trip,
in that trip's scripts/ folder — it just no longer has anything reading
from it.

For each multimedia file this records:
  - relative_folder   e.g. "photos/2026-07-10"
  - file_name          e.g. "20260710_143210.jpg"
  - file_properties     size, dimensions, file extension, last-modified time
  - multimedia_metadata  EXIF/video metadata: capture timestamp, camera make/
                          model, GPS coordinates (if present), video duration/
                          codec (if ffprobe is available)
  - resolved_location    that file's own GPS coordinates reverse-geocoded
                          over the internet (see "HOW THE LOCATION GETS
                          RESOLVED" below) — not looked up in any local/
                          static file
  - subject               {description, media_analyzed} — what the file
                          actually shows, from Claude looking at (or
                          listening to) it directly, deliberately written
                          WITHOUT reference to resolved_location (see
                          "subject vs. subject_description" below)
  - subject_description   {standard, monty_python} — standard is a
                          description that DOES combine what's visually/
                          aurally in the file with resolved_location;
                          monty_python is the same content rewritten in a
                          deliberately silly Monty-Python-sketch voice

subject and subject_description can't be filled in by a plain script —
same limitation as build-photo-maps.py's write-up research — so, like the
rest of this project's scripts, this is a two-step, Claude-mediated
process; see "WHY THIS IS A TWO-STEP, CLAUDE-MEDIATED SCRIPT" below.

Output: a trip's data/multimedia/multimedia-data.json — one JSON array,
sorted by folder then filename. A small reverse-geocoding cache also lives
alongside it at data/multimedia/geocode-cache.json (see "HOW THE LOCATION
GETS RESOLVED").

WHY THIS IS A TWO-STEP, CLAUDE-MEDIATED SCRIPT
  This script can read files off disk (sizes, EXIF, GPS) and query the
  internet for a coordinate's address on its own, but it has no eyes or
  ears — it cannot look at a photo, watch a video, or listen to audio and
  say what's actually in it. That's Claude's job. So building the full
  catalog is two steps:

    1. Run this script with no extra flags (or --apply-descriptions
       omitted) to (re)build everything it can compute on its own: file
       properties, EXIF/GPS/video metadata, and resolved_location (via
       internet reverse geocoding). This never touches subject or
       subject_description for a file that already has them.
    2. Ask Claude to fill in subject + subject_description. Claude runs
         python3 scripts/python/build-multimedia-data.py <journal-folder> --list-pending
       to see what's still missing (broken down by which of the three
       pieces — subject, the standard description, or the Monty Python
       rewrite — each file needs), opens each file (the Read tool displays
       images/plays media natively), and supplies:
         - subject: a plain description of what's depicted, written
           without naming the place (see below for why)
         - subject_description.standard: a description that DOES combine
           what's depicted with resolved_location
         - subject_description.monty_python: the standard description
           rewritten as a Monty-Python-style bit — silly, digressive,
           self-aware, maybe a stage direction or two — while still being
           recognizably about the same file
       and applies the results with
         python3 scripts/python/build-multimedia-data.py <journal-folder> --apply-descriptions <file>
       which merges just these fields into the existing catalog — file
       properties, metadata, and resolved_location already computed are
       left alone. Any subset of the three pieces can be supplied at once
       (e.g. adding just a monty_python rewrite to a file that already has
       a subject and a standard description).

EDIT MODE (common/daily-gallery.html) AND --remove-files
  common/daily-gallery.html has an "Edit Mode" toggle (added August 2026)
  that shows Edit/Remove controls on every photo/video across all three of
  its views. Since that page is fully static and client-side, it cannot
  write to disk itself — instead it queues edits and removals in the
  browser (localStorage) and, on request, downloads a single
  "pending changes" JSON file shaped like:

      {
        "generatedAt": "...", "trip": "travel-journal-2026-07-01",
        "edits": [ <update object, same shape --apply-descriptions has always
                    taken, plus an optional "move_to_folder": "YYYY-MM-DD"
                    field — set when the file was reassigned to a different
                    day in the browser; triggers physically moving the file
                    into that day's photos/ folder and updating its
                    relative_folder> ],
        "removals": [ {"relative_folder": ..., "file_name": ...}, ... ]
      }

  Both --apply-descriptions and --remove-files accept this combined file
  directly (each reads only the array it cares about and ignores the
  other), or a bare JSON array in their own original shape (for the
  existing Claude-mediated subject/subject_description workflow above,
  which has no removals list at all). Run both in either order on the same
  downloaded file to apply everything queued in the browser:

      python3 scripts/python/build-multimedia-data.py <journal-folder> --apply-descriptions <file>
      python3 scripts/python/build-multimedia-data.py <journal-folder> --remove-files <file>

  --remove-files permanently deletes each listed file from photos/ and
  removes its catalog entry — there is no undo beyond restoring from a
  backup, so review what daily-gallery.html queued before running it.

subject vs. subject_description
  These answer different questions on purpose:
    - subject asks "what's in this file", full stop — no place names, so
      it stays meaningful even for a file resolved_location couldn't
      place (no GPS, or the geocoder was unreachable), and so the two
      fields aren't just paraphrases of each other.
    - subject_description.standard asks "what's in this file, here" —
      the same visual/aural content, now anchored to resolved_location,
      which is the more natural read for a travel journal.
    - subject_description.monty_python is standard, played for laughs.

HOW THE LOCATION GETS RESOLVED
  resolved_location no longer comes from this project's own
  photoMapsData/writeups/*.json (a static, Claude-curated file) — it comes
  from reverse-geocoding each file's own GPS coordinates against
  OpenStreetMap's free Nominatim API (nominatim.openstreetmap.org/reverse)
  over the internet, independently for every file. Results are cached at
  data/multimedia/geocode-cache.json, keyed by coordinates rounded to 4
  decimal places (~11m), both to avoid re-querying the same spot from
  multiple photos and to stay well within Nominatim's usage policy (max 1
  request/second, a descriptive User-Agent, no hammering). Only successful
  lookups are cached — a failed one is retried on the next run rather than
  being remembered as a permanent failure.

  Same limitation as build-photo-maps.py's real map tiles: Claude's own
  tool sandbox cannot reach nominatim.openstreetmap.org (or, going by
  earlier testing in this project, most hosts outside an allowlist), so
  when Claude runs this script itself, every file's resolved_location will
  come back as source "geocode_unavailable" rather than an actual place —
  this is expected, not a bug, and this script says so plainly in its own
  summary output rather than failing silently. Run it yourself, on your
  own machine, for the real geocoded results:

      python3 scripts/python/build-multimedia-data.py <journal-folder>

  Re-running is always safe: files that already resolved successfully
  keep that result (via the coordinate cache) instead of re-querying, and
  files that didn't resolve yet will simply be retried.

REQUIREMENTS
  - Python 3.8+
  - Pillow          pip install Pillow        (for EXIF/GPS reading and image dimensions)
  - ffprobe (optional, only used for video duration/codec) — part of ffmpeg
  - Internet access to nominatim.openstreetmap.org for real resolved_location
    results (see above) — everything else in this script works offline.

USAGE (run from anywhere — <journal-folder> says which trip)
  python3 scripts/python/build-multimedia-data.py <journal-folder>
      Scan every dated folder under <journal-folder>/photos/ and (re)build
      <journal-folder>/data/multimedia/multimedia-data.json, including
      internet reverse geocoding for resolved_location. Existing subject/
      subject_description values are preserved; only structural fields and
      resolved_location are refreshed.

  python3 scripts/python/build-multimedia-data.py <journal-folder> 2026-07-10
      Same, but scoped to a single dated folder.

  python3 scripts/python/build-multimedia-data.py <journal-folder> --list-pending
      Print a human-readable list of every file still missing subject
      and/or subject_description content, noting exactly which of the
      three pieces (subject / standard / monty_python) is missing.

  python3 scripts/python/build-multimedia-data.py <journal-folder> --list-pending --json
      Same, but as JSON (relative_folder, file_name, resolved_location,
      needs_subject, needs_standard, needs_monty_python) for Claude (or a
      script) to consume programmatically -- suppresses all other output.

  python3 scripts/python/build-multimedia-data.py <journal-folder> --apply-descriptions <file>
      Merge Claude-authored subject/subject_description content (or a
      daily-gallery.html Edit Mode "edits" entry, optionally including a
      move_to_folder reassignment) from <file> into the datafile — see
      "EDIT MODE" above for the shape. Only the fields present in each
      update are touched; everything else already in the catalog is left
      as-is.

  python3 scripts/python/build-multimedia-data.py <journal-folder> --remove-files <file>
      Permanently delete the photo/video files listed in <file> (a JSON
      array of {relative_folder, file_name}, or a daily-gallery.html Edit
      Mode pending-changes file's "removals" list — see "EDIT MODE" above)
      and remove their entries from the datafile, then exit.

  <journal-folder> is required in every form above. It resolves two ways,
  tried in order: as a path relative to the current directory (or
  absolute), or as a folder name directly under the travel-journals
  collection root (this script's own grandparent directory), e.g.
  "travel-journal-2026-07-01". If neither resolves to a real directory,
  the script exits with an error listing every travel-journal-YYYY-MM-DD
  folder it can see.

WHERE IT LIVES
    travel-journals/                     <- the collection root (this
      scripts/                              script's own grandparent
        python/                             directory)
          build-multimedia-data.py      <- SHARED, one copy for every trip
          build-multimedia-data_Instructions.txt  <- SHARED
      travel-journal-2026-07-01/        <- one trip
        photos/                         <- source photos/videos, one YYYY-MM-DD folder per day
        data/
          multimedia/
            multimedia-data.json        <- this trip's output
            geocode-cache.json          <- this trip's coordinate -> resolved_location cache
      travel-journal-2026-01-14/        <- another trip, same shape

Nothing under a trip's photos/ is ever read destructively, moved, or
modified — this script only ever writes the two files under that trip's
data/multimedia/ listed above.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    sys.exit("Missing dependency: Pillow. Install it with:  pip install Pillow")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# This script lives at <travel-journals>/scripts/python/, so the collection
# root (the folder holding every travel-journal-YYYY-MM-DD/ trip) is two
# levels up -- same convention as the project's other shared scripts
# (refresh-notes.js, refresh-events.js, resolve_no_gps_locations.py).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COLLECTION_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
TRIP_FOLDER_RE = re.compile(r"^travel-journal-\d{4}-\d{2}-\d{2}$")

# Everything below is resolved once we know which trip we're acting on --
# see configure_for_journal(), called from main() right after argparse.
# Left as None at import time (rather than computed from __file__ the way
# they used to be, back when this script lived inside a single trip's own
# folder) so a bug can't silently point them at the wrong trip.
PROJECT_ROOT = None
MULTIMEDIA_DIR = None
DATAFILE_PATH = None
GEOCODE_CACHE_PATH = None
PHOTOS_ROOT = None


def list_available_trips():
    try:
        entries = os.listdir(COLLECTION_ROOT)
    except OSError:
        return []
    return sorted(
        name for name in entries
        if TRIP_FOLDER_RE.match(name) and os.path.isdir(os.path.join(COLLECTION_ROOT, name))
    )


def resolve_journal_root(arg):
    """Resolve <journal-folder> to a real directory: first as given
    (relative to cwd, or absolute), then as a folder name directly under
    the collection root. Returns None if neither exists."""
    as_given = os.path.abspath(arg)
    if os.path.isdir(as_given):
        return as_given
    under_collection = os.path.join(COLLECTION_ROOT, arg)
    if os.path.isdir(under_collection):
        return under_collection
    return None


def configure_for_journal(journal_root):
    """Sets every path constant for the given trip. Must be called once,
    early in main(), before anything else in this module touches
    PROJECT_ROOT/MULTIMEDIA_DIR/DATAFILE_PATH/GEOCODE_CACHE_PATH/
    PHOTOS_ROOT."""
    global PROJECT_ROOT, MULTIMEDIA_DIR, DATAFILE_PATH, GEOCODE_CACHE_PATH, PHOTOS_ROOT
    PROJECT_ROOT = journal_root
    MULTIMEDIA_DIR = os.path.join(PROJECT_ROOT, "data", "multimedia")
    DATAFILE_PATH = os.path.join(MULTIMEDIA_DIR, "multimedia-data.json")
    GEOCODE_CACHE_PATH = os.path.join(MULTIMEDIA_DIR, "geocode-cache.json")
    PHOTOS_ROOT = os.path.join(PROJECT_ROOT, "photos")


# ---------------------------------------------------------------------------
# EXIF / GPS reading helpers (extracted from build-photo-maps.py, August 2026)
# ---------------------------------------------------------------------------
# This script used to import these from build-photo-maps.py (a per-trip
# sibling script) at runtime. They're inlined here now instead, verbatim
# from that script, so this script has no dependency on build-photo-maps.py
# at all. build-photo-maps.py keeps its own copy of all of this — nothing
# was removed from it, this is a copy, not a move.

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".heic")
VIDEO_EXT = (".mp4", ".mov")
GENERATED_FILENAMES = {"photoLocationDocument.html", "mapPreview.png"}


def dms_to_dd(dms, ref):
    try:
        deg, minu, sec = float(dms[0]), float(dms[1]), float(dms[2])
    except Exception:
        return None
    dd = deg + minu / 60.0 + sec / 3600.0
    if ref in ("S", "W"):
        dd = -dd
    return dd


def read_image_gps(path):
    out = {"has_gps": False, "lat": None, "lon": None, "datetime": None}
    try:
        exif = Image.open(path)._getexif()
    except Exception:
        return out
    if not exif:
        return out
    gps_info = None
    for tag_id, value in exif.items():
        tag = TAGS.get(tag_id, tag_id)
        if tag == "GPSInfo":
            gps_info = {GPSTAGS.get(t, t): v for t, v in value.items()}
        elif tag == "DateTimeOriginal":
            out["datetime"] = str(value)
        elif tag == "DateTime" and not out["datetime"]:
            out["datetime"] = str(value)
    if gps_info and "GPSLatitude" in gps_info and "GPSLongitude" in gps_info:
        lat = dms_to_dd(gps_info["GPSLatitude"], gps_info.get("GPSLatitudeRef", "N"))
        lon = dms_to_dd(gps_info["GPSLongitude"], gps_info.get("GPSLongitudeRef", "E"))
        if lat is not None and lon is not None:
            out.update(has_gps=True, lat=lat, lon=lon)
    return out


def read_video_gps(path):
    out = {"has_gps": False, "lat": None, "lon": None, "datetime": None}
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
            capture_output=True, text=True, timeout=30,
        )
        tags = json.loads(proc.stdout).get("format", {}).get("tags", {})
    except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return out
    ct = tags.get("creation_time")
    if ct:
        try:
            dt = datetime.strptime(ct.split(".")[0], "%Y-%m-%dT%H:%M:%S")
            out["datetime"] = dt.strftime("%Y:%m:%d %H:%M:%S") + " (UTC)"
        except ValueError:
            pass
    loc = tags.get("location") or tags.get("location-eng")
    if loc:
        m = re.match(r"([+-]\d+\.?\d*)([+-]\d+\.?\d*)", loc)
        if m:
            out.update(has_gps=True, lat=float(m.group(1)), lon=float(m.group(2)))
    return out


def discover_folders():
    if not os.path.isdir(PHOTOS_ROOT):
        sys.exit(f"No photos/ folder found next to this script at {PHOTOS_ROOT}")
    return sorted(d for d in os.listdir(PHOTOS_ROOT)
                   if DATE_RE.match(d) and os.path.isdir(os.path.join(PHOTOS_ROOT, d)))


# ---------------------------------------------------------------------------
# File properties
# ---------------------------------------------------------------------------

def file_properties(path):
    stat = os.stat(path)
    props = {
        "extension": os.path.splitext(path)[1].lower(),
        "size_bytes": stat.st_size,
        "width": None,
        "height": None,
        "modified_time": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            .isoformat(timespec="seconds"),
    }
    low = path.lower()
    if low.endswith(IMAGE_EXT):
        try:
            with Image.open(path) as im:
                props["width"], props["height"] = im.size
        except Exception:
            pass  # corrupt/unreadable image; leave width/height null rather than fail the whole run
    return props


# ---------------------------------------------------------------------------
# EXIF / video metadata (beyond the GPS + datetime read_image_gps/
# read_video_gps above already extract)
# ---------------------------------------------------------------------------

def image_metadata(path, gps):
    """gps is the dict already returned by read_image_gps(path) — this
    adds the handful of extra EXIF fields useful for a catalog (camera make/
    model, orientation) that build-photo-maps.py itself has no need for."""
    meta = {
        "type": "photo",
        "datetime_original": gps["datetime"],
        "has_gps": gps["has_gps"],
        "latitude": gps["lat"],
        "longitude": gps["lon"],
        "camera_make": None,
        "camera_model": None,
        "orientation": None,
    }
    try:
        exif = Image.open(path)._getexif()
    except Exception:
        exif = None
    if exif:
        for tag_id, value in exif.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "Make":
                meta["camera_make"] = str(value).strip() or None
            elif tag == "Model":
                meta["camera_model"] = str(value).strip() or None
            elif tag == "Orientation":
                meta["orientation"] = value
    return meta


def video_metadata(path, gps):
    """gps is the dict already returned by read_video_gps(path). Adds
    duration/codec/resolution via ffprobe when it's on PATH; silently leaves
    them null otherwise (mirrors build-photo-maps.py's own "skip, don't
    fail" handling of a missing ffprobe)."""
    meta = {
        "type": "video",
        "datetime_original": gps["datetime"],
        "has_gps": gps["has_gps"],
        "latitude": gps["lat"],
        "longitude": gps["lon"],
        "duration_seconds": None,
        "codec": None,
        "video_width": None,
        "video_height": None,
    }
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=30,
        )
        info = json.loads(proc.stdout)
    except (FileNotFoundError, subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return meta
    fmt = info.get("format", {})
    if fmt.get("duration"):
        try:
            meta["duration_seconds"] = round(float(fmt["duration"]), 1)
        except ValueError:
            pass
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            meta["codec"] = stream.get("codec_name")
            meta["video_width"] = stream.get("width")
            meta["video_height"] = stream.get("height")
            break
    return meta


# ---------------------------------------------------------------------------
# Resolved location — per-file internet reverse geocoding (Nominatim)
# ---------------------------------------------------------------------------

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_USER_AGENT = "travelJournal-build-multimedia-data/1.0 (personal travel-journal project)"
NOMINATIM_RATE_LIMIT_SECONDS = 1.0  # Nominatim usage policy: max 1 request/second

# Set to True the first time a network call fails, so the rest of a single
# run fails fast instead of retrying (and waiting out timeouts) once per
# file — see "HOW THE LOCATION GETS RESOLVED" in the module docstring for
# why this is the expected outcome inside Claude's own tool sandbox.
_network_unavailable = False


def _load_geocode_cache():
    if not os.path.exists(GEOCODE_CACHE_PATH):
        return {}
    with open(GEOCODE_CACHE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _save_geocode_cache(cache):
    os.makedirs(MULTIMEDIA_DIR, exist_ok=True)
    with open(GEOCODE_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def _cache_key(lat, lon):
    return f"{round(lat, 4)},{round(lon, 4)}"


def reverse_geocode(lat, lon, cache):
    """Look up (lat, lon) via Nominatim's reverse-geocoding API. Returns a
    {location_label, place_full, country} dict on success, or None if the
    lookup couldn't be made (no network, non-200 response, bad JSON, etc.)
    -- callers turn None into resolved_location's "geocode_unavailable"
    source. Only successful lookups are cached; a None result is always
    retried on the next run."""
    global _network_unavailable
    key = _cache_key(lat, lon)
    if key in cache:
        return cache[key]
    if _network_unavailable:
        return None

    params = urllib.parse.urlencode({
        "format": "jsonv2", "lat": lat, "lon": lon, "zoom": "18", "addressdetails": "1",
    })
    req = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": NOMINATIM_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        time.sleep(NOMINATIM_RATE_LIMIT_SECONDS)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        _network_unavailable = True
        return None

    address = data.get("address", {})
    landmark = (address.get("attraction") or address.get("building") or address.get("amenity")
                or address.get("tourism") or address.get("road"))
    locality = address.get("city") or address.get("town") or address.get("village") or address.get("municipality")
    display_name = data.get("display_name", "")
    result = {
        "location_label": ", ".join(x for x in (landmark, locality) if x) or display_name.split(",")[0] or None,
        "place_full": display_name or None,
        "country": address.get("country"),
    }
    cache[key] = result
    return result


def resolved_location_for(gps, cache):
    if not gps["has_gps"]:
        return {"source": "no_gps", "location_label": None, "place_full": None, "country": None}
    geo = reverse_geocode(gps["lat"], gps["lon"], cache)
    if geo is None:
        return {"source": "geocode_unavailable", "location_label": None, "place_full": None, "country": None}
    return {"source": "internet_geocode", **geo}


# ---------------------------------------------------------------------------
# Building the catalog
# ---------------------------------------------------------------------------

EMPTY_SUBJECT_DESCRIPTION = {"standard": None, "monty_python": None}


def _normalize_subject_description(value):
    """Old datafiles (before this script grew subject/subject_description
    objects) stored subject_description as a plain string. Migrate that
    into {"standard": <the old string>, "monty_python": None} so the rest
    of this script only ever deals with one shape. A value already in the
    new shape (or None) passes through unchanged."""
    if value is None:
        return dict(EMPTY_SUBJECT_DESCRIPTION)
    if isinstance(value, str):
        return {"standard": value, "monty_python": None}
    return {"standard": value.get("standard"), "monty_python": value.get("monty_python")}


def catalog_entries_for_folder(folder, cache):
    folder_path = os.path.join(PHOTOS_ROOT, folder)
    entries = []
    for fn in sorted(os.listdir(folder_path)):
        if fn in GENERATED_FILENAMES or fn.startswith("."):
            continue
        low = fn.lower()
        fpath = os.path.join(folder_path, fn)
        if low.endswith(IMAGE_EXT):
            gps = read_image_gps(fpath)
            metadata = image_metadata(fpath, gps)
        elif low.endswith(VIDEO_EXT):
            gps = read_video_gps(fpath)
            metadata = video_metadata(fpath, gps)
        else:
            continue  # not a multimedia file this project tracks
        entries.append({
            "relative_folder": f"photos/{folder}",
            "file_name": fn,
            "file_properties": file_properties(fpath),
            "multimedia_metadata": metadata,
            "resolved_location": resolved_location_for(gps, cache),
            "subject": None,               # filled in by --apply-descriptions; see module docstring
            "subject_description": dict(EMPTY_SUBJECT_DESCRIPTION),
        })
    return entries


def load_existing_datafile():
    if not os.path.exists(DATAFILE_PATH):
        return []
    with open(DATAFILE_PATH, encoding="utf-8") as f:
        return json.load(f)


def entry_key(entry):
    return (entry["relative_folder"], entry["file_name"])


def build(folders):
    cache = _load_geocode_cache()
    existing_by_key = {entry_key(e): e for e in load_existing_datafile()}
    rebuilt_keys = set()
    all_entries = []

    for folder in folders:
        for entry in catalog_entries_for_folder(folder, cache):
            key = entry_key(entry)
            rebuilt_keys.add(key)
            prior = existing_by_key.get(key)
            if prior:
                if prior.get("subject"):
                    entry["subject"] = prior["subject"]
                entry["subject_description"] = _normalize_subject_description(prior.get("subject_description"))
                prior_source = prior.get("resolved_location", {}).get("source")
                fresh_source = entry["resolved_location"]["source"]
                # A prior successful geocode is worth more than a fresh "unavailable" —
                # keep it rather than overwriting with this run's (possibly network-less) attempt.
                if prior_source == "internet_geocode" and fresh_source != "internet_geocode":
                    entry["resolved_location"] = prior["resolved_location"]
                # A file with source "subject_inferred" has no GPS at all -- that's
                # exactly why scripts/python/no-gps-location-resolver/ had to infer its
                # location from caption text in the first place. A fresh run of THIS
                # script can only ever recompute "no_gps" for such a file (there is no
                # GPS coordinate to (re)geocode), which is strictly worse information
                # than what the resolver already worked out. Without this check, every
                # plain rerun of this script silently wiped every resolver-inferred
                # location back to "no_gps" -- never overwrite subject_inferred here.
                elif prior_source == "subject_inferred":
                    entry["resolved_location"] = prior["resolved_location"]
            all_entries.append(entry)

    # Folders not touched this run (e.g. a single-folder invocation) keep
    # whatever was already in the datafile for them, untouched.
    for key, entry in existing_by_key.items():
        folder_name = key[0].split("/", 1)[1] if "/" in key[0] else key[0]
        if folder_name not in folders and key not in rebuilt_keys:
            entry["subject_description"] = _normalize_subject_description(entry.get("subject_description"))
            all_entries.append(entry)

    all_entries.sort(key=lambda e: (e["relative_folder"], e["file_name"]))
    _save_geocode_cache(cache)
    return all_entries


def write_datafile(entries):
    os.makedirs(MULTIMEDIA_DIR, exist_ok=True)
    with open(DATAFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------------------
# --list-pending / --apply-descriptions
# ---------------------------------------------------------------------------

def _pending_flags(entry):
    sd = _normalize_subject_description(entry.get("subject_description"))
    return {
        "needs_subject": not entry.get("subject"),
        "needs_standard": not sd.get("standard"),
        "needs_monty_python": not sd.get("monty_python"),
    }


def list_pending(as_json):
    entries = load_existing_datafile()
    pending = []
    for e in entries:
        flags = _pending_flags(e)
        if any(flags.values()):
            pending.append((e, flags))

    if as_json:
        print(json.dumps([
            {
                "relative_folder": e["relative_folder"],
                "file_name": e["file_name"],
                "resolved_location": e["resolved_location"],
                **flags,
            }
            for e, flags in pending
        ], indent=2))
        return

    if not pending:
        print("Every file already has a subject and a full subject_description.")
        return
    print(f"{len(pending)} file(s) still need something:\n")
    current_folder = None
    for e, flags in pending:
        if e["relative_folder"] != current_folder:
            current_folder = e["relative_folder"]
            print(f"{current_folder}/")
        missing = [name for name, needed in
                   (("subject", flags["needs_subject"]),
                    ("standard description", flags["needs_standard"]),
                    ("monty python rewrite", flags["needs_monty_python"]))
                   if needed]
        loc = e["resolved_location"].get("location_label") or f"({e['resolved_location']['source']})"
        print(f"  {e['file_name']}  —  {loc}  —  needs: {', '.join(missing)}")


def _load_updates_array(path, key_name):
    """Accepts either a bare JSON array, or an object with a `key_name`
    array inside it -- the shape daily-gallery.html's Edit Mode exports
    ({"edits": [...], "removals": [...]}), so --apply-descriptions and
    --remove-files can both be pointed at the same downloaded file and
    each just reads the list it cares about."""
    if not os.path.exists(path):
        sys.exit(f"No such file: {path}")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get(key_name), list):
        return data[key_name]
    sys.exit(f"{path} must be a JSON array, or an object with a \"{key_name}\" array "
              f"(the shape common/daily-gallery.html's Edit Mode exports).")


def apply_descriptions(path):
    updates = _load_updates_array(path, "edits")

    entries = load_existing_datafile()
    by_key = {entry_key(e): e for e in entries}

    applied, skipped = 0, 0
    for u in updates:
        key = (u.get("relative_folder"), u.get("file_name"))
        if not all(key):
            print(f"  skipping malformed entry (missing relative_folder/file_name): {u}")
            skipped += 1
            continue
        if key not in by_key:
            print(f"  skipping {key[0]}/{key[1]}: no matching entry in {DATAFILE_PATH}")
            skipped += 1
            continue
        target = by_key[key]
        touched = False
        if "subject" in u and u["subject"]:
            target["subject"] = u["subject"]
            touched = True
        if "subject_description" in u and u["subject_description"]:
            sd = _normalize_subject_description(target.get("subject_description"))
            new_sd = u["subject_description"]
            if new_sd.get("standard"):
                sd["standard"] = new_sd["standard"]
            if new_sd.get("monty_python"):
                sd["monty_python"] = new_sd["monty_python"]
            target["subject_description"] = sd
            touched = True
        if u.get("move_to_folder"):
            new_folder = u["move_to_folder"]
            if not DATE_RE.match(new_folder):
                print(f"  skipping move for {key[0]}/{key[1]}: move_to_folder "
                      f"'{new_folder}' is not a YYYY-MM-DD folder name")
            else:
                old_rel = target["relative_folder"]
                new_rel = f"photos/{new_folder}"
                if old_rel == new_rel:
                    pass  # already in that day's folder; nothing to move
                else:
                    old_path = os.path.join(PROJECT_ROOT, old_rel, key[1])
                    new_dir = os.path.join(PROJECT_ROOT, new_rel)
                    new_path = os.path.join(new_dir, key[1])
                    if not os.path.exists(old_path):
                        print(f"  skipping move for {key[0]}/{key[1]}: source file not "
                              f"found on disk at {old_path}")
                    elif os.path.exists(new_path):
                        print(f"  skipping move for {key[0]}/{key[1]}: a file already "
                              f"exists at {new_path}")
                    else:
                        os.makedirs(new_dir, exist_ok=True)
                        os.rename(old_path, new_path)
                        target["relative_folder"] = new_rel
                        touched = True
                        print(f"  moved {key[0]}/{key[1]} -> {new_rel}/{key[1]}")
        if touched:
            applied += 1
        else:
            print(f"  skipping {key[0]}/{key[1]}: no subject/subject_description/move_to_folder "
                  f"content in update")
            skipped += 1

    entries.sort(key=lambda e: (e["relative_folder"], e["file_name"]))
    write_datafile(entries)
    print(f"Applied {applied} update(s); skipped {skipped}.")
    print(f"Wrote {DATAFILE_PATH}")


# ---------------------------------------------------------------------------
# --remove-files
# ---------------------------------------------------------------------------

def remove_files(path):
    """Permanently deletes each listed file from photos/ and drops its
    catalog entry. Destructive and irreversible beyond a backup -- the
    counterpart to --apply-descriptions for daily-gallery.html's Edit Mode
    "Remove" control. A file already missing on disk (e.g. removed by hand
    already) still has its catalog entry dropped, rather than being
    treated as an error."""
    removals = _load_updates_array(path, "removals")

    entries = load_existing_datafile()
    by_key = {entry_key(e): e for e in entries}

    keys_to_remove = set()
    already_missing = 0
    for r in removals:
        key = (r.get("relative_folder"), r.get("file_name"))
        if not all(key):
            print(f"  skipping malformed entry (missing relative_folder/file_name): {r}")
            continue
        if key not in by_key:
            print(f"  skipping {key[0]}/{key[1]}: no matching entry in {DATAFILE_PATH}")
            continue
        file_path = os.path.join(PROJECT_ROOT, key[0], key[1])
        if os.path.exists(file_path):
            os.remove(file_path)
        else:
            print(f"  note: {file_path} was already gone from disk; removing its catalog entry anyway")
            already_missing += 1
        keys_to_remove.add(key)

    remaining = [e for e in entries if entry_key(e) not in keys_to_remove]
    remaining.sort(key=lambda e: (e["relative_folder"], e["file_name"]))
    write_datafile(remaining)
    print(f"Removed {len(keys_to_remove)} file(s) and their catalog entries "
          f"({already_missing} were already missing from disk).")
    print(f"Wrote {DATAFILE_PATH}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Build a trip's data/multimedia/multimedia-data.json: a catalog of "
                     "every photo/video under that trip's photos/*/ with file properties, "
                     "EXIF/video metadata, an internet-reverse-geocoded location, and "
                     "(once supplied) subject + subject_description content.")
    parser.add_argument(
        "journal_folder",
        help="Which trip to act on. Either a path (relative to the current directory, or "
             "absolute) to a travel-journal-YYYY-MM-DD/ folder, or just that folder's name "
             "if it lives directly under the travel-journals collection root (e.g. "
             "\"travel-journal-2026-07-01\").",
    )
    parser.add_argument("folder", nargs="?", default=None,
                         help="Only rebuild this one dated folder (e.g. 2026-07-10). "
                              "Default: every folder under this trip's photos/.")
    parser.add_argument("--list-pending", action="store_true",
                         help="List files still missing subject and/or subject_description "
                              "content, then exit.")
    parser.add_argument("--json", action="store_true",
                         help="Used with --list-pending: print structured JSON instead "
                              "of a human-readable list.")
    parser.add_argument("--apply-descriptions", metavar="FILE",
                         help="Merge subject/subject_description updates from FILE (a JSON "
                              "array; see module docstring for the shape) into the existing "
                              "datafile, then exit.")
    parser.add_argument("--remove-files", metavar="FILE",
                         help="Permanently delete the photo/video files listed in FILE (a JSON "
                              "array of {relative_folder, file_name}, or a daily-gallery.html "
                              "Edit Mode pending-changes file's \"removals\" list; see module "
                              "docstring's EDIT MODE section) and remove their catalog entries, "
                              "then exit.")
    args = parser.parse_args()

    journal_root = resolve_journal_root(args.journal_folder)
    if journal_root is None:
        available = list_available_trips()
        msg = (f"Error: could not find journal folder \"{args.journal_folder}\" "
               f"(tried it as a path, and as a folder name under {COLLECTION_ROOT}).")
        if available:
            msg += "\nAvailable journal folders:\n" + "\n".join(f"  - {name}" for name in available)
        sys.exit(msg)
    configure_for_journal(journal_root)

    quiet = args.list_pending and args.json  # --list-pending --json suppresses all other output
    if not quiet:
        print(f"Journal: {PROJECT_ROOT}")

    if args.apply_descriptions:
        apply_descriptions(args.apply_descriptions)
        return

    if args.remove_files:
        remove_files(args.remove_files)
        return

    if args.list_pending:
        list_pending(args.json)
        return

    if args.json:
        print("Note: --json only has an effect together with --list-pending; ignoring it.")

    all_folders = discover_folders()
    if args.folder:
        if args.folder not in all_folders:
            sys.exit(f"'{args.folder}' not found under {PHOTOS_ROOT} (or not named YYYY-MM-DD)")
        folders = [args.folder]
    else:
        folders = all_folders

    entries = build(folders)
    write_datafile(entries)

    pending = sum(1 for e in entries if any(_pending_flags(e).values()))
    geocoded = sum(1 for e in entries if e["resolved_location"]["source"] == "internet_geocode")
    unavailable = sum(1 for e in entries if e["resolved_location"]["source"] == "geocode_unavailable")
    print(f"Wrote {len(entries)} entrie(s) to {DATAFILE_PATH}")
    print(f"  ({len(entries) - pending} fully described, {pending} with something still pending)")
    print(f"  resolved_location: {geocoded} geocoded, {unavailable} unavailable, "
          f"{sum(1 for e in entries if e['resolved_location']['source'] == 'no_gps')} no GPS")
    if unavailable:
        print("  NOTE: nominatim.openstreetmap.org couldn't be reached for some files this run "
              "(expected inside Claude's own sandbox — see this script's module docstring, "
              "'HOW THE LOCATION GETS RESOLVED'). Rerun on your own machine for real results; "
              "already-geocoded files won't be re-queried.")
    if pending:
        print(f"  Run `python3 scripts/python/build-multimedia-data.py {args.journal_folder} "
              f"--list-pending` to see what's left.")


if __name__ == "__main__":
    main()
