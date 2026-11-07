import type { TechId } from '../content/economy.ts';
import type { TechLine } from '../content/tech-tree.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { LeaderId } from '../content/leaders.ts';
import { activeDoctrine, isDoctrineTarget, LEADER_DOCTRINES } from '../core/leader-doctrines.ts';
import type { PlayerView } from '../core/model.ts';
import { hasEraProgression } from './war-plan.ts';

const hasGameplayPack = (view: PlayerView) => hasEraProgression(view) && view.gameplayVersion !== undefined;

/**
 * Era-mode army composition and research doctrine. Everything here reads the AI's own
 * observation only. Legacy games return zero so their planner output is unchanged.
 */
const LEADER_TECH_FOCUS: Record<LeaderId, readonly TechId[]> = {
  oak: ['fieldObservation', 'typeResearch', 'training'],
  lance: ['riding', 'training', 'typeResearch'],
  jenny: ['stoneCraft', 'siegeCraft', 'training'],
  joy: ['berryCultivation', 'medicine', 'training'],
  brock: ['stoneCraft', 'domestication', 'siegeCraft'],
  misty: ['domestication', 'ballCraft', 'typeResearch'],
  steven: ['stoneCraft', 'training', 'meteorology'],
  jasmine: ['leagueRules', 'berryCultivation', 'ballCraft'],
  giovanni: ['domestication', 'ballCraft', 'fieldObservation'],
};

export function leaderResearchBonus(view: PlayerView, techId: TechId): number {
  const leaderId = view.economy.player.leaderId;
  if (!hasGameplayPack(view) || leaderId === undefined) return 0;
  const index = LEADER_TECH_FOCUS[leaderId].indexOf(techId);
  return index === -1 ? 0 : 60 - index * 15;
}

/** v22 tree: the research lines each leader / personality pursues first (primary, secondary). */
const LEADER_TECH_LINES: Record<LeaderId, readonly [TechLine, TechLine]> = {
  oak: ['science', 'capture'], lance: ['raising', 'exploration'], jenny: ['cities', 'raising'], joy: ['raising', 'league'],
  brock: ['cities', 'capture'], misty: ['exploration', 'capture'], steven: ['cities', 'science'], jasmine: ['league', 'cities'],
  giovanni: ['capture', 'league'],
};
const PERSONALITY_TECH_LINE: Record<string, TechLine> = { expansion: 'exploration', aggressive: 'raising', conservative: 'science' };
/**
 * v22 research choice among researchable techs only: cheaper columns first, then the leader's and personality's lines,
 * plus techs that open further steps on a preferred line (so the AI plans a route rather than buying the cheapest node).
 */
export function treeResearchBenefit(view: PlayerView, techId: TechId, content: Content): number {
  const player = view.economy.player, tech = content.techs[techId]!;
  const lines = player.leaderId ? LEADER_TECH_LINES[player.leaderId] : (['capture', 'cities'] as const);
  const personal = PERSONALITY_TECH_LINE[player.personality];
  const lineBonus = (line: TechLine | undefined) => (line === lines[0] ? 60 : line === lines[1] ? 30 : 0) + (line === personal ? 20 : 0);
  const opens = (Object.keys(content.techs) as TechId[]).filter(id => !player.research.unlockedIds.includes(id) && content.techs[id]!.requires?.includes(techId));
  return 300 - tech.tier * 40 + lineBonus(tech.line) + Math.min(30, opens.reduce((sum, id) => sum + Math.floor(lineBonus(content.techs[id]!.line) / 3), 0))
    + (techId === 'domestication' ? 40 : 0) + leaderResearchBonus(view, techId);
}

/** Benefit added to training a species: assault roles for sieges, plus the leader's active and next window. */
export function roleTrainingBonus(view: PlayerView, speciesId: SpeciesId, content: Content, preparingSiege: boolean): number {
  if (!hasGameplayPack(view)) return 0;
  const player = view.economy.player, species = content.species[speciesId];
  const identity = { kind: 'pokemon' as const, speciesId };
  let bonus = 0;
  if (preparingSiege) bonus += species.role === 'siege' ? 60 : species.role === 'melee' || species.role === 'fast' ? 35 : 0;
  const active = activeDoctrine(player, view.eraProgression);
  if (active && isDoctrineTarget(identity, content, active.definition)) bonus += 40;
  else if (active && player.leaderId !== undefined) {
    const next = active.state.phase === 'early' ? 'middle' : active.state.phase === 'middle' ? 'late' : null;
    if (next && isDoctrineTarget(identity, content, LEADER_DOCTRINES[player.leaderId][next])) bonus += 20;
  }
  // Keep a mixed army: discourage stacking the role that already dominates.
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  const sameRole = own.filter(unit => unit.kind === 'pokemon' && content.species[unit.speciesId].role === species.role).length;
  if (own.length >= 3 && sameRole * 2 > own.length) bonus -= 30;
  return bonus;
}

/** Wild captures that fill missing assault roles become worth chasing in era mode. */
export function roleCaptureBonus(view: PlayerView, speciesId: SpeciesId, content: Content): number {
  if (!hasGameplayPack(view)) return 0;
  const role = content.species[speciesId].role;
  if (role !== 'siege' && role !== 'melee') return 0;
  const owned = view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && content.species[unit.speciesId].role === role)
    || view.economy.player.registeredSpeciesIds.some(id => content.species[id].role === role);
  return owned ? 10 : role === 'siege' ? 40 : 25;
}
