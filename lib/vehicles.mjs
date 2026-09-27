// CDTA's public GTFS-RT feed. No schedule interpolation or simulated vehicles.
export const FEED_URL = 'http://gtfs.cdta.org:8080/gtfsrealtime/VehiclePositions';
export const MAX_AGE = 120;
export function normalizeFeed(feed) {
  if (!feed.header?.timestamp) throw new Error('Missing feed timestamp');
  const timestamp = Number(feed.header.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Invalid feed timestamp');
  const vehicles = (feed.entity ?? []).flatMap(({ id, vehicle: v }) => {
    const lat = v?.position?.latitude, lng = v?.position?.longitude;
    if (!v?.trip?.routeId || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < 40 || lat > 45 || lng < -76 || lng > -72 || !v.timestamp) return [];
    return [{ id: String(v.vehicle?.id || id), routeId: String(v.trip.routeId),
      lat, lng, bearing: v.position.bearing ?? null, timestamp: Number(v.timestamp) }];
  });
  return { timestamp, vehicles };
}
export function freshVehicles(vehicles, now) {
  return vehicles.filter(v => now - v.timestamp <= MAX_AGE && v.timestamp <= now + 30);
}
