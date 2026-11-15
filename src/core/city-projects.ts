// Gameplay v27 ③ (docs/design/pace-v27.md §4, option 3A): repeatable city projects — hatch an egg, gym drill, field report, contest
// rehearsal, festival — costing base × (100 + 20 × completions) / 100 (completions of the same project by the civilization), buyable
// with RushProduction (4 gold per production point, like a building). At most one project per city queue; the requirement is checked
// when the project is queued (one rule for the authority, the panels and the AI: `cityProjectBlocker`). On completion:
// - hatchEgg (花园): a stage-1 Pokémon of a registered species beside the city (the species the civilization has fewest of, then by id),
//   50 XP; never a new Pokédex record. Without a free tile it waits like a trained Pokémon.
// - gymDrill (宝可梦中心 or 道馆区): +20 XP to at most 6 own Pokémon in or next to the city (lowest ids first).
// - fieldReport (研究所区; not once every technology is researched): +35 science into the research reserve (the current topic takes it
//   at this round's research step).
// - contestRehearsal (华丽大赛馆): +15 appeal, and +10 season score for the civilization's next contest entry (once per season: the
//   season under way, or the next one when this season's entry is already in).
// - festival (any city): +10 satisfaction, and +1 era score at most once per 10 rounds.
// Integers only; no `state.rng`. The ledger is created at the first completion; the view carries the viewer's own counts.
import { CITY_PROJECT_IDS, cityProjectCost, economyTuning } from '../content/pace-v27.ts';
import type { CityProjectId } from '../content/pace-v27.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { DistrictId } from '../content/districts.ts';
import { currentSeason } from './contest-seasons.ts';
import { hexDistance, hexToIndex, neighbors } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EconomyEvent, GameState, PlayerView, ProductionOrder } from './model.ts';
import { besideStrikingWild, canEnterTile } from './movement.ts';
import { placementBlocked } from './stacking.ts';
import { createMapUnit } from './unit.ts';
import { wanderersFor } from '../content/roster.ts';

export type CityProjectState = {
  /** Per civilization: completions of each project (they raise the next one's cost). */
  done: Record<number, Partial<Record<CityProjectId, number>>>;
  /** Per civilization: the contest season (index) its rehearsal bonus is for. */
  rehearsal: Record<number, number>;
  /** Per civilization: the round of the festival's latest era-score point. */
  festival: Record<number, number>;
  /** ④ legend trail (src/core/legend-favor.ts): city id -> production carried to the city's next legend. */
  legendTrail: Record<number, number>;
};
/** The viewer's own counts, rehearsal season, festival round and legend trails (own cities only). */
export type CityProjectView = { done: Partial<Record<CityProjectId, number>>; rehearsalSeason: number | null; festivalRound: number | null;
  legendTrail: Record<number, number> };
export type CityProjectEffects = { unitId?: number; speciesId?: SpeciesId; waiting?: true; xp?: number; unitIds?: number[]; science?: number;
  appeal?: number; seasonScore?: number; satisfaction?: number; eraScore?: number };
/** Private to the city's owner (a hatched Pokémon is then visible on the map as usual). */
export type CityProjectEvent = { type: 'CityProjectCompleted'; playerId: number; cityId: number; orderId: number; projectId: CityProjectId;
  /** The n-th completion of this project by the civilization. */
  nth: number; cost: number; effects: CityProjectEffects };

export type CityProjectBlocker = 'unavailable' | 'queued' | 'garden' | 'gym' | 'research-district' | 'research-done' | 'hall' | 'no-egg';
export const CITY_PROJECT_BLOCKER_TEXT: Record<CityProjectBlocker, string> = {
  unavailable: '本局没有城市计划', queued: '这座城的队列里已经有一个计划（每城同时 1 个）',
  garden: '需要这座城建成花园', gym: '需要这座城有宝可梦中心或道馆区', 'research-district': '需要这座城建成研究所区',
  'research-done': '所有科技都已研究完成', hall: '需要这座城有华丽大赛馆', 'no-egg': '还没有登记过一阶宝可梦',
};
/** What the shared rule reads, built from the state (authority) or the view (panels, AI). */
export type CityProjectInput = { enabled: boolean; queue: readonly Pick<ProductionOrder, 'item'>[]; buildingIds: readonly string[];
  districts: readonly DistrictId[]; hall: boolean; hatchable: boolean; researchLeft: boolean };

