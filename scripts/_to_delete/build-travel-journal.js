#!/usr/bin/env node
/**
 * RETIRED (August 2026) -- moved to scripts/_to_delete/, no longer run by
 * anything in this project. Every trip's index.html was replaced by its
 * own former index-dynamic.html (a client-side-rendered page that needs
 * no rebuild step at all -- see that trip's index.html top-of-script
 * comment), and the old index.html this script generated was deleted.
 * Kept here for reference only -- see
 * scripts/_to_delete/build-travel-journal_Instructions.txt's own final
 * section for the full retirement notes. Do not run this script: it
 * would write a stale-format index.html that nothing else in the
 * project expects or reads.
 *
 * build-travel-journal.js
 * --------------------------
 * Recreates the combined travel journal — manifest.js and index.html — for
 * an arbitrary inclusive date range given on the command line:
 *
 *     node scripts/javascript/build-travel-journal.js <journal-folder> <start> <end> [--title "Custom Title"]
 *
 *   <journal-folder> Which trip to build, resolved two ways, tried in
 *                    order: as a path relative to the current directory
 *                    (or absolute), or as a folder name directly under
 *                    the travel-journals collection root (e.g.
 *                    "travel-journal-2026-07-01"). Required.
 *   <start>/<end>    Inclusive range, YYYY-MM-DD. Both required.
 *   --title "text"   Optional. Sets this trip's <title>/<h1> text (the
 *                    🧳 emoji is always prefixed onto <h1> separately, so
 *                    don't include it here). If omitted, a trip that
 *                    already has an index.html keeps its current title
 *                    as-is (so a plain rebuild never clobbers a name
 *                    customized earlier, e.g. "Travel Journal 2026
 *                    Summer"); a trip with no index.html yet defaults to
 *                    plain "Travel Journal".
 *
 * MOVED TO scripts/javascript/ (SHARED, August 2026): this script itself
 * used to live inside a single trip's own scripts/javascript/ folder,
 * inferring which trip to build from its own __dirname (two levels up).
 * It's now shared, one copy for every trip, same convention as
 * refresh-events.js / refresh-notes.js / build-multimedia-location-
 * clusters-data.js -- hence the new required <journal-folder> first
 * argument above. Nothing about what gets built, per trip, changed.
 *
 * Successor to scripts/_to_delete/build-journal.js — see this script's own
 * Instructions.txt ("Claude's resolved query") for why a new script instead
 * of just editing the old one, and exactly what changed. In short:
 *   - JOURNAL_START/JOURNAL_END are now CLI arguments, not constants baked
 *     into the script, so one script rebuilds the journal for any range.
 *   - The multi-day "where you are" location bands (the "All Day" <li>s at
 *     the top of each day's Events list) are no longer a hand-transcribed
 *     LOCATION_BANDS constant. They're now derived automatically from the
 *     "locale" column of data/travel-details/travel-details.json — see
 *     computeLocationBands() below — so rebuilding for a new range needs no
 *     manual transcription step first.
 *   - Each day now also gets a "Travel Details" section (Trip/Locale/
 *     Lodging/Transportation/Meals/Activities/Trip Notes), placed before
 *     Notes, populated client-side from data/travel-details/
 *     travel-details-data.js — the same client-side-population pattern
 *     Events and Notes already use, and the same pattern
 *     refresh-travel-details.py's OUTPUT_JS_BASENAME mirror was built for.
 *   - manifest.js and each day's photo-link now include VIDEOS, not just
 *     images (MEDIA_RE = IMAGE_RE | VIDEO_RE) — the old build-journal.js
 *     only ever matched image extensions, so .mp4/.mov clips sitting in a
 *     photos/YYYY-MM-DD folder were silently invisible to manifest.js and
 *     didn't count toward that day's photo-link. See "MANIFEST.JS NOW
 *     INCLUDES VIDEOS" in this script's Instructions.txt.
 *   - The header nav now includes a "Daily Gallery" link (next to "Daily
 *     Notes") to ./daily-gallery.html with no query string — the "All
 *     Days" day-picker view built by build-daily-multimedia-gallery.js.
 *     See "HEADER LINK TO DAILY GALLERY" in this script's Instructions.txt.
 *
 * Like its predecessor: no npm dependencies, but shells out to poppler's
 * `pdftoppm` to rasterize rideWithGPS PDFs to images (must be on PATH).
 * Events, Notes, and Travel Details content are NOT hardcoded here — all
 * three are populated entirely CLIENT-SIDE at page-load time, from
 * data/events/events-data.js, data/daily-notes/daily-notes-data.js, and
 * data/travel-details/travel-details-data.js respectively (mirrors that
 * refresh-events.js, refresh-notes.js, and refresh-travel-details.py each
 * write alongside their own .json file). Re-running just one of those
 * refresh scripts (without re-running this one) is enough for index.html to
 * pick up new events/notes/travel-details on next page load — this script
 * only needs to be re-run when the date RANGE changes, or when photo
 * folders / rideWithGPS PDFs / the travel-details locale column change in a
 * way that should affect which days get a photo link, ride embed, or
 * location band.
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

// ---- CLI args: <journal-folder> <start> <end> [--title "text"] -----------
// Parsed here (ahead of parseArgs() below, which just handles <start>/
// <end>) because TRIP_FOLDER/TITLE_TEXT are both needed before writeIndex()
// runs, and TITLE_TEXT's own default depends on ROOT already being known.
const rawArgs = process.argv.slice(2);
let titleOverride = null;
const titleFlagIdx = rawArgs.indexOf("--title");
if (titleFlagIdx !== -1) {
  titleOverride = rawArgs[titleFlagIdx + 1] || null;
  rawArgs.splice(titleFlagIdx, 2);
}
const [journalArg, ...dateArgs] = rawArgs;

function journalUsage() {
  console.error("Usage: node scripts/javascript/build-travel-journal.js <journal-folder> <start> <end> [--title \"Custom Title\"]");
  console.error("  <journal-folder>  Which trip to build. Either a path (relative to the current");
  console.error("                    directory, or absolute) to a travel-journal-YYYY-MM-DD/ folder,");
  console.error("                    or just that folder's name if it lives directly under the");
  console.error("                    travel-journals collection root (e.g. \"travel-journal-2026-07-01\").");
}

if (!journalArg) {
  journalUsage();
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
// This trip's own folder name (e.g. "travel-journal-2026-07-01"), used to
// build the ?trip= parameter on every link to common/daily-location-
// gallery.html below -- see "PHOTO-LINK NOW POINTS AT common/" further
// down for why that page needs this at all.
const TRIP_FOLDER = path.basename(ROOT);

// The <title>/<h1> text (without the 🧳 emoji, which is always prefixed
// onto <h1> separately). --title always wins; otherwise, if this trip
// already has an index.html, its current <title> is reused as-is so a
// plain rebuild never clobbers a name that was customized for this trip
// earlier (e.g. "Travel Journal 2026 Summer") -- only an explicit --title
// changes it. A trip with no index.html yet (first build) falls back to
// plain "Travel Journal".
function existingTitle(root) {
  const indexPath = path.join(root, "index.html");
  if (!fs.existsSync(indexPath)) return null;
  const html = fs.readFileSync(indexPath, "utf8");
  const m = html.match(/<title>([\s\S]*?)<\/title>/);
  return m ? m[1].trim() : null;
}
const TITLE_TEXT = titleOverride || existingTitle(ROOT) || "Travel Journal";
const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|svg)$/i;
// Same video-extension set daily-location-gallery.html's own isVideo() uses
// (VIDEO_EXT_RE there) -- kept identical so a file this script now counts
// as a "video" is exactly one that gallery already knows how to embed with
// a <video> tag instead of an <img> tag.
const VIDEO_RE = /\.(mp4|mov|m4v|avi|webm|mkv)$/i;
const MEDIA_RE = new RegExp(IMAGE_RE.source + "|" + VIDEO_RE.source, "i");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const [start, end] = argv;
  if (!start || !end) {
    journalUsage();
    console.error("  <start>/<end>     Inclusive range, YYYY-MM-DD. Both required.");
    console.error("  --title \"text\"    Optional -- see the module comment at the top of this file.");
    process.exit(1);
  }
  if (!DATE_RE.test(start)) { console.error(`Invalid start date ${start} — expected YYYY-MM-DD.`); process.exit(1); }
  if (!DATE_RE.test(end)) { console.error(`Invalid end date ${end} — expected YYYY-MM-DD.`); process.exit(1); }
  if (end < start) { console.error(`end date ${end} is before start date ${start}.`); process.exit(1); }
  return { start, end };
}

// ---- Date helpers ---------------------------------------------------------
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtLabel(d) {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const year = d.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" });
  return `${md}, ${year} — ${weekday}`;
}
function allDaysBetween(startIso, endIso) {
  const days = [];
  const start = new Date(startIso + "T12:00:00Z");
  const end = new Date(endIso + "T12:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}
function nextDayIso(iso) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Location bands, derived from data/travel-details/travel-details.json
// ---------------------------------------------------------------------------
// Replaces the old hand-transcribed LOCATION_BANDS constant: groups
// calendar-CONSECUTIVE rows (no gaps -- a missing row breaks the run, same
// as a locale change does) that share the same trimmed, non-empty "locale"
// string into one {start, end, label} band. A day with a null/blank locale,
// or with no row in travel-details.json at all, simply isn't part of any
// band -- exactly like a day outside every old LOCATION_BANDS range used to
// render with no "All Day" band item.
const TRAVEL_DETAILS_JSON = path.join(ROOT, "data", "travel-details", "travel-details.json");

function loadTravelDetailsRows() {
  if (!fs.existsSync(TRAVEL_DETAILS_JSON)) return [];
  try {
    const rows = JSON.parse(fs.readFileSync(TRAVEL_DETAILS_JSON, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error(`Warning: could not parse ${TRAVEL_DETAILS_JSON} (${err.message}) -- proceeding with no location bands.`);
    return [];
  }
}

function computeLocationBands(rows) {
  const sorted = rows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const bands = [];
  let current = null;
  for (const row of sorted) {
    const locale = row.locale == null ? null : String(row.locale).trim();
    const continuesRun = current && locale && current.label === locale && nextDayIso(current.end) === row.date;
    if (continuesRun) {
      current.end = row.date;
    } else {
      if (current) bands.push(current);
      current = locale ? { start: row.date, end: row.date, label: locale } : null;
    }
  }
  if (current) bands.push(current);
  return bands;
}

// ---- Scan photo folders --------------------------------------------------
// Dated multimedia folders live under photos/ (not the project root) --
// each one holds both photos and, on some days, videos (.mp4/.mov straight
// off a phone). manifest.js (window.PHOTO_MANIFEST) lists BOTH -- MEDIA_RE
// (IMAGE_RE | VIDEO_RE), not IMAGE_RE alone -- so a day's photo-link count
// and gallery.html's ?folder= viewer both see every file, not just images.
const PHOTOS_DIR = path.join(ROOT, "photos");

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function scanPhotoFolders() {
  if (!fs.existsSync(PHOTOS_DIR)) return {};
  const entries = fs.readdirSync(PHOTOS_DIR, { withFileTypes: true });
  const folders = {};
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dirPath = path.join(PHOTOS_DIR, entry.name);
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(f => f.isFile() && MEDIA_RE.test(f.name) && f.name !== "mapPreview.png")
      .map(f => f.name)
      .sort(naturalCompare);
    if (files.length) folders[entry.name] = files;
  }
  return folders;
}

// ---- Scan rideWithGPS PDFs -------------------------------------------------
// Files are named like "2026-07-08-2_-_Sisterbike_25_Day_4-_Barge_arrived.pdf"
// — a leading YYYY-MM-DD (optionally with a "-N" suffix when a day has more
// than one PDF) identifies which journal day the ride report belongs to.
const RIDE_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:-\d+)?_-?_?/;

function rideLabel(filename) {
  return filename
    .replace(RIDE_DATE_RE, "")
    .replace(/\.pdf$/i, "")
    .replace(/_/g, " ")
    .trim();
}

// Ride report PDFs are single-page RideWithGPS route-map exports. The
// journal displays them as images, not embedded PDFs, so each PDF is
// rasterized once (via poppler's pdftoppm) into rideWithGPS/images/<name>.png
// — regenerated only when missing or older than its source PDF. Safe to
// delete rideWithGPS/images/ any time; it's fully derived from the PDFs.
const RIDE_IMAGE_DIR = path.join(ROOT, "rideWithGPS", "images");

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
  const dir = path.join(ROOT, "rideWithGPS");
  if (!fs.existsSync(dir)) return {};
  const byDate = {};
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && /\.pdf$/i.test(f.name))
    .map(f => f.name)
    .sort(naturalCompare);
  for (const name of files) {
    const m = RIDE_DATE_RE.exec(name);
    if (!m) continue; // filename doesn't start with a date — skip
    const date = m[1];
    const image = ensureRideImage(path.join(dir, name));
    (byDate[date] = byDate[date] || []).push({ file: name, label: rideLabel(name), image });
  }
  return byDate;
}

function writeManifest(folders) {
  const contents =
    "// Auto-generated by build-travel-journal.js — do not edit by hand.\n" +
    "// Maps each dated folder to its list of multimedia filenames (photos AND\n" +
    "// videos -- see MEDIA_RE in build-travel-journal.js), used by gallery.html\n" +
    "// for ?folder=<name> links.\n" +
    "// IMPORTANT: assigned onto window (not `const`/`let`) — a top-level\n" +
    "// const/let in a classic <script> does NOT become a window property.\n" +
    "window.PHOTO_MANIFEST = " + JSON.stringify(folders, null, 2) + ";\n";
  fs.writeFileSync(path.join(ROOT, "manifest.js"), contents);
}

// ---- Build index.html ------------------------------------------------------
function writeIndex(journalStart, journalEnd, photoFolders, rideReports, locationBands) {
  const days = allDaysBetween(journalStart, journalEnd);
  const allFiles = Object.values(photoFolders).flat();
  const totalVideos = allFiles.filter(f => VIDEO_RE.test(f)).length;
  const totalPhotos = allFiles.length - totalVideos;
  const daysWithPhotos = Object.keys(photoFolders).length;
  const totalCountParts = [`${totalPhotos} photo${totalPhotos === 1 ? "" : "s"}`];
  if (totalVideos) totalCountParts.push(`${totalVideos} video${totalVideos === 1 ? "" : "s"}`);

  const sections = days.map(d => {
    const key = isoDate(d);
    const bands = locationBands.filter(b => key >= b.start && key <= b.end);
    const photos = photoFolders[key];
    const rides = rideReports[key];

    // Multi-day "where you are" bands render as "All Day" list items,
    // listed before the day's timed events (not as a separate italic
    // "Location:" line) — same list, same non-italic style throughout.
    const bandItems = bands.map(b =>
      `<li class="band-item"><span class="time">All Day</span> ${escapeHtml(b.label)}</li>`
    );
    const bandItemsHtml = bandItems.map(i => "        " + i).join("\n");

    // Event <li>s themselves are added client-side (from
    // window.EVENTS_DATA, loaded from data/events/events-data.js) -- this
    // <ul> starts out with just the build-time band items (if any) plus an
    // id/data-date the rendering script at the bottom of this template
    // uses to find and populate it. The "no-events" fallback paragraph
    // starts hidden and is only revealed by that script if the list is
    // still empty after adding this date's events.
    const eventHtml = `<div class="notes-label">Events</div>
      <ul class="events" id="events-${key}" data-date="${key}">
${bandItemsHtml}
      </ul>
      <p class="no-events" id="no-events-${key}" style="display:none;">No scheduled events.</p>`;

    // photos[] mixes images and videos (see MEDIA_RE above) -- split the
    // link's count label the same way daily-location-gallery.html labels
    // its own counts ("N photos, M videos"), so the label stays accurate
    // now that a folder full of clips wouldn't otherwise read as "0 photos".
    const videoCount = photos ? photos.filter(f => VIDEO_RE.test(f)).length : 0;
    const photoCount = photos ? photos.length - videoCount : 0;
    const countParts = [];
    if (photoCount) countParts.push(`${photoCount} photo${photoCount === 1 ? "" : "s"}`);
    if (videoCount) countParts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
    const photoHtml = photos
      ? `<hr class="divider">
      <a class="photo-link" href="../common/daily-location-gallery.html?trip=${encodeURIComponent(TRIP_FOLDER)}&date=${encodeURIComponent(key)}" target="_blank" rel="noopener">📷 ${countParts.join(", ")} →</a>
      <div class="day-map-mini" id="daymap-${key}" data-date="${key}">
        <div class="day-map-mini-canvas"></div>
        <div class="day-map-mini-empty">Map</div>
      </div>`
      : "";

    // Travel Details content itself is added client-side (from
    // window.TRAVEL_DETAILS_DATA, loaded from data/travel-details/
    // travel-details-data.js) -- placed before Notes. Starts out showing
    // the "no travel details" fallback; the rendering script at the bottom
    // of this template replaces it with labeled fields if that date has a
    // row in travel-details.json with at least one non-null field.
    const travelDetailsHtml = `<div class="travel-details-block">
        <div class="notes-label">Travel Details</div>
        <div class="travel-details-content" id="travel-details-${key}" data-date="${key}">
          <p class="no-events">No travel details for this day.</p>
        </div>
      </div>`;

    // Notes content itself is added client-side (from
    // window.DAILY_NOTES_DATA, loaded from data/daily-notes/daily-notes-
    // data.js) -- this starts out showing the "no notes" fallback; the
    // rendering script at the bottom of this template replaces it with
    // formatted paragraphs if that date has a note.
    const notesHtml = `<div class="notes-block">
        <div class="notes-label">Notes</div>
        <div class="notes-content" id="notes-${key}" data-date="${key}">
          <p class="no-events">No notes for this day.</p>
        </div>
      </div>`;

    const rideHtml = rides
      ? `<div class="rides-block">
        <div class="notes-label">Cycle Routes</div>
${rides.map(r =>
          `        <div class="ride-embed">
          <div class="ride-caption">🚴 ${escapeHtml(r.label)}</div>
          <img class="ride-image" src="./rideWithGPS/images/${encodeURIComponent(r.image)}" alt="${escapeHtml(r.label)}">
          <a class="photo-link" href="./rideWithGPS/${encodeURIComponent(r.file)}" target="_blank" rel="noopener">View PDF →</a>
        </div>`
        ).join("\n")}
      </div>`
      : "";

    const [dateStr, weekdayStr] = fmtLabel(d).split(" — ");

    return `  <section class="day" id="${key}">
    <h2><span class="day-weekday">${escapeHtml(weekdayStr)}</span><span class="day-date">${escapeHtml(dateStr)}</span></h2>
    <div class="day-body">
      ${eventHtml}
      ${travelDetailsHtml}
      ${notesHtml}
      ${photoHtml}
      ${rideHtml}
    </div>
  </section>`;
  }).join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${TITLE_TEXT}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;0,900;1,500;1,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  :root {
    --ink: #1c2b3a;
    --ink-soft: #5c5445;
    --paper: #f7f2e6;
    --paper-alt: #efe4cd;
    --brass: #b8863b;
    --brass-dark: #8f6526;
    --brick: #a1432f;
    --sea: #3f6e64;
    --rule: #ddccaa;
    --white: #fffdf8;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    padding: 16px 20px;
    background: linear-gradient(180deg, var(--paper-alt) 0%, var(--paper) 100%);
    border-bottom: 1px solid var(--rule);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  header .header-main { flex: 1; text-align: center; }
  header h1 {
    margin: 0 0 4px;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-style: italic;
    font-size: 30px;
    color: var(--ink);
  }
  header .sub {
    color: var(--ink-soft);
    font-size: 16px;
    font-family: 'IBM Plex Mono', monospace;
    letter-spacing: 0.01em;
  }
  header .header-nav {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 20px;
    padding-top: 8px;
  }
  header .header-nav a {
    color: var(--brass-dark);
    text-decoration: none;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 600;
    white-space: nowrap;
  }
  header .header-nav a:hover { color: var(--sea); text-decoration: underline; }

  main { width: 90%; margin: 0 auto; padding: 24px 32px 80px; max-width: none; }

  .day {
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--white);
    margin-bottom: 16px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(28,43,58,0.06);
  }
  .day h2 {
    margin: 0;
    padding: 14px 20px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper-alt);
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .day h2 .day-weekday {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--sea);
    font-weight: 600;
  }
  .day h2 .day-date {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 21px;
    color: var(--ink);
  }
  .day-body { padding: 14px 20px 18px; }
  ul.events { list-style: none; margin: 8px 0 0; padding: 0; }
  ul.events li {
    font-size: 16.5px;
    padding: 3px 0;
    color: var(--ink-soft);
  }
  ul.events li.band-item .time { color: var(--sea); }
  .time {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 600;
    font-size: 0.86em;
    color: var(--brass-dark);
    margin-right: 6px;
  }
  .cal { color: var(--ink-soft); font-style: italic; font-size: 15px; }
  .no-events { color: var(--ink-soft); font-size: 16.5px; font-style: italic; margin: 8px 0 0; }
  hr.divider {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 14px 0 10px;
  }

  .photo-link {
    display: inline-block;
    margin-top: 8px;
    color: var(--brass-dark);
    text-decoration: none;
    font-size: 16px;
    font-weight: 600;
  }
  .photo-link:hover { color: var(--sea); text-decoration: underline; }

  .day-map-mini {
    position: relative;
    /* Establishes its own stacking context (position + explicit z-index)
       so Leaflet's internal panes/controls -- which use z-index values up
       to 1000 -- are contained within this box instead of leaking out and
       comparing directly against the sticky header's z-index:10. Without
       this, the map paints OVER the header as it scrolls past underneath
       it. The value itself just needs to be explicit (not "auto") and low
       enough to stay under the header from outside this box's context. */
    z-index: 1;
    display: block;
    width: 50vw;
    max-width: 100%;
    aspect-ratio: 3 / 2;
    margin: 12px auto 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--rule);
    background: var(--paper-alt);
  }
  .day-map-mini-canvas { position: absolute; inset: 0; }
  .day-map-mini:not(.has-map) .day-map-mini-canvas { display: none; }
  .day-map-mini.has-map .day-map-mini-empty { display: none; }
  .day-map-mini-empty {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--ink-soft);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: center;
    padding: 6px;
  }
  .day-map-mini .leaflet-control-attribution {
    font-size: 9px;
    line-height: 1.3;
    padding: 0 4px;
    background: rgba(247,242,230,0.75);
  }
  .day-map-mini .leaflet-popup-content-wrapper { font-family: 'Public Sans', sans-serif; border-radius: 4px; }
  @media (max-width:640px) {
    .day-map-mini { width: 80vw; }
  }

  .notes-block, .travel-details-block { margin-top: 16px; }
  .notes-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--brass-dark);
  }
  .notes-content, .travel-details-content { margin-top: 8px; }
  .notes-content p, .travel-details-content p {
    font-size: 16.5px;
    line-height: 1.55;
    margin: 0 0 10px;
    color: var(--ink-soft);
  }
  .notes-content p:last-child, .travel-details-content p:last-child { margin-bottom: 0; }

  .rides-block { margin-top: 16px; }
  .ride-embed { margin-top: 10px; text-align: center; }
  .ride-caption {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 600;
    font-size: 17px;
    color: var(--sea);
    margin-bottom: 6px;
  }
  .ride-image {
    display: block;
    width: 70%;
    margin: 0 auto;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: #fff;
  }

  footer {
    text-align: center;
    color: var(--ink-soft);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.02em;
    padding: 24px 20px;
  }
