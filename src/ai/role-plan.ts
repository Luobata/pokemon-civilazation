import type { TechId } from '../content/economy.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { LeaderId } from '../content/leaders.ts';
import { activeDoctrine, isDoctrineTarget, LEADER_DOCTRINES } from '../core/leader-doctrines.ts';
import type { PlayerView } from '../core/model.ts';
import { hasEraProgression } from './war-plan.ts';

/**
 * Era-mode army composition and research doctrine. Everything here reads the AI's own
 * observation only. Legacy games return zero so their planner output is unchanged.
 */
const LEADER_TECH_FOCUS: Record<LeaderId, readonly TechId[]> = {
  oak: ['fieldObservation', 'typeResearch', 'training'],
  lance: ['riding', 'training', 'typeResearch'],
  jenny: ['stoneCraft', 'siegeCraft', 'training'],
  joy: ['berryCultivation', 'medicine', 'training'],
};

export function leaderResearchBonus(view: PlayerView, techId: TechId): number {
  const leaderId = view.economy.player.leaderId;
  if (!hasEraProgression(view) || leaderId === undefined) return 0;
  const index = LEADER_TECH_FOCUS[leaderId].indexOf(techId);
  return index === -1 ? 0 : 60 - index * 15;
}

/** Benefit added to training a species: assault roles for sieges, plus the leader's active and next window. */
export function roleTrainingBonus(view: PlayerView, speciesId: SpeciesId, content: Content, preparingSiege: boolean): number {
  if (!hasEraProgression(view)) return 0;
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
  if (!hasEraProgression(view)) return 0;
  const role = content.species[speciesId].role;
  if (role !== 'siege' && role !== 'melee') return 0;
  const owned = view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && content.species[unit.speciesId].role === role)
    || view.economy.player.registeredSpeciesIds.some(id => content.species[id].role === role);
  return owned ? 10 : role === 'siege' ? 40 : 25;
}
