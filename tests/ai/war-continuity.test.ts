import { expect, test } from 'vitest';
import { combatFixture, pokemon } from '../core/combat-fixture.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { canSiege, planNext } from '../../src/ai/plan.ts';
import { eraCivilizationPolicy } from '../../src/ai/war-plan.ts';
import { AI_THRESHOLDS } from '../../src/ai/thresholds.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import type { RuleQueries } from '../../src/ai/query.ts';
import type { AiPersonality, GameSetup, PlayerView } from '../../src/core/model.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import { hexToIndex } from '../../src/core/hex.ts';

type EraView = PlayerView & { eraProgression?: 'simple-v1' | 'full-v1' };
function quiet(personality: AiPersonality, expansion = false) {
  const state = expansion
    ? createGame({ seed: 12345, width: 16, height: 8, expansionVersion: 1,
      players: [{ id: 0, controller: 'ai', personality, leaderId: 'oak' }, { id: 1, controller: 'ai', leaderId: 'lance' }] }, EXPANSION_CONTENT)
    : combatFixture();
  state.players[0].personality = personality;
  state.players[0].research.unlockedIds = Object.keys(state.players[0].research.progressByTech) as never[];
  refreshKnowledge(state);
  const view = observe(state, 0);
  view.map.tiles.fill('grassland');
  view.knowledge.exploredTileIds = view.map.tiles.map((_, index) => index);
  return { state, view: view as EraView };
}
function enableEra(view: EraView) {
  view.eraProgression = 'simple-v1';
}
function rememberEnemyHeadquarters(view: EraView, q = 10, id = 2) {
  view.knowledge.lastKnownCities[id] = { ownerId: 1, headquartersOf: 1, position: { q, r: 2 }, lastSeenRound: 1 };
}
function rememberEnemyUnits(view: EraView, count: number) {
  for (let index = 0; index < count; index++) {
    view.knowledge.lastKnownUnits[20 + index] = {
      kind: 'pokemon', speciesId: 'bulbasaur', ownerId: 1, position: { q: 11, r: 2 }, lastSeenRound: 1,
    };
  }
}

test('era progression lets expansion declare only at its 2x border advantage; legacy expansion never declares', () => {
  const allied = quiet('expansion', true);
  allied.state.expansion!.civilization.relations['0:1']!.allianceSinceRound = 1;
  const alliedView = observe(allied.state, 0) as EraView;
  alliedView.map.tiles.fill('grassland');
  alliedView.knowledge.exploredTileIds = alliedView.map.tiles.map((_, index) => index);
  for (let id = 10; id < 14; id++) alliedView.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(alliedView, 2);
  rememberEnemyHeadquarters(alliedView, 8);
  enableEra(alliedView);
  expect(planNext(alliedView).action.type).not.toBe('DeclareWar');

  const { view } = quiet('expansion');
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(view, 2);
  rememberEnemyHeadquarters(view, 8);
  expect(planNext(view).action.type).not.toBe('DeclareWar');
  enableEra(view);
  expect(planNext(view).action).toEqual({ type: 'DeclareWar', targetPlayerId: 1 });
  rememberEnemyHeadquarters(view, 9);
  expect(planNext(view).action.type).not.toBe('DeclareWar');
  rememberEnemyHeadquarters(view, 8);
  view.units.pop();
  expect(planNext(view).action.type).not.toBe('DeclareWar');
});

