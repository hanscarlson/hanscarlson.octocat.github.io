#!/usr/bin/env node
/**
 * RETIRED (August 2026) -- moved to scripts/_to_delete/, no longer run by
 * anything in this project. travel-journals/index.html was rewritten to
 * be fully client-side-rendered, reading common/data/trips-manifest.js
 * live on every page load (see that page's own top-of-script comment) --
 * the same shift every trip's own journal page and the shared common/
 * pages already went through. Kept here for reference only -- see
 * scripts/_to_delete/build-travel-journal-index_Instructions.txt's own
 * final section for the full retirement notes. Do not run this script:
 * it would overwrite the new dynamic index.html with a stale, static one
 * that goes out of sync the next time a trip is added, removed, or
 * renamed.
 *
 * build-travel-journal-index.js
 *
 * Regenerates travel-journals/index.html -- the landing page one level
 * above every trip. It lists each travel-journal-YYYY-MM-DD/ folder that
 * has its own trip-info.json as a card linking to that trip's journal
 * (common/journal.html?trip=<folder>, the one shared, client-side-
 * rendered journal page every trip now uses -- see that page's own
 * top-of-script comment), styled to match the journals themselves (same
 * paper/brass/sea palette, same Fraunces + IBM Plex Mono fonts).
 *
 * Usage:
 *   node scripts/javascript/build-travel-journal-index.js
 *
 * No arguments, no npm dependencies (plain Node: fs + path only). Safe to
 * re-run any time -- it always rescans the folder fresh and overwrites
 * index.html to match exactly what's on disk; it does not merge with a
 * prior run's output. Run it whenever a travel-journal-YYYY-MM-DD folder
 * is added, removed, or its own trip-info.json's title changes.
 */

const fs = require("fs");
const path = require("path");

// This script lives at <travel-journals>/scripts/javascript/, so the
// collection root is two levels up.
const ROOT = path.resolve(__dirname, "..", "..");
const FOLDER_RE = /^travel-journal-(\d{4}-\d{2}-\d{2})$/;

// Scans ROOT for travel-journal-YYYY-MM-DD folders that contain their own
// trip-info.json, and pulls the trip's title straight out of it. There is
// no longer a per-trip index.html to also pull a subtitle line out of --
// every trip's journal is common/journal.html?trip=<folder>, a single
// shared page that computes its own date-range/photo-count summary
// entirely client-side (see that page's own top-of-script comment) -- so
// this landing page's cards are title-only, same as
// build-common-trips-manifest.js's own trips-manifest.js entries.
function collectTrips() {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  const trips = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(FOLDER_RE);
    if (!m) continue;

    const infoPath = path.join(ROOT, entry.name, "trip-info.json");
    if (!fs.existsSync(infoPath)) continue; // folder exists but no trip-info.json yet -- skip

    let info;
    try {
      info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    } catch (err) {
      console.warn(`Warning: couldn't parse ${infoPath} (${err.message}) -- skipping ${entry.name}.`);
      continue;
    }
    const title = (info && info.title) || entry.name;

    trips.push({ folder: entry.name, date: m[1], title });
  }

  // Chronological, oldest trip first -- reads like a timeline of the
  // trips themselves, the same order you'd flip through them in a
  // physical journal. Swap to (b, a) here for newest-first instead.
  trips.sort((a, b) => a.date.localeCompare(b.date));
  return trips;
}

function renderCard(trip) {
  return `  <a class="trip-card" href="./common/journal.html?trip=${encodeURIComponent(trip.folder)}">
    <div class="trip-card-head">
      <span class="trip-date-badge">${trip.date}</span>
      <span class="trip-title">${trip.title}</span>
    </div>
  </a>`;
}

function formatDateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function renderSummary(trips) {
  if (trips.length === 0) return "No journals yet.";
  const first = formatDateLong(trips[0].date);
  const last = formatDateLong(trips[trips.length - 1].date);
  const tripWord = trips.length === 1 ? "trip" : "trips";
  if (trips.length === 1) return `${trips.length} ${tripWord} · ${first}`;
  return `${trips.length} ${tripWord} · ${first} – ${last}`;
}

function renderBody(trips) {
  if (trips.length === 0) {
    return `  <p class="no-events">No travel journals found yet. Add a
    travel-journal-YYYY-MM-DD/ folder with its own trip-info.json, then re-run this script.</p>`;
  }
  return trips.map(renderCard).join("\n\n");
}

function template(trips) {
  const cards = renderBody(trips);
  const summary = renderSummary(trips);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Travel Journals</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;0,600;0,900;1,500;1,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
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
    text-align: center;
  }
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

  main { width: 90%; margin: 0 auto; padding: 24px 32px 80px; max-width: 760px; }

  .trip-card {
    display: block;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--white);
    margin-bottom: 16px;
    padding: 16px 20px;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 2px 10px rgba(28,43,58,0.06);
    transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
  }
  .trip-card:hover {
    border-color: var(--brass);
    box-shadow: 0 4px 16px rgba(28,43,58,0.12);
    transform: translateY(-1px);
  }
  .trip-card-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }
  .trip-date-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sea);
    font-weight: 600;
    background: var(--paper-alt);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 3px 8px;
    white-space: nowrap;
  }
  .trip-title {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-style: italic;
    font-size: 21px;
    color: var(--ink);
  }
  .trip-sub {
    margin-top: 8px;
    color: var(--ink-soft);
    font-size: 15px;
    font-family: 'IBM Plex Mono', monospace;
  }
  .no-events { color: var(--ink-soft); font-size: 16.5px; font-style: italic; margin: 8px 0 0; }

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
    <h1>🧳 Travel Journals</h1>
    <div class="sub">${summary}</div>
  </div>
</header>

<main>
${cards}
</main>

<footer id="bottom">Generated by build-travel-journal-index.js — lists every travel-journal-YYYY-MM-DD folder with its own trip-info.json, oldest trip first.</footer>

</body>
</html>
`;
}

function build() {
  const trips = collectTrips();
  const html = template(trips);
  fs.writeFileSync(path.join(ROOT, "index.html"), html, "utf8");

  console.log(`Wrote index.html with ${trips.length} trip${trips.length === 1 ? "" : "s"}:`);
  trips.forEach((t) => console.log(`  - ${t.folder}  "${t.title.replace(/<[^>]+>/g, "")}"`));
}

build();
