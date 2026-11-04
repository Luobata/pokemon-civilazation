import { expect, test } from 'vitest';
import { BATTLE_CONTENT, ROSTER_CONTENT, contentFor } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit, maxUnitHp } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { STRENGTH_RULES, strengthFromPermille, toStrength } from '../../src/core/strength.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
function arena(version: GameplayVersion, attacker: SpeciesId, defender: SpeciesId, defenderBiome: 'grassland' | 'forest' = 'grassland'): GameState {
  const state = createGame(duel(version)), content = contentFor(state.setup);
  state.map.tiles.fill('grassland'); state.units = {}; state.diplomacy[0].status = 'war';
  state.cities[state.players[0].headquartersCityId].position = { q: 3, r: 3 };
  state.cities[state.players[1].headquartersCityId].position = { q: 20, r: 12 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, content, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, content, 0, 1);
  state.map.tiles[hexToIndex({ q: 10, r: 6 }, state.map)!] = defenderBiome;
  refreshKnowledge(state);
  return state;
}
const preview = (state: GameState) => { const result = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 }); if (!result.ok) throw new Error(result.reason); return result; };

test('v20 content: strength stats, 100 HP, its own version; older versions keep their content', () => {
  expect(gameVersions({ gameplayVersion: 20 })).toEqual({ schemaVersion: 15, rulesVersion: 'strength-v20' });
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 20 })).toBe(BATTLE_CONTENT);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 19 })).toBe(ROSTER_CONTENT);
  expect(BATTLE_CONTENT.species.charizard.attack).toBe(toStrength(ROSTER_CONTENT.species.charizard.attack));
  expect(maxUnitHp({ kind: 'pokemon', speciesId: 'rattata' }, BATTLE_CONTENT)).toBe(100);
  // Old multipliers become the nearest flat bonus.
  expect([1200, 800, 1150, 1000].map(strengthFromPermille)).toEqual([5, -6, 3, 0]);
});

test('v20: the preview lists each bonus, the gap matches the totals, and the authority stays inside the range', () => {
  // 小火龙 (fire) on 妙蛙种子 (grass/poison) in a forest: type +10 for the attacker, cover +5 for the defender.
  const state = arena(20, 'charmander', 'bulbasaur', 'forest'), result = preview(state), strength = result.strength!;
  expect(strength.factors).toContainEqual(expect.objectContaining({ side: 'attack', value: STRENGTH_RULES.typeStep }));
  expect(strength.factors).toContainEqual({ side: 'defense', label: '森林掩护', value: STRENGTH_RULES.cover });
  const sum = (side: 'attack' | 'defense') => strength.factors.filter(factor => factor.side === side).reduce((total, factor) => total + factor.value, 0);
  expect(strength.gap).toBe(strength.attack + sum('attack') - strength.defense - sum('defense'));
  for (const [a, d] of [['charmander', 'bulbasaur'], ['machop', 'rattata'], ['sandshrew', 'ponyta'], ['geodude', 'squirtle']] as [SpeciesId, SpeciesId][]) {
    const fight = arena(20, a, d), expected = preview(fight), hp = fight.units[9001].hp, attackerHp = fight.units[9000].hp;
    resolveAttack(fight, 9000, { kind: 'unit', id: 9001 });
    expect(hp - fight.units[9001].hp).toBeGreaterThanOrEqual(expected.damage.min);
    expect(hp - fight.units[9001].hp).toBeLessThanOrEqual(expected.damage.max);
    expect(attackerHp - fight.units[9000].hp).toBe(expected.counter.trigger === 'never' ? 0 : expected.counter.damage);
  }
});

test('v20: equal strength deals about 15; immunity deals nothing; older rules keep the multiplier formula', () => {
  const equal = preview(arena(20, 'rattata', 'rattata'));
  expect(equal.strength!.gap).toBe(BATTLE_CONTENT.species.rattata.attack - BATTLE_CONTENT.species.rattata.defense);
  expect(equal.damage.max).toBeGreaterThan(5);
  expect(equal.damage.max).toBeLessThan(40);
  // 小拉达 (normal) cannot hurt 鬼斯 (ghost).
  expect(preview(arena(20, 'rattata', 'gastly')).damage).toEqual({ min: 0, max: 0 });
  // Older rules keep the multiplier formula (no strength breakdown); 穿山鼠 vs 小拉达 has no v19 class modifiers either.
  const v19 = preview(arena(19, 'sandshrew', 'rattata'));
  expect(v19.strength).toBeUndefined();
  expect(v19.damage).toEqual(preview(arena(18, 'sandshrew', 'rattata')).damage);
});
