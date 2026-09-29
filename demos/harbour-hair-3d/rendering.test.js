import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { batchStaticMeshes, pixelRatioFor, renderingQuality } from './rendering.js';

test('compact devices keep a bounded motion budget and a sharper resting image', () => {
  for (const device of [
    { coarsePointer: true, width: 1024, height: 1366, cores: 8 },
    { coarsePointer: false, width: 390, height: 844, cores: 8 },
    { coarsePointer: false, width: 1920, height: 1080, cores: 4 },
  ]) {
    const quality = renderingQuality(device);
    assert.equal(quality.fps, 30);
    const motion = pixelRatioFor(device.width, device.height, 3, quality, true);
    const detail = pixelRatioFor(device.width, device.height, 3, quality);
    assert.ok(device.width * device.height * motion * motion <= 1800001);
    assert.ok(device.width * device.height * detail * detail <= 3000001);
    assert.ok(motion <= 1.5);
    assert.ok(detail > motion);
    assert.ok(detail <= 2);
  }
});

test('Retina phones get a sharp resting frame without rendering at native 3x during motion', () => {
  const quality = renderingQuality({ coarsePointer: true, width: 390, height: 844 });
  assert.equal(pixelRatioFor(390, 844, 3, quality), 2);
  assert.equal(pixelRatioFor(390, 844, 3, quality, true), 1.5);
});

test('large iPads stay above CSS resolution in both orientations', () => {
  const quality = renderingQuality({ coarsePointer: true, width: 1024, height: 1366 });
  for (const [width, height] of [[1024, 1366], [1366, 1024]]) {
    assert.ok(pixelRatioFor(width, height, 2, quality, true) > 1);
    assert.ok(pixelRatioFor(width, height, 2, quality) > 1.4);
  }
});

test('low-core devices retain the original motion workload', () => {
  const quality = renderingQuality({ coarsePointer: true, width: 820, height: 1180, cores: 4 });
  const ratio = pixelRatioFor(820, 1180, 2, quality, true);
  assert.ok(820 * 1180 * ratio * ratio <= 1000001);
  assert.ok(ratio <= 1.15);
});

test('low-density displays are never supersampled and hidden canvases stay finite', () => {
  const quality = renderingQuality({ coarsePointer: true, width: 390, height: 844 });
  for (const moving of [true, false]) {
    assert.equal(pixelRatioFor(390, 844, 1, quality, moving), 1);
    assert.ok(Number.isFinite(pixelRatioFor(0, 0, 3, quality, moving)));
  }
});

test('large desktop canvases also have a finite pixel budget', () => {
  const quality = renderingQuality({ coarsePointer: false, width: 3840, height: 2160, cores: 8 });
  assert.equal(quality.fps, 60);
  const ratio = pixelRatioFor(3840, 2160, 2, quality);
  assert.ok(3840 * 2160 * ratio * ratio <= 2200001);
  assert.equal(pixelRatioFor(3840, 2160, 2, quality, true), ratio);
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
