import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { TECHS } from '../../src/content/economy.ts';
import type { TechId } from '../../src/content/economy.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { cityAssaultMultiplier, ROLE_CITY_ASSAULT, trainableSpeciesIds } from '../../src/core/role-tactics.ts';
import { step } from '../../src/core/step.ts';
import { leaderResearchBonus, roleTrainingBonus } from '../../src/ai/role-plan.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { EraProgression } from '../../src/content/eras.ts';

const techs = (count: number) => Object.keys(TECHS).slice(0, count) as TechId[];
const pokemon = (speciesId: SpeciesId) => ({ kind: 'pokemon' as const, speciesId });

function setup(mode?: EraProgression, leaderId: LeaderId = 'jenny'): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
    ...(mode ? { eraProgression: mode, gameplayVersion: 1 as const } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}

test('legacy games keep the original siege-only multiplier', () => {
  expect(cityAssaultMultiplier(undefined, undefined, undefined, pokemon('machop'), EXPANSION_CONTENT, 1, false)).toBe(null);
});

test('era roles split city assault: ranged walls, melee breach, siege engines', () => {
  const player = { leaderId: 'oak' as const, research: { unlockedIds: [] as TechId[] } };
  const m = (id: SpeciesId, distance: number, siegeTech = false) => cityAssaultMultiplier(player, 'simple-v1', 1, pokemon(id), EXPANSION_CONTENT, distance, siegeTech)!;
  expect(m('bulbasaur', 2)).toBe(ROLE_CITY_ASSAULT.ranged.distant);
  expect(m('machop', 1)).toBeGreaterThan(m('bulbasaur', 1));
  expect(m('machop', 2)).toBe(1000);
  expect(m('geodude', 2)).toBe(1300);
  expect(m('geodude', 2, true)).toBe(1750);
  expect(m('rattata', 1)).toBeLessThan(m('bulbasaur', 1));
});

test('leader windows shift which roles break cities', () => {
  const jenny = (count: number) => ({ leaderId: 'jenny' as const, research: { unlockedIds: techs(count) } });
  // Early Jenny: no city bonus. Middle: siege +20%. Late: melee and siege +20%.
  expect(cityAssaultMultiplier(jenny(0), 'simple-v1', 1, pokemon('geodude'), EXPANSION_CONTENT, 2, false)).toBe(1300);
  expect(cityAssaultMultiplier(jenny(3), 'simple-v1', 1, pokemon('geodude'), EXPANSION_CONTENT, 2, false)).toBe(1560);
  expect(cityAssaultMultiplier(jenny(3), 'simple-v1', 1, pokemon('machop'), EXPANSION_CONTENT, 1, false)).toBe(1250);
  expect(cityAssaultMultiplier(jenny(7), 'simple-v1', 1, pokemon('machop'), EXPANSION_CONTENT, 1, false)).toBe(1500);
  const lance = { leaderId: 'lance' as const, research: { unlockedIds: techs(7) } };
  expect(cityAssaultMultiplier(lance, 'simple-v1', 1, pokemon('ponyta'), EXPANSION_CONTENT, 1, false)).toBe(1380);
});

function warFixture(mode: EraProgression | undefined, attackerSpecies: SpeciesId): { state: GameState; attackerId: number; cityId: number } {
  const state = createGame(setup(mode, 'jenny'));
  state.players[0].research.unlockedIds = techs(7);
  const cityId = state.players[1].headquartersCityId, city = state.cities[cityId];
  const index = state.map.tiles.findIndex((biome, i) => biome !== 'ocean' && hexDistance(indexToHex(i, state.map), city.position, state.map) === 1
    && !Object.values(state.units).some(unit => unit.position && hexDistance(unit.position, indexToHex(i, state.map), state.map) === 0));
  const unit = createMapUnit(pokemon(attackerSpecies), 9000, 0, indexToHex(index, state.map), EXPANSION_CONTENT, 0, 1);
  state.units[unit.id] = unit;
  const pair = state.diplomacy.find(item => item.a === 0 && item.b === 1)!;
  pair.status = 'war';
  refreshKnowledge(state);
  return { state, attackerId: unit.id, cityId };
}

