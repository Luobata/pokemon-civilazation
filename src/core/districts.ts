import { CITY_NETWORK_RULES, DISTRICT_COMBOS } from '../content/city-network.ts';
import { DISTRICTS, districtTech, emptyDistrictEffects } from '../content/districts.ts';
import type { DistrictId, DistrictEffects } from '../content/districts.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { GameplayVersion } from '../content/eras.ts';
import type { TechId } from '../content/economy.ts';
import type { ImprovementId } from '../content/improvements.ts';
import type { BiomeId } from '../content/rules.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize } from './hex.ts';
import type { CityState, GameState, PlayerView, ProductionOrder } from './model.ts';
import { territoryOwners } from './vision.ts';
import { workRadius } from './city.ts';

export type District = { cityId: number; kind: DistrictId; tileIndex: number; builtAtRound: number };
export type DistrictState = { tiles: Record<number, District> };
export type ObservedDistrict = District & { ownerId: number | null; lastSeenRound: number };
export type DistrictProject = { cityId: number; kind: DistrictId; tileIndex: number; orderId: number; progress: number };
export type ConstructionSite = { tileIndex: number; ownerId: number; category: 'district' | 'improvement' };
export type DistrictView = { tiles: ObservedDistrict[]; projects: DistrictProject[]; constructionSites?: ConstructionSite[] };
type SiteCity = Pick<CityState, 'id' | 'ownerId' | 'position' | 'population' | 'workedTileIds' | 'lockedTileIds'>;
export type DistrictInput = {
  gameplayVersion?: GameplayVersion; playerId: number; techs: readonly TechId[];
  map: GridSize & { tiles: readonly (BiomeId | null)[] }; visible: ReadonlySet<number>;
  territoryOwnerIds: readonly (readonly number[] | null)[]; knownLandTiles: ReadonlySet<number>;
  constructionSites: readonly ConstructionSite[];
  cities: readonly SiteCity[]; completed: readonly District[]; projects: readonly DistrictProject[];
  improvements: readonly { tileIndex: number; kind: ImprovementId }[];
  improvementProjects: readonly { tileIndex: number }[]; berryTiles: ReadonlySet<number>;
};
export type DistrictBreakdown = { base: DistrictEffects; adjacency: { id: string; label: string; effect: keyof DistrictEffects;
  tileIndices: number[]; perTile: number; cap: number; value: number }[]; total: DistrictEffects;
  incomplete: boolean; unknownAdjacentTileIds: number[] };
export type DistrictSite = { cityId: number; kind: DistrictId; tileIndex: number; reason: string | null;
  releasesWork: boolean; releasedCityIds: number[]; effects: DistrictBreakdown };
