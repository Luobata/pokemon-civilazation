import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { GAME_CONTENT } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield, workRadius } from '../../src/core/city.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import { crewPoints, improvementOptions } from '../../src/core/improvements.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
function siteFixture() {
  const state = createGame(setup(27));
  const city = state.cities[state.players[0].headquartersCityId];
  const tileIndex = state.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, state.map), city.position, state.map) === 1
    && !state.expansion!.world.resources[i] && !state.expansion!.rareBerries!.deposits[i]);
  expect(tileIndex).toBeGreaterThanOrEqual(0);
  state.map.tiles[tileIndex] = 'grassland';
  for (const unit of Object.values(state.units)) if (unit.ownerId === 0) delete state.units[unit.id];
  const worker = createMapUnit({ kind: 'logistics', role: 'builder' }, 9000, 0, indexToHex(tileIndex, state.map), GAME_CONTENT, 0, 1);
  worker.charges = 3;
  state.units[worker.id] = worker;
  refreshKnowledge(state);
  return { state, city, tileIndex, worker };
}
const improve = (state: GameState, tileIndex: number, unitId = 9000) =>
  step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'ImproveTile', unitId, tileIndex, kind: 'berryFarm' } });

test('improvements initialize on games and require a builder unit', () => {
  const fresh = createGame(setup(27));
  expect(fresh.expansion?.improvements).toEqual({ tiles: {}, projects: {} });
  expect(observe(fresh, 0).expansion?.improvements).toEqual({ tiles: [], projects: [] });
  const hq = fresh.cities[fresh.players[0].headquartersCityId];
  const pokemon = Object.values(fresh.units).find(item => item.ownerId === 0 && item.kind === 'pokemon')!;
  expect(step(fresh, { actorId: 0, expectedSeq: 0, action: { type: 'ImproveTile', unitId: pokemon.id, tileIndex: fresh.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, fresh.map), hq.position, fresh.map) === 1), kind: 'berryFarm' } }).ok).toBe(false);
});

test('the parser accepts ImproveTile and rejects unknown kinds', () => {
  expect(parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'mine' })).toEqual({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'mine' });
  expect(() => parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'castle' })).toThrow();
});

test('crew types work twice as fast; builders finish in one action and spend a charge', () => {
  expect(crewPoints({ kind: 'pokemon', speciesId: 'bulbasaur' }, GAME_CONTENT, 'berryFarm')).toBe(2);
  expect(crewPoints({ kind: 'pokemon', speciesId: 'geodude' }, GAME_CONTENT, 'berryFarm')).toBe(1);
  expect(crewPoints({ kind: 'pokemon', speciesId: 'geodude' }, GAME_CONTENT, 'mine')).toBe(2);
  expect(crewPoints({ kind: 'logistics', role: 'builder' }, GAME_CONTENT, 'berryFarm')).toBe(3);
  const { state, tileIndex } = siteFixture();
  const built = improve(state, tileIndex);
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.state.expansion!.improvements!.tiles[tileIndex]).toMatchObject({ kind: 'berryFarm', builtBy: 0 });
  expect(built.state.units[9000]).toMatchObject({ actionLeft: 0, charges: 2 });
  expect(improve(built.state, tileIndex).ok).toBe(false); // no action point left and already improved
});

test('a completed farm raises the worked tile yield and the city total', () => {
  const { state, city, tileIndex } = siteFixture();
  state.players[0].research.unlockedIds = ['berryCultivation'];
  city.workedTileIds = [tileIndex]; city.lockedTileIds = [];
  const before = cityYield(state, city).food;
  const result = improve(state, tileIndex);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.expansion!.improvements!.tiles[tileIndex]).toMatchObject({ kind: 'berryFarm', builtBy: 0 });
  expect(cityYield(result.state, result.state.cities[city.id]).food).toBe(before + 2);
});

test('improvements require own territory, a matching biome and not a city center', () => {
  const { state, city, worker } = siteFixture();
  const far = state.map.tiles.findIndex((biome, i) => biome === 'grassland' && hexDistance(indexToHex(i, state.map), city.position, state.map) > workRadius(city) + 1
    && Object.values(state.cities).every(other => hexDistance(indexToHex(i, state.map), other.position, state.map) > 4));
  worker.position = indexToHex(far, state.map); refreshKnowledge(state);
  expect(improve(state, far).ok).toBe(false);
  const mountain = state.map.tiles.findIndex((biome, i) => biome === 'mountain' && hexDistance(indexToHex(i, state.map), city.position, state.map) <= workRadius(city) && hexDistance(indexToHex(i, state.map), city.position, state.map) > 0);
  if (mountain >= 0) { worker.position = indexToHex(mountain, state.map); refreshKnowledge(state); expect(improve(state, mountain).ok).toBe(false); }
  const hq = state.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, state.map), city.position, state.map) === 0);
  worker.position = { ...city.position }; refreshKnowledge(state);
  expect(improve(state, hq).ok).toBe(false);
});

test('UI options come from the observation and match authority', () => {
  const { state, tileIndex } = siteFixture();
  const options = improvementOptions(observe(state, 0), 9000, GAME_CONTENT);
  expect(options).toContainEqual({ tileIndex, kind: 'berryFarm', points: 3, progress: 0 });
  for (const option of options) expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'ImproveTile', unitId: 9000, tileIndex: option.tileIndex, kind: option.kind } }).ok).toBe(true);
});

test('projects stay private; rivals see completed improvements only when observed', () => {
  const { state, tileIndex } = siteFixture();
  state.expansion!.improvements!.projects[tileIndex] = { kind: 'berryFarm', playerId: 0, progress: 1 };
  expect(observe(state, 0).expansion!.improvements!.projects).toHaveLength(1);
  expect(observe(state, 1).expansion!.improvements!.projects).toHaveLength(0);
  delete state.expansion!.improvements!.projects[tileIndex];
  const worked = improve(state, tileIndex);
  expect(worked.ok).toBe(true);
  if (!worked.ok) return;
  expect(observe(worked.state, 0).expansion!.improvements!.tiles.some(item => item.tileIndex === tileIndex)).toBe(true);
  expect(observe(worked.state, 1).expansion!.improvements!.tiles.some(item => item.tileIndex === tileIndex)).toBe(false);
});

test('v27 improvement games keep exact save/load and replay', () => {
  const session = new GameSession({ ...setup(27), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
  for (let turn = 0; turn < 30; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(27));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.exportLog().commands.some(command => command.action.type === 'ImproveTile')).toBe(true);
}, 60_000);
