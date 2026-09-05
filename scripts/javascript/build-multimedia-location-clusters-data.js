#!/usr/bin/env node
/**
 * build-multimedia-location-clusters-data.js
 * -------------------------------------
 * SHARED SCRIPT — lives once at <travel-journals>/scripts/javascript/ and
 * is used by every travel-journal-YYYY-MM-DD/ trip (as of August 2026,
 * this was moved here from being duplicated inside each trip's own
 * scripts/javascript/ folder, keeping the newer of the two copies' logic
 * — the centroid_lat/centroid_lon propagation for resolved_location
 * clusters described below, which the older copy didn't have and which
 * always reported null for a GPS-less cluster). Because one copy now
 * serves every trip, the trip to act on is a required first argument,
 * <journal-folder> (see the usage lines at the end of this comment),
 * rather than being inferred from this script's own location the way it
 * used to be.
 *
 * Creates/recreates a trip's data/multimedia-location/multimedia-location-data.json
 * (and, alongside it, a plain runtime-mirror data/multimedia-location/
 * multimedia-location-data.js exposing window.MULTIMEDIA_LOCATION_DATA —
 * see "RUNTIME MIRROR" below), from scratch, computing everything directly
 * from that trip's data/multimedia/
 * multimedia-data.json (the photo/video catalog
 * scripts/python/build-multimedia-data.py maintains) — the "original
 * multimedia" — with NO dependency on any
 * static/hand-researched data file:
 *   - Does NOT read photoMapsData/writeups/*.json (the Claude-researched
 *     historical/cultural write-up text build-multimedia-location-data.js
 *     combines).
 *   - Does NOT shell out to build-photo-maps.py or any other script.
 * Every location cluster, its centroid, its time range, and its member
 * files are all (re)computed live, each time this script runs, straight
 * from the GPS/timestamp metadata already recorded in that trip's
 * data/multimedia/multimedia-data.json.
 *
 * CLUSTERING: photos/videos are grouped by day (relative_folder), then
 * within each day, GPS-tagged files are greedily clustered by proximity —
 * a file joins the first existing cluster whose current centroid is
 * within CLUSTER_DIST_M of it, or starts a new cluster if none is close
 * enough — exactly the same greedy centroid-distance algorithm
 * build-photo-maps.py's cluster_media() uses, re-implemented here in
 * plain Node so this script has no Python dependency either. The distance
 * threshold is 100 meters (CLUSTER_DIST_M below), deliberately tighter
 * than build-photo-maps.py's own 150m default — a separate, independently
 * tunable constant, not shared with that script.
 *
 * GPS-LESS FALLBACK: a file with no device GPS at all cannot be clustered
 * by proximity — there is nothing to measure a distance from. But some
 * such files DO carry a resolved_location (the no-gps-location-resolver
 * tool's output — a location inferred from caption/landmark text, source
 * "subject_inferred" — see scripts/python/no-gps-location-resolver/). For
 * these, this script falls back to grouping by an EXACT match on that
 * file's resolved_location.location_label within the same day: every
 * GPS-less file sharing the same label on the same day becomes one
 * cluster, in chronological order, alongside (not merged with) that day's
 * GPS-based clusters. A label-based cluster's centroid_lat/centroid_lon
 * come from its members' own resolved_location.centroid_lat/centroid_lon —
 * the matched gazetteer landmark's real-world coordinates, recorded by the
 * no-gps-location-resolver tool, not derived from any file's own EXIF
 * (these files have none). A cluster whose matched location has no
 * confirmed coordinates (centroid_lat/centroid_lon: null on every member)
 * simply gets null here too, same as before — never fabricated. Its
 * "location_source" field is "resolved_location" instead of "gps" — see
 * LOCATION LABEL below. A file with neither GPS nor a resolved_location is
 * skipped entirely (still unresolved, same as before this fallback
 * existed).
 *
 * LOCATION LABEL: since there is no researched write-up to draw a
 * location_label/place_full/country from, each cluster's label is instead
 * the most common resolved_location.location_label already recorded
 * per-file in that trip's data/multimedia/multimedia-data.json (reverse-
 * geocoded by scripts/python/build-multimedia-data.py when the catalog
 * was built, or caption-inferred by the no-gps-location-resolver tool)
 * among that cluster's own member files — a majority vote, ties broken by
 * whichever label belongs to the earliest-timestamped file in the
 * cluster. This still counts as "not a static data file": it is read
 * straight out of the same multimedia catalog this whole script is driven
 * by, not a separate hand-authored source. (For a label-based GPS-less
 * cluster this vote is trivial — every member was grouped by that exact
 * label to begin with — but the same function handles both cluster kinds
 * uniformly.)
 *
 * OVERVIEW DESCRIPTION: each cluster also gets an "overview-description" —
 * a Claude-synthesized paragraph describing the cluster as a whole, built
 * from its member files' subject_description.standard text (the factual
 * per-file description scripts/python/build-multimedia-data.py already
 * recorded — NOT the subject_description.monty_python variant). Because
 * writing that synthesis requires an LLM and this is a plain Node script
 * with no model access, this script CANNOT produce overview-description
 * on its own — it is a two-step, Claude-mediated process, same shape as
 * refresh-notes.js/refresh-events.js's own two-step designs (see "Why
 * it's a two-step, Claude-mediated process" in this script's
 * Instructions.txt for the full explanation and exact commands):
 *   1. Claude runs this script in --list-clusters mode to get the current
 *      clustering (folder, cluster_idx, multimedia_files, and each
 *      cluster's members' subject_description.standard texts) WITHOUT
 *      writing the final output file.
 *   2. Claude reads that file and writes a synthesis file: a JSON object
 *      keyed by "<folder>::<cluster_idx>" whose value is a genuinely
 *      Claude-written overview-description for that cluster (not a
 *      mechanical join — an actual synthesis of what's distinctive about
 *      that cluster's photos/videos, informed by its members'
 *      subject_description.standard texts).
 *   3. Claude runs this script normally, passing the trip and that
 *      synthesis file. Clustering is deterministic (same catalog, same
 *      algorithm), so the clusters recomputed in this run line up with
 *      the ones Claude saw in step 1 by folder+cluster_idx — this run
 *      merges the synthesis file's text onto each matching cluster and
 *      writes the final output. A cluster missing from the synthesis
 *      file gets overview-description: null and a printed warning (it
 *      is NOT mechanically filled in as a fallback — see Instructions.txt).
 *
 * RUNTIME MIRROR: normal mode also writes a .js file next to whatever
 * output path it used (OUT_PATH with .json replaced by .js — normally
 * data/multimedia-location/multimedia-location-data.js), containing
 * `window.MULTIMEDIA_LOCATION_DATA = <the same array>;`. This exists
 * purely so a page opened directly from disk (file://) can load this data
 * via <script src="...multimedia-location-data.js">, since fetch() of a
 * local JSON file is blocked by CORS under file:// — the identical reason
 * build-daily-multimedia-gallery.js writes data/multimedia/
 * multimedia-data.js next to multimedia-data.json. daily-location-
 * gallery.html loads this mirror. --list-clusters mode does NOT write a
 * mirror (it never touches OUT_PATH at all).
 *
 * IMPORTANT — this OVERWRITES the same file
 * data/multimedia-location/multimedia-location-data.json that
 * build-multimedia-location-data.js also writes, via a completely
 * different, independent method. The two scripts' cluster_idx values are
 * NOT guaranteed to match each other (different distance thresholds,
 * different clustering runs) — running this script means the file no
 * longer reflects photoMapsData/writeups/*.json's researched content or
 * its cluster_idx numbering at all, only what this script computes.
 * See build-multimedia-location-clusters-data_Instructions.txt for the full
 * comparison.
 *
 *     node scripts/javascript/build-multimedia-location-clusters-data.js <journal-folder> --list-clusters <clusters-out-path>
 *     node scripts/javascript/build-multimedia-location-clusters-data.js <journal-folder> <synthesis-file> [output-path]
 *
 * <journal-folder> resolves two ways, tried in order: as a path relative
 * to the current directory (or absolute), or as a folder name directly
 * under the travel-journals collection root (this script's own
 * grandparent directory), e.g. "travel-journal-2026-07-01". If neither
 * resolves to a real directory, the script exits with an error listing
 * every travel-journal-YYYY-MM-DD folder it can see.
 *
 * No dependencies — plain Node.
 */
