#!/usr/bin/env node
/**
 * refresh-events.js
 * ------------------
 * SHARED SCRIPT — lives once at <travel-journals>/scripts/javascript/ and
 * is used by every travel-journal-YYYY-MM-DD/ trip. Because one copy now
 * serves every trip, the trip to act on is a required first argument
 * (see "CLI args" below) rather than being inferred from __dirname the
 * way a per-trip script would.
 *
 * Turns raw Google Calendar exports from five calendars ("Events Hans",
 * "Travel", "Birthdays", "Holidays in Sweden", "Victoria Arthaud") into
 * one deduplicated, day-by-day events data file for a given trip
 * (<trip>/data/events/events-data.json, plus its runtime-mirror sibling
 * <trip>/data/events/events-data.js). That trip's journal page
 * (common/journal.html?trip=<folder>, a client-side-rendered page shared
 * by every trip -- see its own top-of-script comment) loads that mirror
 * via <script src> and reads it as window.EVENTS_DATA — no separate
 * merge/copy step.
 *
 * WHY THIS IS A TWO-STEP, CLAUDE-MEDIATED SCRIPT (same reason as
 * refresh-notes.js): this plain Node script has no Google credentials and
 * can't call the Calendar API itself. Refreshing events is therefore:
 *   1. Claude fetches events from each of the five calendars (via the
 *      Calendar MCP connector's list_events tool, paginating through
 *      every page) for whatever date range is requested, strips each
 *      event down to {id, summary, start, end, location?, description?},
 *      and writes one
 *      raw-events-<calendar-slug>.json file per calendar to a directory,
 *      each shaped:
 *        { "calendar": "<display name>", "calendarId": "<id>", "events": [...] }
 *      The "calendar" field's value MUST exactly match one of the five
 *      names in PRIORITY_ORDER below (case-sensitive) — that's how this
 *      script knows which calendar it's looking at, both for the "cal"
 *      label on each output event and for dedup priority.
 *   2. Claude runs:
 *        node scripts/javascript/refresh-events.js <journal-folder> <raw-events-dir> <start> <end> [output-path]
 *      which resolves <journal-folder> to one specific trip (see "CLI
 *      args"), reads every raw-events-*.json file in <raw-events-dir>,
 *      dedupes, and writes the merged result to that trip's
 *      data/events/events-data.json (or [output-path] if given).
 *
 * DATE RANGE IS FULLY VARIABLE — nothing in this script hardcodes any
 * trip's dates. <start> and <end> are REQUIRED CLI arguments (YYYY-MM-DD,
 * inclusive on both ends); the script only uses them to filter which
 * events make it into the output and to validate/clip multi-day event
 * spans against the window you asked for. Re-run with different dates
 * (and a different <journal-folder>) for a different trip without
 * editing this file.
 *
 * DEDUP RULE: for events that land on the same calendar date with the
 * same normalized title (case/whitespace/dash-insensitive) and the same
 * time-of-day label (or both "All Day"), only the copy from the
 * highest-priority calendar is kept, in this fixed order:
 *     Events Hans > Travel > Birthdays > Holidays in Sweden > Victoria Arthaud
 * Every event dropped this way is recorded in the output's
 * "duplicatesSkipped" array (date, title, which calendar's copy was kept,
 * which was dropped) so you can sanity-check the dedup instead of it
 * being a silent black box.
 *
 * MULTI-DAY EVENTS: rather than repeating an event on every day it spans,
 * a multi-day event gets exactly ONE entry, on its start date,
 * with " (thru <end date>)" appended to the title — e.g. a hotel stay
 * 2026-07-02 to 2026-07-05 becomes a single 2026-07-02 entry titled
 * "Brasss Hotel Suites (thru Jul 5)". All-day events use Google's
 * exclusive end-date convention (an all-day event with end date
 * 2026-07-05 actually ends on 2026-07-04) — this script accounts for
 * that when computing the "thru" date.
 *
 * No npm dependencies — plain Node (uses Intl for timezone-aware time
 * formatting, so results depend on the Node build having full ICU data;
 * every mainstream Node.js download since v13 ships with this by
 * default).
 */
"use strict";
const fs = require("fs");
const path = require("path");

// This script lives at <travel-journals>/scripts/javascript/, so the
// collection root (the folder holding every travel-journal-YYYY-MM-DD/
// trip) is two levels up — same convention as build-common-trips-
// manifest.js and refresh-notes.js.
const COLLECTION_ROOT = path.resolve(__dirname, "..", "..");
const TRIP_FOLDER_RE = /^travel-journal-\d{4}-\d{2}-\d{2}$/;

