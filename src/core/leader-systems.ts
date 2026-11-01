import { doctrineEffects } from './leader-doctrines.ts';
import type { LeaderId } from '../content/leaders.ts';
import { CONTENT, EXPANSION_CONTENT } from '../content/units.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { GameState, PlayerView } from './model.ts';
import { maxCityHp } from './city.ts';
import { initialUnitPosition } from './movement.ts';
import { createMapUnit, maxUnitHp } from './unit.ts';

export const LEADER_KITS: Record<LeaderId, { active: string; description: string; unit: SpeciesId; building: string }> = {
  oak: { active: '研究突破', description: '20 金币：获得 20 科研。冷却 8 轮。', unit: 'kadabra', building: '生态研究站' },
  lance: { active: '龙之号令', description: '20 金币：全军主动伤害额外 +15%，持续 2 轮。冷却 8 轮。', unit: 'dragonair', building: '冠军训练场' },
  jenny: { active: '紧急巡防', description: '20 金币：所有城市恢复 30 HP，城市视野额外 +1，持续 2 轮。冷却 8 轮。', unit: 'machoke', building: '联盟警署' },
  joy: { active: '紧急护理', description: '20 金币：全军恢复 20 HP，休养期减少 1 轮（至少 1）。冷却 8 轮。', unit: 'ivysaur', building: '护理中心' },
};
export type LeaderAction = { type: 'UseLeaderAbility' } | { type: 'RecruitLeaderUnit'; cityId: number } | { type: 'BuildLeaderBuilding'; cityId: number };
export type LeaderEvent = { type: 'LeaderAbilityUsed' | 'LeaderUnitRecruited' | 'LeaderBuildingBuilt'; playerId: number; leaderId: LeaderId; cityId?: number; unitId?: number };
export type LeaderPlayerState = { readyAtRound: number; activeUntilRound: number; uniqueCityIds: number[]; recruited: number };
export type LeaderSystemsState = { players: Record<number, LeaderPlayerState> };
export type LeaderSystemsView = LeaderPlayerState;
export function initializeLeaders(state: GameState): void {
  if (state.expansion) state.expansion.leaders = { players: Object.fromEntries(Object.keys(state.players).map(id => [id,
    { readyAtRound: 1, activeUntilRound: 0, uniqueCityIds: [], recruited: 0 }])) };
}
export function isLeaderAction(action: { type: string }): action is LeaderAction {
  return ['UseLeaderAbility', 'RecruitLeaderUnit', 'BuildLeaderBuilding'].includes(action.type);
}
export function validateLeaderAction(state: GameState, actor: number, action: LeaderAction,
  content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): string | null {
  const player = state.players[actor], ledger = state.expansion?.leaders.players[actor];
  if (!ledger || !player?.leaderId || player.eliminated) return 'leader-unavailable';
  if (action.type === 'UseLeaderAbility') return state.round < ledger.readyAtRound || player.gold < 20 ? 'leader-cooldown-or-gold' : null;
  const city = state.cities[action.cityId];
  if (!city || city.ownerId !== actor || city.capturedAtRound === state.round) return 'city-unavailable';
  if (action.type === 'BuildLeaderBuilding') return player.gold < 90 || ledger.uniqueCityIds.includes(city.id) ? 'building-unavailable' : null;
  if (player.gold < 100 || ledger.recruited >= 3 || !player.research.unlockedIds.includes('training')) return 'recruitment-unavailable';
  try { initialUnitPosition(state, city.position, { kind: 'pokemon', speciesId: LEADER_KITS[player.leaderId].unit }, content); }
  catch { return 'deployment-blocked'; }
  return null;
}
export function applyLeaderAction(state: GameState, actor: number, action: LeaderAction,
  content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): LeaderEvent[] {
  const player = state.players[actor], leaderId = player.leaderId!, ledger = state.expansion!.leaders.players[actor];
  if (action.type === 'UseLeaderAbility') {
    player.gold -= 20; ledger.readyAtRound = state.round + 8; ledger.activeUntilRound = state.round + 1;
    if (leaderId === 'oak') player.research.reserve += 20;
    if (leaderId === 'jenny') for (const city of Object.values(state.cities).filter(city => city.ownerId === actor)) city.hp = Math.min(maxCityHp(city, content), city.hp + 30);
    if (leaderId === 'joy') for (const unit of Object.values(state.units).filter(unit => unit.ownerId === actor && unit.kind === 'pokemon')) {
      unit.hp = Math.min(maxUnitHp(unit, content), unit.hp + 20);
      if (unit.location === 'recovering') unit.roundsLeft = Math.max(1, unit.roundsLeft - 1);
    }
    return [{ type: 'LeaderAbilityUsed', playerId: actor, leaderId }];
  }
  const city = state.cities[action.cityId];
  if (action.type === 'BuildLeaderBuilding') {
    player.gold -= 90; ledger.uniqueCityIds.push(city.id);
    return [{ type: 'LeaderBuildingBuilt', playerId: actor, leaderId, cityId: city.id }];
  }
  player.gold -= 100; ledger.recruited++;
  const identity = { kind: 'pokemon' as const, speciesId: LEADER_KITS[leaderId].unit, uniqueLeader: leaderId };
  const id = state.nextEntityId++, position = initialUnitPosition(state, city.position, identity, content);
  const xp = 20 + doctrineEffects(player, state.setup.eraProgression, identity, content).trainedXpBonus;
  state.units[id] = createMapUnit(identity, id, actor, position, content, xp, 0);
  if (!player.registeredSpeciesIds.includes(identity.speciesId)) player.registeredSpeciesIds.push(identity.speciesId);
  return [{ type: 'LeaderUnitRecruited', playerId: actor, leaderId, cityId: city.id, unitId: id }];
}
export function leaderAttackMultiplier(state: GameState, actor: number | null, base: number): number {
  if (actor === null || !state.expansion) return base;
  const player = state.players[actor], ledger = state.expansion.leaders.players[actor];
  return player.leaderId === 'lance' && ledger.activeUntilRound >= state.round ? Math.floor(base * 1150 / 1000) : base;
}
export function leaderVisionBonus(state: GameState, playerId: number, cityId: number): number {
  const ledger = state.expansion?.leaders.players[playerId];
  return state.players[playerId].leaderId === 'jenny' && ledger ? Number(ledger.activeUntilRound >= state.round) + Number(ledger.uniqueCityIds.includes(cityId)) : 0;
}
export function leaderCityYield(state: GameState, cityId: number): { food: number; production: number; gold: number; research: number } {
  const city = state.cities[cityId], owner = city.ownerId;
  const none = { food: 0, production: 0, gold: 0, research: 0 };
  if (owner === null || !state.expansion?.leaders.players[owner]?.uniqueCityIds.includes(cityId)) return none;
  switch (state.players[owner].leaderId) {
    case 'oak': return { ...none, research: 2 };
    case 'lance': return { ...none, production: 2 };
    case 'jenny': return { ...none, gold: 2 };
    case 'joy': return { ...none, food: 2 };
    default: return none;
  }
}
export function observeLeaders(state: GameState, playerId: number): LeaderSystemsView {
  return JSON.parse(JSON.stringify(state.expansion!.leaders.players[playerId]));
}
/** Uses only projected information; each leader follows its own spending priority. */
export function planLeaderAction(view: PlayerView,
  content: Content = view.expansion ? EXPANSION_CONTENT : CONTENT): LeaderAction | null {
  const ledger = view.expansion?.leaders, player = view.economy.player, id = player.leaderId;
  if (!ledger || !id) return null;
  const units = view.units.filter(unit => unit.ownerId === player.id && unit.kind === 'pokemon');
  const home = view.economy.cities.find(city => city.capturedAtRound !== view.round);
  const canRecruit = home && ledger.recruited < 3 && units.length < 8 && player.research.unlockedIds.includes('training');
  // Exercise the first unique unit before optional recurring spending consumes its budget.
  if (canRecruit && ledger.recruited === 0 && player.gold >= 100) return { type: 'RecruitLeaderUnit', cityId: home.id };
  const useful = id === 'oak' || (id === 'lance' && view.diplomacy.some(pair => pair.status === 'war' && [pair.a, pair.b].includes(player.id)))
    || (id === 'joy' && [...units, ...view.recoveringUnits].some(unit => unit.hp + 15 < maxUnitHp(unit, content)))
    || (id === 'jenny' && view.economy.cities.some(city => city.hp + 20 < maxCityHp(city, content)));
  if (player.gold >= 50 && view.round >= ledger.readyAtRound && useful) return { type: 'UseLeaderAbility' };
  const city = view.economy.cities.find(city => city.capturedAtRound !== view.round && !ledger.uniqueCityIds.includes(city.id));
  if (city && player.gold >= (id === 'oak' ? 100 : 110)) return { type: 'BuildLeaderBuilding', cityId: city.id };
  if (canRecruit && player.gold >= 120
    && (id === 'lance' || id === 'jenny' || view.round >= 30)) return { type: 'RecruitLeaderUnit', cityId: home.id };
  return null;
}
