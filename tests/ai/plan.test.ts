import { expect, test } from 'vitest';
import { combatFixture, pokemon } from '../core/combat-fixture.ts';
import { createCity } from '../../src/core/city.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { canCaptureByPersonality, canProduceSettler, canSiege, knownCombatCount, planNext } from '../../src/ai/plan.ts';
import { CONTENT } from '../../src/content/units.ts';
import type { AiPersonality, PlayerView } from '../../src/core/model.ts';
import type { RuleQueries } from '../../src/ai/query.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { AI_THRESHOLDS } from '../../src/ai/thresholds.ts';
import { parsePatch } from '../../tools/patch.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';

function quiet(personality: AiPersonality) {
  const state = combatFixture(); state.players[0].personality = personality;
  state.players[0].research.unlockedIds = Object.keys(CONTENT.techs) as (keyof typeof CONTENT.techs)[];
  state.cities[1].queue = [{ id: 51, progress: 0, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  state.cities[1].workedTileIds = [0, 1];
  refreshKnowledge(state); const view = observe(state, 0); view.map.tiles.fill('grassland');
  view.knowledge.exploredTileIds = view.map.tiles.map((_, i) => i);
  return { state, view };
}

test.each(['expansion', 'conservative'] as const)('%s never declares, expansion never sieges', personality => {
  const { view } = quiet(personality);
  for (let id = 10; id < 14; id++) view.units.push({ ...pokemon(combatFixture(), id), position: { q: 9, r: 2 } });
  view.cities.push({ id: 2, ownerId: 1, position: { q: 10, r: 2 } });
  expect(planNext(view).action.type).not.toBe('DeclareWar');
  expect(canSiege(view, 1)).toBe(false);
});
test('aggressive declaration uses observed 1.5 strength, border 5/6; siege 3/4', () => {
  const { view } = quiet('aggressive');
  for (let id = 10; id < 13; id++) view.units.push(pokemon(combatFixture(), id));
  view.knowledge.lastKnownUnits[20] = { kind: 'pokemon', speciesId: 'bulbasaur', ownerId: 1, position: { q: 10, r: 3 }, lastSeenRound: 1 };
  view.knowledge.lastKnownUnits[21] = { ...view.knowledge.lastKnownUnits[20] };
  view.knowledge.lastKnownCities[2] = { ownerId: 1, position: { q: 8, r: 3 }, lastSeenRound: 1 };
  expect(planNext(view).action).toEqual({ type: 'DeclareWar', targetPlayerId: 1 });
  view.knowledge.lastKnownCities[2].position.q = 9;
  expect(planNext(view).action.type).not.toBe('DeclareWar');
  expect(canSiege(view, 1)).toBe(false);
  view.units.push(pokemon(combatFixture(), 13)); expect(canSiege(view, 1)).toBe(true);
  view.units.pop(); view.units.pop(); view.knowledge.lastKnownCities[2].position.q = 8;
  expect(planNext(view).action.type).not.toBe('DeclareWar');
});
test('conservative counteroffensive requires own defensive war and twice known military', () => {
  const { view } = quiet('conservative'); view.units.push(pokemon(combatFixture()));
  view.knowledge.lastKnownUnits[20] = { kind: 'pokemon', speciesId: 'bulbasaur', ownerId: 1, position: { q: 10, r: 3 }, lastSeenRound: 1 };
  view.diplomacy[0].status = 'war'; view.diplomacy[0].declaredBy = 1;
  expect(canSiege(view, 1)).toBe(false);
  view.units.push(pokemon(combatFixture(), 11)); expect(canSiege(view, 1)).toBe(true);
  view.diplomacy[0].declaredBy = 0; expect(canSiege(view, 1)).toBe(false);
});
test('settler quotas include map, queue, pending; conservative 14/15 and aggressive cities2/3', () => {
  const { view } = quiet('conservative'); view.economy.player.lastSettlerProducedRound = 1;
  view.round = 15; expect(canProduceSettler(view)).toBe(false);
  view.round = 16; expect(canProduceSettler(view)).toBe(true);
  view.economy.cities[0].pendingDeployments = [{ enteredAtRound: 2, sourceOrderId: 50, item: { kind: 'logistics', defId: 'settler' } }];
  expect(canProduceSettler(view)).toBe(false); view.economy.cities[0].pendingDeployments = [];
  view.diplomacy[0].status = 'war'; expect(canProduceSettler(view)).toBe(false); view.diplomacy[0].status = 'peace';
  view.economy.player.personality = 'aggressive'; view.economy.cities.push({ ...view.economy.cities[0], id: 3 });
  expect(canProduceSettler(view)).toBe(false); view.economy.cities.push({ ...view.economy.cities[0], id: 4 }); expect(canProduceSettler(view)).toBe(true);
  view.economy.player.personality = 'expansion'; expect(canProduceSettler(view)).toBe(true);
  view.economy.cities[0].queue[0].item = { kind: 'logistics', defId: 'settler' }; expect(canProduceSettler(view)).toBe(false);
});
test('expansion capture strictly below50%; conservative territory only', () => {
  const { view } = quiet('expansion'), wild = pokemon(combatFixture(), 11, 'charmander', null, 4, 2);
  const content = structuredClone(CONTENT); content.species.charmander.maxHp = 100;
  const query = { ...RULE_QUERIES, content };
  wild.hp = 50; expect(canCaptureByPersonality(view, wild, query)).toBe(false);
  wild.hp = 49; expect(canCaptureByPersonality(view, wild, query)).toBe(true);
  view.economy.player.personality = 'conservative'; expect(canCaptureByPersonality(view, wild)).toBe(true);
  wild.position.q = 5; expect(canCaptureByPersonality(view, wild)).toBe(false);
});
test('aggressive capture prefers war zone distance6 over7, with equal probability', () => {
  const { view } = quiet('aggressive'); view.units.push(pokemon(combatFixture(), 10, 'bulbasaur', 0, 8, 3));
  view.units.push(pokemon(combatFixture(), 11, 'charmander', null, 9, 2));
  view.units.push(pokemon(combatFixture(), 12, 'charmander', null, 8, 2));
  // Remove attack candidates so this scenario isolates the documented capture preference.
  const query = { ...RULE_QUERIES, attack: () => ({ ok: false as const, reason: 'immune' }), paths: () => ({}) };
  view.economy.player.ballInventory.pokeBall = 2;
  expect(planNext(view, query).action).toEqual({ type: 'Capture', unitId: 10, targetUnitId: 12, ballId: 'pokeBall' });
});
test.each(['expansion', 'aggressive', 'conservative'] as const)('%s responds to proposals before other work', personality => {
  const { view } = quiet(personality); view.diplomacy[0].status = 'war';
  view.diplomacy[0].proposal = { proposerId: 1, recipientId: 0 };
  expect(planNext(view).action).toEqual({ type: 'RespondPeace', targetPlayerId: 1, accept: personality === 'conservative' });
  view.diplomacy[0].citiesLostSinceWar[0] = 1;
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', accept: true });
});
test('no useful action ends; unavailable inventory and recovery do not create actions; view unchanged', () => {
  const { view } = quiet('conservative');
  const unit = pokemon(combatFixture()); unit.actionLeft = 0; view.units.push(unit);
  view.units.push(pokemon(combatFixture(), 11, 'charmander', null, 4, 3)); view.economy.player.gold = 0;
  view.recoveringUnits.push({ ...unit, id: 12, location: 'recovering', position: null, cityId: 1, roundsLeft: 2 });
  const before = structuredClone(view);
  expect(planNext(view).action).toEqual({ type: 'EndTurn' }); expect(view).toEqual(before);
  expect(planNext(view)).toEqual(planNext(structuredClone(view)));
});
test('hidden state cannot change observation/plans; known combat deduplicates current and memory', () => {
  const { state } = quiet('expansion'); pokemon(state); refreshKnowledge(state);
  const view = observe(state, 0), original = planNext(view);
  pokemon(state, 99, 'charizard', 1, 12, 5); state.players[1].gold = 9999;
  expect(observe(state, 0)).toEqual(view); expect(planNext(observe(state, 0))).toEqual(original);
  expect(knownCombatCount(view, 0)).toBe(1);
});
test('mixed human/AI full game logs replay without rerunning planner', () => {
  const setup = combatFixture().setup;
  const session = new GameSession(setup);
  while (!session.getView().outcome) expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(session.aiInvalidCommands).toEqual([]);
  const log = session.exportLog();
  expect(log.commands.some(command => command.actorId === 1 && command.action.type !== 'EndTurn')).toBe(true);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(session.getState()));
  expect(session.getView().outcome?.round).toBeLessThanOrEqual(100);
  expect(['playerDefeat', 'conquest', 'score']).toContain(session.getView().outcome?.kind);
}, 30_000);
test('aggressive known HQ advance starts at four combat units', () => {
  const { view } = quiet('aggressive'); view.diplomacy[0].status = 'war';
  view.knowledge.lastKnownCities[2] = { ownerId: 1, headquartersOf: 1, position: { q: 10, r: 2 }, lastSeenRound: 1 };
  for (let id = 10; id < 13; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, id - 8));
  const query: RuleQueries = { ...RULE_QUERIES, paths: (_view: PlayerView, id: number): ReturnType<RuleQueries['paths']> => id === 10 ? { 37: [{ q: 3, r: 2 }, { q: 4, r: 2 }] } : {} };
  expect(planNext(view, query).action.type).toBe('EndTurn');
  view.units.push(pokemon(combatFixture(), 13));
  expect(planNext(view, query).action.type).toBe('Move');
});
test('no repeated queue/research settings and pending production counts as settler', () => {
  const { view } = quiet('expansion');
  view.economy.player.research.techId = 'domestication';
  view.economy.cities = [{ ...view.economy.cities[0], ...createCity(1, 0, { q: 2, r: 2 }), queue: [{ id: 55, progress: 0, item: { kind: 'logistics', defId: 'settler' } }] }];
  view.economy.cities[0].availableTileIds = []; expect(planNext(view).action.type).toBe('EndTurn');
});

