import tripShapes from '@/data/trip-shapes.json';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { FEED_URL, normalizeFeed } from '@/lib/vehicles.mjs';

export async function GET() {
  try {
    const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error(`CDTA returned ${response.status}`);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
    const data = normalizeFeed(feed);
    const shapes: Record<string, string> = tripShapes;
    data.vehicles = data.vehicles.map((v: { tripId: string | null }) => ({ ...v, shapeId: shapes[v.tripId ?? ''] ?? null }));
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'CDTA live locations are temporarily unavailable.' }, { status: 502 });
  }
}
