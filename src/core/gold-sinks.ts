// Gameplay v26 D (docs/design/depth-v26.md §5.1, option 4A): gold sinks.
// - RushProduction: pay gold for the production left on a city's current item (Civilization VI's purchase): 4 gold per point for a
//   building, 3 for a Pokémon or a logistics unit; legends and districts cannot be bought; once per city per round. The order is
//   filled now and completes at the round end with the normal production (whose own output carries over to the next item).
// - RushRecovery (Pokémon Center): a recovering Pokémon returns at once beside its city, 15 gold per round left (at most 45), at the
//   usual 25% HP and without an action this round.
// - SpecialTraining: a Pokémon in or next to an own city with a 宝可梦中心 (training ground) pays 40 gold for +40 XP; spends its action;
//   once per 8 rounds per Pokémon.
// - TeachMove (TMs): one extra battle-only type per Pokémon (`taughtMoveType`, read by the team battles and contest seasons), of an
//   essence the civilization holds a badge of; 60 gold (100 for a final stage), replaceable at full price. Every circuit badge won
//   gives one free TM of that gym's type.
// Each command has one blocker shared by the authority, the panels and the AI (`goldSinkQuote`), so preview = resolution.
import { TYPE_ESSENCE } from '../content/essences.ts';
import { lateTuning } from '../content/depth-v26.ts';
import { leaderEffects } from '../content/leaders.ts';
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { stateBadges, viewBadges } from './unit-classes.ts';
import { productionCost } from './city.ts';
import { hexDistance, hexToIndex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CityState, Diplomacy, EventPayload, GameState, PlayerState, PlayerView, ProductionOrder, UnitState } from './model.ts';
import { canEnterTile } from './movement.ts';
import { playerPolicyEffects, viewPolicyEffects } from './policies.ts';
import { placementBlocked } from './stacking.ts';
import { createMapUnit, maxUnitHp } from './unit.ts';
import { unitIdentity } from './vision.ts';
import type { GymCircuitView } from './gym-circuit.ts';

export type GoldSinkAction =
  | { type: 'RushProduction'; cityId: number }
  | { type: 'RushRecovery'; unitId: number }
  | { type: 'SpecialTraining'; unitId: number }
  | { type: 'TeachMove'; unitId: number; typeId: TypeId };
export type GoldSinkKind = GoldSinkAction['type'];
/**
 * `trainedAt`: per player, the round of each unit's last special training; `moves`: unit id -> the TM type it carries (battle layer only);
 * `rushedAt`: city id -> the round it was last rushed; `freeUsed`: per player, the free (badge) TMs already taught; `spent`: per player,
 * gold spent on each sink (telemetry and the economy panel).
 */
export type GoldSinkState = { trainedAt: Record<number, Record<number, number>>; moves: Record<number, TypeId>; rushedAt: Record<number, number>;
  freeUsed: Record<number, TypeId[]>; spent: Record<number, Partial<Record<GoldSinkKind, number>>> };
/** The viewer's own: TM types of its units, special-training rounds, cities rushed this round, free TMs left, gold spent per sink. */
export type GoldSinkView = { moves: Record<number, TypeId>; trainedAt: Record<number, number>; rushedCityIds: number[]; freeTms: TypeId[];
  spent: Partial<Record<GoldSinkKind, number>> };
export type GoldSinkEvent = { type: 'GoldSinkUsed'; playerId: number; kind: GoldSinkKind; gold: number; cityId?: number; unitId?: number; typeId?: TypeId; free?: true };
const TYPES = ['RushProduction', 'RushRecovery', 'SpecialTraining', 'TeachMove'] as const;
export const isGoldSinkAction = (action: { type: unknown }): action is GoldSinkAction => (TYPES as readonly unknown[]).includes(action.type);

