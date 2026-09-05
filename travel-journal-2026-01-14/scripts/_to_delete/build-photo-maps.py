#!/usr/bin/env python3
"""
build-photo-maps.py — (re)generate photoLocationDocument.html for every dated
subfolder of photos/, plus a small mapPreview.png thumbnail for each.

WHAT THIS DOES, PER photos/YYYY-MM-DD/ FOLDER
  1. Reads GPS + timestamp EXIF data from every photo (and, if ffprobe is
     available, every video) in the folder.
  2. Groups photos into "locations" — stops within ~150m and close in time
     count as one stop, one pin.
  3. Loads the curated historical/cultural write-up for that folder from
     photoMapsData/writeups/YYYY-MM-DD.json (one entry per location, keyed
     by cluster index — this is the researched content, written once and
     reused every time you rebuild). Folders/clusters with no matching
     write-up get an honest placeholder instead of invented text.
  4. Renders photoLocationDocument.html (editorial layout + embedded
     Leaflet/OpenStreetMap map with numbered pins + a "🔊 Read Aloud" button
     that reads the write-up aloud and auto-scrolls along with it — see
     "READ ALOUD" below) and mapPreview.png (an
     880x600 plain crop of that same real OpenStreetMap map — same tile
     colors, same numbered-pin/dashed-route styling as the live Leaflet
     map, no recoloring or decorative framing) directly into that day's
     folder, next to its photos. mapPreview.png is meant to read as a
     screenshot of the real map, not a themed illustration of it — see
     "mapPreview.png's look" below. Fetching real map tiles needs internet
     access (standard tile.openstreetmap.org XYZ tiles); if that fails —
     no connection, tiles blocked, etc. — mapPreview.png silently falls
     back to a plain neutral placeholder (same pins/route, no real tiles)
     instead, so the script never blocks on network access.

READ ALOUD
  Every photoLocationDocument.html gets a "🔊 Read Aloud" button in its
  masthead (next to the date line). Clicking it uses the browser's built-in
  Web Speech API (SpeechSynthesis — no server, no network, no external
  service, just whatever voice the browser/OS already has installed) to
  read each location's title, any "Unconfirmed"/landmark note, and its
  write-up paragraphs, in document order. As each piece is read, the page
  auto-scrolls it into view and highlights it (a soft brass background,
  class "read-highlight") so it's easy to follow along, then moves on to
  the next piece when that one finishes. Clicking the button again (it
  relabels itself "⏹ Stop Reading" while active) stops immediately and
  clears the highlight.
  The button is hidden by default in the HTML (inline
  `style="display:none;"`) and only ever unhidden by JS after confirming
  `'speechSynthesis' in window` — so on the rare browser without the Web
  Speech API, there's simply no button, rather than a button that silently
  does nothing when clicked. This can't be polyfilled around: speech
  synthesis has to come from the browser/OS, there's no way for a static
  generated HTML file to bundle its own. Only the title/note/prose text is
  read — not the coordinates/time/photo-count meta line, not photo
  captions, not the footer — see the "Read Aloud" JS block right after the
  Leaflet marker setup in render_html() for the exact list of what's
  read (`article.location .loc-title`, `.unconfirmed-note`, `.prose p`).

MAPPREVIEW.PNG'S LOOK
  mapPreview.png is deliberately plain: an edge-to-edge crop of the actual
  OpenStreetMap tiles (full color, unmodified) with the same numbered pin
  markers and dashed route drawn on top in the exact colors
  photoLocationDocument.html's own embedded Leaflet map already uses (see
  render_html's <script> block: divIcon background #1c2b3a, border #b8863b,
  text #f7f2e6; route color #b8863b) — see MM_INK/MM_BRASS/MM_PIN_TEXT and
  _draw_pins(). There is no duotone recolor, no parchment gradient
  background, no decorative double frame, and no compass rose baked into
  the image. That's intentional: index.html's own CSS (.map-preview) already
  adds a border, rounded corners, and a drop shadow when this image is
  displayed, so baking a second decorative treatment into the PNG itself
  would be redundant page styling layered on top of a real map, rather than
  the file just looking like the map. render_minimap_schematic() (the
  no-real-tiles fallback) follows the same principle: same pins/route, but
  on a plain neutral gray placeholder instead of the parchment palette,
  since it's an honest "no map data" stand-in rather than a styled page
  element either.

REAL MAP TILES IN A NETWORK-RESTRICTED ENVIRONMENT
  On a normal machine with ordinary internet access, step 4 above just
  works — render_minimap_real() fetches tiles directly from
  tile.openstreetmap.org and nothing below applies to you. This is the
  common case: just run the script.

  Claude's own sandboxed tool environment, though, blocks outbound requests
  to tile.openstreetmap.org (and nearly every other host), so running this
  script from inside a Claude session always falls back to the plain
  schematic mapPreview.png — not because a real map isn't wanted, but
  because the sandbox itself can't reach the tile server. Unlike
  refresh-notes.js/refresh-events.js (where Claude has a real, permitted
  bridge to Drive/Calendar via a connector), there is currently no working
  Claude-mediated bridge for this: Claude's browser tools DO have normal
  internet access and can fetch a tile image, but returning that fetched
  binary image data back out of the browser to Claude is itself blocked, by
  design, as a safeguard against exfiltrating binary data through browser
  automation. So Claude cannot currently produce the real-tile version on
  your behalf, in either its sandbox or through its browser tools.
  If you want the real-tile version, run the script yourself on your own
  machine — normal internet access there hits none of these restrictions:
      python3 scripts/build-photo-maps.py               # every day
      python3 scripts/build-photo-maps.py 2026-07-09     # just one day
  --list-tiles and --tile-cache (below) exist as a general escape hatch for
  this situation regardless of its cause — e.g. if you (not Claude) have
  pre-fetched tiles some other way, or are running behind your own
  restrictive proxy — not as a working Claude-automation pipeline.

REQUIREMENTS
  - Python 3.8+
  - Pillow          pip install Pillow
  - ffprobe (optional, only needed to geo-locate .mp4/.mov clips) — part of
    ffmpeg; https://ffmpeg.org. Videos are skipped (flagged "no GPS") if
    ffprobe isn't on PATH.

USAGE (run from anywhere — paths are resolved relative to this script)
  python3 scripts/build-photo-maps.py                 # rebuild every dated subfolder
  python3 scripts/build-photo-maps.py 2026-07-09       # rebuild just one folder
  python3 scripts/build-photo-maps.py --list-missing   # show clusters with no
                                                        # write-up yet, then exit
  python3 scripts/build-photo-maps.py --list-missing --json
                                                        # same, but print structured
                                                        # JSON (folder, cluster_idx,
                                                        # centroid lat/lon, time range,
                                                        # photo count, sample filenames)
                                                        # instead of a human-readable
                                                        # summary, and suppress all other
                                                        # output -- meant for a script (or
                                                        # Claude) to consume programmatically.
                                                        # Powers the automated "research
                                                        # photo write-ups" workflow -- see
                                                        # apply-photo-writeups_Instructions.txt.
  python3 scripts/build-photo-maps.py --list-tiles 2026-07-09
                                                        # print the OSM tile URLs
                                                        # needed for one folder's
                                                        # mapPreview.png, then exit
  python3 scripts/build-photo-maps.py 2026-07-09 --tile-cache DIR
                                                        # rebuild using pre-fetched
                                                        # tiles from DIR before
                                                        # falling back to the network
  python3 scripts/build-photo-maps.py --list-clusters 2026-07-09
                                                        # print EVERY cluster for one
                                                        # folder (researched or not),
                                                        # each with its FULL photo
                                                        # filename list, as JSON
  python3 scripts/build-photo-maps.py --list-clusters
                                                        # same, for every folder at once

ENHANCING NARRATIVES WITH PHOTO SUBJECTS
  --list-missing only surfaces clusters with no write-up yet, and only hands
  back a 5-filename sample -- enough to research a place from its
  coordinates, not enough to actually look at what's in most of the photos.
  --list-clusters is the other half: every cluster, researched or not, each
  with its complete filename list, so Claude can open representative photos
  (via the Read tool, which displays images natively) and ground a
  location's write-up in what's actually depicted -- a specific landmark,
  inscription, view, or object -- rather than GPS coordinates and generic
  location history alone. This also catches mislabeled entries: a cluster's
  GPS placement and an existing write-up's story can both be technically
  plausible and still not match what the photos actually show, and that's
  only discoverable by looking. See apply-photo-writeups_Instructions.txt's
  "Enhancing narratives with photo subjects" section for the full workflow
  -- it reuses apply-photo-writeups.js's existing upsert-by-cluster_idx
  merge, so correcting or enriching an existing entry needs no script
  changes, just a researched-file entry for that cluster_idx like any other.

  A specific case worth calling out: photos taken inside a church or museum
  often contain something --list-missing's coordinate-only research can
  never surface -- a specific painting, altarpiece, sculpture, or other
  named artwork, sometimes with its subject, artist, or date legible right
  on the piece itself (a signature, an inscribed motto, a museum label).
  When Claude is asked to identify artwork subjects, the workflow is the
  same --list-clusters pass, but looking specifically for interior/gallery
  photos and reading whatever text the object itself carries, then treating
  that as the primary source -- ahead of, not instead of, an external web
  search to confirm or add context. Uncertain identifications are labeled
  as such in landmark_note (e.g. "identified from the painting's own
  inscription, not independently verified in a catalog") rather than
  asserted as fact, same honesty bar as everywhere else in this workflow.

ADDING A NEW DAY OR NEW PHOTOS
  Drop photos/videos into photos/YYYY-MM-DD/ (create the folder if it's a
  new date) and run this script. It will always produce a document — new
  locations that don't have researched text yet get a clearly-labeled
  placeholder paragraph. To add the real write-up for a location, either:
    - edit (or create) photoMapsData/writeups/YYYY-MM-DD.json by hand — see
      an existing file for the shape — then rerun the script, or
    - ask Claude to "research photo write-ups" (or similar): this runs
      --list-missing --json (below) to find every unresearched cluster,
      researches each one, and applies the results automatically via
      scripts/apply-photo-writeups.js — see
      apply-photo-writeups_Instructions.txt for the full two-step,
      Claude-mediated workflow (same shape as refresh-notes.js).
  Headline/leg-label/country text per day lives in
  photoMapsData/overrides.json; anything not listed there falls back to an
  auto-generated headline built from the researched place names.
"""

