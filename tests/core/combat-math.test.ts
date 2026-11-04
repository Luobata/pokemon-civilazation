import { describe, expect, test } from 'vitest';
import { BASE_SPECIES_NAMES, SPECIES, speciesDisplay, validateSpecies } from '../../src/content/species.ts';
import { captureProbability, damage, dualEffectiveness, effectiveness, terrainMultiplier } from '../../src/core/combat-math.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';

describe('GDD v0.6 integer fixtures', () => {
  test.each([
    [76, 72, 10, 200, 100, 100, 21], // A
    [76, 78, 10, 50, 100, 100, 4], // B
    [64, 64, 5, 200, 100, 100, 10], // B counter
    [92, 66, 10, 100, 120, 85, 14], // D
    [115, 85, 10, 220, 100, 100, 29], // E
    [76, 72, 10, 200, 100, 85, 17], // §7.4 lower bound
    [70, 64, 5, 50, 100, 100, 2], // §7.4 counter
  ])('damage %i/%i P%i E%i T%i R%i = %i', (a, d, p, e, t, r, expected) => {
    expect(damage(a, d, p, e, t, r)).toBe(expected);
  });
  test('immunities and chart zero precede minimum damage; cover precedes elevation', () => {
    expect(effectiveness('electric', 'rock', SPECIES.geodude.immunities)).toBe(0);
    expect(effectiveness('normal', 'ghost')).toBe(0);
    expect(effectiveness('ghost', 'normal')).toBe(0);
    expect(effectiveness('fighting', 'ghost')).toBe(0);
    expect(damage(60, 65, 10, 0, 100, 100)).toBe(0);
    expect(damage(1, 1000, 5, 50, 80, 85)).toBe(1);
    expect(terrainMultiplier('mountain', 'forest')).toBe(80);
    expect(terrainMultiplier('mountain', 'mountain')).toBe(80);
    expect(terrainMultiplier('mountain', 'grassland')).toBe(120);
  });
  test.each([[74, 15, 1000, false, false, 47], [74, 15, 1500, false, false, 71],
    [74, 15, 1000, true, false, 57], [130, 20, 1500, true, true, 43]] as const)(
    'capture %i/%i ×%i observation=%s rare=%s -> %i', (maxHp, hp, ball, observed, rare, expected) => {
      expect(captureProbability(maxHp, hp, ball, observed, rare)).toBe(expected);
    });
});

test('47 species, budgets/costs, nine rare, legacy D15 all same-stage pairs ≤60%', () => {
  expect(Object.keys(SPECIES)).toHaveLength(47);
  expect(Object.keys(SPECIES)).toEqual(Object.keys(BASE_SPECIES_NAMES));
  expect(() => validateSpecies(SPECIES)).not.toThrow();
  expect(() => validateSpecies({ ...SPECIES, bulbasaur: { ...SPECIES.bulbasaur, maxHp: 500 } })).toThrow();
  const definitions = Object.values(SPECIES);
  expect(definitions.filter(d => d.rare)).toHaveLength(9);
  let maxRatio = 0;
  for (const attacker of definitions) for (const defender of definitions) {
    expect(attacker.power).toBe(10);
    if (attacker.stage !== defender.stage) continue;
    const e = effectiveness(attacker.typeId, defender.typeId, defender.immunities, true);
    if (e !== 220) continue;
    const hit = damage(attacker.attack, defender.defense, 10, e, 120, 100);
    maxRatio = Math.max(maxRatio, hit / defender.maxHp);
    expect(hit * 100).toBeLessThanOrEqual(defender.maxHp * 60);
  }
  expect(maxRatio).toBe(0.6);
  expect(SPECIES.dratini.spawnBiomes).toEqual(['snow']);
  expect(SPECIES.dratini.terrain).not.toContain('ocean');
  expect(speciesDisplay('dragonite')).toEqual({ name: '快龙', abbreviation: '快' });
});

test('expanded full-type researched dual weaknesses retain the same-stage D15 limit', () => {
  const definitions = Object.values(EXPANSION_CONTENT.species);
  for (const attacker of definitions) for (const defender of definitions) {
    if (attacker.stage !== defender.stage) continue;
    const types = defender.secondaryTypeId ? [defender.typeId, defender.secondaryTypeId] : [defender.typeId];
    const multiplier = dualEffectiveness(attacker.typeId, types, true);
    const hit = damage(attacker.attack, defender.defense, attacker.power, multiplier, 120, 100);
    expect(hit * 100, `${attacker.name} → ${defender.name}`).toBeLessThanOrEqual(defender.maxHp * 60);
  }
});
