import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFlightDuration, move3DCamera } from '../lib/map3dMotion.js';

const start = { center: { lat: 35.6586, lng: 139.7454 }, range: 4000, heading: 0, tilt: 60 };
const nearby = { ...start, center: { lat: 35.6812, lng: 139.7671 }, range: 2200 };
class FakeMap extends EventTarget {
  constructor() { super(); Object.assign(this, start); this.flights = []; this.stopped = 0; }
  flyCameraTo(options) { this.flights.push(options); }
  stopCameraAnimation() { this.stopped++; }
  arrive(target) { Object.assign(this, target); this.dispatchEvent(new Event('gmp-animationend')); }
}

test('nearby moves animate, while long jumps and reduced motion are instant', () => {
  assert.ok(cameraFlightDuration(start, nearby) >= 900);
  assert.ok(cameraFlightDuration(start, nearby) <= 1400);
  assert.equal(cameraFlightDuration(start, nearby, true), 0);
  assert.equal(cameraFlightDuration(start, { ...nearby, center: { lat: 40.7, lng: -74 } }), 0);
  assert.equal(cameraFlightDuration(start, { ...nearby, range: 1000000 }), 0);
  assert.equal(cameraFlightDuration(start, start), 0);
});

test('the selected card waits for arrival and ignores an unrelated animation end', () => {
  const map = new FakeMap();
  let opened = 0;
  const cancel = move3DCamera(map, nearby, { onComplete: () => opened++ });
  assert.equal(opened, 0);
  map.dispatchEvent(new Event('gmp-animationend'));
  assert.equal(opened, 0);
  map.arrive(nearby);
  assert.equal(opened, 1);
  map.dispatchEvent(new Event('gmp-animationend'));
  assert.equal(opened, 1);
  cancel();
});

test('rapidly choosing a new stop cannot reopen the previous card', () => {
  const map = new FakeMap();
  const opened = [];
  const cancel = move3DCamera(map, nearby, { onComplete: () => opened.push('old') });
  cancel();
  const newer = { ...nearby, center: { lat: 35.69, lng: 139.76 } };
  const cancelNew = move3DCamera(map, newer, { onComplete: () => opened.push('new') });
  map.arrive(nearby);
  assert.deepEqual(opened, []);
  map.arrive(newer);
  assert.deepEqual(opened, ['new']);
  assert.equal(map.stopped, 1);
  cancelNew();
});

test('unmounting cancels pending arrival callbacks', () => {
  const map = new FakeMap();
  let opened = false;
  const cancel = move3DCamera(map, nearby, { onComplete: () => { opened = true; } });
  cancel();
  map.arrive(nearby);
  assert.equal(opened, false);
});

test('an unavailable animation snaps to the target and still opens the card', async () => {
  const map = new FakeMap();
  map.flyCameraTo = () => Promise.reject(new Error('Unavailable'));
  let opened = false;
  move3DCamera(map, nearby, { onComplete: () => { opened = true; } });
  await Promise.resolve();
  assert.equal(opened, true);
  assert.deepEqual(map.center, nearby.center);
});
