'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusFront, LocateFixed, ChevronDown, Radio, X } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { Checkbox } from '@/components/ui/checkbox';
import routes from '@/data/routes.json';
import { freshVehicles, MAX_AGE } from '@/lib/vehicles.mjs';

type Vehicle = { id: string; routeId: string; lat: number; lng: number; bearing: number | null; timestamp: number };
type Feed = { timestamp: number; vehicles: Vehicle[] };
const initialRoutes = ['1', '10', '12', '905'];
const routeById = new Map(routes.map(r => [r.id, r]));

export default function Home() {
  const [selected, setSelected] = useState<string[]>(initialRoutes);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState('');
  const [now, setNow] = useState(Date.now() / 1000);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const visible: Vehicle[] = freshVehicles(feed?.vehicles ?? [], now).filter((v: Vehicle) => selected.includes(v.routeId));
  const stale = !!feed && (now - feed.timestamp > MAX_AGE || feed.timestamp > now + 30);
  const displayVehicles = error || stale ? [] : visible;

  useEffect(() => {
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !mapElement.current) return;
      library.current = L;
      const instance = L.map(mapElement.current, { zoomControl: false }).setView([42.683, -73.79], 12);
      map.current = instance;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance).on('tileerror', () => setMapError('Map tiles could not load. Check your connection.'));
      L.control.zoom({ position: 'bottomright' }).addTo(instance);
      const observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(mapElement.current);
      instance.on('unload', () => observer.disconnect());
      setReady(true);
    }).catch(() => setMapError('The map could not load. Please reload this page.'));
    return () => { disposed = true; map.current?.remove(); map.current = null; markers.current.clear(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/vehicles', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Live feed unavailable. Retrying automatically…');
        const data = await response.json() as Feed;
        if (!Array.isArray(data.vehicles) || !Number.isFinite(data.timestamp)) throw new Error('Invalid live feed. Retrying automatically…');
        if (!disposed) { setFeed(data); setError(''); setNow(Date.now() / 1000); }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'Live feed unavailable. Retrying automatically…');
      } finally { if (!disposed) timer = setTimeout(refresh, 15000); }
    }
    refresh();
    const clock = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, []);

  useEffect(() => {
    const L = library.current, instance = map.current;
    if (!L || !instance) return;
    const ids = new Set(displayVehicles.map(v => v.id));
    markers.current.forEach((marker, id) => { if (!ids.has(id)) { marker.remove(); markers.current.delete(id); } });
    displayVehicles.forEach(v => {
      const route = routeById.get(v.routeId);
      const label = route?.number ?? v.routeId;
      const badge = document.createElement('div');
      badge.className = 'bus-marker'; badge.style.background = route?.color ?? '#123573';
      badge.textContent = label;
      let marker = markers.current.get(v.id);
      if (!marker) {
        marker = L.marker([v.lat, v.lng], { icon: L.divIcon({ html: badge, className: '', iconSize: [44, 32], iconAnchor: [22, 16] }), title: `Route ${label}, bus ${v.id}` }).addTo(instance);
        markers.current.set(v.id, marker);
      } else {
        marker.setLatLng([v.lat, v.lng]);
        if (marker.getElement()?.textContent !== label) {
          marker.setIcon(L.divIcon({ html: badge, className: '', iconSize: [44, 32], iconAnchor: [22, 16] }));
          const element = marker.getElement();
          if (element) element.title = `Route ${label}, bus ${v.id}`;
        }
      }
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${label} · ${route?.name ?? 'CDTA'}`;
      const detail = document.createElement('p');
      detail.textContent = `Bus ${v.id} · Reported ${Math.max(0, Math.floor(now - v.timestamp))}s ago`;
      popup.appendChild(title); popup.appendChild(detail);
      if (marker.getPopup()) marker.setPopupContent(popup); else marker.bindPopup(popup);
    });
  }, [feed, selected, now, ready, error, stale]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    Promise.resolve(context.registerTool({
      name: 'select_bus_lines', title: 'Select CDTA bus lines',
      description: 'Replace the bus lines selected on the visible live map.',
      inputSchema: { type: 'object', properties: { routeIds: { type: 'array', items: { type: 'string' } } }, required: ['routeIds'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const ids = (input as {routeIds?: unknown})?.routeIds;
        if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && routeById.has(id))) throw new Error('Use valid CDTA route IDs.');
        const routeIds = [...new Set(ids)] as string[];
        flushSync(() => setSelected(routeIds));
        return { selectedRouteIds: routeIds };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, []);

  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(r => r !== id) : [...current, id]); }
  function fitBuses() {
    const L = library.current;
    if (L && map.current && displayVehicles.length) map.current.fitBounds(L.latLngBounds(displayVehicles.map(v => [v.lat, v.lng])), { padding: [60, 60], maxZoom: 14 });
    else map.current?.setView([42.683, -73.79], 12);
  }
  const status = error ? 'Connection interrupted' : stale ? 'Feed is out of date' : feed ? 'Live locations' : 'Connecting to CDTA';
  const count = (id: string) => displayVehicles.filter(v => v.routeId === id).length;
  return <main>
    <aside className={`panel ${open ? 'expanded' : ''}`}>
      <header className="brand"><span className="brand-icon"><BusFront size={24}/></span><div><h1>CDTA <span>Live</span></h1><p>ALBANY & THE CAPITAL REGION</p></div></header>
      <div className="panel-heading"><div><h2>Your bus lines</h2><p>Select lines to see their buses.</p></div><button className="mobile-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Close route picker' : 'Open route picker'} aria-expanded={open}>{open ? <X/> : <ChevronDown/>}</button></div>
      <div className="selection-summary"><span>{selected.length} selected</span><button onClick={() => setSelected([])} disabled={!selected.length}>Clear</button></div>
      <div className="route-list" aria-label="CDTA bus lines">
        {routes.map(route => <label className={`route ${selected.includes(route.id) ? 'selected' : ''}`} key={route.id}>
          <Checkbox checked={selected.includes(route.id)} onCheckedChange={() => toggle(route.id)} aria-label={`${route.number} ${route.name}`}/>
          <span className="route-number" style={{background: route.color}}>{route.number}</span>
          <span className="route-name">{route.name}</span>
          {selected.includes(route.id) && <span className="route-count" title="Buses with recent locations">{count(route.id)}</span>}
        </label>)}
      </div>
      <footer><span>Independent tracker · Data by CDTA</span><a href="https://www.cdta.org/developer" target="_blank" rel="noreferrer">Data source ↗</a></footer>
    </aside>
    <section className="map-region" aria-label="Live bus map">
      <div ref={mapElement} className="map"/>
      <div className="map-status" role="status"><span className={`signal ${feed && !error && !stale ? 'connected' : ''}`}><Radio size={18}/></span><div><strong>{status}</strong><span>{feed && !error && !stale ? `${displayVehicles.length} buses on selected lines · updated ${Math.max(0, Math.floor(now - feed.timestamp))}s ago` : 'Updates automatically every 15 seconds'}</span></div></div>
      <button className="fit-button" onClick={fitBuses} aria-label="Fit selected buses on map" title="Fit selected buses"><LocateFixed size={21}/></button>
      {(error || stale || !selected.length || (feed && !displayVehicles.length)) && <div className="map-message" role="status">{error || (stale ? 'CDTA’s latest report is more than 2 minutes old. Waiting for fresh locations.' : !selected.length ? 'Select a bus line to start tracking.' : 'No recent bus locations for these lines. Service may not be running.')}</div>}
      {mapError && <div className="tile-error" role="alert">{mapError}</div>}
      <div className="map-note">Reported GPS locations · Reports older than 2 minutes hidden</div>
    </section>
  </main>;
}
