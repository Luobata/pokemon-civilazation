// Gameplay v23 B (docs/design/improvements-v23.md §3): pillaging enemy improvements and repairing your own.
import { IMPROVEMENT_RULES_V23, IMPROVEMENTS, PILLAGE_REWARD } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import { workRadius } from './city.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState, PlayerView } from './model.ts';
import { addPendingProduction, builderCrew, nearestOwnCity, oceanReach, usesImprovementsV23 } from './improvements.ts';

export type PillageAction = { type: 'PillageImprovement'; unitId: number } | { type: 'RepairImprovement'; unitId: number; tileIndex: number };
export type PillageReward = { kind: 'food' | 'production' | 'gold' | 'research'; amount: number; cityId?: number };
export type PillageEvent =
  | { type: 'ImprovementPillaged'; playerId: number; ownerId: number; unitId: number; tileIndex: number; position: Hex; kind: ImprovementId; reward: PillageReward }
  | { type: 'ImprovementRepaired'; playerId: number; unitId: number; tileIndex: number; position: Hex; kind: ImprovementId };

export const isPillageAction = (action: { type: unknown }): action is PillageAction => action.type === 'PillageImprovement' || action.type === 'RepairImprovement';
type CityLike = Pick<CityState, 'id' | 'ownerId' | 'position' | 'population'>;
type Relations = readonly { a: number; b: number; status: string }[];
const atWarWith = (relations: Relations, a: number, b: number) => relations.some(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b) && pair.status === 'war');
/** Owner of the territory a tile lies in that is at war with `actorId` (nearest covering city, ties lowest id), or null. */
function hostileOwner(cities: readonly CityLike[], relations: Relations, actorId: number, position: Hex, map: MapShape): number | null {
  const covering = cities.filter(city => city.ownerId !== null && city.ownerId !== actorId && hexDistance(city.position, position, map) > 0
    && hexDistance(city.position, position, map) <= workRadius(city as CityState) && atWarWith(relations, actorId, city.ownerId))
    .sort((a, b) => hexDistance(a.position, position, map) - hexDistance(b.position, position, map) || a.id - b.id);
  return covering[0]?.ownerId ?? null;
}
const inOwnTerritory = (cities: readonly CityLike[], playerId: number, position: Hex, map: MapShape) =>
  cities.some(city => city.ownerId === playerId && hexDistance(city.position, position, map) > 0 && hexDistance(city.position, position, map) <= workRadius(city as CityState));