test('era rally continues toward one target below the unchanged siege threshold', () => {
  const { view } = quiet('aggressive');
  view.diplomacy[0].status = 'war';
  view.diplomacy[0].declaredBy = 1;
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(view, 3);
  rememberEnemyHeadquarters(view, 10);
  const ai = { ...AI_THRESHOLDS, aggressiveSiegeUnits: 5, aggressiveSeekUnknownHq: false, aggressiveSiegeCaptureBonus: 0, aggressiveSiegeTrainingBonus: 0 };
  const to = { q: 4, r: 2 };
  view.visibleTileIds.push(hexToIndex(to, view.map)!);
  const query: RuleQueries = { ...RULE_QUERIES, ai, attack: () => ({ ok: false as const, reason: 'test' }),
    paths: (_view, id) => id === 10 ? { [hexToIndex(to, view.map)!]: [to] } : {} };
  expect(canSiege(view, 1, ai)).toBe(false);
  expect(planNext(view, query).action.type).not.toBe('Move');
  enableEra(view);
  expect(planNext(view, query).action).toEqual({ type: 'Move', unitId: 10, to });
  expect(planNext(structuredClone(view), query)).toEqual(planNext(view, query));
});

test('an active era campaign rejects a one-city-loss peace exit; legacy behavior and no-target fallback remain', () => {
  const { view } = quiet('aggressive');
  view.diplomacy[0].status = 'war';
  view.diplomacy[0].proposal = { proposerId: 1, recipientId: 0 };
  view.diplomacy[0].citiesLostSinceWar[0] = 1;
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(view, 2);
  rememberEnemyHeadquarters(view);
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', accept: true });
  enableEra(view);
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', accept: false });
  view.knowledge.lastKnownCities = {};
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', accept: true });
});

test('era attacks prioritize the shared campaign target while leaving the combat threshold unchanged', () => {
  const { view } = quiet('aggressive');
  view.diplomacy[0].status = 'war';
  view.diplomacy[0].declaredBy = 1;
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(view, 1);
  rememberEnemyHeadquarters(view, 5, 2);
  view.cities.push(
    { id: 2, ownerId: 1, headquartersOf: 1, position: { q: 5, r: 2 } },
    { id: 3, ownerId: 1, position: { q: 4, r: 2 } },
  );
  view.combat.cities[2] = { hp: 60, counterAttack: 30 };
  view.combat.cities[3] = { hp: 60, counterAttack: 30 };
  enableEra(view);
  expect(canSiege(view, 1)).toBe(true);
  expect(planNext(view).action).toMatchObject({ type: 'Attack', target: { kind: 'city', id: 2 } });
});

test('era peace continuity applies only to the relation owning the campaign target', () => {
  const { view } = quiet('aggressive');
  view.diplomacy[0].status = 'war';
  view.diplomacy[0].proposal = null;
  view.diplomacy[0].citiesLostSinceWar[0] = 1;
  view.diplomacy.push({ a: 0, b: 2, status: 'war', changedAtRound: 1, declaredBy: 2, cooldownUntilRound: 0,
    rejectedAtRound: {}, citiesLostSinceWar: { 0: 1 }, proposal: { proposerId: 2, recipientId: 0 } });
  view.civilizations.push({ id: 2, eliminated: false });
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  rememberEnemyUnits(view, 2);
  rememberEnemyHeadquarters(view, 8, 2);
  view.knowledge.lastKnownCities[3] = { ownerId: 2, headquartersOf: 2, position: { q: 12, r: 2 }, lastSeenRound: 1 };
  enableEra(view);
  const action = planNext(view).action;
  expect(action).toMatchObject({ type: 'RespondPeace', targetPlayerId: 2, accept: true });
  view.diplomacy[1].proposal = null;
  view.diplomacy[0].proposal = { proposerId: 1, recipientId: 0 };
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', targetPlayerId: 1, accept: false });
});

test('era campaign planning cannot see hidden enemy state', () => {
  const { state } = quiet('aggressive');
  state.diplomacy[0].status = 'war';
  state.diplomacy[0].declaredBy = 1;
  for (let id = 10; id < 14; id++) pokemon(state, id, 'bulbasaur', 0, 3, 2);
  refreshKnowledge(state);
  const observed = observe(state, 0) as EraView;
  enableEra(observed);
  const before = planNext(observed, { ...RULE_QUERIES, ai: { ...AI_THRESHOLDS, aggressiveSiegeUnits: 5 } });
  pokemon(state, 90, 'charizard', 1, 15, 7);
  state.players[1].gold += 9999;
  state.cities[2].position = { q: 15, r: 7 };
  const changed = observe(state, 0) as EraView;
  enableEra(changed);
  expect(changed).toEqual(observed);
  expect(planNext(changed, { ...RULE_QUERIES, ai: { ...AI_THRESHOLDS, aggressiveSiegeUnits: 5 } })).toEqual(before);
});


