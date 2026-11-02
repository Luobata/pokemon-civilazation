import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
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
function siteFixture(speciesId: SpeciesId = 'geodude') {
  const state = createGame(setup(2));
  const city = state.cities[state.players[0].headquartersCityId];
  const tileIndex = state.map.tiles.findIndex((biome, i) => biome === 'grassland'
    && hexDistance(indexToHex(i, state.map), city.position) === 1);
  expect(tileIndex).toBeGreaterThanOrEqual(0);
  for (const unit of Object.values(state.units)) if (unit.ownerId === 0) delete state.units[unit.id];
  const worker = createMapUnit({ kind: 'pokemon', speciesId }, 9000, 0, indexToHex(tileIndex, state.map), EXPANSION_CONTENT, 0, 1);
  state.units[worker.id] = worker;
  refreshKnowledge(state);
  return { state, city, tileIndex, worker };
}
const improve = (state: GameState, tileIndex: number, unitId = 9000) =>
  step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'ImproveTile', unitId, tileIndex, kind: 'berryFarm' } });

test('improvements exist only in gameplay v2 era games', () => {
  expect(createGame(setup(2)).expansion?.improvements).toEqual({ tiles: {}, projects: {} });
  expect(createGame(setup(1)).expansion).not.toHaveProperty('improvements');
  expect(createGame(setup()).expansion).not.toHaveProperty('improvements');
  expect(observe(createGame(setup(1)), 0).expansion).not.toHaveProperty('improvements');
  const v1 = createGame(setup(1)), hq = v1.cities[v1.players[0].headquartersCityId];
  const unit = Object.values(v1.units).find(item => item.ownerId === 0 && item.kind === 'pokemon')!;
  expect(step(v1, { actorId: 0, expectedSeq: 0, action: { type: 'ImproveTile', unitId: unit.id, tileIndex: v1.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, v1.map), hq.position) === 1), kind: 'berryFarm' } }).ok).toBe(false);
});

test('the parser accepts ImproveTile and rejects unknown kinds', () => {
  expect(parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'mine' })).toEqual({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'mine' });
  expect(() => parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'castle' })).toThrow();
});

test('crew types work twice as fast and progress persists across turns', () => {
  expect(crewPoints({ kind: 'pokemon', speciesId: 'bulbasaur' }, EXPANSION_CONTENT, 'berryFarm')).toBe(2);
  expect(crewPoints({ kind: 'pokemon', speciesId: 'geodude' }, EXPANSION_CONTENT, 'berryFarm')).toBe(1);
  expect(crewPoints({ kind: 'pokemon', speciesId: 'geodude' }, EXPANSION_CONTENT, 'mine')).toBe(2);
  const { state, tileIndex } = siteFixture('geodude');
  const first = improve(state, tileIndex);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.state.expansion!.improvements!.projects[tileIndex]).toMatchObject({ kind: 'berryFarm', progress: 1 });
  expect(improve(first.state, tileIndex).ok).toBe(false); // no action point left
  const next = first.state; next.units[9000].actionLeft = 1;
  const second = improve(next, tileIndex);
  expect(second.ok && second.state.expansion!.improvements!.projects[tileIndex].progress).toBe(2);
});

test('a completed farm raises the worked tile yield and the city total', () => {
  const { state, city, tileIndex } = siteFixture('bulbasaur');
  state.players[0].research.unlockedIds = ['berryCultivation'];
  city.workedTileIds = [tileIndex]; city.lockedTileIds = [];
  const before = cityYield(state, city).food;
  let current: GameState = state;
  for (let i = 0; i < 2; i++) {
    current.units[9000].actionLeft = 1;
    const result = improve(current, tileIndex);
    expect(result.ok).toBe(true);
    if (result.ok) current = result.state;
  }
  expect(current.expansion!.improvements!.tiles[tileIndex]).toMatchObject({ kind: 'berryFarm', builtBy: 0 });
  expect(cityYield(current, current.cities[city.id]).food).toBe(before + 2);
});

test('improvements require own territory, a matching biome and not a city center', () => {
  const { state, city, worker } = siteFixture('bulbasaur');
  const far = state.map.tiles.findIndex((biome, i) => biome === 'grassland' && hexDistance(indexToHex(i, state.map), city.position) > workRadius(city) + 1
    && Object.values(state.cities).every(other => hexDistance(indexToHex(i, state.map), other.position) > 4));
  worker.position = indexToHex(far, state.map); refreshKnowledge(state);
  expect(improve(state, far).ok).toBe(false);
  const mountain = state.map.tiles.findIndex((biome, i) => biome === 'mountain' && hexDistance(indexToHex(i, state.map), city.position) <= workRadius(city) && hexDistance(indexToHex(i, state.map), city.position) > 0);
  if (mountain >= 0) { worker.position = indexToHex(mountain, state.map); refreshKnowledge(state); expect(improve(state, mountain).ok).toBe(false); }
  const hq = state.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, state.map), city.position) === 0);
  worker.position = { ...city.position }; refreshKnowledge(state);
  expect(improve(state, hq).ok).toBe(false);
});

test('UI options come from the observation and match authority', () => {
  const { state, tileIndex } = siteFixture('bulbasaur');
  const options = improvementOptions(observe(state, 0), 9000, EXPANSION_CONTENT);
  expect(options).toContainEqual({ tileIndex, kind: 'berryFarm', points: 2, progress: 0 });
  for (const option of options) expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'ImproveTile', unitId: 9000, tileIndex: option.tileIndex, kind: option.kind } }).ok).toBe(true);
});

test('projects stay private; rivals see completed improvements only when observed', () => {
  const { state, tileIndex } = siteFixture('geodude');
  const worked = improve(state, tileIndex);
  expect(worked.ok).toBe(true);
  if (!worked.ok) return;
  expect(observe(worked.state, 0).expansion!.improvements!.projects).toHaveLength(1);
  expect(observe(worked.state, 1).expansion!.improvements!.projects).toHaveLength(0);
});

test('gameplay v2 games keep exact save/load and replay', () => {
  const session = new GameSession({ ...setup(2), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
  for (let turn = 0; turn < 30; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(2));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.exportLog().commands.some(command => command.action.type === 'ImproveTile')).toBe(true);
});
