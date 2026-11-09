// Gameplay v24 A2 (docs/design/world-v24.md §2.8): travel distance for AI moves around water and peaks, from the player's view only.
// Scaffolding: straight hex distance (exactly what the planners compare today), so v24 AI matches v23 until A2 adds the distance fields.
// Other v24 planners (gyms, rivals) should compare progress through these two functions rather than calling hexDistance directly.
import { hexDistance } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';

/** Steps `unit` would need from `from` to `target` with its own (and its civilization's) passage rules; Infinity when unreachable. */
export function travelDistance(view: PlayerView, unit: MapUnit, from: Hex, target: Hex): number {
  return hexDistance(from, target, view.map);
}
/** Whether moving `unit` to `to` brings it closer to `target`. */
export function travelCloser(view: PlayerView, unit: MapUnit, to: Hex, target: Hex): boolean {
  return travelDistance(view, unit, to, target) < travelDistance(view, unit, unit.position, target);
}
