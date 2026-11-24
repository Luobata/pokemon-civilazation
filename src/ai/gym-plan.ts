// Gameplay v24 B (docs/design/world-v24.md §3.4): AI gym challenges, team travel and the Elite Four — view-only, never a refused command.
// Gyms: power ratio ≥ 1.25 (≥ 1.1 with a type advantage). Elite Four: a win estimate from a few simulated battles with fixed seeds
// (not the authority's seed, so the AI estimates rather than foresees the result).
import { ELITE_FOUR, GYM_RULES_V24 } from '../content/gym-circuit.ts';
import type { Content } from '../content/units.ts';
import { simulateBattle, stableSeed } from '../core/civilization-systems.ts';
import type { BattleCombatant } from '../core/civilization-systems.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { eliteFourTeam, leaderTeamFor, unitPower } from '../core/gym-circuit.ts';
import type { GymSite } from '../core/gym-circuit.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { planTeamBattleAction, teamBattleGymTargets } from './battle-plan.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
/** Power scaled by remaining HP (a hurt Pokémon counts for less). */
const effectivePower = (unit: Pokemon, content: Content) => Math.floor(unitPower(unit, content) * unit.hp / content.species[unit.speciesId].maxHp);
const advantage = (team: readonly Pokemon[], gym: GymSite, content: Content) => team.some(unit => dualEffectiveness(content.species[unit.speciesId].typeId, [gym.typeId]) > 100);
/** Whether this team is strong enough for the viewer's next leader at this gym (§3.4). */
export function gymReady(view: PlayerView, gym: GymSite, team: readonly Pokemon[], content: Content): boolean {
  const badges = view.expansion?.gymCircuit?.badges[view.playerId]?.length ?? 0;
  const power = team.reduce((sum, unit) => sum + effectivePower(unit, content), 0), needed = leaderTeamFor(badges, content).power;
  return power * 100 >= needed * (advantage(team, gym, content) ? 110 : 125);
}
/** Win share (0–100) of the Elite Four run from four simulated runs with fixed seeds. */
export function eliteFourEstimate(team: readonly Pokemon[], content: Content): number {
  let wins = 0;
  for (let trial = 0; trial < 4; trial++) {
    const roster: BattleCombatant[] = team.map((unit, index) => {
      const species = content.species[unit.speciesId];
      return { id: `ai-${index}`, unitId: unit.id, side: 'home', speciesId: unit.speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
        hp: unit.hp, maxHp: species.maxHp, attack: species.attack, defense: species.defense, power: species.power };
    });
    let won = true;
    for (let stage = 0; stage < ELITE_FOUR.length && won; stage++) {
      if (stage) for (const member of roster) if (member.hp > 0) member.hp += Math.floor((member.maxHp - member.hp) * GYM_RULES_V24.eliteFour.healPercentBetween / 100);
      won = simulateBattle(roster, eliteFourTeam(stage, trial + 1, content), stableSeed('ai-estimate', trial, stage), 'grassland').winnerSide === 'home';
    }
    if (won) wins++;
  }
  return wins * 25;
}

/** A ChallengeGym / ChallengeEliteFour command when a ready team stands at a gym (or holds eight badges); otherwise null. */
export function planGymAction(view: PlayerView, content: Content): Command['action'] | null {
  return planTeamBattleAction(view, content);
}

/** Unit id -> the gym tile it is walking to (the planner scores moves toward it). One gym at a time: the nearest one a ready team can win. */
export function gymMoveTargets(view: PlayerView, content: Content): Map<number, Hex> {
  return teamBattleGymTargets(view, content);
}