</style>
</head>
<body id="top">

<header>
  <div class="header-main">
    <h1>🧳 ${TITLE_TEXT}</h1>
    <div class="sub">${fmtLabel(days[0]).split(" — ")[0]} – ${fmtLabel(days[days.length - 1]).split(" — ")[0]} · ${daysWithPhotos} day${daysWithPhotos === 1 ? "" : "s"} with photos · ${totalCountParts.join(", ")} total</div>
  </div>
  <nav class="header-nav">
    <a href="#top">↑ Top</a>
    <a href="#bottom">↓ Bottom</a>
    <a href="https://drive.google.com/drive/folders/1ttD3a7HFxSglFDPDf4Yex5TPoqB6l6of" target="_blank" rel="noopener">Daily Notes</a>
    <a href="../common/daily-gallery.html?trip=${encodeURIComponent(TRIP_FOLDER)}" target="_blank" rel="noopener">Daily Gallery</a>
  </nav>
</header>

<main>
${sections}
</main>

<footer id="bottom">Generated by build-travel-journal.js — combines calendar events, dated photo folders, daily notes from Google Drive ("My Drive/dailyNotes", docs titled "Daily Note YYYY-MM-DD"), and travel-details.json (from TravelDetails.ods). Notes are read-only here: to change one, edit the Google Doc and ask Claude to regenerate this page.</footer>