// ---------- shared rules (state and view) ----------
const atWarWith = (diplomacy: readonly Diplomacy[], playerId: number) => diplomacy.some(pair => pair.status === 'war' && (pair.a === playerId || pair.b === playerId));
/** Gold to finish `order` now (null = it cannot be bought: legends, districts, already complete). */
export function rushGold(order: ProductionOrder | undefined, content: Content, player: Pick<PlayerState, 'leaderId'>, trainingDiscountPercent: number, atWar: boolean): number | null {
  if (!order || order.item.kind === 'legend' || order.item.kind === 'district') return null;
  const tuning = lateTuning(content);
  const cost = productionCost(order.item, content, trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent), left = cost - order.progress;
  if (left <= 0) return null;
  const rate = order.item.kind === 'building' ? tuning.rushBuildingGold : tuning.rushUnitGold;
  return Math.max(1, Math.ceil(left * rate * (atWar ? tuning.rushWarPercent : 100) / 100));
}
export const recoveryGold = (roundsLeft: number, content: Content) => Math.min(lateTuning(content).recoveryMaxGold, lateTuning(content).recoveryGold * roundsLeft);
export const tmGold = (stage: number, content: Content) => stage >= 3 ? lateTuning(content).tmFinalGold : lateTuning(content).tmGold;
/** Free TMs left: one per circuit badge, of that gym's type, minus those already taught. */
export function freeTmsLeft(circuit: Pick<GymCircuitView, 'gyms' | 'badges'> | undefined, playerId: number, used: readonly TypeId[]): TypeId[] {
  const left = (circuit?.badges[playerId] ?? []).map(id => circuit!.gyms.find(gym => gym.id === id)?.typeId).filter((type): type is TypeId => type !== undefined);
  for (const type of used) { const at = left.indexOf(type); if (at >= 0) left.splice(at, 1); }
  return left.sort();
}
type TrainingCity = { position: { q: number; r: number }; buildingIds: readonly string[] };
const nearTrainingGround = (cities: readonly TrainingCity[], position: { q: number; r: number }, map: { width: number; height: number; wrap?: boolean }) =>
  cities.some(city => city.buildingIds.includes('trainingGround') && hexDistance(city.position, position, map) <= 1);
const nearestFreeTile = (state: GameState, unit: UnitState, city: CityState, content: Content) => {
  const blocked = new Set([...placementBlocked(state, unit, unit.ownerId!, content), ...Object.values(state.cities).map(other => hexToIndex(other.position, state.map)!)]);
  return neighbors(city.position, state.map).filter(hex => { const index = hexToIndex(hex, state.map); return index !== null && !blocked.has(index) && canEnterTile(unit, state.map, index, content); })
    .sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
};
export type GoldSinkQuote = { ok: true; gold: number; free?: true } | { ok: false; reason: string };

