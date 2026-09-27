'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusFront, LocateFixed, ChevronDown, Radio, X } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { Checkbox } from '@/components/ui/checkbox';
import routeData from '@/data/routes.json';
import { freshVehicles, MAX_AGE } from '@/lib/vehicles.mjs';
import { updateMotion, positionAt, pointAt, distanceAt } from '@/lib/motion.mjs';

type Vehicle = { id: string; routeId: string; lat: number; lng: number; tripId: string | null; shapeId: string | null; speed: number | null; stopped: boolean; timestamp: number };
type Path = { routeIds: string[]; arrowRouteIds: string[]; points: [number, number, number][]; speed: number };
type Feed = { timestamp: number; vehicles: Vehicle[] };
// Display colors distinguish lines; BusPlus keeps its named line colors.
const palette = ['#087fb9', '#b27608', '#078962', '#8748b5', '#cf345c', '#14828b', '#af651a', '#4b68bd'];
const busPlus: Record<string, string> = { '905': '#e51b42', '910': '#8748b5', '922': '#176eae', '923': '#008ca5' };
const routes = routeData.map((route, index) => ({ ...route, color: busPlus[route.id] ?? palette[index % palette.length] }));
function heading(from: number[], to: number[]) {
  return Math.atan2(-(to[0] - from[0]), (to[1] - from[1]) * Math.cos(from[0] * Math.PI / 180)) * 180 / Math.PI;
}
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
  const [pathError, setPathError] = useState(false);
  const [paths, setPaths] = useState<Record<string, Path>>({});
  const motion = useRef(new Map<string, ReturnType<typeof updateMotion>>());
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const routeArrows = useRef<{ marker: Leaflet.Marker; glyph: HTMLElement; path: Path; offset: number; length: number; speed: number }[]>([]);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const visible: Vehicle[] = freshVehicles(feed?.vehicles ?? [], now).filter((v: Vehicle) => selected.includes(v.routeId));
  const stale = !!feed && (now - feed.timestamp > MAX_AGE || feed.timestamp > now + 30);
  const displayVehicles = stale ? [] : visible;

  useEffect(() => {
    let disposed = false;
    import('leaflet').then(L => {
      if (disposed || !mapElement.current) return;
      library.current = L;
      const instance = L.map(mapElement.current, { zoomControl: false }).setView([42.683, -73.79], 12);
      map.current = instance;
      for (const [name, zIndex] of [['routePaths', '410'], ['routeArrows', '420']]) {
        const pane = instance.createPane(name);
        pane.style.zIndex = zIndex;
        pane.style.opacity = '0.5';
        pane.style.pointerEvents = 'none';
      }
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
    const controller = new AbortController();
    fetch('/paths.json', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Route geometry unavailable');
      return response.json();
    }).then(data => setPaths(data as Record<string, Path>)).catch(() => { if (!controller.signal.aborted) setPathError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const L = library.current, instance = map.current;
    if (!L || !instance || !ready) return;
    const lines = L.layerGroup().addTo(instance);
    const arrows = L.layerGroup().addTo(instance);
    const selectedPaths = Object.values(paths).filter(path => path.routeIds.some(id => selected.includes(id)));
    for (const path of selectedPaths) {
      const route = routeById.get(path.routeIds.find(id => selected.includes(id))!);
      L.polyline(path.points.map(([lat, lng]) => [lat, lng]), {
        pane: 'routePaths', color: route?.color ?? '#123573', weight: 6,
        opacity: 1, interactive: false, className: 'selected-route-path',
      }).addTo(lines);
    }
    function rebuildArrows() {
      if (!L || !instance) return;
      arrows.clearLayers();
      routeArrows.current = [];
      const center = instance.getSize().divideBy(2);
      const metresPerPixel = instance.distance(instance.containerPointToLatLng(center), instance.containerPointToLatLng(center.add([100, 0]))) / 100;
      for (const path of selectedPaths) {
        const routeId = path.arrowRouteIds.find(id => selected.includes(id));
        if (!routeId) continue;
        const length = path.points.at(-1)![2];
        if (!length) continue;
        const count = Math.min(80, Math.max(1, Math.floor(length / (metresPerPixel * 110))));
        for (let i = 0; i < count; i++) {
          const glyph = document.createElement('span');
          glyph.className = 'route-arrow-glyph';
          glyph.style.background = routeById.get(routeId)?.color ?? '#123573';
          const marker = L.marker(pointAt(path, length * i / count) as [number, number], {
            pane: 'routeArrows', interactive: false, keyboard: false,
            icon: L.divIcon({ html: glyph, className: 'route-arrow', iconSize: [16, 14], iconAnchor: [8, 7] }),
          }).addTo(arrows);
          routeArrows.current.push({ marker, glyph, path, offset: length * i / count, length, speed: metresPerPixel * 22 });
        }
      }
    }
    rebuildArrows();
    instance.on('zoomend', rebuildArrows);
    return () => {
      instance.off('zoomend', rebuildArrows);
      routeArrows.current = [];
      lines.remove(); arrows.remove();
    };
  }, [selected, paths, ready]);

  useEffect(() => {
    const ids = new Set(feed?.vehicles.map(v => v.id));
    motion.current.forEach((_, id) => { if (!ids.has(id)) motion.current.delete(id); });
    for (const vehicle of feed?.vehicles ?? []) {
      const path = vehicle.shapeId ? paths[vehicle.shapeId] : undefined;
      const old = motion.current.get(vehicle.id);
      // Geometry may finish loading after the first GPS response.
      const previous = old && !old.path && path ? undefined : old;
      motion.current.set(vehicle.id, updateMotion(previous, vehicle, path, Date.now() / 1000));
    }
  }, [feed, paths]);

  useEffect(() => {
    if (!ready) return;
    let frame: number;
    function animate() {
      const time = Date.now() / 1000;
      markers.current.forEach((marker, id) => {
        const model = motion.current.get(id);
        if (model && time - model.report.timestamp <= MAX_AGE) {
          marker.setLatLng(positionAt(model, time) as [number, number]);
          const pointer = marker.getElement()?.querySelector<HTMLElement>('.bus-heading');
          if (pointer) {
            pointer.hidden = !model.path;
            if (model.path) {
              const s = distanceAt(model, time);
              pointer.style.transform = `rotate(${heading(pointAt(model.path, s - 15), pointAt(model.path, s + 15))}deg)`;
            }
          }
        }
      });
      const phase = performance.now() / 1000;
      routeArrows.current.forEach(({ marker, glyph, path, offset, length, speed }) => {
        const distance = (offset + phase * speed) % length;
        const position = pointAt(path, distance);
        const behind = pointAt(path, Math.max(0, distance - 15));
        const ahead = pointAt(path, Math.min(length, distance + 15));
        const angle = heading(behind, ahead);
        marker.setLatLng(position as [number, number]);
        glyph.style.transform = `rotate(${angle}deg)`;
      });
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

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
      badge.className = 'bus-marker'; badge.style.setProperty('--bus-color', route?.color ?? '#123573');
      const pointer = document.createElement('span'); pointer.className = 'bus-heading'; pointer.hidden = true;
      const number = document.createElement('span'); number.textContent = label;
      badge.appendChild(pointer); badge.appendChild(number);
      let marker = markers.current.get(v.id);
      if (!marker) {
        const model = motion.current.get(v.id);
        const position = model ? positionAt(model, Date.now() / 1000) : [v.lat, v.lng];
        marker = L.marker(position as [number, number], { icon: L.divIcon({ html: badge, className: '', iconSize: [40, 26], iconAnchor: [20, 13] }), title: `Route ${label}, bus ${v.id}` }).addTo(instance);
        markers.current.set(v.id, marker);
      } else {
        if (marker.getElement()?.textContent !== label) {
          marker.setIcon(L.divIcon({ html: badge, className: '', iconSize: [40, 26], iconAnchor: [20, 13] }));
          const element = marker.getElement();
          if (element) element.title = `Route ${label}, bus ${v.id}`;
        }
      }
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${label} · ${route?.name ?? 'CDTA'}`;
      const detail = document.createElement('p');
      detail.textContent = `Bus ${v.id} · ${motion.current.get(v.id)?.path ? 'Predicted position' : 'GPS position'} · GPS ${Math.max(0, Math.floor(now - v.timestamp))}s ago`;
      popup.appendChild(title); popup.appendChild(detail);
      if (marker.getPopup()) marker.setPopupContent(popup); else marker.bindPopup(popup);
    });
  }, [feed, selected, now, ready, error, stale, paths]);

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
    if (L && map.current && displayVehicles.length) map.current.fitBounds(L.latLngBounds(displayVehicles.map(v => markers.current.get(v.id)?.getLatLng() ?? L.latLng(v.lat, v.lng))), { padding: [60, 60], maxZoom: 14 });
    else map.current?.setView([42.683, -73.79], 12);
  }
  const status = error ? 'Connection interrupted' : stale ? 'Feed is out of date' : feed ? 'Live movement' : 'Connecting to CDTA';
  const count = (id: string) => displayVehicles.filter(v => v.routeId === id).length;
  return <main>
    <aside className={`panel ${open ? 'expanded' : ''}`}>
      <header className="brand"><span className="brand-icon"><BusFront size={24}/></span><div><h1>CDTA <span>Live</span></h1><p>ALBANY & THE CAPITAL REGION</p></div></header>
      <div className="panel-heading"><div><h2>Bus lines <span className="selected-total">{selected.length}</span></h2><p>Select the lines you want to follow.</p></div><button className="route-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Close route picker' : 'Open route picker'} aria-expanded={open} aria-controls="route-options">{open ? <X/> : <ChevronDown/>}</button></div>
      {!open && <div className="selected-lines" aria-label="Selected bus lines">{selected.map(id => { const route = routeById.get(id); return <button key={id} style={{background: route?.color}} onClick={() => toggle(id)} aria-label={`Remove route ${route?.number ?? id}`} title={route?.name}>{route?.number ?? id}</button>; })}{!selected.length && <button className="choose-lines" onClick={() => setOpen(true)}>Choose bus lines</button>}</div>}
      <div className="selection-summary"><span>{selected.length} selected</span><button onClick={() => setSelected([])} disabled={!selected.length}>Clear</button></div>
      <div id="route-options" className="route-list" aria-label="CDTA bus lines">
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
      <div className="map-note">{Object.keys(paths).length ? 'Predicted between GPS updates · Slows to rest if updates stop' : pathError ? 'GPS positions only · Route geometry unavailable' : 'GPS positions · Loading route geometry…'}</div>
    </section>
  </main>;
}
