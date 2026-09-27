# CDTA Live

A minimal Albany/Capital Region bus map: select CDTA routes and view their latest reported GPS positions. Independent implementation inspired by the map-first idea of [taiwan-rail-live](https://github.com/siriushsu/taiwan-rail-live); no code or assets copied from that project.

## Run

Requires Node 22.13+ and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by the dev server. Build with `npm run build`. Check feed logic with `node lib/vehicles.test.mjs`.

## Data

- Public CDTA GTFS-Realtime vehicle feed: `http://gtfs.cdta.org:8080/gtfsrealtime/VehiclePositions`, fetched server-side so the browser uses HTTPS/same-origin requests. No API key required at time of implementation.
- Route catalog: `data/routes.json`, extracted from [CDTA's static GTFS](https://www.cdta.org/schedules/google_transit.zip) on September 26, 2026. Refresh this catalog when CDTA changes routes.
- [CDTA developer resources and terms](https://www.cdta.org/developer).
- Leaflet map with OpenStreetMap tiles and attribution; internet access required.

The feed is polled every 15 seconds after each request completes. GPS reports more than 120 seconds old, malformed coordinates, and reports missing timestamps are hidden. Feed failures are shown explicitly; no fake or scheduled buses are substituted. A route may have no recent GPS reports even when service is scheduled. The upstream CDTA feed uses HTTP, so its server-side connection is unencrypted.

Scope intentionally excludes schedules, arrivals, route planning, accounts, and simulated movement. The UI includes all bus routes in the current CDTA catalog, with Albany routes selected initially. Deployment uses the included Sites configuration.
