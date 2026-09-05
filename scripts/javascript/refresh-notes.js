#!/usr/bin/env node
/**
 * refresh-notes.js
 * ------------------
 * SHARED SCRIPT — lives once at <travel-journals>/scripts/javascript/ and
 * is used by every travel-journal-YYYY-MM-DD/ trip. Because one copy now
 * serves every trip, the trip to act on is a required first argument
 * (see "CLI args" below) rather than being inferred from __dirname the
 * way a per-trip script would.
 *
 * Keeps a trip's <trip>/data/daily-notes/daily-notes-data.json (the sole
 * source of each day's "Notes" block in that trip's journal) in sync with
 * the Google Docs in "My Drive/dailyNotes". No separate rebuild step is
 * needed afterward: every trip's journal page -- common/journal.html?
 * trip=<folder>, a single client-side-rendered page shared by every trip
 * (see its own top-of-script comment) -- reads the daily-notes-data.js
 * mirror this script writes directly, live, on every page load — so a
 * plain reload picks up the change (no build-travel-journal.js to
 * re-run; that script, and the build-time index.html it used to
 * generate, were retired in August 2026 — see
 * scripts/_to_delete/build-travel-journal_Instructions.txt. That
 * retired script's successor, a per-trip index.html, was itself later
 * replaced by the single common/journal.html described above.)
 *
 * WHY THIS IS A TWO-STEP, CLAUDE-MEDIATED SCRIPT (same reason as
 * refresh-events.js): this is a plain Node script with no Google
 * credentials, so it can't call the Drive API itself. Refreshing notes is
 * therefore:
 *   1. Claude searches "My Drive/dailyNotes" for Google Docs titled
 *      "Daily Note YYYY-MM-DD" (via the Drive connector's search_files,
 *      scoped to the dailyNotes folder's id), fetches each match's FULL
 *      content via read_file_content (never the search result's truncated
 *      contentSnippet), and writes a plain JSON file shaped
 *        { "YYYY-MM-DD": "raw doc text", ... }
 *      to any path (a temp file is fine) — one entry per day found, exactly
 *      as read_file_content returned it, no pre-cleaning.
 *   2. Claude (or you) runs:
 *        node scripts/javascript/refresh-notes.js <journal-folder> <raw-notes-file> [daily-notes-data-path]
 *      which resolves <journal-folder> to one specific trip (see "CLI args"),
 *      reads the raw-notes file, cleans each entry (see below), MERGES the
 *      cleaned entries into that trip's data/daily-notes/daily-notes-data.json
 *      — creating its data/daily-notes/ folder first if it doesn't exist yet
 *      (days not present in this round are left untouched — a merge, not a
 *      replace), re-serializes the whole file sorted by date, and writes
 *      the daily-notes-data.js mirror right after it.
 *
 * Ask Claude to "refresh notes" (for a given trip) to trigger the full
 * two-step process end to end.
 *
 * CLI args
 * ---------
 * <journal-folder> picks which trip to update. It resolves two ways, tried
 * in order:
 *   1. As a path relative to the current working directory (or absolute) —
 *      lets you point at a trip from anywhere.
 *   2. As a folder name directly under the travel-journals collection root
 *      (this script's own grandparent directory, e.g. "travel-journal-
 *      2026-07-01") — lets you run this from the collection root without
 *      typing a full path.
 * If neither resolves to a real directory, the script exits with an error
 * listing every travel-journal-YYYY-MM-DD folder it can see so you can
 * correct the name.
 *
 * CLEANING (Google Docs' plain-text export has two known quirks):
 *   - Backslash-escaped punctuation, e.g. "Ugh, Ugh\!" -> "Ugh, Ugh!".
 *     Google's plain-text export backslash-escapes a handful of ASCII
 *     punctuation characters that could otherwise be mistaken for Markdown;
 *     this undoes that escaping.
 *   - Paragraph breaks come through as a blank line containing a couple of
 *     stray spaces, e.g. "...train.\n\n  \n\n Our travel day..." instead of
 *     a clean "\n\n" — this collapses runs of whitespace-only lines between
 *     paragraphs down to a single clean blank line, and trims leading/
 *     trailing whitespace from each paragraph and from the note as a whole.
 * Both quirks are visible in the raw docs this project pulls from (see the
 * "Daily Note 2026-07-22" doc, which has both \! and the stray-space blank
 * lines throughout).
 *
 * MULTIPLE DOCS FOR THE SAME DATE: shouldn't normally happen (title
 * collisions in the same folder), but if step 1 finds more than one, Claude
 * should pick the most recently modified and mention the conflict when
 * reporting back — this script doesn't attempt to resolve that itself, it
 * just takes whatever single string is in the input JSON for each date.
 *
 * No npm dependencies — plain Node.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// This script lives at <travel-journals>/scripts/javascript/, so the
// collection root (the folder holding every travel-journal-YYYY-MM-DD/
// trip) is two levels up — same convention as build-common-trips-
// manifest.js and refresh-events.js.
const COLLECTION_ROOT = path.resolve(__dirname, "..", "..");
const TRIP_FOLDER_RE = /^travel-journal-\d{4}-\d{2}-\d{2}$/;

// ---- CLI args --------------------------------------------------------
function usage() {
  console.error(
    "Usage: node scripts/javascript/refresh-notes.js <journal-folder> <raw-notes-file> [daily-notes-data-path]\n" +
    "  <journal-folder>          Which trip to update. Either a path (relative to the\n" +
    "                            current directory, or absolute) to a travel-journal-\n" +
    "                            YYYY-MM-DD/ folder, or just that folder's name if it\n" +
    "                            lives directly under the travel-journals collection\n" +
    "                            root (e.g. \"travel-journal-2026-07-01\").\n" +
    "  <raw-notes-file>          JSON file shaped { \"YYYY-MM-DD\": \"raw doc text\", ... },\n" +
    "                            produced by Claude from the Google Docs in\n" +
    "                            \"My Drive/dailyNotes\" (see the top-of-file comment\n" +
    "                            for the full two-step workflow).\n" +
    "  [daily-notes-data-path]  Defaults to <journal-folder>/data/daily-notes/\n" +
    "                            daily-notes-data.json. That data/daily-notes/ folder\n" +
    "                            is created automatically if it doesn't exist yet.\n" +
    "                            Existing dates not present in <raw-notes-file> are\n" +
    "                            left untouched — this is a merge, not a replace."
  );
}

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

// Display a path relative to the current directory when that's not just a
// pile of "../", otherwise fall back to the absolute path — keeps console
// output readable no matter where this is invoked from or where the
// raw-notes file/output path happen to live relative to the trip folder.
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
}

const [, , journalArg, rawNotesArg, outArg] = process.argv;
if (!journalArg || !rawNotesArg) {
  usage();
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

const RAW_NOTES_PATH = path.resolve(rawNotesArg);
const OUT_PATH = outArg
  ? path.resolve(outArg)
  : path.join(JOURNAL_ROOT, "data", "daily-notes", "daily-notes-data.json");

if (!fs.existsSync(RAW_NOTES_PATH)) {
  console.error(`Error: raw notes file not found: ${RAW_NOTES_PATH}`);
  process.exit(1);
}

let rawNotes;
try {
  rawNotes = JSON.parse(fs.readFileSync(RAW_NOTES_PATH, "utf8"));
} catch (err) {
  console.error(`Error: failed to parse ${RAW_NOTES_PATH}: ${err.message}`);
  process.exit(1);
}
if (typeof rawNotes !== "object" || rawNotes === null || Array.isArray(rawNotes)) {
  console.error(`Error: ${RAW_NOTES_PATH} must contain a JSON object of {"YYYY-MM-DD": "text", ...}.`);
  process.exit(1);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Clean one raw Google Docs plain-text export ------------------------
function cleanNote(raw) {
  let text = raw;

  // Undo Google's backslash-escaping of punctuation (e.g. "\!" -> "!").
  // Applies to any backslash immediately followed by an ASCII punctuation
  // character.
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, "$1");

  // Split into paragraphs on any run of 2+ newlines (paragraph breaks that
  // Google renders as a blank line, possibly with a couple of stray spaces
  // sitting on that blank line), trim stray whitespace from each line
  // within a paragraph and from the paragraph as a whole, drop paragraphs
  // that are empty/whitespace-only after trimming, then rejoin with a
  // clean double newline.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .trim()
    )
    .filter((p) => p.length > 0);

  return paragraphs.join("\n\n");
}

// ---- Load existing data/daily-notes/daily-notes-data.json (if any) and merge --
let existing = {};
if (fs.existsSync(OUT_PATH)) {
  try {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
  } catch (err) {
    console.error(`Error: failed to parse existing ${OUT_PATH}: ${err.message}`);
    process.exit(1);
  }
}

let updatedCount = 0;
let skippedBadDate = 0;
let skippedEmpty = 0;
const merged = { ...existing };

for (const [date, raw] of Object.entries(rawNotes)) {
  if (!DATE_RE.test(date)) {
    console.warn(`Warning: skipping "${date}" — key is not a YYYY-MM-DD date.`);
    skippedBadDate++;
    continue;
  }
  if (typeof raw !== "string") {
    console.warn(`Warning: skipping ${date} — value is not a string.`);
    continue;
  }
  const cleaned = cleanNote(raw);
  if (!cleaned) {
    console.warn(`Warning: ${date} cleaned down to empty text — leaving any existing entry untouched.`);
    skippedEmpty++;
    continue;
  }
  merged[date] = cleaned;
  updatedCount++;
}

// ---- Write, sorted by date -----------------------------------------------
const sorted = {};
for (const date of Object.keys(merged).sort()) {
  sorted[date] = merged[date];
}

const outDir = path.dirname(OUT_PATH);
if (!fs.existsSync(outDir)) {
  console.log(`Creating ${displayPath(outDir)}/ (didn't exist yet)...`);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");

// Also write a client-side-loadable mirror (data/daily-notes/daily-notes-data.js)
// so common/journal.html?trip=<folder>'s dynamically-injected
// <script src=".../data/daily-notes/daily-notes-data.js"> populates
// window.DAILY_NOTES_DATA without a separate manual step.
const JS_OUT_PATH = OUT_PATH.replace(/\.json$/, ".js");
fs.writeFileSync(JS_OUT_PATH, "window.DAILY_NOTES_DATA = " + JSON.stringify(sorted, null, 2) + ";\n", "utf8");

console.log(
  `Journal: ${displayPath(JOURNAL_ROOT)}`
);
console.log(
  `Read ${Object.keys(rawNotes).length} raw note(s) from ${displayPath(RAW_NOTES_PATH)}.`
);
console.log(
  `Updated ${updatedCount} day(s)` +
    (skippedBadDate ? `, skipped ${skippedBadDate} bad date key(s)` : "") +
    (skippedEmpty ? `, skipped ${skippedEmpty} empty note(s)` : "") +
    "."
);
console.log(`Wrote ${Object.keys(sorted).length} total day(s) to ${displayPath(OUT_PATH)}.`);

// No rebuild step needed: that trip's journal page
// (common/journal.html?trip=<folder>) reads daily-notes-data.js live on
// every page load (see the top-of-file comment) -- just reload the page
// to see the change.
