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
import { BATTLE_MAX_MS, BURST_MS, COUNTER_DELAY_MS, GHOST_MS, LUNGE_MS, MOVE_STEP_MS, PROJECTILE_FROM_MS, RANGED_IMPACT_MS, SHAKE_MS, SWEEP_MS, Timeline, battleTiming, battleTrack,
  captureTrack, matchupHint, moveTrack, shakeAmplitude, shakeAt } from '../../src/browser/render/animation.ts';
import type { AnimationFrame, Track } from '../../src/browser/render/animation.ts';
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
  expect(both.effects.map(effect => effect.kind)).toEqual(['impact', 'number', 'capture']);
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
  const spec = { key: 'battle:3', attacker, target, damage: 30, counterDamage: 9, attackerUnit: unit, onImpact: (counter: boolean) => impacts.push(counter) };
  const { impact, counter: counterAt, duration } = battleTiming(spec);
  timeline.add(battleTrack(spec), 0);
  // Before the hit: the attacker lunges toward the target (0.3 hex at the peak), nothing has landed yet.
  expect(timeline.sample(impact - 1, context).effects.some(effect => effect.kind === 'number')).toBe(false);
  expect(impacts).toEqual([]);
  const windUp = timeline.sample(LUNGE_MS, context);
  const home = hexToWorld(attacker), aim = hexToWorld(target);
  expect(windUp.poses).toEqual([{ unit, position: { x: home.x + (aim.x - home.x) * .3, y: home.y + (aim.y - home.y) * .3 } }]);
  const first = timeline.sample(impact + 16, context);
  expect(first.effects).toContainEqual(expect.objectContaining({ kind: 'number', position: target, text: '−30', tone: 'damage' }));
  expect(first.effects).toContainEqual(expect.objectContaining({ kind: 'impact', position: target, burst: true }));
  expect(first.effects.some(effect => effect.kind === 'number' && effect.tone === 'counter')).toBe(false);
  expect(Math.hypot(first.shake!.x, first.shake!.y)).toBeGreaterThan(1);
  expect(impacts).toEqual([false]);
  const counter = timeline.sample(counterAt! + 20, context);
  expect(counterAt).toBe(impact + COUNTER_DELAY_MS);
  expect(counter.effects).toContainEqual(expect.objectContaining({ kind: 'number', position: attacker, text: '反击 −9', tone: 'counter' }));
  expect(impacts).toEqual([false, true]);
  // Shake decays to nothing once both hits have settled; the whole battle stays within 900 ms.
  expect(timeline.sample(counterAt! + SHAKE_MS + 1, context).shake).toBeUndefined();
  expect(duration).toBeLessThanOrEqual(BATTLE_MAX_MS);
  timeline.sample(BATTLE_MAX_MS, context);
  expect(timeline.busy).toBe(false);
  // Reduced motion: same numbers and flash, no lunge, particles or shake.
  const still = new Timeline();
  still.add(battleTrack({ ...spec, key: 'battle:4', counterDamage: 0, motion: false }), 0);
  expect(still.sample(LUNGE_MS, context).poses).toEqual([]);
  const frame = still.sample(impact + 16, context);
  expect(frame.shake).toBeUndefined();
  expect(frame.effects).toContainEqual(expect.objectContaining({ kind: 'impact', burst: false }));
  expect(frame.effects.some(effect => effect.kind === 'number')).toBe(true);
  expect(shakeAt(0, shakeAmplitude(100))!.x).toBeLessThanOrEqual(6);
});

