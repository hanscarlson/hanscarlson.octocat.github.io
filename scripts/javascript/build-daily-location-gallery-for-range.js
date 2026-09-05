#!/usr/bin/env node
/**
 * build-daily-location-gallery-for-range.js
 * -------------------------------------------
 * Generates a date-range-scoped VIEW of common/daily-location-
 * gallery.html, fixed to THIS trip: the same page (same styling, same
 * behavior, same in-page day picker), but restricted up front to only
 * the days whose date falls within a given [start, end] range (inclusive,
 * both YYYY-MM-DD) -- and, unlike the live template, opens straight into
 * this one trip with no ?trip= needed in the URL, since a range is
 * inherently a range *of one trip's days*.
 *
 * MOVED TO common/ (2026-08-27): daily-location-gallery.html used to
 * live in this trip's own folder and implicitly mean "this trip"; it's
 * now common/daily-location-gallery.html, shared by every trip, chosen
 * via ?trip=<folder>. This script still runs from inside one trip
 * folder and still produces one trip's range page -- see "TRIP IS
 * HARDCODED AT GENERATION TIME" below for how that now works, and
 * common/daily-location-gallery.html's own top comment for the full
 * ?trip= design.
 *
 * MOVED TO scripts/javascript/ (SHARED, August 2026): this script itself
 * used to live inside a single trip's own scripts/javascript/ folder,
 * inferring which trip to act on from its own __dirname (two levels
 * up). It's now shared, one copy for every trip, same convention as
 * refresh-events.js / refresh-notes.js / build-multimedia-location-
 * clusters-data.js -- see "How to run it" below for the required
 * <journal-folder> first argument this now takes.
 *
 * THE DATA IS LIVE, NOT BAKED IN.
 * ---------------------------------
 * This generated page does NOT embed a frozen copy of the location data.
 * It still loads this trip's own
 * data/multimedia-location/multimedia-location-data.js at runtime -- the
 * exact same live runtime mirror common/daily-location-gallery.html
 * itself loads for this trip -- and then, immediately after that loads,
 * runs a small filter that narrows window.MULTIMEDIA_LOCATION_DATA down
 * to just the clusters whose day falls in [start, end]. That means:
 *
 *   - If this trip's data/multimedia-location/multimedia-location-data.js
 *     is later regenerated (new days added, corrected
 *     overview-descriptions, re-clustered, etc. via
 *     scripts/javascript/build-multimedia-location-clusters-data.js),
 *     this range page automatically reflects the update the next time
 *     it's opened -- no need to rerun this script.
 *   - The RANGE itself is still fixed at generation time (embedded as a
 *     tiny inline filter script) -- rerun this script with different
 *     <start>/<end> arguments to get a page scoped to a different range.
 *   - Trade-off: unlike a self-contained snapshot, this output file is
 *     NOT a portable single-file artifact. It depends on this trip's
 *     data/multimedia-location/multimedia-location-data.js and photos/
 *     existing at ../<this trip>/ relative to it (same as the live
 *     template), so it must stay in common/, alongside
 *     daily-location-gallery.html, to work.
 *
 * TRIP IS HARDCODED AT GENERATION TIME
 * -----------------------------------------
 * common/daily-location-gallery.html normally reads ?trip=<folder> from
 * its own URL to decide which trip's data to (synchronously,
 * document.write()-based) load -- see its own top comment. A range page
 * has no room for that: the whole point is a bare, shareable link that
 * needs no query parameters at all. So this script does two textual
 * replacements to the template instead of one:
 *
 *   1. Everything between the template's two marker comments,
 *      <!-- TRIP-DATA-LOADER-START --> and <!-- TRIP-DATA-LOADER-END -->
 *      (which normally hold the ?trip=-reading, document.write-based
 *      loader), is replaced with a plain, hardcoded
 *        <script>window.TRIP_OVERRIDE = "<this trip's folder name>";</script>
 *        <script src="../<this trip>/data/multimedia-location/multimedia-location-data.js" ...></script>
 *      window.TRIP_OVERRIDE is a fallback the template's own main script
 *      checks when ?trip= is absent from the URL -- see "Which trip are
 *      we showing?" in common/daily-location-gallery.html -- so the
 *      generated page opens directly into this trip, no ?trip= typed by
 *      the visitor required.
 *   2. Right after that hardcoded <script src>, a small range-filter
 *      <script> is inserted (same mechanism as before the move) that
 *      narrows window.MULTIMEDIA_LOCATION_DATA down to [start, end]
 *      before the rest of the page's JS ever reads it.
 *
 * If the two TRIP-DATA-LOADER marker comments are ever removed or
 * reworded in common/daily-location-gallery.html, TRIP_LOADER_RE below
 * will stop matching and this script exits with an error instead of
 * silently producing a broken or unscoped page -- restore the markers
 * (or update TRIP_LOADER_RE to match their new form) if that happens.
 *
 * WHY IT READS THE LIVE common/daily-location-gallery.html AS ITS
 * TEMPLATE, INSTEAD OF EMBEDDING ITS OWN COPY OF THE MARKUP/CSS/JS:
 * build-daily-multimedia-gallery.js (the sibling script for daily-
 * gallery.html) embeds its whole HTML/CSS/JS as one large string
 * constant inside the .js file itself. This script deliberately does
 * NOT copy that pattern, because daily-location-gallery.html is a large,
 * still-evolving page and a second, independent copy of its markup
 * embedded in this script would inevitably drift out of sync with the
 * real page over time (a future styling or behavior fix to
 * daily-location-gallery.html would silently NOT apply to range pages
 * unless someone remembered to update this script too). Every other
 * byte of the page -- CSS, map/gallery/Read Aloud JS, the day-picker/
 * trip-picker/empty-state/entry-numbering logic -- comes straight from
 * the real common/daily-location-gallery.html, so a range page
 * generated today always reflects however that page currently looks and
 * behaves.
 *
 * Where it lives
 * ---------------
 *     travel-journals/                     <- the collection root (this
 *       scripts/                              script's own grandparent
 *         javascript/                          directory)
 *           build-daily-location-gallery-for-range.js               <- SHARED, one copy for every trip
 *           build-daily-location-gallery-for-range_Instructions.txt  <- SHARED
 *       common/
 *         daily-location-gallery.html                          <- template (read only)
 *         daily-location-gallery-<start>_to_<end>.html          <- this script's default output (must stay in common/, alongside the template)
 *       travel-journal-2026-07-01/          <- one trip
 *         data/
 *           multimedia-location/
 *             multimedia-location-data.json                     <- read only, for the console summary
 *             multimedia-location-data.js                        <- loaded LIVE by the generated page at runtime
 *       travel-journal-2026-01-14/          <- another trip, same shape
 *
 * How to run it
 * --------------
 * No dependencies -- plain Node.
 *
 *     node scripts/javascript/build-daily-location-gallery-for-range.js <journal-folder> <start> <end> [output-path]
 *
 *   <journal-folder> Which trip to generate a range page for, resolved two
 *                    ways, tried in order: as a path relative to the
 *                    current directory (or absolute), or as a folder name
 *                    directly under the travel-journals collection root
 *                    (e.g. "travel-journal-2026-07-01"). Required.
 *   <start>/<end>    Inclusive date range, YYYY-MM-DD. Both required.
 *                     Plain string comparison (YYYY-MM-DD sorts
 *                     lexicographically = chronologically), so no
 *                     timezone-sensitive date parsing is involved.
 *   [output-path]    Defaults to
 *                     common/daily-location-gallery-<start>_to_<end>.html.
 *                     Pass a different path to save elsewhere, but note
 *                     it still needs to end up in common/ (next to
 *                     daily-location-gallery.html) to work, since it
 *                     depends on that page's own relative "../<trip>/"
 *                     paths to data/ and photos/.
 *
 * Example:
 *     node scripts/javascript/build-daily-location-gallery-for-range.js travel-journal-2026-07-01 2026-07-05 2026-07-13
 *
 * Safe to rerun any time -- always regenerates the range page fresh from
 * whatever common/daily-location-gallery.html currently looks like.
 * Never modifies the template or this trip's data files.
 */
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const [journalArg, startArg, endArg, outArg] = process.argv.slice(2);

