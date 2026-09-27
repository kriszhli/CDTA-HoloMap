// Browsers expose trackpad swipes as wheel events. Pinch remains native zoom.
export function enableTrackpadRotation(map) {
  const canvas = map.getCanvas();
  function rotate(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (!event.shiftKey && !horizontal) return;
    const delta = horizontal ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientWidth : 1);
    // Change bearing only: preserve 2D/3D pitch, zoom, and the follow-camera anchor.
    map.setBearing(map.getBearing() + Math.max(-45, Math.min(45, pixels * .2)));
  }
  canvas.addEventListener('wheel', rotate, { capture: true, passive: false });
  return () => canvas.removeEventListener('wheel', rotate, { capture: true });
}
