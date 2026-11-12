// Gameplay v24 B (docs/design/world-v24.md §3.4): AI gym challenges, team travel and the Elite Four — view-only, never a refused command.
// Gyms: power ratio ≥ 1.25 (≥ 1.1 with a type advantage). Elite Four: a win estimate from a few simulated battles with fixed seeds
// (not the authority's seed, so the AI estimates rather than foresees the result).
import { ELITE_FOUR, GYM_RULES_V24 } from '../content/gym-circuit.ts';
import type { Content } from '../content/units.ts';
import { simulateBattle, stableSeed } from '../core/civilization-systems.ts';
import type { BattleCombatant } from '../core/civilization-systems.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { eliteFourTeam, leaderTeamFor, unitPower, viewEliteFourBlocker, viewGymBlocker, viewGymTeam } from '../core/gym-circuit.ts';
import type { GymSite } from '../core/gym-circuit.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { threatenedCityIds } from './bond-plan.ts';
import { rivalActive, rivalThreatenedCityIds } from './rival-plan.ts';
import { travelDistance } from './travel.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
const own = (view: PlayerView) => view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon').sort((a, b) => a.id - b.id);
/** Power scaled by remaining HP (a hurt Pokémon counts for less). */
const effectivePower = (unit: Pokemon, content: Content) => Math.floor(unitPower(unit, content) * unit.hp / content.species[unit.speciesId].maxHp);
const advantage = (team: readonly Pokemon[], gym: GymSite, content: Content) => team.some(unit => dualEffectiveness(content.species[unit.speciesId].typeId, [gym.typeId]) > 100);
/** Whether this team is strong enough for the viewer's next leader at this gym (§3.4). */
export function gymReady(view: PlayerView, gym: GymSite, team: readonly Pokemon[], content: Content): boolean {
  const badges = view.expansion?.gymCircuit?.badges[view.playerId]?.length ?? 0;
  const power = team.reduce((sum, unit) => sum + effectivePower(unit, content), 0), needed = leaderTeamFor(badges).power;
  return power * 100 >= needed * (advantage(team, gym, content) ? 110 : 125);
}
const atWar = (view: PlayerView) => view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
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
  const circuit = view.expansion?.gymCircuit;
  if (!circuit) return null;
  const units = own(view);
  const won = circuit.badges[view.playerId] ?? [];
  if (won.length >= GYM_RULES_V24.gymCount && !circuit.eliteFour[view.playerId]?.won && !atWar(view)) {
    const team = units.filter(unit => unit.actionLeft).sort((a, b) => effectivePower(b, content) - effectivePower(a, content) || a.id - b.id).slice(0, GYM_RULES_V24.eliteFour.team);
    const ids = team.map(unit => unit.id);
    if (!viewEliteFourBlocker(view, ids) && eliteFourEstimate(team, content) >= 50) return { type: 'ChallengeEliteFour', unitIds: ids };
  }
  for (const gym of circuit.gyms) {
    if (won.includes(gym.id)) continue;
    const ids = viewGymTeam(view, gym.id, content);
    if (!ids.length || viewGymBlocker(view, gym.id, ids)) continue;
    if (gymReady(view, gym, ids.map(id => units.find(unit => unit.id === id)!), content)) return { type: 'ChallengeGym', gymId: gym.id, unitIds: ids };
  }
  return null;
}

/** Unit id -> the gym tile it is walking to (the planner scores moves toward it). One gym at a time: the nearest one a ready team can win. */
export function gymMoveTargets(view: PlayerView, content: Content): Map<number, Hex> {
  const circuit = view.expansion?.gymCircuit, targets = new Map<number, Hex>();
  if (!circuit || atWar(view) || rivalActive(view) || threatenedCityIds(view).length || rivalThreatenedCityIds(view).length) return targets;
  const cityTiles = new Set(view.economy.cities.map(city => `${city.position.q},${city.position.r}`));
  // Garrisons (Pokémon standing in an own city) stay; one Pokémon always stays home.
  const free = own(view).filter(unit => !cityTiles.has(`${unit.position.q},${unit.position.r}`));
  const size = Math.min(GYM_RULES_V24.maxTeam, own(view).length - 1, free.length);
  if (size < 1) return targets;
  const won = circuit.badges[view.playerId] ?? [];
  const plans = circuit.gyms.filter(gym => !won.includes(gym.id) && (circuit.readyAt[gym.id] ?? 0) <= view.round + 2).flatMap(gym => {
    const team = free.map(unit => ({ unit, distance: travelDistance(view, unit, unit.position, gym.position) })).filter(item => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance || a.unit.id - b.unit.id).slice(0, size);
    // Judged at full health: the team heals on the way.
    const healthy = team.map(item => ({ ...item.unit, hp: content.species[item.unit.speciesId].maxHp }));
    if (team.length < size || !gymReady(view, gym, healthy, content)) return [];
    return [{ gym, team, distance: Math.max(...team.map(item => item.distance)) }];
  }).sort((a, b) => a.distance - b.distance || a.gym.id - b.gym.id);
  for (const item of plans[0]?.team ?? []) targets.set(item.unit.id, plans[0].gym.position);
  return targets;
}
