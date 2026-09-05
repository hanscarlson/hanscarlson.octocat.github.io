# no-gps-location-resolver — travel-journal-2026-01-14

This folder holds this trip's own data for the shared **no-gps-location-resolver**
tool. The script and the full walkthrough (what it does, how gazetteer
matching works, all CLI flags, limitations) now live at
`travel-journals/scripts/python/resolve_no_gps_locations.py` and its sibling
`resolve_no_gps_locations_Instructions.txt` — read that file first. This
README covers only what's specific to this trip: its own gazetteer and the
history of how it was built up.

## Files

- `gazetteer.json` — the ruleset for the January 2026 Arctic trip: Iceland
  (Reykjavík + Golden Circle, Jan 14–15), northern Sweden (Kiruna, Abisko,
  Jukkasjärvi/ICEHOTEL, Jan 17–20), and Stockholm (Jan 23–26). Verified
  against this trip's `data/multimedia/multimedia-data.json` at each stage
  — see Changelog below.
- `audit.csv` — this trip's most recent `--report` output. Safe to
  regenerate; not hand-maintained.

## Running it for this trip

From the travel-journals collection root:

```bash
python3 scripts/python/resolve_no_gps_locations.py \
  travel-journal-2026-01-14/data/multimedia/multimedia-data.json \
  --gazetteer travel-journal-2026-01-14/scripts/python/no-gps-location-resolver/gazetteer.json \
  --in-place \
  --report travel-journal-2026-01-14/scripts/python/no-gps-location-resolver/audit.csv
```

See `resolve_no_gps_locations_Instructions.txt` for `--dry-run`, `--output`,
and every other flag.

## Changelog

- **v1** (Iceland): 13 rules covering Jan 14–15 (Reykjavík, Golden Circle). 68/69 candidates resolved.
- **v2** (+ Sweden): added 10 rules covering Jan 17–20 (Kiruna, Abisko, Jukkasjärvi/ICEHOTEL, Nutti Sami Siida reindeer farm). 260/266 new candidates resolved (328/336 cumulative). Left unmatched on purpose:
  - `IMG-20260114-WA0002.jpg` — in-flight WhatsApp photo, no location clues in its own caption.
  - The 4 Jan 16 runestone photos (`20260116_*.jpg`) — captions describe "a runestone in a snowy Swedish town square" beside a lake, never naming the town. This strongly resembles **Sigtuna** (Sweden's runestone-studded old town on Lake Mälaren, a common Stockholm-area stopover) but the captions don't say so explicitly, so no rule was added rather than assert an unconfirmed town. Add a `sigtuna` rule (matching on `"runestone"`, which is otherwise unique in this dataset) once confirmed.
  - `Geysir.mp4` (filed under Jan 19, in Sweden) — caption itself is unsure what it shows ("likely...a geyser or hot-spring-style feature"); the name is probably a leftover/misfiled label rather than Iceland's Geysir given the date. Left for manual review.
  - `IMG-20260119-WA0115.jpg` — "three people on a snowy street in a nearby Swedish town at night" — no town named.
- **v3** (+ Jan 22 retrospective shares): more WhatsApp-shared photos from earlier in the trip got saved into the Jan 22 folder (a travel day: Kiruna → Stockholm). Added a `vana_spa` rule (Elite Hotel Frost's spa in Kiruna) and extended `jukkasjarvi_reindeer_farm` with `"ice fishing"`/`"lavvu"` (both unique to that outing in this dataset). 127/131 new Jan 22 candidates resolved; no regressions on previously-resolved records. Left unmatched: two unnamed-venue meals during the travel day, and two records (a reindeer-lead photo, a second flight-boarding photo) with too weak a signal to place confidently.
- **v4** (centroid_lat/centroid_lon): every rule in `gazetteer.json` now also carries the landmark's own real-world `centroid_lat`/`centroid_lon` (looked up per place, not derived from any file). `resolve()` copies both onto every record it resolves. Because 478 records had already been resolved by v1–v3 (before these fields existed), `is_candidate()` was widened to also treat an already-`"subject_inferred"` record as a candidate when it's still missing `centroid_lat`/`centroid_lon` — a one-time **backfill** pass, keyed on key-presence so it never re-runs once a record has the fields (even when they're correctly `null`). Ran against the full Jan 2026 catalog: 8 newly resolved (fresh matches, same as any normal run) + 478 backfilled with coordinates only (no other field changed) + 248 skipped (unrelated — Jan 23–30 records outside this gazetteer's Iceland/Sweden coverage; not this update's scope, see "Extending the gazetteer for a new trip" in the shared Instructions.txt). Only `golden_circle_tectonic_exhibit` has `centroid_lat`/`centroid_lon: null` — an unnamed indoor exhibit with no confirmed location of its own to map. This is also what finally lets `data/multimedia-location/multimedia-location-data.json`'s `resolved_location`-sourced clusters report real `centroid_lat`/`centroid_lon` instead of always `null` — see "Downstream: multimedia-location-data.json" in the shared Instructions.txt.
- **v5** (+ Stockholm leg, Jan 23–26): extended the gazetteer to the trip's Stockholm days — 25 new rules covering the Royal Palace (with separate rules for the Hall of State/Rikssalen, the Royal Treasury/Skattkammaren, and Gustav III's Museum of Antiquities, grouped under one `location_label` the same way `hallgrimskirkja_tower`/`_plaza` share theirs), Storkyrkan, Tyska kyrkan, Riddarholmen Church (plus a bare-island fallback), Stortorget, Riksdagshuset, the Royal Opera House/Klara kyrka area, Nationalmuseum, Kungsträdgården, the Vasa Museum, Nordiska museet, the Viking Museum, a Djurgården fallback, Vaxholm (fortress, Waxholms Hotell, and a town-generic fallback), a Gamla Stan fallback, and a citywide `stockholm_generic` fallback — plus one keyword addition to the existing `abisko_sky_station` rule (`"Aurora Skystation"`, the one-word signage variant seen in Jan 26 return-visit captions). `stockholm_city_hall` is deliberately checked before `stockholm_riddarholmen_church`/`stockholm_riddarholmen_generic`/`stockholm_royal_opera_klara`, since several photos taken from City Hall's own grounds name what's visible *across the water* rather than City Hall itself — the actual standing location wins, same principle as the existing `laugarvatn`/`thingvellir` ordering. Ran against the full catalog: 209 newly resolved (up from 39 still-skipped Jan 23–26 candidates) — the remainder stayed unmatched on purpose, for the same reasons as v1–v3's deliberate skips: unnamed-venue meals, a street address (`Fiskaregatan`) with no city/district named in its own caption, generic in-flight/aerial shots, and aurora-excursion photos that don't themselves name the venue (only the ones mentioning the "Welcome to Aurora Skystation" sign do). All 209 came with `centroid_lat`/`centroid_lon` from the start, via v4's logic — no separate backfill pass was needed. `data/multimedia-location/multimedia-location-data.json` was regenerated afterward (32 new clusters, 31 with real coordinates); see that file's own build script for the clustering side.
- **v6** (August 2026): `resolve_no_gps_locations.py` itself moved out of this
  folder to the shared `travel-journals/scripts/python/resolve_no_gps_locations.py`
  (one copy now serves every trip). `--gazetteer` is a required argument as
  of this move — it no longer defaults to a `gazetteer.json` sitting next
  to the script. This trip's `gazetteer.json`, this README, and `audit.csv`
  are unaffected and still live here.
