# CDTA-HoloMap

A minimal Albany/Capital Region bus map: select CDTA routes and view their predicted positions between live GPS reports. Independent implementation inspired by the map-first idea of [taiwan-rail-live](https://github.com/siriushsu/taiwan-rail-live); no code or assets copied from that project.

## Run

Requires Node 22.13+ and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The app runs locally; it is not published through ChatGPT Sites. Build with `npm run build`. Check feed logic with `node lib/vehicles.test.mjs` and `node lib/motion.test.mjs`.

## Data

- Public CDTA GTFS-Realtime vehicle feed: `http://gtfs.cdta.org:8080/gtfsrealtime/VehiclePositions`, fetched server-side so the browser uses HTTPS/same-origin requests. No API key required at time of implementation.
- Route catalog: `data/routes.json`, extracted from [CDTA's static GTFS](https://www.cdta.org/schedules/google_transit.zip) on September 26, 2026. Refresh this catalog when CDTA changes routes.
- Trip-to-shape mappings and route geometry come from the same GTFS snapshot. Regenerate them with `python3 scripts/extract-motion-data.py /path/to/google_transit.zip`.
- [CDTA developer resources and terms](https://www.cdta.org/developer).
- MapLibre 3D map with OpenFreeMap/OpenStreetMap data and Three.js holographic buses; internet access required.

The feed is polled every 15 seconds after each request completes. GPS reports more than 120 seconds old, malformed coordinates, and reports missing timestamps are hidden. Feed failures are shown explicitly; recent buses keep their bounded prediction while retrying. No buses are created from schedules alone. A route may have no recent GPS reports even when service is scheduled. The upstream CDTA feed uses HTTP, so its server-side connection is unencrypted.

Selected routes have 50%-opacity highlights and dark-filled, route-colored circles at actual CDTA bus stops. Stops are joined to routes through GTFS stop times and trips, deduplicated by stop ID, and resized with zoom. Buses animate above the stationary stop circles; there are no moving route arrows.

## Continuous movement

Each actual bus is projected onto its GTFS trip geometry. A frame animation advances it along that path, including corners. The first observation uses the trip shape's scheduled average speed (or reported speed, when provided); subsequent GPS timestamps and along-route distances determine its speed. Each update preserves the currently displayed position and reconciles its error through an exponential correction to prediction speed, typically over 8 seconds. This is an estimate, not continuous GPS.

A stopped report sets the target speed to zero. Repeated or older reports never restart the prediction. Trip changes reset motion. Without new GPS, travel gradually slows after 30 seconds and stops extrapolating at 60 seconds; the bus is hidden after 120 seconds. Missing geometry and GPS more than 100 metres off its expected path use GPS-only positions (for example, detours). In crossings, previous progress helps choose the correct route segment. Scheduled average speeds include dwell time; this minimal predictor does not model individual stop dwell times.

Scope intentionally excludes timetable UI, arrivals, route planning, and accounts. The UI includes all bus routes in the current CDTA catalog, with Albany routes selected initially. Development is local only. Commit each completed change to Git.

Click a bus label or model to follow its predicted position. Drag the map, press Escape, choose Fit selected buses, or click Stop following to release the camera. Following ends when that bus is hidden or its location expires.

Trackpad: two-finger swipes pan horizontally and vertically; pinch zooms. Native two-finger twist rotates in browsers exposing WebKit GestureEvent (Safari), in both 2D and 3D. Chromium does not expose native trackpad rotation to webpages; use the compass rotation control there. Twist and pinch preserve bus following; swiping releases it.
