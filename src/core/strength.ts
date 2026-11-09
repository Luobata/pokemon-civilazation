// Gameplay v20 combat strength (docs/design/combat-strength-v20.md): Civilization 6-style combat. Each side has one
// strength number, every modifier is a labelled flat bonus, and damage depends only on the gap. Integer table lookups
// only, so browser and Node replays stay byte-identical.
import { FULL_TYPE_CHART } from '../content/combat.ts';
import type { TypeId } from '../content/species.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Content } from '../content/units.ts';
import type { MapUnit } from './model.ts';

/** round(1000 × e^(gap / 25)) for gap −50 … +50. */
const EXP = [135, 141, 147, 153, 159, 165, 172, 179, 186, 194, 202, 210, 219, 228, 237, 247, 257, 267, 278, 289, 301, 313, 326, 340, 353, 368, 383, 399, 415, 432,
  449, 468, 487, 507, 527, 549, 571, 595, 619, 644, 670, 698, 726, 756, 787, 819, 852, 887, 923, 961, 1000, 1041, 1083, 1127, 1174, 1221, 1271, 1323, 1377, 1433,
  1492, 1553, 1616, 1682, 1751, 1822, 1896, 1974, 2054, 2138, 2226, 2316, 2411, 2509, 2612, 2718, 2829, 2945, 3065, 3190, 3320, 3456, 3597, 3743, 3896, 4055,
  4221, 4393, 4572, 4759, 4953, 5155, 5366, 5585, 5812, 6050, 6297, 6554, 6821, 7099, 7389];
export const STRENGTH_RULES = {
  /** Damage at equal strength (×10), and for a counter strike. 100 HP units take about 7 hits at equal strength. */
  base10: 150, counterBase10: 75,
  typeStep: 10, researchedTypeStep: 12, cover: 5, highGround: 5, uniqueLeader: 3,
} as const;
/** Old stat scale (attack / defense ~20–140) → combat strength (~23–71). */
export const toStrength = (stat: number) => Math.max(1, Math.round(stat * 0.4) + 15);
const gapFactor = (gap: number) => EXP[Math.max(-50, Math.min(50, gap)) + 50];
/** Nearest strength bonus for a damage multiplier in permille (×1.2 → +5, ×0.8 → −6), ties toward zero. */
export function strengthFromPermille(permille: number): number {
  if (permille === 1000) return 0;
  let best = 0;
  for (let gap = -50; gap <= 50; gap++) {
    const diff = Math.abs(gapFactor(gap) - permille), current = Math.abs(gapFactor(best) - permille);
    if (diff < current || (diff === current && Math.abs(gap) < Math.abs(best))) best = gap;
  }
  return best;
}

export type StrengthFactor = { side: 'attack' | 'defense'; label: string; value: number };
/** A labelled multiplier from an existing system; `defense: true` shows it on the defender (as a positive bonus). */
export type StrikeFactor = { label: string; permille: number; defense?: true };
export type StrengthBreakdown = { attack: number; defense: number; factors: StrengthFactor[]; gap: number; immune: boolean; logistics: boolean };

function typeFactor(attackType: TypeId, defenseTypes: readonly TypeId[], researched: boolean): { immune: boolean; factor: StrengthFactor | null } {
  let steps = 0;
  for (const type of [...new Set(defenseTypes)]) {
    const multiplier = FULL_TYPE_CHART[attackType][type] ?? 1000;
    if (multiplier === 0) return { immune: true, factor: { side: 'attack', label: `属性无效（${TYPE_NAMES[attackType]}→${TYPE_NAMES[type]}）`, value: 0 } };
    if (multiplier > 1000) steps++; else if (multiplier < 1000) steps--;
  }
  if (!steps) return { immune: false, factor: null };
  const value = steps > 0 ? steps * (researched ? STRENGTH_RULES.researchedTypeStep : STRENGTH_RULES.typeStep) : steps * STRENGTH_RULES.typeStep;
  return { immune: false, factor: { side: 'attack', label: `${steps > 0 ? '属性克制' : '效果不好'}（${TYPE_NAMES[attackType]}→${defenseTypes.map(type => TYPE_NAMES[type]).join('/')}）`, value } };
}
const terrainFactors = (from: BiomeId, to: BiomeId): StrengthFactor[] => to === 'forest' || to === 'mountain'
  ? [{ side: 'defense', label: to === 'forest' ? '森林掩护' : '山地掩护', value: STRENGTH_RULES.cover }]
  : from === 'mountain' ? [{ side: 'attack', label: '居高临下', value: STRENGTH_RULES.highGround }] : [];
function finish(attack: number, defense: number, factors: StrengthFactor[], immune: boolean, logistics: boolean): StrengthBreakdown {
  const kept = factors.filter(factor => factor.value !== 0 || factor.label.startsWith('属性无效'));
  const gap = attack + kept.filter(f => f.side === 'attack').reduce((s, f) => s + f.value, 0) - defense - kept.filter(f => f.side === 'defense').reduce((s, f) => s + f.value, 0);
  return { attack, defense, factors: kept, gap, immune, logistics };
}
const converted = (extra: readonly StrikeFactor[]): StrengthFactor[] => extra.map(factor => {
  const value = strengthFromPermille(factor.permille);
  return factor.defense ? { side: 'defense', label: factor.label, value: -value } : { side: 'attack', label: factor.label, value };
});