test('injected personality thresholds change only their corresponding decisions', () => {
  const ai = { ...AI_THRESHOLDS, aggressiveSettlerCities: 2, aggressiveWarStrength: 2000, aggressiveBorderDistance: 6,
    aggressiveSiegeUnits: 3, aggressiveCaptureRadius: 7, conservativeStrength: 1000,
    conservativeSettlerInterval: 20, peaceCitiesLost: 2, expansionCaptureHpPercent: 60 };
  const { view } = quiet('aggressive');
  view.economy.cities.push({ ...view.economy.cities[0], id: 3 });
  expect(canProduceSettler(view)).toBe(false); expect(canProduceSettler(view, ai)).toBe(true);
  for (let id = 10; id < 13; id++) view.units.push(pokemon(combatFixture(), id));
  expect(canSiege(view, 1)).toBe(false); expect(canSiege(view, 1, ai)).toBe(true);
  view.knowledge.lastKnownUnits[20] = { kind: 'pokemon', speciesId: 'bulbasaur', ownerId: 1, position: { q: 10, r: 3 }, lastSeenRound: 1 };
  view.knowledge.lastKnownUnits[21] = { ...view.knowledge.lastKnownUnits[20] };
  view.knowledge.lastKnownCities[2] = { ownerId: 1, position: { q: 8, r: 3 }, lastSeenRound: 1 };
  expect(planNext(view).action.type).toBe('DeclareWar');
  expect(planNext(view, { ...RULE_QUERIES, ai }).action.type).not.toBe('DeclareWar');
  view.knowledge.lastKnownCities[2].position.q = 9;
  expect(planNext(view, { ...RULE_QUERIES, ai: { ...ai, aggressiveWarStrength: 1500 } }).action.type).toBe('DeclareWar');
  view.diplomacy[0].status = 'war'; view.diplomacy[0].proposal = { proposerId: 1, recipientId: 0 };
  view.diplomacy[0].citiesLostSinceWar[0] = 1;
  expect(planNext(view).action).toMatchObject({ type: 'RespondPeace', accept: true });
  expect(planNext(view, { ...RULE_QUERIES, ai }).action).toMatchObject({ type: 'RespondPeace', accept: false });
  view.economy.player.personality = 'conservative'; view.diplomacy[0].declaredBy = 1;
  expect(canSiege(view, 1)).toBe(false); expect(canSiege(view, 1, ai)).toBe(true);
  view.diplomacy[0].status = 'peace'; view.round = 16; view.economy.player.lastSettlerProducedRound = 1;
  expect(canProduceSettler(view)).toBe(true); expect(canProduceSettler(view, ai)).toBe(false);
  view.economy.player.personality = 'expansion';
  const wild = pokemon(combatFixture(), 11, 'charmander', null); wild.hp = Math.floor(CONTENT.species.charmander.maxHp / 2);
  expect(canCaptureByPersonality(view, wild)).toBe(false);
  expect(canCaptureByPersonality(view, wild, { ...RULE_QUERIES, ai })).toBe(true);
});

