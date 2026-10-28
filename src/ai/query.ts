import type { AiThresholds } from './thresholds.ts';
import { CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { canResearch } from '../core/economy-commands.ts';
import { reachablePaths } from '../core/movement.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';

export function knownCities(view: PlayerView) {
  const known = new Map(Object.entries(view.knowledge.lastKnownCities).map(([id, city]) => [Number(id), { ...city, id: Number(id) }]));
  for (const city of view.cities) known.set(city.id, { ...city, lastSeenRound: view.round });
  return [...known.values()].sort((a, b) => a.id - b.id);
}
export function isCitySite(view: PlayerView, position: Hex): boolean {
  const index = hexToIndex(position, view.map);
  if (index === null || view.map.tiles[index] === null || view.map.tiles[index] === 'ocean'
    || knownCities(view).some(city => hexDistance(city.position, position) < 4)) return false;
  // An unobserved tile inside the exclusion radius may contain an undiscovered city.
  // Explore it first; never query authoritative hidden city positions.
  for (let q = position.q - 3; q <= position.q + 3; q++) for (let r = position.r - 3; r <= position.r + 3; r++) {
    if (hexDistance(position, { q, r }) > 3) continue;
    const nearby = hexToIndex({ q, r }, view.map);
    if (nearby !== null && view.map.tiles[nearby] === null) return false;
  }
  return true;
}
// Each query takes its observation explicitly; no closure captures authoritative state.
export const RULE_QUERIES = { content: CONTENT, paths: reachablePaths, attack: previewAttack, capture: previewCapture, research: canResearch, citySite: isCitySite };
export type RuleQueries = Omit<typeof RULE_QUERIES, 'content'> & { content: Content; ai?: AiThresholds };
