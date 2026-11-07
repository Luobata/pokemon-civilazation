// Gameplay v21 opening pace: objectives, item balls, city healing and walls. All no-ops without `state.expansion.opening`.
import { ITEM_BALLS, ITEM_BALL_KINDS, OBJECTIVES, OBJECTIVE_IDS, OPENING_RULES } from '../content/opening.ts';
import type { ItemBallKind, ObjectiveId } from '../content/opening.ts';
import { contentFor } from '../content/units.ts';
import { stableSeed } from './civilization-systems.ts';
import { maxCityHp } from './city.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState } from './model.ts';

/** `seen`: per player, the item-ball tiles they last saw holding a ball (fog memory, like lastKnownCities). */
export type OpeningState = { objectives: Record<number, ObjectiveId[]>; itemBalls: Record<number, ItemBallKind>; seen: Record<number, number[]> };
/** What a ball holds stays hidden until it is picked up. */
export type OpeningView = { objectives: ObjectiveId[]; itemBalls: { tileIndex: number }[] };
export type OpeningEvent =
  | { type: 'ObjectiveCompleted'; playerId: number; objectiveId: ObjectiveId }
  | { type: 'ItemBallClaimed'; playerId: number; tileIndex: number; kind: ItemBallKind; unitId: number };

export const usesOpening = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && (state.setup.gameplayVersion ?? 0) >= 21;

/** Item balls are placed with a stable hash, never `state.rng`, so the world matches v20 for the same seed. */
export function initializeOpening(state: GameState): void {
  if (!usesOpening(state)) return;
  const world = state.expansion!.world;
  const taken = new Set<number>([...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!),
    ...Object.values(world.nests).map(site => site.tileIndex), ...Object.values(world.overlords).map(site => site.tileIndex),
    ...Object.values(world.resources).map(site => site.tileIndex), ...Object.keys(state.expansion!.rareBerries?.deposits ?? {}).map(Number),
    ...state.expansion!.civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!),
    ...Object.values(state.expansion!.legends?.sites ?? {}) as number[]]);
  const land = state.map.tiles.map((biome, index) => ({ biome, index })).filter(tile => tile.biome !== 'ocean');
  const count = Math.max(3, Math.floor(land.length / OPENING_RULES.landTilesPerBall));
  const starts = Object.values(state.cities).map(city => city.position);
  const order = land.map(tile => tile.index).sort((a, b) => stableSeed(state.setup.seed, a, 'item-ball') - stableSeed(state.setup.seed, b, 'item-ball') || a - b);
  const itemBalls: Record<number, ItemBallKind> = {};
  for (const index of order) {
    if (Object.keys(itemBalls).length >= count) break;
    const hex = indexToHex(index, state.map);
    if (taken.has(index) || neighbors(hex, state.map).some(next => hexToIndex(next, state.map) === null)) continue;
    if (starts.some(start => hexDistance(start, hex, state.map) < OPENING_RULES.ballCityDistance)) continue;
    if (Object.keys(itemBalls).some(other => hexDistance(indexToHex(Number(other), state.map), hex, state.map) < OPENING_RULES.ballSpacing)) continue;
    itemBalls[index] = ITEM_BALL_KINDS[stableSeed(state.setup.seed, index, 'item-ball-kind') % ITEM_BALL_KINDS.length];
  }
  state.expansion!.opening = { objectives: Object.fromEntries(state.turnOrder.map(id => [id, []])), itemBalls, seen: Object.fromEntries(state.turnOrder.map(id => [id, []])) };
}