test('territory capture patch reaches the planner without changing other personalities', () => {
  const { view } = quiet('conservative');
  const wild = pokemon(combatFixture(), 11, 'charmander', null, 5, 2);
  view.units.push(pokemon(combatFixture(), 10, 'bulbasaur', 0, 4, 3), wild);
  view.economy.player.ballInventory.pokeBall = 2;
  const query = { ...RULE_QUERIES, attack: () => ({ ok: false as const, reason: 'immune' }), paths: () => ({}) };
  const experiment = parsePatch({ ai: { conservativeCaptureTerritoryOnly: false } });
  expect(planNext(view, query).action.type).toBe('EndTurn');
  expect(planNext(view, { ...query, ...experiment }).action).toMatchObject({ type: 'Capture', targetUnitId: 11 });
  expect(canCaptureByPersonality(view, { ...wild, ownerId: 1 }, { ...query, ...experiment })).toBe(false);
  for (const personality of ['expansion', 'aggressive'] as const) {
    view.economy.player.personality = personality;
    expect(planNext(view, { ...query, ...experiment })).toEqual(planNext(view, query));
  }
});

test('D41 declaration has independent 2x strength and distance1 boundaries; own war can siege only when enabled', () => {
  const { view } = quiet('conservative');
  for (let id = 10; id < 12; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 8, 2));
  view.knowledge.lastKnownUnits[20] = { kind: 'pokemon', speciesId: 'bulbasaur', ownerId: 1, position: { q: 10, r: 2 }, lastSeenRound: 1 };
  view.knowledge.lastKnownCities[2] = { ownerId: 1, position: { q: 9, r: 2 }, lastSeenRound: 1 };
  const { ai } = parsePatch({ ai: { conservativeMayDeclareWar: true } });
  expect(planNext(view).action.type).not.toBe('DeclareWar');
  expect(planNext(view, { ...RULE_QUERIES, ai }).action).toEqual({ type: 'DeclareWar', targetPlayerId: 1 });
  view.knowledge.lastKnownCities[2].position.q = 10;
  expect(planNext(view, { ...RULE_QUERIES, ai }).action.type).not.toBe('DeclareWar');
  view.knowledge.lastKnownCities[2].position.q = 9;
  view.units.pop();
  expect(planNext(view, { ...RULE_QUERIES, ai }).action.type).not.toBe('DeclareWar');
  view.units.push(pokemon(combatFixture(), 11, 'bulbasaur', 0, 8, 2));
  view.knowledge.lastKnownUnits[21] = { ...view.knowledge.lastKnownUnits[20] };
  view.units.push(pokemon(combatFixture(), 12, 'bulbasaur', 0, 8, 2));
  const j2 = { ...ai, conservativeDeclareStrength: 1500 };
  expect(planNext(view, { ...RULE_QUERIES, ai: j2 }).action.type).toBe('DeclareWar');
  view.diplomacy[0].status = 'war'; view.diplomacy[0].declaredBy = 0;
  expect(canSiege(view, 1, j2)).toBe(false); // Declaration 1.5x never changes the 2x siege threshold.
  view.units.push(pokemon(combatFixture(), 13, 'bulbasaur', 0, 8, 2));
  expect(canSiege(view, 1)).toBe(false);
  expect(canSiege(view, 1, j2)).toBe(true);
  view.diplomacy[0].status = 'peace'; expect(canSiege(view, 1, j2)).toBe(false);
});

