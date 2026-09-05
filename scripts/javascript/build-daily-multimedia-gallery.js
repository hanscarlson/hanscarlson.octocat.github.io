#!/usr/bin/env node
/**
 * build-daily-multimedia-gallery.js
 * ----------------------------------
 * Refreshes a trip's data/multimedia/multimedia-data.js -- a plain
 * runtime mirror of data/multimedia/multimedia-data.json (the rich
 * per-file catalog built by scripts/python/build-multimedia-data.py:
 * file properties, EXIF metadata, and subject/subject_description text)
 * as window.MULTIMEDIA_CATALOG, needed only because opening an HTML file
 * directly from disk (file://) blocks fetch() of local JSON in most
 * browsers, but a classic <script src> tag still works fine. No
 * grouping, sorting, date-parsing, or URL-building happens here -- that
 * is all deferred to common/daily-gallery.html's own client-side script,
 * at runtime, from this same raw data, every time that page loads. Re-run
 * this script any time multimedia-data.json changes (new photos
 * cataloged, more subject/subject_description content filled in via
 * build-multimedia-data.py's --apply-descriptions), to refresh the
 * mirror.
 *
 * NO LONGER WRITES daily-gallery.html ITSELF (removed August 2026) --
 * this script used to have a second job, writing a static per-trip
 * <journal-folder>/daily-gallery.html shell (a large embedded HTML/CSS/
 * JS template) that loaded this same mirror via a relative <script src>.
 * That output stopped being what the project actually serves once
 * daily-gallery.html was centralized into a single, shared, ?trip=-aware
 * common/daily-gallery.html (commit 1fb90d0, "centralized daily-gallery
 * and daily-location-gallery ... modified it use for both journals" --
 * same move common/daily-location-gallery.html and common/journal.html
 * already document their own versions of). Neither this script nor its
 * own Instructions.txt were updated at the time, so it kept silently
 * writing a per-trip file nothing links to or serves anymore -- caught
 * and fixed here: every existing orphaned <journal-folder>/daily-
 * gallery.html was deleted, and this script's second job (the
 * OUTPUT_FILE/HTML_TEMPLATE writing logic, previously most of this
 * file's length) was removed outright rather than merely stopped, so
 * there is no dead code path left to accidentally resurrect. The one
 * remaining job below -- refreshing the runtime data mirror -- is still
 * exactly as necessary as ever; common/daily-gallery.html (and, via its
 * own separate <script src>, common/daily-location-gallery.html's own
 * no-clustered-location fallback) both still load
 * data/multimedia/multimedia-data.js at runtime, same as before. See
 * this script's own Instructions.txt for the fuller story and how it was
 * verified.
 *
 * SHARED SCRIPT (August 2026): this script lives once at
 * travel-journals/scripts/javascript/ and serves every
 * travel-journal-YYYY-MM-DD/ trip -- it used to live inside a single
 * trip's own scripts/javascript/ folder, inferring which trip to build
 * for from its own __dirname. It now takes a required <journal-folder>
 * first argument instead, same convention as refresh-events.js /
 * refresh-notes.js / build-multimedia-location-clusters-data.js.
 *
 *     node scripts/javascript/build-daily-multimedia-gallery.js <journal-folder>
 *
 *   <journal-folder>  Which trip to refresh the multimedia-data.js runtime
 *                     mirror for, resolved two ways, tried in order: as a
 *                     path relative to the
 *                     current directory (or absolute), or as a folder name
 *                     directly under the travel-journals collection root
 *                     (e.g. "travel-journal-2026-07-01"). Required.
 *
 * No dependencies — plain Node.
 */
"use strict";
const fs = require("fs");
const path = require("path");

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
  console.error("Usage: node scripts/javascript/build-daily-multimedia-gallery.js <journal-folder>");
  console.error("  <journal-folder>  Which trip to refresh the data/multimedia/multimedia-data.js");
  console.error("                    runtime mirror for. Either a path");
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
const DATA_FILE = path.join(ROOT, "data", "multimedia", "multimedia-data.json");
const DATA_JS_FILE = path.join(ROOT, "data", "multimedia", "multimedia-data.js");

// ---- Load the catalog ---------------------------------------------------
// Read only to fail fast with a friendly message if it is missing, and to
// mirror it into a runtime-loadable .js file below, and for the console
// summary at the very end of this script. Nothing about WHICH files show,
// what order they sort in, or what URL/description each one resolves to is
// decided here — all of that is computed by common/daily-gallery.html's own
// script, at runtime, from this same raw data, every time the page loads.
if (!fs.existsSync(DATA_FILE)) {
  console.error("Missing " + DATA_FILE);
  console.error("Run scripts/python/build-multimedia-data.py first to create it.");
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

// ---- Render ---------------------------------------------------------------
// Mirror the raw catalog into a runtime-loadable .js file. This is a
// plain, unmodified copy of multimedia-data.json's contents (no grouping,
// sorting, date-parsing, or URL-building applied) — all of that happens in
// common/daily-gallery.html's own script, at runtime, from this same data,
// every time the page loads. This is now this script's ONLY job -- see the
// "NO LONGER WRITES daily-gallery.html ITSELF" section in the top-of-file
// comment above for why.
const dataScript =
  "// Auto-generated by build-daily-multimedia-gallery.js — do not edit by hand.\n" +
  "// A plain runtime mirror of data/multimedia/multimedia-data.json (every\n" +
  "// multimedia file, unsorted and ungrouped) for common/daily-gallery.html\n" +
  "// to load\n" +
  "// via <script src>, since opening an HTML file directly from disk\n" +
  "// (file://) blocks fetch() of local JSON in most browsers, but a classic\n" +
  "// <script src> tag still works fine. common/daily-gallery.html resolves\n" +
  "// grouping,\n" +
  "// sorting, dates, URLs, and descriptions from this raw data at runtime.\n" +
  "// IMPORTANT: assigned onto window (not `const`/`let`) — a top-level\n" +
  "// const/let in a classic <script> does NOT become a window property.\n" +
  "window.MULTIMEDIA_CATALOG = " + JSON.stringify(catalog).replace(/</g, "\\u003c") + ";";

fs.mkdirSync(path.dirname(DATA_JS_FILE), { recursive: true });
fs.writeFileSync(DATA_JS_FILE, dataScript);


const folderCount = new Set(catalog.map(e => e.relative_folder.split("/").pop())).size;
const fileCount = catalog.length;
const describedCount = catalog.filter(
  e => e.subject_description && e.subject_description.standard
).length;
console.log("Wrote " + DATA_JS_FILE + " (runtime data mirror).");
console.log(fileCount + " file(s) across " + folderCount + " day(s).");
console.log(describedCount + " file(s) have a subject_description.standard so far.");
