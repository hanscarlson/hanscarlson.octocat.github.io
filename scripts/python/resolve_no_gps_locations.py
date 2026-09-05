#!/usr/bin/env python3
"""
resolve_no_gps_locations.py

SHARED SCRIPT — lives once at <travel-journals>/scripts/python/ and is used
by every travel-journal-YYYY-MM-DD/ trip (as of August 2026, this was moved
here from being duplicated inside each trip's own scripts/python/no-gps-
location-resolver/ folder, keeping only the newer of the two copies' logic).
Everything else that folder held stays where it was, per trip, since it's
trip-specific data rather than code:
  - gazetteer.json  — that trip's own ruleset of landmarks/keywords.
  - README.md       — that trip's own gazetteer changelog and notes.
  - audit.csv       — that trip's own --report output, if it exists.
Because of this, --gazetteer no longer defaults to "gazetteer.json next to
this script" (there's no single trip's gazetteer that could correctly sit
next to a shared script) — it's a REQUIRED argument now; pass the path to
the specific trip's gazetteer.json you want to match against. See
resolve_no_gps_locations_Instructions.txt (this script's shared sibling
file) for the full walkthrough, and each trip's own README.md for that
trip's specific ruleset and changelog.

Fills in `resolved_location` for multimedia records that have no GPS data
(resolved_location.source == "no_gps") but DO have an AI-generated scene
description (subject.description and subject_description.standard), by
matching landmark names/keywords in that description text against a
gazetteer of known places.

This automates the manual process of reading each no-GPS photo's caption
and inferring where it was taken from mentioned landmarks (e.g. "Gullfoss",
"Hallgrímskirkja", "Þingvellir") — the same records where GPS EXIF data
was unavailable but an on-device or AI captioning pass had already
described the scene in enough detail to name the place.

Each gazetteer rule may also carry a `centroid_lat`/`centroid_lon` pair —
the landmark's own real-world coordinates (independent of, and not derived
from, any file's EXIF data, since these records have none). When a rule
matches, those coordinates are copied onto the record's resolved_location
alongside location_label/place_full/country. A rule with no confirmed
coordinates (e.g. an unnamed indoor stop with nothing to map) carries
centroid_lat/centroid_lon: null in the gazetteer, and that null is copied
through rather than guessed at.

This is also how data/multimedia-location/multimedia-location-data.json
ends up with real centroid_lat/centroid_lon for its resolved_location-
sourced clusters (previously always null there, since a GPS-less file has
no coordinates of its own to average): scripts/javascript/build-
multimedia-location-clusters-data.js reads each member file's
resolved_location.centroid_lat/centroid_lon when it groups GPS-less files
by label, so running this script first (to populate those fields in a
trip's multimedia-data.json) and then that one (to recompute that trip's
multimedia-location-data.json) is what actually populates the clusters'
coordinates. See this project's own build-multimedia-location-clusters-
data_Instructions.txt for that script's side of the change.

USAGE
-----
    python3 scripts/python/resolve_no_gps_locations.py <trip>/data/multimedia/multimedia-data.json \\
        --gazetteer <trip>/scripts/python/no-gps-location-resolver/gazetteer.json \\
        --output OUTPUT.json \\
        [--dry-run] [--report report.csv]

    # Update a file in place (writes a .bak backup first)
    python3 scripts/python/resolve_no_gps_locations.py <trip>/data/multimedia/multimedia-data.json \\
        --gazetteer <trip>/scripts/python/no-gps-location-resolver/gazetteer.json \\
        --in-place

See resolve_no_gps_locations_Instructions.txt for the full walkthrough and
how to extend a gazetteer for a new trip, and each trip's own README.md
(next to its gazetteer.json) for that trip's specific ruleset and history.
"""

import argparse
import csv
import json
import shutil
import sys


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def record_text(record):
    """Concatenate the free-text fields we're willing to search for
    landmark names. `monty_python` is deliberately excluded — it's a
    joke/embellished rewrite and more likely to introduce false matches
    than genuine ones."""
    parts = []
    subject = record.get("subject") or {}
    if subject.get("description"):
        parts.append(subject["description"])
    subject_description = record.get("subject_description") or {}
    if subject_description.get("standard"):
        parts.append(subject_description["standard"])
    return " ".join(parts)


def needs_centroid_backfill(resolved):
    """True for a record that was already resolved by an earlier run of
    this tool (source == "subject_inferred"), from before centroid_lat/
    centroid_lon existed, and so is still missing them. Checked via key
    presence (not just a None value) so a record whose matched rule
    genuinely has no confirmed coordinates -- and was correctly given
    centroid_lat/centroid_lon: null -- is not re-processed forever."""
    return "centroid_lat" not in resolved or "centroid_lon" not in resolved


def is_candidate(record):
    """A record qualifies for resolution when it has text to search AND
    either:
      - it has no GPS-derived location yet (source == "no_gps"), or
      - it was already resolved by an earlier run of this tool before
        centroid_lat/centroid_lon existed, and is only missing those two
        fields (source == "subject_inferred" + needs_centroid_backfill).
    A record already carrying centroid_lat/centroid_lon (even null, for a
    rule with no confirmed coordinates) is left untouched."""
    resolved = record.get("resolved_location") or {}
    source = resolved.get("source")
    if source == "no_gps":
        pass
    elif source == "subject_inferred" and needs_centroid_backfill(resolved):
        pass
    else:
        return False

    subject = record.get("subject")
    if not subject or not subject.get("description"):
        return False
    subject_description = record.get("subject_description")
    if not subject_description or not subject_description.get("standard"):
        return False
    return True


