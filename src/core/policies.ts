import { CHARTER_IDS, CHARTERS, LEADER_POLICY_AFFINITY, POLICIES, POLICY_IDS, POLICY_SWAP_GOLD } from '../content/policies.ts';
import type { CharterId, PolicyEffects, PolicyId, SlotKind } from '../content/policies.ts';
import { eraState, gameplayAtLeast } from '../content/eras.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { EventPayload, GameState, PlayerState } from './model.ts';

/** Gameplay v3 only. Per player: charter progress, adopted charters and slotted policies. */
export type PolicyPlayerState = {
  points: number; charterId: CharterId | null; progressByCharter: Record<CharterId, number>;
  adopted: CharterId[]; slotted: PolicyId[];
  /** Free changes are granted when a charter completes or the era changes; consumed by SetPolicies. */
  freeSwap: boolean; lastEraIndex: number;
};
export type PolicyState = Record<number, PolicyPlayerState>;
export type PolicyAction = { type: 'SetCharter'; charterId: CharterId } | { type: 'SetPolicies'; policyIds: PolicyId[] };
export type PolicyEvent =
  | { type: 'CharterSelected'; playerId: number; charterId: CharterId }
  | { type: 'CharterAdopted'; playerId: number; charterId: CharterId }
  | { type: 'PoliciesChanged'; playerId: number; policyIds: PolicyId[]; goldCost: number }
  | { type: 'LeaguePointsSettled'; playerId: number; points: number; charterId: CharterId | null; progress: number };
export type PolicyView = PolicyPlayerState & { slots: Record<SlotKind, number>; unlockedPolicies: PolicyId[]; perRound: number; swapCost: number };

const ZERO: Required<PolicyEffects> = { trainedXp: 0, trainingDiscountPercent: 0, cityProduction: 0, cityFood: 0, cityGold: 0, cityResearch: 0,
  workPointBonus: 0, captureBonus: 0, healing: 0, ballDiscount: 0, upkeepReduction: 0, visionBonus: 0 };
