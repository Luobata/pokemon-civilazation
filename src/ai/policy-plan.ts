import { CHARTER_IDS, CHARTERS, GOVERNMENTS, LEADER_GOVERNMENT_AFFINITY, LEADER_POLICY_AFFINITY, POLICIES } from '../content/policies.ts';
import type { CharterId, GovernmentId, PolicyId } from '../content/policies.ts';
import { charterAvailable, fitsSlots } from '../core/policies.ts';
import type { Command, PlayerView } from '../core/model.ts';
import type { AiPersonality } from '../core/model.ts';

const PERSONALITY_WEIGHT: Record<AiPersonality, Record<'military' | 'economic', number>> = {
  aggressive: { military: 3, economic: 1 }, expansion: { military: 1, economic: 3 }, conservative: { military: 2, economic: 2 },
};
function cardScore(view: PlayerView, id: PolicyId, atWar: boolean): number {
  const player = view.economy.player, definition = POLICIES[id];
  let score = PERSONALITY_WEIGHT[player.personality][definition.slot] * 10 + (atWar && definition.slot === 'military' ? 15 : 0);
  if (player.leaderId && LEADER_POLICY_AFFINITY[player.leaderId].includes(id)) score += 25;
  if (id === 'masterBuilders' && !view.expansion?.improvements) score -= 100;
  if (id === 'safariZone' && !player.research.unlockedIds.includes('domestication')) score -= 20;
  if (id === 'pokeMart' && !player.research.unlockedIds.includes('domestication')) score -= 20;
  return score;
}
/** Best legal policy set by greedy fill of the current slots; deterministic tie-break by ID. */
export function bestPolicies(view: PlayerView): PolicyId[] {
  const ledger = view.expansion?.policies;
  if (!ledger) return [];
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  const ranked = [...ledger.unlockedPolicies].sort((a, b) => cardScore(view, b, atWar) - cardScore(view, a, atWar) || a.localeCompare(b));
  const chosen: PolicyId[] = [];
  for (const id of ranked) if (fitsSlots(ledger.adopted, [...chosen, id], ledger.government ?? null)) chosen.push(id);
  return chosen.sort();
}
/** v11 government preference by personality; tier-2 governments and the leader's favourite score higher. */
const GOVERNMENT_WEIGHT: Record<AiPersonality, Record<GovernmentId, number>> = {
  aggressive: { gymLeague: 30, researchSociety: 10, ranchCommons: 15, championCouncil: 40, breederRepublic: 20, merchantAssembly: 15 },
  expansion: { gymLeague: 10, researchSociety: 15, ranchCommons: 30, championCouncil: 15, breederRepublic: 40, merchantAssembly: 30 },
  conservative: { gymLeague: 15, researchSociety: 30, ranchCommons: 20, championCouncil: 25, breederRepublic: 20, merchantAssembly: 35 },
};
export function governmentScore(view: PlayerView, id: GovernmentId): number {
  const player = view.economy.player;
  return GOVERNMENT_WEIGHT[player.personality][id] + GOVERNMENTS[id].tier * 10 + (player.leaderId && LEADER_GOVERNMENT_AFFINITY[player.leaderId] === id ? 25 : 0);
}
export function planPolicyAction(view: PlayerView): Command['action'] | null {
  const ledger = view.expansion?.policies;
  if (!ledger || view.economy.player.eliminated) return null;
  if (ledger.charterId === null) {
    const options = CHARTER_IDS.filter(id => charterAvailable(ledger.adopted, id));
    const personality = view.economy.player.personality;
    const prefer = (id: CharterId) => (CHARTERS[id].grantsSlots.military ?? 0) * PERSONALITY_WEIGHT[personality].military
      + (CHARTERS[id].grantsSlots.economic ?? 0) * PERSONALITY_WEIGHT[personality].economic + (CHARTERS[id].grantsSlots.wild ?? 0) * 3 - CHARTERS[id].cost / 30;
    const charterId = options.sort((a, b) => prefer(b) - prefer(a) || a.localeCompare(b))[0];
    if (charterId) return { type: 'SetCharter', charterId };
  }
  // Governments: only change while it is free (first choice, or a new one just unlocked).
  if (ledger.government !== undefined && ledger.governmentSwapCost === 0 && ledger.availableGovernments?.length) {
    const best = [...ledger.availableGovernments].sort((a, b) => governmentScore(view, b) - governmentScore(view, a) || a.localeCompare(b))[0];
    if (best !== ledger.government && (ledger.government === null || governmentScore(view, best) > governmentScore(view, ledger.government))) return { type: 'SetGovernment', governmentId: best };
  }
  const best = bestPolicies(view);
  const current = [...ledger.slotted].sort();
  if (best.join() !== current.join() && (ledger.swapCost === 0 || (best.length > current.length && view.economy.player.gold >= ledger.swapCost + 60))) {
    return { type: 'SetPolicies', policyIds: best };
  }
  return null;
}
