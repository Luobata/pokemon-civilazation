import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { TECHS } from '../../src/content/economy.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield } from '../../src/core/city.ts';
import { resolveRecovery } from '../../src/core/recovery.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { refreshKnowledge, observe } from '../../src/core/vision.ts';
import { hexDistance, hexToIndex, indexToHex } from '../../src/core/hex.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import type { GameSetup } from '../../src/core/model.ts';
import type { EraProgression } from '../../src/content/eras.ts';

function setup(mode?: EraProgression, leaderId: 'oak' | 'lance' | 'jenny' | 'joy' = 'oak'): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
    ...(mode ? { eraProgression: mode } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}

test('era rules require an explicit supported version and expansion setup', () => {
  expect(() => createGame({ ...setup(), eraProgression: 'bad' as EraProgression })).toThrow();
  const legacy = setup('simple-v1'); delete legacy.expansionVersion;
  expect(() => createGame(legacy)).toThrow();
  const old = createGame(setup());
  expect(old.setup).not.toHaveProperty('eraProgression');
  expect(observe(old, 0)).not.toHaveProperty('eraProgression');
  expect(cityYield(old, old.cities[old.players[0].headquartersCityId]).research).toBe(1);
  const current = createGame(setup('simple-v1'));
  expect(cityYield(current, current.cities[current.players[0].headquartersCityId]).research).toBeGreaterThan(1);
});

for (const mode of ['simple-v1', 'full-v1'] as const) {
  test(`${mode} preserves exact save/load and command replay`, () => {
    const session = new GameSession(setup(mode, 'joy'));
    for (let turn = 0; turn < 6; turn++) {
      const current = session.getState();
      expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
    }
    const saved = session.save(), loaded = new GameSession(setup());
    loaded.load(saved);
    expect(loaded.save()).toBe(saved);
    expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
    expect(loaded.getView().eraProgression).toBe(mode);
  });
}

test('Joy late-era field care heals her favored Pokemon outside territory, retaining old rules elsewhere', () => {
  for (const mode of [undefined, 'simple-v1'] as const) {
    const state = createGame(setup(mode, 'joy'));
    state.players[0].research.unlockedIds = Object.keys(TECHS).slice(0, 7) as (keyof typeof TECHS)[];
    const city = state.cities[state.players[0].headquartersCityId];
    const index = state.map.tiles.findIndex((_, i) => hexDistance(city.position, indexToHex(i, state.map)) > 6);
    expect(index).toBeGreaterThanOrEqual(0);
    const position = indexToHex(index, state.map);
    const favored = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 1000, 0, position, EXPANSION_CONTENT);
    const other = createMapUnit({ kind: 'pokemon', speciesId: 'charmander' }, 1001, 0, position, EXPANSION_CONTENT);
    favored.hp = 10; other.hp = 10; state.units = { 1000: favored, 1001: other };
    resolveRecovery(state);
    expect(favored.hp).toBe(mode ? 16 : 10);
    expect(other.hp).toBe(10);
  }
});

test('Jenny frontline training changes deployed experience for the matching Pokemon only', () => {
  const state = createGame(setup('simple-v1', 'jenny'));
  const city = state.cities[state.players[0].headquartersCityId];
  city.queue = [{ id: 1000, progress: 100, item: { kind: 'pokemon', defId: 'machop' } }];
  const events = resolveEconomy(state);
  const trained = events.find(event => event.type === 'UnitTrained' && event.playerId === 0);
  expect(trained?.type).toBe('UnitTrained');
  if (trained?.type === 'UnitTrained') expect(trained.unit.xp).toBeGreaterThan(0);
});

test('Lance mobility is accepted by authoritative movement, using the same projected range as the UI', () => {
  const state = createGame(setup('simple-v1', 'lance'));
  state.players[0].research.unlockedIds = Object.keys(TECHS).slice(0, 7) as (keyof typeof TECHS)[];
  state.map.tiles.fill('grassland'); state.units = {};
  const unit = createMapUnit({ kind: 'pokemon', speciesId: 'ponyta' }, 1000, 0, { q: 10, r: 8 }, EXPANSION_CONTENT, 0, 1);
  state.units[unit.id] = unit;
  // Movement still uses player knowledge; reveal terrain through the fixture's knowledge record.
  state.knowledge[0].exploredTileIds = state.map.tiles.map((_, i) => i);
  state.knowledge[0].rememberedTiles = Object.fromEntries(state.map.tiles.map((biomeId, i) => [i, { biomeId }]));
  refreshKnowledge(state);
  const view = observe(state, 0), range = reachablePaths(view, unit.id);
  const destination = Object.keys(range).map(Number).find(i => hexDistance(unit.position, indexToHex(i, state.map)) === 6);
  expect(destination).toBeDefined();
  const action = { type: 'Move' as const, unitId: unit.id, to: indexToHex(destination!, state.map) };
  const result = step(state, { actorId: 0, expectedSeq: 0, action });
  expect(result.ok).toBe(true);
  if (result.ok) expect(hexToIndex(result.state.units[unit.id].position!, result.state.map)).toBe(destination);
  const old = structuredClone(state); delete old.setup.eraProgression;
  expect(reachablePaths(observe(old, 0), unit.id)[destination!]).toBeUndefined();
});
