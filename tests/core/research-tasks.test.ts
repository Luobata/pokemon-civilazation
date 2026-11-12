import { expect, test } from 'vitest';
import { RESEARCH_TASK_IDS, RESEARCH_TASK_RULES_V24, researchSpecialFor } from '../../src/content/research-tasks.ts';
import type { ResearchTaskId } from '../../src/content/research-tasks.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import type { BiomeId } from '../../src/content/rules.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { previewCapture } from '../../src/core/preview.ts';
import { step } from '../../src/core/step.ts';
import { observe, projectEvents, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { recordExpansion } from '../../src/core/expansion.ts';
import { tileHabitatWeights } from '../../src/core/wild.ts';
import { habitatBiomes, inResearchHabitat, researchCaptureBonus, tasksDone, viewResearchCaptureBonus } from '../../src/core/research-tasks.ts';
import type { ResearchTaskEvent } from '../../src/core/research-tasks.ts';
import { researchCaptureScore } from '../../src/ai/research-plan.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { EventPayload, GameSetup, GameState, MapUnit } from '../../src/core/model.ts';

const content = WORLD24_CONTENT, R = RESEARCH_TASK_RULES_V24;
const duel = (gameplayVersion: 23 | 24 = 24): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const clone = (state: GameState) => JSON.parse(JSON.stringify(state)) as GameState;
const bitOf = (task: ResearchTaskId) => 1 << RESEARCH_TASK_IDS.indexOf(task);
const card = (state: GameState, playerId: number, speciesId: SpeciesId) => state.expansion!.researchTasks![playerId]![speciesId];
const completions = (events: readonly EventPayload[]) => events.filter((event): event is ResearchTaskEvent => event.type === 'ResearchTaskCompleted');
/** The real per-command recorder (Pokédex first, research tasks last) for hand-made transactions. */
const recordResearchTasks = (before: GameState, after: GameState, events: readonly EventPayload[]) =>
  recordExpansion(before, after, { actorId: 0, expectedSeq: before.commandSeq, action: { type: 'EndTurn' } }, events, content);

/** A fresh v24 duel with every wild Pokémon removed (so tests control what is on the map). */
function quietGame(): GameState {
  const state = createGame(duel());
  for (const unit of Object.values(state.units)) if (unit.ownerId === null) delete state.units[unit.id];
  state.expansion!.opening!.itemBalls = {};
  return state;
}
const occupied = (state: GameState, index: number) => Object.values(state.units).some(unit => isMapUnit(unit) && hexToIndex(unit.position, state.map) === index)
  || Object.values(state.cities).some(city => hexToIndex(city.position, state.map) === index);
/** Two adjacent free tiles near player `owner`'s capital: the own unit's tile and a target tile (optionally of a biome). */
function pair(state: GameState, owner: number, targetBiome?: (biome: BiomeId) => boolean, far?: number): { own: Hex; target: Hex } {
  const capital = state.cities[state.players[owner].headquartersCityId].position;
  const order = state.map.tiles.map((_, index) => index).sort((a, b) => hexDistance(capital, indexToHex(a, state.map), state.map) - hexDistance(capital, indexToHex(b, state.map), state.map) || a - b);
  for (const index of order) {
    const own = indexToHex(index, state.map);
    if (far !== undefined && hexDistance(capital, own, state.map) < far) continue;
    if (state.map.tiles[index] === 'ocean' || occupied(state, index)) continue;
    for (const target of neighbors(own, state.map)) {
      const targetIndex = hexToIndex(target, state.map)!;
      const biome = state.map.tiles[targetIndex];
      if (biome === 'ocean' || occupied(state, targetIndex) || (targetBiome && !targetBiome(biome))) continue;
      return { own, target };
    }
  }
  throw new Error('no free pair');
}
let nextId = 9000;
function place(state: GameState, speciesId: SpeciesId, ownerId: number | null, position: Hex, hp?: number): MapUnit {
  const unit = createMapUnit({ kind: 'pokemon', speciesId }, nextId++, ownerId, position, content, 0, 1);
  if (hp !== undefined) unit.hp = hp;
  state.units[unit.id] = unit;
  return unit;
}
/** Own strong attacker knocks out a 1-HP Pokémon of `speciesId`; returns the recorded research events. */
function knockOut(state: GameState, speciesId: SpeciesId, setupState?: (state: GameState, target: Hex) => void): { state: GameState; events: ResearchTaskEvent[] } {
  const spot = pair(state, 0);
  const attacker = place(state, 'hydreigon', 0, spot.own), target = place(state, speciesId, null, spot.target, 1);
  setupState?.(state, spot.target);
  const before = clone(state), after = clone(state);
  const battle = resolveAttack(after, attacker.id, { kind: 'unit', id: target.id }, content);
  expect(after.units[target.id]).toBeUndefined();
  return { state: after, events: completions(recordResearchTasks(before, after, battle)) };
}

test('v24 only: v23 has no research ledger; a v24 book starts with the starting registrations seen and nothing else', () => {
  expect(createGame(duel(23)).expansion!.researchTasks).toBeUndefined();
  const state = createGame(duel());
  const book = state.expansion!.researchTasks!;
  expect(Object.keys(book)).toEqual(['0', '1']);
  for (const playerId of [0, 1]) {
    const observed = Object.values(state.expansion!.world.players[playerId].pokedex).filter(record => record.observed).map(record => record.speciesId).sort();
    expect(Object.keys(book[playerId]!).sort()).toEqual(observed);
    expect(Object.values(book[playerId]!).every(entry => entry!.tasks === bitOf('seen') && entry!.knockouts === 0)).toBe(true);
  }
  expect(researchCaptureBonus(createGame(duel(23)), 0, 'rattata')).toBe(0);
});

test('task 1: a species counts as seen only when that player actually sees it', () => {
  const state = quietGame();
  const near = pair(state, 0).target, far = pair(state, 1).target;
  place(state, 'rattata', null, near);
  place(state, 'abra', null, far);
  expect(visibleTiles(state, 0, content).has(hexToIndex(far, state.map)!)).toBe(false);
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'EndTurn' } });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const book0 = result.state.expansion!.researchTasks![0]!;
  expect(book0.rattata?.tasks).toBe(bitOf('seen'));
  expect(book0.abra).toBeUndefined();
  expect(result.state.expansion!.researchTasks![1]!.abra?.tasks).toBe(bitOf('seen'));
  // Private: player 1's view carries only its own book, and player 0's completion events never reach player 1.
  expect(observe(result.state, 1).expansion!.researchTasks).toEqual(result.state.expansion!.researchTasks![1]);
  expect(observe(result.state, 1).expansion!.researchTasks!.rattata).toBeUndefined();
  const toOne = projectEvents(state, result.state, result.events, 1).map(event => event.payload).filter(payload => payload.type === 'ResearchTaskCompleted');
  expect(toOne.every(payload => payload.type === 'ResearchTaskCompleted' && payload.playerId === 1)).toBe(true);
  expect(toOne.some(payload => payload.type === 'ResearchTaskCompleted' && payload.speciesId === 'abra')).toBe(true);
  expect(toOne.some(payload => payload.type === 'ResearchTaskCompleted' && payload.speciesId === 'rattata')).toBe(false);
});

