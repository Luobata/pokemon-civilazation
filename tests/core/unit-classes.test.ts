import { expect, test } from 'vitest';
import { ROSTER_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { CLASS_RULES } from '../../src/content/unit-classes.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { classStrikeMultiplier, hasAffinity } from '../../src/core/unit-classes.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
const hq = (state: GameState) => state.cities[state.players[0].headquartersCityId];
function arena(version: GameplayVersion, attacker: SpeciesId, defender: SpeciesId): GameState {
  const state = createGame(duel(version));
  state.map.tiles.fill('grassland'); state.units = {}; state.diplomacy[0].status = 'war';
  state.cities[state.players[0].headquartersCityId].position = { q: 3, r: 3 };
  state.cities[state.players[1].headquartersCityId].position = { q: 20, r: 12 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, ROSTER_CONTENT, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, ROSTER_CONTENT, 0, 1);
  refreshKnowledge(state);
  return state;
}
const maxDamage = (state: GameState) => { const preview = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 }); if (!preview.ok) throw new Error(preview.reason); return preview.damage.max; };
const pokemon = (speciesId: SpeciesId) => ({ kind: 'pokemon' as const, speciesId });

test('class counters and type affinity are neutral before v19', () => {
  expect(gameVersions({ gameplayVersion: 19 })).toEqual({ schemaVersion: 14, rulesVersion: 'classes-v19' });
  expect(classStrikeMultiplier({ gameplayVersion: 18 }, pokemon('sandshrew'), pokemon('ponyta'), ROSTER_CONTENT)).toBe(1000);
  expect(maxDamage(arena(18, 'sandshrew', 'ponyta'))).toBe(maxDamage(arena(17, 'sandshrew', 'ponyta')));
});

test('v19: melee counters fast, siege is weak in the field, affinity adds 15%; the authority stays inside the preview', () => {
  // 穿山鼠 (melee, ground: no affinity) against 小火马 (fast).
  expect(hasAffinity(pokemon('sandshrew'), ROSTER_CONTENT)).toBe(false);
  expect(classStrikeMultiplier({ gameplayVersion: 19 }, pokemon('sandshrew'), pokemon('ponyta'), ROSTER_CONTENT)).toBe(CLASS_RULES.counter);
  expect(maxDamage(arena(19, 'sandshrew', 'ponyta'))).toBeGreaterThan(maxDamage(arena(18, 'sandshrew', 'ponyta')));
  // 小拳石 (siege, rock: affinity) striking a Pokémon: ×0.8 × 1.15.
  expect(classStrikeMultiplier({ gameplayVersion: 19 }, pokemon('geodude'), pokemon('rattata'), ROSTER_CONTENT)).toBe(CLASS_RULES.siegeVsUnits * CLASS_RULES.affinity / 1000);
  // 腕力 (melee, fighting: affinity) against 小拉达 (scout: no counter).
  expect(hasAffinity(pokemon('machop'), ROSTER_CONTENT)).toBe(true);
  expect(maxDamage(arena(19, 'machop', 'rattata'))).toBeGreaterThan(maxDamage(arena(18, 'machop', 'rattata')));
  for (const [a, d] of [['sandshrew', 'ponyta'], ['machop', 'rattata'], ['ponyta', 'sandshrew']] as [SpeciesId, SpeciesId][]) {
    const state = arena(19, a, d), preview = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 });
    if (!preview.ok) throw new Error(preview.reason);
    const hp = state.units[9001].hp, attackerHp = state.units[9000].hp;
    resolveAttack(state, 9000, { kind: 'unit', id: 9001 });
    expect(hp - state.units[9001].hp).toBeGreaterThanOrEqual(preview.damage.min);
    expect(hp - state.units[9001].hp).toBeLessThanOrEqual(preview.damage.max);
    expect(attackerHp - state.units[9000].hp).toBe(preview.counter.trigger === 'never' ? 0 : preview.counter.damage);
  }
});

test('v19: HMs gate classes, final forms need the Gold/Silver era and the type badge', () => {
  const queue = (state: GameState, speciesId: SpeciesId) => act(state, { type: 'SetProductionQueue', cityId: hq(state).id, orders: [{ item: { kind: 'pokemon', defId: speciesId } }] }).ok;
  const state = createGame(duel(19)), player = state.players[0];
  player.registeredSpeciesIds.push('golbat', 'venusaur');
  expect(queue(state, 'golbat')).toBe(false); // 飞翔 comes from 气象观测
  player.research.unlockedIds.push('meteorology');
  expect(queue(state, 'golbat')).toBe(true);
  expect(queue(state, 'venusaur')).toBe(false); // generation 1
  player.research.unlockedIds.push('domestication', 'stoneCraft');
  expect(queue(state, 'venusaur')).toBe(false); // generation 2, but no 森灵 badge
  state.expansion!.essences!.gyms[hq(state).id] = 'sylvan';
  expect(queue(state, 'venusaur')).toBe(true);
  const old = createGame(duel(18));
  old.players[0].registeredSpeciesIds.push('venusaur');
  expect(queue(old, 'venusaur')).toBe(true);
});

test('v19: Rare Candy evolves a stage-1 Pokémon without XP from generation 2, for three times the gold', () => {
  const state = arena(19, 'bulbasaur', 'rattata'), player = state.players[0];
  player.gold = 300;
  expect(act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: 'ivysaur' }).ok).toBe(false); // generation 1
  player.research.unlockedIds.push('domestication', 'berryCultivation', 'stoneCraft');
  const evolved = act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: 'ivysaur' });
  expect(evolved.ok).toBe(true);
  if (!evolved.ok) return;
  expect(evolved.state.units[9000]).toMatchObject({ speciesId: 'ivysaur' });
  expect(player.gold - evolved.state.players[0].gold).toBe(ROSTER_CONTENT.species.bulbasaur.evolution!.gold * CLASS_RULES.candyGoldMultiplier);
});
