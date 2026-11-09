import { doctrineEffects } from './leader-doctrines.ts';
import { promotionMovement } from './promotions.ts';
import { inZoc, usesTactics, zocTiles } from './tactics.ts';
import { isMapUnit } from './model.ts';
import { CONTENT, unitDefinition, contentFor, contentForView } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { Hex } from './hex.ts';
import type { MapUnit, PlayerView, GameState } from './model.ts';
import { featureMoveExtra, isLandmarkTile, isPeak } from './terrain.ts';
import type { FeatureMap } from './terrain.ts';

/**
 * Gameplay v24 (docs/design/world-v24.md §2.2–2.3): the tile being entered, on a map that may carry terrain features. Without
 * `passage`, or on a map without features (v≤23), `canEnter` is exactly the species / role terrain table.
 */
export type Passage = { map: FeatureMap; index: number };
/** Flying species (the 17 whose table covers ocean and volcano): the only units that cross peaks. */
export const isFlying = (unit: UnitIdentity, content: Content) => {
  const terrain = unitDefinition(unit, content).terrain;
  return terrain.includes('ocean') && terrain.includes('volcano');
};
/**
 * Whether `unit` may stand on a tile of `biome`. With a v24 `passage`: never on a landmark, on a peak only when flying.
 * Other v24 planners (gyms, rivals) should test tiles through this function with a passage rather than reading the terrain table.
 */
export function canEnter(unit: UnitIdentity, biome: BiomeId, content: Content = CONTENT, passage?: Passage): boolean {
  const native = unitDefinition(unit, content).terrain.includes(biome);
  if (!passage?.map.features) return native;
  const { map, index } = passage;
  if (isLandmarkTile(map, index)) return false;
  if (isPeak(map, index)) return isFlying(unit, content);
  return native;
}
/** `canEnter` on a tile of the authoritative map (the v24 passage is passed automatically; identical to the biome test before v24). */
export const canEnterTile = (unit: UnitIdentity, map: FeatureMap, index: number, content: Content) =>
  map.tiles[index] !== null && canEnter(unit, map.tiles[index]!, content, { map, index });

// D28 B3: initial placement searches all rings, with tile index breaking ties.
export function initialUnitPosition(state: GameState, city: Hex, unit: UnitIdentity,
  content: Content = contentFor(state.setup)): Hex {
  const occupied = new Set(Object.values(state.units).filter(isMapUnit).map(other => hexToIndex(other.position, state.map)));
  const cities = new Set(Object.values(state.cities).map(other => hexToIndex(other.position, state.map)));
  const candidates = state.map.tiles.flatMap((_, i) => !occupied.has(i) && !cities.has(i) && canEnterTile(unit, state.map, i, content) ? [i] : []);
  candidates.sort((a, b) => hexDistance(city, indexToHex(a, state.map), state.map) - hexDistance(city, indexToHex(b, state.map), state.map) || a - b);
  if (!candidates.length) throw new Error('No enterable empty tile exists on this map.');
  return indexToHex(candidates[0], state.map);
}

/** Movement points for a full round (species move + leader doctrine + 疾行). */
export function movementBudget(view: PlayerView, unit: MapUnit, content: Content): number {
  return unitDefinition(unit, content).move + doctrineEffects(view.economy.player, view.eraProgression, unit, content).movementBonus + promotionMovement(view, unit.id);
}
/** Cost of entering one tile (ghosts pay 1 everywhere). */
export const stepCost = (unit: UnitIdentity, biome: BiomeId, content: Content) =>
  unit.kind === 'pokemon' && content.species[unit.speciesId].typeId === 'ghost' ? 1 : content.moveCosts[biome];
/** Cost of one step from tile `from` into tile `to`: the biome cost plus the v24 hill and river-crossing costs (none before v24). */
export function tileStepCost(unit: UnitIdentity, map: FeatureMap, from: number, to: number, content: Content): number {
  return stepCost(unit, map.tiles[to]!, content) + featureMoveExtra(map, from, to, unit, content);
}
/** Movement points a path spends (its first entry is the start tile). */
export function pathCost(unit: UnitIdentity, map: FeatureMap, path: readonly Hex[], content: Content): number {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += tileStepCost(unit, map, hexToIndex(path[k - 1], map)!, hexToIndex(path[k], map)!, content);
  return total;
}
/** Gameplay v16: movement points let a unit move, then still act. */
export const usesMovementPoints = (source: { gameplayVersion?: number; setup?: { gameplayVersion?: number } }) =>
  ((source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0) >= 16;

// Dijkstra over the player's known terrain only. Hidden occupants never affect
// this query; remembered unit markers are not current occupancy information.
export function reachablePaths(view: PlayerView, unitId: number,
  content: Content = contentForView(view)): Record<number, Hex[]> {
  const unit = view.units.find(candidate => candidate.id === unitId && candidate.ownerId === view.playerId);
  if (!unit || unit.actionLeft === 0 || view.activePlayerId !== view.playerId) return {};
  const origin = hexToIndex(unit.position, view.map)!;
  const blocked = new Set(view.units.filter(other => other.id !== unit.id).map(other => hexToIndex(other.position, view.map)));
  for (const city of Object.values(view.knowledge.lastKnownCities)) {
    if (city.ownerId !== view.playerId) blocked.add(hexToIndex(city.position, view.map));
  }
  for (const city of view.cities) if (city.ownerId !== view.playerId) blocked.add(hexToIndex(city.position, view.map));
  const costs = new Map([[origin, 0]]);
  const paths: Record<number, Hex[]> = { [origin]: [{ ...unit.position }] };
  const pending = new Set([origin]);
  const budget = movementBudget(view, unit, content) - (unit.movesSpent ?? 0);
  // Gameplay v2: entering a visible hostile zone of control ends movement there.
  const zoc = usesTactics(view) ? zocTiles(unit, view.units, view.diplomacy, content) : [];
  while (pending.size) {
    const current = [...pending].sort((a, b) => costs.get(a)! - costs.get(b)! || a - b)[0];
    pending.delete(current);
    if (current !== origin && zoc.length && inZoc(indexToHex(current, view.map), zoc, view.map)) continue;
    for (const hex of neighbors(indexToHex(current, view.map), view.map)) {
      const index = hexToIndex(hex, view.map);
      if (index === null || blocked.has(index)) continue;
      const biome = view.map.tiles[index];
      if (biome === null || !canEnter(unit, biome, content, { map: view.map, index })) continue;
      const cost = costs.get(current)! + tileStepCost(unit, view.map, current, index, content);
      if (cost > budget || cost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, cost);
      paths[index] = [...paths[current], hex];
      pending.add(index);
    }
  }
  delete paths[origin];
  return paths;
}