const compare = (a: District | DistrictProject, b: District | DistrictProject) => a.cityId - b.cityId || a.tileIndex - b.tileIndex || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
export function initializeDistricts(state: GameState): void {
  if (state.expansion && gameplayAtLeast(state.setup, 10)) state.expansion.districts = { tiles: {} };
}
export function districtProjects(cities: readonly Pick<CityState, 'id' | 'queue'>[]): DistrictProject[] {
  return cities.flatMap(city => city.queue.flatMap(order => order.item.kind === 'district'
    ? [{ cityId: city.id, kind: order.item.defId, tileIndex: order.item.tileIndex, orderId: order.id, progress: order.progress }] : [])).sort(compare);
}
export function districtOccupiedTiles(state: GameState): Set<number> {
  if (!state.expansion?.districts) return new Set();
  return new Set([...Object.keys(state.expansion.districts.tiles).map(Number), ...districtProjects(Object.values(state.cities)).map(item => item.tileIndex)]);
}
export function districtInput(state: GameState, playerId: number, visible: ReadonlySet<number>, replacement?: { cityId: number; queue: ProductionOrder[] }): DistrictInput {
  const cities = Object.values(state.cities).sort((a, b) => a.id - b.id);
  return { gameplayVersion: state.setup.gameplayVersion, playerId, techs: state.players[playerId].research.unlockedIds,
    map: state.map, visible, territoryOwnerIds: territoryOwners(state),
    knownLandTiles: new Set(state.map.tiles.flatMap((biome, index) => biome !== 'ocean' && (visible.has(index) || Object.hasOwn(state.knowledge[playerId].rememberedTiles, index)) ? [index] : [])),
    constructionSites: [], cities, completed: Object.values(state.expansion?.districts?.tiles ?? {}).sort(compare),
    projects: districtProjects(cities.map(city => replacement?.cityId === city.id ? { ...city, queue: replacement.queue } : city)),
    improvements: Object.entries(state.expansion?.improvements?.tiles ?? {}).map(([index, item]) => ({ ...item, tileIndex: Number(index) })),
    improvementProjects: Object.keys(state.expansion?.improvements?.projects ?? {}).map(index => ({ tileIndex: Number(index) })),
    berryTiles: new Set(Object.keys(state.expansion?.rareBerries?.deposits ?? {}).map(Number)) };
}
export function districtViewInput(view: PlayerView): DistrictInput {
  const own = view.economy.cities, visible = new Set(view.visibleTileIds);
  const other = view.cities.filter(city => !own.some(owned => owned.id === city.id));
  return { gameplayVersion: view.gameplayVersion, playerId: view.playerId, techs: view.economy.player.research.unlockedIds,
    map: view.map, visible, territoryOwnerIds: view.territoryOwnerIds,
    knownLandTiles: new Set(view.map.tiles.flatMap((biome, index) => biome !== null && biome !== 'ocean' ? [index] : [])),
    constructionSites: view.expansion?.districts?.constructionSites ?? [], cities: [...own, ...[...new Map(other.map(city => [city.id, city])).values()]
      .map(city => ({ ...city, population: 1, workedTileIds: [], lockedTileIds: [] }))].sort((a, b) => a.id - b.id),
    completed: view.expansion?.districts?.tiles ?? [], projects: view.expansion?.districts?.projects ?? [],
    // Preserve the map projection; only current foreign facts contribute to district adjacency.
    improvements: view.expansion?.improvements?.tiles.filter(item => item.builtBy === view.playerId || visible.has(item.tileIndex)) ?? [], improvementProjects: view.expansion?.improvements?.projects ?? [],
    berryTiles: new Set(view.expansion?.rareBerries?.deposits.map(item => item.tileIndex) ?? []) };
}
/** Same arithmetic for complete authority input and partial observed input. No hidden reads. */
const MAIN_EFFECT: Record<DistrictId, 'research' | 'trainedXp' | 'gold' | 'production' | 'food'> = {
  researchDistrict: 'research', gymDistrict: 'trainedXp', harborDistrict: 'gold', powerPlantDistrict: 'production', gardenDistrict: 'food' };