import argparse
import html
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from io import BytesIO

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    sys.exit("Missing dependency: Pillow. Install it with:  pip install Pillow")

try:
    from PIL import ImageDraw, ImageFont
except ImportError:
    ImageDraw = None  # mapPreview.png generation will be skipped with a warning


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# This script lives in travelJournal/scripts/ — PROJECT_ROOT is its parent
# (project/scripts/<script>, project/photos, project/photoMapsData).
# organize_photos.py, this project's other Python script, used this same
# convention until it moved one level deeper to scripts/python/, at which
# point its own project-root calculation became .parent.parent instead of
# .parent to match — see scripts/python/organize_photos.py.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
PHOTOS_ROOT = os.path.join(PROJECT_ROOT, "photos")
DATA_DIR = os.path.join(PROJECT_ROOT, "photoMapsData")
WRITEUPS_DIR = os.path.join(DATA_DIR, "writeups")
OVERRIDES_PATH = os.path.join(DATA_DIR, "overrides.json")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".heic")
VIDEO_EXT = (".mp4", ".mov")
DIST_THRESHOLD_M = 150  # cluster radius, per the "~100-150m = one stop" brief

# Files this script itself generates — never treat these as source photos.
GENERATED_FILENAMES = {"photoLocationDocument.html", "mapPreview.png"}

# Sentinel for --list-clusters' optional FOLDER argument (argparse `const`,
# used when the flag is given with no value) meaning "every folder", not a
# literal folder name.
ALL_FOLDERS_SENTINEL = "__ALL_FOLDERS__"