/**
 * One strike between units (the striker's attack strength against the target's defense strength). `features`: the v24 terrain terms
 * from `featureStrikeFactors` (src/core/terrain.ts) — hills, river crossing, embarked targets; empty before v24.
 */
export function unitStrengthBreakdown(attacker: MapUnit, defender: MapUnit, from: BiomeId, to: BiomeId, researched: boolean, content: Content,
  extra: readonly StrikeFactor[], defenderTypes: readonly TypeId[] | null, features: readonly StrengthFactor[] = []): StrengthBreakdown {
  if (attacker.kind !== 'pokemon') return finish(0, 0, [], true, false);
  const a = content.species[attacker.speciesId];
  if (defender.kind === 'logistics') return finish(a.attack, 0, [], false, true);
  const d = content.species[defender.speciesId];
  const type = typeFactor(a.typeId, defenderTypes ?? [d.typeId, ...(d.secondaryTypeId ? [d.secondaryTypeId] : [])], researched);
  const factors: StrengthFactor[] = [...(type.factor ? [type.factor] : []), ...terrainFactors(from, to), ...features, ...converted(extra),
    ...(attacker.uniqueLeader ? [{ side: 'attack' as const, label: '领袖专属', value: STRENGTH_RULES.uniqueLeader }] : []),
    ...(defender.uniqueLeader ? [{ side: 'defense' as const, label: '领袖专属', value: STRENGTH_RULES.uniqueLeader }] : [])];
  return finish(a.attack, d.defense, factors, type.immune, false);
}
/** A unit attacking a city: the city's defense strength comes from the old city defense stat. */
export function cityStrengthBreakdown(attacker: MapUnit, from: BiomeId, to: BiomeId, content: Content, extra: readonly StrikeFactor[], walls = 0,
  features: readonly StrengthFactor[] = []): StrengthBreakdown {
  if (attacker.kind !== 'pokemon') return finish(0, 0, [], true, false);
  const a = content.species[attacker.speciesId];
  return finish(a.attack, toStrength(content.balance.city.defense), [...terrainFactors(from, to), ...features, ...converted(extra),
    ...(attacker.uniqueLeader ? [{ side: 'attack' as const, label: '领袖专属', value: STRENGTH_RULES.uniqueLeader }] : []),
    ...(walls ? [{ side: 'defense' as const, label: '城墙', value: walls }] : [])], false, false);
}
/** A city shooting back at the unit that attacked it. */
export function cityCounterBreakdown(counterAttack: number, defender: MapUnit, from: BiomeId, to: BiomeId, content: Content,
  features: readonly StrengthFactor[] = []): StrengthBreakdown {
  if (counterAttack === 0 || defender.kind !== 'pokemon') return finish(0, 0, [], true, false);
  return finish(toStrength(counterAttack), content.species[defender.speciesId].defense, [...terrainFactors(from, to), ...features,
    ...(defender.uniqueLeader ? [{ side: 'defense' as const, label: '领袖专属', value: STRENGTH_RULES.uniqueLeader }] : [])], false, false);
}
/** Damage from a breakdown; `roll` is 85–100 (100 for counters), `targetHp` is used for one-hit logistics targets. */
export function strengthDamage(breakdown: StrengthBreakdown, roll: number, counter: boolean, targetHp: number): number {
  if (breakdown.logistics) return targetHp;
  if (breakdown.immune) return 0;
  return Math.max(1, Math.floor((counter ? STRENGTH_RULES.counterBase10 : STRENGTH_RULES.base10) * gapFactor(breakdown.gap) * roll / 1_000_000));
}

/** Labelled factors of one strike between units, from the values the existing systems compute (shared by authority and preview). */
export function strikeFactors(v: { leader: number; enraged: boolean; flank: number; misty: number; home: number; eraAttack: number; eraDefense: number;
  zealot: number; assault: number; bulwark: number; classCounter: number; affinity: number }): StrikeFactor[] {
  return [
    { label: '领袖能力', permille: v.leader }, { label: '激怒', permille: v.enraged ? 1200 : 1000 }, { label: '夹击', permille: 1000 + v.flank },
    { label: '领袖能力（水）', permille: v.misty }, { label: '主场防守', permille: v.home, defense: true },
    { label: '时代能力', permille: v.eraAttack }, { label: '时代能力', permille: v.eraDefense, defense: true },
    { label: '信仰：狂信', permille: v.zealot }, { label: '晋升：猛攻', permille: v.assault }, { label: '晋升：坚守', permille: v.bulwark, defense: true },
    { label: v.classCounter < 1000 ? '攻城不擅野战' : '兵种克制', permille: v.classCounter }, { label: '属性契合', permille: v.affinity },
  ];
}
/** Labelled factors of a city attack. */
export function cityFactors(v: { leader: number; eraAttack: number; enraged: boolean; assault: number; breacher: number; affinity: number }): StrikeFactor[] {
  return [{ label: '攻城定位', permille: v.assault }, { label: '领袖能力', permille: v.leader }, { label: '时代能力', permille: v.eraAttack },
    { label: '激怒', permille: v.enraged ? 1200 : 1000 }, { label: '晋升：破城', permille: v.breacher }, { label: '属性契合', permille: v.affinity }];
}
