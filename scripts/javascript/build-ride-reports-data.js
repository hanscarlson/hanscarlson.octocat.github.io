#!/usr/bin/env node
/**
 * build-ride-reports-data.js
 * ---------------------------
 * Scans this trip's rideWithGPS/ folder for ride-report PDFs and writes
 * data/ride-reports/ride-reports-data.json (and a
 * data/ride-reports/ride-reports-data.js runtime mirror), keyed by
 * journal date, so that trip's journal page (common/journal.html?trip=
 * <folder>, a client-side-rendered page shared by every trip — see its
 * own top-of-script comment) can render each day's "Cycle Routes" block
 * the same live-from-data-folder way Events, Notes, and Travel Details
 * already do — without needing to scan the filesystem itself, which
 * browser JS can't do.
 *
 * SHARED SCRIPT (August 2026): this script lives once at
 * travel-journals/scripts/javascript/ and serves every
 * travel-journal-YYYY-MM-DD/ trip -- it used to live inside a single
 * trip's own scripts/javascript/ folder (only travel-journal-2026-07-01
 * had a copy, since it's the only trip so far with rideWithGPS PDFs),
 * inferring which trip to act on from its own __dirname. It now takes a
 * required <journal-folder> first argument instead, same convention as
 * refresh-events.js / refresh-notes.js / build-multimedia-location-
 * clusters-data.js.
 *
 * Usage:
 *   node scripts/javascript/build-ride-reports-data.js <journal-folder>
 *
 *   <journal-folder>  Which trip to scan rideWithGPS/ for, resolved two
 *                     ways, tried in order: as a path relative to the
 *                     current directory (or absolute), or as a folder
 *                     name directly under the travel-journals collection
 *                     root (e.g. "travel-journal-2026-07-01"). Required.
 *
 * Safe to re-run any time — it always rescans that trip's rideWithGPS/
 * fresh and overwrites both output files to match exactly what's on disk.
 * Re-run this whenever a ride-report PDF is added, removed, or renamed.
 * A trip with no rideWithGPS/ folder at all just produces empty output
 * files -- not an error.
 *
 * Filename convention (same as build-travel-journal.js's scanRideReports):
 * each PDF's name must start with the journal date it belongs to, e.g.
 *   2026-07-08-2_-_Sisterbike_25_Day_4-_Barge_arrived.pdf
 * A "-N" suffix on the date (as above) distinguishes multiple PDFs for the
 * same day. Everything after the date (and that optional "-N") becomes the
 * ride's display label, with underscores turned into spaces. A file whose
 * name doesn't start with a YYYY-MM-DD is skipped.
 *
 * Like build-travel-journal.js, this shells out to poppler's `pdftoppm` to
 * rasterize each PDF to rideWithGPS/images/<name>.png — regenerated only
 * when missing or older than its source PDF (existing images made by an
 * earlier build-travel-journal.js run are reused as-is).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// This script lives at <travel-journals>/scripts/javascript/, so the
// collection root (the folder holding every travel-journal-YYYY-MM-DD/
// trip) is two levels up -- same convention as refresh-events.js,
// refresh-notes.js, and build-multimedia-location-clusters-data.js.
const COLLECTION_ROOT = path.resolve(__dirname, "..", "..");
const TRIP_FOLDER_RE = /^travel-journal-\d{4}-\d{2}-\d{2}$/;

function listAvailableTrips() {
  let entries = [];
  try {
    entries = fs.readdirSync(COLLECTION_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && TRIP_FOLDER_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

// Resolve <journal-folder> to a real directory: first as given (relative to
// cwd, or absolute), then as a folder name directly under the collection
// root. Returns null if neither exists.
function resolveJournalRoot(arg) {
  if (!arg) return null;
  const asGiven = path.resolve(arg);
  if (fs.existsSync(asGiven) && fs.statSync(asGiven).isDirectory()) return asGiven;
  const underCollection = path.join(COLLECTION_ROOT, arg);
  if (fs.existsSync(underCollection) && fs.statSync(underCollection).isDirectory()) return underCollection;
  return null;
}

const [journalArg] = process.argv.slice(2);
if (!journalArg) {
  console.error("Usage: node scripts/javascript/build-ride-reports-data.js <journal-folder>");
  console.error("  <journal-folder>  Which trip to scan rideWithGPS/ for. Either a path");
  console.error("                    (relative to the current directory, or absolute) to a");
  console.error("                    travel-journal-YYYY-MM-DD/ folder, or just that folder's");
  console.error("                    name if it lives directly under the travel-journals");
  console.error("                    collection root (e.g. \"travel-journal-2026-07-01\").");
  const available = listAvailableTrips();
  if (available.length) {
    console.error("\nAvailable journal folders under " + COLLECTION_ROOT + ":");
    available.forEach((name) => console.error("  - " + name));
  }
  process.exit(1);
}
const JOURNAL_ROOT = resolveJournalRoot(journalArg);
if (!JOURNAL_ROOT) {
  console.error(`Error: could not find journal folder "${journalArg}" (tried it as a path, and as a folder name under ${COLLECTION_ROOT}).`);
  const available = listAvailableTrips();
  if (available.length) {
    console.error("Available journal folders:");
    available.forEach((name) => console.error("  - " + name));
  }
  process.exit(1);
}
const ROOT = JOURNAL_ROOT;
const RIDE_DIR = path.join(ROOT, "rideWithGPS");
const RIDE_IMAGE_DIR = path.join(RIDE_DIR, "images");
const OUT_DIR = path.join(ROOT, "data", "ride-reports");
const OUT_JSON = path.join(OUT_DIR, "ride-reports-data.json");
const OUT_JS = path.join(OUT_DIR, "ride-reports-data.js");

const RIDE_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:-\d+)?_-?_?/;

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function rideLabel(filename) {
  return filename
    .replace(RIDE_DATE_RE, "")
    .replace(/\.pdf$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function ensureRideImage(pdfPath) {
  const base = path.basename(pdfPath, ".pdf");
  const imageName = base + ".png";
  const outPath = path.join(RIDE_IMAGE_DIR, imageName);
  const pdfMtime = fs.statSync(pdfPath).mtimeMs;
  const stale = !fs.existsSync(outPath) || fs.statSync(outPath).mtimeMs < pdfMtime;
  if (stale) {
    fs.mkdirSync(RIDE_IMAGE_DIR, { recursive: true });
    execFileSync("pdftoppm", ["-png", "-r", "150", "-singlefile", pdfPath, path.join(RIDE_IMAGE_DIR, base)]);
  }
  return imageName;
}

function scanRideReports() {
  if (!fs.existsSync(RIDE_DIR)) return {};
  const byDate = {};
  const files = fs.readdirSync(RIDE_DIR, { withFileTypes: true })
    .filter(f => f.isFile() && /\.pdf$/i.test(f.name))
    .map(f => f.name)
    .sort(naturalCompare);
  for (const name of files) {
    const m = RIDE_DATE_RE.exec(name);
    if (!m) continue; // filename doesn't start with a date -- skip
    const date = m[1];
    const image = ensureRideImage(path.join(RIDE_DIR, name));
    (byDate[date] = byDate[date] || []).push({ file: name, label: rideLabel(name), image });
  }
  return byDate;
}

function build() {
  const byDate = scanRideReports();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.writeFileSync(OUT_JSON, JSON.stringify(byDate, null, 2) + "\n");

  const jsContents =
    "// Auto-generated by build-ride-reports-data.js — do not edit by hand.\n" +
    "// A plain runtime mirror of data/ride-reports/ride-reports-data.json (ride-\n" +
    "// report PDFs grouped by journal date, each with its pre-rasterized\n" +
    "// rideWithGPS/images/*.png filename) for common/journal.html?trip=\n" +
    "// <folder> to load via\n" +
    "// <script src>, since opening an HTML file directly from disk (file://)\n" +
    "// blocks fetch() of local JSON in most browsers, but a classic <script src>\n" +
    "// tag still works.\n" +
    "// IMPORTANT: assigned onto window (not `const`/`let`) — a top-level\n" +
    "// const/let in a classic <script> does NOT become a window property.\n" +
    "window.RIDE_REPORTS_DATA = " + JSON.stringify(byDate, null, 2) + ";\n";
  fs.writeFileSync(OUT_JS, jsContents);

  const dateCount = Object.keys(byDate).length;
  const rideCount = Object.values(byDate).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Found ${rideCount} ride report(s) across ${dateCount} day(s).`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_JS)}.`);
}

build();
