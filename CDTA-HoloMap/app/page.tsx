'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusFront, LocateFixed, ChevronDown, Radio, X } from 'lucide-react';
import type { Map as GLMap, Marker, GeoJSONSource } from 'maplibre-gl';
import type { HoloVehicle } from '@/lib/hologram-map';
import { Checkbox } from '@/components/ui/checkbox';
import routeData from '@/data/routes.json';
import { freshVehicles, MAX_AGE } from '@/lib/vehicles.mjs';
import { enableTrackpadRotation } from '@/lib/trackpad.mjs';
import { updateMotion, positionAt } from '@/lib/motion.mjs';

type Vehicle = { id: string; routeId: string; lat: number; lng: number; tripId: string | null; shapeId: string | null; speed: number | null; stopped: boolean; timestamp: number };
type Path = { routeIds: string[]; points: [number, number, number][]; speed: number };
type Stop = { id: string; name: string; lat: number; lng: number; routeIds: string[] };
type Feed = { timestamp: number; vehicles: Vehicle[] };
// Display colors distinguish lines; BusPlus keeps its named line colors.
const palette = ['#ff943f', '#67e7ef', '#a5d798', '#caadff', '#ffa5bd', '#72bdf5', '#ffd085', '#a2c9f9'];
const busPlus: Record<string, string> = { '905': '#ff655c', '910': '#caadff', '922': '#72bdf5', '923': '#67e7ef' };
const routes = routeData.map((route, index) => ({ ...route, color: busPlus[route.id] ?? palette[index % palette.length] }));
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
  const [stops, setStops] = useState<Stop[]>([]);
  const motion = useRef(new Map<string, ReturnType<typeof updateMotion>>());
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const library = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const holograms = useRef<HoloVehicle[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  function followBus(id: string | null) {
    followingRef.current = id;
    setFollowing(id);
    if (id && map.current) {
      map.current.stop();
      const model = motion.current.get(id);
      if (model) {
        const [lat, lng] = positionAt(model, Date.now() / 1000);
        map.current.jumpTo({ center: [lng, lat] });
      }
    }
  }
  const [flat, setFlat] = useState(false);
  const [camera, setCamera] = useState({ lat: 42.66, lng: -73.76, bearing: -25 });
  const visible: Vehicle[] = freshVehicles(feed?.vehicles ?? [], now).filter((v: Vehicle) => selected.includes(v.routeId));
  const stale = !!feed && (now - feed.timestamp > MAX_AGE || feed.timestamp > now + 30);
  const displayVehicles = stale ? [] : visible;

  useEffect(() => {
    let disposed = false;
    Promise.all([import('maplibre-gl'), import('@/lib/hologram-map')]).then(([GL, holo]) => {
      if (disposed || !mapElement.current) return;
      library.current = GL;
      GL.setWorkerUrl(holo.workerUrl);
      const instance = new GL.Map({ container: mapElement.current, style: holo.mapStyle,
        center: [-73.765, 42.657], zoom: 15.2, pitch: 60, bearing: -25,
        // Constrain every camera update, including wheel/pinch and eased zoom frames.
        // Do not issue jumpTo during a gesture: it would interrupt the zoom animation.
        transformCameraUpdate: () => {
          const id = followingRef.current;
          const model = id ? motion.current.get(id) : undefined;
          const time = Date.now() / 1000;
          if (!model || time - model.report.timestamp > MAX_AGE) return {};
          const [lat, lng] = positionAt(model, time);
          return { center: new GL.LngLat(lng, lat) };
        },
        maxPitch: 75, canvasContextAttributes: { antialias: true }, attributionControl: { compact: true } });
      map.current = instance;
      const removeTrackpadRotation = enableTrackpadRotation(instance, () => followBus(null));
      instance.on('remove', removeTrackpadRotation);
      instance.addControl(new GL.NavigationControl({ visualizePitch: true }), 'bottom-right');
      instance.on('load', () => {
        if (disposed) return;
        instance.addSource('selected-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        instance.addLayer({ id: 'route-glow', type: 'line', source: 'selected-paths', paint: { 'line-color': ['get', 'color'], 'line-width': 12, 'line-opacity': .18, 'line-blur': 5 } });
        instance.addLayer({ id: 'route-lines', type: 'line', source: 'selected-paths', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': .55 } });
        instance.addSource('selected-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        instance.addLayer({ id: 'stop-circles', type: 'circle', source: 'selected-stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4], 'circle-color': '#0b191f', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } });
        instance.addLayer(holo.createBusLayer(() => holograms.current, followBus));
        setReady(true);
      });
      instance.on('dragstart', () => followBus(null));
      instance.on('error', () => setMapError('Some map details could not load. Check your connection and reload.'));
      instance.on('move', () => {
        const center = instance.getCenter();
        setCamera({ lat: center.lat, lng: center.lng, bearing: instance.getBearing() });
        setFlat(instance.getPitch() < 10);
      });
      const observer = new ResizeObserver(() => instance.resize());
      observer.observe(mapElement.current);
      instance.on('remove', () => observer.disconnect());
    }).catch(() => setMapError('The 3D map needs WebGL. Enable graphics acceleration in your browser and reload.'));
    return () => { disposed = true; map.current?.remove(); map.current = null; markers.current.clear(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/paths.json', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Route geometry unavailable');
      return response.json();
    }).then(data => setPaths(data as Record<string, Path>)).catch(() => { if (!controller.signal.aborted) setPathError(true); });
    fetch('/stops.json', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Bus stops unavailable');
      return response.json();
    }).then(data => setStops(data as Stop[])).catch(() => {
      if (!controller.signal.aborted) setMapError('Bus stops could not load. Please reload the map.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const selectedPaths = Object.values(paths).filter(path => path.routeIds.some(id => selected.includes(id)));
    (instance.getSource('selected-paths') as GeoJSONSource).setData({ type: 'FeatureCollection', features: selectedPaths.map(path => ({
      type: 'Feature', properties: { color: routeById.get(path.routeIds.find(id => selected.includes(id))!)?.color ?? '#ff943f' },
      geometry: { type: 'LineString', coordinates: path.points.map(([lat, lng]) => [lng, lat]) },
    })) });
    (instance.getSource('selected-stops') as GeoJSONSource).setData({ type: 'FeatureCollection', features: stops.filter(stop => stop.routeIds.some(id => selected.includes(id))).map(stop => ({
      type: 'Feature', properties: { color: routeById.get(stop.routeIds.find(id => selected.includes(id))!)?.color ?? '#ff943f' },
      geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
    })) });
  }, [selected, paths, stops, ready]);

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
          const [lat, lng] = positionAt(model, time);
          marker.setLngLat([lng, lat]);
          const instance = map.current;
          if (followingRef.current === id && instance && !instance.isMoving()) {
            instance.jumpTo({ center: [lng, lat] });
          }
        }
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
    const GL = library.current, instance = map.current;
    if (!GL || !instance || !ready) return;
    holograms.current = displayVehicles.flatMap(v => {
      const model = motion.current.get(v.id);
      return model ? [{ id: v.id, color: routeById.get(v.routeId)?.color ?? '#ff943f', model }] : [];
    });
    instance.triggerRepaint();
    const ids = new Set(displayVehicles.map(v => v.id));
    if (followingRef.current && !ids.has(followingRef.current)) followBus(null);
    markers.current.forEach((marker, id) => { if (!ids.has(id)) { marker.remove(); markers.current.delete(id); } });
    displayVehicles.forEach(v => {
      const route = routeById.get(v.routeId), label = route?.number ?? v.routeId;
      let marker = markers.current.get(v.id);
      if (!marker) {
        const badge = document.createElement('button');
        badge.className = 'bus-marker';
        badge.addEventListener('click', event => {
          event.stopPropagation();
          followBus(v.id);
        });
        const model = motion.current.get(v.id);
        const [lat, lng] = model ? positionAt(model, Date.now() / 1000) : [v.lat, v.lng];
        marker = new GL.Marker({ element: badge, anchor: 'bottom', offset: [0, -36] }).setLngLat([lng, lat]).addTo(instance);
        markers.current.set(v.id, marker);
      }
      const badge = marker.getElement(); badge.textContent = label;
      badge.style.setProperty('--bus-color', route?.color ?? '#ff943f');
      badge.setAttribute('aria-label', `Follow route ${label}, bus ${v.id}`);
      badge.setAttribute('aria-pressed', String(following === v.id));
      badge.title = `Click to follow bus ${v.id}`;
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${label} · ${route?.name ?? 'CDTA'}`;
      const detail = document.createElement('p');
      detail.textContent = `Bus ${v.id} · ${motion.current.get(v.id)?.path ? 'Predicted position' : 'GPS position'} · GPS ${Math.max(0, Math.floor(now - v.timestamp))}s ago`;
      popup.appendChild(title); popup.appendChild(detail);
      if (marker.getPopup()) marker.getPopup()!.setDOMContent(popup);
      else marker.setPopup(new GL.Popup({ offset: 30, closeButton: true }).setDOMContent(popup));
    });
  }, [feed, selected, now, ready, error, stale, paths, following]);

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') followBus(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function fitBuses() {
    followBus(null);
    const GL = library.current, instance = map.current;
    if (!GL || !instance) return;
    if (displayVehicles.length) {
      const bounds = new GL.LngLatBounds();
      displayVehicles.forEach(v => bounds.extend(markers.current.get(v.id)?.getLngLat() ?? [v.lng, v.lat]));
      instance.fitBounds(bounds, { padding: window.innerWidth < 640 ? { top: 230, bottom: 100, left: 50, right: 50 } : { top: 100, bottom: 100, left: 350, right: 100 }, maxZoom: 16, pitch: flat ? 0 : 60, duration: 1000 });
    } else instance.flyTo({ center: [-73.765, 42.657], zoom: 15.2, pitch: 60, bearing: -25 });
  }
  const status = error ? 'Connection interrupted' : stale ? 'Feed is out of date' : feed ? 'Live telemetry' : 'Connecting to CDTA';
  const count = (id: string) => displayVehicles.filter(v => v.routeId === id).length;
  return <main>
    <aside className={`panel ${open ? 'expanded' : ''}`}>
      <header className="brand"><span className="brand-icon"><BusFront size={24}/></span><div><h1>CDTA-<span>HoloMap</span></h1><p>CAPITAL REGION / LIVE TRANSIT</p></div></header>
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
      <div className="gesture-hint">Two-finger swipe to pan · Pinch to zoom · Native twist: Safari</div>
      <div className="holo-overlay" aria-hidden="true"/>
      <div className="map-title"><span>CDTA NETWORK</span><strong>ALBANY<span> / NY</span></strong><small>{flat ? 'PLAN VIEW' : 'HOLOGRAPHIC VIEW'} <i/> REAL-TIME VEHICLES</small></div>
      <div className="camera-readout" aria-hidden="true">{camera.lat.toFixed(4)}° N · {Math.abs(camera.lng).toFixed(4)}° W <span>HDG {((camera.bearing + 360) % 360).toFixed(0).padStart(3, '0')}°</span></div>
      <button className="view-button" onClick={() => map.current?.easeTo({ pitch: flat ? 60 : 0, bearing: flat ? -25 : 0, duration: 800 })} aria-label={flat ? 'Switch to 3D view' : 'Switch to top-down view'}>{flat ? '3D' : '2D'}<span>{flat ? 'TILT MAP' : 'TOP DOWN'}</span></button>
      <div className="map-status" role="status"><span className={`signal ${feed && !error && !stale ? 'connected' : ''}`}><Radio size={18}/></span><div><strong>{status}</strong><span>{feed && !error && !stale ? `${displayVehicles.length} buses on selected lines · updated ${Math.max(0, Math.floor(now - feed.timestamp))}s ago` : 'Updates automatically every 15 seconds'}</span></div></div>
      {following && <div className="follow-status" role="status"><LocateFixed size={16}/><span>Following bus {following}<small>Drag map or press Esc to release</small></span><button onClick={() => followBus(null)} aria-label="Stop following bus"><X size={18}/></button></div>}
      <button className="fit-button" onClick={fitBuses} aria-label="Fit selected buses on map" title="Fit selected buses"><LocateFixed size={21}/></button>
      {(error || stale || !selected.length || (feed && !displayVehicles.length)) && <div className="map-message" role="status">{error || (stale ? 'CDTA’s latest report is more than 2 minutes old. Waiting for fresh locations.' : !selected.length ? 'Select a bus line to start tracking.' : 'No recent bus locations for these lines. Service may not be running.')}</div>}
      {mapError && <div className="tile-error" role="alert">{mapError}</div>}
      <div className="map-note"><span className="legend-ring"/> Stops <span className="note-divider">/</span> {Object.keys(paths).length ? 'Predicted between GPS updates · Slows to rest if updates stop' : pathError ? 'GPS positions only · Route geometry unavailable' : 'GPS positions · Loading route geometry…'}</div>
    </section>
  </main>;
}
