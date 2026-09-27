// Distances in metres, time in seconds. Geometry follows each GTFS trip's direction.
export const PREDICT_SECONDS = 60;
const MAX_SPEED = 35;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Ease to rest when GPS goes quiet: full speed for 30 seconds, zero by 60.
function travelTime(age) {
  const t = clamp(age, 0, PREDICT_SECONDS);
  const tail = Math.max(0, t - 30);
  return Math.min(t, 30) + tail - tail * tail / 60;
}

export function pointAt(path, distance) {
  const points = path.points;
  const s = clamp(distance, 0, points.at(-1)[2]);
  let lo = 0, hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][2] < s) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const ratio = b[2] === a[2] ? 0 : (s - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

export function project(path, report, previous) {
  const points = path.points, scale = 111320 * Math.cos(report.lat * Math.PI / 180);
  let best = null, bestScore = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const x = (b[1] - a[1]) * scale, y = (b[0] - a[0]) * 111320;
    const px = (report.lng - a[1]) * scale, py = (report.lat - a[0]) * 111320;
    const fraction = clamp((px * x + py * y) / (x * x + y * y || 1), 0, 1);
    const error = Math.hypot(px - fraction * x, py - fraction * y);
    const distance = a[2] + fraction * (b[2] - a[2]);
    // Disambiguate loops/crossings using plausible progress since the previous GPS fix.
    const dt = previous ? report.timestamp - previous.report.timestamp : 0;
    if (previous && (distance < previous.anchor - 40 || distance > previous.anchor + MAX_SPEED * dt + 100)) continue;
    const score = error + (previous ? Math.abs(distance - previous.anchor - previous.speed * dt) * .02 : 0);
    if (score < bestScore) { bestScore = score; best = { distance, error }; }
  }
  return best;
}

export function distanceAt(model, now) {
  const elapsed = Math.max(0, now - model.received);
  const target = model.anchor + model.speed * travelTime(now - model.report.timestamp);
  return clamp(target + model.correction * Math.exp(-elapsed / model.settle), 0, model.path.points.at(-1)[2]);
}

export function positionAt(model, now) {
  return model.path ? pointAt(model.path, distanceAt(model, now)) : [model.report.lat, model.report.lng];
}

export function updateMotion(previous, report, path, now) {
  const sameTrip = previous && previous.report.routeId === report.routeId &&
    previous.report.tripId === report.tripId && previous.report.shapeId === report.shapeId;
  if (sameTrip && report.timestamp <= previous.report.timestamp) return previous;
  const continuous = sameTrip && report.timestamp - previous.report.timestamp <= 120 && previous.path === path;
  const match = path && project(path, report, continuous && previous.path ? previous : null);
  // Detours or missing trip geometry: show GPS instead of inventing a road path.
  if (!match || match.error > 100) return { report, path: null, speed: 0 };
  const dt = continuous ? report.timestamp - previous.report.timestamp : 0;
  const measured = dt > 0 && previous.path ? (match.distance - previous.anchor) / dt : null;
  const speed = report.stopped ? 0 : measured !== null ? clamp(measured < .4 ? 0 : measured, 0, MAX_SPEED) :
    clamp(report.speed ?? path.speed, 0, MAX_SPEED);
  const target = match.distance + speed * travelTime(now - report.timestamp);
  const correction = continuous && previous.path ? distanceAt(previous, now) - target : 0;
  // Adjust prediction speed through a decaying position error, preserving position at receipt.
  // ponytail: one along-route estimate; add stop-by-stop dwell modelling only if needed.
  return { report, path, anchor: match.distance, speed, received: now,
    correction, settle: Math.max(8, Math.abs(correction) / 15) };
}