export function districtEffects(input: Pick<DistrictInput, 'map' | 'cities' | 'improvements'> & Partial<Pick<DistrictInput, 'visible' | 'gameplayVersion' | 'completed'>>, kind: DistrictId, tileIndex: number): DistrictBreakdown {
  const definition = DISTRICTS[kind], base = { ...definition.base }, total = { ...base };
  const adjacent = neighbors(indexToHex(tileIndex, input.map)).flatMap(hex => { const index = hexToIndex(hex, input.map); return index === null ? [] : [index]; }).sort((a, b) => a - b);
  const unknownAdjacentTileIds = adjacent.filter(index => input.map.tiles[index] === null || (input.visible !== undefined && !input.visible.has(index)));
  const adjacency = definition.adjacency.map(rule => {
    const tileIndices = adjacent.filter(index => (input.map.tiles[index] !== null && rule.biomes?.includes(input.map.tiles[index]!))
      || (rule.improvement && input.improvements.some(item => item.tileIndex === index && item.kind === rule.improvement))
      || (rule.cityCenter && input.cities.some(city => hexToIndex(city.position, input.map) === index)));
    const value = Math.min(rule.cap, tileIndices.length * rule.perTile);
    total[rule.effect] += value;
    return { id: rule.id, label: rule.label, effect: rule.effect, tileIndices, perTile: rule.perTile, cap: rule.cap, value };
  });
  // v17 city planning: districts reward neighbouring districts (any owner), plus themed combos.
  if ((input.gameplayVersion ?? 0) >= 17 && input.completed) {
    const neighbours = input.completed.filter(item => item.tileIndex !== tileIndex && adjacent.includes(item.tileIndex));
    const main = MAIN_EFFECT[kind], perTile = main === 'trainedXp' ? 10 : 1, cap = CITY_NETWORK_RULES.districtAdjacencyCap * perTile;
    const tileIndices = neighbours.map(item => item.tileIndex).sort((a, b) => a - b), value = Math.min(cap, tileIndices.length * perTile);
    total[main] += value;
    adjacency.push({ id: 'district', label: '相邻设施区', effect: main, tileIndices, perTile, cap, value });
    for (const combo of DISTRICT_COMBOS.filter(item => item.district === kind)) {
      const matches = neighbours.filter(item => item.kind === combo.with).map(item => item.tileIndex).sort((a, b) => a - b), comboValue = matches.length ? combo.amount : 0;
      total[combo.effect] += comboValue;
      adjacency.push({ id: `combo-${combo.with}`, label: combo.label, effect: combo.effect, tileIndices: matches, perTile: combo.amount, cap: combo.amount, value: comboValue });
    }
  }
  return { base, adjacency, total, incomplete: unknownAdjacentTileIds.length > 0, unknownAdjacentTileIds };
}
export function districtBlocker(input: DistrictInput, cityId: number, kind: DistrictId, tileIndex: number): string | null {
  if (!gameplayAtLeast(input, 10)) return 'districts-unavailable';
  if (!Object.hasOwn(DISTRICTS, kind)) return 'unknown-district';
  const city = input.cities.find(city => city.id === cityId && city.ownerId === input.playerId);
  if (!city) return 'city-unavailable';
  const definition = DISTRICTS[kind];
  if (!input.techs.includes(gameplayAtLeast(input, 22) ? districtTech(kind, true) : definition.requiredTech)) return 'district-tech-locked';
  if (!Number.isSafeInteger(tileIndex) || tileIndex < 0 || tileIndex >= input.map.tiles.length || input.map.tiles[tileIndex] === null || !input.visible.has(tileIndex)) return 'unknown-tile';
  const position = indexToHex(tileIndex, input.map), distance = hexDistance(position, city.position);
  if (input.cities.some(city => hexToIndex(city.position, input.map) === tileIndex)) return 'city-center';
  if (distance < 1 || distance > workRadius(city as CityState)) return 'outside-city-territory';
  if (!definition.biomes.includes(input.map.tiles[tileIndex]!)) return 'wrong-biome';
  if (definition.coastal && !neighbors(position).some(hex => { const index = hexToIndex(hex, input.map); return index !== null && input.knownLandTiles.has(index); })) return 'harbor-needs-coast';
  if (input.completed.some(item => item.tileIndex === tileIndex) || input.projects.some(item => item.tileIndex === tileIndex)
    || input.constructionSites.some(item => item.tileIndex === tileIndex && item.category === 'district')) return 'district-tile-occupied';
  if (input.improvements.some(item => item.tileIndex === tileIndex) || input.improvementProjects.some(item => item.tileIndex === tileIndex)
    || input.constructionSites.some(item => item.tileIndex === tileIndex && item.category === 'improvement')) return 'tile-improved-or-under-construction';
  if (input.berryTiles.has(tileIndex)) return 'rare-berry-deposit';
  if (input.territoryOwnerIds[tileIndex]?.some(ownerId => ownerId !== input.playerId)) return 'contested-territory';
  const owned = [...input.completed, ...input.projects].filter(item => item.cityId === cityId);
  if (owned.some(item => item.kind === kind)) return 'district-kind-limit';
  return owned.length >= 2 ? 'district-city-limit' : null;
}
function districtSite(input: DistrictInput, cityId: number, kind: DistrictId, tileIndex: number): DistrictSite {
  const releasedCityIds = input.cities.filter(city => city.ownerId === input.playerId && (city.workedTileIds.includes(tileIndex) || city.lockedTileIds.includes(tileIndex))).map(city => city.id);
  return { cityId, kind, tileIndex, reason: districtBlocker(input, cityId, kind, tileIndex), releasesWork: releasedCityIds.length > 0, releasedCityIds,
    effects: districtEffects(input, kind, tileIndex) };
}
export function previewDistrict(view: PlayerView, cityId: number, kind: DistrictId, tileIndex: number): DistrictSite {
  return districtSite(districtViewInput(view), cityId, kind, tileIndex);
}
/** Includes rejected map tiles and reason codes, so the UI can explain disabled choices. */
export function districtSites(view: PlayerView, cityId: number, kind: DistrictId): DistrictSite[] {
  const input = districtViewInput(view);
  return view.map.tiles.map((_, index) => districtSite(input, cityId, kind, index));
}
export function cityDistrictEffects(state: GameState, cityId: number): DistrictEffects {
  const total = emptyDistrictEffects(), city = state.cities[cityId];
  if (!state.expansion?.districts || !city || city.ownerId === null || city.capturedAtRound === state.round) return total;
  const input = { map: state.map, cities: Object.values(state.cities), gameplayVersion: state.setup.gameplayVersion,
    completed: Object.values(state.expansion.districts.tiles).filter(item => item.builtAtRound < state.round),
    improvements: Object.entries(state.expansion.improvements?.tiles ?? {}).map(([index, item]) => ({ ...item, tileIndex: Number(index) })) };
  for (const item of Object.values(state.expansion.districts.tiles).sort(compare).filter(item => item.cityId === cityId && item.builtAtRound < state.round)) {
    const effects = districtEffects(input, item.kind, item.tileIndex).total;
    for (const key of Object.keys(total) as (keyof DistrictEffects)[]) total[key] += effects[key];
  }
  return total;
}
export function cityDistrictDetails(view: PlayerView, cityId: number) {
  const input = districtViewInput(view);
  const city = view.economy.cities.find(city => city.id === cityId);
  return [...(view.expansion?.districts?.tiles ?? [])].filter(item => item.cityId === cityId).sort(compare).map(item => {
    const active = item.ownerId !== null && item.builtAtRound < view.round && city?.capturedAtRound !== view.round;
    const effects = districtEffects(input, item.kind, item.tileIndex);
    return { ...item, active, effects: { ...effects, total: active ? effects.total : emptyDistrictEffects() } };
  });
}
/** Called only on published knowledge refresh: later hidden construction/ownership cannot rewrite memory. */
export function rememberDistricts(state: GameState, playerId: number, visible: ReadonlySet<number>): void {
  if (!state.expansion?.districts) return;
  const memory = state.knowledge[playerId].rememberedDistricts ??= {};
  for (const index of visible) {
    const item = state.expansion.districts.tiles[index];
    if (item) memory[index] = { ...item, ownerId: state.cities[item.cityId].ownerId, lastSeenRound: state.round };
    else delete memory[index];
  }
}
export function observeDistricts(state: GameState, playerId: number, visible: ReadonlySet<number>): DistrictView | undefined {
  if (!state.expansion?.districts) return undefined;
  const records = { ...state.knowledge[playerId].rememberedDistricts };
  for (const index of visible) {
    const item = state.expansion.districts.tiles[index];
    if (item) records[index] = { ...item, ownerId: state.cities[item.cityId].ownerId, lastSeenRound: state.round };
    else delete records[index];
  }
  // D-P3-4: own city facilities are private city information, independent of tile visibility.
  for (const item of Object.values(state.expansion.districts.tiles)) {
    if (state.cities[item.cityId].ownerId === playerId) records[item.tileIndex] = { ...item, ownerId: playerId, lastSeenRound: state.round };
  }
  return { tiles: Object.values(records).sort(compare).map(item => ({ ...item })),
    projects: districtProjects(Object.values(state.cities).filter(city => city.ownerId === playerId)),
    constructionSites: [
      ...Object.values(state.cities).flatMap(city => city.ownerId === null || city.ownerId === playerId ? []
        : districtProjects([city]).filter(item => visible.has(item.tileIndex))
          .map(item => ({ tileIndex: item.tileIndex, ownerId: city.ownerId!, category: 'district' as const }))),
      ...Object.entries(state.expansion.improvements?.projects ?? {}).flatMap(([index, item]) => item.playerId !== playerId && visible.has(Number(index))
        ? [{ tileIndex: Number(index), ownerId: item.playerId, category: 'improvement' as const }] : []),
    ].sort((a, b) => a.tileIndex - b.tileIndex || a.ownerId - b.ownerId || a.category.localeCompare(b.category)) };
}
export function releaseDistrictWorkers(state: GameState, cityId: number): void {
  if (!state.expansion?.districts) return;
  const city = state.cities[cityId], reserved = new Set(districtProjects([city]).map(item => item.tileIndex));
  for (const other of Object.values(state.cities).filter(other => other.ownerId === city.ownerId)) {
    other.workedTileIds = other.workedTileIds.filter(index => !reserved.has(index));
    other.lockedTileIds = other.lockedTileIds.filter(index => !reserved.has(index));
  }
}
