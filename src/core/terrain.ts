// Gameplay v24 A (docs/design/world-v24.md §2.2–2.3): terrain feature queries (hills, peaks, rivers, lakes, deep ocean, landmarks).
// Every query reads `map.features`, which only the v24 generator writes: on a v≤23 map (or a view without features) each one answers
// "no feature", so older games keep their exact rules. Authority passes the state map, previews and the AI pass the view map (which
// carries the features of explored tiles only), so a preview always equals the resolution on the tiles it can see.
import { TERRAIN_RULES_V24 } from '../content/terrain.ts';
import type { LandmarkId } from '../content/terrain.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Yield } from '../content/economy.ts';
import { unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize, Hex } from './hex.ts';
import type { StrengthFactor } from './strength.ts';

/** Sorted tile indexes per feature (written only by the v24 generator; absent on v≤23 maps). */
export type MapFeatures = {
  hills: number[]; peaks: number[]; rivers: number[]; lakes: number[]; deep: number[];
  landmarks: { tileIndex: number; id: LandmarkId }[];
};
/** Any map-like value: the authoritative map or a player's view of it. */
export type FeatureMap = GridSize & { tiles: readonly (BiomeId | null)[]; features?: MapFeatures };
type VersionSource = { setup?: { gameplayVersion?: number }; gameplayVersion?: number };
/** Gameplay v24 terrain rules (A1). */
export const usesTerrainV24 = (source: VersionSource) => ((source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0) >= 24;

const HILL = 1, PEAK = 2, RIVER = 4, LAKE = 8, DEEP = 16, LANDMARK = 32;
const flagCache = new WeakMap<MapFeatures, Uint8Array>();
const landmarkCache = new WeakMap<MapFeatures, Map<number, LandmarkId>>();
/** Per-tile feature bits, built once per features object (states are copied per command, so this is per command at most). */
function flags(map: FeatureMap): Uint8Array | null {
  const features = map.features;
  if (!features) return null;
  let bits = flagCache.get(features);
  if (!bits) {
    bits = new Uint8Array(map.width * map.height);
    for (const [list, bit] of [[features.hills, HILL], [features.peaks, PEAK], [features.rivers, RIVER], [features.lakes, LAKE], [features.deep, DEEP]] as const) {
      for (const index of list) bits[index] |= bit;
    }
    for (const site of features.landmarks) bits[site.tileIndex] |= LANDMARK;
    flagCache.set(features, bits);
  }
  return bits;
}
const has = (map: FeatureMap, index: number, bit: number) => ((flags(map)?.[index] ?? 0) & bit) !== 0;
export const hasFeatures = (map: FeatureMap) => map.features !== undefined;
export const isHill = (map: FeatureMap, index: number) => has(map, index, HILL);
export const isPeak = (map: FeatureMap, index: number) => has(map, index, PEAK);
export const isRiver = (map: FeatureMap, index: number) => has(map, index, RIVER);
export const isLake = (map: FeatureMap, index: number) => has(map, index, LAKE);
export const isDeep = (map: FeatureMap, index: number) => has(map, index, DEEP);
export const isLandmarkTile = (map: FeatureMap, index: number) => has(map, index, LANDMARK);
/** The landmark standing on a tile, if any. */
export function landmarkAt(map: FeatureMap, index: number): LandmarkId | null {
  const features = map.features;
  if (!features || !features.landmarks.length) return null;
  let sites = landmarkCache.get(features);
  if (!sites) { sites = new Map(features.landmarks.map(site => [site.tileIndex, site.id])); landmarkCache.set(features, sites); }
  return sites.get(index) ?? null;
}
/** The outermost north and south rows of a v24 map are polar ice: deep water that cannot be worked. */
export function isPolarIce(map: FeatureMap, index: number): boolean {
  if (!map.features) return false;
  const row = Math.floor(index / map.width);
  return row === 0 || row === map.height - 1;
}
/** Shallow water: ocean next to land, or a lake (only meaningful on v24 maps; everything is "shallow" without features). */
export const isShallow = (map: FeatureMap, index: number) => map.tiles[index] === 'ocean' && !isDeep(map, index);
/** Tiles no unit may stand on (landmarks; peaks unless the unit flies). */
export const blocksPassage = (map: FeatureMap, index: number, flying: boolean) => isLandmarkTile(map, index) || (!flying && isPeak(map, index));

const neighborIndexes = (map: FeatureMap, index: number) => neighbors(indexToHex(index, map), map)
  .map(hex => hexToIndex(hex, map)).filter((next): next is number => next !== null);
/** §2.2 fresh water: a city centre on a river, or beside a river or lake. */
export function freshWater(map: FeatureMap, position: Hex): boolean {
  const index = hexToIndex(position, map);
  if (index === null || !map.features) return false;
  return isRiver(map, index) || neighborIndexes(map, index).some(next => isRiver(map, next) || isLake(map, next));
}
/** Tiles a city may work: not peaks, landmarks or polar ice (v24); every tile otherwise. */
export const workableFeature = (map: FeatureMap, index: number) => !isPeak(map, index) && !isLandmarkTile(map, index) && !isPolarIce(map, index);
/** §2.2 yields: deep water 1/0/1/0 instead of the ocean yield, hills +1 production, rivers +1 gold. Mutates and returns `result`. */
export function applyFeatureYield(map: FeatureMap, index: number, result: Yield): Yield {
  if (!map.features) return result;
  if (isDeep(map, index)) Object.assign(result, TERRAIN_RULES_V24.deepOcean);
  if (isHill(map, index)) result.production += TERRAIN_RULES_V24.hillProduction;
  if (isRiver(map, index)) result.gold += TERRAIN_RULES_V24.riverGold;
  return result;
}
/** §2.2 movement: +1 to enter a hill, +1 to enter a river tile from a tile without a river (ghosts float over both). */
export function featureMoveExtra(map: FeatureMap, from: number, to: number, unit: UnitIdentity, content: Content): number {
  if (!map.features || (unit.kind === 'pokemon' && content.species[unit.speciesId].typeId === 'ghost')) return 0;
  return (isHill(map, to) ? TERRAIN_RULES_V24.hillMoveCost : 0)
    + (isRiver(map, to) && !isRiver(map, from) && map.tiles[from] !== 'ocean' ? TERRAIN_RULES_V24.riverCrossingCost : 0);
}
/** §2.2 vision: standing on a hill sees one tile further (as a mountain does). */
export const featureVision = (map: FeatureMap, index: number) => isHill(map, index) ? TERRAIN_RULES_V24.hillVision : 0;

/**
 * §2.2 / §2.3 labelled strength terms of one strike from `from` onto `to` (authority and preview call this with their own map).
 * Hill cover only when the forest / mountain cover (+5) does not already apply; a city on a hill gets 高地城池 instead.
 * River crossing: a melee or fast Pokémon striking a target on a river from a tile without one (never on counter strikes).
 * `embarked`: the target is a land unit carried on water (A2).
 */
export function featureStrikeFactors(map: FeatureMap, from: Hex, to: Hex, v: { attacker: UnitIdentity; city: boolean; counter: boolean; embarked: boolean },
  content: Content): StrengthFactor[] {
  if (!map.features) return [];
  const fromIndex = hexToIndex(from, map), toIndex = hexToIndex(to, map);
  if (fromIndex === null || toIndex === null) return [];
  const factors: StrengthFactor[] = [];
  const target = map.tiles[toIndex];
  if (isHill(map, toIndex)) {
    if (v.city) factors.push({ side: 'defense', label: '高地城池', value: TERRAIN_RULES_V24.hillCityDefense });
    else if (target !== 'forest' && target !== 'mountain') factors.push({ side: 'defense', label: '丘陵掩护', value: TERRAIN_RULES_V24.hillDefense });
  }
  const role = v.attacker.kind === 'pokemon' ? content.species[v.attacker.speciesId].role : null;
  if (!v.counter && (role === 'melee' || role === 'fast') && isRiver(map, toIndex) && !isRiver(map, fromIndex)) {
    factors.push({ side: 'attack', label: '渡河', value: TERRAIN_RULES_V24.riverCrossingAttack });
  }
  if (v.embarked) factors.push({ side: 'defense', label: '乘浪', value: TERRAIN_RULES_V24.embarkedDefense });
  return factors;
}

/** §2.3 embarked: a unit whose own terrain table has no water, standing on water (derived, never stored). */
export function isEmbarked(unit: UnitIdentity & { position: Hex }, map: FeatureMap, content: Content): boolean {
  if (!map.features) return false;
  const index = hexToIndex(unit.position, map);
  return index !== null && map.tiles[index] === 'ocean' && !unitDefinition(unit, content).terrain.includes('ocean');
}
/** Terrain terms of a strike between two units (authority: state map; preview: view map). */
export const unitStrikeTerrain = (map: FeatureMap, attacker: UnitIdentity & { position: Hex }, defender: UnitIdentity & { position: Hex }, counter: boolean, content: Content) =>
  featureStrikeFactors(map, attacker.position, defender.position, { attacker, city: false, counter, embarked: isEmbarked(defender, map, content) }, content);
/** Terrain terms of a unit striking a city (高地城池, 渡河). */
export const cityStrikeTerrain = (map: FeatureMap, attacker: UnitIdentity & { position: Hex }, city: Hex, content: Content) =>
  featureStrikeFactors(map, attacker.position, city, { attacker, city: true, counter: false, embarked: false }, content);
/** Terrain terms of a city shooting back at the unit that attacked it (the unit's hill cover, 乘浪). */
export const cityCounterTerrain = (map: FeatureMap, city: Hex, defender: UnitIdentity & { position: Hex }, content: Content) =>
  featureStrikeFactors(map, city, defender.position, { attacker: defender, city: false, counter: true, embarked: isEmbarked(defender, map, content) }, content);

/** The features a player's view carries: only explored tiles (features are static, so seeing a tile once reveals them). */
export function viewFeatures(map: GridSize & { features?: MapFeatures }, exploredTileIds: readonly number[]): MapFeatures | undefined {
  const features = map.features;
  if (!features) return undefined;
  const explored = new Set(exploredTileIds);
  const known = (tiles: readonly number[]) => tiles.filter(tile => explored.has(tile));
  return { hills: known(features.hills), peaks: known(features.peaks), rivers: known(features.rivers), lakes: known(features.lakes), deep: known(features.deep),
    landmarks: features.landmarks.filter(site => explored.has(site.tileIndex)).map(site => ({ ...site })) };
}
