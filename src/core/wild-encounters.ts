// Gameplay v27 ② (docs/design/pace-v27.md §3, option 2A): wild encounters.
// - Exhaustion: a wild Pokémon (not a rival's, not a raid boss, not a rampaging nest Pokémon) struck by any civilization's unit to at most
//   40% HP is exhausted for 2 rounds (`exhaustedUntilRound` = this round + 1): it neither strikes nor moves at the end of those rounds and
//   capture chance gains +25 points (cap 95, never below the chance without it). When it ends with HP still at most 40%, HP returns to 41%.
//   A wild Pokémon is exhausted once (the field stays as the marker), so it cannot be held down for ever.
// - Newbie protection: up to round 30, a Pokémon knocked out by a wild one recovers for 1 round (else 2 / 3) and returns at 50% HP (else 25%).
// - First encounter: the first exhaustion of a species by a civilization before round 40 gives the striking Pokémon +15 XP and +5 science.
// - The first ball: each civilization's first capture attempt on an exhausted wild Pokémon succeeds (no random draw).
// All integers; no new random draws; the exhaustion is a public unit field (visible with the unit), the ledger is private.
import { openingTuning } from '../content/pace-v27.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { GameState, MapUnit, PlayerView, UnitState } from './model.ts';
import { isRivalUnit } from './rivals.ts';
import { isRaidUnit } from './raids.ts';

/** `encountered`: species each civilization has exhausted (the first-encounter reward); `firstBall`: civilizations that used the first ball. */
export type WildEncounterState = { encountered: Record<number, SpeciesId[]>; firstBall: Record<number, true> };
/** The viewer's own ledger. */
export type WildEncounterView = { encountered: SpeciesId[]; firstBallUsed: boolean };
export type WildEncounterEvent =
  /** To the striking civilization: the wild Pokémon is exhausted until the end of `untilRound`; `firstEncounter` = the species reward was paid. */
  | { type: 'WildExhausted'; playerId: number; unitId: number; targetUnitId: number; speciesId: SpeciesId; untilRound: number; firstEncounter: boolean; xp: number; science: number };

export function initializeWildEncounters(state: GameState, content: Content): void {
  if (content.wildEncounters && state.expansion) state.expansion.wildEncounters = { encountered: {}, firstBall: {} };
}
/** A wild Pokémon the encounter rules apply to (not a rival's, not a raid boss, not rampaging). */
export function isEncounterWild(state: GameState, unit: UnitState): boolean {
  return unit.ownerId === null && unit.kind === 'pokemon' && !isRivalUnit(state, unit.id) && !isRaidUnit(state, unit.id)
    && !(state.expansion?.world.rampagingUnitIds.includes(unit.id) ?? false);
}
/** Whether a unit is exhausted this round (authority and views read the same public field). */
export const isExhausted = (unit: Pick<MapUnit, 'exhaustedUntilRound'>, round: number): boolean => unit.exhaustedUntilRound !== undefined && round <= unit.exhaustedUntilRound;

/**
 * After a strike lowered `defender`'s HP: exhaust a wild Pokémon hit by a civilization's unit to at most the threshold (once per unit), and
 * pay the first-encounter reward. Returns the event for the striker's owner, or null.
 */
export function exhaustAfterStrike(state: GameState, attacker: MapUnit, defender: MapUnit, content: Content): WildEncounterEvent | null {
  if (!content.wildEncounters || attacker.ownerId === null || defender.hp <= 0 || defender.kind !== 'pokemon' || defender.exhaustedUntilRound !== undefined
    || !isEncounterWild(state, defender)) return null;
  const tuning = openingTuning(content);
  if (defender.hp * 100 > tuning.exhaustHpPercent * content.species[defender.speciesId].maxHp) return null;
  defender.exhaustedUntilRound = state.round + tuning.exhaustRounds - 1;
  const ledger = state.expansion?.wildEncounters, owner = attacker.ownerId;
  const seen = ledger?.encountered[owner] ?? [];
  const first = Boolean(ledger) && state.round < tuning.encounterBeforeRound && !seen.includes(defender.speciesId);
  if (first && ledger) {
    ledger.encountered[owner] = [...seen, defender.speciesId].sort();
    attacker.xp += tuning.encounterXp;
    state.players[owner].research.reserve += tuning.encounterScience;
  }
  return { type: 'WildExhausted', playerId: owner, unitId: attacker.id, targetUnitId: defender.id, speciesId: defender.speciesId, untilRound: defender.exhaustedUntilRound,
    firstEncounter: first, xp: first ? tuning.encounterXp : 0, science: first ? tuning.encounterScience : 0 };
}
/** End of round, before the wild act: an exhausted wild Pokémon skips its turn; on its last exhausted round its HP returns to the floor. */
export function exhaustedWildRests(state: GameState, unit: MapUnit, content: Content): boolean {
  if (!content.wildEncounters || !isExhausted(unit, state.round)) return false;
  if (state.round === unit.exhaustedUntilRound && unit.kind === 'pokemon') {
    const tuning = openingTuning(content), maxHp = content.species[unit.speciesId].maxHp;
    if (unit.hp * 100 <= tuning.exhaustHpPercent * maxHp) unit.hp = Math.min(maxHp, Math.ceil(maxHp * tuning.exhaustRecoverPercent / 100));
  }
  return true;
}
/**
 * The capture chance with the encounter rules (authority and preview share it): `base` is the chance without them; an exhausted target
 * adds the bonus (capped, never lowering `base`), and the civilization's first ball on an exhausted target is certain (100).
 */
export function encounterCaptureChance(base: number, exhausted: boolean, firstBallUsed: boolean, content: Content): number {
  if (!content.wildEncounters || !exhausted) return base;
  if (!firstBallUsed) return 100;
  const tuning = openingTuning(content);
  return Math.max(base, Math.min(tuning.exhaustCaptureCap, base + tuning.exhaustCaptureBonus));
}
/** Whether this capture uses the civilization's first ball (certain, no random draw); marks it used. */
export function useFirstBall(state: GameState, playerId: number, target: Pick<MapUnit, 'exhaustedUntilRound'>, content: Content): boolean {
  const ledger = state.expansion?.wildEncounters;
  if (!content.wildEncounters || !ledger || ledger.firstBall[playerId] || !isExhausted(target, state.round)) return false;
  ledger.firstBall[playerId] = true;
  return true;
}
export const firstBallUsed = (state: GameState, playerId: number): boolean => Boolean(state.expansion?.wildEncounters?.firstBall[playerId]);
export const viewFirstBallUsed = (view: Pick<PlayerView, 'expansion'>): boolean => view.expansion?.wildEncounters?.firstBallUsed ?? true;

/** Newbie protection: the recovery of a Pokémon knocked out by `source` (null = not protected). */
export function protectedRecovery(state: GameState, source: MapUnit | null, content: Content): { roundsLeft: number; hpPercent: number } | null {
  if (!content.wildEncounters || !source || !isEncounterWild(state, source)) return null;
  const tuning = openingTuning(content);
  return state.round <= tuning.protectionLastRound ? { roundsLeft: tuning.protectionRounds, hpPercent: tuning.protectionHpPercent } : null;
}
export function observeWildEncounters(state: GameState, playerId: number): WildEncounterView | undefined {
  const ledger = state.expansion?.wildEncounters;
  return ledger ? { encountered: [...(ledger.encountered[playerId] ?? [])], firstBallUsed: Boolean(ledger.firstBall[playerId]) } : undefined;
}
