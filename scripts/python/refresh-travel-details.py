#!/usr/bin/env python3
"""
refresh-travel-details.py — extract rows from the "Details" sheet of the
external TravelDetails.ods spreadsheet, for a given inclusive date range,
into a trip's own data/travel-details/travel-details.json (plus a
travel-details-data.js mirror alongside it -- see OUTPUT SHAPE below).

SHARED SCRIPT — this script and its Instructions.txt live once at
travel-journals/scripts/python/ and are used by every
travel-journal-YYYY-MM-DD/ trip (as of August 2026, this was moved here
from being duplicated, byte-for-byte identically, inside each trip's own
scripts/python/ folder — unlike build-multimedia-data.py's own move, the
two copies here had no logic to reconcile, since neither had drifted from
the other). Because one copy now serves every trip, the trip to write
into is a required first argument, <journal-folder> (see "HOW TO RUN IT"
below), rather than being inferred from this script's own location the
way it used to be. SOURCE_FILE below is NOT per-trip — it's Hans's one
personal travel-planning spreadsheet covering every trip he's ever
logged, so every trip's run reads the very same file and just filters it
down to that trip's own date range.

SOURCE FILE (outside the project, unlike every other data source this
project's scripts read):
    /Users/hanscarlson/Library/CloudStorage/GoogleDrive-hans.carlson@gmail.com/My Drive/travel/TravelDetails.ods
This is Hans's personal day-by-day travel planning spreadsheet, synced via
Google Drive for desktop, hand-maintained in LibreOffice/Excel and NOT part
of this git-style project tree. The path is hardcoded (SOURCE_FILE below)
because it's specific to this one machine/Google account — if this script
is ever run from a different machine or a different Google Drive layout,
update SOURCE_FILE to match. Read-only: this script never writes to the
.ods file, so it's safe to run even while the spreadsheet is open in
LibreOffice/Excel (as it commonly will be — a ".~lock.TravelDetails.ods#"
lock file next to it just means someone has it open for editing, and does
not block another process from reading it).

THE "Details" SHEET: one row per calendar day (a "Date" column of full
dates, not just days), with free-text columns describing that day's plans
— Trip Name, Locale, Lodging, Transportation, Meals, Activities, Notes.
Most day-rows are otherwise blank (no trip planned that day); only rows
for days with actual travel content have anything beyond the date.

WHAT THIS SCRIPT DOES
  Given a trip to write into and a start/end date (inclusive, YYYY-MM-DD),
  reads every row in the Details sheet whose Date falls in that range, and
  writes them — as plain JSON objects, one per matching day, sorted
  chronologically — to that trip's data/travel-details/travel-details.json
  (overwriting whatever was there before; this script always recomputes
  the full output range fresh, it does not merge with a prior run's
  output). A day within the range that has a Date but no other content
  still produces a row (with all its other fields null) — the range, not
  "has content", decides what's extracted, and blank days are recorded,
  not skipped.

WHY THIS IS NOT A TWO-STEP, CLAUDE-MEDIATED SCRIPT (unlike refresh-notes.js
/ refresh-events.js in scripts/javascript/, or this project's other
refresh-*/build-* scripts that need Claude to fetch external data or write
a synthesis): every field this script needs already exists as plain text
in the spreadsheet itself. There's no research, no synthesis, no judgment
call — just reading rows out of one file and filtering by date — so a
single plain-Python run does the whole job.

OUTPUT SHAPE — <journal-folder>/data/travel-details/travel-details.json, a
JSON array sorted by date, e.g.:
    [
      {
        "date": "2026-01-14",
        "trip_name": "Arctic Trip",
        "locale": "Iceland",
        "lodging": "Hotel Reykjavík Saga",
        "transportation": "Private van from airport to hotel",
        "meals": null,
        "activities": "Breakfast at hotel 4700 ISK...",
        "notes": "Hotel Reykjavík Saga\nLækjargata 12 - Reykjavík..."
      },
      ...
    ]
A column with no content for that day is null, not an empty string or a
missing key — every row always has all 8 keys.

Alongside that JSON file, this script also writes data/travel-details/
travel-details-data.js — the same rows keyed by date (the redundant "date"
key dropped from each value), assigned to window.TRAVEL_DETAILS_DATA. This
is what that trip's journal page (common/journal.html?trip=<folder>, a
client-side-rendered page shared by every trip) reads at runtime via
<script src> for its own per-day "Travel Details" section, the same
pattern data/daily-notes/daily-notes-data.js uses for the Notes section —
a plain <script src> mirror because fetch() of a local JSON file fails
when the page is opened straight from disk (file://).

WHERE IT LIVES
    travel-journals/                     <- the collection root (this
      scripts/                              script's own grandparent
        python/                             directory)
          refresh-travel-details.py     <- SHARED, one copy for every trip
          refresh-travel-details_Instructions.txt  <- SHARED
      travel-journal-2026-07-01/        <- one trip
        data/
          travel-details/
            travel-details.json         <- this trip's output
            travel-details-data.js      <- this trip's output (mirror)
      travel-journal-2026-01-14/        <- another trip, same shape

DEPENDENCIES
  pandas and odfpy (odfpy is pandas' engine for reading .ods files):
      pip install pandas odfpy

HOW TO RUN IT
    python3 scripts/python/refresh-travel-details.py <journal-folder> <start> <end> [output-path]

  <journal-folder>  Which trip to write into. Either a path (relative to
                    the current directory, or absolute) to a
                    travel-journal-YYYY-MM-DD/ folder, or just that
                    folder's name if it lives directly under the
                    travel-journals collection root (e.g.
                    "travel-journal-2026-07-01"). Required.
  <start>/<end>     Inclusive date range, YYYY-MM-DD. Both required.
  [output-path]     Defaults to <journal-folder>/data/travel-details/
                    travel-details.json. Pass a different path for a
                    dry-run comparison before overwriting the real file.
                    The travel-details-data.js mirror is always written
                    next to whichever path this resolves to, as
                    travel-details-data.js in that same directory.

Example:
    python3 scripts/python/refresh-travel-details.py travel-journal-2026-01-14 2026-01-14 2026-01-26

Safe to rerun any time the spreadsheet changes, or with a different date
range — it always reads the current state of the Details sheet and
overwrites the output file with exactly the rows in the requested range.
Running it against the wrong <journal-folder> only touches that one
trip's own data/travel-details/ files — trips are fully independent, and
every trip's run reads the same shared SOURCE_FILE.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

try:
    import pandas as pd
except ImportError:
    sys.exit("Missing dependency: pandas. Install it with:  pip install pandas")

try:
    import odf  # noqa: F401  (pandas' engine for reading .ods files)
except ImportError:
    sys.exit("Missing dependency: odfpy. Install it with:  pip install odfpy")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# This script lives at <travel-journals>/scripts/python/, so the collection
# root (the folder holding every travel-journal-YYYY-MM-DD/ trip) is two
# levels up -- same convention as the project's other shared scripts
# (build-multimedia-data.py, resolve_no_gps_locations.py, refresh-notes.js,
# refresh-events.js).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COLLECTION_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
TRIP_FOLDER_RE = re.compile(r"^travel-journal-\d{4}-\d{2}-\d{2}$")

# Everything below is resolved once we know which trip we're acting on --
# see configure_for_journal(), called from main() right after argparse.
# Left as None at import time (rather than computed straight from __file__
# the way they used to be, back when this script lived inside a single
# trip's own folder) so a bug can't silently point them at the wrong trip.
PROJECT_ROOT = None
OUTPUT_DIR = None
OUTPUT_FILE = None

# Plain-JS mirror of OUTPUT_FILE, keyed by date, for that trip's journal
# page (common/journal.html?trip=<folder>) to pick up via <script src>
# (fetch() of a local file fails under file://) -- always
# named travel-details-data.js, written alongside whatever OUTPUT_FILE ends
# up being (so a dry-run output_path still gets a matching mirror next to
# it, without clobbering the real one unless that IS the real path).
OUTPUT_JS_BASENAME = "travel-details-data.js"

# Hardcoded, machine-specific, and shared across every trip -- see module
# docstring's "SOURCE FILE" section.
SOURCE_FILE = (
    "/Users/hanscarlson/Library/CloudStorage/"
    "GoogleDrive-hans.carlson@gmail.com/My Drive/travel/TravelDetails.ods"
)
SHEET_NAME = "Details"

# Spreadsheet column header -> output JSON key.
COLUMN_KEY_MAP = {
    "Date": "date",
    "Trip Name": "trip_name",
    "Locale": "locale",
    "Lodging": "lodging",
    "Transportation": "transportation",
    "Meals": "meals",
    "Activities": "activities",
    "Notes": "notes",
}


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
    PROJECT_ROOT/OUTPUT_DIR/OUTPUT_FILE."""
    global PROJECT_ROOT, OUTPUT_DIR, OUTPUT_FILE
    PROJECT_ROOT = journal_root
    OUTPUT_DIR = os.path.join(PROJECT_ROOT, "data", "travel-details")
    OUTPUT_FILE = os.path.join(OUTPUT_DIR, "travel-details.json")


