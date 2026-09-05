#!/usr/bin/env python3
"""
organize_photos.py

Sorts photos and videos out of a trip's "photos-unsorted" folder into its
"photos" folder, organized into YYYY-MM-DD subfolders based on the date
the photo/video was taken. Tries, in order: EXIF/video metadata, a
YYYYMMDD date pattern in the filename (catches files with no embedded
metadata at all, e.g. WhatsApp exports like "IMG-20260702-WA0002.jpg" --
see get_date_from_filename), then the file's own filesystem date as a
last resort.

SHARED SCRIPT — lives once at <travel-journals>/scripts/python/ and is
used by every travel-journal-YYYY-MM-DD/ trip (as of August 2026, this
was moved here from being duplicated inside each trip's own
scripts/python/ folder; the two copies were byte-for-byte identical, so
no logic needed to be reconciled). Because one copy now serves every
trip, the trip to act on is a required first argument, <journal-folder>
(see "USAGE" below), rather than this script's project root being
inferred from its own location the way it used to be. The per-trip log
file (organize_photos_log.txt) stays where it always was, in that trip's
own scripts/python/ folder — see "Where it lives" below.

See organize_photos_Instructions.txt (in this same folder) for full usage
details. Quick start:

    python3 scripts/python/organize_photos.py <journal-folder>                # run for real
    python3 scripts/python/organize_photos.py <journal-folder> --dry-run      # preview only, no changes

By default this script assumes <journal-folder> itself is the project
root, i.e. the layout is <journal-folder>/photos-unsorted,
<journal-folder>/photos, <journal-folder>/scripts/python/ (this script's
own shared location, two levels below the travel-journals collection
root). Use --source and --dest to point at different locations.
"""

import argparse
import datetime
import filecmp
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".heic", ".heif", ".gif",
    ".bmp", ".tif", ".tiff", ".webp",
}
VIDEO_EXTENSIONS = {
    ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv",
    ".3gp", ".mts", ".m2ts",
}
ALL_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

IGNORE_FILENAMES = {".DS_Store", "Thumbs.db"}

EXIF_DATE_TAGS = (36867, 36868, 306)  # DateTimeOriginal, DateTimeDigitized, DateTime

# Matches a YYYYMMDD date encoded in a filename, optionally followed by a
# single "_"/"-" and up to 6 more digits (a time-of-day suffix) -- e.g.
# "20260705_153942.mp4", "IMG_20260705_153942.jpg",
# "PXL_20260705_153942123.jpg", "IMG-20260702-WA0002.jpg" (WhatsApp's export
# naming: the digits after "WA" aren't part of the date, so \d{0,6} matching
# zero of them there is exactly right). Same pattern sync-photos-album.js
# uses (see its dateFromFilename), kept in sync intentionally so a file
# gets the same date whichever of this project's two import scripts
# handles it.
DATE_IN_FILENAME_RE = re.compile(r"(20\d{2})(\d{2})(\d{2})[_-]?\d{0,6}")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# This script lives at <travel-journals>/scripts/python/, so the collection
# root (the folder holding every travel-journal-YYYY-MM-DD/ trip) is two
# levels up -- same convention as the project's other shared scripts
# (refresh-notes.js, refresh-events.js, resolve_no_gps_locations.py,
# build-multimedia-data.py).
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COLLECTION_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
TRIP_FOLDER_RE = re.compile(r"^travel-journal-\d{4}-\d{2}-\d{2}$")


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


# ---------------------------------------------------------------------------
# Date extraction
# ---------------------------------------------------------------------------

def _parse_exif_datetime(value):
    # EXIF dates look like "2026:07:26 13:26:28"
    try:
        return datetime.datetime.strptime(value.strip(), "%Y:%m:%d %H:%M:%S")
    except (ValueError, AttributeError):
        return None


def get_date_from_image_exif(path):
    try:
        from PIL import Image
    except ImportError:
        return None, None

    try:
        with Image.open(path) as img:
            exif = img.getexif()
            if exif:
                for tag_id in EXIF_DATE_TAGS:
                    value = exif.get(tag_id)
                    dt = _parse_exif_datetime(value) if value else None
                    if dt:
                        return dt, "EXIF date taken"
                # Some cameras store DateTimeOriginal in the nested Exif IFD
                try:
                    exif_ifd = exif.get_ifd(0x8769)  # Exif IFD pointer
                    for tag_id in EXIF_DATE_TAGS:
                        value = exif_ifd.get(tag_id) if exif_ifd else None
                        dt = _parse_exif_datetime(value) if value else None
                        if dt:
                            return dt, "EXIF date taken"
                except Exception:
                    pass
    except Exception:
        return None, None

    return None, None


def get_date_from_video_metadata(path):
    if shutil.which("ffprobe") is None:
        return None, None

    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "default=noprint_wrappers=1:nokey=1",
                "-show_entries", "format_tags=creation_time:stream_tags=creation_time",
                str(path),
            ],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return None, None

    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.datetime.strptime(line, fmt), "video metadata (creation_time)"
            except ValueError:
                continue

    return None, None


