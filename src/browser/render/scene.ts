// Scene building: decides WHAT the map shows, from the PlayerView and UI state only.
// Pure (no DOM, no canvas), so fog and selection rules can be unit-tested in Node.
// Positions are tile indices plus world coordinates; the camera is applied by the renderer.
import { pendingPromotions } from '../../core/promotions.ts';
import { LEGENDS } from '../../content/faith-legends.ts';
import type { LegendId } from '../../content/faith-legends.ts';
import { ERA_ABILITY_RULES, WEATHERS } from '../../content/era-abilities.ts';
import { IMPROVEMENTS } from '../../content/improvements.ts';
import type { ImprovementId } from '../../content/improvements.ts';
import { DISTRICTS } from '../../content/districts.ts';
import type { DistrictId } from '../../content/districts.ts';
import type { BuildingId, Yield } from '../../content/economy.ts';
import type { BiomeId } from '../../content/rules.ts';
import type { SpeciesId } from '../../content/species.ts';
import type { UnitIdentity } from '../../content/units.ts';
import type { DistrictSite } from '../../core/districts.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../core/hex.ts';
import type { Hex } from '../../core/hex.ts';
import type { PlayerView } from '../../core/model.ts';
import { maxCityHp, workRadius } from '../../core/city.ts';
import { hexToWorld } from '../camera.ts';
import type { Point } from '../camera.ts';
import { tileYieldReader } from '../tile-yields.ts';

export type DebugOverlay = 'none' | 'tiles' | 'vision' | 'wild' | 'ai';
/** Optional presentation layers; they never add information beyond the PlayerView. */
export type MapLayers = { yields: boolean };
export const DEFAULT_MAP_LAYERS: MapLayers = { yields: true };
export type ActionMode = 'move' | 'attack' | 'capture' | null;

/** Everything the map needs to know about the current game and UI state (camera excluded). */
export type MapRenderInput = {
  view: PlayerView;
  selected?: number | null;
  selectedCity?: number | null;
  reachable?: readonly number[];
  cursorIndex?: number | null;
  actionMode?: ActionMode;
  actionTargets?: readonly number[];
  pendingTargetIndex?: number | null;
  /** Tile opened in the inspector (click on terrain, a foreign unit or city, a resource...). */
  inspectedTile?: number | null;
  districtPlacement?: { sites: readonly DistrictSite[]; selectedTileIndex: number | null };
  debugOverlay?: DebugOverlay;
  layers?: MapLayers;
};

export type UnitMarkIdentity = UnitIdentity & { id: number; ownerId: number | null };
export type SceneTile = { index: number; biome: BiomeId | null; world: Point; visible: boolean };
export type SceneEdge = { index: number; direction: number; ownerId?: number };
export type SceneBadge = { index: number; ring: string; luxury: boolean; dim: boolean }
  & ({ kind: 'icon'; icon: string } | { kind: 'sprite'; speciesId: SpeciesId; fallback: string; crown: boolean });
export type SceneDistrict = { index: number; kind: DistrictId; ownerId: number | null; memory: boolean; progress?: number };
export type SceneCity = { id: number; index: number; ownerId: number | null; selected: boolean; buildings: BuildingId[];
  name: string; population?: number; capital: boolean; hp?: { current: number; max: number } };
/** `key` is stable across frames ("unit:12") so animation can target it. */
export type SceneUnit = { key: string; unit: UnitMarkIdentity; index: number; world: Point; actionLeft: number; enraged: boolean; status?: string;
  /** At war with the viewer: drawn with a red ring so enemies read at a glance. */
  hostile: boolean;
  /** v13: number of promotion traits (public), and whether an own unit can be promoted now. */
  rank?: number; promotable?: boolean };
export type SceneYield = { index: number; yields: Yield; workable: boolean; inFocus: boolean };
export type SceneWeather = { color: string; mark: string; tiles: number[]; center: number | null };