/** Why this city cannot queue the project now (null = it can). `ignoreQueue`: the queue's own project does not count (re-validating it). */
export function cityProjectBlocker(input: CityProjectInput, id: CityProjectId, ignoreQueue = false): CityProjectBlocker | null {
  if (!input.enabled || !CITY_PROJECT_IDS.includes(id)) return 'unavailable';
  if (!ignoreQueue && input.queue.some(order => order.item.kind === 'project')) return 'queued';
  if (id === 'hatchEgg') return !input.districts.includes('gardenDistrict') ? 'garden' : input.hatchable ? null : 'no-egg';
  if (id === 'gymDrill') return input.buildingIds.includes('trainingGround') || input.districts.includes('gymDistrict') ? null : 'gym';
  if (id === 'fieldReport') return !input.districts.includes('researchDistrict') ? 'research-district' : input.researchLeft ? null : 'research-done';
  if (id === 'contestRehearsal') return input.hall ? null : 'hall';
  return null;
}
/** Registered stage-1 species (the hatch pool), sorted by id. */
const hatchPool = (registered: readonly SpeciesId[], content: Content): SpeciesId[] =>
  registered.filter(id => content.species[id]?.stage === 1 && Object.hasOwn(content.units, id)).sort();
const researchLeft = (unlocked: readonly string[], content: Content) => Object.keys(content.techs).some(id => !unlocked.includes(id));

export function stateCityProjectInput(state: GameState, city: CityState, content: Content): CityProjectInput {
  const owner = city.ownerId, player = owner === null ? undefined : state.players[owner];
  return { enabled: Boolean(content.cityProjects && player), queue: city.queue, buildingIds: city.buildingIds,
    districts: Object.values(state.expansion?.districts?.tiles ?? {}).filter(item => item.cityId === city.id).map(item => item.kind),
    hall: owner !== null && Boolean(state.expansion?.contests?.[owner]?.halls.includes(city.id)),
    hatchable: Boolean(player && hatchPool(player.registeredSpeciesIds, content).length),
    researchLeft: Boolean(player && researchLeft(player.research.unlockedIds, content)) };
}
export function viewCityProjectInput(view: PlayerView, city: PlayerView['economy']['cities'][number], content: Content): CityProjectInput {
  const player = view.economy.player;
  return { enabled: Boolean(content.cityProjects && !player.eliminated), queue: city.queue, buildingIds: city.buildingIds,
    districts: (view.expansion?.districts?.tiles ?? []).filter(item => item.cityId === city.id && item.ownerId === view.playerId).map(item => item.kind),
    hall: Boolean(view.expansion?.contests?.own.halls.includes(city.id)),
    hatchable: hatchPool(player.registeredSpeciesIds, content).length > 0, researchLeft: researchLeft(player.research.unlockedIds, content) };
}
/** The civilization's completions per project (empty before the first one, and before v27). */
export const stateProjectsDone = (state: GameState, playerId: number): Partial<Record<CityProjectId, number>> => state.expansion?.cityProjects?.done[playerId] ?? {};
export const viewProjectsDone = (view: PlayerView): Partial<Record<CityProjectId, number>> => view.expansion?.cityProjects?.done ?? {};
/** The cost of the viewer's next project `id` (the authority uses `productionCost` with `stateProjectsDone`: the same function). */
export const projectCost = (view: PlayerView, id: CityProjectId, content: Content): number => cityProjectCost(content, id, viewProjectsDone(view)[id] ?? 0);

function ledger(state: GameState): CityProjectState {
  return state.expansion!.cityProjects ??= { done: {}, rehearsal: {}, festival: {}, legendTrail: {} };
}
/** The hatched species: the registered stage-1 species the civilization has fewest of (map and recovering), then by id. */
export function hatchSpecies(state: GameState, playerId: number, content: Content): SpeciesId | null {
  const counts = new Map<string, number>();
  for (const unit of Object.values(state.units)) if (unit.ownerId === playerId && unit.kind === 'pokemon') counts.set(unit.speciesId, (counts.get(unit.speciesId) ?? 0) + 1);
  return hatchPool(state.players[playerId].registeredSpeciesIds, content).sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || (a < b ? -1 : 1))[0] ?? null;
}
/** The tile a new Pokémon of `speciesId` appears on beside the city (the same choice as a trained one), null without room. */
function hatchTile(state: GameState, city: CityState & { ownerId: number }, speciesId: SpeciesId, content: Content): Hex | null {
  const identity = { kind: 'pokemon' as const, speciesId };
  const occupied = new Set([...placementBlocked(state, identity, city.ownerId, content), ...Object.values(state.cities).map(entity => hexToIndex(entity.position, state.map))]);
  const free = neighbors(city.position, state.map).filter(hex => {
    const index = hexToIndex(hex, state.map);
    return index !== null && !occupied.has(index) && canEnterTile(identity, state.map, index, content);
  }).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
  const units = Object.values(state.units).filter(isMapUnit);
  return free.find(hex => !besideStrikingWild(units, hex, state.map, wanderersFor(content))) ?? free[0] ?? null;
}