test('ranged battles fly type-coloured projectiles the short way across a wrapping seam, with a matchup hint', () => {
  const map = { width: 24, wrap: true };
  // Attacker in the last column, target two hexes east across the seam (first columns), so the short way is 2 hexes.
  const attacker = { q: 23 - 2, r: 4 }, target = { q: 1 - 2, r: 4 };
  const spec = { key: 'battle:5', attacker, target, damage: 20, counterDamage: 6, map, ranged: true, attackColor: '#F08A4B', counterColor: '#6FA5EE', effectiveness: 200 };
  const { impact, counter, duration } = battleTiming(spec);
  expect(impact).toBe(RANGED_IMPACT_MS);
  expect(duration).toBeLessThanOrEqual(BATTLE_MAX_MS);
  const track = battleTrack(spec);
  const frameAt = (elapsed: number) => { const frame: AnimationFrame = { poses: [], effects: [] }; track.sample(elapsed, context, frame); return frame; };
  const flying = frameAt((PROJECTILE_FROM_MS + impact) / 2).effects.find(effect => effect.kind === 'projectile');
  expect(flying).toMatchObject({ color: '#F08A4B' });
  if (flying?.kind !== 'projectile') throw new Error('expected a projectile');
  const hex = Math.sqrt(3) * 22;
  expect(Math.hypot(flying.to.x - flying.from.x, flying.to.y - flying.from.y)).toBeCloseTo(hex * 2, 3);
  const hit = frameAt(impact + 10).effects;
  expect(hit).toContainEqual(expect.objectContaining({ kind: 'impact', color: '#F08A4B' }));
  expect(hit).toContainEqual(expect.objectContaining({ kind: 'number', text: '效果拔群', tone: 'super' }));
  const back = frameAt((impact + counter!) / 2 + 20).effects.find(effect => effect.kind === 'projectile');
  expect(back).toMatchObject({ color: '#6FA5EE' });
  expect(matchupHint(50)).toEqual({ text: '效果不佳', tone: 'weak' });
  expect(matchupHint(0)).toEqual({ text: '没有效果', tone: 'weak' });
  expect(matchupHint(100)).toBeNull();
});

test('a knocked-down unit leaves a sinking grey afterimage with its tag; a captured city sweeps its territory', () => {
  const attacker = { q: 2, r: 3 }, target = { q: 3, r: 3 }, victim = { ...unit, id: 9, ownerId: 1 };
  const spec = { key: 'battle:6', attacker, target, damage: 40, counterDamage: 0, targetUnit: victim, targetDown: '休养' };
  const { impact, duration } = battleTiming(spec);
  const track = battleTrack(spec);
  const frameAt = (elapsed: number) => { const frame: AnimationFrame = { poses: [], effects: [] }; track.sample(elapsed, context, frame); return frame; };
  // Still standing until the hit (the final state no longer has it), then fading grey.
  expect(frameAt(impact - 10).poses).toEqual([{ unit: victim, position: hexToWorld(target) }]);
  const fading = frameAt(impact + GHOST_MS / 2).poses[0];
  expect(fading).toMatchObject({ unit: victim, grey: true });
  expect(fading.alpha!).toBeGreaterThan(0); expect(fading.alpha!).toBeLessThan(1);
  expect(fading.position.y).toBeGreaterThan(hexToWorld(target).y);
  expect(frameAt(impact + 200).effects).toContainEqual(expect.objectContaining({ kind: 'number', text: '休养', tone: 'tag' }));
  expect(frameAt(impact + GHOST_MS + 1).poses).toEqual([]);
  expect(duration).toBeLessThanOrEqual(BATTLE_MAX_MS);

  const tiles = [{ hex: target, ring: 0 }, { hex: { q: 4, r: 3 }, ring: 1 }, { hex: { q: 5, r: 3 }, ring: 2 }];
  const siege = battleTrack({ key: 'battle:7', attacker, target, damage: 50, counterDamage: 0, capture: { tiles, ownerId: 0, previousOwner: 1 } });
  const capture = battleTiming({ counterDamage: 0, capture: { tiles, ownerId: 0 } });
  expect(capture.duration).toBe(capture.impact + SWEEP_MS);
  const frame: AnimationFrame = { poses: [], effects: [] };
  siege.sample(capture.impact + 100, context, frame);
  expect(frame.effects).toContainEqual(expect.objectContaining({ kind: 'sweep', ownerId: 0, tiles }));
  expect(frame.effects).toContainEqual(expect.objectContaining({ kind: 'banner', position: target, ownerId: 1 }));
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