function usage() {
  console.error(
    "Usage: node scripts/javascript/build-daily-location-gallery-for-range.js <journal-folder> <start YYYY-MM-DD> <end YYYY-MM-DD> [output-path]\n" +
    "  <journal-folder>  Which trip to generate a range page for. Either a path\n" +
    "                    (relative to the current directory, or absolute) to a\n" +
    "                    travel-journal-YYYY-MM-DD/ folder, or just that folder's\n" +
    "                    name if it lives directly under the travel-journals\n" +
    "                    collection root (e.g. \"travel-journal-2026-07-01\")."
  );
}

if (!journalArg || !startArg || !endArg || !DATE_RE.test(startArg) || !DATE_RE.test(endArg)) {
  usage();
  const available = listAvailableTrips();
  if (available.length) {
    console.error("\nAvailable journal folders under " + COLLECTION_ROOT + ":");
    available.forEach((name) => console.error("  - " + name));
  }
  process.exit(1);
}
if (startArg > endArg) {
  console.error("<start> (" + startArg + ") must not be after <end> (" + endArg + ").");
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
// This trip's own folder name (e.g. "travel-journal-2026-07-01") --
// hardcoded into the generated page's data-loader and used to build its
// "../<trip>/..." media paths, since the generated page carries no
// ?trip= of its own. See "TRIP IS HARDCODED AT GENERATION TIME" above.
const TRIP_FOLDER = path.basename(ROOT);
const COMMON_DIR = path.join(ROOT, "..", "common");
const LOCATION_DATA_JSON_FILE = path.join(ROOT, "data", "multimedia-location", "multimedia-location-data.json");
const LOCATION_DATA_JS_FILE = path.join(ROOT, "data", "multimedia-location", "multimedia-location-data.js");
const TEMPLATE_FILE = path.join(COMMON_DIR, "daily-location-gallery.html");

if (!fs.existsSync(LOCATION_DATA_JS_FILE)) {
  console.error("Missing " + LOCATION_DATA_JS_FILE);
  console.error(
    "This is the live runtime mirror the generated page loads at runtime. Run " +
    "scripts/javascript/build-multimedia-location-clusters-data.js (normal mode, with a " +
    "synthesis file) first to create it."
  );
  process.exit(1);
}
if (!fs.existsSync(TEMPLATE_FILE)) {
  console.error("Missing " + TEMPLATE_FILE);
  console.error("common/daily-location-gallery.html must exist (one level up from every trip folder) to use as a template.");
  process.exit(1);
}

// relative_folder is "photos/YYYY-MM-DD" -- same basename() trick used
// throughout the rest of this project (daily-gallery.html's own
// ?folder=, build-multimedia-location-clusters-data.js's clusterKey(),
// and the client-side filter script this script injects below).
function basename(folder) {
  var parts = String(folder).split("/");
  return parts[parts.length - 1];
}

// Only used for the console summary below -- NOT written into the
// output file. The generated page filters the LIVE data itself, in the
// browser, at load time; this is just a dev-time preview so you know
// roughly what the range will contain before opening it.
let previewCount = null;
let previewDayCount = null;
let previewTotal = null;
if (fs.existsSync(LOCATION_DATA_JSON_FILE)) {
  try {
    const allClusters = JSON.parse(fs.readFileSync(LOCATION_DATA_JSON_FILE, "utf8"));
    const filtered = allClusters.filter(function (c) {
      const d = basename(c.folder);
      return d >= startArg && d <= endArg;
    });
    previewCount = filtered.length;
    previewTotal = allClusters.length;
    previewDayCount = new Set(filtered.map(function (c) { return basename(c.folder); })).size;
  } catch (err) {
    // Non-fatal -- the preview is just a convenience. The generated page
    // doesn't depend on this file at all.
    console.warn("Could not read " + LOCATION_DATA_JSON_FILE + " for a preview count (non-fatal): " + err.message);
  }
}

const template = fs.readFileSync(TEMPLATE_FILE, "utf8");

// Matches the whole ?trip=-reading, document.write-based loader between
// the template's two marker comments (see "TRIP IS HARDCODED AT
// GENERATION TIME" above) -- replaced wholesale, not appended after,
// since this script's version needs neither the runtime ?trip= lookup
// nor the document.write trick: TRIP_FOLDER is already known, so a plain
// static <script src> tag says the same thing more simply.
// The START marker's own HTML comment carries explanatory prose and
// closes with its own "-->" on the same line (it's not a bare, empty
// "<!-- TRIP-DATA-LOADER-START -->" tag) -- match up to that comment's
// own close, then on to the separate, bare TRIP-DATA-LOADER-END comment.
const TRIP_LOADER_RE = /<!-- TRIP-DATA-LOADER-START[\s\S]*?-->[\s\S]*?<!-- TRIP-DATA-LOADER-END -->/;
if (!TRIP_LOADER_RE.test(template)) {
  console.error(
    "Could not find the TRIP-DATA-LOADER-START / TRIP-DATA-LOADER-END marker comments in " + TEMPLATE_FILE +
    " to replace with a hardcoded, range-filtered loader. Have those markers been removed or reworded in " +
    "common/daily-location-gallery.html? Restore them (or update TRIP_LOADER_RE in this script to match their new form)."
  );
  process.exit(1);
}

// Run in document order right after the hardcoded mirror <script src>
// below, so it always executes after multimedia-location-data.js has set
// window.MULTIMEDIA_LOCATION_DATA, and before any later page script
// reads it -- narrowing the LIVE data down to this range, every time the
// page is opened.
const rangeFilterScript =
  "<script>\n" +
  "  (function () {\n" +
  "    var RANGE_START = " + JSON.stringify(startArg) + ", RANGE_END = " + JSON.stringify(endArg) + ";\n" +
  "    function basename(folder) { var parts = String(folder).split(\"/\"); return parts[parts.length - 1]; }\n" +
  "    window.MULTIMEDIA_LOCATION_DATA = (window.MULTIMEDIA_LOCATION_DATA || []).filter(function (c) {\n" +
  "      var d = basename(c.folder);\n" +
  "      return d >= RANGE_START && d <= RANGE_END;\n" +
  "    });\n" +
  // Also narrow the raw multimedia catalog to the same range -- it feeds
  // common/daily-location-gallery.html's own days-with-no-clustered-
  // location fallback (see that file's "Fallback: days with multimedia
  // files but NO clustered location" comment), and without this filter a
  // range page would leak in a pseudo-cluster for every out-of-range day
  // that happens to have GPS-less/unresolved files.
  "    window.MULTIMEDIA_CATALOG = (window.MULTIMEDIA_CATALOG || []).filter(function (e) {\n" +
  "      var d = basename(e.relative_folder);\n" +
  "      return d >= RANGE_START && d <= RANGE_END;\n" +
  "    });\n" +
  "  })();\n" +
  "</script>";

// window.TRIP_OVERRIDE lets the generated page open directly into
// TRIP_FOLDER with no ?trip= in its own URL (see the template's own
// "Which trip are we showing?" comment). The mirror <script src> paths are
// "../<trip>/..." because this output file lives in common/, alongside
// the template, same as the template's own already-relative paths. Both
// the location-cluster mirror and the raw multimedia catalog mirror are
// hardcoded here -- the template loads both the same way (see its own
// TRIP-DATA-LOADER block) so this range page's own no-clustered-location
// fallback works identically to the live, ?trip=-driven page.
const hardcodedLoader =
  "<!-- TRIP-DATA-LOADER-START (replaced by build-daily-location-gallery-for-range.js: hardcoded to " +
  TRIP_FOLDER + ", range " + startArg + ".." + endArg + ") -->\n" +
  "<script>window.TRIP_OVERRIDE = " + JSON.stringify(TRIP_FOLDER) + ";</script>\n" +
  "<script src=\"../" + TRIP_FOLDER + "/data/multimedia-location/multimedia-location-data.js\" " +
  "onerror=\"window.MULTIMEDIA_LOCATION_DATA = window.MULTIMEDIA_LOCATION_DATA || []\"></script>\n" +
  "<script src=\"../" + TRIP_FOLDER + "/data/multimedia/multimedia-data.js\" " +
  "onerror=\"window.MULTIMEDIA_CATALOG = window.MULTIMEDIA_CATALOG || []\"></script>\n" +
  rangeFilterScript + "\n" +
  "<!-- TRIP-DATA-LOADER-END -->";

let output = template.replace(TRIP_LOADER_RE, hardcodedLoader);

const generatedNote =
  "<!-- Range view generated by build-daily-location-gallery-for-range.js: " +
  TRIP_FOLDER + ", " + startArg + " .. " + endArg + ", " + new Date().toISOString() + ". " +
  "Data loads LIVE from ../" + TRIP_FOLDER + "/data/multimedia-location/multimedia-location-data.js " +
  "at runtime, filtered to this range -- this file is not a frozen snapshot. -->\n";
output = output.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n" + generatedNote.trim());

const defaultOutName = "daily-location-gallery-" + startArg + "_to_" + endArg + ".html";
const OUT_PATH = outArg ? path.resolve(outArg) : path.join(COMMON_DIR, defaultOutName);
fs.writeFileSync(OUT_PATH, output, "utf8");

console.log("Wrote " + OUT_PATH);
console.log("Fixed to trip: " + TRIP_FOLDER + ". Data is LIVE: loaded from ../" + TRIP_FOLDER + "/data/multimedia-location/multimedia-location-data.js at page-open time, then filtered to " + startArg + ".." + endArg + " in the browser.");
if (previewCount !== null) {
  console.log(
    "Preview (as of right now): " + previewCount + " cluster(s) across " + previewDayCount +
    " day(s) within that range (of " + previewTotal + " total clusters currently in " + LOCATION_DATA_JSON_FILE + ")."
  );
  if (!previewCount) {
    console.log("WARNING: no clusters currently fall within that date range -- the page's day picker will be empty until the data changes.");
  }
} else {
  console.log(previewTotal === null && !fs.existsSync(LOCATION_DATA_JSON_FILE)
    ? ("Note: " + LOCATION_DATA_JSON_FILE + " not found, so no preview count is available (the generated page doesn't need this file -- only the .js mirror -- so this is harmless).")
    : "Note: preview count unavailable (see warning above); the generated page will still work correctly, filtering the live data at load time.");
}
console.log("Remember: this file must stay in common/ (alongside daily-location-gallery.html) to load its data and images.");
