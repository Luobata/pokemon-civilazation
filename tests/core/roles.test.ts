import { expect, test } from 'vitest';
import { GAME_CONTENT } from '../../src/content/units.ts';
import { BUILDER_RULES, ROLE_POKEMON } from '../../src/content/roles.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { improvementOptions } from '../../src/core/improvements.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
const hq = (state: GameState) => state.cities[state.players[0].headquartersCityId];

/** A builder (v18) or the starter Pokémon (older rules) standing on a worked, buildable tile next to the capital. */
function workSite(version: GameplayVersion) {
  const state = createGame(duel(version));
  const capital = hq(state), probe = createMapUnit({ kind: 'logistics', role: 'builder' }, 9000, 0, capital.position, GAME_CONTENT, 0, 1);
  for (const index of capital.workedTileIds) {
    probe.position = indexToHex(index, state.map);
    state.units[9000] = probe; refreshKnowledge(state);
    const option = improvementOptions(observe(state, 0), 9000, GAME_CONTENT).find(item => item.tileIndex === index);
    if (option) return { state, option };
  }
  throw new Error('no buildable tile');
}

test('role Pokémon are fixed, non-combat species that never appear as combat units', () => {
  for (const role of Object.values(ROLE_POKEMON)) {
    expect(Object.values(GAME_CONTENT.species).some(species => species.name === role.species)).toBe(false);
    expect(role.sprite).toMatch(/^\/sprites\/gen\d\/\d+\.png$/);
  }
  expect(gameVersions({ gameplayVersion: 27 })).toEqual({ schemaVersion: 22, rulesVersion: 'pace-v27' });
});

test('v18: only 工匠 build; one action finishes an improvement and spends a charge; the last charge uses the builder up', () => {
  const { state, option } = workSite(27);
  const builder = state.units[9000];
  builder.charges = BUILDER_RULES.charges;
  // A combat Pokémon on the same tile may not build any more.
  const starter = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  expect(act(state, { type: 'ImproveTile', unitId: starter.id, tileIndex: option.tileIndex, kind: option.kind }).ok).toBe(false);
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex: option.tileIndex, kind: option.kind });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.state.expansion!.improvements!.tiles[option.tileIndex]).toMatchObject({ kind: option.kind, builtBy: 0 });
  expect(built.state.units[9000].charges).toBe(BUILDER_RULES.charges - 1);
  const last = JSON.parse(JSON.stringify(state)) as GameState;
  last.units[9000].charges = 1;
  const used = act(last, { type: 'ImproveTile', unitId: 9000, tileIndex: option.tileIndex, kind: option.kind });
  expect(used.ok && used.state.units[9000]).toBeUndefined();
});

test('v27: cities train 工匠 with charges', () => {
  const state = createGame(duel(27)), city = hq(state);
  const queued = act(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'logistics', defId: 'builder' } }] });
  expect(queued.ok).toBe(true);
  if (!queued.ok) return;
  queued.state.cities[city.id].queue[0].progress = 999;
  let next = queued.state;
  for (let i = 0; i < 2; i++) { const ended = act(next, { type: 'EndTurn' }); if (!ended.ok) throw new Error(ended.reason); next = ended.state; }
  const builder = Object.values(next.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'builder')!;
  expect(builder.charges).toBe(BUILDER_RULES.charges);
  expect(hexDistance(builder.position!, city.position, state.map)).toBe(1);
});