def get_date_from_filename(path):
    """A YYYYMMDD date pattern in the filename itself -- the fallback used
    when a file has no usable EXIF/video metadata at all (common for
    WhatsApp exports, which strip EXIF but keep the send date in the
    filename, e.g. "IMG-20260702-WA0002.jpg"). Only the date is trusted
    from the filename; no time-of-day is extracted, since the digits after
    the date aren't reliably a timestamp (WhatsApp's are a sequence
    number, not a time)."""
    m = DATE_IN_FILENAME_RE.search(path.name)
    if not m:
        return None, None
    year, month, day = (int(g) for g in m.groups())
    try:
        return datetime.datetime(year, month, day), "date in filename"
    except ValueError:
        return None, None  # e.g. month/day out of range -- not actually a date


def get_date_from_filesystem(path):
    """Last-resort fallback: the file's 'date created' from the OS, falling
    back to modified time if a creation time isn't available."""
    st = os.stat(path)
    ts = getattr(st, "st_birthtime", None)  # macOS true creation time
    source = "file creation date"
    if ts is None:
        ts = st.st_ctime
        source = "file metadata-change date"
    dt = datetime.datetime.fromtimestamp(ts)
    return dt, source


def get_date_taken(path):
    """Returns (datetime, source_description) for a media file, trying, in
    order: EXIF (photos) / video metadata (videos), then a YYYYMMDD date
    pattern in the filename, then filesystem dates as a last resort."""
    ext = path.suffix.lower()

    if ext in IMAGE_EXTENSIONS:
        dt, source = get_date_from_image_exif(path)
        if dt:
            return dt, source

    if ext in VIDEO_EXTENSIONS or ext in IMAGE_EXTENSIONS:
        dt, source = get_date_from_video_metadata(path)
        if dt:
            return dt, source

    dt, source = get_date_from_filename(path)
    if dt:
        return dt, source

    return get_date_from_filesystem(path)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

class Stats:
    def __init__(self):
        self.moved_new_folder = 0
        self.moved_existing_folder = 0
        self.replaced = 0
        self.deleted_duplicate = 0
        self.errors = 0
        self.skipped = 0

    def total(self):
        return (self.moved_new_folder + self.moved_existing_folder +
                self.replaced + self.deleted_duplicate + self.errors + self.skipped)


def iter_media_files(source_dir):
    for root, _dirs, files in os.walk(source_dir):
        for name in sorted(files):
            if name in IGNORE_FILENAMES or name.startswith("."):
                continue
            path = Path(root) / name
            if path.suffix.lower() in ALL_EXTENSIONS:
                yield path


def log(log_lines, message, quiet=False):
    log_lines.append(message)
    if not quiet:
        print(message)


def process_file(src_path, dest_root, dry_run, backup, stats, log_lines, quiet, known_dirs):
    """known_dirs: dict of dest_dir Path -> set of filenames "present" there.
    Used so --dry-run can accurately report new-folder vs existing-folder
    even though nothing is actually created/moved on disk."""
    try:
        date_taken, source = get_date_taken(src_path)
    except Exception as exc:
        stats.errors += 1
        log(log_lines, f"ERROR  reading metadata for {src_path.name}: {exc}", quiet)
        return

    date_str = date_taken.strftime("%Y-%m-%d")
    dest_dir = dest_root / date_str
    dest_file = dest_dir / src_path.name

    try:
        dir_is_new = dest_dir not in known_dirs
        if dir_is_new:
            existing_names = set(os.listdir(dest_dir)) if dest_dir.exists() else set()
            known_dirs[dest_dir] = existing_names

        if dir_is_new and not known_dirs[dest_dir]:
            log(log_lines, f"NEW FOLDER   {date_str}  (from {source})", quiet)
            if not dry_run:
                dest_dir.mkdir(parents=True, exist_ok=True)
            log(log_lines, f"MOVE   {src_path.name}  ->  photos/{date_str}/  (date via {source})", quiet)
            if not dry_run:
                shutil.move(str(src_path), str(dest_file))
            known_dirs[dest_dir].add(src_path.name)
            stats.moved_new_folder += 1
            return

        if src_path.name not in known_dirs[dest_dir]:
            log(log_lines, f"MOVE   {src_path.name}  ->  photos/{date_str}/  "
                            f"(new file in existing folder; date via {source})", quiet)
            if not dry_run:
                dest_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src_path), str(dest_file))
            known_dirs[dest_dir].add(src_path.name)
            stats.moved_existing_folder += 1
            return

        # A file with the same name already exists in the destination folder.
        if dry_run and not dest_file.exists():
            # Another file from this same run would already occupy this name;
            # can't compare content against something that isn't on disk yet.
            log(log_lines, f"NOTE   {src_path.name} shares a filename with another file already placed in photos/{date_str}/ this run "
                            f"-> comparison skipped in dry-run; will be resolved during a live run", quiet)
            stats.skipped += 1
            return

        same = filecmp.cmp(str(src_path), str(dest_file), shallow=False)
        if same:
            log(log_lines, f"DUPLICATE    {src_path.name} already in photos/{date_str}/ (identical) -> deleting from photos-unsorted", quiet)
            if not dry_run:
                os.remove(src_path)
            stats.deleted_duplicate += 1
        else:
            log(log_lines, f"REPLACE      photos/{date_str}/{src_path.name} differs from unsorted copy -> replacing", quiet)
            if not dry_run:
                if backup:
                    backup_dir = dest_root / "_replaced_backups" / date_str
                    backup_dir.mkdir(parents=True, exist_ok=True)
                    timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
                    backup_path = backup_dir / f"{src_path.stem}__replaced-{timestamp}{src_path.suffix}"
                    shutil.move(str(dest_file), str(backup_path))
                else:
                    os.remove(dest_file)
                shutil.move(str(src_path), str(dest_file))
            stats.replaced += 1

    except Exception as exc:
        stats.errors += 1
        log(log_lines, f"ERROR  processing {src_path.name}: {exc}", quiet)


