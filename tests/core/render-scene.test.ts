import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import { isMapUnit } from '../../src/core/model.ts';
import { buildScene, sceneMarkedTiles } from '../../src/browser/render/scene.ts';
import { BURST_MS, MOVE_STEP_MS, Timeline, battleTrack, captureTrack, moveTrack } from '../../src/browser/render/animation.ts';
import type { Track } from '../../src/browser/render/animation.ts';
import { hexToWorld } from '../../src/browser/camera.ts';

function playedV10(rounds: number): GameState {
  const setup: GameSetup = { seed: 7, width: 30, height: 20, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 10, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'brock' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'misty' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < rounds) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, memory);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}

test('scenes built from a PlayerView only mark tiles the player can see or remembers', () => {
  const state = playedV10(50);
  let marks = 0, hiddenLive = 0;
  for (const playerId of state.turnOrder) {
    const view = observe(state, playerId, EXPANSION_CONTENT);
    const scene = buildScene({ view, selectedCity: view.economy.cities[0]?.id ?? null });
    const visible = new Set(view.visibleTileIds);
    // Units are live information: only on tiles in sight right now, and only those the view lists.
    for (const unit of scene.units) expect(visible.has(unit.index), `unit ${unit.key} for player ${playerId}`).toBe(true);
    expect(scene.units.map(unit => unit.unit.id).sort()).toEqual(view.units.map(unit => unit.id).sort());
    // Everything else sits on a known (seen or remembered) tile.
    for (const mark of sceneMarkedTiles(scene)) {
      expect(view.map.tiles[mark.index], `${mark.layer} on unknown tile ${mark.index} for player ${playerId}`).not.toBeNull();
      marks++;
    }
    for (const index of scene.fog) expect(visible.has(index)).toBe(false);
    for (const row of scene.yields) expect(view.map.tiles[row.index]).not.toBeNull();
    // The world really hides something from this player, so the checks above are not vacuous.
    hiddenLive += Object.values(state.units).filter(isMapUnit).filter(unit => !visible.has(hexToIndex(unit.position, state.map)!)).length;
  }
  expect(marks).toBeGreaterThan(50);
  expect(hiddenLive).toBeGreaterThan(0);
}, 60_000);

test('the yield layer only lists the selected city when turned off', () => {
  const state = playedV10(20), view = observe(state, 0, EXPANSION_CONTENT);
  expect(buildScene({ view, layers: { yields: false } }).yields).toEqual([]);
  const focused = buildScene({ view, layers: { yields: false }, selectedCity: view.economy.cities[0].id });
  expect(focused.yields.length).toBeGreaterThan(0);
  expect(focused.yields.every(row => row.inFocus)).toBe(true);
  expect(buildScene({ view }).yields.length).toBeGreaterThan(focused.yields.length);
}, 30_000);

const unit = { id: 5, ownerId: 0, kind: 'pokemon' as const, speciesId: 'bulbasaur' as const };
const context = { unitPosition: (id: number) => id === 9 ? { q: 3, r: 2 } : undefined };

test('move tracks interpolate along the path with the existing timing', () => {
  const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }];
  const timeline = new Timeline();
  timeline.add(moveTrack(unit, path), 1000);
  expect(timeline.busy).toBe(true);
  const halfway = timeline.sample(1000 + MOVE_STEP_MS * 1.5, context);
  const a = hexToWorld(path[1]), b = hexToWorld(path[2]);
  expect(halfway.poses).toEqual([{ unit, position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }]);
  expect(timeline.sample(1000 + MOVE_STEP_MS * 2, context).poses).toEqual([]);
  expect(timeline.busy).toBe(false);
});

test('tracks run in parallel, replace by key, and finish once', () => {
  const finished: string[] = [];
  const timeline = new Timeline();
  timeline.add(battleTrack('battle:1', { q: 1, r: 1 }, 12, 3, () => finished.push('battle')), 0);
  timeline.add(captureTrack('capture:1', 9, true, () => finished.push('capture')), 100);
  const both = timeline.sample(300, context);
  expect(both.effects.map(effect => effect.kind)).toEqual(['battle', 'capture']);
  expect(both.effects[1]).toMatchObject({ position: { q: 3, r: 2 }, progress: 200 / BURST_MS });
  timeline.sample(BURST_MS, context);
  expect(finished).toEqual(['battle']);
  timeline.add(captureTrack('capture:1', 9, false, () => finished.push('replacement')), BURST_MS);
  timeline.sample(BURST_MS * 2, context);
  expect(finished).toEqual(['battle', 'replacement']);
});

test('ambient loops keep animating without blocking the presentation queue; clear skips finish callbacks', () => {
  const timeline = new Timeline();
  const ambient: Track = { key: 'ambient:water', duration: Infinity, sample: () => undefined };
  let called = false;
  timeline.add(ambient, 0);
  expect(timeline.busy).toBe(false);
  expect(timeline.animating).toBe(true);
  timeline.add(battleTrack('battle:2', { q: 0, r: 0 }, 1, 0, () => { called = true; }), 0);
  expect(timeline.clear()).toEqual(['ambient:water', 'battle:2']);
  expect(called).toBe(false);
  expect(timeline.animating).toBe(false);
});
