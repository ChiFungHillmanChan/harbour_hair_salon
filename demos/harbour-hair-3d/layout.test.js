import test from 'node:test';
import assert from 'node:assert/strict';
import { canWalkAt, floorHeightAt } from './layout.js';

function assertWalkableRoute(route) {
  for (let i = 1; i < route.length; i++) {
    const [startX, startZ] = route[i - 1];
    const [endX, endZ] = route[i];
    const samples = Math.ceil(Math.hypot(endX - startX, endZ - startZ) / 0.025);
    for (let step = 0; step <= samples; step++) {
      const t = step / samples;
      const x = startX + (endX - startX) * t;
      const z = startZ + (endZ - startZ) * t;
      assert.equal(canWalkAt(x, z), true, `unobstructed route at (${x}, ${z})`);
    }
  }
}

test('the compact right staircase has two risers and no phantom service-zone tread', () => {
  for (const [x, z, height] of [
    [2, 8.65, 0], [2, 1.160001, 0], [2, 1.16, 0.18], [2, 1.159999, 0.18],
    [2, 0.800001, 0.18], [2, 0.8, 0.36], [2, 0.799999, 0.36],
    [1.55, 1, 0.18], [1.549999, 1, 0], [0, 1, 0], [0, 0.8, 0.36], [-2, -5, 0.36],
  ]) assert.equal(floorHeightAt(x, z), height, `floor height at (${x}, ${z})`);
});

test('the compact entrance connects around the divider to the steps and rear styling aisle', () => {
  assertWalkableRoute([[1.78, 9], [1.78, 4.5], [2, 4.5], [2, 0.45], [0.3, 0.45], [0.3, -4.6]]);
});

test('staff can pass between the WC and reception into the standing strip', () => {
  assertWalkableRoute([[1.78, 8.05], [-2.23, 8.05], [-2.23, 9.07]]);
});

test('the main aisle and reception visitor area remain open after reducing the room', () => {
  for (const x of [1.75, 1.78]) {
    for (const z of [1.3, 2.45, 3.75, 5.05, 5.75, 6.7, 7.56]) {
      assert.equal(canWalkAt(x, z), true, `main aisle at (${x}, ${z})`);
    }
  }
  for (const x of [-0.7, 0, 1, 1.8]) {
    for (const z of [8, 8.65, 9.3]) assert.equal(canWalkAt(x, z), true, `reception at (${x}, ${z})`);
  }
});

test('the compact desk is solid while staff can stand behind it', () => {
  assert.equal(canWalkAt(-1.94, 9.07), false, 'back of the desk');
  assert.equal(canWalkAt(-1.06, 9.07), false, 'customer-facing edge');
  assert.equal(canWalkAt(-2.23, 9.07), true, 'staff standing strip');
});

test('the glass return keeps visitors out of the front-right cutout', () => {
  for (const [x, z] of [[2.3, 6.2], [2.2, 9], [1.96, 8.65], [2.1, 5.6], [2.1, 5.59]]) {
    assert.equal(canWalkAt(x, z), false, `outside reception profile at (${x}, ${z})`);
  }
  assert.equal(canWalkAt(1.94, 8.65), true, 'inside the recessed entrance');
  assert.equal(canWalkAt(2.1, 5.57), true, 'clear of the glass corner');
});

test('zone viewpoints land on clear floor at the correct eye height', () => {
  for (const [zone, x, z, eyeY] of [
    ['welcome', 1.78, 9, 1.62], ['wash', 2.05, 3.75, 1.62],
    ['colour', 0.3, -1.1, 1.98], ['styling', 0.25, -2.8, 1.98],
  ]) {
    assert.equal(canWalkAt(x, z), true, `${zone} viewpoint`);
    assert.ok(Math.abs(1.62 + floorHeightAt(x, z) - eyeY) < 1e-10, `${zone} eye height`);
  }
});

test('three human-scale wash recliners remain solid and leave working space behind the bowls', () => {
  for (const z of [5.05, 3.75, 2.45]) {
    for (const [x, dz] of [[-2.03, 0], [-1.3, 0], [-0.45, 0], [0.63, 0], [-0.45, 0.47], [-0.45, -0.47]]) {
      assert.equal(canWalkAt(x, z + dz), false, `recliner at (${x}, ${z + dz})`);
    }
    assert.equal(canWalkAt(0.81, z), false, 'bowl-side visitor clearance');
    assert.equal(canWalkAt(0.83, z), true, 'working area behind the bowls');
    assert.equal(canWalkAt(-2.21, z), false, 'foot-end visitor clearance');
    assert.equal(canWalkAt(-2.28, z), true, 'standing gap beside the wall');
  }
});

