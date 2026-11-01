import { CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { MapUnit } from './model.ts';
import { damage, dualEffectiveness, effectiveness, terrainMultiplier } from './combat-math.ts';

export function unitDamage(attacker: MapUnit, defender: MapUnit, from: BiomeId, to: BiomeId,
  researched: boolean, roll: number, counter = false, content: Content = CONTENT, activeAttackMultiplier = 1000, dualTypes = false): number {
  if (attacker.kind !== 'pokemon') return 0;
  if (defender.kind === 'logistics') return defender.hp;
  const a = content.species[attacker.speciesId], d = content.species[defender.speciesId];
  return damage(a.attack + (attacker.uniqueLeader ? 8 : 0), d.defense + (defender.uniqueLeader ? 8 : 0), counter ? 5 : a.power,
    dualTypes ? dualEffectiveness(a.typeId, [d.typeId, ...(d.secondaryTypeId ? [d.secondaryTypeId] : [])], researched) : effectiveness(a.typeId, d.typeId, d.immunities, researched), terrainMultiplier(from, to), roll,
    (attacker.enraged ? 1200 : 1000) * (counter ? 1000 : activeAttackMultiplier) / 1000);
}
/** `assaultMultiplier` (era mode only) replaces the legacy siege-only multiplier with a role doctrine. */
export function cityDamage(attacker: MapUnit, from: BiomeId, to: BiomeId, siegeTech: boolean, roll: number, content: Content = CONTENT, activeAttackMultiplier = 1000, assaultMultiplier: number | null = null): number {
  if (attacker.kind !== 'pokemon') return 0;
  const a = content.species[attacker.speciesId];
  const siege = assaultMultiplier ?? (a.role === 'siege' && siegeTech ? content.balance.effects.siegeMultiplier : 1000);
  return damage(a.attack + (attacker.uniqueLeader ? 8 : 0), content.balance.city.defense, a.power, 100, terrainMultiplier(from, to), roll,
    siege * (attacker.enraged ? 1200 : 1000) * activeAttackMultiplier / 1_000_000);
}
export function cityCounterDamage(attack: number, defender: MapUnit, from: BiomeId, to: BiomeId, content: Content = CONTENT): number {
  if (attack === 0 || defender.kind !== 'pokemon') return 0;
  return damage(attack, content.species[defender.speciesId].defense + (defender.uniqueLeader ? 8 : 0), 5, 100, terrainMultiplier(from, to), 100);
}
