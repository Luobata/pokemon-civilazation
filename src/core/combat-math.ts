import { FULL_TYPE_CHART, TYPE_CHART } from '../content/combat.ts';
import type { TypeId } from '../content/species.ts';
import type { BiomeId } from '../content/rules.ts';

export function effectiveness(attackType: TypeId, defenseType: TypeId, immunities: readonly TypeId[] = [], researched = false): number {
  if (immunities.includes(attackType)) return 0;
  const multiplier = TYPE_CHART[attackType]?.[defenseType] ?? 1000;
  return multiplier === 2000 && researched ? 220 : multiplier / 10;
}
/** Multiply both defensive types exactly, then floor once. Research boosts each weakness. */
export function dualEffectiveness(attackType: TypeId, defenseTypes: readonly TypeId[], researched = false): number {
  let product = 100;
  for (const type of [...new Set(defenseTypes)]) {
    const multiplier = FULL_TYPE_CHART[attackType][type] ?? 1000;
    product = product * (multiplier === 2000 && researched ? 2200 : multiplier) / 1000;
  }
  return Math.floor(product);
}
export function terrainMultiplier(attacker: BiomeId, defender: BiomeId): number {
  return defender === 'forest' || defender === 'mountain' ? 80 : attacker === 'mountain' ? 120 : 100;
}
export function damage(attack: number, defense: number, power: number, effectiveness: number, terrain: number, random: number, bonusPermille = 1000): number {
  return effectiveness === 0 ? 0 : Math.max(1, Math.floor(attack * power * effectiveness * terrain * random * bonusPermille / (defense * 1_000_000_000)));
}
export function captureProbability(maxHp: number, hp: number, ballMultiplier: number, observed: boolean, rare: boolean): number {
  const base = Math.floor((maxHp - hp) * 60 * ballMultiplier / (maxHp * 1000));
  return Math.floor((base + (observed ? 10 : 0)) * (rare ? 500 : 1000) / 1000);
}
