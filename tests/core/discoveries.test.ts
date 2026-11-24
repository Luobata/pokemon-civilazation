import { expect, test } from 'vitest';
import { GAME_CONTENT, STOCK_CONTENTS } from '../../src/content/units.ts';
import { DISCOVERIES } from '../../src/content/discoveries.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { recordDiscoveries } from '../../src/core/discoveries.ts';
import { isLandmarkTile, isPeak } from '../../src/core/terrain.ts';
import { tileStepCost } from '../../src/core/movement.ts';
import { hexDistance, hexToIndex, indexToHex } from '../../src/core/hex.ts';
import type { EventPayload, GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const evolved = (playerId: number): EventPayload[] => [{ type: 'Evolved', playerId, unitId: 1, speciesId: 'ivysaur' }];

test('every technology has exactly one discovery and the ledger initializes on games', () => {
  for (const content of STOCK_CONTENTS) for (const id of Object.keys(content.techs)) expect(DISCOVERIES).toHaveProperty(id);
  expect(Object.keys(DISCOVERIES).sort()).toEqual(Object.keys(GAME_CONTENT.techs).sort());
  expect(createGame(setup(27)).expansion?.discoveries).toEqual({ 0: [], 1: [] });
});

test('a discovery adds 40% once, never completes the tech and is private', () => {
  const before = createGame(setup(27)), next: GameState = structuredClone(before);
  const trainingBonus = Math.floor(GAME_CONTENT.techs.training.cost * 40 / 100);
  const events = recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), GAME_CONTENT);
  expect(events).toContainEqual({ type: 'DiscoveryMade', playerId: 0, techId: 'training', bonus: trainingBonus, progress: trainingBonus });
  expect(next.players[0].research.progressByTech.training).toBe(trainingBonus);
  expect(next.players[1].research.progressByTech.training).toBe(0);
  expect(recordDiscoveries(next, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), GAME_CONTENT)).toEqual([]);
  expect(observe(next, 0).expansion?.discoveries).toEqual(['training']);
  expect(observe(next, 1).expansion?.discoveries).toEqual([]);
  const siegeCap = GAME_CONTENT.techs.siegeCraft.cost - 1;
  next.players[0].research.progressByTech.siegeCraft = siegeCap;
  const city = Object.values(next.cities).find(item => item.ownerId === 1)!;
  const attacker = Object.values(next.units).find(unit => unit.ownerId === 0)!;
  recordDiscoveries(next, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [{ type: 'BattleResolved', attackerId: attacker.id, target: { kind: 'city', id: city.id },
    positions: [], damage: 1, counterDamage: 0, capturedCity: false, knockedDownUnitIds: [] }], GAME_CONTENT);
  expect(next.players[0].research.progressByTech.siegeCraft).toBe(siegeCap);
  expect(next.expansion!.discoveries![0]).toContain('siegeCraft');
});

test('already researched techs are recorded without any bonus', () => {
  const before = createGame(setup(27)), next: GameState = structuredClone(before);
  next.players[0].research.unlockedIds = ['training'];
  expect(recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, evolved(0), GAME_CONTENT)).toEqual([]);
  expect(next.expansion!.discoveries![0]).toEqual(['training']);
});

test('authoritative steps emit discoveries from real milestones', () => {
  const state = createGame(setup(27));
  const blocked = new Set([
    ...Object.values(state.units).flatMap(unit => unit.position ? [hexToIndex(unit.position, state.map)!] : []),
    ...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!),
  ]);
  const probe = { kind: 'pokemon' as const, speciesId: 'swinub' as const };
  let snow = -1, from = -1;
  for (let i = 0; i < state.map.tiles.length && from < 0; i++) {
    if (state.map.tiles[i] !== 'snow' || blocked.has(i) || isPeak(state.map, i) || isLandmarkTile(state.map, i)) continue;
    const neighbor = state.map.tiles.findIndex((biome, j) => biome !== 'ocean' && biome !== 'snow' && biome !== 'volcano'
      && !blocked.has(j) && !isPeak(state.map, j) && !isLandmarkTile(state.map, j)
      && hexDistance(indexToHex(j, state.map), indexToHex(i, state.map), state.map) === 1
      && tileStepCost(probe, state.map, j, i, GAME_CONTENT) <= GAME_CONTENT.species.swinub.move);
    if (neighbor >= 0) { snow = i; from = neighbor; }
  }
  expect(snow).toBeGreaterThanOrEqual(0);
  const unit = createMapUnit(probe, 9000, 0, indexToHex(from, state.map), GAME_CONTENT, 0, 1);
  state.units[unit.id] = unit; refreshKnowledge(state);
  state.knowledge[0].exploredTileIds = state.map.tiles.map((_, i) => i);
  state.knowledge[0].rememberedTiles = Object.fromEntries(state.map.tiles.map((biomeId, i) => [i, { biomeId }]));
  const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'Move', unitId: 9000, to: indexToHex(snow, state.map) } });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.events.map(event => event.payload)).toContainEqual(expect.objectContaining({ type: 'DiscoveryMade', playerId: 0, techId: 'meteorology' }));
    expect(result.state.players[0].research.progressByTech.meteorology).toBe(Math.floor(GAME_CONTENT.techs.meteorology.cost * 40 / 100));
  }
});