# ---------------------------------------------------------------------------
# EXIF / GPS extraction
# ---------------------------------------------------------------------------

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


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.strptime(s.replace(" (UTC)", ""), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def scan_folder(folder_path):
    """Return list of media dicts with GPS/time metadata for one day folder."""
    media = []
    for fn in sorted(os.listdir(folder_path)):
        if fn in GENERATED_FILENAMES or fn.startswith("."):
            continue
        low = fn.lower()
        fpath = os.path.join(folder_path, fn)
        if low.endswith(IMAGE_EXT):
            d = read_image_gps(fpath)
            d.update(filename=fn, type="photo")
            media.append(d)
        elif low.endswith(VIDEO_EXT):
            d = read_video_gps(fpath)
            d.update(filename=fn, type="video")
            media.append(d)
    for m in media:
        m["_dt"] = parse_dt(m["datetime"])
    return media


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def cluster_media(media):
    gps = [m for m in media if m["has_gps"]]
    no_gps = [m for m in media if not m["has_gps"]]
    gps.sort(key=lambda m: (m["_dt"] is None, m["_dt"] or datetime.max))
    no_gps.sort(key=lambda m: (m["_dt"] is None, m["_dt"] or datetime.max))

    clusters = []
    for m in gps:
        placed = False
        for c in clusters:
            clat = sum(x["lat"] for x in c) / len(c)
            clon = sum(x["lon"] for x in c) / len(c)
            if haversine(m["lat"], m["lon"], clat, clon) <= DIST_THRESHOLD_M:
                c.append(m)
                placed = True
                break
        if not placed:
            clusters.append([m])

    out = []
    for c in clusters:
        c_sorted = sorted(c, key=lambda m: (m["_dt"] is None, m["_dt"] or datetime.max))
        times = [m["_dt"] for m in c if m["_dt"]]
        out.append({
            "centroid_lat": sum(x["lat"] for x in c) / len(c),
            "centroid_lon": sum(x["lon"] for x in c) / len(c),
            "time_start": min(times) if times else None,
            "time_end": max(times) if times else None,
            "photos": c_sorted,
        })
    out.sort(key=lambda c: c["time_start"] or datetime.max)
    return out, no_gps


# ---------------------------------------------------------------------------
# Write-up data (researched content) + merge logic
# ---------------------------------------------------------------------------

PLACEHOLDER_NOTE = (
    "No historical or cultural context has been researched for this stop yet. "
    "Add an entry for it to photoMapsData/writeups/{folder}.json (or ask Claude to "
    "research and fill it in), then rerun this script."
)


def load_writeups(folder):
    path = os.path.join(WRITEUPS_DIR, folder + ".json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {loc["cluster_idx"]: loc for loc in data.get("locations", [])}


def placeholder_location(cluster_idx, folder):
    return {
        "cluster_idx": cluster_idx,
        "location_label": f"Location {cluster_idx + 1} (unresearched)",
        "place_full": "Not yet identified",
        "landmark_confirmed": None,
        "landmark_note": "",
        "same_stop_as_cluster_idx": None,
        "paragraphs": [PLACEHOLDER_NOTE.format(folder=folder)],
    }


def merge_clusters(clusters, writeups, folder):
    """Resolve same_stop_as_cluster_idx chains and group clusters accordingly."""
    locs = {i: (writeups.get(i) or placeholder_location(i, folder)) for i in range(len(clusters))}

    merge_target = {i: l["same_stop_as_cluster_idx"] for i, l in locs.items()
                     if l.get("same_stop_as_cluster_idx") is not None}

    def resolve(idx, seen=None):
        seen = seen or set()
        if idx in seen or idx not in merge_target:
            return idx
        seen.add(idx)
        return resolve(merge_target[idx], seen)

    groups = {}
    for i in range(len(clusters)):
        groups.setdefault(resolve(i), []).append(i)

    def build_block(i):
        c, l = clusters[i], locs[i]
        return {
            "label": l["location_label"],
            "place_full": l["place_full"],
            "landmark_confirmed": l.get("landmark_confirmed"),
            "landmark_note": l.get("landmark_note") or "",
            "paragraphs": l.get("paragraphs") or [],
            "photos": c["photos"],
            "start": c["time_start"],
            "end": c["time_end"],
        }

    locations_out = []
    for primary_idx, members in groups.items():
        members.sort(key=lambda i: clusters[i]["time_start"] or datetime.max)
        primary_block = build_block(primary_idx)
        sub_blocks = [build_block(i) for i in members if i != primary_idx]
        starts = [b["start"] for b in [primary_block] + sub_blocks if b["start"]]
        ends = [b["end"] for b in [primary_block] + sub_blocks if b["end"]]
        locations_out.append({
            "primary": primary_block,
            "sub": sub_blocks,
            "lat": clusters[primary_idx]["centroid_lat"],
            "lon": clusters[primary_idx]["centroid_lon"],
            "start": min(starts) if starts else None,
            "end": max(ends) if ends else None,
            "total_photos": len(primary_block["photos"]) + sum(len(b["photos"]) for b in sub_blocks),
        })

    locations_out.sort(key=lambda x: x["start"] or datetime.max)
    for i, loc in enumerate(locations_out):
        loc["num"] = i + 1
    return locations_out


# ---------------------------------------------------------------------------
# Headline / overrides
# ---------------------------------------------------------------------------

def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        return {}
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        return json.load(f)


def auto_headline(locations_out):
    if len(locations_out) == 1:
        return locations_out[0]["primary"]["label"]
    cities = []
    for loc in locations_out:
        city = loc["primary"]["place_full"].split(",")[0].strip()
        if not cities or cities[-1] != city:
            cities.append(city)
    headline = " → ".join(cities[:4])
    if len(cities) > 4:
        headline += " …"
    return headline


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

CSS = """
:root{
  --ink:#1c2b3a; --ink-soft:#4b5563; --paper:#f7f2e6; --paper-alt:#efe4cd;
  --brass:#b8863b; --brass-dark:#8f6526; --brick:#a1432f; --sea:#3f6e64;
  --rule:#ddccaa; --white:#fffdf8;
}
*{box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{margin:0; background:var(--paper); color:var(--ink);
  font-family:'Public Sans', -apple-system, sans-serif; font-size:17px; line-height:1.6;}
a{color:var(--sea);}
.masthead{background:linear-gradient(180deg, var(--paper-alt) 0%, var(--paper) 100%);
  border-bottom:1px solid var(--rule); padding:3.2rem 1.5rem 2.4rem; text-align:center;}
.masthead-inner{max-width:900px; margin:0 auto;}
.kicker{font-family:'IBM Plex Mono', monospace; font-size:0.72rem; letter-spacing:0.14em;
  text-transform:uppercase; color:var(--brass-dark); margin:0 0 0.9rem;}
.leg-label{font-family:'IBM Plex Mono', monospace; font-size:0.78rem; letter-spacing:0.06em;
  text-transform:uppercase; color:var(--sea); margin:0 0 0.6rem; font-weight:600;}
h1.headline{font-family:'Fraunces', serif; font-weight:600; font-style:italic;
  font-size:clamp(2rem, 5vw, 3.4rem); line-height:1.08; margin:0.2rem 0 0.9rem; color:var(--ink);}
.date-line{font-size:1rem; color:var(--ink-soft); margin:0; font-family:'Public Sans', sans-serif;}
.date-line .sep{color:var(--brass); margin:0 0.5em;}
.read-aloud-btn{margin-top:1.4rem; padding:0.55rem 1.3rem; border-radius:999px;
  border:1px solid var(--brass); background:var(--white); color:var(--brass-dark);
  font-family:'IBM Plex Mono', monospace; font-size:0.78rem; letter-spacing:0.04em;
  text-transform:uppercase; font-weight:600; cursor:pointer; transition:background 0.15s ease, color 0.15s ease;}
.read-aloud-btn:hover{background:var(--brass); color:var(--white);}
.read-aloud-btn.reading{background:var(--ink); border-color:var(--ink); color:var(--paper);}
.read-aloud-btn:disabled{opacity:0.4; cursor:not-allowed;}
.map-wrap{max-width:1100px; margin:2.4rem auto; padding:0 1.5rem;}
#map{height:56vh; min-height:380px; border-radius:6px; border:1px solid var(--rule);
  box-shadow:0 8px 24px rgba(28,43,58,0.12);}
.leaflet-popup-content-wrapper{font-family:'Public Sans', sans-serif; border-radius:4px;}
.popup-pin-num{display:inline-block; width:1.3em; height:1.3em; line-height:1.3em; text-align:center;
  background:var(--brass); color:var(--white); border-radius:50%; font-size:0.75em; margin-right:0.4em;
  font-family:'IBM Plex Mono', monospace;}
main.locations{max-width:900px; margin:0 auto; padding:0 1.5rem;}
article.location{padding:2.6rem 0; border-top:1px solid var(--rule);}
article.location:first-child{border-top:none;}
.loc-head{display:flex; gap:1rem; align-items:flex-start; margin-bottom:1rem;}
.pin-badge{flex:0 0 auto; width:2.2rem; height:2.2rem; border-radius:50%; background:var(--ink);
  color:var(--paper); display:flex; align-items:center; justify-content:center;
  font-family:'IBM Plex Mono', monospace; font-size:0.95rem; font-weight:600; border:2px solid var(--brass);}
h2.loc-title{font-family:'Fraunces', serif; font-weight:600; font-size:1.65rem; margin:0 0 0.25rem; color:var(--ink);}
p.loc-meta{font-family:'IBM Plex Mono', monospace; font-size:0.76rem; letter-spacing:0.02em; color:var(--ink-soft); margin:0;}
p.loc-meta .place{color:var(--sea); font-weight:600;}
.unconfirmed-note{font-family:'Public Sans', sans-serif; font-size:0.88rem; font-style:italic; color:var(--brick);
  background:rgba(161,67,47,0.06); border-left:2px solid var(--brick); padding:0.55rem 0.9rem; margin:0.9rem 0 1.2rem;}
.unconfirmed-note strong{font-style:normal; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.06em;
  display:block; margin-bottom:0.15rem;}
.prose{max-width:68ch;}
.prose p{margin:0 0 1rem; color:#2c2620;}
.read-highlight{background:rgba(184,134,59,0.16); border-radius:4px; box-shadow:0 0 0 6px rgba(184,134,59,0.16);
  transition:background 0.3s ease, box-shadow 0.3s ease;}
.prose p:first-of-type:first-letter{font-family:'Fraunces', serif; font-size:2.6em; float:left; line-height:0.85;
  padding:0.05em 0.08em 0 0; color:var(--brass-dark); font-weight:600;}
h3.sub-heading{font-family:'Fraunces', serif; font-style:italic; font-weight:600; font-size:1.18rem;
  margin:1.8rem 0 0.6rem; color:var(--sea); border-top:1px dashed var(--rule); padding-top:1.2rem;}
.gallery{display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:8px; margin:1.2rem 0 0.4rem;}
.gallery figure{margin:0; position:relative; overflow:hidden; border-radius:4px; background:#00000010;}
.gallery img, .gallery video{width:100%; height:150px; object-fit:cover; display:block; cursor:zoom-in;
  transition:transform 0.35s ease;}
.gallery video{cursor:default;}
.gallery img:hover{transform:scale(1.04);}
.gallery figcaption{position:absolute; bottom:0; left:0; right:0; padding:0.3rem 0.5rem;
  font-family:'IBM Plex Mono', monospace; font-size:0.66rem; color:#fff;
  background:linear-gradient(to top, rgba(0,0,0,0.65), transparent); opacity:0; transition:opacity 0.2s;}
.gallery figure:hover figcaption{opacity:1;}
.video-tag{position:absolute; top:6px; right:6px; background:rgba(28,43,58,0.75); color:#fff;
  font-family:'IBM Plex Mono', monospace; font-size:0.62rem; padding:0.15rem 0.4rem; border-radius:3px; pointer-events:none;}
section.unmapped{max-width:900px; margin:1rem auto 4rem; padding:2.2rem 1.5rem 0; border-top:3px double var(--rule);}
section.unmapped h2{font-family:'Fraunces', serif; font-style:italic; font-size:1.6rem; color:var(--brick); margin-bottom:0.4rem;}
.unmapped-intro{color:var(--ink-soft); font-size:0.92rem; max-width:60ch; margin-bottom:1.4rem;}
.unmapped-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:8px;}
.unmapped-grid figure{margin:0;}
.unmapped-grid img, .unmapped-grid .video-placeholder{width:100%; height:100px; object-fit:cover; border-radius:4px;
  display:block; opacity:0.85; cursor:zoom-in;}
.unmapped-grid figcaption{font-family:'IBM Plex Mono', monospace; font-size:0.62rem; color:var(--ink-soft);
  margin-top:0.2rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
footer.doc-footer{text-align:center; padding:2.5rem 1.5rem 3.5rem; color:var(--ink-soft);
  font-family:'IBM Plex Mono', monospace; font-size:0.72rem; letter-spacing:0.03em;}
.lightbox{position:fixed; inset:0; background:rgba(16,20,26,0.92); display:none; align-items:center;
  justify-content:center; z-index:999; padding:3vh 3vw; cursor:zoom-out;}
.lightbox.open{display:flex;}
.lightbox img{max-width:100%; max-height:100%; border-radius:2px; box-shadow:0 10px 40px rgba(0,0,0,0.5);}
@media (max-width:640px){.masthead{padding:2.2rem 1.2rem 1.8rem;} #map{height:42vh;}
  .gallery img, .gallery video{height:120px;}}
"""

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def esc(s):
    return html.escape(s, quote=False) if s else ""


def fmt_time(dt):
    return dt.strftime("%-I:%M %p") if dt else None


def fmt_coord(lat, lon):
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{abs(lat):.4f}° {ns}, {abs(lon):.4f}° {ew}"


def fmt_date(folder):
    y, m, d = (int(x) for x in folder.split("-"))
    dt = datetime(y, m, d)
    return f"{DAY_NAMES[dt.weekday()]}, {MONTHS[m - 1]} {d}, {y}"


def gallery_html(photos):
    parts = []
    for p in photos:
        fn = p["filename"]
        t = fmt_time(p.get("_dt"))
        cap = esc(t) if t else ""
        if fn.lower().endswith(VIDEO_EXT):
            parts.append(
                f'<figure><video controls preload="metadata" src="{esc(fn)}"></video>'
                f'<span class="video-tag">VIDEO</span>'
                f'{"<figcaption>" + cap + "</figcaption>" if cap else ""}</figure>'
            )
        else:
            parts.append(
                f'<figure><img src="{esc(fn)}" loading="lazy" alt="{esc(fn)}" onclick="openLightbox(this.src)">'
                f'{"<figcaption>" + cap + "</figcaption>" if cap else ""}</figure>'
            )
    return "\n".join(parts)


def block_html(block, is_primary):
    parts = []
    if not is_primary:
        parts.append(f'<h3 class="sub-heading">{esc(block["label"])}</h3>')
    if block["landmark_note"]:
        label = "Unconfirmed" if block["landmark_confirmed"] is False else "Note"
        parts.append(f'<p class="unconfirmed-note"><strong>{label}</strong>{esc(block["landmark_note"])}</p>')
    parts.append('<div class="prose">' + "".join(f"<p>{esc(pp)}</p>" for pp in block["paragraphs"]) + "</div>")
    parts.append(f'<div class="gallery">{gallery_html(block["photos"])}</div>')
    return "\n".join(parts)


def location_html(loc):
    p = loc["primary"]
    start_t, end_t = fmt_time(loc["start"]), fmt_time(loc["end"])
    time_str = start_t if (not end_t or start_t == end_t) else f"{start_t}–{end_t}"
    meta = (f'<span class="place">{esc(p["place_full"])}</span> &nbsp;&middot;&nbsp; '
            f'{fmt_coord(loc["lat"], loc["lon"])} &nbsp;&middot;&nbsp; {esc(time_str) if time_str else ""} '
            f'&nbsp;&middot;&nbsp; {loc["total_photos"]} photo{"s" if loc["total_photos"] != 1 else ""}')
    parts = [f'''
<article class="location" id="loc-{loc["num"]}">
  <div class="loc-head">
    <span class="pin-badge">{loc["num"]}</span>
    <div>
      <h2 class="loc-title">{esc(p["label"])}</h2>
      <p class="loc-meta">{meta}</p>
    </div>
  </div>
  {block_html(p, True)}
''']
    for s in loc["sub"]:
        parts.append(block_html(s, False))
    parts.append("</article>")
    return "\n".join(parts)


def unmapped_html(no_gps):
    if not no_gps:
        return ""
    items = []
    for p in no_gps:
        fn = p["filename"]
        t = fmt_time(p.get("_dt"))
        cap = esc(fn) + (f" &middot; {esc(t)}" if t else "")
        if fn.lower().endswith(VIDEO_EXT):
            items.append(
                '<figure><div class="video-placeholder" style="background:#1c2b3a;display:flex;'
                'align-items:center;justify-content:center;color:#efe4cd;font-family:monospace;'
                f'font-size:0.7rem;">VIDEO</div><figcaption>{cap}</figcaption></figure>'
            )
        else:
            items.append(f'<figure><img src="{esc(fn)}" loading="lazy" onclick="openLightbox(this.src)">'
                          f'<figcaption>{cap}</figcaption></figure>')
    return f'''
<section class="unmapped">
  <h2>Off the Map</h2>
  <p class="unmapped-intro">These {len(no_gps)} frame{"s" if len(no_gps) != 1 else ""} carried no GPS data in
  their EXIF (common for messaging-app re-saves, screenshots, or some camera apps) and weren’t placed on the
  map above. Add coordinates manually if you’d like them included.</p>
  <div class="unmapped-grid">{"".join(items)}</div>
</section>
'''


def render_html(folder, locations_out, no_gps, headline, leg_label, country, day_index, total_days):
    date_disp = fmt_date(folder)
    pins = [{"num": l["num"], "lat": l["lat"], "lon": l["lon"],
             "label": l["primary"]["label"], "place": l["primary"]["place_full"]} for l in locations_out]
    pins_json = json.dumps(pins)
    locs_html = "\n".join(location_html(l) for l in locations_out)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(headline)} — {date_disp}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;0,900;1,500;1,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>{CSS}</style>
</head>
<body>

<header class="masthead">
  <div class="masthead-inner">
    <p class="kicker">Hans's Travel Journal &middot; Entry {day_index} of {total_days}</p>
    <p class="leg-label">{esc(leg_label)}</p>
    <h1 class="headline">{esc(headline)}</h1>
    <p class="date-line">{date_disp}<span class="sep">&middot;</span>{esc(country)}</p>
    <button type="button" id="read-aloud-btn" class="read-aloud-btn" style="display:none;">&#128266; Read Aloud</button>
  </div>
</header>

<div class="map-wrap"><div id="map"></div></div>

<main class="locations">
{locs_html}
</main>

{unmapped_html(no_gps)}

<footer class="doc-footer">Daily Photo Map &middot; generated by build-photo-maps.py from this folder's photo EXIF data &middot; map data &copy; OpenStreetMap contributors</footer>

<div class="lightbox" id="lightbox" onclick="this.classList.remove('open')"><img id="lightbox-img" src=""></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
function openLightbox(src) {{
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}}
const pins = {pins_json};
const map = L.map('map', {{scrollWheelZoom:false}});
L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
}}).addTo(map);
const latlngs = pins.map(p => [p.lat, p.lon]);
if (latlngs.length) {{
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, {{padding:[36,36]}});
  if (latlngs.length === 1) map.setZoom(15);
}}
if (latlngs.length > 1) {{
  L.polyline(latlngs, {{color:'#b8863b', weight:2, dashArray:'2,8', opacity:0.8}}).addTo(map);
}}
pins.forEach(p => {{
  const icon = L.divIcon({{
    className: '',
    html: '<div style="background:#1c2b3a;color:#f7f2e6;border:2px solid #b8863b;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-family:\\'IBM Plex Mono\\',monospace;font-size:13px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.35);">' + p.num + '</div>',
    iconSize: [28,28], iconAnchor: [14,14]
  }});
  const marker = L.marker([p.lat, p.lon], {{icon}}).addTo(map);
  marker.bindPopup('<span class="popup-pin-num">' + p.num + '</span><strong>' + p.label.replace(/</g,'&lt;') + '</strong><br><span style="color:#4b5563;font-size:0.85em;">' + p.place.replace(/</g,'&lt;') + '</span>');
  marker.on('click', () => {{
    const el = document.getElementById('loc-' + p.num);
    if (el) el.scrollIntoView({{behavior:'smooth', block:'start'}});
  }});
}});