<script src="./data/events/events-data.js" onerror="window.EVENTS_DATA = window.EVENTS_DATA || {events:{}}"></script>
<script src="./data/daily-notes/daily-notes-data.js" onerror="window.DAILY_NOTES_DATA = window.DAILY_NOTES_DATA || {}"></script>
<script src="./data/travel-details/travel-details-data.js" onerror="window.TRAVEL_DETAILS_DATA = window.TRAVEL_DETAILS_DATA || {}"></script>
<script>
(function () {
  // Populates each day's Events <ul>, Travel Details content, and Notes
  // content live, from window.EVENTS_DATA (data/events/events-data.js,
  // written by refresh-events.js), window.TRAVEL_DETAILS_DATA (data/
  // travel-details/travel-details-data.js, written by refresh-travel-
  // details.py), and window.DAILY_NOTES_DATA (data/daily-notes/daily-
  // notes-data.js, written by refresh-notes.js) -- none of these are baked
  // into this HTML at build time. All three mirrors set their global to a
  // safe empty default via onerror above if the file is missing (e.g.
  // before that refresh script has ever been run), so this still renders
  // every day's build-time band items and "No scheduled events."/"No
  // travel details for this day."/"No notes for this day." fallbacks
  // cleanly rather than erroring.
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var eventsByDate = (window.EVENTS_DATA && window.EVENTS_DATA.events) || {};
  document.querySelectorAll(".events[data-date]").forEach(function (ul) {
    var date = ul.getAttribute("data-date");
    var dayEvents = eventsByDate[date] || [];
    dayEvents.forEach(function (e) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="time">' + esc(e.time) + '</span> ' + esc(e.title)
        + ' <span class="cal">[' + esc(e.cal) + ']</span>';
      ul.appendChild(li);
    });
    // Empty even after band items + fetched events -> show the "no
    // scheduled events" fallback instead of an empty-looking box.
    if (!ul.querySelector("li")) {
      ul.style.display = "none";
      var fallback = document.getElementById("no-events-" + date);
      if (fallback) fallback.style.display = "";
    }
  });

  var notesByDate = window.DAILY_NOTES_DATA || {};
  document.querySelectorAll(".notes-content[data-date]").forEach(function (container) {
    var date = container.getAttribute("data-date");
    var noteText = notesByDate[date];
    if (!noteText) return; // leave the default "No notes for this day." fallback in place
    var paras = noteText.split(/\\n\\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    container.innerHTML = paras.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("\\n");
  });

  var travelDetailsByDate = window.TRAVEL_DETAILS_DATA || {};
  var TRAVEL_DETAIL_FIELDS = [
    ["trip_name", "Trip"],
    ["locale", "Locale"],
    ["lodging", "Lodging"],
    ["transportation", "Transportation"],
    ["meals", "Meals"],
    ["activities", "Activities"],
    ["notes", "Trip Notes"]
  ];
  document.querySelectorAll(".travel-details-content[data-date]").forEach(function (container) {
    var date = container.getAttribute("data-date");
    var detail = travelDetailsByDate[date];
    if (!detail) return; // no row for this date in travel-details.json -- leave the fallback in place
    var rows = TRAVEL_DETAIL_FIELDS
      .map(function (pair) { return [pair[1], detail[pair[0]]]; })
      .filter(function (pair) { return pair[1]; });
    if (!rows.length) return; // row exists but every field besides date is blank
    container.innerHTML = rows.map(function (pair) {
      return "<p><strong>" + esc(pair[0]) + ":</strong> " + esc(pair[1]).replace(/\\n/g, "<br>") + "</p>";
    }).join("\\n");
  });
})();
</script>
<script src="./data/multimedia-location/multimedia-location-data.js" onerror="window.MULTIMEDIA_LOCATION_DATA = window.MULTIMEDIA_LOCATION_DATA || []"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  // Groups the live multimedia-location clusters by day (basename of each
  // cluster's "folder" field, e.g. "photos/2026-07-12" -> "2026-07-12") --
  // same convention used throughout this project (daily-location-
  // gallery.html, build-daily-location-gallery-for-range.js).
  function basename(folder) { var parts = String(folder).split("/"); return parts[parts.length - 1]; }
  function escapeHtmlJs(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var byDate = {};
  (window.MULTIMEDIA_LOCATION_DATA || []).forEach(function (c) {
    if (c.centroid_lat == null || c.centroid_lon == null) return;
    var d = basename(c.folder);
    (byDate[d] = byDate[d] || []).push(c);
  });

  var containers = Array.prototype.slice.call(document.querySelectorAll(".day-map-mini"));
  if (!containers.length) return;

  function renderMiniMap(el) {
    var date = el.getAttribute("data-date");
    var emptyEl = el.querySelector(".day-map-mini-empty");
    // Leaflet loads from a CDN (unpkg) via <script src>; if that request
    // fails (offline, blocked, ad-blocker), L never gets defined -- hide
    // the box entirely rather than show a broken/empty map frame, same
    // resilience approach daily-location-gallery.html's renderMap() uses.
    if (typeof L === "undefined") {
      el.style.display = "none";
      return;
    }
    var clusters = byDate[date];
    if (!clusters || !clusters.length) {
      if (emptyEl) emptyEl.textContent = "No mapped locations";
      return;
    }
    // IMPORTANT: reveal the canvas (by adding "has-map", which flips the
    // CSS that keeps .day-map-mini-canvas at display:none until then)
    // BEFORE calling L.map() on it. Leaflet reads the container's actual
    // pixel size at init time -- initializing it while still display:none
    // gives it a 0x0 box, so fitBounds()/setZoom() compute a broken view
    // that never corrects itself even after the box becomes visible a
    // moment later. Revealing first means Leaflet sees the real
    // (50vw x aspect-ratio) size from the start.
    el.classList.add("has-map");
    var canvas = el.querySelector(".day-map-mini-canvas");
    var map = L.map(canvas, { scrollWheelZoom: false, zoomControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }).addTo(map);

    var pins = clusters.map(function (c) { return [c.centroid_lat, c.centroid_lon]; });
    if (pins.length > 1) {
      L.polyline(pins, { color: '#b8863b', weight: 2, dashArray: '2,6', opacity: 0.8 }).addTo(map);
    }
    clusters.forEach(function (c) {
      L.circleMarker([c.centroid_lat, c.centroid_lon], {
        radius: 6, weight: 2, color: '#b8863b', fillColor: '#1c2b3a', fillOpacity: 1
      }).addTo(map).bindPopup('<strong>' + escapeHtmlJs(c.location_label || 'Unknown location') + '</strong>');
    });

    var bounds = L.latLngBounds(pins);
    map.fitBounds(bounds, { padding: [10, 10] });
    if (pins.length === 1) map.setZoom(14);
    // Safety net: force Leaflet to re-measure its container in case the
    // box's real size wasn't fully settled yet (e.g. web font swap still
    // reflowing layout) when fitBounds() ran above.
    setTimeout(function () { map.invalidateSize(); }, 0);
  }

  // Lazily init each mini-map only once it's near the viewport -- with
  // potentially dozens of these on one page, initializing all of them (and
  // firing all their OpenStreetMap tile requests) at once on page load
  // would be wasteful and slow. IntersectionObserver defers each one until
  // it's about to scroll into view.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          renderMiniMap(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "200px" });
    containers.forEach(function (el) { io.observe(el); });
  } else {
    containers.forEach(renderMiniMap);
  }
})();
</script>
</body>
</html>
`;

  fs.writeFileSync(path.join(ROOT, "index.html"), html);
}

// ---------------------------------------------------------------------------
const { start, end } = parseArgs(dateArgs);
const photoFolders = scanPhotoFolders();
const rideReports = scanRideReports();
const travelDetailsRows = loadTravelDetailsRows();
const locationBands = computeLocationBands(travelDetailsRows);

writeManifest(photoFolders);
writeIndex(start, end, photoFolders, rideReports, locationBands);

console.log(`Rebuilt the journal for ${start}..${end}.`);
console.log(`Found media for ${Object.keys(photoFolders).length} day(s) (photos and videos).`);
console.log(`Found ride reports for ${Object.keys(rideReports).length} day(s).`);
console.log(`Derived ${locationBands.length} location band(s) from ${travelDetailsRows.length} travel-details.json row(s):`);
locationBands.forEach(b => console.log(`  ${b.start} .. ${b.end}  ${b.label}`));
console.log("Events, Notes, and Travel Details are loaded client-side from data/events/events-data.js, data/daily-notes/daily-notes-data.js, and data/travel-details/travel-details-data.js (not baked in at build time).");
console.log("Wrote manifest.js and index.html.");