// ---- Fixed dedup priority (calendar display name -> rank, lower wins) ----
// This list is NOT a date range and is intentionally still a constant here
// — the user's ask was to make the *date range* variable, not the
// calendar set or its priority order. Edit this array (and re-run) if the
// set of source calendars or their priority ever changes.
const PRIORITY_ORDER = [
  "Events Hans",
  "Travel",
  "Birthdays",
  "Holidays in Sweden",
  "Victoria Arthaud",
];

// ---- Ignored event titles --------------------------------------------
// Recurring/personal events that should never show up in the travel
// journal, regardless of which source calendar they come from. Matched
// case-insensitively against the raw event's exact summary (trimmed) --
// add more titles here as needed.
const IGNORE_TITLES = new Set(
  [
    "Cleaning day",
    "cleaners",
    "ELC Bible Study: Genesis",
    "Zoom Bible Study",
    "MOTW",
    "API Superstream: APIs and the Agentic Shift [O’Reilly Live Event]",
    "Zero to Agent in 30 Minutes [O’Reilly Live Event]",
    "Church",
  ].map((t) => t.toLowerCase())
);

// ---- CLI args --------------------------------------------------------
function usage() {
  console.error(
    "Usage: node scripts/javascript/refresh-events.js <journal-folder> <raw-events-dir> <start YYYY-MM-DD> <end YYYY-MM-DD> [output-path]\n" +
    "  <journal-folder>  Which trip to update. Either a path (relative to the\n" +
    "                    current directory, or absolute) to a travel-journal-\n" +
    "                    YYYY-MM-DD/ folder, or just that folder's name if it\n" +
    "                    lives directly under the travel-journals collection\n" +
    "                    root (e.g. \"travel-journal-2026-07-01\").\n" +
    "  <raw-events-dir>  Directory containing raw-events-*.json files (one per\n" +
    "                    calendar), each shaped:\n" +
    "                    { \"calendar\": \"<name>\", \"calendarId\": \"<id>\", \"events\": [...] }\n" +
    "  <start>/<end>     Inclusive date range (YYYY-MM-DD). REQUIRED — there is\n" +
    "                    no built-in default, so this script works for any trip,\n" +
    "                    not just one hardcoded date range.\n" +
    "  [output-path]     Defaults to <journal-folder>/data/events/events-data.json."
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
// pile of "../", otherwise fall back to the absolute path.
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
}

const [, , journalArg, rawDirArg, startArg, endArg, outArg] = process.argv;
if (!journalArg || !rawDirArg || !startArg || !endArg) {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(startArg) || !DATE_RE.test(endArg)) {
  console.error(`Error: start/end must be YYYY-MM-DD. Got start="${startArg}" end="${endArg}".`);
  process.exit(1);
}
if (startArg > endArg) {
  console.error(`Error: start (${startArg}) is after end (${endArg}).`);
  process.exit(1);
}

const RAW_DIR = path.resolve(rawDirArg);
const RANGE_START = startArg;
const RANGE_END = endArg;
const OUT_PATH = outArg ? path.resolve(outArg) : path.join(JOURNAL_ROOT, "data", "events", "events-data.json");

if (!fs.existsSync(RAW_DIR) || !fs.statSync(RAW_DIR).isDirectory()) {
  console.error(`Error: raw-events directory not found: ${RAW_DIR}`);
  process.exit(1);
}

// ---- Load raw calendar files ------------------------------------------
const rawFiles = fs
  .readdirSync(RAW_DIR)
  .filter((f) => /^raw-events-.*\.json$/i.test(f))
  .sort();

if (rawFiles.length === 0) {
  console.error(`Error: no raw-events-*.json files found in ${RAW_DIR}`);
  process.exit(1);
}

const calendars = []; // [{calendar, calendarId, events}]
for (const file of rawFiles) {
  const full = path.join(RAW_DIR, file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    console.error(`Error: failed to parse ${file}: ${err.message}`);
    process.exit(1);
  }
  if (!parsed.calendar || !Array.isArray(parsed.events)) {
    console.error(`Error: ${file} is missing "calendar" or "events" — skipping.`);
    continue;
  }
  if (!PRIORITY_ORDER.includes(parsed.calendar)) {
    console.warn(
      `Warning: ${file} declares calendar "${parsed.calendar}", which is not in ` +
      `PRIORITY_ORDER (${PRIORITY_ORDER.join(", ")}). Its events will be treated as ` +
      `lowest priority. Fix the "calendar" field or add it to PRIORITY_ORDER if this is intentional.`
    );
  }
  calendars.push(parsed);
}

function priorityRank(calendarName) {
  const idx = PRIORITY_ORDER.indexOf(calendarName);
  return idx === -1 ? PRIORITY_ORDER.length : idx; // unknown calendars sort last
}

// ---- Date helpers ------------------------------------------------------
// All-day event date strings look like "2026-07-05T00:00:00Z" or plain
// "2026-07-05" depending on the source; normalize to YYYY-MM-DD.
function toDateOnly(dateStr) {
  return dateStr.slice(0, 10);
}

function addDaysToDateOnly(dateOnly, days) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatShortDate(dateOnly) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dt);
}