// ---- Read Aloud: speaks each location's title/note/prose in order via
// the Web Speech API, auto-scrolling to and highlighting whichever
// paragraph is currently being read. Hidden entirely (never shown) on
// browsers without speechSynthesis support -- see the module docstring's
// "READ ALOUD" section for why this can't be polyfilled.
(function() {{
  const btn = document.getElementById('read-aloud-btn');
  if (!btn || !('speechSynthesis' in window)) return;
  btn.style.display = '';

  const synth = window.speechSynthesis;
  const segments = [];
  document.querySelectorAll('article.location').forEach(function(article) {{
    const title = article.querySelector('.loc-title');
    if (title) segments.push({{el: title, text: title.textContent}});
    const note = article.querySelector('.unconfirmed-note');
    if (note) segments.push({{el: note, text: note.textContent}});
    article.querySelectorAll('.prose p').forEach(function(p) {{
      segments.push({{el: p, text: p.textContent}});
    }});
  }});

  let idx = -1;
  let reading = false;
  let highlighted = null;

  function clearHighlight() {{
    if (highlighted) {{
      highlighted.classList.remove('read-highlight');
      highlighted = null;
    }}
  }}

  function setIdle() {{
    reading = false;
    idx = -1;
    clearHighlight();
    btn.textContent = '🔊 Read Aloud';
    btn.classList.remove('reading');
  }}

  function speakNext() {{
    idx++;
    if (idx >= segments.length) {{
      setIdle();
      return;
    }}
    const seg = segments[idx];
    clearHighlight();
    seg.el.classList.add('read-highlight');
    highlighted = seg.el;
    seg.el.scrollIntoView({{behavior: 'smooth', block: 'center'}});
    const utter = new SpeechSynthesisUtterance(seg.text);
    utter.onend = function() {{ if (reading) speakNext(); }};
    utter.onerror = function() {{ if (reading) speakNext(); }};
    synth.speak(utter);
  }}

  btn.addEventListener('click', function() {{
    if (reading) {{
      reading = false;
      synth.cancel();
      setIdle();
      return;
    }}
    if (segments.length === 0) return;
    synth.cancel();
    reading = true;
    idx = -1;
    btn.textContent = '⏹ Stop Reading';
    btn.classList.add('reading');
    speakNext();
  }});

  window.addEventListener('beforeunload', function() {{ synth.cancel(); }});
}})();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# mapPreview.png -- meant to read as a plain crop of the real OpenStreetMap
# map already embedded in photoLocationDocument.html (same tile colors, same
# numbered pin/route styling), NOT a separately parchment-themed
# illustration. index.html's own CSS (.map-preview) already adds the
# border/rounded-corners/shadow treatment when this image is displayed, so
# this file itself is a plain edge-to-edge rectangle -- no baked-in frame,
# compass, duotone recolor, or parchment background. A schematic fallback
# (render_minimap_schematic) covers the case where real tiles aren't
# reachable; it's a plain neutral placeholder for the same reason -- it's
# not meant to look like a themed page element either, just an honest
# "no map data" stand-in using the same pin/route styling.
# ---------------------------------------------------------------------------

