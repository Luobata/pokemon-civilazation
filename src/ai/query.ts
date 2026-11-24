import type { AiThresholds } from './thresholds.ts';
import { GAME_CONTENT, contentForView } from '../content/units.ts';
import { openingTuning } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import { canResearch } from '../core/economy-commands.ts';
import { reachablePaths } from '../core/movement.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import { viewGymBlocksCity } from '../core/gym-circuit.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { isLandmarkTile, isPeak } from '../core/terrain.ts';

export function knownCities(view: PlayerView) {
  const known = new Map(Object.entries(view.knowledge.lastKnownCities).map(([id, city]) => [Number(id), { ...city, id: Number(id) }]));
  for (const city of view.cities) known.set(city.id, { ...city, lastSeenRound: view.round });
  return [...known.values()].sort((a, b) => a.id - b.id);
}
const siteRadii = new WeakMap<object, number>();
/** v27 ① R2 (pace-v27 §2.2): the explored radius a city site needs — 2 with opening safety, else 3 (cached per view). */
function siteRadius(view: PlayerView, content?: Content): number {
  if (content) return openingTuning(content).aiSiteRadius;
  let radius = siteRadii.get(view);
  if (radius === undefined) {
    const own = contentForView(view);
    siteRadii.set(view, radius = openingTuning(own).aiSiteRadius);
  }
  return radius;
}
export function isCitySite(view: PlayerView, position: Hex, content?: Content): boolean {
  const index = hexToIndex(position, view.map);
  if (index === null || view.map.tiles[index] === null || view.map.tiles[index] === 'ocean' || isPeak(view.map, index) || isLandmarkTile(view.map, index) || viewGymBlocksCity(view, index)
    || knownCities(view).some(city => hexDistance(city.position, position, view.map) < 4)) return false;
  // An unobserved tile inside the exclusion radius may contain an undiscovered city.
  // Explore it first; never query authoritative hidden city positions.
  // v27: only within radius 2 — a city hidden in ring 3 makes the authority refuse the site (a fog refusal the AI remembers).
  const radius = siteRadius(view, content);
  for (let q = position.q - radius; q <= position.q + radius; q++) for (let r = position.r - radius; r <= position.r + radius; r++) {
    if (hexDistance(position, { q, r }, view.map) > radius) continue;
    const nearby = hexToIndex({ q, r }, view.map);
    if (nearby !== null && view.map.tiles[nearby] === null) return false;
  }
  return true;
}
// Each query takes its observation explicitly; no closure captures authoritative state.
export const RULE_QUERIES = { content: GAME_CONTENT, paths: reachablePaths, attack: previewAttack, capture: previewCapture, research: canResearch, citySite: isCitySite };
export type RuleQueries = Omit<typeof RULE_QUERIES, 'content'> & { content: Content; ai?: AiThresholds };
