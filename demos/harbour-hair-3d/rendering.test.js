import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { batchStaticMeshes, pixelRatioFor, renderingQuality } from './rendering.js';

test('touch devices and small or low-core displays use the bounded 30fps tier', () => {
  for (const device of [
    { coarsePointer: true, width: 1024, height: 1366, cores: 8 },
    { coarsePointer: false, width: 390, height: 844, cores: 8 },
    { coarsePointer: false, width: 1920, height: 1080, cores: 4 },
  ]) {
    const quality = renderingQuality(device);
    assert.equal(quality.fps, 30);
    const ratio = pixelRatioFor(device.width, device.height, 3, quality);
    assert.ok(device.width * device.height * ratio * ratio <= 1000001);
    assert.ok(ratio <= 1.15);
  }
});

test('large desktop canvases also have a finite pixel budget', () => {
  const quality = renderingQuality({ coarsePointer: false, width: 3840, height: 2160, cores: 8 });
  assert.equal(quality.fps, 60);
  const ratio = pixelRatioFor(3840, 2160, 2, quality);
  assert.ok(3840 * 2160 * ratio * ratio <= 2200001);
});

test('batching preserves world positions and independent wall visibility', () => {
  const root = new Group(), wall = new Group(), furniture = new Group();
  root.add(wall, furniture); wall.position.x = 4; furniture.position.z = 3;
  const material = new MeshBasicMaterial(), glass = new MeshBasicMaterial({ transparent: true });
  for (const parent of [wall, furniture]) for (const x of [0, 2]) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material); mesh.position.x = x; parent.add(mesh);
  }
  const pane = new Mesh(new BoxGeometry(), glass); wall.add(pane);
  const ceiling = new Mesh(new BoxGeometry(), material); root.add(ceiling);
  assert.equal(batchStaticMeshes(root, [wall], [ceiling]), 2);
  assert.equal(pane.parent, wall); assert.equal(ceiling.parent, root);
  const wallBatch = wall.children.find((mesh) => mesh !== pane);
  wallBatch.geometry.computeBoundingBox();
  assert.deepEqual(wallBatch.geometry.boundingBox.min.toArray(), [-.5, -.5, -.5]);
  assert.deepEqual(wallBatch.geometry.boundingBox.max.toArray(), [2.5, .5, .5]);
  root.updateMatrixWorld(true);
  assert.deepEqual(wallBatch.getWorldPosition(new Vector3()).toArray(), [4, 0, 0]);
  wall.visible = false;
  assert.equal(wallBatch.parent.visible, false);
  assert.equal(ceiling.visible, true);
});