// Node/V8's ICU data only has proper short zone abbreviations (EDT, EST,
// PST...) for a subset of mostly North American zones; for common European
// zones `timeZoneName: "short"` silently falls back to a "GMT+2"-style
// offset instead of "CEST"/"CET"/"BST". That's a real gap (not a rare edge
// case) given four of the five source calendars' events happen in Europe,
// so cover the specific zones that actually show up in this project's
// calendars with an explicit offset->abbreviation table, falling back to
// whatever Intl produces (still correct, just less pretty) for anything
// not listed here.
const ZONE_ABBR = {
  "Europe/Berlin": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/Amsterdam": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/Copenhagen": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/Stockholm": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/Brussels": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/Paris": { "+02:00": "CEST", "+01:00": "CET" },
  "Europe/London": { "+01:00": "BST", "+00:00": "GMT" },
};

function zoneAbbrev(dateObj, timeZone, fallback) {
  if (!ZONE_ABBR[timeZone]) return fallback;
  const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZoneName: "longOffset", timeZone, hour: "numeric" });
  const offsetPart = offsetFmt.formatToParts(dateObj).find((p) => p.type === "timeZoneName");
  const offset = offsetPart ? offsetPart.value.replace("GMT", "") : null; // "+02:00"
  return (offset && ZONE_ABBR[timeZone][offset]) || fallback;
}

function formatTime(dateTimeStr, timeZone) {
  const d = new Date(dateTimeStr);
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    timeZone: timeZone || "UTC",
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  const hour = get("hour");
  const minute = get("minute");
  const dayPeriod = get("dayPeriod");
  const zone = zoneAbbrev(d, timeZone, get("timeZoneName"));
  return `${hour}:${minute} ${dayPeriod} ${zone}`.trim();
}

// ---- Strip a Google Calendar event description down to plain text --------
// Descriptions often arrive as HTML (Google's rich-text event editor, or
// pasted confirmation emails) — <p>/<br> become newlines, all other tags are
// dropped, and the handful of entities Google actually emits get decoded.
// The result is plain text (matching how title/time/cal are already treated
// as plain text and HTML-escaped at render time in build-travel-journal.js),
// not raw HTML.
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- Normalize one raw Google Calendar event into a {date, entry} pair -
// Returns null for events to skip (cancelled, outside range, malformed).
function normalizeEvent(rawEvent, calendarName) {
  if (rawEvent.status === "cancelled") return null;
  if (!rawEvent.start || !rawEvent.summary) return null;
  if (IGNORE_TITLES.has(rawEvent.summary.trim().toLowerCase())) return null;

  const isAllDay = !!rawEvent.start.date && !rawEvent.start.dateTime;

  let entryDate, time, titleSuffix = "";

  if (isAllDay) {
    const startDate = toDateOnly(rawEvent.start.date);
    // Google's all-day end date is EXCLUSIVE (an event ending "2026-07-05"
    // actually covers through 2026-07-04) -- subtract a day to get the
    // real last day, then only append "(thru ...)" if that's later than
    // the start day.
    const rawEndDate = rawEvent.end && rawEvent.end.date ? toDateOnly(rawEvent.end.date) : startDate;
    const lastDate = rawEndDate > startDate ? addDaysToDateOnly(rawEndDate, -1) : startDate;
    entryDate = startDate;
    time = "All Day";
    if (lastDate > startDate) {
      titleSuffix = ` (thru ${formatShortDate(lastDate)})`;
    }
  } else {
    if (!rawEvent.start.dateTime) return null;
    const tz = rawEvent.start.timeZone;
    entryDate = toDateOnly(
      // Use the wall-clock date in the event's own timezone, not the raw
      // UTC-ish offset string, so e.g. a 11:30pm CEST event lands on the
      // right calendar day.
      new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date(rawEvent.start.dateTime))
    );
    time = formatTime(rawEvent.start.dateTime, tz);
    if (rawEvent.end && rawEvent.end.dateTime) {
      const endDateOnly = toDateOnly(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date(rawEvent.end.dateTime))
      );
      if (endDateOnly > entryDate) {
        titleSuffix = ` (thru ${formatShortDate(endDateOnly)})`;
      }
    }
  }

  const description = rawEvent.description ? stripHtml(rawEvent.description) : "";

  return {
    date: entryDate,
    entry: {
      time,
      title: `${rawEvent.summary}${titleSuffix}`,
      cal: calendarName,
      ...(description ? { description } : {}),
    },
  };
}

