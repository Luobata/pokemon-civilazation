// Gameplay v24 A3 (docs/design/world-v24.md §2.5): natural landmarks — discovery, adjacent yields and essences, healing, Stardust Mere regrowth.
// The ledger exists only once the map carries landmark sites (v24 maps), so on older games every hook below is inert.
import { LANDMARKS, LANDMARK_RULES_V24 } from '../content/terrain.ts';
import type { LandmarkId } from '../content/terrain.ts';
import { ERA_MILESTONES } from '../content/era-honors.ts';
import type { Yield } from '../content/economy.ts';
import type { EssenceId } from '../content/essences.ts';
import type { Content } from '../content/units.ts';
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState } from './model.ts';
import { maxUnitHp } from './unit.ts';
import { isLandmarkTile, isPeak, landmarkAt } from './terrain.ts';
import type { FeatureMap } from './terrain.ts';

/** Per player: landmarks seen so far; `first`: the first civilization in the world to see each one; `moonStone`: Stardust Mere's deposit. */
export type LandmarkState = { discovered: Record<number, LandmarkId[]>; first: Partial<Record<LandmarkId, number>>;
  moonStone?: { tileIndex: number; regrowsAtRound: number | null } };
export type LandmarkView = { discovered: LandmarkId[] };
export type LandmarkEvent = { type: 'LandmarkDiscovered'; playerId: number; landmarkId: LandmarkId; tileIndex: number; first: boolean };

const neighbourIndexes = (map: FeatureMap, index: number) => neighbors(indexToHex(index, map), map)
  .map(hex => hexToIndex(hex, map)).filter((next): next is number => next !== null);
/** Landmarks beside a tile (none on maps without features). */
export function adjacentLandmarks(map: FeatureMap, index: number): LandmarkId[] {
  if (!map.features?.landmarks.length) return [];
  return neighbourIndexes(map, index).map(next => landmarkAt(map, next)).filter((id): id is LandmarkId => id !== null);
}
/** §2.5 extra yield of a worked tile beside landmarks (Tidesong Grotto: water tiles only). Mutates and returns `result`. */
export function applyLandmarkYield(map: FeatureMap, index: number, result: Yield): Yield {
  for (const id of adjacentLandmarks(map, index)) {
    const definition = LANDMARKS[id];
    if (definition.waterOnly && map.tiles[index] !== 'ocean') continue;
    for (const [key, value] of Object.entries(definition.adjacent) as [keyof Yield, number][]) result[key] += value;
  }
  return result;
}
/** §2.5 essences from worked tiles beside Singing Dunes / Thunder Mesa (added to cityEssenceYield). */
export function landmarkEssences(map: FeatureMap, workedTileIds: readonly number[], out: Record<EssenceId, number>): void {
  if (!map.features?.landmarks.length) return;
  for (const index of workedTileIds) for (const id of adjacentLandmarks(map, index)) {
    for (const [essence, value] of Object.entries(LANDMARKS[id].essences ?? {}) as [EssenceId, number][]) out[essence] += value;
  }
}