def load_details_rows(start_date, end_date):
    """Read the Details sheet and return every row (as a dict, output keys
    already applied) whose Date falls within [start_date, end_date], both
    datetime.date, inclusive — sorted chronologically."""
    if not os.path.isfile(SOURCE_FILE):
        sys.exit(
            "Missing source spreadsheet: " + SOURCE_FILE + "\n"
            "(hardcoded path — see this script's module docstring if it's moved)."
        )

    df = pd.read_excel(SOURCE_FILE, engine="odf", sheet_name=SHEET_NAME, header=0)
    df.columns = [str(c).strip() for c in df.columns]

    missing_cols = [c for c in COLUMN_KEY_MAP if c not in df.columns]
    if missing_cols:
        sys.exit(
            "Details sheet is missing expected column(s): " + ", ".join(missing_cols) +
            "\nFound columns: " + ", ".join(df.columns)
        )

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    mask = (df["Date"].dt.date >= start_date) & (df["Date"].dt.date <= end_date)
    matched = df[mask].sort_values("Date")

    rows = []
    for _, r in matched.iterrows():
        row = {}
        for col, key in COLUMN_KEY_MAP.items():
            val = r[col]
            if key == "date":
                row[key] = val.strftime("%Y-%m-%d")
                continue
            if pd.isna(val):
                row[key] = None
            else:
                text = str(val).strip()
                row[key] = text if text else None
        rows.append(row)
    return rows


