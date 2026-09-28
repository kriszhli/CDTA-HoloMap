// Native rotation is exposed by WebKit's GestureEvent, not ordinary wheel events.
export function enableTrackpadRotation(map, onPan = () => {}) {
  const canvas = map.getCanvas();
  let gesture = null;
  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function wheel(event) {
    if (gesture) { consume(event); return; } // Avoid duplicate pinch zoom from wheel + gesture.
    if (event.shiftKey) {
      consume(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      map.jumpTo({ bearing: map.getBearing() + delta * unit * .2 });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return; // Chromium pinch is ctrl+wheel.
    if (!event.deltaX && !event.deltaY) return;
    consume(event);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    onPan();
    map.panBy([event.deltaX * unit, event.deltaY * unit], { duration: 0 });
  }
  function start(event) {
    consume(event);
    map.stop();
    gesture = { rotation: 0, scale: 1 };
  }
  function change(event) {
    if (!gesture) return;
    consume(event);
    if (!Number.isFinite(event.rotation) || !Number.isFinite(event.scale) || event.scale <= 0) return;
    // Finger rotation is clockwise; map bearing rotates the camera in the opposite direction.
    map.jumpTo({ bearing: map.getBearing() - (event.rotation - gesture.rotation),
      ...(event.shiftKey ? {} : { zoom: map.getZoom() + Math.log2(event.scale / gesture.scale) }) });
    gesture = { rotation: event.rotation, scale: event.scale };
  }
  function end(event) { if (gesture) consume(event); gesture = null; }
  const listeners = { wheel, gesturestart: start, gesturechange: change, gestureend: end };
  for (const [name, handler] of Object.entries(listeners)) canvas.addEventListener(name, handler, { capture: true, passive: false });
  return () => {
    for (const [name, handler] of Object.entries(listeners)) canvas.removeEventListener(name, handler, { capture: true });
    gesture = null;
  };
}
