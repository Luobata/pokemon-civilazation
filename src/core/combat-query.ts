import { GAME_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { MapUnit } from './model.ts';
import { damage, terrainMultiplier } from './combat-math.ts';

/** Damage dealt to a city by a wild rampaging Pokémon (world-systems.ts). */
export function cityDamage(attacker: MapUnit, from: BiomeId, to: BiomeId, siegeTech: boolean, roll: number, content: Content = GAME_CONTENT, activeAttackMultiplier = 1000, assaultMultiplier: number | null = null): number {
  if (attacker.kind !== 'pokemon') return 0;
  const a = content.species[attacker.speciesId];
  const siege = assaultMultiplier ?? (a.role === 'siege' && siegeTech ? content.balance.effects.siegeMultiplier : 1000);
  return damage(a.attack + (attacker.uniqueLeader ? 8 : 0), content.balance.city.defense, a.power, 100, terrainMultiplier(from, to), roll,
    siege * (attacker.enraged ? 1200 : 1000) * activeAttackMultiplier / 1_000_000);
}
