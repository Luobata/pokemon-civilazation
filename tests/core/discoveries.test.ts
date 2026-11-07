import { expect, test } from 'vitest';
import { EXPANSION_CONTENT, STOCK_CONTENTS, WORLD_CONTENT } from '../../src/content/units.ts';
import { DISCOVERIES } from '../../src/content/discoveries.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { recordDiscoveries } from '../../src/core/discoveries.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import type { EventPayload, GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const end: EventPayload[] = [];
const evolved = (playerId: number): EventPayload[] => [{ type: 'Evolved', playerId, unitId: 1, speciesId: 'ivysaur' }];

test('every technology has exactly one discovery and the ledger exists only in gameplay v2', () => {
  // Every technology of every content has one; the extra 18 belong to the v22 tree.
  for (const content of STOCK_CONTENTS) for (const id of Object.keys(content.techs)) expect(DISCOVERIES).toHaveProperty(id);
  expect(Object.keys(DISCOVERIES).sort()).toEqual(Object.keys(WORLD_CONTENT.techs).sort());
  expect(createGame(setup(2)).expansion?.discoveries).toEqual({ 0: [], 1: [] });
  expect(createGame(setup(1)).expansion).not.toHaveProperty('discoveries');
});

test('a discovery adds 40% once, never completes the tech and is private', () => {
  const before = createGame(setup(2)), next: GameState = structuredClone(before);
  const events = recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), EXPANSION_CONTENT);
  expect(events).toContainEqual({ type: 'DiscoveryMade', playerId: 0, techId: 'training', bonus: 28, progress: 28 });
  expect(next.players[0].research.progressByTech.training).toBe(28);
  expect(next.players[1].research.progressByTech.training).toBe(0);
  expect(recordDiscoveries(next, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), EXPANSION_CONTENT)).toEqual([]);
  expect(observe(next, 0).expansion?.discoveries).toEqual(['training']);
  expect(observe(next, 1).expansion?.discoveries).toEqual([]);
  next.players[0].research.progressByTech.siegeCraft = 69;
  const city = Object.values(next.cities).find(item => item.ownerId === 1)!;
  const attacker = Object.values(next.units).find(unit => unit.ownerId === 0)!;
  recordDiscoveries(next, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [{ type: 'BattleResolved', attackerId: attacker.id, target: { kind: 'city', id: city.id },
    positions: [], damage: 1, counterDamage: 0, capturedCity: false, knockedDownUnitIds: [] }], EXPANSION_CONTENT);
  expect(next.players[0].research.progressByTech.siegeCraft).toBe(69);
  expect(next.expansion!.discoveries![0]).toContain('siegeCraft');
});

test('already researched techs are recorded without any bonus; v1 games never record', () => {
  const before = createGame(setup(2)), next: GameState = structuredClone(before);
  next.players[0].research.unlockedIds = ['training'];
  expect(recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), EXPANSION_CONTENT)).toEqual([]);
  expect(next.expansion!.discoveries![0]).toEqual(['training']);
  const v1 = createGame(setup(1));
  expect(recordDiscoveries(v1, v1, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), EXPANSION_CONTENT)).toEqual(end);
});

test('authoritative steps emit discoveries from real milestones', () => {
  const state = createGame(setup(2));
  const snow = state.map.tiles.findIndex(biome => biome === 'snow' || biome === 'volcano');
  expect(snow).toBeGreaterThanOrEqual(0);
  const from = state.map.tiles.findIndex((biome, i) => biome !== 'ocean' && biome !== 'snow' && biome !== 'volcano' && hexDistance(indexToHex(i, state.map), indexToHex(snow, state.map), state.map) === 1
    && !Object.values(state.units).some(unit => unit.position && hexDistance(unit.position, indexToHex(i, state.map), state.map) === 0));
  const unit = createMapUnit({ kind: 'pokemon', speciesId: 'swinub' }, 9000, 0, indexToHex(from, state.map), EXPANSION_CONTENT, 0, 1);
  state.units[unit.id] = unit; refreshKnowledge(state);
  state.knowledge[0].exploredTileIds = state.map.tiles.map((_, i) => i);
  state.knowledge[0].rememberedTiles = Object.fromEntries(state.map.tiles.map((biomeId, i) => [i, { biomeId }]));
  const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'Move', unitId: 9000, to: indexToHex(snow, state.map) } });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.events.map(event => event.payload)).toContainEqual(expect.objectContaining({ type: 'DiscoveryMade', playerId: 0, techId: 'meteorology' }));
    expect(result.state.players[0].research.progressByTech.meteorology).toBe(28);
  }
});
