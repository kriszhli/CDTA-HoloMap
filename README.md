# CDTA Live

A minimal Albany/Capital Region bus map: select CDTA routes and view their predicted positions between live GPS reports. Independent implementation inspired by the map-first idea of [taiwan-rail-live](https://github.com/siriushsu/taiwan-rail-live); no code or assets copied from that project.

## Run

Requires Node 22.13+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by the dev server. Build with `npm run build`. Check feed logic with `node lib/vehicles.test.mjs` and `node lib/motion.test.mjs`.

## Data

- Public CDTA GTFS-Realtime vehicle feed: `http://gtfs.cdta.org:8080/gtfsrealtime/VehiclePositions`, fetched server-side so the browser uses HTTPS/same-origin requests. No API key required at time of implementation.
- Route catalog: `data/routes.json`, extracted from [CDTA's static GTFS](https://www.cdta.org/schedules/google_transit.zip) on September 26, 2026. Refresh this catalog when CDTA changes routes.
- Trip-to-shape mappings and route geometry come from the same GTFS snapshot. Regenerate them with `python3 scripts/extract-motion-data.py /path/to/google_transit.zip`.
- [CDTA developer resources and terms](https://www.cdta.org/developer).
- Leaflet map with OpenStreetMap tiles and attribution; internet access required.

The feed is polled every 15 seconds after each request completes. GPS reports more than 120 seconds old, malformed coordinates, and reports missing timestamps are hidden. Feed failures are shown explicitly; recent buses keep their bounded prediction while retrying. No buses are created from schedules alone. A route may have no recent GPS reports even when service is scheduled. The upstream CDTA feed uses HTTP, so its server-side connection is unencrypted.

Selected routes have 50%-opacity highlights for their GTFS path variants, with 50%-opacity animated direction arrows on the most frequent trip pattern in each direction. Arrows indicate route direction, not a particular bus or its speed; buses remain above both overlays.

## Continuous movement

Each actual bus is projected onto its GTFS trip geometry. A frame animation advances it along that path, including corners. The first observation uses the trip shape's scheduled average speed (or reported speed, when provided); subsequent GPS timestamps and along-route distances determine its speed. Each update preserves the currently displayed position and reconciles its error through an exponential correction to prediction speed, typically over 8 seconds. This is an estimate, not continuous GPS.

A stopped report sets the target speed to zero. Repeated or older reports never restart the prediction. Trip changes reset motion. Without new GPS, travel gradually slows after 30 seconds and stops extrapolating at 60 seconds; the bus is hidden after 120 seconds. Missing geometry and GPS more than 100 metres off its expected path use GPS-only positions (for example, detours). In crossings, previous progress helps choose the correct route segment. Scheduled average speeds include dwell time; this minimal predictor does not model individual stop dwell times.

Scope intentionally excludes timetable UI, arrivals, route planning, and accounts. The UI includes all bus routes in the current CDTA catalog, with Albany routes selected initially. Deployment uses the included Sites configuration.