/** Authority: price or refusal of one gold-sink command. */
export function goldSinkQuote(state: GameState, actorId: number, action: GoldSinkAction, content: Content): GoldSinkQuote {
  const ledger = state.expansion?.goldSinks, player = state.players[actorId];
  if (!content.goldSinks || !ledger || !player || player.eliminated) return { ok: false, reason: 'gold-sinks-unavailable' };
  const fail = (reason: string): GoldSinkQuote => ({ ok: false, reason });
  const priced = (gold: number | null, free = false): GoldSinkQuote => gold === null ? fail('nothing-to-buy') : free ? { ok: true, gold: 0, free: true } : player.gold >= gold ? { ok: true, gold } : fail('gold');
  if (action.type === 'RushProduction') {
    const city = state.cities[action.cityId];
    if (!city || city.ownerId !== actorId || city.capturedAtRound === state.round) return fail('city-unavailable');
    if (ledger.rushedAt[city.id] === state.round) return fail('rushed');
    return priced(rushGold(city.queue[0], content, player, playerPolicyEffects(state, actorId).trainingDiscountPercent, atWarWith(state.diplomacy, actorId)));
  }
  const unit = state.units[action.unitId];
  if (!unit || unit.ownerId !== actorId || unit.kind !== 'pokemon') return fail('unit-unavailable');
  if (action.type === 'RushRecovery') {
    if (unit.location !== 'recovering' || unit.roundsLeft <= 0) return fail('not-recovering');
    const city = state.cities[unit.cityId];
    if (!city || city.ownerId !== actorId || !nearestFreeTile(state, unit, city, content)) return fail('no-room');
    return priced(recoveryGold(unit.roundsLeft, content));
  }
  if (!isMapUnit(unit)) return fail('unit-unavailable');
  if (action.type === 'SpecialTraining') {
    const tuning = lateTuning(content), last = ledger.trainedAt[actorId]?.[unit.id];
    if (!unit.actionLeft) return fail('no-action');
    if (last !== undefined && state.round < last + tuning.trainingCooldown) return fail('training-cooldown');
    if (!nearTrainingGround(Object.values(state.cities).filter(city => city.ownerId === actorId), unit.position, state.map)) return fail('no-training-ground');
    return priced(tuning.trainingGold);
  }
  const species = content.species[unit.speciesId];
  if (!Object.hasOwn(TYPE_ESSENCE, action.typeId) || species.typeId === action.typeId || species.secondaryTypeId === action.typeId || ledger.moves[unit.id] === action.typeId) return fail('tm-redundant');
  if (!stateBadges(state, actorId).has(TYPE_ESSENCE[action.typeId])) return fail('tm-badge');
  const free = freeTmsLeft(state.expansion?.gymCircuit, actorId, ledger.freeUsed[actorId] ?? []).includes(action.typeId);
  return priced(tmGold(species.stage, content), free);
}
export function validateGoldSinkAction(state: GameState, actorId: number, action: GoldSinkAction, content: Content): string | null {
  const quote = goldSinkQuote(state, actorId, action, content);
  return quote.ok ? null : quote.reason;
}
export function applyGoldSinkAction(state: GameState, actorId: number, action: GoldSinkAction, content: Content): EventPayload[] {
  const quote = goldSinkQuote(state, actorId, action, content);
  if (!quote.ok) throw new Error(quote.reason);
  const ledger = state.expansion!.goldSinks!, player = state.players[actorId];
  player.gold -= quote.gold;
  const spent = ledger.spent[actorId] ??= {};
  spent[action.type] = (spent[action.type] ?? 0) + quote.gold;
  const base = { type: 'GoldSinkUsed' as const, playerId: actorId, kind: action.type, gold: quote.gold };
  if (action.type === 'RushProduction') {
    const city = state.cities[action.cityId], order = city.queue[0];
    order.progress = productionCost(order.item, content, playerPolicyEffects(state, actorId).trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent);
    ledger.rushedAt[city.id] = state.round;
    return [{ ...base, cityId: city.id }];
  }
  const unit = state.units[action.unitId];
  if (action.type === 'RushRecovery') {
    if (unit.location !== 'recovering') throw new Error('Expected a recovering unit');
    const position = nearestFreeTile(state, unit, state.cities[unit.cityId], content)!;
    state.units[unit.id] = { ...createMapUnit(unitIdentity(unit), unit.id, unit.ownerId, position, content, unit.xp), hp: Math.floor(maxUnitHp(unit, content) * 250 / 1000), enraged: unit.enraged };
    return [{ ...base, unitId: unit.id }, { type: 'UnitRecovered', playerId: actorId, unitId: unit.id, position: { ...position } }];
  }
  if (!isMapUnit(unit)) throw new Error('Expected a deployed unit');
  if (action.type === 'SpecialTraining') {
    unit.xp += lateTuning(content).trainingXp; unit.actionLeft = 0;
    (ledger.trainedAt[actorId] ??= {})[unit.id] = state.round;
    return [{ ...base, unitId: unit.id }];
  }
  ledger.moves[unit.id] = action.typeId;
  if (quote.free) (ledger.freeUsed[actorId] ??= []).push(action.typeId);
  return [{ ...base, unitId: unit.id, typeId: action.typeId, ...(quote.free ? { free: true as const } : {}) }];
}
export function initializeGoldSinks(state: GameState, content: Content): void {
  if (content.goldSinks && state.expansion) state.expansion.goldSinks = { trainedAt: {}, moves: {}, rushedAt: {}, freeUsed: {}, spent: {} };
}
/** Round end: nothing to resolve (a rushed order completes in the economy step); kept as the lane's round hook. */
export function resolveGoldSinkRound(state: GameState, content: Content): EventPayload[] {
  void state; void content;
  return [];
}
/** The TM type a unit carries in battle (undefined = none). */
export const taughtMoveType = (state: Pick<GameState, 'expansion'>, unitId: number): TypeId | undefined => state.expansion?.goldSinks?.moves[unitId];
export function observeGoldSinks(state: GameState, playerId: number): GoldSinkView | undefined {
  const ledger = state.expansion?.goldSinks;
  if (!ledger) return undefined;
  const own = new Set(Object.values(state.units).filter(unit => unit.ownerId === playerId).map(unit => unit.id));
  return { moves: Object.fromEntries(Object.entries(ledger.moves).filter(([id]) => own.has(Number(id)))),
    trainedAt: Object.fromEntries(Object.entries(ledger.trainedAt[playerId] ?? {}).filter(([id]) => own.has(Number(id)))),
    rushedCityIds: Object.entries(ledger.rushedAt).filter(([id, round]) => round === state.round && state.cities[Number(id)]?.ownerId === playerId).map(([id]) => Number(id)).sort((a, b) => a - b),
    freeTms: freeTmsLeft(state.expansion?.gymCircuit, playerId, ledger.freeUsed[playerId] ?? []), spent: { ...ledger.spent[playerId] } };
}
/** Same as `taughtMoveType`, for the viewer's own units (the preview and the AI). */
export const viewTaughtMoveType = (view: Pick<PlayerView, 'expansion'>, unitId: number): TypeId | undefined => view.expansion?.goldSinks?.moves[unitId];