MM_W, MM_H = 880, 600
# These three match photoLocationDocument.html's own Leaflet marker/route
# styling exactly (see render_html's embedded <script>): divIcon
# background #1c2b3a / border #b8863b / text #f7f2e6, and the route
# L.polyline color #b8863b. Keeping mapPreview.png's pins pixel-identical
# to the live map's is the point -- this is meant to look like a crop of
# that same map, not a reinterpretation of it.
MM_INK = (28, 43, 58)         # pin fill -- Leaflet marker background #1c2b3a
MM_BRASS = (184, 134, 59)     # pin border + dashed route -- Leaflet #b8863b
MM_PIN_TEXT = (247, 242, 230)  # pin number -- Leaflet marker text #f7f2e6
# Used only by the schematic (no-real-tiles) fallback -- deliberately plain/
# neutral, not the journal's parchment palette, since this is a "no data"
# placeholder rather than a themed page element.
MM_PLACEHOLDER_BG = (232, 232, 229)
MM_PLACEHOLDER_GRID = (208, 208, 203)

# Candidate bold TrueType font paths for the numbered pin badges in
# mapPreview.png, tried in order until one actually exists on this
# machine. This list intentionally spans platforms -- this script gets run
# both on a normal Mac (this project's actual machine) and inside Claude's
# Linux sandbox, and a font that only exists on one of them must not crash
# the other. The very first version of this only had the Linux DejaVu path
# with no fallback, which silently broke the *real* tile map on macOS: PIL
# raised "cannot open resource" the moment render_minimap_real() tried to
# load a font that doesn't exist there, render_minimap() caught that as a
# generic failure, and every mapPreview.png quietly downgraded to the
# schematic version -- with the network never even being the problem.
# ImageFont.load_default() (bitmap, no real bold/size control) is the last
# resort so a missing font list entry degrades the pin labels rather than
# ever crashing the whole render again.
MAP_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",   # macOS
    "/Library/Fonts/Arial Bold.ttf",                        # macOS (older/manual installs)
    "/System/Library/Fonts/Helvetica.ttc",                  # macOS (has a bold face at index 1)
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux (Claude's sandbox, most distros)
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",  # Linux (some distros)
    "C:\\Windows\\Fonts\\arialbd.ttf",                      # Windows
]


def _load_map_font(size):
    """Return a truetype font at `size` from the first candidate path that
    actually exists on this machine, or PIL's built-in bitmap default font
    if none do (see MAP_FONT_CANDIDATES above for why this can't just
    hardcode one path)."""
    for path in MAP_FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


TILE_SIZE = 256
TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
TILE_USER_AGENT = "travelJournal-photomaps/1.0 (personal travel journal build script)"

# Optional local tile cache directory (set via --tile-cache). When set,
# _fetch_tile() reads a tile from here first and only falls back to a live
# network request if it's missing. This exists because this script is
# sometimes run inside a sandboxed environment (Claude's tool sandbox) whose
# outbound network access to tile.openstreetmap.org is blocked -- see
# "REAL MAP TILES IN A NETWORK-RESTRICTED ENVIRONMENT" in the module
# docstring for the full two-step, Claude-mediated workaround. On a normal
# machine with ordinary internet access this is never needed: leave
# --tile-cache unset and _fetch_tile() just hits the network directly, same
# as it always has.
TILE_CACHE_DIR = None