def main():
    parser = argparse.ArgumentParser(description="Sort a trip's photos-unsorted into photos/YYYY-MM-DD folders.")
    parser.add_argument(
        "journal_folder",
        help="Which trip to act on. Either a path (relative to the current directory, or "
             "absolute) to a travel-journal-YYYY-MM-DD/ folder, or just that folder's name "
             "if it lives directly under the travel-journals collection root (e.g. "
             "\"travel-journal-2026-07-01\").",
    )
    parser.add_argument("--source", default=None,
                         help="Folder of unsorted media files (default: photos-unsorted "
                              "directly under <journal-folder>)")
    parser.add_argument("--dest", default=None,
                         help="Destination photos folder (default: photos directly under "
                              "<journal-folder>)")
    parser.add_argument("--dry-run", action="store_true",
                         help="Preview what would happen without moving, deleting, or replacing any files")
    parser.add_argument("--no-backup", action="store_true",
                         help="When replacing a differing file, delete the old copy instead of saving it to photos/_replaced_backups/")
    parser.add_argument("--quiet", action="store_true",
                         help="Only print the final summary, not each file action")
    args = parser.parse_args()

    journal_root = resolve_journal_root(args.journal_folder)
    if journal_root is None:
        available = list_available_trips()
        msg = (f"Error: could not find journal folder \"{args.journal_folder}\" "
               f"(tried it as a path, and as a folder name under {COLLECTION_ROOT}).")
        if available:
            msg += "\nAvailable journal folders:\n" + "\n".join(f"  - {name}" for name in available)
        sys.exit(msg)
    journal_root = Path(journal_root)

    source_dir = Path(args.source).resolve() if args.source else (journal_root / "photos-unsorted").resolve()
    dest_root = Path(args.dest).resolve() if args.dest else (journal_root / "photos").resolve()

    if not source_dir.exists():
        print(f"Source folder not found: {source_dir}")
        sys.exit(1)
    dest_root.mkdir(parents=True, exist_ok=True)

    stats = Stats()
    log_lines = []
    mode = "DRY RUN (no files will be changed)" if args.dry_run else "LIVE RUN"
    log(log_lines, f"organize_photos.py - {mode}", args.quiet)
    log(log_lines, f"Journal: {journal_root}", args.quiet)
    log(log_lines, f"Source:  {source_dir}", args.quiet)
    log(log_lines, f"Dest:    {dest_root}", args.quiet)
    log(log_lines, "-" * 60, args.quiet)

    files = list(iter_media_files(source_dir))
    if not files:
        log(log_lines, "No media files found in source folder.", args.quiet)

    known_dirs = {}
    for path in files:
        process_file(path, dest_root, args.dry_run, not args.no_backup, stats, log_lines, args.quiet, known_dirs)

    # The final summary always prints, even with --quiet -- only the
    # per-file action lines above are suppressed by it (see the --quiet
    # help text). Passing quiet=False here regardless of args.quiet.
    log(log_lines, "-" * 60, False)
    log(log_lines, f"Moved into new date folders:      {stats.moved_new_folder}", False)
    log(log_lines, f"Moved into existing date folders:  {stats.moved_existing_folder}", False)
    log(log_lines, f"Replaced (content differed):       {stats.replaced}", False)
    log(log_lines, f"Deleted duplicates from unsorted:  {stats.deleted_duplicate}", False)
    log(log_lines, f"Skipped (dry-run filename clash):  {stats.skipped}", False)
    log(log_lines, f"Errors:                             {stats.errors}", False)
    log(log_lines, f"Total files processed:              {stats.total()}", False)

    # Write a persistent log file in this trip's own scripts/python/ folder
    # -- the same location this file always lived in, even though the
    # script itself now runs from the shared travel-journals/scripts/python/
    # location instead of from inside this trip's folder.
    log_dir = journal_root / "scripts" / "python"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "organize_photos_log.txt"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"\n=== Run at {timestamp} ({mode}) ===\n")
        f.write("\n".join(log_lines))
        f.write("\n")

    print(f"\nLog written to: {log_path}")


if __name__ == "__main__":
    main()