test('task 2: two knockouts by own Pokémon complete it, and seen + knockouts pays the research notes once', () => {
  let state = quietGame();
  const reserve = state.players[0].research.reserve;
  const first = knockOut(state, 'rattata');
  expect(card(first.state, 0, 'rattata')).toEqual({ tasks: bitOf('seen'), knockouts: 1 });
  expect(first.events.filter(event => event.speciesId === 'rattata').map(event => event.task)).toEqual(['seen']);
  state = first.state;
  const second = knockOut(state, 'rattata');
  const rattata = second.events.filter(event => event.speciesId === 'rattata');
  expect(rattata).toEqual([{ type: 'ResearchTaskCompleted', playerId: 0, speciesId: 'rattata', task: 'knockouts', tasksDone: 2, reward: { research: R.notesResearch } }]);
  expect(second.state.players[0].research.reserve).toBe(reserve + R.notesResearch);
  // A third knockout changes nothing.
  const third = knockOut(second.state, 'rattata');
  expect(third.events.filter(event => event.speciesId === 'rattata')).toEqual([]);
  expect(card(third.state, 0, 'rattata')).toEqual({ tasks: bitOf('seen') | bitOf('knockouts'), knockouts: 2 });
  expect(third.state.players[0].research.reserve).toBe(reserve + R.notesResearch);
  // The Pokédex victory records are untouched by the research book (battled is set by the Pokédex itself, not by tasks).
  expect(third.state.expansion!.world.players[0].pokedex.rattata).toEqual(state.expansion!.world.players[0].pokedex.rattata);
});