test.each([false, true])('D42 seeks an unseen tile or remembered city (%s) only when enabled and siege-ready', rememberedCity => {
  const { view } = quiet('aggressive');
  for (let id = 10; id < 14; id++) view.units.push(pokemon(combatFixture(), id, 'bulbasaur', 0, 3, 2));
  view.cities = view.cities.filter(city => city.ownerId === 0); view.knowledge.lastKnownCities = {};
  const target = { q: 10, r: 2 }, destination = { q: 4, r: 2 };
  if (rememberedCity) view.knowledge.lastKnownCities[2] = { ownerId: 1, position: target, lastSeenRound: 1 };
  else view.knowledge.exploredTileIds = view.knowledge.exploredTileIds.filter(index => index !== hexToIndex(target, view.map));
  view.visibleTileIds.push(hexToIndex(destination, view.map)!);
  const query: RuleQueries = { ...RULE_QUERIES, paths: (_view, id) => id === 10 ? { [hexToIndex(destination, view.map)!]: [destination] } : {} };
  const { ai } = parsePatch({ ai: { aggressiveSeekUnknownHq: true } });
  expect(planNext(view, query).action.type).toBe('EndTurn');
  expect(planNext(view, { ...query, ai }).action).toEqual({ type: 'Move', unitId: 10, to: { q: 4, r: 2 } });
  expect(planNext(structuredClone(view), { ...query, ai })).toEqual(planNext(view, { ...query, ai }));
  view.units.pop(); expect(planNext(view, { ...query, ai }).action.type).toBe('EndTurn');
});

test('D41/D42 cannot distinguish hidden military, gold or city changes', () => {
  for (const personality of ['conservative', 'aggressive'] as const) {
    const { state } = quiet(personality);
    for (let id = 10; id < 14; id++) pokemon(state, id, 'bulbasaur', 0, 3, 2);
    refreshKnowledge(state);
    const { ai } = parsePatch({ ai: { conservativeMayDeclareWar: true, aggressiveSeekUnknownHq: true } });
    const view = observe(state, 0), before = planNext(view, { ...RULE_QUERIES, ai });
    pokemon(state, 90, 'charizard', 1, 11, 7); state.players[1].gold += 9999;
    state.cities[2].position = { q: 11, r: 6 };
    expect(observe(state, 0)).toEqual(view);
    expect(planNext(observe(state, 0), { ...RULE_QUERIES, ai })).toEqual(before);
  }
});