function allianceView(mode?: EraProgression) {
  const setup: GameSetup = { seed: 12345, width: 24, height: 16, expansionVersion: 1,
    ...(mode ? { eraProgression: mode } : {}), multiplayer: true, players: [
      { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'oak' },
      { id: 1, controller: 'ai', leaderId: 'lance' },
      { id: 2, controller: 'ai', leaderId: 'jenny' },
      { id: 3, controller: 'ai', leaderId: 'joy' },
    ] };
  const state = createGame(setup, EXPANSION_CONTENT);
  state.activePlayerId = 0;
  state.players[0].gold = 0;
  const headquarters = state.cities[state.players[0].headquartersCityId]!;
  state.cities[900] = createCity(900, 0, { q: headquarters.position.q + 1, r: headquarters.position.r }, false, EXPANSION_CONTENT);
  state.cities[901] = createCity(901, 0, { q: headquarters.position.q + 2, r: headquarters.position.r }, false, EXPANSION_CONTENT);
  const enemyHeadquarters = state.cities[state.players[1].headquartersCityId]!;
  enemyHeadquarters.position = { q: headquarters.position.q + 5, r: headquarters.position.r };
  const starter = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  starter.position = { ...enemyHeadquarters.position };
  state.units[902] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 902, 0,
    { q: enemyHeadquarters.position.q + 1, r: enemyHeadquarters.position.r }, EXPANSION_CONTENT, 0, 1);
  refreshKnowledge(state, EXPANSION_CONTENT);
  const observed = observe(state, 0) as EraView;
  observed.map.tiles.fill('grassland');
  observed.knowledge.exploredTileIds = observed.map.tiles.map((_, index) => index);
  return { state, view: observed };
}

test('era strategic alliance blocking ignores own cities and selects the enemy headquarters', () => {
  const { view } = allianceView('simple-v1');
  expect(view.economy.cities.filter(city => city.ownerId === 0)).toHaveLength(3);
  expect(view.cities.some(city => city.ownerId === 1 && city.headquartersOf === 1)).toBe(true);
  expect(eraCivilizationPolicy(view)).toEqual({
    maximumAllies: 1,
    blockedAllianceTargetPlayerIds: [1],
  });
});

test('era alliance policy keeps one ally, avoids its strategic target, and leaves undefined progression unchanged', () => {
  const { state } = allianceView();
  state.expansion!.civilization.relations['0:1']!.trust = 20;
  state.expansion!.civilization.relations['0:2']!.allianceSinceRound = 1;
  state.expansion!.civilization.relations['0:3']!.trust = 20;
  const legacy = observe(state, 0) as EraView;
  legacy.expansion!.world.nests = [];
  legacy.expansion!.world.resources = [];
  legacy.expansion!.world.overlords = [];
  legacy.map.tiles.fill('grassland');
  legacy.knowledge.exploredTileIds = legacy.map.tiles.map((_, index) => index);
  expect(legacy).not.toHaveProperty('eraProgression');
  expect(planNext(legacy).action).toEqual({ type: 'ProposeAlliance', targetPlayerId: 1 });

  const era = structuredClone(legacy);
  era.eraProgression = 'simple-v1';
  expect(planNext(era).action).toEqual({ type: 'ProposeTrade', targetPlayerId: 1 });
  expect(eraCivilizationPolicy(era)).toEqual({
    maximumAllies: 1,
    blockedAllianceTargetPlayerIds: [1],
  });
});
