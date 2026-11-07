import { legendEffects, mergeEffects, viewLegendEffects } from './legends.ts';
import type { LegendView } from './legends.ts';
import { CHARTER_IDS, CHARTERS, GOVERNMENT_IDS, GOVERNMENT_SWAP_GOLD, GOVERNMENTS, LEADER_GOVERNMENT_AFFINITY, LEADER_POLICY_AFFINITY, POLICIES, POLICY_IDS, POLICY_SWAP_GOLD } from '../content/policies.ts';
import type { CharterId, GovernmentId, PolicyEffects, PolicyId, SlotKind } from '../content/policies.ts';
import { eraState, gameplayAtLeast } from '../content/eras.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { EventPayload, GameState, PlayerState } from './model.ts';
import { eraHonorRecord, honorEffects, honorLeaguePoints } from './era-honors.ts';
import type { DedicationLedger } from './dedications.ts';
import { onTechTree, treeEffects } from './tech-tree.ts';
import type { EraAge } from '../content/era-honors.ts';

/** Gameplay v3 only. Per player: charter progress, adopted charters and slotted policies. */
export type PolicyPlayerState = {
  points: number; charterId: CharterId | null; progressByCharter: Record<CharterId, number>;
  adopted: CharterId[]; slotted: PolicyId[];
  /** Free changes are granted when a charter completes or the era changes; consumed by SetPolicies. */
  freeSwap: boolean; lastEraIndex: number;
  /** Gameplay v11 only (absent before, so older states serialize unchanged). */
  government?: GovernmentId | null;
  /** v11: the next government change is free (first choice, or a charter just unlocked a new one). */
  governmentFreeSwap?: boolean;
};
export type PolicyState = Record<number, PolicyPlayerState>;
export type PolicyAction = { type: 'SetCharter'; charterId: CharterId } | { type: 'SetPolicies'; policyIds: PolicyId[] }
  | { type: 'SetGovernment'; governmentId: GovernmentId };
export type PolicyEvent =
  | { type: 'CharterSelected'; playerId: number; charterId: CharterId }
  | { type: 'CharterAdopted'; playerId: number; charterId: CharterId }
  | { type: 'PoliciesChanged'; playerId: number; policyIds: PolicyId[]; goldCost: number }
  | { type: 'LeaguePointsSettled'; playerId: number; points: number; charterId: CharterId | null; progress: number }
  | { type: 'GovernmentChanged'; playerId: number; governmentId: GovernmentId; goldCost: number; droppedPolicies: PolicyId[] };
export type PolicyView = PolicyPlayerState & { slots: Record<SlotKind, number>; unlockedPolicies: PolicyId[]; perRound: number; swapCost: number;
  /** v11 only: governments this player may adopt now, and the price of changing. */
  availableGovernments?: GovernmentId[]; governmentSwapCost?: number };

const ZERO: Required<PolicyEffects> = { trainedXp: 0, trainingDiscountPercent: 0, cityProduction: 0, cityFood: 0, cityGold: 0, cityResearch: 0,
  workPointBonus: 0, captureBonus: 0, healing: 0, ballDiscount: 0, upkeepReduction: 0, visionBonus: 0 };