def _deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = (lon_deg + 180.0) / 360.0 * n
    ytile = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return xtile, ytile


def _world_px(lat, lon, zoom):
    x, y = _deg2num(lat, lon, zoom)
    return x * TILE_SIZE, y * TILE_SIZE


def _choose_zoom(lat_min, lat_max, lon_min, lon_max, fit_w, fit_h, min_zoom=3, max_zoom=17):
    for zoom in range(max_zoom, min_zoom - 1, -1):
        x1, y1 = _deg2num(lat_max, lon_min, zoom)  # NW
        x2, y2 = _deg2num(lat_min, lon_max, zoom)  # SE
        w = (x2 - x1) * TILE_SIZE
        h = (y2 - y1) * TILE_SIZE
        if w <= fit_w and h <= fit_h:
            return zoom
    return min_zoom


def _dashed_line(draw, p1, p2, fill, width=3, dash=11, gap=9):
    x1, y1 = p1
    x2, y2 = p2
    dist = math.hypot(x2 - x1, y2 - y1)
    if dist == 0:
        return
    ux, uy = (x2 - x1) / dist, (y2 - y1) / dist
    pos = 0.0
    while pos < dist:
        seg_end = min(pos + dash, dist)
        draw.line([(x1 + ux * pos, y1 + uy * pos), (x1 + ux * seg_end, y1 + uy * seg_end)], fill=fill, width=width)
        pos += dash + gap


def _tile_cache_path(x, y, zoom):
    return os.path.join(TILE_CACHE_DIR, f"{zoom}_{x}_{y}.png")