/** Completes a finished project order (the order has already left the queue); null when the order is not a project. */
export function completeCityProject(state: GameState, city: CityState & { ownerId: number }, order: ProductionOrder, content: Content): EconomyEvent[] | null {
  if (!content.cityProjects || order.item.kind !== 'project') return null;
  const tuning = economyTuning(content), book = ledger(state), owner = city.ownerId, id = order.item.defId;
  const done = book.done[owner] ??= {}, cost = cityProjectCost(content, id, done[id] ?? 0);
  done[id] = (done[id] ?? 0) + 1;
  const effects: CityProjectEffects = {};
  if (id === 'hatchEgg') {
    const speciesId = hatchSpecies(state, owner, content);
    if (speciesId) {
      const tile = hatchTile(state, city, speciesId, content);
      effects.speciesId = speciesId; effects.xp = tuning.hatchXp;
      if (tile) {
        const unitId = state.nextEntityId++;
        state.units[unitId] = createMapUnit({ kind: 'pokemon', speciesId }, unitId, owner, tile, content, tuning.hatchXp);
        effects.unitId = unitId;
      } else {
        city.pendingDeployments.push({ enteredAtRound: state.round, sourceOrderId: order.id, item: { kind: 'pokemon', defId: speciesId } });
        effects.waiting = true;
      }
    }
  } else if (id === 'gymDrill') {
    const units = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === owner && unit.kind === 'pokemon' && hexDistance(unit.position, city.position, state.map) <= 1)
      .sort((a, b) => a.id - b.id).slice(0, tuning.drillUnits);
    for (const unit of units) unit.xp += tuning.drillXp;
    effects.xp = tuning.drillXp; effects.unitIds = units.map(unit => unit.id);
  } else if (id === 'fieldReport') {
    state.players[owner].research.reserve += tuning.reportScience;
    effects.science = tuning.reportScience;
  } else if (id === 'contestRehearsal') {
    const contests = state.expansion?.contests?.[owner];
    if (contests) { contests.appeal += tuning.rehearsalAppeal; effects.appeal = tuning.rehearsalAppeal; }
    const season = currentSeason(content, state.round, state.setup.roundLimit ?? 100);
    const target = season && state.expansion?.contestSeasons?.entries[owner] ? season.index + 1 : season?.index;
    if (target !== undefined && book.rehearsal[owner] !== target) { book.rehearsal[owner] = target; effects.seasonScore = tuning.rehearsalScore; }
  } else {
    const world = state.expansion?.world.players[owner];
    if (world) { world.satisfaction = Math.min(100, world.satisfaction + tuning.festivalSatisfaction); effects.satisfaction = tuning.festivalSatisfaction; }
    const last = book.festival[owner];
    if (last === undefined || state.round - last >= tuning.festivalEraInterval) { book.festival[owner] = state.round; effects.eraScore = 1; }
  }
  const event: CityProjectEvent = { type: 'CityProjectCompleted', playerId: owner, cityId: city.id, orderId: order.id, projectId: id, nth: done[id]!, cost, effects };
  return [event as unknown as EconomyEvent];
}

/** ③ → ⑦ (`seasonScoreBonus`): the rehearsal's season score for this civilization's entry in the season now open (0 without one). */
export function rehearsalScoreBonus(state: GameState, playerId: number, content: Content): number {
  if (!content.cityProjects) return 0;
  const target = state.expansion?.cityProjects?.rehearsal[playerId], season = currentSeason(content, state.round, state.setup.roundLimit ?? 100);
  return target !== undefined && season?.index === target ? economyTuning(content).rehearsalScore : 0;
}
export function observeCityProjects(state: GameState, playerId: number): CityProjectView {
  const book = state.expansion?.cityProjects;
  const trail = Object.entries(book?.legendTrail ?? {}).filter(([cityId]) => state.cities[Number(cityId)]?.ownerId === playerId);
  return { done: { ...book?.done[playerId] }, rehearsalSeason: book?.rehearsal[playerId] ?? null, festivalRound: book?.festival[playerId] ?? null,
    legendTrail: Object.fromEntries(trail) };
}
/** ④ legend trail: stores production carried to this city's next legend (adds to an earlier trail). */
export function addLegendTrail(state: GameState, cityId: number, amount: number): void {
  if (amount > 0) ledger(state).legendTrail[cityId] = (ledger(state).legendTrail[cityId] ?? 0) + amount;
}
/** ④ legend trail: the carried production a newly queued legend in this city starts with (consumed; 0 without one). */
export function takeLegendTrail(state: GameState, cityId: number): number {
  const book = state.expansion?.cityProjects, amount = book?.legendTrail[cityId] ?? 0;
  if (amount) delete book!.legendTrail[cityId];
  return amount;
}