def match_gazetteer(text, gazetteer):
    """Return the first gazetteer rule whose keyword requirements are
    met by `text`, or None. Rules are tried in file order, so put more
    specific rules (e.g. a rule requiring BOTH "Hallgrímskirkja" AND
    "tower") before broader ones that would also match the same text."""
    text_lower = text.lower()
    for rule in gazetteer:
        requires_all = [s.lower() for s in rule.get("requires_all", [])]
        requires_any = [s.lower() for s in rule.get("requires_any", [])]

        if requires_all and not all(s in text_lower for s in requires_all):
            continue
        if requires_any and not any(s in text_lower for s in requires_any):
            continue
        if not requires_all and not requires_any:
            continue  # malformed rule, skip rather than blanket-match

        return rule
    return None


def resolve(data, gazetteer):
    """Mutates `data` in place. Returns (updated, backfilled, skipped)
    where `updated` counts records newly resolved from "no_gps",
    `backfilled` counts already-resolved records that only had
    centroid_lat/centroid_lon added, and `skipped` is a list of
    (file_name, reason) for candidates that were NOT updated, so they can
    be reviewed manually."""
    updated = 0
    backfilled = 0
    skipped = []

    for record in data:
        if not is_candidate(record):
            continue

        was_backfill = (record.get("resolved_location") or {}).get("source") == "subject_inferred"

        text = record_text(record)
        rule = match_gazetteer(text, gazetteer)

        if rule is None:
            skipped.append((record.get("file_name", "?"), "no gazetteer rule matched"))
            continue

        record["resolved_location"] = {
            "source": "subject_inferred",
            "location_label": rule["location_label"],
            "place_full": rule["place_full"],
            "country": rule["country"],
            "centroid_lat": rule.get("centroid_lat"),
            "centroid_lon": rule.get("centroid_lon"),
        }
        if was_backfill:
            backfilled += 1
        else:
            updated += 1

    return updated, backfilled, skipped


def write_report(path, data, gazetteer):
    """Write a CSV covering every candidate record: what it matched (or
    didn't), so a human can spot-check the results."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "relative_folder", "file_name", "matched_rule_id",
            "location_label", "place_full", "country",
            "centroid_lat", "centroid_lon",
        ])
        for record in data:
            if not is_candidate(record) and record.get("resolved_location", {}).get("source") != "subject_inferred":
                continue
            text = record_text(record)
            rule = match_gazetteer(text, gazetteer)
            resolved = record.get("resolved_location", {})
            writer.writerow([
                record.get("relative_folder", ""),
                record.get("file_name", ""),
                rule["id"] if rule else "(none)",
                resolved.get("location_label", ""),
                resolved.get("place_full", ""),
                resolved.get("country", ""),
                resolved.get("centroid_lat", ""),
                resolved.get("centroid_lon", ""),
            ])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Path to the trip's data/multimedia/multimedia-data.json file to read")
    parser.add_argument(
        "--gazetteer",
        required=True,
        help=(
            "Path to the gazetteer JSON file for the trip you're resolving, e.g. "
            "<trip>/scripts/python/no-gps-location-resolver/gazetteer.json. REQUIRED: "
            "this script is now shared across every trip (see the module docstring), "
            "so there's no single next-to-script gazetteer it could default to anymore."
        ),
    )
    parser.add_argument("--output", help="Path to write the updated JSON to (default: print summary only)")
    parser.add_argument("--in-place", action="store_true",
                         help="Overwrite the input file (a INPUT.json.bak backup is written first)")
    parser.add_argument("--dry-run", action="store_true",
                         help="Report what would change without writing any file")
    parser.add_argument("--report", help="Optional path to write a CSV audit report of every candidate record")
    args = parser.parse_args()

    if args.in_place and args.output:
        parser.error("--in-place and --output are mutually exclusive")

    data = load_json(args.input)
    gazetteer = load_json(args.gazetteer)

    total = len(data)
    candidates = sum(1 for r in data if is_candidate(r))

    updated, backfilled, skipped = resolve(data, gazetteer)

    print(f"Input:                         {args.input}")
    print(f"Gazetteer:                     {args.gazetteer}")
    print(f"Total records:                 {total}")
    print(f"Candidates (no_gps/backfill):   {candidates}")
    print(f"Newly resolved via gazetteer:   {updated}")
    print(f"Backfilled with centroid only:  {backfilled}")
    print(f"Skipped (no rule matched):      {len(skipped)}")
    if skipped:
        print("\nSkipped records (review manually and consider adding a gazetteer rule):")
        for file_name, reason in skipped:
            print(f"  - {file_name}: {reason}")

    if args.report:
        write_report(args.report, data, gazetteer)
        print(f"\nAudit report written to {args.report}")

    if args.dry_run:
        print("\n--dry-run set: no output file written.")
        return

    if args.in_place:
        backup_path = str(args.input) + ".bak"
        shutil.copyfile(args.input, backup_path)
        save_json(args.input, data)
        print(f"\nBackup written to {backup_path}")
        print(f"Updated file written to {args.input}")
    elif args.output:
        save_json(args.output, data)
        print(f"\nUpdated file written to {args.output}")
    else:
        print("\nNo --output/--in-place given: not writing a file (use --dry-run to silence this note).")


if __name__ == "__main__":
    sys.exit(main())