test('task 2 ignores knockouts made by wild Pokémon and by player cities', () => {
  const state = quietGame();
  const spot = pair(state, 0);
  const wild = place(state, 'machamp', null, spot.own), victim = place(state, 'rattata', 1, spot.target, 1);
  const before = clone(state), after = clone(state);
  const events = recordResearchTasks(before, after, resolveAttack(after, wild.id, { kind: 'unit', id: victim.id }, content, true));
  expect(completions(events).filter(event => event.task === 'knockouts')).toEqual([]);
  expect(Object.values(after.expansion!.researchTasks![0]!).concat(Object.values(after.expansion!.researchTasks![1]!)).every(entry => entry!.knockouts === 0)).toBe(true);
});

test('task 3 and the habitat special: a capture completes "captured", and in a spawn biome also task 5', () => {
  expect(researchSpecialFor('normal')).toEqual({ kind: 'habitat' });
  expect(habitatBiomes(content, 'raticate')).toEqual(habitatBiomes(content, 'rattata'));
  const state = quietGame();
  const habitat = habitatBiomes(content, 'rattata');
  const spot = pair(state, 0, biome => habitat.includes(biome));
  expect(inResearchHabitat(state.map, content, 'rattata', hexToIndex(spot.target, state.map)!)).toBe(true);
  const own = place(state, 'machamp', 0, spot.own), wild = place(state, 'rattata', null, spot.target, 1);
  const before = clone(state), after = clone(state);
  const captured: EventPayload = { type: 'Captured', playerId: 0, unitId: own.id, targetUnitId: wild.id, success: true, probability: 100 };
  after.units[wild.id] = { ...(after.units[wild.id] as MapUnit), ownerId: 0 };
  const events = completions(recordResearchTasks(before, after, [captured]));
  expect(events.filter(event => event.speciesId === 'rattata').map(event => [event.task, event.tasksDone])).toEqual([['captured', 1], ['special', 2], ['seen', 3]]);
  expect(events.find(event => event.task === 'special')!.reward).toEqual({ research: R.notesResearch });
  // Outside its habitat, the capture only completes task 3.
  const elsewhere = quietGame(), outside = pair(elsewhere, 0, biome => !habitat.includes(biome));
  const own2 = place(elsewhere, 'machamp', 0, outside.own), wild2 = place(elsewhere, 'rattata', null, outside.target, 1);
  const after2 = clone(elsewhere);
  const events2 = completions(recordResearchTasks(clone(elsewhere), after2, [{ ...captured, unitId: own2.id, targetUnitId: wild2.id } as EventPayload]));
  expect(events2.filter(event => event.speciesId === 'rattata').map(event => event.task)).toEqual(['captured', 'seen']);
  // A failed capture records nothing.
  expect(completions(recordResearchTasks(clone(elsewhere), clone(elsewhere), [{ ...captured, success: false } as EventPayload])).filter(event => event.task === 'captured')).toEqual([]);
});

test('task 4: own evolutions count both forms; another player only gets it when the evolving unit is in sight', () => {
  const state = quietGame();
  const spot = pair(state, 0), far = pair(state, 0, undefined, 9);
  const seenUnit = place(state, 'rattata', 0, spot.own), hidden = place(state, 'abra', 0, far.own);
  // Player 1 sees the first unit only.
  place(state, 'pidgey', 1, spot.target);
  expect(visibleTiles(state, 1, content).has(hexToIndex(spot.own, state.map)!)).toBe(true);
  expect(visibleTiles(state, 1, content).has(hexToIndex(far.own, state.map)!)).toBe(false);
  const before = clone(state), after = clone(state);
  (after.units[seenUnit.id] as MapUnit & { speciesId: SpeciesId }).speciesId = 'raticate';
  (after.units[hidden.id] as MapUnit & { speciesId: SpeciesId }).speciesId = 'kadabra';
  const events = completions(recordResearchTasks(before, after, [
    { type: 'Evolved', playerId: 0, unitId: seenUnit.id, speciesId: 'raticate' },
    { type: 'Evolved', playerId: 0, unitId: hidden.id, speciesId: 'kadabra' },
  ])).filter(event => event.task === 'evolution');
  expect(events.filter(event => event.playerId === 0).map(event => event.speciesId)).toEqual(['rattata', 'raticate', 'abra', 'kadabra']);
  expect(events.filter(event => event.playerId === 1).map(event => event.speciesId)).toEqual(['rattata', 'raticate']);
});