// ---- Normalized-title key for dedup matching ---------------------------
function normalizeTitleForDedup(title) {
  return title
    .toLowerCase()
    .replace(/[‒–—―-]/g, "-") // all dash variants -> hyphen
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?'"()]/g, "")
    .trim();
}

// ---- Build per-date buckets, applying priority dedup -------------------
const byDate = {}; // date -> Map(dedupKey -> {entry, rank})
const duplicatesSkipped = [];

for (const cal of calendars) {
  const rank = priorityRank(cal.calendar);
  for (const rawEvent of cal.events) {
    const normalized = normalizeEvent(rawEvent, cal.calendar);
    if (!normalized) continue;
    const { date, entry } = normalized;
    if (date < RANGE_START || date > RANGE_END) continue; // outside requested window

    if (!byDate[date]) byDate[date] = new Map();
    const dedupKey = `${entry.time}||${normalizeTitleForDedup(entry.title)}`;
    const existing = byDate[date].get(dedupKey);

    if (!existing) {
      byDate[date].set(dedupKey, { entry, rank });
    } else if (rank < existing.rank) {
      // New event is higher priority -- it wins, existing is dropped.
      duplicatesSkipped.push({
        date,
        title: entry.title,
        keptCal: entry.cal,
        droppedCal: existing.entry.cal,
      });
      byDate[date].set(dedupKey, { entry, rank });
    } else {
      // Existing entry is higher (or equal) priority -- keep it, drop this one.
      duplicatesSkipped.push({
        date,
        title: existing.entry.title,
        keptCal: existing.entry.cal,
        droppedCal: entry.cal,
      });
    }
  }
}

// ---- Sort each date's events: "All Day" first, then by time ascending --
function timeSortKey(entry) {
  if (entry.time === "All Day") return -1;
  // Re-derive a sortable minute-of-day value isn't stored, so fall back to
  // parsing the formatted "h:mm AM/PM ZONE" string back into minutes.
  const m = entry.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let [, h, min, ap] = m;
  h = parseInt(h, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  return h * 60 + parseInt(min, 10);
}

const events = {};
const sortedDates = Object.keys(byDate).sort();
for (const date of sortedDates) {
  const entries = Array.from(byDate[date].values()).map((v) => v.entry);
  entries.sort((a, b) => timeSortKey(a) - timeSortKey(b));
  events[date] = entries;
}

// ---- Write output --------------------------------------------------------
const output = {
  generatedAt: new Date().toISOString(),
  range: { start: RANGE_START, end: RANGE_END },
  sourceCalendars: calendars.map((c) => c.calendar),
  priorityOrder: PRIORITY_ORDER,
  events,
  duplicatesSkipped,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

// Also write a client-side-loadable mirror (data/events/events-data.js) so
// common/journal.html?trip=<folder>'s dynamically-injected
// <script src=".../data/events/events-data.js"> populates
// window.EVENTS_DATA without a separate manual step.
const JS_OUT_PATH = OUT_PATH.replace(/\.json$/, ".js");
fs.writeFileSync(JS_OUT_PATH, "window.EVENTS_DATA = " + JSON.stringify(output, null, 2) + ";\n", "utf8");

// ---- Summary -------------------------------------------------------------
const totalEvents = Object.values(events).reduce((sum, list) => sum + list.length, 0);
console.log(`Journal: ${displayPath(JOURNAL_ROOT)}`);
console.log(`Read ${calendars.length} calendar file(s): ${calendars.map((c) => `${c.calendar} (${c.events.length})`).join(", ")}`);
console.log(`Range: ${RANGE_START} to ${RANGE_END}`);
console.log(`Wrote ${totalEvents} event(s) across ${sortedDates.length} day(s) to ${displayPath(OUT_PATH)}`);
if (duplicatesSkipped.length) {
  console.log(`Skipped ${duplicatesSkipped.length} duplicate(s) (see "duplicatesSkipped" in the output file):`);
  for (const d of duplicatesSkipped) {
    console.log(`  ${d.date}  "${d.title}"  kept ${d.keptCal}, dropped ${d.droppedCal}`);
  }
} else {
  console.log("No duplicates found.");
}
