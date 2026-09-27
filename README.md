# CDTA HoloMap

A local 3D holographic map of Albany and the Capital Region, with live CDTA buses and GPS-corrected motion prediction.

## Run locally

Requires Node.js 22.13+ and npm.

```sh
cd cdta-live
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). Keep the terminal running; press Ctrl+C to stop.

```sh
npm run build
node lib/motion.test.mjs
node lib/vehicles.test.mjs
```

See [app documentation](cdta-live/README.md) for data sources and prediction behavior.

Development is local only. Commit after every completed change; do not publish to ChatGPT Sites.
