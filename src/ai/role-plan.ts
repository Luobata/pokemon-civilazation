import type { TechId } from '../content/economy.ts';
import type { TechLine } from '../content/tech-tree.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { LeaderId } from '../content/leaders.ts';
import { activeDoctrine, isDoctrineTarget, LEADER_DOCTRINES } from '../core/leader-doctrines.ts';
import type { PlayerView } from '../core/model.ts';
import { hasEraProgression } from './war-plan.ts';
import { TREE_CLASS_HMS } from '../content/tech-tree.ts';
import { RECRUIT_SLOTS } from '../content/recruit-slots.ts';
import { recruitSlotsFor } from '../content/roster.ts';
import { trainableSpeciesIds } from '../core/role-tactics.ts';

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

/** v25 (roster-v25 §6): what the civilization could train now, by class, and whether any of it fits its leader's current doctrine. */
function trainableGaps(view: PlayerView, content: Content) {
  const player = view.economy.player, trainable = trainableSpeciesIds(player, view.gameplayVersion, content, view.eraProgression);
  const roles = new Set(trainable.map(id => content.species[id]?.role));
  const doctrine = activeDoctrine(player, view.eraProgression)?.definition ?? null;
  const doctrineCovered = doctrine === null || trainable.some(id => isDoctrineTarget({ kind: 'pokemon', speciesId: id }, content, doctrine));
  const hmLearned = (role: string) => { const hm = TREE_CLASS_HMS[role as keyof typeof TREE_CLASS_HMS]; return hm !== undefined && player.research.unlockedIds.includes(hm.techId); };
  return { roles, doctrine, doctrineCovered, hmLearned };
}
/**
 * v25 regional Pokédex: a capture worth +25 when its class has a learned HM but nothing trainable (mostly naval and air), +10 when it fits the
 * leader's current doctrine and nothing trainable does. Only with a regional Pokédex (before v25: 0).
 */
export function classGapCaptureBonus(view: PlayerView, speciesId: SpeciesId, content: Content): number {
  if (!content.regionalDex || !hasGameplayPack(view) || !content.species[speciesId]) return 0;
  const gaps = trainableGaps(view, content), role = content.species[speciesId].role;
  return (gaps.hmLearned(role) && !gaps.roles.has(role) ? 25 : 0)
    + (gaps.doctrine && !gaps.doctrineCovered && isDoctrineTarget({ kind: 'pokemon', speciesId }, content, gaps.doctrine) ? 10 : 0);
}
/** Capture bonus of a species: the assault-role bonus plus (v25) the class-gap bonus, together at most 50. */
export function captureRoleBonus(view: PlayerView, speciesId: SpeciesId, content: Content): number {
  const role = roleCaptureBonus(view, speciesId, content);
  return content.regionalDex ? Math.min(50, role + classGapCaptureBonus(view, speciesId, content)) : role;
}
/**
 * v25: research worth +20 when the technology's regional recruit fills a class the civilization cannot train yet, +10 when the recruit fits
 * the leader's current doctrine; an empty recruit slot adds nothing. Only with a regional Pokédex.
 */
export function recruitResearchBonus(view: PlayerView, techId: TechId, content: Content): number {
  if (!content.regionalDex || !hasGameplayPack(view)) return 0;
  const slot = RECRUIT_SLOTS.find(entry => entry.techId === techId), speciesId = slot ? recruitSlotsFor(content).find(item => item.slot === slot.id)?.speciesId : null;
  if (!speciesId || !content.species[speciesId]) return 0;
  const gaps = trainableGaps(view, content);
  return (gaps.roles.has(content.species[speciesId].role) ? 0 : 20) + (gaps.doctrine && isDoctrineTarget({ kind: 'pokemon', speciesId }, content, gaps.doctrine) ? 10 : 0);
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