/** View mirror of `goldSinkQuote` for the panels and the AI (same numbers; the room check for RushRecovery uses the viewer's sight). */
export function viewGoldSinkQuote(view: PlayerView, action: GoldSinkAction, content: Content): GoldSinkQuote {
  const sinks = view.expansion?.goldSinks, player = view.economy.player;
  if (!content.goldSinks || !sinks || player.eliminated || view.outcome || view.activePlayerId !== view.playerId) return { ok: false, reason: 'gold-sinks-unavailable' };
  const fail = (reason: string): GoldSinkQuote => ({ ok: false, reason });
  const priced = (gold: number | null, free = false): GoldSinkQuote => gold === null ? fail('nothing-to-buy') : free ? { ok: true, gold: 0, free: true } : player.gold >= gold ? { ok: true, gold } : fail('gold');
  if (action.type === 'RushProduction') {
    const city = view.economy.cities.find(item => item.id === action.cityId);
    if (!city || city.capturedAtRound === view.round) return fail('city-unavailable');
    if (sinks.rushedCityIds.includes(city.id)) return fail('rushed');
    return priced(rushGold(city.queue[0], content, player, viewPolicyEffects(view).trainingDiscountPercent, atWarWith(view.diplomacy, view.playerId)));
  }
  if (action.type === 'RushRecovery') {
    const unit = view.recoveringUnits.find(item => item.id === action.unitId && item.ownerId === view.playerId);
    if (!unit || unit.kind !== 'pokemon' || unit.roundsLeft <= 0) return fail('not-recovering');
    // Room beside the city (the city's ring is always in sight; any unit counts as blocking, so the view never promises more than the authority).
    const city = view.economy.cities.find(item => item.id === unit.cityId), taken = new Set([...view.units, ...view.cities].map(item => hexToIndex(item.position, view.map)));
    if (!city || !neighbors(city.position, view.map).some(hex => { const index = hexToIndex(hex, view.map); return index !== null && !taken.has(index) && view.map.tiles[index] !== null
      && canEnterTile(unit, view.map as Parameters<typeof canEnterTile>[1], index, content); })) return fail('no-room');
    return priced(recoveryGold(unit.roundsLeft, content));
  }
  const unit = view.units.find(item => item.id === action.unitId && item.ownerId === view.playerId);
  if (!unit || unit.kind !== 'pokemon') return fail('unit-unavailable');
  if (action.type === 'SpecialTraining') {
    const tuning = lateTuning(content), last = sinks.trainedAt[unit.id];
    if (!unit.actionLeft) return fail('no-action');
    if (last !== undefined && view.round < last + tuning.trainingCooldown) return fail('training-cooldown');
    if (!nearTrainingGround(view.economy.cities, unit.position, view.map)) return fail('no-training-ground');
    return priced(tuning.trainingGold);
  }
  const species = content.species[unit.speciesId];
  if (!Object.hasOwn(TYPE_ESSENCE, action.typeId) || species.typeId === action.typeId || species.secondaryTypeId === action.typeId || sinks.moves[unit.id] === action.typeId) return fail('tm-redundant');
  if (!viewBadges(view).has(TYPE_ESSENCE[action.typeId])) return fail('tm-badge');
  return priced(tmGold(species.stage, content), sinks.freeTms.includes(action.typeId));
}
/** Player-facing reasons. */
export const GOLD_SINK_REASONS: Record<string, string> = {
  'gold-sinks-unavailable': '现在不能使用', 'city-unavailable': '这座城市现在不能加急', rushed: '这座城市本轮已经加急过', 'nothing-to-buy': '当前生产项不能加急（传说奇观、设施区不能购买）',
  gold: '金币不够', 'unit-unavailable': '没有这只宝可梦', 'not-recovering': '它没有在休养', 'no-room': '城市旁没有空地', 'no-action': '它本轮已经行动过',
  'training-cooldown': '特训冷却中（每只每 8 轮 1 次）', 'no-training-ground': '要站在有宝可梦中心的己方城市里或旁边', 'tm-redundant': '它已经会这个属性',
  'tm-badge': '要先拿到这个属性所属精华的徽章',
};
