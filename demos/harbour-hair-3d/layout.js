// Front is +Z. The entrance is in the right (+X) wall; service furniture is left.
export const LAYOUT = {
  width: 5.1,
  back: -6,
  front: 9.95,
  center: 1.975,
  depth: 15.95,
  stylingOffsetZ: -1.8,
  styling: { z: [-3.2, -1.75, -0.3, 1.15], chairX: 1.1 },
  stylingRise: 0.36,
  stylingEdge: 0.8,
  stepDepth: 0.36,
  stepRise: 0.18,
  aisleMinX: 1.55,
  // The close-up references establish a smaller room and compact furniture.
  // Keep the gentle inset and long glazed entrance side from the entrance photos.
  receptionMaxX: 2.15,
  receptionStartZ: 5.75,
  desk: { x: -1.5, z: 9.07, width: 1.45, depth: 0.9 },
  wash: { x: -0.45, z: [5.05, 3.75, 2.45], footEndX: -2.05, bowlEndX: 0.65 },
  colour: { x: -0.485, z: 1.3, width: 4.03, depth: 0.55 },
  entrance: { x: 2.15, z: 9, width: 1.3 },
  screen: { minX: -2.45, maxX: 1.45, z: 5.75, returnDepth: 0.9 },
  toilet: { minX: -2.45, maxX: -1.3, minZ: 6.7, maxZ: 7.7 },
  privacyWall: { minX: -2.45, maxX: -0.35, z: 7.7 },
  utility: { minX: -1.85, maxX: -1.30, minZ: 5.84, maxZ: 6.64 },
  glazing: { outerX: 2.55, returnZ: 5.75 },
  coat: { x: 2.23, z: 5.05, railRadius: 0.20, radius: 0.27 },
  eyeHeight: 1.62,
};

// On a riser boundary the visitor stands on the higher of its two surfaces.
export function floorHeightAt(x, z) {
  if (z <= LAYOUT.stylingEdge) return LAYOUT.stylingRise;
  if (x >= LAYOUT.aisleMinX && z <= LAYOUT.stylingEdge + LAYOUT.stepDepth) return LAYOUT.stepRise;
  return 0;
}

// Axis-aligned furniture footprints [minX, maxX, minZ, maxZ]. The 90° turns
// swap the reception and wash units' local width and depth. The colour counter
// faces the styling floor, spanning the service zone beside the right steps.
const halfWidth = LAYOUT.width / 2;
const blockers = [
  [-halfWidth, -halfWidth + 0.73, -5.89, 0.13],
  [halfWidth - 0.73, halfWidth, -5.89, 0.13],
  [LAYOUT.desk.x - LAYOUT.desk.depth / 2, LAYOUT.desk.x + LAYOUT.desk.depth / 2, LAYOUT.desk.z - LAYOUT.desk.width / 2, LAYOUT.desk.z + LAYOUT.desk.width / 2],
  ...LAYOUT.wash.z.map(z => [LAYOUT.wash.footEndX, LAYOUT.wash.bowlEndX, z - 0.465, z + 0.465]),
  [LAYOUT.colour.x - LAYOUT.colour.width / 2, LAYOUT.colour.x + LAYOUT.colour.width / 2, LAYOUT.colour.z - (LAYOUT.colour.depth + 0.04) / 2, LAYOUT.colour.z + (LAYOUT.colour.depth + 0.04) / 2],
  [LAYOUT.screen.minX - 0.033, LAYOUT.screen.maxX + 0.033, LAYOUT.screen.z - 0.065, LAYOUT.screen.z + 0.065],
  [LAYOUT.screen.maxX - 0.11, LAYOUT.screen.maxX, LAYOUT.screen.z - LAYOUT.screen.returnDepth - 0.033, LAYOUT.screen.z + 0.065],
  [LAYOUT.toilet.minX, LAYOUT.toilet.maxX, LAYOUT.toilet.minZ, LAYOUT.toilet.maxZ],
  [LAYOUT.privacyWall.minX, LAYOUT.privacyWall.maxX, LAYOUT.privacyWall.z - 0.05, LAYOUT.privacyWall.z + 0.05],
  [LAYOUT.utility.minX, LAYOUT.utility.maxX, LAYOUT.utility.minZ, LAYOUT.utility.maxZ],
  ...[-4.275, -1.375].map(z => [-1.55 - 0.22, -1.55 + 0.22, z - 0.2, z + 0.2]),
  ...[-0.55, 0.55].map(x => [x - 0.34, x + 0.34, -5.79, -5.11]),
];
for (const side of [-1, 1]) {
  for (const localZ of LAYOUT.styling.z) {
    const z = localZ + LAYOUT.stylingOffsetZ;
    const x = side * LAYOUT.styling.chairX;
    // After the quarter-turn the foot tray faces the cabinet, away from the aisle.
    blockers.push([side < 0 ? x - 0.76 : x - 0.47, side < 0 ? x + 0.47 : x + 0.76, z - 0.44, z + 0.44]);
  }
}

export function canWalkAt(x, z) {
  const visitorRadius = 0.17;
  const halfWalkWidth = LAYOUT.width / 2 - 0.2;
  // The glass return cuts away the old front-right corner. Keep the visitor's
  // body clear of that corner while turning from reception into the long aisle.
  const maxWalkX = z > LAYOUT.receptionStartZ - visitorRadius
    ? LAYOUT.receptionMaxX - 0.2 : halfWalkWidth;
  return x > -halfWalkWidth && x < maxWalkX
    && z > LAYOUT.back + 0.22 && z < LAYOUT.front - 0.22
    && Math.hypot(x - LAYOUT.coat.x, z - LAYOUT.coat.z) >= LAYOUT.coat.radius + visitorRadius
    && !blockers.some(([minX, maxX, minZ, maxZ]) => (
      x > minX - visitorRadius && x < maxX + visitorRadius
      && z > minZ - visitorRadius && z < maxZ + visitorRadius
    ));
}