test('the colour-side gap still reaches the wall-side wash passage', () => {
  assertWalkableRoute([[2, 1.785], [-2.28, 1.785], [-2.28, 5.05]]);
});

test('all eight styling chairs and compact rear equipment have solid footprints', () => {
  for (const x of [-1.1, 1.1]) {
    for (const z of [-5, -3.55, -2.1, -0.65]) assert.equal(canWalkAt(x, z), false, `styling chair at (${x}, ${z})`);
  }
  for (const [name, x, z] of [
    ['left counter', -2.1, -2.5], ['right counter', 2.1, -2.5],
    ['rear trolley', -1.55, -4.275], ['front trolley', -1.55, -1.375],
    ['left perm machine', -0.55, -5.45], ['right perm machine', 0.55, -5.45],
  ]) assert.equal(canWalkAt(x, z), false, `${name} footprint`);
  assert.equal(canWalkAt(1.83, -3.55), false, 'rotated chair footrest is included');
  assert.equal(canWalkAt(0.3, -3.55), true, 'central aisle beside chairs stays open');
});

test('the shorter colour bar leaves the right steps and raised landing clear', () => {
  for (const x of [-2.3, -1, 0, 1.5]) assert.equal(canWalkAt(x, 1.3), false, `colour bar at x=${x}`);
  assert.equal(canWalkAt(1.69, 1.3), false, 'counter end clearance');
  assert.equal(canWalkAt(1.71, 1.3), true, 'right staircase opening');
  assert.equal(canWalkAt(0, 0.9), false, 'back of the counter is solid');
  assert.equal(canWalkAt(0, 0.79), true, 'raised landing behind the bar');
});

test('the framed divider and long end return are solid without closing the aisle', () => {
  assert.equal(canWalkAt(-2.3, 5.75), false, 'left divider fins');
  assert.equal(canWalkAt(1.4, 5.9), false, 'main frame clearance');
  assert.equal(canWalkAt(1.67, 5.75), true, 'path around the divider');
  assert.equal(canWalkAt(1.6, 4.95), false, 'long return reaches beside the first basin');
  assert.equal(canWalkAt(1.67, 4.95), true, 'aisle outside the return');
});

test('the recessed WC is screened from reception while its side approach stays open', () => {
  assert.equal(canWalkAt(-1.7, 6.7), false, 'enclosed WC');
  assert.equal(canWalkAt(-1.14, 6.85), false, 'recessed WC door clearance');
  assert.equal(canWalkAt(-1.12, 6.85), true, 'approach to recessed door');
  assert.equal(canWalkAt(-0.75, 7.7), false, 'long white wall facing reception');
  assert.equal(canWalkAt(-0.35, 7.1), true, 'the projecting return has been removed');
  assert.equal(canWalkAt(-0.6, 7.05), true, 'standing space behind the flat white wall');
  assertWalkableRoute([[1.78, 6.7], [-0.75, 6.7], [-0.95, 6.85]]);
});

test('the sink beside the WC leaves a shared aisle-facing approach clear', () => {
  assert.equal(canWalkAt(-1.58, 6.06), false, 'recessed sink cabinet');
  assert.equal(canWalkAt(-1.14, 6.06), false, 'clearance at the aisle-facing sink front');
  assert.equal(canWalkAt(-1.12, 6.06), true, 'approach outside the sink front');
  assert.equal(canWalkAt(-0.75, 6.15), true, 'former projecting sink footprint is clear');
  assert.equal(canWalkAt(-1.58, 6.5), false, 'wider sink worktop remains solid');
  assertWalkableRoute([[1.78, 6.2], [-0.95, 6.2], [-0.95, 7.2]]);
});

test('the round coat rack blocks its radius while allowing diagonal passage', () => {
  assert.equal(canWalkAt(2.23, 5.05), false, 'centre of the coat rack');
  assert.equal(canWalkAt(1.8, 5.05), false, 'visitor clearance around the circular base');
  assert.equal(canWalkAt(1.78, 5.05), true, 'main route beside the rack');
  assert.equal(canWalkAt(1.92, 4.75), false, 'inside the diagonal circular clearance');
  assert.equal(canWalkAt(1.9, 4.75), true, 'diagonal clearance outside the circle, inside its bounding box');
});

test('visitors stay inside the compact outer walls', () => {
  for (const [x, z] of [[-2.35, 8.65], [2.35, 3.75], [0, -5.79], [0, 9.74], [0, -6.1], [0, 10.05]]) {
    assert.equal(canWalkAt(x, z), false, `outside room at (${x}, ${z})`);
  }
  assert.equal(canWalkAt(2.34, 3.75), true);
  assert.equal(canWalkAt(0, -5.77), true);
  assert.equal(canWalkAt(0, 9.72), true);
});
