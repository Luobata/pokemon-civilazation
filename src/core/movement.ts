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

export function canEnter(unit: UnitIdentity, biome: BiomeId, content: Content = CONTENT): boolean {
  return unitDefinition(unit, content).terrain.includes(biome);
}

// D28 B3: initial placement searches all rings, with tile index breaking ties.
export function initialUnitPosition(state: GameState, city: Hex, unit: UnitIdentity,
  content: Content = contentFor(state.setup)): Hex {
  const occupied = new Set(Object.values(state.units).filter(isMapUnit).map(other => hexToIndex(other.position, state.map)));
  const cities = new Set(Object.values(state.cities).map(other => hexToIndex(other.position, state.map)));
  const candidates = state.map.tiles.flatMap((biome, i) => !occupied.has(i) && !cities.has(i) && canEnter(unit, biome, content) ? [i] : []);
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
      if (biome === null || !canEnter(unit, biome, content)) continue;
      const cost = costs.get(current)! + stepCost(unit, biome, content);
      if (cost > budget || cost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, cost);
      paths[index] = [...paths[current], hex];
      pending.add(index);
    }
  }
  delete paths[origin];
  return paths;
}
