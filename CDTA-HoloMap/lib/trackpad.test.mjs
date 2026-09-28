import assert from 'node:assert/strict';
import { enableTrackpadRotation } from './trackpad.mjs';
const canvas = new EventTarget(); canvas.clientHeight = 600;
const view = new EventTarget(); canvas.ownerDocument = { defaultView: view };
let bearing = 25, zoom = 15, pitch = 0, following = true;
const pans = [];
const map = { getCanvas: () => canvas, getBearing: () => bearing, getZoom: () => zoom, getPitch: () => pitch, getMinPitch: () => 0, getMaxPitch: () => 75,
  stop() {}, panBy: offset => pans.push(offset),
  jumpTo: options => { bearing = options.bearing; if (options.zoom !== undefined) zoom = options.zoom; if (options.pitch !== undefined) pitch = options.pitch; } };
const cleanup = enableTrackpadRotation(map, () => { following = false; });
function send(name, values = {}, target = canvas) {
  const event = new Event(name, { cancelable: true });
  Object.assign(event, { deltaX: 0, deltaY: 0, deltaMode: 0, ...values });
  target.dispatchEvent(event); return event.defaultPrevented;
}
assert.ok(send('wheel', { deltaX: 40, deltaY: 60 }));
assert.deepEqual(pans, [[40, 60]]); assert.equal(following, false);
assert.equal(zoom, 15); assert.equal(bearing, 25);
assert.equal(send('wheel', { deltaY: 30, ctrlKey: true }), false, 'Chromium pinch goes to native map zoom');
for (pitch of [0, 60]) {
  following = true;
  const before = { bearing, zoom, pitch };
  send('gesturestart'); send('gesturechange', { rotation: 30, scale: 2 });
  assert.equal(bearing, before.bearing - 30); assert.equal(zoom, before.zoom + 1);
  assert.equal(pitch, before.pitch); assert.ok(following);
  send('gesturechange', { rotation: 40, scale: 1 });
  assert.equal(bearing, before.bearing - 40, 'Rotation is relative to gesture start, not accumulated');
  assert.equal(zoom, before.zoom);
  assert.ok(send('wheel', { deltaY: -10, ctrlKey: true }), 'Suppress duplicate pinch');
  send('gesturechange', { rotation: NaN, scale: 0 }); assert.equal(zoom, before.zoom);
  send('gestureend');
}
for (const values of [{deltaY: 50}, {deltaX: 50}, {deltaY: 50, ctrlKey: true}]) {
  following = true;
  const before = { bearing, zoom, pans: pans.length };
  assert.ok(send('wheel', { ...values, shiftKey: true }));
  assert.equal(bearing, before.bearing, 'Shift wheel no longer rotates');
  assert.equal(zoom, before.zoom, 'Shift never zooms, including trackpad pinch wheel events');
  assert.equal(pans.length, before.pans); assert.ok(following);
}
const previousZoom = zoom;
send('gesturestart');
send('gesturechange', {rotation: 20, scale: 2, shiftKey: true});
assert.equal(zoom, previousZoom, 'Shift blocks native gesture zoom');
send('gesturechange', {rotation: 20, scale: 2});
assert.equal(zoom, previousZoom, 'Releasing Shift does not jump to the suppressed zoom');
send('gestureend');
assert.equal(send('wheel', { deltaY: 5, ctrlKey: true }), false);
const dragStart = {bearing, zoom};
pitch = 0; following = true;
assert.ok(send('mousedown', {shiftKey: true, button: 0, clientX: 100, clientY: 100}));
send('mousemove', {clientX: 150, clientY: 60}, view);
assert.equal(bearing, dragStart.bearing + 40); assert.equal(pitch, 20);
assert.equal(zoom, dragStart.zoom); assert.equal(following, false, 'Shift drag releases following');
send('mousemove', {clientX: 150, clientY: -500}, view); assert.equal(pitch, 75);
send('mouseup', {}, view); assert.ok(send('click'), 'Rotation drag must not select a bus');
const finishedBearing = bearing;
send('mousemove', {clientX: 600, clientY: 600}, view); assert.equal(bearing, finishedBearing);
for (const button of [0, 2]) {
  following = true;
  assert.equal(send('mousedown', {button, clientX: 100, clientY: 100}), false, 'Normal drag remains native');
  send('mousemove', {clientX: 101, clientY: 101}, view);
  assert.ok(following, 'A click or tiny jitter must not cancel following');
  assert.equal(send('mousemove', {clientX: 120, clientY: 110}, view), false);
  assert.equal(following, false, 'Dragging releases follow before native pan or rotation');
  send('mouseup', {}, view);
  assert.ok(send('click'), 'Drag release must not reselect a bus');
}
cleanup(); assert.equal(send('wheel', { deltaX: 50 }), false);
assert.equal(send('gesturestart'), false);
console.log('Native gesture checks passed: twist, pinch, pan, follow, both pitches, no duplicate zoom, cleanup.');
