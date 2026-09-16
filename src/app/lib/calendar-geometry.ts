/**
 * Pure drag mathematics for the admin day grid.
 *
 * DOM-free on purpose: every pixel/minute conversion, snap and clamp lives here
 * so it can be unit-tested by the plain node:test runner, leaving the component
 * to do nothing but read pointer positions and render.
 *
 * All "minutes" are minutes since midnight in SALON-LOCAL time (see
 * services/salon-time.ts). Never derive them from a browser-local Date.
 */

/** Drags land on a 15-minute grid. */
export const SNAP_MINUTES = 15;

/** No appointment may be resized shorter than this. */
export const MIN_DURATION_MINUTES = 15;

/** A positioned appointment: [startMin, startMin + durationMin). */
export type Block = { startMin: number; durationMin: number };

/** The visible vertical extent of the grid, in minutes since midnight. */
export type Bounds = { startMin: number; endMin: number };

/** Vertical offset in px of `minutes` on a grid whose top edge is `originMinutes`. */
export function minutesToOffset(minutes: number, originMinutes: number, pxPerMinute: number): number {
  return (minutes - originMinutes) * pxPerMinute;
}

/** Inverse of `minutesToOffset`. */
export function offsetToMinutes(px: number, originMinutes: number, pxPerMinute: number): number {
  return px / pxPerMinute + originMinutes;
}

/**
 * Round to the nearest `step`, with half-steps always going up.
 *
 * Uses floor(x + 0.5) rather than Math.round so the rule holds for negative
 * deltas too: Math.round(-7.5) is -7, which would snap a block one way when
 * dragged down and the other way when dragged up.
 */
export function snapToStep(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.floor(minutes / step + 0.5) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Slide a block by `deltaMinutes`, snapped and clamped. Duration is preserved. */
export function applyMove(block: Block, deltaMinutes: number, bounds: Bounds): Block {
  const startMin = clamp(
    snapToStep(block.startMin + deltaMinutes),
    bounds.startMin,
    bounds.endMin - block.durationMin,
  );
  return { startMin, durationMin: block.durationMin };
}

/** Drag the top edge: the start moves, the end instant stays where it was. */
export function applyResizeTop(block: Block, deltaMinutes: number, bounds: Bounds): Block {
  const endMin = block.startMin + block.durationMin;
  const startMin = clamp(
    snapToStep(block.startMin + deltaMinutes),
    bounds.startMin,
    endMin - MIN_DURATION_MINUTES,
  );
  return { startMin, durationMin: endMin - startMin };
}

/** Drag the bottom edge: the start stays, only the duration changes. */
export function applyResizeBottom(block: Block, deltaMinutes: number, bounds: Bounds): Block {
  const endMin = clamp(
    snapToStep(block.startMin + block.durationMin + deltaMinutes),
    block.startMin + MIN_DURATION_MINUTES,
    bounds.endMin,
  );
  return { startMin: block.startMin, durationMin: endMin - block.startMin };
}