export type MapScene = {
  width: number; height: number;
  tiles: SceneTile[];
  coastEdges: SceneEdge[];
  territoryEdges: SceneEdge[];
  improvements: { index: number; kind: ImprovementId; dim: boolean }[];
  faith: { index: number; color: string; mark: string }[];
  badges: SceneBadge[];
  districts: SceneDistrict[];
  constructionSites: { index: number; ownerId: number; category: 'district' | 'improvement' }[];
  cities: SceneCity[];
  yields: SceneYield[];
  workedTiles: number[];
  weather: SceneWeather[];
  night: boolean;
  units: SceneUnit[];
  reachable: number[];
  targets: { index: number; pending: boolean; mode: 'attack' | 'capture' }[];
  placement: { index: number; legal: boolean; selected: boolean }[];
  fog: number[];
  selectedUnit: number | null;
  inspected: number | null;
  cursor: number | null;
  debug: { overlay: DebugOverlay; labels: { index: number; text: string; offset: boolean }[]; vision: { index: number; visible: boolean }[] };
  layers: MapLayers;
};

const worldCache = new Map<string, Point[]>();
function worldCenters(map: PlayerView['map']): Point[] {
  const key = `${map.width}:${map.height}`;
  let centers = worldCache.get(key);
  if (!centers) {
    if (worldCache.size >= 3) worldCache.delete(worldCache.keys().next().value!);
    centers = map.tiles.map((_, index) => hexToWorld(indexToHex(index, map)));
    worldCache.set(key, centers);
  }
  return centers;
}

