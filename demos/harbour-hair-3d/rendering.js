import { Matrix4, Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function renderingQuality({ coarsePointer, width, height, cores = 8 }) {
  const compact = coarsePointer || Math.min(width, height) < 700 || cores <= 4;
  return { compact, fps: compact ? 30 : 60, maxDpr: compact ? 1.15 : 1.5, maxPixels: compact ? 1000000 : 2200000 };
}

export function pixelRatioFor(width, height, deviceRatio, quality) {
  return Math.min(deviceRatio, quality.maxDpr, Math.sqrt(quality.maxPixels / Math.max(1, width * height)));
}

// Furniture is static. Merge opaque parts by material while preserving every
// independently hidden cutaway wall/ceiling and all transparent render ordering.
export function batchStaticMeshes(root, visibilityRoots, excluded = []) {
  root.updateMatrixWorld(true);
  const boundaries = new Set([root, ...visibilityRoots]);
  const skip = new Set(excluded);
  const batches = new Map();
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isReflector || skip.has(mesh) || Array.isArray(mesh.material) || mesh.material.transparent) return;
    let boundary = mesh.parent;
    while (!boundaries.has(boundary)) boundary = boundary.parent;
    const attributes = Object.keys(mesh.geometry.attributes).sort().join(',');
    const key = `${boundary.id}:${mesh.material.id}:${mesh.castShadow}:${mesh.receiveShadow}:${attributes}`;
    if (!batches.has(key)) batches.set(key, { boundary, meshes: [] });
    batches.get(key).meshes.push(mesh);
  });
  let removed = 0;
  for (const { boundary, meshes } of batches.values()) {
    if (meshes.length < 2) continue;
    const inverse = new Matrix4().copy(boundary.matrixWorld).invert();
    const geometries = meshes.map((mesh) => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((item) => item.dispose());
    if (!geometry) continue;
    const merged = new Mesh(geometry, meshes[0].material);
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    geometry.computeBoundingSphere();
    boundary.add(merged);
    meshes.forEach((mesh) => mesh.removeFromParent());
    removed += meshes.length - 1;
  }
  return removed;
}
