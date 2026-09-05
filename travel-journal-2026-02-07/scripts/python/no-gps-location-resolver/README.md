# no-gps-location-resolver — travel-journal-2026-02-07

This folder holds this trip's own data for the shared **no-gps-location-resolver**
tool. The script and the full walkthrough (what it does, how gazetteer
matching works, all CLI flags, limitations) live at
`travel-journals/scripts/python/resolve_no_gps_locations.py` and its sibling
`resolve_no_gps_locations_Instructions.txt` — read that file first. This
README covers only what's specific to this trip: its own gazetteer and the
history of how it was built up.

## Files

- `gazetteer.json` — the ruleset for the February 2026 Southwest road trip:
  Scottsdale/Pinnacle Peak Park (Feb 8), the Arizona-to-California desert
  crossing and state line (Feb 12), Joshua Tree National Park (Feb 12–13,
  including Wall Street Mill, Jumbo Rocks, and Keys View), Twentynine Palms
  and the Pines to Palms Highway (Feb 13–14), Camp Pendleton and Oceanside
  (Feb 14–17), and Temecula Valley Wine Country (Feb 15).
- `audit.csv` — this trip's most recent `--report` output. Safe to
  regenerate; not hand-maintained.

## Running it for this trip

From the travel-journals collection root:

```bash
python3 scripts/python/resolve_no_gps_locations.py \
  travel-journal-2026-02-07/data/multimedia/multimedia-data.json \
  --gazetteer travel-journal-2026-02-07/scripts/python/no-gps-location-resolver/gazetteer.json \
  --in-place \
  --report travel-journal-2026-02-07/scripts/python/no-gps-location-resolver/audit.csv
```

See `resolve_no_gps_locations_Instructions.txt` for `--dry-run`, `--output`,
and every other flag.

## Changelog

- **v1**: 19 rules built from this trip's 152 `subject_description.standard`
  entries (all newly written in the same pass — see this folder's sibling
  `data/multimedia/multimedia-data.json` for that work). Landmark
  coordinates were looked up individually (park/city GIS pages, trail
  guides, business addresses) rather than estimated from the trip route.
  Ran against the full catalog: of 152 records, 45 had already been
  resolved via real reverse geocoding (`internet_geocode`, from a
  `build-multimedia-data.py` run with actual location data) and were left
  untouched; of the remaining 107 `no_gps` candidates, **91 resolved** via
  this gazetteer and 16 were skipped on purpose:
  - Three Pinnacle Peak hike photos (`20260208_123748.jpg`,
    `20260208_134932.jpg`, `20260208_135126.jpg`, `20260208_135247.jpg` —
    two hikers' portrait plus the three chuckwalla-lizard close-ups) whose
    own captions say only "the trail," never repeating "Pinnacle Peak."
  - Four home/still-life photos with no place name at all: the Arizona
    craft beer four-pack (`20260209_094958.jpg`), the antique harmonica box
    (`20260210_114015.jpg`), the painted encouragement stone
    (`20260210_164057.jpg`).
  - Three anonymous stretches of the Feb 12 desert highway crossing
    (`20260212_132532.jpg`, `20260212_133317.jpg`, `20260212_134157.jpg`) —
    genuinely unnamed dry-lakebed/pull-off shots between the named Parker/
    Desert Center junction and California state-line photos.
  - Two cottontail-rabbit close-ups (`20260214_095750.jpg`,
    `20260214_095810.jpg`) and a telephoto of the San Bernardino Mountains
    (`20260214_101258.jpg`) — a distant mountain range named as the
    *subject*, not the photographer's own location, so no rule was added
    rather than mislocate the shot to the mountains themselves (same
    principle as `stockholm_city_hall` vs. what's visible across the water
    in the Jan 2026 trip's gazetteer).
  - The Desert Willow Trail / Yucca Ridge Trail junction sign
    (`20260214_100440.jpg`) — a real trail junction, but which trail
    system it belongs to isn't confirmed from the caption alone, so no
    rule was added rather than guess.
  - Two Oceanside sunset/surf photos (`20260216_172256.jpg`,
    `20260216_172301.jpg`) that don't repeat "Oceanside" in their own
    caption, unlike the rest of that afternoon's sequence.

  Two rules carry an intentionally `null` centroid: `parker_desert_center_junction`
  (a highway distance sign toward Parker, AZ / Desert Center, CA — which
  specific junction it sits on wasn't confirmed) and, within that same
  rule, no fallback guess was made. `welcome_to_california_monument` *does*
  carry a centroid, but it's the general California/Arizona state-line
  crossing on I-10 near Blythe rather than a surveyed pin for that specific
  roadside sculpture.

  One known, accepted imprecision: `20260208_094218.jpg` (the backyard pool
  photo that opens the trip) matches `pinnacle_peak_park` because its own
  caption reads "...before heading out to Pinnacle Peak Park" — the rule
  has no way to distinguish "at X" from "on the way to X" in a single
  substring match. Left as-is since the home in question is in the same
  Scottsdale area as the park; revisit if a future trip's captions make
  this pattern more common.
