// Pure tile-habitat species weight query shared by wild spawning and research tasks.
import { deepWaterFor, habitatOverlaysFor, residentsFor, spawnWeightsFor } from '../content/roster.ts';
import type { SpeciesId } from '../content/species.ts';
import { LANDMARK_RULES_V24 } from '../content/terrain.ts';
import type { Content } from '../content/units.ts';
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import { adjacentLandmarks } from './landmarks.ts';
import { isDeep, isHill, isPeak, isRiver } from './terrain.ts';
import type { FeatureMap } from './terrain.ts';

/** The time-independent part of a tile's habitat (biome table, feature overlays, deep water, landmark residents); `map` may be a view map. */
export function tileHabitatWeights(map: FeatureMap, tileIndex: number, content: Content): Partial<Record<SpeciesId, number>> {
  const biome = map.tiles[tileIndex];
  if (biome === null || biome === undefined) return {};
  const weights: Partial<Record<SpeciesId, number>> = { ...spawnWeightsFor(content, biome) };
  const add = (extra: Partial<Record<SpeciesId, number>>) => { for (const [id, value] of Object.entries(extra) as [SpeciesId, number][]) weights[id] = (weights[id] ?? 0) + value; };
  // v25: the overlays, deep water and residents come from the regional tables (the v24 tables otherwise).
  const overlays = habitatOverlaysFor(content), deep = deepWaterFor(content);
  if (isHill(map, tileIndex)) add(overlays.hill);
  if (isRiver(map, tileIndex)) add(overlays.river);
  const around = neighbors(indexToHex(tileIndex, map), map).map(hex => hexToIndex(hex, map)).filter((index): index is number => index !== null);
  if (biome === 'mountain' && around.some(index => isPeak(map, index))) add(overlays.peakside);
  if (isDeep(map, tileIndex)) {
    for (const id of deep.remove) delete weights[id];
    for (const [id, factor] of Object.entries(deep.multiply) as [SpeciesId, number][]) if (weights[id]) weights[id] = weights[id]! * factor;
  }
  for (const id of adjacentLandmarks(map, tileIndex)) for (const resident of residentsFor(content, id)) {
    weights[resident] = (weights[resident] ?? LANDMARK_RULES_V24.residentBaseWeight) * LANDMARK_RULES_V24.residentMultiplier;
  }
  return weights;
}