def parse_date_arg(raw, label):
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        sys.exit(f"Invalid {label} date {raw!r} — expected YYYY-MM-DD.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract Details-sheet rows from TravelDetails.ods within a date "
                     "range into a trip's data/travel-details/travel-details.json.")
    parser.add_argument(
        "journal_folder",
        help="Which trip to write into. Either a path (relative to the current "
             "directory, or absolute) to a travel-journal-YYYY-MM-DD/ folder, or just "
             "that folder's name if it lives directly under the travel-journals "
             "collection root (e.g. \"travel-journal-2026-07-01\").",
    )
    parser.add_argument("start", help="Inclusive range start, YYYY-MM-DD.")
    parser.add_argument("end", help="Inclusive range end, YYYY-MM-DD.")
    parser.add_argument("output_path", nargs="?", default=None,
                         help="Defaults to <journal-folder>/data/travel-details/"
                              "travel-details.json.")
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

    start_date = parse_date_arg(args.start, "start")
    end_date = parse_date_arg(args.end, "end")
    if end_date < start_date:
        sys.exit(f"end date {args.end} is before start date {args.start}.")

    rows = load_details_rows(start_date, end_date)

    out_path = os.path.abspath(args.output_path) if args.output_path else OUTPUT_FILE
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # Plain-JS mirror, keyed by date (the "date" key itself dropped from each
    # value since it's redundant with the key) -- written alongside out_path
    # so that trip's journal page (common/journal.html?trip=<folder>, which
    # loads data/travel-details/travel-details-data.js via a dynamically
    # injected <script src>) always has a matching, current file to load
    # without needing fetch().
    js_out_path = os.path.join(os.path.dirname(out_path), OUTPUT_JS_BASENAME)
    by_date = {r["date"]: {k: v for k, v in r.items() if k != "date"} for r in rows}
    with open(js_out_path, "w", encoding="utf-8") as f:
        f.write(
            "// Auto-generated by refresh-travel-details.py -- do not edit by hand.\n"
            "// A plain runtime mirror of travel-details.json's contents (same rows,\n"
            "// keyed by date, values with the \"date\" key dropped since it's redundant\n"
            "// with the key itself), for pages that load it via <script src> instead of\n"
            "// fetch() (fetch() of a local file fails under file://).\n"
            "window.TRAVEL_DETAILS_DATA = " + json.dumps(by_date, ensure_ascii=False) + ";\n"
        )

    print(f"Journal: {PROJECT_ROOT}")
    print(f"Wrote {out_path}")
    print(f"Wrote {js_out_path}")
    print(
        f"{len(rows)} row(s) for {args.start}..{args.end} "
        f"(from Details sheet in {SOURCE_FILE})."
    )
    blank = sum(1 for r in rows if not any(v for k, v in r.items() if k != "date"))
    if blank:
        print(f"({blank} of those row(s) have a date but no other content.)")


if __name__ == "__main__":
    main()