export const usesPolicies = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 3);
export function isPolicyAction(action: { type: unknown }): action is PolicyAction {
  return action.type === 'SetCharter' || action.type === 'SetPolicies';
}
function blank(): PolicyPlayerState {
  return { points: 0, charterId: null, progressByCharter: Object.fromEntries(CHARTER_IDS.map(id => [id, 0])) as Record<CharterId, number>,
    adopted: [], slotted: [], freeSwap: true, lastEraIndex: 0 };
}
export function initializePolicies(state: GameState): void {
  if (usesPolicies(state)) state.expansion!.policies = Object.fromEntries(state.turnOrder.map(id => [id, blank()]));
}
export function slotCounts(adopted: readonly CharterId[]): Record<SlotKind, number> {
  const slots: Record<SlotKind, number> = { military: 0, economic: 0, wild: 0 };
  for (const id of adopted) for (const [kind, count] of Object.entries(CHARTERS[id].grantsSlots) as [SlotKind, number][]) slots[kind] += count;
  return slots;
}
export const unlockedPolicies = (adopted: readonly CharterId[]) => POLICY_IDS.filter(id => adopted.some(charter => CHARTERS[charter].unlocks.includes(id)));
export const charterAvailable = (adopted: readonly CharterId[], id: CharterId) => !adopted.includes(id) && CHARTERS[id].requires.every(req => adopted.includes(req));
/** Valid when every card is unlocked, unique and fits the slots (wild slots take any overflow). */
export function fitsSlots(adopted: readonly CharterId[], policyIds: readonly PolicyId[]): boolean {
  if (new Set(policyIds).size !== policyIds.length) return false;
  const unlocked = new Set(unlockedPolicies(adopted));
  if (policyIds.some(id => !unlocked.has(id))) return false;
  const slots = slotCounts(adopted);
  const military = policyIds.filter(id => POLICIES[id].slot === 'military').length, economic = policyIds.length - military;
  return Math.max(0, military - slots.military) + Math.max(0, economic - slots.economic) <= slots.wild;
}
export function policyEffects(player: Pick<PlayerState, 'leaderId'>, slotted: readonly PolicyId[] | undefined): Required<PolicyEffects> {
  const total = { ...ZERO };
  for (const id of slotted ?? []) {
    const affinity = player.leaderId !== undefined && LEADER_POLICY_AFFINITY[player.leaderId as LeaderId].includes(id);
    for (const [key, value] of Object.entries(POLICIES[id].effects) as [keyof PolicyEffects, number][]) {
      total[key] += affinity ? value + Math.max(1, Math.floor(value / 2)) : value;
    }
  }
  return total;
}
/** Effects for a player in the authoritative state; zero when the pack is off. */
export function playerPolicyEffects(state: Pick<GameState, 'setup' | 'expansion' | 'players'>, playerId: number | null): Required<PolicyEffects> {
  if (playerId === null || !usesPolicies(state as GameState)) return { ...ZERO };
  return policyEffects(state.players[playerId], state.expansion!.policies?.[playerId]?.slotted);
}
export function leaguePointsPerRound(state: GameState, playerId: number): number {
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId);
  const population = cities.reduce((sum, city) => sum + city.population, 0);
  const improvements = Object.values(state.expansion?.improvements?.tiles ?? {}).filter(tile => tile.builtBy === playerId).length;
  const satisfaction = state.expansion?.world.players[playerId]?.satisfaction ?? 0;
  return 1 + cities.length + Math.floor(population / 3) + Math.floor(improvements / 2) + (satisfaction >= 50 ? 2 : 0);
}
/** Same effects computed from a player's own observation (UI previews and AI). */
export function viewPolicyEffects(view: { economy: { player: Pick<PlayerState, 'leaderId'> }; expansion?: { policies?: { slotted: PolicyId[] } } }): Required<PolicyEffects> {
  return view.expansion?.policies ? policyEffects(view.economy.player, view.expansion.policies.slotted) : { ...ZERO };
}
export function ballPrice(base: number, discount: number): number { return Math.max(1, base - discount); }
export function swapCost(ledger: PolicyPlayerState): number { return ledger.freeSwap ? 0 : POLICY_SWAP_GOLD; }
export function validatePolicyAction(state: GameState, actorId: number, action: PolicyAction): string | null {
  const ledger = state.expansion?.policies?.[actorId];
  if (!usesPolicies(state) || !ledger || state.players[actorId].eliminated) return 'policies-unavailable';
  if (action.type === 'SetCharter') {
    if (!Object.hasOwn(CHARTERS, action.charterId) || !charterAvailable(ledger.adopted, action.charterId)) return 'charter-unavailable';
    return ledger.charterId === action.charterId ? 'charter-unchanged' : null;
  }
  if (!Array.isArray(action.policyIds) || action.policyIds.some(id => !Object.hasOwn(POLICIES, id)) || !fitsSlots(ledger.adopted, action.policyIds)) return 'policies-invalid';
  if ([...action.policyIds].sort().join() === [...ledger.slotted].sort().join()) return 'policies-unchanged';
  return state.players[actorId].gold < swapCost(ledger) ? 'policies-gold' : null;
}
export function applyPolicyAction(state: GameState, actorId: number, action: PolicyAction): EventPayload[] {
  const ledger = state.expansion!.policies![actorId];
  if (action.type === 'SetCharter') { ledger.charterId = action.charterId; return [{ type: 'CharterSelected', playerId: actorId, charterId: action.charterId }]; }
  const goldCost = swapCost(ledger);
  state.players[actorId].gold -= goldCost; ledger.freeSwap = false;
  ledger.slotted = [...action.policyIds].sort();
  return [{ type: 'PoliciesChanged', playerId: actorId, policyIds: [...ledger.slotted], goldCost }];
}
/** Round settlement: accrue league points into the selected charter; grants a free swap on adoption or era change. */
export function resolvePolicyRound(state: GameState): EventPayload[] {
  const policies = state.expansion?.policies;
  if (!policies) return [];
  const events: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const player = state.players[playerId], ledger = policies[playerId];
    if (!ledger || player.eliminated) continue;
    const gained = leaguePointsPerRound(state, playerId);
    const era = eraState(player, state.setup.eraProgression)?.index ?? 0;
    if (era !== ledger.lastEraIndex) { ledger.lastEraIndex = era; ledger.freeSwap = true; }
    const charterId = ledger.charterId;
    if (charterId === null) ledger.points += gained;
    else {
      const progress = ledger.progressByCharter[charterId] + ledger.points + gained;
      ledger.points = 0;
      const cost = CHARTERS[charterId].cost;
      ledger.progressByCharter[charterId] = Math.min(progress, cost);
      if (progress >= cost) {
        ledger.points = progress - cost; ledger.adopted = [...ledger.adopted, charterId].sort(); ledger.charterId = null; ledger.freeSwap = true;
        events.push({ type: 'CharterAdopted', playerId, charterId });
      }
    }
    events.push({ type: 'LeaguePointsSettled', playerId, points: gained, charterId, progress: charterId === null ? 0 : ledger.progressByCharter[charterId] });
  }
  return events;
}
export function observePolicies(state: GameState, playerId: number): PolicyView | undefined {
  const ledger = state.expansion?.policies?.[playerId];
  if (!ledger) return undefined;
  return { ...(JSON.parse(JSON.stringify(ledger)) as PolicyPlayerState), slots: slotCounts(ledger.adopted), unlockedPolicies: unlockedPolicies(ledger.adopted),
    perRound: leaguePointsPerRound(state, playerId), swapCost: swapCost(ledger) };
}