def _fetch_tile(x, y, zoom):
    if TILE_CACHE_DIR:
        cached = _tile_cache_path(x, y, zoom)
        if os.path.exists(cached):
            return Image.open(cached).convert("RGB")
    url = TILE_URL_TEMPLATE.format(z=zoom, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": TILE_USER_AGENT})
    with urllib.request.urlopen(req, timeout=8) as resp:
        img = Image.open(BytesIO(resp.read())).convert("RGB")
    if TILE_CACHE_DIR:
        os.makedirs(TILE_CACHE_DIR, exist_ok=True)
        img.save(_tile_cache_path(x, y, zoom), "PNG")
    return img


def _needed_tile_range(lat_c, lon_c, zoom, want_w, want_h):
    """The inclusive tile-index range covering a want_w x want_h window
    centered at (lat_c, lon_c) at the given zoom -- shared by
    _fetch_stitched_tiles (which fetches them) and plan_tiles_for_locations
    (which just lists them, e.g. for --list-tiles)."""
    cx, cy = _world_px(lat_c, lon_c, zoom)
    left, top = cx - want_w / 2, cy - want_h / 2
    right, bottom = left + want_w, top + want_h
    tile_x0, tile_y0 = int(left // TILE_SIZE), int(top // TILE_SIZE)
    tile_x1, tile_y1 = int(right // TILE_SIZE), int(bottom // TILE_SIZE)
    return tile_x0, tile_x1, tile_y0, tile_y1


def _fetch_stitched_tiles(lat_c, lon_c, zoom, want_w, want_h):
    """Fetch and stitch just enough OSM tiles to cover a want_w x want_h
    window centered at (lat_c, lon_c) at the given zoom. Returns
    (stitched_image, crop_box_within_stitched) where crop_box is the exact
    want_w x want_h region to use."""
    cx, cy = _world_px(lat_c, lon_c, zoom)
    left, top = cx - want_w / 2, cy - want_h / 2
    tile_x0, tile_x1, tile_y0, tile_y1 = _needed_tile_range(lat_c, lon_c, zoom, want_w, want_h)
    n = 2 ** zoom

    stitched = Image.new("RGB", ((tile_x1 - tile_x0 + 1) * TILE_SIZE, (tile_y1 - tile_y0 + 1) * TILE_SIZE), MM_PLACEHOLDER_BG)
    for tx in range(tile_x0, tile_x1 + 1):
        for ty in range(tile_y0, tile_y1 + 1):
            tx_wrapped = tx % n
            if ty < 0 or ty >= n:
                continue
            tile = _fetch_tile(tx_wrapped, ty, zoom)
            stitched.paste(tile, ((tx - tile_x0) * TILE_SIZE, (ty - tile_y0) * TILE_SIZE))

    crop_left = left - tile_x0 * TILE_SIZE
    crop_top = top - tile_y0 * TILE_SIZE
    crop_box = (crop_left, crop_top, crop_left + want_w, crop_top + want_h)
    return stitched, crop_box


def render_minimap(locations_out, out_path):
    if ImageDraw is None:
        print("  (skipping mapPreview.png — Pillow's ImageDraw/ImageFont not available)")
        return
    try:
        render_minimap_real(locations_out, out_path)
    except Exception as e:
        print(f"  (real-map mapPreview.png failed ({e}); falling back to schematic version)")
        render_minimap_schematic(locations_out, out_path)


def _choose_center_and_zoom(locations_out):
    """The (lat_c, lon_c, zoom) a day's mapPreview.png is centered/zoomed on
    -- shared by render_minimap_real (which fetches tiles for it) and
    plan_tiles_for_locations (which just lists the tiles needed, for
    --list-tiles) so the two can never drift apart."""
    lats = [l["lat"] for l in locations_out]
    lons = [l["lon"] for l in locations_out]
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)
    lat_c, lon_c = (lat_min + lat_max) / 2, (lon_min + lon_max) / 2

    if lat_min == lat_max and lon_min == lon_max:
        zoom = 15
    else:
        zoom = _choose_zoom(lat_min, lat_max, lon_min, lon_max, MM_W, MM_H)
    return lat_c, lon_c, zoom


def plan_tiles_for_locations(locations_out):
    """List (without fetching) the exact OSM tiles render_minimap_real would
    need for these locations: same center/zoom choice, same fetch-window
    padding, same tile range. Powers --list-tiles, a diagnostic/escape-hatch
    for whoever has another way to fetch tiles when there's no direct
    network access to tile.openstreetmap.org -- see the module docstring's
    REAL MAP TILES section for why this isn't something Claude can act on
    by itself."""
    lat_c, lon_c, zoom = _choose_center_and_zoom(locations_out)
    fetch_w, fetch_h = MM_W + TILE_SIZE, MM_H + TILE_SIZE
    tile_x0, tile_x1, tile_y0, tile_y1 = _needed_tile_range(lat_c, lon_c, zoom, fetch_w, fetch_h)
    n = 2 ** zoom
    tiles = []
    for tx in range(tile_x0, tile_x1 + 1):
        for ty in range(tile_y0, tile_y1 + 1):
            tx_wrapped = tx % n
            if ty < 0 or ty >= n:
                continue
            tiles.append({
                "zoom": zoom, "x": tx_wrapped, "y": ty,
                "url": TILE_URL_TEMPLATE.format(z=zoom, x=tx_wrapped, y=ty),
            })
    # de-dupe (wrapping at the antimeridian can repeat a tile) while
    # preserving order
    seen = set()
    deduped = []
    for t in tiles:
        key = (t["zoom"], t["x"], t["y"])
        if key not in seen:
            seen.add(key)
            deduped.append(t)
    return {"lat_c": lat_c, "lon_c": lon_c, "zoom": zoom, "tiles": deduped}


def _spread_points(pts, width, height, min_dist=46, margin=14, iterations=80):
    """Nudge pts (list of mutable [x, y] pairs) apart so nearby location
    pins don't visually collide, clamping each point to stay within
    [margin, width-margin] x [margin, height-margin]. Shared by
    render_minimap_real and render_minimap_schematic so their pin-spacing
    logic can't drift apart."""
    for _ in range(iterations):
        moved = False
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                dx, dy = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
                d = math.hypot(dx, dy)
                if d < min_dist:
                    moved = True
                    if d < 0.01:
                        dx, dy, d = 1.0, 0.0, 1.0
                    push = (min_dist - d) / 2
                    ux, uy = dx / d, dy / d
                    pts[i][0] -= ux * push; pts[i][1] -= uy * push
                    pts[j][0] += ux * push; pts[j][1] += uy * push
                    for p in (pts[i], pts[j]):
                        p[0] = min(max(p[0], margin), width - margin)
                        p[1] = min(max(p[1], margin), height - margin)
        if not moved:
            break


def _draw_pins(draw, pts, locations_out, font_bold, r=22):
    """Numbered pin badges matching photoLocationDocument.html's own
    Leaflet marker styling exactly (see render_html's embedded <script>):
    an MM_INK-filled circle with an MM_BRASS 3px border and an MM_PIN_TEXT
    number -- no separate halo/background ring behind it, since the live
    map's own divIcon doesn't have one either. Shared by render_minimap_real
    and render_minimap_schematic so mapPreview.png's pins look identical
    whether or not real tiles were reachable."""
    for (x, y), loc in zip(pts, locations_out):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=MM_INK, outline=MM_BRASS, width=3)
        num = str(loc["num"])
        bbox = draw.textbbox((0, 0), num, font=font_bold)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((x - tw / 2 - bbox[0], y - th / 2 - bbox[1]), num, font=font_bold, fill=MM_PIN_TEXT)


def render_minimap_real(locations_out, out_path):
    """A plain, edge-to-edge crop of the real OpenStreetMap tiles these
    locations sit on -- the same tiles photoLocationDocument.html's
    embedded Leaflet map shows -- with the same numbered pins and dashed
    route drawn on top in that same map's own colors (see _draw_pins).
    Deliberately NOT recolored, framed, or otherwise themed: the point is
    for this to read as a crop of the real map, not an illustration of it.
    Requires internet access (or a pre-populated --tile-cache -- see
    plan_tiles_for_locations above)."""
    font_bold = _load_map_font(26)

    lat_c, lon_c, zoom = _choose_center_and_zoom(locations_out)

    # fetch a bit more than the final canvas so we can crop cleanly
    fetch_w, fetch_h = MM_W + TILE_SIZE, MM_H + TILE_SIZE
    stitched, crop_box = _fetch_stitched_tiles(lat_c, lon_c, zoom, fetch_w, fetch_h)
    fetched = stitched.crop(tuple(int(round(v)) for v in crop_box))

    # center-crop down to the exact canvas aspect ratio, then resize
    aspect = MM_W / MM_H
    fw, fh = fetched.size
    crop_w = min(fw, fh * aspect)
    crop_h = crop_w / aspect
    cl, ct = (fw - crop_w) / 2, (fh - crop_h) / 2
    fetched = fetched.crop(tuple(int(round(v)) for v in (cl, ct, cl + crop_w, ct + crop_h)))
    img = fetched.resize((MM_W, MM_H), Image.LANCZOS).convert("RGB")
    scale = MM_W / crop_w

    def geo_to_final_px(lat, lon):
        cx, cy = _world_px(lat_c, lon_c, zoom)
        gx, gy = _world_px(lat, lon, zoom)
        dx, dy = gx - cx, gy - cy
        px = fetch_w / 2 + dx - crop_box[0]
        py = fetch_h / 2 + dy - crop_box[1]
        return (px - cl) * scale, (py - ct) * scale

    draw = ImageDraw.Draw(img)

    pts = [list(geo_to_final_px(l["lat"], l["lon"])) for l in locations_out]
    _spread_points(pts, MM_W, MM_H)

    if len(pts) > 1:
        for i in range(len(pts) - 1):
            _dashed_line(draw, pts[i], pts[i + 1], fill=MM_BRASS)

    _draw_pins(draw, pts, locations_out, font_bold)

    img.save(out_path, "PNG", optimize=True)


def render_minimap_schematic(locations_out, out_path):
    """Fallback when real tiles aren't reachable: the same numbered pins
    and dashed route as render_minimap_real, on a plain neutral
    placeholder background (light grid, no parchment/journal theming --
    this is an honest "no map data" stand-in, not a styled page element).
    No network required."""
    font_bold = _load_map_font(26)

    lats = [l["lat"] for l in locations_out]
    lons = [l["lon"] for l in locations_out]
    mean_lat = sum(lats) / len(lats)
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)
    single_point = (lat_max == lat_min and lon_max == lon_min)
    lat_span = max(lat_max - lat_min, 0.0008)
    lon_span = max((lon_max - lon_min) * math.cos(math.radians(mean_lat)), 0.0008)

    margin = 40
    plot_w, plot_h = MM_W - 2 * margin, MM_H - 2 * margin
    span_ratio = lon_span / lat_span if lat_span else 1
    box_ratio = plot_w / plot_h
    if span_ratio > box_ratio:
        draw_w, draw_h = plot_w, (plot_w / span_ratio if span_ratio else plot_h)
    else:
        draw_h, draw_w = plot_h, (plot_h * span_ratio if span_ratio else plot_w)
    draw_w, draw_h = max(draw_w, 1), max(draw_h, 1)
    ox = margin + (plot_w - draw_w) / 2
    oy = margin + (plot_h - draw_h) / 2

    def project(lat, lon):
        if single_point:
            return (ox + draw_w / 2, oy + draw_h / 2)
        x = ox + ((lon - lon_min) * math.cos(math.radians(mean_lat))) / lon_span * draw_w
        y = oy + (1 - (lat - lat_min) / lat_span) * draw_h
        return (x, y)

    img = Image.new("RGB", (MM_W, MM_H), MM_PLACEHOLDER_BG)
    draw = ImageDraw.Draw(img)
    for gx in range(0, MM_W, 44):
        draw.line([(gx, 0), (gx, MM_H)], fill=MM_PLACEHOLDER_GRID, width=1)
    for gy in range(0, MM_H, 44):
        draw.line([(0, gy), (MM_W, gy)], fill=MM_PLACEHOLDER_GRID, width=1)

    pts = [list(project(l["lat"], l["lon"])) for l in locations_out]
    _spread_points(pts, MM_W, MM_H)

    if len(pts) > 1:
        for i in range(len(pts) - 1):
            _dashed_line(draw, pts[i], pts[i + 1], fill=MM_BRASS)

    _draw_pins(draw, pts, locations_out, font_bold)

    img.save(out_path, "PNG", optimize=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def discover_folders():
    if not os.path.isdir(PHOTOS_ROOT):
        sys.exit(f"No photos/ folder found next to this script at {PHOTOS_ROOT}")
    return sorted(d for d in os.listdir(PHOTOS_ROOT)
                   if DATE_RE.match(d) and os.path.isdir(os.path.join(PHOTOS_ROOT, d)))


def build_one(folder, day_index, total_days, overrides, missing_report, dry_run=False, quiet=False):
    folder_path = os.path.join(PHOTOS_ROOT, folder)
    media = scan_folder(folder_path)
    if not media:
        if not quiet:
            print(f"{folder}: no photos/videos found, skipping")
        return False

    clusters, no_gps = cluster_media(media)
    if not clusters:
        if not quiet:
            print(f"{folder}: {len(media)} media, none with usable GPS — skipping document "
                  f"(nothing to map)")
        return False

    writeups = load_writeups(folder)
    for i in range(len(clusters)):
        if i not in writeups:
            c = clusters[i]
            missing_report.append({
                "folder": folder,
                "cluster_idx": i,
                "lat": round(c["centroid_lat"], 6),
                "lon": round(c["centroid_lon"], 6),
                "time_start": c["time_start"].isoformat() if c["time_start"] else None,
                "time_end": c["time_end"].isoformat() if c["time_end"] else None,
                "photo_count": len(c["photos"]),
                "sample_filenames": [p["filename"] for p in c["photos"][:5]],
            })

    locations_out = merge_clusters(clusters, writeups, folder)

    if dry_run:
        if not quiet:
            print(f"{folder}: {len(locations_out)} location(s), {len(media)} media "
                  f"({len(no_gps)} without GPS) [dry run, nothing written]")
        return True

    ov = overrides.get(folder, {})
    headline = ov.get("headline") or auto_headline(locations_out)
    leg_label = ov.get("leg_label") or "Trip Day"
    country = ov.get("country") or ""

    html_out = render_html(folder, locations_out, no_gps, headline, leg_label, country, day_index, total_days)
    doc_path = os.path.join(folder_path, "photoLocationDocument.html")
    with open(doc_path, "w", encoding="utf-8") as f:
        f.write(html_out)

    preview_path = os.path.join(folder_path, "mapPreview.png")
    render_minimap(locations_out, preview_path)

    if not quiet:
        print(f"{folder}: {len(locations_out)} location(s), {len(media)} media "
              f"({len(no_gps)} without GPS) -> {doc_path}")
    return True


def list_clusters(folders):
    """Every cluster (researched or not) across `folders`, with its FULL
    photo filename list (as paths relative to the project root, e.g.
    "photos/2026-07-09/20260709_143201.jpg" -- ready to open directly) --
    powers --list-clusters. Unlike the --list-missing report (which only
    covers gaps and caps sample_filenames at 5), this is meant for Claude to
    actually view a cluster's photos and write paragraphs grounded in what's
    really depicted, for NEW *or already-researched* locations alike -- see
    apply-photo-writeups_Instructions.txt's "Enhancing narratives with photo
    subjects" section."""
    out = []
    for folder in folders:
        folder_path = os.path.join(PHOTOS_ROOT, folder)
        media = scan_folder(folder_path)
        if not media:
            continue
        clusters, _no_gps = cluster_media(media)
        writeups = load_writeups(folder)
        for i, c in enumerate(clusters):
            wu = writeups.get(i)
            out.append({
                "folder": folder,
                "cluster_idx": i,
                "lat": round(c["centroid_lat"], 6),
                "lon": round(c["centroid_lon"], 6),
                "time_start": c["time_start"].isoformat() if c["time_start"] else None,
                "time_end": c["time_end"].isoformat() if c["time_end"] else None,
                "photo_count": len(c["photos"]),
                "filenames": [f"photos/{folder}/{p['filename']}" for p in c["photos"]],
                "has_writeup": wu is not None,
                "existing_location_label": wu["location_label"] if wu else None,
            })
    return out


def _locations_for_folder(folder):
    """Re-derive locations_out for one folder (clustering + write-up merge,
    no HTML/image writing) -- shared by --list-tiles and anything else that
    just needs to know where a day's pins/zoom would land."""
    folder_path = os.path.join(PHOTOS_ROOT, folder)
    media = scan_folder(folder_path)
    if not media:
        sys.exit(f"{folder}: no photos/videos found")
    clusters, _no_gps = cluster_media(media)
    if not clusters:
        sys.exit(f"{folder}: no media with usable GPS -- nothing to map")
    writeups = load_writeups(folder)
    return merge_clusters(clusters, writeups, folder)


def main():
    global TILE_CACHE_DIR

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", help="Rebuild just this one date folder (e.g. 2026-07-09)")
    parser.add_argument("--list-missing", action="store_true",
                         help="List clusters with no researched write-up yet, then exit without writing files")
    parser.add_argument("--json", action="store_true",
                         help="Used together with --list-missing: print the missing clusters as structured "
                              "JSON (folder, cluster_idx, centroid lat/lon, time range, photo count, sample "
                              "filenames) instead of the human-readable summary, and suppress all other "
                              "output. Meant for a script (or Claude) to consume programmatically -- see "
                              "apply-photo-writeups_Instructions.txt.")
    parser.add_argument("--list-clusters", nargs="?", const=ALL_FOLDERS_SENTINEL, default=None, metavar="FOLDER",
                         help="List EVERY cluster for FOLDER (researched or not), or for every folder if no "
                              "FOLDER is given, as JSON -- each cluster's full photo filename list (not just a "
                              "handful), not just the unresearched ones --list-missing covers. For Claude to "
                              "actually open/view a cluster's photos and ground photoMapsData/writeups/*.json's "
                              "paragraphs in the real subject matter depicted (specific landmarks, activities, "
                              "objects, atmosphere), not just generic location history -- see "
                              "apply-photo-writeups_Instructions.txt's 'Enhancing narratives with photo "
                              "subjects' section. Always implies --json-style output (no separate flag needed).")
    parser.add_argument("--list-tiles", metavar="FOLDER",
                         help="Print (as JSON) the exact OSM tile URLs mapPreview.png needs for FOLDER, then "
                              "exit without writing anything. A diagnostic/escape-hatch tool for whoever has "
                              "another way to fetch tiles when the network to tile.openstreetmap.org is "
                              "blocked -- NOT something Claude can currently act on itself; see the module "
                              "docstring's REAL MAP TILES section.")
    parser.add_argument("--tile-cache", metavar="DIR",
                         help="Directory of pre-fetched <zoom>_<x>_<y>.png tiles (see --list-tiles). "
                              "_fetch_tile() checks here first and only hits the network for tiles not "
                              "already cached. Tiles fetched live are also written here for next time. "
                              "Not needed on a normal machine with ordinary internet access.")
    args = parser.parse_args()

    if args.tile_cache:
        TILE_CACHE_DIR = os.path.abspath(args.tile_cache)

    all_folders = discover_folders()
    if not all_folders:
        sys.exit(f"No YYYY-MM-DD subfolders found under {PHOTOS_ROOT}")

    if args.list_tiles:
        locations_out = _locations_for_folder(args.list_tiles)
        plan = plan_tiles_for_locations(locations_out)
        print(json.dumps(plan, indent=2))
        return

    if args.list_clusters is not None:
        if args.list_clusters == ALL_FOLDERS_SENTINEL:
            folders = all_folders
        else:
            if args.list_clusters not in all_folders:
                sys.exit(f"'{args.list_clusters}' not found under {PHOTOS_ROOT} (or not named YYYY-MM-DD)")
            folders = [args.list_clusters]
        print(json.dumps(list_clusters(folders), indent=2))
        return

    if args.folder:
        if args.folder not in all_folders:
            sys.exit(f"'{args.folder}' not found under {PHOTOS_ROOT} (or not named YYYY-MM-DD)")
        targets = [args.folder]
    else:
        targets = all_folders

    overrides = load_overrides()
    missing_report = []
    built = 0
    quiet = args.list_missing and args.json

    for folder in targets:
        day_index = all_folders.index(folder) + 1
        if build_one(folder, day_index, len(all_folders), overrides, missing_report,
                      dry_run=args.list_missing, quiet=quiet):
            built += 1

    if quiet:
        # Structured output only -- no summary text mixed in, so a script
        # (or Claude) can parse stdout directly.
        print(json.dumps(missing_report, indent=2))
        return

    if args.json and not args.list_missing:
        print("Note: --json only has an effect together with --list-missing; ignoring it.")

    verb = "checked" if args.list_missing else "written"
    print(f"\nDone: {built}/{len(targets)} document(s) {verb}.")

    if missing_report:
        print(f"\n{len(missing_report)} location(s) have no researched write-up yet "
              f"(placeholder text {'would be' if args.list_missing else 'was'} used):")
        for m in missing_report:
            print(f"  - {m['folder']} cluster {m['cluster_idx']}")
        print(f"Add entries to {WRITEUPS_DIR}/<folder>.json and rerun to fill these in "
              f"(or ask Claude to \"research photo write-ups\" to do this automatically -- "
              f"see apply-photo-writeups_Instructions.txt).")
    else:
        print("Every location has a researched write-up.")


if __name__ == "__main__":
    main()
