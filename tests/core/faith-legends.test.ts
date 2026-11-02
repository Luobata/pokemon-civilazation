import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { FAITH_RULES } from '../../src/content/faith-legends.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield, createCity } from '../../src/core/city.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { resolveFaithRound } from '../../src/core/faith-legends.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const act = (state: GameState, actorId: number, action: Command['action']) => step(state, { actorId, expectedSeq: state.commandSeq, action });
function founded(): GameState {
  const state = createGame(setup(9));
  const civ = state.expansion!.civilization.players[0];
  civ.lifetimeOfferings = FAITH_RULES.foundLifetime; civ.offeringPoints = FAITH_RULES.foundCost + 100;
  const result = act(state, 0, { type: 'FoundFaith', legend: 'lugia', tenets: ['missionaries', 'shrineGold'] });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

test('faith exists only in gameplay v9; founding needs lifetime offerings and a free legend', () => {
  expect(createGame(setup(8)).expansion).not.toHaveProperty('faith');
  expect(parseAuditAction({ type: 'FoundFaith', legend: 'kyogre', tenets: ['zealots', 'harmony'] })).toEqual({ type: 'FoundFaith', legend: 'kyogre', tenets: ['zealots', 'harmony'] });
  expect(() => parseAuditAction({ type: 'FoundFaith', legend: 'kyogre', tenets: ['zealots'] })).toThrow();
  const state = createGame(setup(9));
  expect(act(state, 0, { type: 'FoundFaith', legend: 'lugia', tenets: ['missionaries', 'shrineGold'] }).ok).toBe(false);
  const next = founded();
  const hq = next.players[0].headquartersCityId;
  expect(next.expansion!.faith!.cityFaith[hq]).toBe(0);
  next.expansion!.civilization.players[1].lifetimeOfferings = 50; next.expansion!.civilization.players[1].offeringPoints = 50;
  next.activePlayerId = 1;
  expect(act(next, 1, { type: 'FoundFaith', legend: 'lugia', tenets: ['zealots', 'harmony'] }).ok).toBe(false);
  expect(act(next, 1, { type: 'FoundFaith', legend: 'kyogre', tenets: ['zealots', 'harmony'] }).ok).toBe(true);
});

test('faithful cities receive the legend blessing and tenet yields', () => {
  const plain = createGame(setup(9)), next = founded();
  const id = next.players[0].headquartersCityId;
  const before = cityYield(plain, plain.cities[id]), after = cityYield(next, next.cities[id]);
  expect(after.research - before.research).toBe(1);
  expect(after.gold - before.gold).toBe(1);
});

test('spreading builds pressure and converts at the threshold; passive spread reaches nearby cities', () => {
  const state = founded();
  const hq = state.cities[state.players[0].headquartersCityId];
  const near = createCity(950, 1, { q: hq.position.q + 3, r: hq.position.r }, false);
  state.cities[950] = near;
  const before = state.expansion!.civilization.players[0].offeringPoints;
  const spread = act(state, 0, { type: 'SpreadFaith', cityId: 950 });
  expect(spread.ok).toBe(true);
  if (!spread.ok) return;
  const next = spread.state;
  expect(next.expansion!.civilization.players[0].offeringPoints).toBe(before - (FAITH_RULES.spreadCost - 5));
  expect(next.expansion!.faith!.pressure[950][0]).toBe(FAITH_RULES.spreadPressure + 10);
  next.expansion!.faith!.pressure[950][0] = FAITH_RULES.convertAt - FAITH_RULES.passivePressure;
  const events = resolveFaithRound(next, EXPANSION_CONTENT);
  expect(events).toContainEqual(expect.objectContaining({ type: 'CityConverted', cityId: 950, playerId: 0 }));
  expect(observe(next, 1).expansion!.faith!.cityFaith[950]).toBe(0);
});

test('majority faith with a follower in every rival wins the faith victory', () => {
  const state = founded();
  const hq = state.cities[state.players[0].headquartersCityId];
  for (let i = 0; i < 5; i++) state.cities[960 + i] = createCity(960 + i, i < 3 ? 0 : 1, { q: hq.position.q + 2 + i, r: hq.position.r + 4 }, false);
  for (const id of [960, 961, 962, 963]) state.expansion!.faith!.cityFaith[id] = 0;
  resolveFaithRound(state, EXPANSION_CONTENT);
  expect(state.outcome).toMatchObject({ kind: 'faith', winners: [0] });
});

test('gameplay v9 keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(9), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'conservative', leaderId: 'joy' }] });
  for (let turn = 0; turn < 50; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(9));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