export function buildScene(input: MapRenderInput): MapScene {
  const { view } = input;
  const layers = input.layers ?? DEFAULT_MAP_LAYERS;
  const world = worldCenters(view.map);
  const visible = new Set(view.visibleTileIds);
  const indexOf = (hex: Hex) => hexToIndex(hex, view.map);
  const ownCities = new Map(view.economy.cities.map(city => [city.id, city]));

  const tiles = view.map.tiles.map((biome, index) => ({ index, biome, world: world[index], visible: visible.has(index) }));
  const coastEdges: SceneEdge[] = [];
  for (const [index, biome] of view.map.tiles.entries()) {
    if (biome !== 'ocean') continue;
    for (const [direction, neighbor] of neighbors(indexToHex(index, view.map)).map(indexOf).entries()) {
      const other = neighbor === null ? null : view.map.tiles[neighbor];
      if (other && other !== 'ocean') coastEdges.push({ index, direction });
    }
  }
  const territoryEdges: SceneEdge[] = [];
  for (const [index, owners] of view.territoryOwnerIds.entries()) {
    if (!owners?.length) continue;
    const adjacent = neighbors(indexToHex(index, view.map)).map(indexOf);
    for (const ownerId of owners) for (let direction = 0; direction < 6; direction++) {
      const neighbor = adjacent[direction];
      if (neighbor !== null && view.territoryOwnerIds[neighbor]?.includes(ownerId)) continue;
      territoryEdges.push({ index, direction, ownerId });
    }
  }

  const improvements: MapScene['improvements'] = [], faith: MapScene['faith'] = [], badges: SceneBadge[] = [];
  const expansion = view.expansion;
  if (expansion) {
    for (const tile of expansion.improvements?.tiles ?? []) {
      const index = indexOf(tile.position);
      if (index !== null && IMPROVEMENTS[tile.kind]) improvements.push({ index, kind: tile.kind, dim: !visible.has(index) });
    }
    if (expansion.faith) for (const city of view.cities) {
      const founder = expansion.faith.cityFaith[city.id];
      const legend: LegendId | undefined = founder === undefined ? undefined : expansion.faith.faiths.find(item => item.founderId === founder)?.legend;
      const index = indexOf(city.position);
      if (legend && index !== null && visible.has(index)) faith.push({ index, color: LEGENDS[legend].color, mark: LEGENDS[legend].mark });
    }
    for (const deposit of expansion.rareBerries?.deposits ?? []) {
      badges.push({ kind: 'icon', index: deposit.tileIndex, icon: deposit.berry, ring: '#F2C14E', luxury: true, dim: !visible.has(deposit.tileIndex) });
    }
    for (const site of expansion.world.resources) {
      badges.push({ kind: 'icon', index: site.tileIndex, icon: site.kind === 'stone' && !site.remaining ? 'depleted' : site.definitionId,
        ring: site.kind === 'berry' ? '#8FD07A' : '#D4DED5', luxury: false, dim: site.remaining === 0 });
    }
    for (const site of expansion.world.nests) badges.push({ kind: 'sprite', index: site.tileIndex, speciesId: site.speciesId, fallback: '巢', crown: false, ring: '#D3655C', luxury: false, dim: false });
    for (const site of expansion.world.overlords) badges.push({ kind: 'sprite', index: site.tileIndex, speciesId: site.speciesId, fallback: '霸', crown: true, ring: '#E6B85C', luxury: false, dim: false });
    for (const site of expansion.civilization.sanctuaries) {
      const index = indexOf(site.position);
      if (index !== null && visible.has(index)) badges.push({ kind: 'icon', index, icon: site.guardianDefeated ? 'tablet' : 'sanctuary', ring: '#B58AD6', luxury: false, dim: false });
    }
  }

  const districts: SceneDistrict[] = [];
  for (const tile of expansion?.districts?.tiles ?? []) {
    districts.push({ index: tile.tileIndex, kind: tile.kind, ownerId: tile.ownerId, memory: tile.ownerId !== view.playerId && !visible.has(tile.tileIndex) });
  }
  for (const project of expansion?.districts?.projects ?? []) {
    districts.push({ index: project.tileIndex, kind: project.kind, ownerId: view.playerId, memory: false,
      progress: Math.min(100, Math.round(project.progress * 100 / DISTRICTS[project.kind].cost)) });
  }
  const constructionSites = (expansion?.districts?.constructionSites ?? []).map(site => ({ index: site.tileIndex, ownerId: site.ownerId, category: site.category }));

  const cities: SceneCity[] = view.cities.map(city => {
    const own = ownCities.get(city.id);
    return { id: city.id, index: indexOf(city.position)!, ownerId: city.ownerId, selected: city.id === input.selectedCity,
      buildings: (own?.buildingIds ?? []).filter(id => id !== 'headquarters'),
      name: city.ownerId === null ? `中立 · 城市 ${city.id}` : `城市 ${city.id}`,
      capital: city.headquartersOf !== undefined && city.headquartersOf !== null,
      ...(own ? { population: own.population, hp: { current: own.hp, max: maxCityHp(own) } } : {}) };
  });

  // Yield rows: every known tile when the layer is on, otherwise only the selected city's work area.
  // Whether a row is drawn at the current zoom is the renderer's call (see YIELD_MIN_RADIUS).
  const focusCity = input.selectedCity === null || input.selectedCity === undefined ? undefined : ownCities.get(input.selectedCity);
  const yields: SceneYield[] = [];
  if (layers.yields || focusCity) {
    const readYield = tileYieldReader(view);
    for (let index = 0; index < view.map.tiles.length; index++) {
      const inFocus = focusCity !== undefined && hexDistance(indexToHex(index, view.map), focusCity.position) <= workRadius(focusCity);
      if (!layers.yields && !inFocus) continue;
      const info = readYield(index);
      if (info) yields.push({ index, yields: info.yields, workable: info.workable, inFocus });
    }
  }

  const era = expansion?.eraAbilities;
  const weather: SceneWeather[] = [];
  for (const field of era?.fields ?? []) {
    if (field.untilRound < view.round) continue;
    const definition = WEATHERS[field.weather], center = indexOf(field.center);
    weather.push({ color: definition.color, mark: definition.mark,
      tiles: view.visibleTileIds.filter(index => hexDistance(indexToHex(index, view.map), field.center) <= ERA_ABILITY_RULES.weatherRadius),
      center: center !== null && visible.has(center) ? center : null });
  }

  // Only the authorized PlayerView supplies entities; hidden live units never reach the scene.
  const atWar = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  const units: SceneUnit[] = view.units.map(unit => {
    const index = indexOf(unit.position)!, status = era?.units[unit.id];
    const label = !status ? undefined : status.mega ? 'M' : (status.dynamaxUntilRound ?? 0) >= view.round ? '极' : status.tera ? '晶' : status.zPrimed ? 'Z' : undefined;
    const promotion = view.expansion?.promotions?.units[unit.id];
    return { key: `unit:${unit.id}`, unit, index, world: world[index], actionLeft: unit.actionLeft, enraged: unit.enraged ?? false,
      hostile: unit.ownerId !== null && atWar.has(unit.ownerId), ...(label ? { status: label } : {}),
      ...(promotion?.traits.length ? { rank: promotion.traits.length } : {}),
      ...(unit.ownerId === view.playerId && pendingPromotions(promotion) ? { promotable: true } : {}) };
  });

  const mode = input.actionMode ?? null;
  const targets = (input.actionTargets ?? []).filter(index => visible.has(index))
    .map(index => ({ index, pending: index === input.pendingTargetIndex, mode: mode === 'capture' ? 'capture' as const : 'attack' as const }));
  const placement = (input.districtPlacement?.sites ?? []).filter(site => site.reason === null || visible.has(site.tileIndex))
    .map(site => ({ index: site.tileIndex, legal: site.reason === null, selected: input.districtPlacement!.selectedTileIndex === site.tileIndex }));
  const selectedUnit = view.units.find(unit => unit.id === input.selected);

  const overlay = input.debugOverlay ?? 'none';
  const debug: MapScene['debug'] = { overlay, labels: [], vision: [] };
  if (overlay === 'tiles') for (const [index, biome] of view.map.tiles.entries()) {
    if (!biome) continue;
    const hex = indexToHex(index, view.map);
    debug.labels.push({ index, text: `${index} (${hex.q},${hex.r})`, offset: false });
  }
  if (overlay === 'vision') for (const [index, biome] of view.map.tiles.entries()) if (biome) debug.vision.push({ index, visible: visible.has(index) });
  if (overlay === 'wild' || overlay === 'ai') for (const unit of view.units) {
    if ((overlay === 'wild' && unit.ownerId !== null) || (overlay === 'ai' && unit.ownerId === null)) continue;
    debug.labels.push({ index: indexOf(unit.position)!, text: `#${unit.id} A${unit.actionLeft}${unit.enraged ? ' 暴走' : ''}`, offset: true });
  }

  return {
    width: view.map.width, height: view.map.height, tiles, coastEdges, territoryEdges, improvements, faith, badges, districts, constructionSites,
    cities, yields, workedTiles: focusCity ? [...focusCity.workedTileIds] : [], weather, night: era?.night ?? false, units,
    reachable: (input.reachable ?? []).filter(index => visible.has(index)), targets, placement,
    fog: tiles.filter(tile => tile.biome && !tile.visible).map(tile => tile.index),
    selectedUnit: selectedUnit ? indexOf(selectedUnit.position) : null,
    inspected: input.inspectedTile ?? null,
    // The keyboard cursor duplicates the inspected tile after a click; draw only one of them.
    cursor: input.cursorIndex !== undefined && input.cursorIndex !== input.inspectedTile ? input.cursorIndex : null, debug, layers,
  };
}

/** Every tile index the scene would put a mark on, for fog invariants. */
export function sceneMarkedTiles(scene: MapScene): { layer: string; index: number }[] {
  return [
    ...scene.units.map(item => ({ layer: 'unit', index: item.index })),
    ...scene.cities.map(item => ({ layer: 'city', index: item.index })),
    ...scene.badges.map(item => ({ layer: `badge:${item.kind === 'icon' ? item.icon : item.speciesId}`, index: item.index })),
    ...scene.districts.map(item => ({ layer: 'district', index: item.index })),
    ...scene.constructionSites.map(item => ({ layer: 'construction', index: item.index })),
    ...scene.improvements.map(item => ({ layer: 'improvement', index: item.index })),
    ...scene.faith.map(item => ({ layer: 'faith', index: item.index })),
  ];
}