test('task 5: dark / ghost knocked out at night, water knocked out in rain', () => {
  expect(researchSpecialFor('ghost')).toEqual({ kind: 'night' });
  expect(researchSpecialFor('water')).toEqual({ kind: 'weather', weather: 'rain' });
  expect(researchSpecialFor('steel')).toEqual({ kind: 'weather', weather: 'sand' });
  const day = quietGame(); day.round = 1;
  expect(knockOut(day, 'gastly').events.some(event => event.speciesId === 'gastly' && event.task === 'special')).toBe(false);
  const night = quietGame(); night.round = 3;
  expect(knockOut(night, 'gastly').events.filter(event => event.speciesId === 'gastly').map(event => event.task)).toEqual(['special', 'seen']);

  const dry = quietGame();
  expect(knockOut(dry, 'squirtle').events.some(event => event.speciesId === 'squirtle' && event.task === 'special')).toBe(false);
  const wet = quietGame();
  expect(wet.expansion!.eraAbilities).toBeDefined();
  const rain = knockOut(wet, 'squirtle', (state, target) => {
    state.expansion!.eraAbilities!.fields.push({ ownerId: 1, weather: 'rain', center: { ...target }, untilRound: state.round + 2 });
  });
  expect(rain.events.filter(event => event.speciesId === 'squirtle').map(event => event.task)).toEqual(['special', 'seen']);
  // The wrong weather does not count.
  const sunny = knockOut(quietGame(), 'squirtle', (state, target) => {
    state.expansion!.eraAbilities!.fields.push({ ownerId: 1, weather: 'sun', center: { ...target }, untilRound: state.round + 2 });
  });
  expect(sunny.events.some(event => event.speciesId === 'squirtle' && event.task === 'special')).toBe(false);
});