export const usesPolicies = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 3);
export const usesGovernments = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 11);
export function isPolicyAction(action: { type: unknown }): action is PolicyAction {
  return action.type === 'SetCharter' || action.type === 'SetPolicies' || action.type === 'SetGovernment';
}
function blank(governments: boolean): PolicyPlayerState {
  return { points: 0, charterId: null, progressByCharter: Object.fromEntries(CHARTER_IDS.map(id => [id, 0])) as Record<CharterId, number>,
    adopted: [], slotted: [], freeSwap: true, lastEraIndex: 0, ...(governments ? { government: null, governmentFreeSwap: true } : {}) };
}
export function initializePolicies(state: GameState): void {
  if (usesPolicies(state)) state.expansion!.policies = Object.fromEntries(state.turnOrder.map(id => [id, blank(usesGovernments(state))]));
}
export function slotCounts(adopted: readonly CharterId[], government: GovernmentId | null = null): Record<SlotKind, number> {
  const slots: Record<SlotKind, number> = { military: 0, economic: 0, wild: 0 };
  for (const id of adopted) for (const [kind, count] of Object.entries(CHARTERS[id].grantsSlots) as [SlotKind, number][]) slots[kind] += count;
  if (government) for (const [kind, count] of Object.entries(GOVERNMENTS[government].grantsSlots) as [SlotKind, number][]) slots[kind] += count;
  return slots;
}
export const governmentAvailable = (adopted: readonly CharterId[], id: GovernmentId) => adopted.includes(GOVERNMENTS[id].requires);
export const availableGovernments = (adopted: readonly CharterId[]) => GOVERNMENT_IDS.filter(id => governmentAvailable(adopted, id));
export const governmentSwapCost = (ledger: PolicyPlayerState) => ledger.governmentFreeSwap ? 0 : GOVERNMENT_SWAP_GOLD;
/** Drops cards (highest ID first) until the rest fit the slots; deterministic. */
export function trimToSlots(adopted: readonly CharterId[], policyIds: readonly PolicyId[], government: GovernmentId | null): PolicyId[] {
  const kept = [...policyIds].sort();
  while (kept.length && !fitsSlots(adopted, kept, government)) kept.pop();
  return kept;
}
export const unlockedPolicies = (adopted: readonly CharterId[]) => POLICY_IDS.filter(id => adopted.some(charter => CHARTERS[charter].unlocks.includes(id)));
export const charterAvailable = (adopted: readonly CharterId[], id: CharterId) => !adopted.includes(id) && CHARTERS[id].requires.every(req => adopted.includes(req));
/** Valid when every card is unlocked, unique and fits the slots (wild slots take any overflow). */
export function fitsSlots(adopted: readonly CharterId[], policyIds: readonly PolicyId[], government: GovernmentId | null = null): boolean {
  if (new Set(policyIds).size !== policyIds.length) return false;
  const unlocked = new Set(unlockedPolicies(adopted));
  if (policyIds.some(id => !unlocked.has(id))) return false;
  const slots = slotCounts(adopted, government);
  const military = policyIds.filter(id => POLICIES[id].slot === 'military').length, economic = policyIds.length - military;
  return Math.max(0, military - slots.military) + Math.max(0, economic - slots.economic) <= slots.wild;
}
export function policyEffects(player: Pick<PlayerState, 'leaderId'>, slotted: readonly PolicyId[] | undefined, government: GovernmentId | null = null, extra: PolicyEffects = {}): Required<PolicyEffects> {
  const total = { ...ZERO };
  const add = (effects: PolicyEffects, affinity: boolean) => {
    for (const [key, value] of Object.entries(effects) as [keyof PolicyEffects, number][]) total[key] += affinity ? value + Math.max(1, Math.floor(value / 2)) : value;
  };
  for (const id of slotted ?? []) add(POLICIES[id].effects, player.leaderId !== undefined && LEADER_POLICY_AFFINITY[player.leaderId as LeaderId].includes(id));
  if (government) add(GOVERNMENTS[government].effects, player.leaderId !== undefined && LEADER_GOVERNMENT_AFFINITY[player.leaderId as LeaderId] === government);
  add(extra, false);
  return total;
}
/** Effects for a player in the authoritative state; zero when the pack is off. */
export function playerPolicyEffects(state: Pick<GameState, 'setup' | 'expansion' | 'players'>, playerId: number | null): Required<PolicyEffects> {
  if (playerId === null || !usesPolicies(state as GameState)) return { ...ZERO };
  const ledger = state.expansion!.policies?.[playerId];
  const honor = honorEffects(eraHonorRecord(state, playerId));
  const extra = state.expansion?.legends ? mergeEffects(honor, legendEffects(state as GameState, playerId)) : honor;
  // v22: completed tree technologies add their standing bonuses through the same channel (preview == authority).
  return policyEffects(state.players[playerId], ledger?.slotted, ledger?.government ?? null, onTechTree(state.players[playerId]) ? mergeEffects(extra, treeEffects(state.players[playerId])) : extra);
}
export function leaguePointsPerRound(state: GameState, playerId: number): number {
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId);
  const population = cities.reduce((sum, city) => sum + city.population, 0);
  const improvements = Object.values(state.expansion?.improvements?.tiles ?? {}).filter(tile => tile.builtBy === playerId).length;
  const satisfaction = state.expansion?.world.players[playerId]?.satisfaction ?? 0;
  return 1 + cities.length + Math.floor(population / 3) + Math.floor(improvements / 2) + (satisfaction >= 50 ? 2 : 0) + honorLeaguePoints(eraHonorRecord(state, playerId));
}
/** Same effects computed from a player's own observation (UI previews and AI). */
export function viewPolicyEffects(view: { playerId?: number; economy: { player: Pick<PlayerState, 'leaderId'> & Partial<Pick<PlayerState, 'research'>> }; expansion?: { policies?: { slotted: PolicyId[]; government?: GovernmentId | null }; eraHonors?: { age: EraAge; dedication?: DedicationLedger }; legends?: LegendView } }): Required<PolicyEffects> {
  const extra = view.expansion?.legends && view.playerId !== undefined
    ? mergeEffects(honorEffects(view.expansion.eraHonors), viewLegendEffects({ playerId: view.playerId, expansion: view.expansion })) : honorEffects(view.expansion?.eraHonors);
  const own = view.economy.player.research ? { research: view.economy.player.research } : undefined;
  return view.expansion?.policies ? policyEffects(view.economy.player, view.expansion.policies.slotted, view.expansion.policies.government ?? null,
    onTechTree(own) ? mergeEffects(extra, treeEffects(own)) : extra) : { ...ZERO };
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
  if (action.type === 'SetGovernment') {
    if (ledger.government === undefined || !Object.hasOwn(GOVERNMENTS, action.governmentId) || !governmentAvailable(ledger.adopted, action.governmentId)) return 'government-unavailable';
    if (ledger.government === action.governmentId) return 'government-unchanged';
    return state.players[actorId].gold < governmentSwapCost(ledger) ? 'government-gold' : null;
  }
  if (!Array.isArray(action.policyIds) || action.policyIds.some(id => !Object.hasOwn(POLICIES, id)) || !fitsSlots(ledger.adopted, action.policyIds, ledger.government ?? null)) return 'policies-invalid';
  if ([...action.policyIds].sort().join() === [...ledger.slotted].sort().join()) return 'policies-unchanged';
  return state.players[actorId].gold < swapCost(ledger) ? 'policies-gold' : null;
}
export function applyPolicyAction(state: GameState, actorId: number, action: PolicyAction): EventPayload[] {
  const ledger = state.expansion!.policies![actorId];
  if (action.type === 'SetCharter') { ledger.charterId = action.charterId; return [{ type: 'CharterSelected', playerId: actorId, charterId: action.charterId }]; }
  if (action.type === 'SetGovernment') {
    const goldCost = governmentSwapCost(ledger);
    state.players[actorId].gold -= goldCost;
    ledger.government = action.governmentId; ledger.governmentFreeSwap = false;
    const kept = trimToSlots(ledger.adopted, ledger.slotted, ledger.government);
    const droppedPolicies = ledger.slotted.filter(id => !kept.includes(id));
    // Slots changed: the next card arrangement is free.
    ledger.slotted = kept; ledger.freeSwap = true;
    return [{ type: 'GovernmentChanged', playerId: actorId, governmentId: action.governmentId, goldCost, droppedPolicies }];
  }
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
        if (ledger.government !== undefined && GOVERNMENT_IDS.some(id => GOVERNMENTS[id].requires === charterId)) ledger.governmentFreeSwap = true;
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
  return { ...(JSON.parse(JSON.stringify(ledger)) as PolicyPlayerState), slots: slotCounts(ledger.adopted, ledger.government ?? null), unlockedPolicies: unlockedPolicies(ledger.adopted),
    perRound: leaguePointsPerRound(state, playerId), swapCost: swapCost(ledger),
    ...(ledger.government !== undefined ? { availableGovernments: availableGovernments(ledger.adopted), governmentSwapCost: governmentSwapCost(ledger) } : {}) };
}