test('preview equals authoritative city damage in era and legacy modes', () => {
  for (const mode of [undefined, 'simple-v1'] as const) for (const species of ['machop', 'bulbasaur', 'geodude'] as SpeciesId[]) {
    const { state, attackerId, cityId } = warFixture(mode, species);
    const preview = previewAttack(observe(state, 0), attackerId, { kind: 'city', id: cityId });
    expect(preview.ok).toBe(true);
    const before = state.cities[cityId].hp;
    resolveAttack(state, attackerId, { kind: 'city', id: cityId });
    const dealt = before - state.cities[cityId].hp;
    if (preview.ok) { expect(dealt).toBeGreaterThanOrEqual(Math.min(before, preview.damage.min)); expect(dealt).toBeLessThanOrEqual(preview.damage.max); }
  }
});

test('late-era Jenny melee breaches cities harder than a legacy-rule ranged attacker', () => {
  const melee = warFixture('simple-v1', 'machop'), ranged = warFixture('simple-v1', 'bulbasaur');
  const meleePreview = previewAttack(observe(melee.state, 0), melee.attackerId, { kind: 'city', id: melee.cityId });
  const rangedPreview = previewAttack(observe(ranged.state, 0), ranged.attackerId, { kind: 'city', id: ranged.cityId });
  expect(meleePreview.ok && rangedPreview.ok).toBe(true);
  if (meleePreview.ok && rangedPreview.ok) expect(meleePreview.damage.max).toBeGreaterThan(rangedPreview.damage.max * 1.5);
});

test('AI planning follows the leader window only in era mode', () => {
  const era = observe(createGame(setup('simple-v1', 'jenny')), 0);
  const legacy = observe(createGame(setup(undefined, 'jenny')), 0);
  expect(leaderResearchBonus(era, 'siegeCraft')).toBeGreaterThan(0);
  expect(leaderResearchBonus(era, 'riding')).toBe(0);
  expect(leaderResearchBonus(legacy, 'siegeCraft')).toBe(0);
  expect(roleTrainingBonus(era, 'machop', EXPANSION_CONTENT, true)).toBeGreaterThan(roleTrainingBonus(era, 'bulbasaur', EXPANSION_CONTENT, true));
  expect(roleTrainingBonus(legacy, 'machop', EXPANSION_CONTENT, true)).toBe(0);
});

test('era garrison recruits unlock with technology and are validated by authority', () => {
  const player = { registeredSpeciesIds: ['bulbasaur'] as SpeciesId[], research: { unlockedIds: ['stoneCraft', 'riding'] as TechId[] } };
  expect(trainableSpeciesIds(player, undefined)).toEqual(['bulbasaur']);
  expect(trainableSpeciesIds(player, 1)).toEqual(['bulbasaur', 'geodude', 'ponyta']);
  for (const mode of [undefined, 'simple-v1'] as const) {
    const state = createGame(setup(mode, 'jenny'));
    state.players[0].research.unlockedIds = ['stoneCraft'];
    const cityId = state.players[0].headquartersCityId;
    const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'SetProductionQueue', cityId, orders: [{ item: { kind: 'pokemon', defId: 'geodude' } }] } });
    expect(result.ok).toBe(mode !== undefined);
  }
});

test('era games without a gameplay pack keep the c8a830c assault and recruit rules', () => {
  const player = { leaderId: 'jenny' as const, research: { unlockedIds: techs(7) } };
  expect(cityAssaultMultiplier(player, 'simple-v1', undefined, pokemon('machop'), EXPANSION_CONTENT, 1, false)).toBe(null);
  const state = createGame({ ...setup('simple-v1', 'jenny'), gameplayVersion: undefined });
  delete state.setup.gameplayVersion;
  state.players[0].research.unlockedIds = ['stoneCraft'];
  const cityId = state.players[0].headquartersCityId;
  expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'SetProductionQueue', cityId, orders: [{ item: { kind: 'pokemon', defId: 'geodude' } }] } }).ok).toBe(false);
  expect(() => createGame({ ...setup(undefined), gameplayVersion: 1 })).toThrow();
});
