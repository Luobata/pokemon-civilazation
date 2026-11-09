import { districtOccupiedTiles } from './districts.ts';
import { leaderEffects } from '../content/leaders.ts';
import { CREW_SPECIALTIES, IMPROVEMENT_IDS, IMPROVEMENT_IDS_V23, IMPROVEMENT_RULES_V23, IMPROVEMENT_WORK, IMPROVEMENTS, crewSpecialtyFor, improvementIdsFor } from '../content/improvements.ts';
import type { CrewSpecialty, ImprovementId, ImprovementResource } from '../content/improvements.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { Content, SpeciesId, UnitIdentity } from '../content/units.ts';
import type { Yield } from '../content/economy.ts';
import type { BerryId, StoneId } from '../content/world-systems.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import { workRadius } from './city.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState, MapUnit, PlayerState, PlayerView } from './model.ts';
import { visibleTiles } from './vision.ts';
import { playerPolicyEffects } from './policies.ts';

/** `damaged` / `damagedAtRound` / `crew` / `repairedAtRound` are written only in gameplay v23. */
export type TileImprovement = { kind: ImprovementId; builtBy: number; builtAtRound: number; crew?: CrewSpecialty; damaged?: true; damagedAtRound?: number; repairedAtRound?: number };
export type ImprovementProject = { kind: ImprovementId; playerId: number; progress: number };
/** Present only when setup.gameplayVersion >= 2. */
export type ImprovementState = { tiles: Record<number, TileImprovement>; projects: Record<number, ImprovementProject> };
export type ImprovementAction = { type: 'ImproveTile'; unitId: number; tileIndex: number; kind: ImprovementId };
export type ImprovementEvent = { type: 'TileWorked'; playerId: number; unitId: number; tileIndex: number; position: Hex;
  kind: ImprovementId; progress: number; required: number; completed: boolean; crew?: CrewSpecialty }
  /** v23: a 进化石矿场 produced evolution stones (on completion or on its cycle). Private to the receiver. */
  | { type: 'StoneQuarried'; playerId: number; tileIndex: number; position: Hex; stoneId: StoneId; amount: number }
  /** v23: a 开荒 builder's build added production to a city. */
  | { type: 'CrewClearing'; playerId: number; cityId: number; tileIndex: number; amount: number };
export type ImprovementView = { tiles: (TileImprovement & { tileIndex: number; position: Hex })[]; projects: (ImprovementProject & { tileIndex: number })[] };

