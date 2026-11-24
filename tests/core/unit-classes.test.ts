import { expect, test } from 'vitest';
import { GAME_CONTENT } from '../../src/content/units.ts';
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
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, GAME_CONTENT, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, GAME_CONTENT, 0, 1);
  refreshKnowledge(state);
  return state;
}
const preview = (state: GameState) => { const result = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 }); if (!result.ok) throw new Error(result.reason); return result; };
const pokemon = (speciesId: SpeciesId) => ({ kind: 'pokemon' as const, speciesId });

test('v27 envelope and neutral non-counter, non-affinity matchups stay at 1000', () => {
  expect(gameVersions({ gameplayVersion: 27 })).toEqual({ schemaVersion: 22, rulesVersion: 'pace-v27' });
  expect(classStrikeMultiplier({ gameplayVersion: 27 }, pokemon('sandshrew'), pokemon('rattata'), GAME_CONTENT)).toBe(1000);
  expect(preview(arena(27, 'sandshrew', 'rattata')).strength.factors.some(f => f.label === '兵种克制' || f.label === '属性契合')).toBe(false);
});

test('v27: melee counters fast, siege is weak in the field, affinity adds 15%; the authority stays inside the preview', () => {
  // 穿山鼠 (melee, ground: no affinity) against 小火马 (fast).
  expect(hasAffinity(pokemon('sandshrew'), GAME_CONTENT)).toBe(false);
  expect(classStrikeMultiplier({ gameplayVersion: 27 }, pokemon('sandshrew'), pokemon('ponyta'), GAME_CONTENT)).toBe(CLASS_RULES.counter);
  expect(preview(arena(27, 'sandshrew', 'ponyta')).strength.factors).toContainEqual({ side: 'attack', label: '兵种克制', value: 5 });
  // 小拳石 (siege, rock: affinity) striking a Pokémon: ×0.8 × 1.15.
  expect(classStrikeMultiplier({ gameplayVersion: 27 }, pokemon('geodude'), pokemon('rattata'), GAME_CONTENT)).toBe(CLASS_RULES.siegeVsUnits * CLASS_RULES.affinity / 1000);
  // 腕力 (melee, fighting: affinity) against 小拉达 (scout: no counter).
  expect(hasAffinity(pokemon('machop'), GAME_CONTENT)).toBe(true);
  expect(preview(arena(27, 'machop', 'rattata')).strength.factors).toContainEqual({ side: 'attack', label: '属性契合', value: 3 });
  for (const [a, d] of [['sandshrew', 'ponyta'], ['machop', 'rattata'], ['ponyta', 'sandshrew']] as [SpeciesId, SpeciesId][]) {
    const state = arena(27, a, d), expected = preview(state);
    const hp = state.units[9001].hp, attackerHp = state.units[9000].hp;
    resolveAttack(state, 9000, { kind: 'unit', id: 9001 });
    expect(hp - state.units[9001].hp).toBeGreaterThanOrEqual(expected.damage.min);
    expect(hp - state.units[9001].hp).toBeLessThanOrEqual(expected.damage.max);
    expect(attackerHp - state.units[9000].hp).toBe(expected.counter.trigger === 'never' ? 0 : expected.counter.damage);
  }
});

test('v27: HMs gate classes, final forms need eliteTraining, the Gold/Silver era and the type badge', () => {
  const queue = (state: GameState, speciesId: SpeciesId) => act(state, { type: 'SetProductionQueue', cityId: hq(state).id, orders: [{ item: { kind: 'pokemon', defId: speciesId } }] }).ok;
  const state = createGame(duel(27)), player = state.players[0];
  player.registeredSpeciesIds.push('golbat', 'venusaur');
  expect(queue(state, 'golbat')).toBe(false); // 飞翔 comes from 飞行训练
  player.research.unlockedIds.push('aviation');
  expect(queue(state, 'golbat')).toBe(true);
  expect(queue(state, 'venusaur')).toBe(false); // missing eliteTraining + generation 2 + badge
  player.research.unlockedIds.push('eliteTraining');
  expect(queue(state, 'venusaur')).toBe(false); // still generation 1 (< 7 techs)
  player.research.unlockedIds.push('domestication', 'berryCultivation', 'stoneCraft', 'seafaring', 'ballCraft');
  expect(queue(state, 'venusaur')).toBe(false); // generation 2 (7 techs), but no 森灵 badge
  state.expansion!.essences!.gyms[hq(state).id] = 'sylvan';
  expect(queue(state, 'venusaur')).toBe(true);
});

test('v27: Rare Candy evolves a stage-1 Pokémon without XP from generation 2, for three times the gold', () => {
  const state = arena(27, 'bulbasaur', 'rattata'), player = state.players[0];
  player.gold = 300;
  expect(act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: 'ivysaur' }).ok).toBe(false); // generation 1
  player.research.unlockedIds.push('domestication', 'berryCultivation', 'stoneCraft', 'seafaring', 'ballCraft', 'riding', 'typeResearch');
  state.expansion!.opening!.objectives[0].push('firstTech'); // avoid +15 opening objective gold mixing with Rare Candy cost
  const evolved = act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: 'ivysaur' });
  expect(evolved.ok).toBe(true);
  if (!evolved.ok) return;
  expect(evolved.state.units[9000]).toMatchObject({ speciesId: 'ivysaur' });
  expect(player.gold - evolved.state.players[0].gold).toBe(GAME_CONTENT.species.bulbasaur.evolution!.gold * CLASS_RULES.candyGoldMultiplier);
});
