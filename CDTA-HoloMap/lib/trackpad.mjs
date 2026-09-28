// Native rotation is exposed by WebKit's GestureEvent, not ordinary wheel events.
export function enableTrackpadRotation(map, onPan = () => {}) {
  const canvas = map.getCanvas();
  let gesture = null;
  let drag = null, dragged = false;
  const view = canvas.ownerDocument.defaultView;
  function down(event) {
    dragged = false;
    if (!event.shiftKey || event.button !== 0) return;
    consume(event);
    map.stop();
    drag = { x: event.clientX, y: event.clientY, bearing: map.getBearing(), pitch: map.getPitch() };
  }
  function move(event) {
    if (!drag) return;
    consume(event);
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 3) return;
    dragged = true;
    map.jumpTo({ bearing: drag.bearing + dx * .8,
      pitch: Math.max(map.getMinPitch(), Math.min(map.getMaxPitch(), drag.pitch - dy * .5)) });
  }
  function up(event) { if (drag) consume(event); drag = null; }
  function cancel() { drag = null; dragged = false; }
  function click(event) { if (dragged) { consume(event); dragged = false; } }
  canvas.addEventListener('mousedown', down, true);
  canvas.addEventListener('click', click, true);
  view.addEventListener('mousemove', move, true);
  view.addEventListener('mouseup', up, true);
  view.addEventListener('blur', cancel);

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function wheel(event) {
    if (gesture) { consume(event); return; } // Avoid duplicate pinch zoom from wheel + gesture.
    if (event.shiftKey) {
      consume(event);
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
    canvas.removeEventListener('mousedown', down, { capture: true });
    canvas.removeEventListener('click', click, { capture: true });
    view.removeEventListener('mousemove', move, { capture: true });
    view.removeEventListener('mouseup', up, { capture: true });
    view.removeEventListener('blur', cancel);
    cancel();
    gesture = null;
  };
}