/** Shared by authority, UI and AI. Inputs come from the state or from the actor's own view. */
export function pillageBlocker(input: { map: MapShape & { width: number; height: number }; cities: readonly CityLike[]; relations: Relations; actorId: number;
  unit: { kind: string; ownerId: number | null; actionLeft: number; position: Hex | null } | undefined;
  improvementAt: (tileIndex: number) => { kind: ImprovementId; damaged?: true } | undefined }): string | null {
  const { unit } = input;
  if (!unit || unit.ownerId !== input.actorId || unit.kind !== 'pokemon' || !unit.position || !unit.actionLeft) return 'pillage-unavailable';
  const tileIndex = hexToIndex(unit.position, input.map), improvement = tileIndex === null ? undefined : input.improvementAt(tileIndex);
  if (!improvement || improvement.damaged) return 'pillage-unavailable';
  return hostileOwner(input.cities, input.relations, input.actorId, unit.position, input.map) === null ? 'pillage-unavailable' : null;
}
/** What pillaging this improvement gives; `cityId` is the actor's city that receives food / production. */
export function pillageReward(kind: ImprovementId, nearestCityId: number | undefined): PillageReward {
  const resource = PILLAGE_REWARD[kind], rules = IMPROVEMENT_RULES_V23.pillage;
  if ((resource === 'food' || resource === 'production') && nearestCityId === undefined) return { kind: 'gold', amount: rules.fallbackGold };
  return { kind: resource, amount: rules[resource], ...(resource === 'food' || resource === 'production' ? { cityId: nearestCityId } : {}) };
}
const improvementGetter = (state: GameState) => (index: number) => state.expansion?.improvements?.tiles[index];
export function validatePillageAction(state: GameState, actorId: number, action: PillageAction, content: Content): string | null {
  if (!usesImprovementsV23(state) || !content.pillage || !state.expansion?.improvements) return 'pillage-unavailable';
  const unit = state.units[action.unitId];
  if (action.type === 'PillageImprovement') return pillageBlocker({ map: state.map, cities: Object.values(state.cities), relations: state.diplomacy, actorId,
    unit: unit && isMapUnit(unit) ? unit : undefined, improvementAt: improvementGetter(state) });
  if (!unit || !isMapUnit(unit) || unit.ownerId !== actorId || unit.kind !== 'logistics' || unit.role !== 'builder' || !unit.actionLeft) return 'repair-unavailable';
  return repairBlocker({ map: state.map, cities: Object.values(state.cities), actorId, unitPosition: unit.position, reach: oceanReach(builderCrew(unit, content, state)),
    tileIndex: action.tileIndex, improvementAt: improvementGetter(state) });
}
export function repairBlocker(input: { map: MapShape & { width: number; height: number; tiles: readonly (string | null)[] }; cities: readonly CityLike[]; actorId: number; unitPosition: Hex; reach: number;
  tileIndex: number; improvementAt: (tileIndex: number) => { damaged?: true } | undefined }): string | null {
  if (!Number.isSafeInteger(input.tileIndex) || input.tileIndex < 0 || input.tileIndex >= input.map.tiles.length) return 'repair-unavailable';
  const improvement = input.improvementAt(input.tileIndex), position = indexToHex(input.tileIndex, input.map);
  if (!improvement?.damaged) return 'repair-unavailable';
  const distance = hexDistance(input.unitPosition, position, input.map);
  if (input.map.tiles[input.tileIndex] === 'ocean' ? distance < 1 || distance > input.reach : distance !== 0) return 'repair-unavailable';
  return inOwnTerritory(input.cities, input.actorId, position, input.map) ? null : 'repair-unavailable';
}
export function applyPillageAction(state: GameState, actorId: number, action: PillageAction, content: Content): EventPayload[] {
  const unit = state.units[action.unitId];
  if (!unit || !isMapUnit(unit)) throw new Error('Expected deployed unit');
  const tiles = state.expansion!.improvements!.tiles;
  if (action.type === 'RepairImprovement') {
    const improvement = tiles[action.tileIndex];
    delete improvement.damaged; delete improvement.damagedAtRound;
    improvement.repairedAtRound = state.round;
    // 巧手 (handy) crews repair without spending the action.
    if (builderCrew(unit, content, state) !== 'handy') unit.actionLeft = 0;
    return [{ type: 'ImprovementRepaired', playerId: actorId, unitId: unit.id, tileIndex: action.tileIndex, position: indexToHex(action.tileIndex, state.map), kind: improvement.kind }];
  }
  const tileIndex = hexToIndex(unit.position, state.map)!, improvement = tiles[tileIndex];
  const ownerId = hostileOwner(Object.values(state.cities), state.diplomacy, actorId, unit.position, state.map)!;
  improvement.damaged = true; improvement.damagedAtRound = state.round;
  unit.actionLeft = 0;
  const city = nearestOwnCity(state, actorId, unit.position), reward = pillageReward(improvement.kind, city?.id);
  const player = state.players[actorId];
  if (reward.kind === 'food') state.cities[reward.cityId!].food += reward.amount;
  else if (reward.kind === 'production') addPendingProduction(state, actorId, reward.cityId!, reward.amount);
  else if (reward.kind === 'gold') player.gold += reward.amount;
  else player.research.reserve += reward.amount;
  return [{ type: 'ImprovementPillaged', playerId: actorId, ownerId, unitId: unit.id, tileIndex, position: { ...unit.position }, kind: improvement.kind, reward }];
}
/** Pillage preview for the acting player's own unit, from its view (same arithmetic as the authority). */
export function viewPillage(view: PlayerView, unitId: number): { tileIndex: number; kind: ImprovementId; reward: PillageReward } | null {
  if (!usesImprovementsV23(view) || !view.expansion?.improvements) return null;
  const unit = view.units.find(item => item.id === unitId);
  const tiles = new Map(view.expansion.improvements.tiles.map(tile => [tile.tileIndex, tile]));
  const cities = [...view.economy.cities, ...view.cities.filter(city => city.ownerId !== view.playerId).map(city => ({ ...city, population: 1 }))];
  if (!unit || pillageBlocker({ map: view.map, cities, relations: view.diplomacy, actorId: view.playerId, unit, improvementAt: index => tiles.get(index) })) return null;
  const tileIndex = hexToIndex(unit.position, view.map)!, kind = tiles.get(tileIndex)!.kind;
  const city = [...view.economy.cities].sort((a, b) => hexDistance(a.position, unit.position, view.map) - hexDistance(b.position, unit.position, view.map) || a.id - b.id)[0];
  return { tileIndex, kind, reward: pillageReward(kind, city?.id) };
}
/** Damaged own-territory improvements a builder can repair now, from its view. */
export function viewRepairs(view: PlayerView, unitId: number, content: Content): number[] {
  if (!usesImprovementsV23(view) || !view.expansion?.improvements) return [];
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit || unit.kind !== 'logistics' || unit.role !== 'builder' || !unit.actionLeft) return [];
  const tiles = new Map(view.expansion.improvements.tiles.map(tile => [tile.tileIndex, tile]));
  return view.expansion.improvements.tiles.filter(tile => tile.damaged).map(tile => tile.tileIndex).filter(tileIndex => repairBlocker({ map: view.map, cities: view.economy.cities,
    actorId: view.playerId, unitPosition: unit.position, reach: oceanReach(builderCrew(unit, content, view)), tileIndex, improvementAt: index => tiles.get(index) }) === null);
}
export const pillageRewardLabel = (reward: PillageReward) => `${({ food: '食物', production: '生产', gold: '金币', research: '科研' })[reward.kind]} +${reward.amount}`;
export const improvementName = (kind: ImprovementId) => IMPROVEMENTS[kind].name;
