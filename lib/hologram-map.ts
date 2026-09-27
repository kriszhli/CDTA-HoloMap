import * as maplibregl from 'maplibre-gl';
import type { CustomLayerInterface, StyleSpecification } from 'maplibre-gl';
import * as THREE from 'three';
// Pin these two public worker modules to the installed MapLibre version.
// Serving them intact avoids framework dev overlays being injected into a worker.
export const workerUrl = '/vendor/maplibre/maplibre-gl-worker.mjs';
import { poseAt, updateMotion } from './motion.mjs';
import { MAX_AGE } from './vehicles.mjs';

export const mapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { city: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  light: { anchor: 'viewport', color: '#a8f5ff', intensity: .5 },
  layers: [
    { id: 'ground', type: 'background', paint: { 'background-color': '#091217' } },
    { id: 'parks', type: 'fill', source: 'city', 'source-layer': 'landcover', paint: { 'fill-color': '#14282b', 'fill-opacity': .35 } },
    { id: 'water', type: 'fill', source: 'city', 'source-layer': 'water', paint: { 'fill-color': '#040c12' } },
    { id: 'water-edge', type: 'line', source: 'city', 'source-layer': 'water', paint: { 'line-color': '#467078', 'line-opacity': .5, 'line-width': 1 } },
    { id: 'road-glow', type: 'line', source: 'city', 'source-layer': 'transportation', paint: { 'line-color': '#81adb3', 'line-opacity': .08, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 17, 12], 'line-blur': 3 } },
    { id: 'roads', type: 'line', source: 'city', 'source-layer': 'transportation', paint: { 'line-color': '#87a7ac', 'line-opacity': .48, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .4, 16, 1.4, 19, 3] } },
    { id: 'building-footprints', type: 'line', source: 'city', 'source-layer': 'building', minzoom: 13, paint: { 'line-color': '#a3e5eb', 'line-opacity': .35, 'line-width': .65 } },
    { id: 'holographic-buildings', type: 'fill-extrusion', source: 'city', 'source-layer': 'building', minzoom: 13, paint: { 'fill-extrusion-color': '#80b7be', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': .24 } },
    { id: 'street-labels', type: 'symbol', source: 'city', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'symbol-spacing': 350 }, paint: { 'text-color': '#a6c2c7', 'text-halo-color': '#091217', 'text-halo-width': 2 } },
    { id: 'place-labels', type: 'symbol', source: 'city', 'source-layer': 'place', maxzoom: 15, layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 14, 'text-letter-spacing': .15, 'text-transform': 'uppercase' }, paint: { 'text-color': '#b5c8cd', 'text-halo-color': '#091217', 'text-halo-width': 2 } },
  ],
};

type Motion = ReturnType<typeof updateMotion>;
export type HoloVehicle = { id: string; color: string; model: Motion };

// Metre-sized geometry, enlarged at network zooms so each bus remains legible.
export function createBusLayer(getVehicles: () => HoloVehicle[]): CustomLayerInterface {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const origin = maplibregl.MercatorCoordinate.fromLngLat([-73.76, 42.66]);
  const metre = origin.meterInMercatorCoordinateUnits();
  const world = new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0).scale(new THREE.Vector3(metre, -metre, metre));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(box);
  const wheel = new THREE.CylinderGeometry(.48, .48, .22, 12);
  const ring = new THREE.RingGeometry(7.5, 7.65, 48);
  const buses = new Map<string, { group: THREE.Group; color: string; materials: THREE.Material[] }>();
  let renderer: THREE.WebGLRenderer;
  let map: maplibregl.Map;

  function removeBus(id: string) {
    const bus = buses.get(id)!;
    scene.remove(bus.group); bus.materials.forEach(m => m.dispose()); buses.delete(id);
  }
  function addBus(id: string, color: string) {
    const group = new THREE.Group();
    const shell = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .26, depthWrite: false, side: THREE.DoubleSide });
    const wire = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95 });
    const glass = new THREE.MeshBasicMaterial({ color: '#d9fcff', transparent: true, opacity: .48, depthWrite: false });
    const dark = new THREE.MeshBasicMaterial({ color: '#162c31' });
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide });
    function block(w: number, l: number, h: number, x: number, y: number, z: number, material = shell, outline = true) {
      const mesh = new THREE.Mesh(box, material); mesh.scale.set(w, l, h); mesh.position.set(x, y, z); group.add(mesh);
      if (outline) { const lines = new THREE.LineSegments(edges, wire); lines.scale.copy(mesh.scale); lines.position.copy(mesh.position); group.add(lines); }
    }
    block(3.2, 12, 3.3, 0, 0, 2.5);
    block(2.5, 5, .45, 0, -1, 4.4); // rooftop equipment
    block(2.65, .06, 1.25, 0, 6.04, 3.1, glass, false); // windshield; front is north
    for (const x of [-1.63, 1.63]) {
      for (let y = -4.6; y < 4.5; y += 2.1) block(.035, 1.65, 1.1, x, y, 3.1, glass, false);
      for (const y of [-3.7, 3.8]) { const mesh = new THREE.Mesh(wheel, dark); mesh.rotation.z = Math.PI / 2; mesh.position.set(x, y, .8); group.add(mesh); }
    }
    for (const x of [-1, 1]) block(.45, .12, .25, x, 6.1, 1.4, glass, false);
    const halo = new THREE.Mesh(ring, glow); halo.position.z = .1; group.add(halo);
    scene.add(group); buses.set(id, { group, color, materials: [shell, wire, glass, dark, glow] });
    return group;
  }
  return {
    id: 'bus-holograms', type: 'custom', renderingMode: '3d',
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      const now = Date.now() / 1000;
      const vehicles = getVehicles().filter(v => now - v.model.report.timestamp <= MAX_AGE && v.model.report.timestamp <= now + 30);
      const ids = new Set(vehicles.map(v => v.id));
      for (const id of buses.keys()) if (!ids.has(id)) removeBus(id);
      const scale = Math.max(1.5, Math.min(64, 2 ** (17.8 - map.getZoom())));
      for (const v of vehicles) {
        if (buses.has(v.id) && buses.get(v.id)!.color !== v.color) removeBus(v.id);
        const group = buses.get(v.id)?.group ?? addBus(v.id, v.color);
        const { lat, lng, bearing } = poseAt(v.model, now);
        const coordinate = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
        group.position.set((coordinate.x - origin.x) / metre, -(coordinate.y - origin.y) / metre, 1);
        group.scale.setScalar(scale); group.rotation.z = -bearing;
      }
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(world);
      renderer.resetState(); renderer.render(scene, camera);
      if (vehicles.length && !document.hidden) map.triggerRepaint();
    },
    onRemove() {
      for (const id of buses.keys()) removeBus(id);
      box.dispose(); edges.dispose(); wheel.dispose(); ring.dispose(); renderer?.dispose();
    },
  };
}