const fs = require("fs");
const path = require("path");

// This script lives at <travel-journals>/scripts/javascript/, so the
// collection root (the folder holding every travel-journal-YYYY-MM-DD/
// trip) is two levels up — same convention as this project's other
// shared scripts (refresh-notes.js, refresh-events.js,
// resolve_no_gps_locations.py, build-multimedia-data.py).
const COLLECTION_ROOT = path.resolve(__dirname, "..", "..");
const TRIP_FOLDER_RE = /^travel-journal-\d{4}-\d{2}-\d{2}$/;

// Cluster radius in meters. Deliberately separate from (and tighter than)
// build-photo-maps.py's own DIST_THRESHOLD_M (150m) — this script's own,
// independently tunable constant.
const CLUSTER_DIST_M = 100;

function clusterKey(folder, clusterIdx) {
  return folder + "::" + clusterIdx;
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

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
}

function usageAndExit() {
  console.error(
    "Usage: node scripts/javascript/build-multimedia-location-clusters-data.js <journal-folder> --list-clusters <output-path>\n" +
    "Or:    node scripts/javascript/build-multimedia-location-clusters-data.js <journal-folder> <synthesis-file> [output-path]\n" +
    "  <journal-folder>  Which trip to act on. Either a path (relative to the current\n" +
    "                    directory, or absolute) to a travel-journal-YYYY-MM-DD/ folder,\n" +
    "                    or just that folder's name if it lives directly under the\n" +
    "                    travel-journals collection root (e.g. \"travel-journal-2026-07-01\")."
  );
  const available = listAvailableTrips();
  if (available.length) {
    console.error("\nAvailable journal folders under " + COLLECTION_ROOT + ":");
    available.forEach((name) => console.error("  - " + name));
  }
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const journalArg = rawArgs[0];
const args = rawArgs.slice(1); // everything after <journal-folder>, same shape as before this script was shared

if (!journalArg || args.length === 0) {
  usageAndExit();
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
const CATALOG_FILE = path.join(ROOT, "data", "multimedia", "multimedia-data.json");
const OUTPUT_DIR = path.join(ROOT, "data", "multimedia-location");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "multimedia-location-data.json");

// ---- Load the catalog -----------------------------------------------------
if (!fs.existsSync(CATALOG_FILE)) {
  console.error("Missing " + CATALOG_FILE);
  console.error(`Run scripts/python/build-multimedia-data.py ${journalArg} first to create it.`);
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

// ---- Date helpers -----------------------------------------------------------
// EXIF datetime_original looks like "2026:07:10 15:28:06" — the first two
// colons are date separators, not time separators, so a plain Date.parse
// won't understand it without first rewriting it to ISO-8601.
const EXIF_DT_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
function parseExifDateTime(raw) {
  if (!raw) return null;
  const m = EXIF_DT_RE.exec(raw);
  if (!m) return null;
  const iso = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6];
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// ---- Distance ---------------------------------------------------------------
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- Group the catalog by day (relative_folder) ----------------------------
const byFolder = new Map();
for (const entry of catalog) {
  const folder = entry.relative_folder;
  if (!byFolder.has(folder)) byFolder.set(folder, []);
  byFolder.get(folder).push(entry);
}

// Shared chronological comparator — missing dates sort last — used to order
// files within a cluster/group and to order clusters/groups themselves by
// their earliest member.
function byTime(a, b) {
  if (a.dtMs == null && b.dtMs == null) return 0;
  if (a.dtMs == null) return 1;
  if (b.dtMs == null) return -1;
  return a.dtMs - b.dtMs;
}

// ---- Cluster each day's files, greedily by centroid distance, with a -------
// GPS-less fallback for files whose location was only ever inferred from
// caption text (no device GPS to measure a distance from at all).
function clusterFolder(entries) {
  const withGps = [];
  const gpslessWithLabel = [];
  for (const entry of entries) {
    const meta = entry.multimedia_metadata || {};
    const dtMs = parseExifDateTime(meta.datetime_original);
    if (meta.has_gps && meta.latitude != null && meta.longitude != null) {
      withGps.push({ entry: entry, lat: meta.latitude, lon: meta.longitude, dtMs: dtMs });
      continue;
    }
    const rl = entry.resolved_location;
    if (rl && rl.location_label) {
      // No device GPS to cluster by proximity — group by exact label match
      // instead (see "GPS-LESS FALLBACK" at the top of this file). Carry
      // along the matched location's own centroid_lat/centroid_lon, when
      // the no-gps-location-resolver tool recorded one (the landmark's
      // real-world coordinates — never derived from this file's own EXIF,
      // since it has none), so the cluster can report real coordinates
      // below instead of always being null.
      const hasCentroid = rl.centroid_lat != null && rl.centroid_lon != null;
      gpslessWithLabel.push({
        entry: entry,
        lat: hasCentroid ? rl.centroid_lat : null,
        lon: hasCentroid ? rl.centroid_lon : null,
        dtMs: dtMs,
        label: rl.location_label,
      });
    }
    // Neither GPS nor a resolved_location: nowhere to place this file at
    // all — skipped entirely, same as before this fallback existed.
  }
  // Undated files sort last but still cluster/group normally otherwise —
  // same tie-break used elsewhere in this project (missing dates last).
  withGps.sort(byTime);
  gpslessWithLabel.sort(byTime);

  // ---- GPS clusters: greedy nearest-centroid, unchanged ----------------
  const gpsClusters = []; // each: { members: [...], locationSource: "gps" }
  for (const m of withGps) {
    let placed = false;
    for (const c of gpsClusters) {
      let clat = 0, clon = 0;
      for (const x of c.members) { clat += x.lat; clon += x.lon; }
      clat /= c.members.length;
      clon /= c.members.length;
      if (haversineMeters(m.lat, m.lon, clat, clon) <= CLUSTER_DIST_M) {
        c.members.push(m);
        placed = true;
        break;
      }
    }
    if (!placed) gpsClusters.push({ members: [m], locationSource: "gps" });
  }

  // ---- Label groups: one per distinct resolved_location.location_label --
  // among this day's GPS-less files, in order first encountered
  // (chronological, since gpslessWithLabel is already time-sorted).
  const labelClusters = []; // each: { members: [...], locationSource: "resolved_location" }
  const labelIndex = new Map(); // label -> cluster
  for (const m of gpslessWithLabel) {
    let c = labelIndex.get(m.label);
    if (!c) {
      c = { members: [], locationSource: "resolved_location" };
      labelIndex.set(m.label, c);
      labelClusters.push(c);
    }
    c.members.push(m);
  }

  const clusters = gpsClusters.concat(labelClusters);

  // Sort each cluster's own members chronologically, then sort the
  // clusters themselves by their earliest member's time — matches
  // build-photo-maps.py's own ordering, so cluster_idx is at least
  // assigned in a familiar, predictable (chronological) order even though
  // the numeric values won't line up with that script's own clusters. GPS
  // clusters and label clusters are interleaved together in this final
  // sort, not kept as two separate blocks.
  for (const c of clusters) {
    c.members.sort(byTime);
  }
  clusters.sort((a, b) => byTime(a.members[0], b.members[0]));

  return clusters;
}

// ---- Majority-vote a cluster's location label from its own members' -------
// already-recorded resolved_location (reverse-geocoded when the catalog
// was built) — no new geocoding, no external file, just reading data
// already present on each member entry.
function aggregateLocation(members) {
  const counts = new Map(); // label -> { count, place_full, country, firstDtMs }
  for (const m of members) {
    const rl = m.entry.resolved_location;
    if (!rl || !rl.location_label) continue;
    const key = rl.location_label;
    if (!counts.has(key)) {
      counts.set(key, { count: 0, place_full: rl.place_full || null, country: rl.country || null, firstDtMs: m.dtMs });
    }
    const rec = counts.get(key);
    rec.count += 1;
    if (m.dtMs != null && (rec.firstDtMs == null || m.dtMs < rec.firstDtMs)) {
      rec.firstDtMs = m.dtMs;
    }
  }
  if (!counts.size) {
    return { location_label: null, place_full: null, country: null };
  }
  // Highest count wins; ties broken by earliest-timestamped member.
  let best = null;
  for (const [label, rec] of counts) {
    if (
      !best ||
      rec.count > best.rec.count ||
      (rec.count === best.rec.count && (rec.firstDtMs ?? Infinity) < (best.rec.firstDtMs ?? Infinity))
    ) {
      best = { label, rec };
    }
  }
  return { location_label: best.label, place_full: best.rec.place_full, country: best.rec.country };
}

// ---- Collect a cluster's member subject_description.standard texts --------
// (chronological order, deduplicated) — used both for --list-clusters
// output (so Claude has source material to synthesize from) and, in
// normal mode, only for that purpose (the synthesis itself comes from the
// synthesis file, not from here).
function collectDescriptions(members) {
  const seen = new Set();
  const parts = [];
  for (const m of members) {
    const sd = m.entry.subject_description;
    const text = sd && typeof sd.standard === "string" ? sd.standard.trim() : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts;
}

// ---- Recompute all clusters (shared by both modes) -------------------------
function buildClusters() {
  const result = []; // [{ folder, cluster_idx, members, locationSource }]
  const sortedFolders = Array.from(byFolder.keys()).sort();
  for (const folder of sortedFolders) {
    const clusters = clusterFolder(byFolder.get(folder));
    clusters.forEach((c, idx) => {
      result.push({ folder: folder, cluster_idx: idx, members: c.members, locationSource: c.locationSource });
    });
  }
  return result;
}

// ============================================================================
// MODE 1: <journal-folder> --list-clusters <output-path>
// Dumps the current clustering (no geocoding, no overview-description) so
// Claude can read each cluster's member descriptions and write a synthesis
// file for mode 2. Does NOT touch data/multimedia-location/multimedia-location-data.json.
// ============================================================================
if (args[0] === "--list-clusters") {
  const outArg = args[1];
  if (!outArg) {
    console.error("Usage: node build-multimedia-location-clusters-data.js <journal-folder> --list-clusters <output-path>");
    process.exit(1);
  }
  const outPath = path.resolve(outArg);
  const clusters = buildClusters();
  const listing = clusters.map((c) => ({
    folder: c.folder,
    cluster_idx: c.cluster_idx,
    key: clusterKey(c.folder, c.cluster_idx),
    location_source: c.locationSource,
    multimedia_files: c.members.map((m) => m.entry.relative_folder + "/" + m.entry.file_name),
    descriptions: collectDescriptions(c.members),
  }));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(listing, null, 2) + "\n", "utf8");
  console.log("Journal: " + displayPath(ROOT));
  console.log("Wrote " + listing.length + " cluster(s) to " + outPath);
  console.log(
    "Next: write a synthesis file — a JSON object keyed by each cluster's " +
    "\"key\" (e.g. \"" + (listing[0] ? listing[0].key : "photos/2026-07-01::0") + "\") " +
    "whose value is a Claude-written overview-description for that cluster, " +
    "informed by its \"descriptions\" array — then run:\n" +
    "  node " + displayPath(__filename) + " " + journalArg + " <synthesis-file> [output-path]"
  );
  process.exit(0);
}

// ============================================================================
// MODE 2: <journal-folder> <synthesis-file> [output-path]  (normal / full run)
// Recomputes every cluster's centroid/time range/location, merges in the
// Claude-written overview-description from <synthesis-file> by
// folder::cluster_idx key, and writes the final output file.
// ============================================================================
const synthesisArg = args[0];
if (!synthesisArg) {
  console.error("Usage: node build-multimedia-location-clusters-data.js <journal-folder> <synthesis-file> [output-path]");
  console.error("Or:    node build-multimedia-location-clusters-data.js <journal-folder> --list-clusters <output-path>");
  console.error(
    "overview-description is Claude-synthesized (see Instructions.txt) — this script " +
    "cannot invent it on its own, a synthesis file is required."
  );
  process.exit(1);
}
const synthesisPath = path.resolve(synthesisArg);
if (!fs.existsSync(synthesisPath)) {
  console.error("Missing synthesis file: " + synthesisPath);
  process.exit(1);
}
const synthesis = JSON.parse(fs.readFileSync(synthesisPath, "utf8"));

const outArg = args[1];
const OUT_PATH = outArg ? path.resolve(outArg) : OUTPUT_FILE;

const combined = [];
const missingSynthesis = [];
const clusters = buildClusters();
for (const c of clusters) {
  const members = c.members;
  // A GPS cluster's members always all carry real device lat/lon. A
  // label-based (GPS-less) cluster's members carry their matched
  // location's own centroid_lat/centroid_lon instead (set above in
  // clusterFolder(), from resolved_location — see "GPS-LESS FALLBACK" at
  // the top of this file), when the no-gps-location-resolver tool recorded
  // one; a label cluster whose matched location has no confirmed
  // coordinates has none here either, and centroid_lat/centroid_lon below
  // stays null rather than fabricating a position — same principle as
  // before, just now able to report a real value when one exists.
  const coordMembers = members.filter((m) => m.lat != null && m.lon != null);
  let centroidLat = null, centroidLon = null;
  if (coordMembers.length) {
    let clat = 0, clon = 0;
    for (const m of coordMembers) { clat += m.lat; clon += m.lon; }
    centroidLat = Math.round((clat / coordMembers.length) * 1e6) / 1e6;
    centroidLon = Math.round((clon / coordMembers.length) * 1e6) / 1e6;
  }

  const dts = members.map((m) => m.dtMs).filter((v) => v != null);
  const timeStart = dts.length ? new Date(Math.min(...dts)).toISOString() : null;
  const timeEnd = dts.length ? new Date(Math.max(...dts)).toISOString() : null;

  const loc = aggregateLocation(members);
  const key = clusterKey(c.folder, c.cluster_idx);
  let overviewDescription = null;
  if (Object.prototype.hasOwnProperty.call(synthesis, key)) {
    const val = synthesis[key];
    overviewDescription = typeof val === "string" && val.trim() ? val.trim() : null;
  }
  if (overviewDescription == null) missingSynthesis.push(key);

  combined.push({
    folder: c.folder,
    cluster_idx: c.cluster_idx,
    centroid_lat: centroidLat,
    centroid_lon: centroidLon,
    time_start: timeStart,
    time_end: timeEnd,
    location_label: loc.location_label,
    place_full: loc.place_full,
    country: loc.country,
    location_source: c.locationSource,
    "overview-description": overviewDescription,
    multimedia_files: members.map((m) => m.entry.relative_folder + "/" + m.entry.file_name),
  });
}

// ---- Write --------------------------------------------------------------------
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(combined, null, 2) + "\n", "utf8");

// Also write a plain runtime mirror alongside OUT_PATH — same filename, .js
// instead of .json — exposing window.MULTIMEDIA_LOCATION_DATA, exactly the
// same trick build-daily-multimedia-gallery.js uses for multimedia-data.js:
// a page opened directly from disk (file://) can't fetch() a local JSON
// file (blocked by CORS), but CAN load a plain <script src="...">, so any
// HTML page that wants this data client-side (e.g.
// daily-location-gallery.html) loads THIS file, not the .json, via
// <script src="...multimedia-location-data.js" onerror="window.MULTIMEDIA_LOCATION_DATA = window.MULTIMEDIA_LOCATION_DATA || []">.
// Written every run, right after OUT_PATH, so the two never drift apart.
const OUT_JS_PATH = OUT_PATH.replace(/\.json$/i, "") + ".js";
const mirrorScript =
  "// Auto-generated by build-multimedia-location-clusters-data.js — do not edit by hand.\n" +
  "// A plain runtime mirror of " + path.basename(OUT_PATH) + "'s contents (same array,\n" +
  "// same shape, including overview-description), for pages that load it via\n" +
  "// <script src> instead of fetch() (fetch() of a local file fails under file://).\n" +
  "window.MULTIMEDIA_LOCATION_DATA = " + JSON.stringify(combined).replace(/</g, "\\u003c") + ";\n";
fs.writeFileSync(OUT_JS_PATH, mirrorScript, "utf8");

const dayCount = new Set(combined.map((e) => e.folder)).size;
const fileCount = combined.reduce((sum, e) => sum + e.multimedia_files.length, 0);
const gpsClusterCount = combined.filter((e) => e.location_source === "gps").length;
const labelClusterCount = combined.filter((e) => e.location_source === "resolved_location").length;
const gpsFileCount = combined
  .filter((e) => e.location_source === "gps")
  .reduce((sum, e) => sum + e.multimedia_files.length, 0);
const labelFileCount = fileCount - gpsFileCount;
console.log("Journal: " + displayPath(ROOT));
console.log("Wrote " + OUT_PATH);
console.log("Wrote " + OUT_JS_PATH + " (runtime mirror, window.MULTIMEDIA_LOCATION_DATA)");
console.log(
  combined.length + " cluster(s) across " + dayCount + " day(s), " +
  fileCount + " multimedia file(s) clustered at a " + CLUSTER_DIST_M + "m radius " +
  "(" + gpsClusterCount + " GPS cluster(s), " + gpsFileCount + " file(s); " +
  labelClusterCount + " resolved-location-label cluster(s), " + labelFileCount + " file(s))."
);
console.log(
  "Computed entirely from " + CATALOG_FILE + " — no photoMapsData/writeups/*.json " +
  "or build-photo-maps.py involved."
);
if (missingSynthesis.length) {
  console.log(
    "WARNING: " + missingSynthesis.length + " cluster(s) had no entry in " + synthesisPath +
    " and got overview-description: null:"
  );
  for (const key of missingSynthesis) console.log("  - " + key);
} else {
  console.log("Every cluster had a matching overview-description in " + synthesisPath + ".");
}