test('rewards: 4 tasks give +10 capture chance in the authority roll and the preview alike; 5 give gold and era score (3 per era)', () => {
  const state = quietGame();
  state.players[0].research.unlockedIds.push('domestication');
  state.players[0].ballInventory.pokeBall = 5;
  const spot = pair(state, 0);
  const own = place(state, 'machamp', 0, spot.own), wild = place(state, 'rattata', null, spot.target, 1);
  refreshKnowledge(state, content);
  const without = previewCapture(observe(state, 0), own.id, wild.id, 'pokeBall', content);
  state.expansion!.researchTasks![0]!.rattata = { tasks: bitOf('seen') | bitOf('knockouts') | bitOf('evolution') | bitOf('special'), knockouts: 2 };
  expect(researchCaptureBonus(state, 0, 'rattata')).toBe(R.captureBonus);
  expect(researchCaptureBonus(state, 1, 'rattata')).toBe(0);
  const view = observe(state, 0);
  expect(viewResearchCaptureBonus(view, 'rattata')).toBe(R.captureBonus);
  const preview = previewCapture(view, own.id, wild.id, 'pokeBall', content);
  expect(without.ok && preview.ok).toBe(true);
  if (!without.ok || !preview.ok) return;
  expect(preview.probability).toBe(without.probability + R.captureBonus);
  const gold = state.players[0].gold, score = state.expansion!.eraHonors!.players[0].score;
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Capture', unitId: own.id, targetUnitId: wild.id, ballId: 'pokeBall' } });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const roll = result.events.map(event => event.payload).find(payload => payload.type === 'Captured');
  expect(roll && roll.type === 'Captured' && roll.probability).toBe(preview.probability);
  expect(roll?.type === 'Captured' && roll.success).toBe(true);
  if (roll?.type === 'Captured' && roll.success) {
    const done = completions(result.events.map(event => event.payload)).find(event => event.speciesId === 'rattata' && event.task === 'captured')!;
    expect(done).toMatchObject({ tasksDone: 5, reward: { gold: R.completeGold, eraScore: R.completeEraScore } });
    expect(result.state.players[0].gold).toBeGreaterThanOrEqual(gold + R.completeGold);
    expect(result.state.expansion!.eraHonors!.players[0].byMilestone.researchComplete).toBe(1);
    expect(result.state.expansion!.eraHonors!.players[0].score).toBeGreaterThan(score);
  }
  // Era score cap: the 4th completed card in one era pays gold only.
  const capped = quietGame();
  capped.expansion!.eraHonors!.players[0].byMilestone.researchComplete = R.eraScoreCapPerEra;
  const four = bitOf('seen') | bitOf('knockouts') | bitOf('captured') | bitOf('evolution');
  capped.expansion!.researchTasks![0]!.gastly = { tasks: four, knockouts: 2 };
  capped.round = 3;
  const cappedGold = capped.players[0].gold;
  const finish = knockOut(capped, 'gastly');
  expect(finish.events.find(event => event.speciesId === 'gastly' && event.task === 'special')).toMatchObject({ tasksDone: 5, reward: { gold: R.completeGold } });
  expect(finish.events.find(event => event.task === 'special')!.reward!.eraScore).toBeUndefined();
  expect(finish.state.expansion!.eraHonors!.players[0].byMilestone.researchComplete).toBe(R.eraScoreCapPerEra);
  expect(finish.state.players[0].gold).toBe(cappedGold + R.completeGold);
  expect(tasksDone(card(finish.state, 0, 'gastly')!.tasks)).toBe(5);
});

test('AI: +15 capture score only when the capture completes task 3 or the habitat task, read from the view', () => {
  const state = quietGame();
  const habitat = habitatBiomes(content, 'rattata');
  const spot = pair(state, 0, biome => habitat.includes(biome));
  place(state, 'machamp', 0, spot.own);
  const wild = place(state, 'rattata', null, spot.target, 20);
  refreshKnowledge(state, content);
  const score = () => researchCaptureScore(observe(state, 0), observe(state, 0).units.find(unit => unit.id === wild.id)!);
  expect(score()).toBe(R.aiCaptureScore);
  state.expansion!.researchTasks![0]!.rattata = { tasks: bitOf('seen') | bitOf('captured'), knockouts: 0 };
  expect(score()).toBe(R.aiCaptureScore); // the habitat task is still open here
  state.expansion!.researchTasks![0]!.rattata = { tasks: bitOf('seen') | bitOf('captured') | bitOf('special'), knockouts: 0 };
  expect(score()).toBe(0);
  const v23 = createGame(duel(23)), any = observe(v23, 0).units.find(unit => unit.kind === 'pokemon')!;
  expect(researchCaptureScore(observe(v23, 0), any)).toBe(0);
});

test('v24 terrain: the habitat task reads the tile habitat (hill overlay, deep water), not only the biome', () => {
  const state = createGame(duel());
  const features = state.map.features!;
  // Geodude lives on every hill (overlay) whatever the hill's biome, and so does its evolution; Squirtle never in deep water.
  const hill = features.hills.find(index => state.map.tiles[index] === 'grassland') ?? features.hills[0];
  expect(tileHabitatWeights(state.map, hill, content).geodude).toBeGreaterThan(0);
  expect(inResearchHabitat(state.map, content, 'geodude', hill)).toBe(true);
  expect(inResearchHabitat(state.map, content, 'graveler', hill)).toBe(true);
  const deep = features.deep.find(index => state.map.tiles[index] === 'ocean')!;
  expect(inResearchHabitat(state.map, content, 'squirtle', deep)).toBe(false);
  // Without features (a v23 map) the biome rule is unchanged.
  const flat = { ...state.map, features: undefined };
  expect(inResearchHabitat(flat, content, 'geodude', hill)).toBe(habitatBiomes(content, 'geodude').includes(state.map.tiles[hill]!));
});
