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
import { BURST_MS, COUNTER_DELAY_MS, MOVE_STEP_MS, SHAKE_MS, Timeline, battleTrack, captureTrack, moveTrack, shakeAmplitude, shakeAt } from '../../src/browser/render/animation.ts';
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
  timeline.add(battleTrack({ key: 'battle:1', attacker: { q: 0, r: 1 }, target: { q: 1, r: 1 }, damage: 12, counterDamage: 0, onFinish: () => finished.push('battle') }), 0);
  timeline.add(captureTrack('capture:1', 9, true, () => finished.push('capture')), 100);
  const both = timeline.sample(300, context);
  expect(both.effects.map(effect => effect.kind)).toEqual(['battle', 'number', 'capture']);
  expect(both.effects[2]).toMatchObject({ position: { q: 3, r: 2 }, progress: 200 / BURST_MS });
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
  timeline.add(battleTrack({ key: 'battle:2', attacker: { q: 1, r: 0 }, target: { q: 0, r: 0 }, damage: 1, counterDamage: 0, onFinish: () => { called = true; }, onImpact: () => { called = true; } }), 0);
  expect(timeline.clear()).toEqual(['ambient:water', 'battle:2']);
  expect(called).toBe(false);
  expect(timeline.animating).toBe(false);
});

test('battle numbers: the damage pops on the target, the counter on the attacker; the frame shakes without the camera', () => {
  const attacker = { q: 2, r: 3 }, target = { q: 3, r: 3 };
  const impacts: boolean[] = [];
  const timeline = new Timeline();
  timeline.add(battleTrack({ key: 'battle:3', attacker, target, damage: 30, counterDamage: 9, onImpact: counter => impacts.push(counter) }), 0);
  const first = timeline.sample(16, context);
  expect(first.effects).toContainEqual(expect.objectContaining({ kind: 'number', position: target, text: '−30', tone: 'damage' }));
  expect(first.effects.some(effect => effect.kind === 'number' && effect.tone === 'counter')).toBe(false);
  expect(Math.hypot(first.shake!.x, first.shake!.y)).toBeGreaterThan(1);
  expect(impacts).toEqual([false]);
  const counter = timeline.sample(COUNTER_DELAY_MS + 20, context);
  expect(counter.effects).toContainEqual(expect.objectContaining({ kind: 'number', position: attacker, text: '反击 −9', tone: 'counter' }));
  expect(impacts).toEqual([false, true]);
  // Shake decays to nothing once both hits have settled; the whole battle stays within 900 ms.
  expect(timeline.sample(COUNTER_DELAY_MS + SHAKE_MS + 1, context).shake).toBeUndefined();
  timeline.sample(900, context);
  expect(timeline.busy).toBe(false);
  // Reduced motion: same numbers, no shake.
  const still = new Timeline();
  still.add(battleTrack({ key: 'battle:4', attacker, target, damage: 30, counterDamage: 0, motion: false }), 0);
  const frame = still.sample(16, context);
  expect(frame.shake).toBeUndefined();
  expect(frame.effects.some(effect => effect.kind === 'number')).toBe(true);
  expect(shakeAt(0, shakeAmplitude(100))!.x).toBeLessThanOrEqual(6);
});

test('cues run once when due, and the remaining ones when the track ends; skipping drops them', () => {
  const ran: number[] = [];
  const timeline = new Timeline();
  const track = (key: string): Track => ({ key, duration: 100, sample: () => undefined, cues: [{ at: 10, run: () => ran.push(10) }, { at: 90, run: () => ran.push(90) }] });
  timeline.add(track('a'), 0);
  timeline.sample(5, context); expect(ran).toEqual([]);
  timeline.sample(20, context); timeline.sample(30, context); expect(ran).toEqual([10]);
  timeline.sample(500, context); expect(ran).toEqual([10, 90]);
  timeline.add(track('b'), 1000);
  timeline.clear();
  timeline.sample(1200, context); expect(ran).toEqual([10, 90]);
});