/** Writes `expansion.landmarks` when the content has landmarks and the map has sites; places Stardust Mere's moon-stone deposit. */
export function initializeLandmarks(state: GameState, content: Content): void {
  if (!content.landmarks || !state.expansion || !state.map.features?.landmarks.length) return;
  const ledger: LandmarkState = { discovered: Object.fromEntries(state.turnOrder.map(id => [id, []])), first: {} };
  const mere = state.map.features.landmarks.find(site => site.id === 'stardustMere');
  const world = state.expansion.world;
  if (mere && world) {
    const taken = new Set([...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)), ...Object.values(world.nests).map(site => site.tileIndex),
      ...Object.values(world.overlords).map(site => site.tileIndex), ...Object.keys(world.resources).map(Number),
      ...Object.keys(state.expansion.opening?.itemBalls ?? {}).map(Number), ...Object.values(state.expansion.legends?.sites ?? {}) as number[],
      ...state.expansion.civilization.sanctuaries.map(site => hexToIndex(site.position, state.map))]);
    const tile = neighbourIndexes(state.map, mere.tileIndex).sort((a, b) => a - b)
      .find(index => state.map.tiles[index] !== 'ocean' && !isPeak(state.map, index) && !isLandmarkTile(state.map, index) && !taken.has(index));
    if (tile !== undefined) {
      world.resources[tile] = { tileIndex: tile, position: indexToHex(tile, state.map), kind: 'stone', definitionId: 'moonStone', remaining: 1, maximum: 1, regrowsAtRound: null };
      ledger.moonStone = { tileIndex: tile, regrowsAtRound: null };
    }
  }
  state.expansion.landmarks = ledger;
}
/**
 * Per command (recordExpansion): landmarks on newly explored tiles. Each discovery is +1 era score (milestone `landmarkDiscovered`);
 * the first civilization in the world to see a landmark also gets +15 research. Events reach the discoverer only.
 */
export function recordLandmarks(state: GameState, events: readonly EventPayload[]): EventPayload[] {
  void events;
  const ledger = state.expansion?.landmarks, sites = state.map.features?.landmarks;
  if (!ledger || !sites?.length) return [];
  const out: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const player = state.players[playerId];
    if (!player || player.eliminated) continue;
    const explored = new Set(state.knowledge[playerId].exploredTileIds), known = ledger.discovered[playerId] ??= [];
    for (const site of sites) {
      if (known.includes(site.id) || !explored.has(site.tileIndex)) continue;
      known.push(site.id);
      const first = ledger.first[site.id] === undefined;
      if (first) { ledger.first[site.id] = playerId; player.research.reserve += LANDMARK_RULES_V24.firstDiscoveryResearch; }
      const honor = state.expansion!.eraHonors?.players[playerId];
      if (honor) { honor.score += ERA_MILESTONES.landmarkDiscovered.points; honor.byMilestone.landmarkDiscovered = (honor.byMilestone.landmarkDiscovered ?? 0) + 1; }
      out.push({ type: 'LandmarkDiscovered', playerId, landmarkId: site.id, tileIndex: site.tileIndex, first });
    }
  }
  return out;
}
/** Round end (resolveExpansionRound): healing beside Elder Canopy / Tidesong Grotto, Stardust Mere moon-stone regrowth. */
export function resolveLandmarkRound(state: GameState, content: Content): EventPayload[] {
  const ledger = state.expansion?.landmarks, sites = state.map.features?.landmarks;
  if (!ledger || !sites?.length) return [];
  for (const unit of Object.values(state.units).filter(isMapUnit).sort((a, b) => a.id - b.id)) {
    if (unit.ownerId === null || unit.kind !== 'pokemon') continue;
    const index = hexToIndex(unit.position, state.map);
    if (index === null) continue;
    const max = maxUnitHp(unit, content);
    for (const id of adjacentLandmarks(state.map, index)) {
      const healing = LANDMARKS[id].healing;
      if (!healing) continue;
      if (healing.units === 'naval' && content.species[unit.speciesId].role !== 'naval') continue;
      unit.hp = healing.full ? max : Math.min(max, unit.hp + (healing.hp ?? 0));
    }
  }
  const stone = ledger.moonStone, resource = stone ? state.expansion!.world.resources[stone.tileIndex] : undefined;
  if (stone && resource && resource.remaining <= 0) {
    if (stone.regrowsAtRound === null) stone.regrowsAtRound = state.round + (LANDMARKS.stardustMere.moonStoneRegrowRounds ?? 30);
    else if (state.round >= stone.regrowsAtRound) { resource.remaining = resource.maximum; stone.regrowsAtRound = null; }
  }
  return [];
}
export function observeLandmarks(state: GameState, playerId: number): LandmarkView | undefined {
  const ledger = state.expansion?.landmarks;
  return ledger ? { discovered: [...(ledger.discovered[playerId] ?? [])] } : undefined;
}