function reached(state: GameState, playerId: number, id: ObjectiveId, events: readonly EventPayload[]): boolean {
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId), exp = state.expansion!;
  switch (id) {
    case 'firstTech': return state.players[playerId].research.unlockedIds.length >= 1;
    case 'secondCity': return cities.length >= 2;
    case 'thirdCity': return cities.length >= 3;
    case 'firstImprovement': return Object.values(exp.improvements?.tiles ?? {}).some(tile => tile.builtBy === playerId);
    case 'firstCapture': return events.some(event => event.type === 'Captured' && event.playerId === playerId && event.success);
    case 'firstBuilding': return cities.some(city => city.buildingIds.some(building => building !== 'headquarters'));
    case 'firstDistrict': return Object.values(exp.districts?.tiles ?? {}).some(tile => state.cities[tile.cityId]?.ownerId === playerId);
    case 'firstEvolution': return events.some(event => (event.type === 'Evolved' || event.type === 'WorldStoneEvolution') && event.playerId === playerId);
  }
}
/** Per command, after the other systems: completes objectives and picks up item balls. */
export function recordOpening(state: GameState, events: readonly EventPayload[]): EventPayload[] {
  const ledger = state.expansion?.opening;
  if (!ledger || state.outcome) return [];
  const output: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const player = state.players[playerId];
    if (player.eliminated) continue;
    const done = ledger.objectives[playerId] ??= [];
    for (const id of OBJECTIVE_IDS) {
      if (done.includes(id) || !reached(state, playerId, id, events)) continue;
      done.push(id);
      const reward = OBJECTIVES[id].reward;
      player.gold += reward.gold ?? 0; player.research.reserve += reward.research ?? 0; player.ballInventory.pokeBall += reward.pokeBalls ?? 0;
      output.push({ type: 'ObjectiveCompleted', playerId, objectiveId: id });
    }
  }
  for (const unit of Object.values(state.units).filter(isMapUnit).sort((a, b) => a.id - b.id)) {
    if (unit.ownerId === null) continue;
    const index = hexToIndex(unit.position, state.map)!, kind = ledger.itemBalls[index];
    if (!kind) continue;
    delete ledger.itemBalls[index];
    const player = state.players[unit.ownerId], amount = ITEM_BALLS[kind].amount;
    if (kind === 'gold') player.gold += amount;
    else if (kind === 'research') player.research.reserve += amount;
    else if (kind === 'balls') player.ballInventory.pokeBall += amount;
    else if (kind === 'food') {
      const city = Object.values(state.cities).filter(item => item.ownerId === unit.ownerId)
        .sort((a, b) => hexDistance(a.position, unit.position, state.map) - hexDistance(b.position, unit.position, state.map) || a.id - b.id)[0];
      if (city) city.food += amount;
    } else if (unit.kind === 'pokemon') unit.xp += amount;
    else player.gold += 15;
    output.push({ type: 'ItemBallClaimed', playerId: unit.ownerId, tileIndex: index, kind, unitId: unit.id });
  }
  return output;
}
/** Round end: cities heal. */
export function resolveOpeningRound(state: GameState): EventPayload[] {
  if (!state.expansion?.opening) return [];
  const content = contentFor(state.setup);
  for (const city of Object.values(state.cities)) if (city.ownerId !== null) city.hp = Math.min(maxCityHp(city, content), city.hp + OPENING_RULES.cityHealing);
  return [];
}
/** City walls: defense strength grows with the round (public knowledge). */
export const wallBonus = (round: number, capital = false) => Math.min(OPENING_RULES.wallMax, Math.floor(round / OPENING_RULES.wallRounds) * OPENING_RULES.wallStep) + (capital ? OPENING_RULES.capitalDefense : 0);

/** Called by refreshKnowledge: tiles in sight overwrite the memory (a ball there, or none any more). */
export function rememberOpening(state: GameState, playerId: number, visible: ReadonlySet<number>): void {
  const ledger = state.expansion?.opening;
  if (!ledger) return;
  const seen = new Set(ledger.seen[playerId] ?? []);
  for (const tile of visible) { if (ledger.itemBalls[tile]) seen.add(tile); else seen.delete(tile); }
  ledger.seen[playerId] = [...seen].sort((a, b) => a - b);
}
/** Tiles in sight show the truth; fogged tiles show what the player last saw there, so a rival's pickup out of sight stays hidden. */
export function observeOpening(state: GameState, playerId: number, visible: ReadonlySet<number>): OpeningView | undefined {
  const ledger = state.expansion?.opening;
  if (!ledger) return undefined;
  const tiles = new Set([...Object.keys(ledger.itemBalls).map(Number).filter(tile => visible.has(tile)), ...(ledger.seen[playerId] ?? []).filter(tile => !visible.has(tile))]);
  return { objectives: [...(ledger.objectives[playerId] ?? [])], itemBalls: [...tiles].sort((a, b) => a - b).map(tileIndex => ({ tileIndex })) };
}
