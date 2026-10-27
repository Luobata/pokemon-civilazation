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
  return index !== null && view.map.tiles[index] !== null && view.map.tiles[index] !== 'ocean'
    && knownCities(view).every(city => hexDistance(city.position, position) >= 4);
}
// Each query takes its observation explicitly; no closure captures authoritative state.
export const RULE_QUERIES = { content: CONTENT, paths: reachablePaths, attack: previewAttack, capture: previewCapture, research: canResearch, citySite: isCitySite };
export type RuleQueries = Omit<typeof RULE_QUERIES, 'content'> & { content: Content };