export function usesImprovements(state: GameState): boolean {
  return state.expansion !== undefined && gameplayAtLeast(state.setup, 2);
}
type VersionSource = { setup?: { gameplayVersion?: number }; gameplayVersion?: number };
const versionOf = (source: VersionSource) => (source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0;
/** Gameplay v18: only 工匠 (builder) units build improvements, finishing one per action. */
export const usesBuilders = (source: VersionSource) => versionOf(source) >= 18;
/** Gameplay v23 (docs/design/improvements-v23.md): resource improvements, pillage and repair, builder escorts. */
export const usesImprovementsV23 = (source: VersionSource) => versionOf(source) >= 23;
export function initializeImprovements(state: GameState): void {
  if (usesImprovements(state)) state.expansion!.improvements = { tiles: {}, projects: {} };
}
export function isImprovementAction(action: { type: unknown }): action is ImprovementAction {
  return action.type === 'ImproveTile';
}
export function crewPoints(identity: UnitIdentity, content: Content, kind: ImprovementId): number {
  if (identity.kind === 'logistics' && identity.role === 'builder') return IMPROVEMENT_WORK.required;
  if (identity.kind !== 'pokemon') return 0;
  const species = content.species[identity.speciesId];
  const types = [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
  return types.some(type => IMPROVEMENTS[kind].crewTypes.includes(type)) ? IMPROVEMENT_WORK.crew : IMPROVEMENT_WORK.other;
}
/** v23: the specialty a builder brings from its escort (primary type), if any. */
export function builderCrew(unit: { kind: string; role?: string; escortId?: SpeciesId } | undefined, content: Content, source: VersionSource): CrewSpecialty | undefined {
  if (!usesImprovementsV23(source) || !unit || unit.kind !== 'logistics' || unit.role !== 'builder' || !unit.escortId) return undefined;
  const species = content.species[unit.escortId];
  return species ? crewSpecialtyFor(species.typeId) : undefined;
}
/** Bonus a completed improvement adds to the tile, for the player working it. */
export function improvementYield(kind: ImprovementId, player: Pick<PlayerState, 'research'>): Yield {
  const definition = IMPROVEMENTS[kind], boosted = definition.boostTech !== undefined && player.research.unlockedIds.includes(definition.boostTech);
  const boost = boosted ? definition.boost! : { food: 0, production: 0, gold: 0, research: 0 };
  return { food: definition.base.food + boost.food, production: definition.base.production + boost.production,
    gold: definition.base.gold + boost.gold, research: definition.base.research + boost.research };
}
/** Whether a crew specialty adds its yield bonus to this improvement. */
export function crewApplies(crew: CrewSpecialty, kind: ImprovementId, biome: string | null | undefined): boolean {
  const kinds = CREW_SPECIALTIES[crew].kinds;
  return kinds === 'ocean' ? biome === 'ocean' : Array.isArray(kinds) && kinds.includes(kind);
}
/** v23: yield of a placed improvement (zero while damaged, plus the crew bonus recorded on the tile). */
export function improvementTileYield(improvement: Pick<TileImprovement, 'kind' | 'crew' | 'damaged'>, biome: string | null | undefined, player: Pick<PlayerState, 'research'>): Yield {
  if (improvement.damaged) return { food: 0, production: 0, gold: 0, research: 0 };
  const result = improvementYield(improvement.kind, player), bonus = improvement.crew && crewApplies(improvement.crew, improvement.kind, biome) ? CREW_SPECIALTIES[improvement.crew].bonus : undefined;
  if (bonus) for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += bonus[key] ?? 0;
  return result;
}
export function tileImprovementYield(state: GameState, tileIndex: number, player: Pick<PlayerState, 'research'>): Yield | null {
  const improvement = state.expansion?.improvements?.tiles[tileIndex];
  if (!improvement) return null;
  return usesImprovementsV23(state) ? improvementTileYield(improvement, state.map.tiles[tileIndex], player) : improvementYield(improvement.kind, player);
}
/** Whether a placed improvement currently works (exists and is not damaged). */
export const improvementIntact = (improvement: Pick<TileImprovement, 'damaged'> | undefined) => improvement !== undefined && !improvement.damaged;
function ownTerritory(cities: readonly Pick<CityState, 'ownerId' | 'position' | 'population'>[], playerId: number, position: Hex, map: MapShape): boolean {
  return cities.some(city => city.ownerId === playerId && hexDistance(city.position, position, map) <= workRadius(city as CityState) && hexDistance(city.position, position, map) > 0);
}
/** v23 inputs to the shared blocker. */
export type ImprovementRulesV23 = { resourceAt: (tileIndex: number) => ImprovementResource | null; unlockedTechIds: readonly string[]; oceanReach: number };
/** v23: the map resource on a tile (world berry bush / stone vein or a rare-berry deposit), from state or view lists. */
export function resourceLookup(resources: readonly { tileIndex: number; kind: 'berry' | 'stone' }[], rareTiles: readonly number[]): (tileIndex: number) => ImprovementResource | null {
  const kinds = new Map<number, ImprovementResource>(resources.map(site => [site.tileIndex, site.kind]));
  for (const index of rareTiles) kinds.set(index, 'rare');
  return index => kinds.get(index) ?? null;
}
export function stateResourceLookup(state: GameState): (tileIndex: number) => ImprovementResource | null {
  return resourceLookup(Object.values(state.expansion?.world.resources ?? {}), Object.keys(state.expansion?.rareBerries?.deposits ?? {}).map(Number));
}
/** Shared by authority, UI and AI. Returns a reason code or null. */
export function improvementBlocker(input: { tiles: readonly (string | null)[]; width: number; height: number; wrap?: boolean; cities: readonly Pick<CityState, 'ownerId' | 'position' | 'population'>[];
  improved: (tileIndex: number) => boolean; unitPosition: Hex; playerId: number; tileIndex: number; kind: ImprovementId; v23?: ImprovementRulesV23 }): string | null {
  const { tileIndex, kind } = input;
  if (!(input.v23 ? IMPROVEMENT_IDS_V23 : IMPROVEMENT_IDS).includes(kind as never)) return 'unknown-improvement';
  const biome = input.tiles[tileIndex];
  if (biome === undefined || biome === null) return 'unknown-tile';
  const position = indexToHex(tileIndex, input), definition = IMPROVEMENTS[kind];
  if (input.v23) {
    const resource = input.v23.resourceAt(tileIndex);
    if (resource ? definition.resource !== resource : definition.resource !== undefined) return resource ? 'resource-needs-match' : 'not-a-resource';
  }
  if (!definition.biomes.includes(biome as never)) return 'wrong-biome';
  if (input.v23 && definition.requiredTech && !input.v23.unlockedTechIds.includes(definition.requiredTech)) return 'improvement-tech-locked';
  const distance = hexDistance(input.unitPosition, position, input);
  if (biome === 'ocean' ? distance > (input.v23?.oceanReach ?? 1) : distance !== 0) return 'not-on-site';
  if (input.cities.some(city => hexDistance(city.position, position, input) === 0)) return 'city-center';
  if (!ownTerritory(input.cities, input.playerId, position, input)) return 'outside-territory';
  if (input.improved(tileIndex)) return 'already-improved';
  return null;
}
/** v23: how far from an ocean tile this builder may build (引水 crews reach 2). */
export const oceanReach = (crew: CrewSpecialty | undefined) => crew === 'irrigation' ? IMPROVEMENT_RULES_V23.irrigationReach : 1;
export function validateImprovementAction(state: GameState, actorId: number, action: ImprovementAction, content?: Content): string | null {
  const improvements = state.expansion?.improvements;
  if (!usesImprovements(state) || !improvements) return 'improvements-unavailable';
  const unit = state.units[action.unitId];
  const worker = usesBuilders(state) ? unit?.kind === 'logistics' && unit.role === 'builder' : unit?.kind === 'pokemon';
  if (!unit || unit.ownerId !== actorId || !isMapUnit(unit) || !worker) return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  if (!Number.isSafeInteger(action.tileIndex) || action.tileIndex < 0 || action.tileIndex >= state.map.tiles.length) return 'unknown-tile';
  if (!visibleTiles(state, actorId).has(action.tileIndex)) return 'unknown-tile';
  if (districtOccupiedTiles(state).has(action.tileIndex)) return 'district-tile-occupied';
  const v23 = usesImprovementsV23(state) && content ? { resourceAt: stateResourceLookup(state), unlockedTechIds: state.players[actorId].research.unlockedIds,
    oceanReach: oceanReach(builderCrew(unit, content, state)) } : undefined;
  return improvementBlocker({ tiles: state.map.tiles, width: state.map.width, height: state.map.height, wrap: state.map.wrap, cities: Object.values(state.cities),
    improved: index => Object.hasOwn(improvements.tiles, index), unitPosition: unit.position, playerId: actorId, tileIndex: action.tileIndex, kind: action.kind, ...(v23 ? { v23 } : {}) });
}
/** Nearest city of a player to a tile (ties: lowest city id). */
export function nearestOwnCity(state: GameState, playerId: number, position: Hex): CityState | undefined {
  return Object.values(state.cities).filter(city => city.ownerId === playerId)
    .sort((a, b) => hexDistance(a.position, position, state.map) - hexDistance(b.position, position, state.map) || a.id - b.id)[0];
}
/** Adds production to a city's next completion (same channel as the engineer phantom, accumulating). */
export function addPendingProduction(state: GameState, playerId: number, cityId: number, amount: number): void {
  const pending = state.expansion!.civilization.pendingProductionByCity, previous = pending[cityId];
  pending[cityId] = { playerId, amount: (previous?.playerId === playerId ? previous.amount : 0) + amount };
}
const stonesFor = (state: GameState, playerId: number) => state.players[playerId].leaderId === 'steven' ? 2 : 1;
export function applyImprovementAction(state: GameState, actorId: number, action: ImprovementAction, content: Content): EventPayload[] {
  const improvements = state.expansion!.improvements!, unit = state.units[action.unitId];
  if (!isMapUnit(unit)) throw new Error('Expected deployed worker');
  unit.actionLeft = 0;
  const previous = improvements.projects[action.tileIndex];
  const base = previous && previous.kind === action.kind && previous.playerId === actorId ? previous.progress : 0;
  const progress = Math.min(IMPROVEMENT_WORK.required, base + crewPoints(unit, content, action.kind) + playerPolicyEffects(state, actorId).workPointBonus + leaderEffects(state.players[actorId].leaderId).workPointBonus);
  const completed = progress >= IMPROVEMENT_WORK.required, crew = builderCrew(unit, content, state);
  const extra: EventPayload[] = [];
  if (completed) {
    delete improvements.projects[action.tileIndex];
    improvements.tiles[action.tileIndex] = { kind: action.kind, builtBy: actorId, builtAtRound: state.round, ...(crew ? { crew } : {}) };
    if (usesImprovementsV23(state)) extra.push(...completeV23(state, actorId, action.tileIndex, action.kind, crew));
  } else improvements.projects[action.tileIndex] = { kind: action.kind, playerId: actorId, progress };
  // v18 builders spend a charge per improvement and are used up after the last one.
  if (unit.kind === 'logistics' && unit.role === 'builder') {
    unit.charges = (unit.charges ?? 1) - 1;
    if (unit.charges <= 0) delete state.units[unit.id];
  }
  return [{ type: 'TileWorked', playerId: actorId, unitId: unit.id, tileIndex: action.tileIndex, position: indexToHex(action.tileIndex, state.map),
    kind: action.kind, progress, required: IMPROVEMENT_WORK.required, completed, ...(crew ? { crew } : {}) }, ...extra];
}
/** v23 completion effects: a quarry takes the vein's stone at once; a 开荒 crew adds production to the nearest own city. */
function completeV23(state: GameState, playerId: number, tileIndex: number, kind: ImprovementId, crew: CrewSpecialty | undefined): EventPayload[] {
  const events: EventPayload[] = [], position = indexToHex(tileIndex, state.map);
  const site = state.expansion!.world.resources[tileIndex];
  if (kind === 'stoneQuarry' && site?.kind === 'stone' && site.remaining > 0) {
    site.remaining = 0;
    events.push(grantStone(state, playerId, tileIndex, site.definitionId as StoneId));
  }
  if (crew === 'clearing') {
    const city = nearestOwnCity(state, playerId, position);
    if (city) {
      addPendingProduction(state, playerId, city.id, IMPROVEMENT_RULES_V23.clearingProduction);
      events.push({ type: 'CrewClearing', playerId, cityId: city.id, tileIndex, amount: IMPROVEMENT_RULES_V23.clearingProduction });
    }
  }
  return events;
}
function grantStone(state: GameState, playerId: number, tileIndex: number, stoneId: StoneId): EventPayload {
  const amount = stonesFor(state, playerId), inventory = state.expansion!.world.players[playerId]?.stoneInventory;
  if (inventory) inventory[stoneId] += amount;
  return { type: 'StoneQuarried', playerId, tileIndex, position: indexToHex(tileIndex, state.map), stoneId, amount };
}
/** v23: worked, intact improvements per owner (city order, then tile order). */
function workedIntact(state: GameState, kind: ImprovementId): { ownerId: number; tileIndex: number; improvement: TileImprovement }[] {
  const tiles = state.expansion?.improvements?.tiles ?? {};
  return Object.values(state.cities).filter(city => city.ownerId !== null).sort((a, b) => a.id - b.id)
    .flatMap(city => [...city.workedTileIds].sort((a, b) => a - b).flatMap(tileIndex => tiles[tileIndex]?.kind === kind && !tiles[tileIndex].damaged
      ? [{ ownerId: city.ownerId!, tileIndex, improvement: tiles[tileIndex] }] : []));
}
/** v23: berry kinds a player develops with worked, intact 树果林. */
export function developedBerryKinds(state: GameState, playerId: number): BerryId[] {
  const resources = state.expansion?.world.resources ?? {};
  return [...new Set(workedIntact(state, 'berryGrove').filter(item => item.ownerId === playerId)
    .map(item => resources[item.tileIndex]?.definitionId as BerryId).filter(Boolean))].sort();
}
/** v23 round end: grove satisfaction and quarry cycles. No-op (and no state access) before v23. */
export function resolveImprovementRound(state: GameState): EventPayload[] {
  if (!usesImprovementsV23(state) || !state.expansion?.improvements) return [];
  const events: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const world = state.expansion.world.players[playerId];
    if (!world || state.players[playerId].eliminated) continue;
    const kinds = developedBerryKinds(state, playerId).length;
    if (kinds) world.satisfaction = Math.min(100, world.satisfaction + kinds * IMPROVEMENT_RULES_V23.groveSatisfactionPerKind);
  }
  for (const { ownerId, tileIndex, improvement } of workedIntact(state, 'stoneQuarry')) {
    const site = state.expansion.world.resources[tileIndex], since = improvement.repairedAtRound ?? improvement.builtAtRound;
    if (site?.kind !== 'stone' || state.round <= since || (state.round - since) % IMPROVEMENT_RULES_V23.quarryInterval !== 0) continue;
    events.push(grantStone(state, ownerId, tileIndex, site.definitionId as StoneId));
  }
  return events;
}
/** v23: founding a city on an unharvested stone vein takes its stone (the centre can be neither harvested nor improved). */
export function foundCityOnResource(state: GameState, playerId: number, position: Hex): EventPayload[] {
  if (!usesImprovementsV23(state) || !state.expansion) return [];
  const tileIndex = hexToIndex(position, state.map)!, site = state.expansion.world.resources[tileIndex];
  if (site?.kind !== 'stone' || site.remaining <= 0) return [];
  site.remaining = 0;
  return [grantStone(state, playerId, tileIndex, site.definitionId as StoneId)];
}
/** Completed improvements are public map features once seen; projects are private to their builder. */
export function observeImprovements(state: GameState, playerId: number, visible: ReadonlySet<number>): ImprovementView | undefined {
  const improvements = state.expansion?.improvements;
  if (!improvements) return undefined;
  const remembered = state.knowledge[playerId]?.rememberedTiles ?? {};
  const projects = Object.entries(improvements.projects).map(([index, value]) => ({ ...value, tileIndex: Number(index) }))
    .filter(project => project.playerId === playerId).sort((a, b) => a.tileIndex - b.tileIndex);
  if (usesImprovementsV23(state)) {
    // v23: live facts on visible tiles and in your own territory; elsewhere the improvement as you last saw it.
    const own = Object.values(state.cities).filter(city => city.ownerId === playerId);
    const live = (index: number) => visible.has(index) || own.some(city => hexDistance(city.position, indexToHex(index, state.map), state.map) <= workRadius(city));
    const indices = [...new Set([...Object.keys(improvements.tiles), ...Object.keys(remembered)].map(Number))].sort((a, b) => a - b);
    return { projects, tiles: indices.flatMap(index => {
      const value = live(index) ? improvements.tiles[index] : remembered[index]?.improvement;
      return value ? [{ ...JSON.parse(JSON.stringify(value)) as TileImprovement, tileIndex: index, position: indexToHex(index, state.map) }] : [];
    }) };
  }
  return {
    tiles: Object.entries(improvements.tiles).map(([index, value]) => ({ index: Number(index), value }))
      .filter(({ index }) => visible.has(index) || Object.hasOwn(remembered, index))
      .sort((a, b) => a.index - b.index)
      .map(({ index, value }) => ({ ...value, tileIndex: index, position: indexToHex(index, state.map) })),
    projects: Object.entries(improvements.projects).map(([index, value]) => ({ ...value, tileIndex: Number(index) }))
      .filter(project => project.playerId === playerId).sort((a, b) => a.tileIndex - b.tileIndex),
  };
}
/** v23 blocker inputs from a player's own observation. */
export function viewImprovementRules(view: PlayerView, unit: Pick<MapUnit, 'kind'> & { role?: string; escortId?: SpeciesId } | undefined, content: Content): ImprovementRulesV23 | undefined {
  if (!usesImprovementsV23(view)) return undefined;
  return { resourceAt: resourceLookup(view.expansion?.world.resources ?? [], (view.expansion?.rareBerries?.deposits ?? []).map(item => item.tileIndex)),
    unlockedTechIds: view.economy.player.research.unlockedIds, oceanReach: oceanReach(builderCrew(unit as never, content, view)) };
}
/** Improvement choices available to a unit from its own observation (used by UI and AI). */
export function improvementOptions(view: PlayerView, unitId: number, content: Content): { tileIndex: number; kind: ImprovementId; points: number; progress: number }[] {
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  const improvements = view.expansion?.improvements;
  const worker = usesBuilders(view) ? unit?.kind === 'logistics' && unit.role === 'builder' : unit?.kind === 'pokemon';
  if (!unit || !worker || !unit.actionLeft || !improvements) return [];
  const improved = new Set([...improvements.tiles.map(tile => tile.tileIndex),
    ...(view.expansion?.districts?.tiles.map(tile => tile.tileIndex) ?? []), ...(view.expansion?.districts?.projects.map(tile => tile.tileIndex) ?? []),
    ...(view.expansion?.districts?.constructionSites?.filter(site => site.category === 'district').map(site => site.tileIndex) ?? [])]), visible = new Set(view.visibleTileIds);
  const v23 = viewImprovementRules(view, unit, content), reach = v23?.oceanReach ?? 1;
  const here = hexToIndex(unit.position, view.map)!;
  const nearby = [here, ...view.map.tiles.flatMap((_, index) => {
    const distance = index === here ? 0 : hexDistance(indexToHex(index, view.map), unit.position, view.map);
    return distance >= 1 && distance <= reach ? [index] : [];
  })];
  return nearby.filter(index => visible.has(index)).flatMap(tileIndex => improvementIdsFor(view).flatMap(kind => improvementBlocker({ tiles: view.map.tiles, width: view.map.width, height: view.map.height, wrap: view.map.wrap,
    cities: [...view.economy.cities.map(city => ({ ownerId: city.ownerId, position: city.position, population: city.population })),
      ...view.cities.filter(city => city.ownerId !== view.playerId).map(city => ({ ownerId: city.ownerId, position: city.position, population: 1 }))],
    improved: index => improved.has(index), unitPosition: unit.position, playerId: view.playerId, tileIndex, kind, ...(v23 ? { v23 } : {}) }) === null
    ? [{ tileIndex, kind, points: crewPoints(unit, content, kind), progress: improvements.projects.find(project => project.tileIndex === tileIndex && project.kind === kind)?.progress ?? 0 }] : []));
}
