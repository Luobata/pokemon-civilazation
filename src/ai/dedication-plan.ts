// Gameplay v22: the AI chooses its era dedications as soon as a choice is pending (before any other order), so it
// never ends a turn with the choice open. Cards follow the personality's style; situation and age adjust them.
import { DEDICATION_IDS, DEDICATIONS } from '../content/dedications.ts';
import type { DedicationId } from '../content/dedications.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { AiPersonality, Command, PlayerView } from '../core/model.ts';

const STYLE_WEIGHT: Record<AiPersonality, Record<DedicationId, number>> = {
  aggressive: { badgeQuest: 40, evolutionLight: 30, ballMaster: 25, wildExpedition: 20, townArchitect: 15, professorNotes: 15, pioneerTrail: 10, grandStage: 5 },
  expansion: { pioneerTrail: 40, townArchitect: 30, wildExpedition: 25, ballMaster: 20, professorNotes: 20, grandStage: 15, evolutionLight: 10, badgeQuest: 10 },
  conservative: { professorNotes: 40, townArchitect: 30, grandStage: 30, evolutionLight: 20, ballMaster: 15, pioneerTrail: 15, wildExpedition: 10, badgeQuest: 5 },
};
/** Each leader's favourite card (their signature style). */
const LEADER_FAVOURITE: Record<LeaderId, DedicationId> = {
  oak: 'professorNotes', lance: 'badgeQuest', jenny: 'pioneerTrail', joy: 'grandStage', brock: 'townArchitect',
  misty: 'wildExpedition', steven: 'evolutionLight', jasmine: 'townArchitect', giovanni: 'ballMaster',
};
const PER_CITY = ['cityFood', 'cityProduction', 'cityResearch', 'cityGold', 'upkeepReduction'] as const;

export function dedicationScore(view: PlayerView, id: DedicationId): number {
  const player = view.economy.player, honor = view.expansion?.eraHonors, cities = view.economy.cities.length;
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  let score = STYLE_WEIGHT[player.personality][id] + (player.leaderId && LEADER_FAVOURITE[player.leaderId] === id ? 20 : 0);
  if (honor?.age === 'golden') {
    // Golden effects only: per-city bonuses grow with the empire.
    if (PER_CITY.some(key => DEDICATIONS[id].golden.policy[key])) score += cities * 4;
  } else {
    if (id === 'badgeQuest' && atWar) score += 25;
    if (id === 'pioneerTrail' && cities < 3) score += 15;
    if (id === 'ballMaster' && player.research.unlockedIds.includes('domestication')) score += 5;
    if (id === 'wildExpedition' && view.knowledge.exploredTileIds.length * 2 < view.map.tiles.length) score += 10;
  }
  return score;
}
export function planDedicationAction(view: PlayerView): Command['action'] | null {
  const pending = view.expansion?.eraHonors?.dedication?.pending ?? 0;
  if (!pending || view.economy.player.eliminated) return null;
  const ranked = [...DEDICATION_IDS].sort((a, b) => dedicationScore(view, b) - dedicationScore(view, a) || a.localeCompare(b));
  return { type: 'ChooseDedication', dedicationIds: ranked.slice(0, pending) };
}
