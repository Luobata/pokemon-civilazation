// Presentation timeline: turns authoritative events into timed visual tracks.
// The game state is already final when a track starts; tracks only override how things look
// for a while (a unit drawn mid-path, a damage number). Pure: no DOM, testable in Node.
import { nearestCopy } from '../../core/hex.ts';
import type { Hex, MapShape } from '../../core/hex.ts';
import { hexToWorld } from '../camera.ts';
import type { Point } from '../camera.ts';
import type { UnitMarkIdentity } from './scene.ts';

export type MapEffect = { kind: 'battle'; position: Hex; progress: number }
  /** Outlined combat text that pops, floats up and fades (`progress` 0..1 over its own life). */
  | { kind: 'number'; position: Hex; text: string; tone: NumberTone; progress: number }
  | { kind: 'capture'; position: Hex; success: boolean; progress: number }
  | { kind: 'evolve'; position: Hex; progress: number }
  /** Click feedback: a ring expanding from the tapped tile; `error` for a rejected click. */
  | { kind: 'tap'; position: Hex; progress: number; tone: 'ok' | 'error' };
/** damage: the hit on the target; counter: the counter-attack, drawn on the attacker. */
export type NumberTone = 'damage' | 'counter';
/** A unit drawn at a world position instead of its tile; the scene unit with the same id is hidden. */
export type UnitPose = { unit: UnitMarkIdentity; position: Point };
/**
 * What the renderer applies on top of the scene for one frame. `shake` offsets the whole frame in CSS pixels
 * (cached layers included), so the camera and the layer caches are untouched.
 */
export type AnimationFrame = { poses: UnitPose[]; effects: MapEffect[]; shake?: Point };
export const EMPTY_FRAME: AnimationFrame = { poses: [], effects: [] };

/** Live lookups a track may need while it plays (e.g. where a captured unit now stands). */
export type TrackContext = { unitPosition(id: number): Hex | undefined };

export type Track = {
  /** Stable identity, e.g. "move:12"; adding a track with the same key replaces it. */
  key: string;
  /** Milliseconds; Infinity for ambient loops, which never block "busy". */
  duration: number;
  /** false: plays alongside input (click feedback) and never makes the timeline busy. Default true. */
  blocking?: boolean;
  /** Writes this track's contribution for `elapsed` ms into `frame`. */
  sample(elapsed: number, context: TrackContext, frame: AnimationFrame): void;
  /** Called once when the track ends (not called when it is skipped). */
  onFinish?(): void;
  /** One-off callbacks at `at` ms, sorted by `at` (e.g. the hit sound on impact). Due cues still run when the track ends; never when it is skipped. */
  cues?: readonly { at: number; run(): void }[];
};

type Running = { track: Track; started: number; cued: number };

/**
 * Tracks run in parallel; callers that want sequencing (one event after another) add the next
 * track when `busy` turns false, exactly like the presentation queue does today.
 */
export class Timeline {
  private running: Running[] = [];

  add(track: Track, now: number): void {
    this.running = this.running.filter(item => item.track.key !== track.key);
    this.running.push({ track, started: now, cued: 0 });
  }

  /** True while any finite, blocking track is playing. Ambient loops and click feedback don't count. */
  get busy(): boolean { return this.running.some(item => Number.isFinite(item.track.duration) && item.track.blocking !== false); }
  /** True while anything (including ambient loops) needs further frames. */
  get animating(): boolean { return this.running.length > 0; }

  /** Ends tracks whose time is up, calling their onFinish; runs due cues. Call before queueing follow-up tracks. */
  advance(now: number): void {
    const ended = this.running.filter(item => now - item.started >= item.track.duration);
    this.running = this.running.filter(item => !ended.includes(item));
    for (const item of this.running) cue(item, now - item.started);
    for (const item of ended) { cue(item, Infinity); item.track.onFinish?.(); }
  }

  /** Advances, then collects every running track's contribution for this frame. */
  sample(now: number, context: TrackContext): AnimationFrame {
    this.advance(now);
    const frame: AnimationFrame = { poses: [], effects: [] };
    for (const item of this.running) item.track.sample(now - item.started, context, frame);
    return frame;
  }

  /** Drops everything without finish callbacks (skip / animation off). Returns the dropped keys. */
  clear(): string[] {
    const keys = this.running.map(item => item.track.key);
    this.running = [];
    return keys;
  }
}
function cue(item: Running, elapsed: number) {
  const cues = item.track.cues;
  while (cues && item.cued < cues.length && cues[item.cued].at <= elapsed) cues[item.cued++].run();
}

// ---------- Tracks for the current presentation events ----------
export const MOVE_STEP_MS = 180;
export const BURST_MS = 600;
export const EVOLVE_MS = 450;

/** `map`: on a v22 wrapping map each step is taken to the next tile's nearest copy, so a walk across the seam slides one hex, not across the map. */
export function moveTrack(unit: UnitMarkIdentity, path: readonly Hex[], onFinish?: () => void, map: MapShape = { width: 0 }): Track {
  const steps: Hex[] = [];
  for (const hex of path) steps.push(steps.length ? nearestCopy(steps[steps.length - 1], hex, map) : hex);
  return {
    key: `move:${unit.id}`, duration: Math.max(1, path.length - 1) * MOVE_STEP_MS, onFinish,
    sample(elapsed, _context, frame) {
      const progress = Math.min(steps.length - 1, elapsed / MOVE_STEP_MS);
      const index = Math.floor(progress), fraction = progress - index;
      const a = hexToWorld(steps[index]), b = hexToWorld(steps[Math.min(index + 1, steps.length - 1)]);
      frame.poses.push({ unit, position: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction } });
    },
  };
}

/** How long a combat number stays up, and when the counter-attack lands after the hit. */
export const NUMBER_MS = 600;
export const COUNTER_DELAY_MS = 200;
export const SHAKE_MS = 200;

/** Adds a whole-frame shake; with several tracks the strongest wins. */
function addShake(frame: AnimationFrame, offset: Point | null) {
  if (offset && (!frame.shake || Math.hypot(offset.x, offset.y) > Math.hypot(frame.shake.x, frame.shake.y))) frame.shake = offset;
}
/** Decaying shake `elapsed` ms after an impact, `amplitude` CSS px at its peak (deterministic, no randomness). */
export function shakeAt(elapsed: number, amplitude: number): Point | null {
  if (elapsed < 0 || elapsed >= SHAKE_MS || amplitude <= 0) return null;
  const t = elapsed / SHAKE_MS, fall = amplitude * (1 - t);
  return { x: fall * Math.cos(t * Math.PI * 7), y: fall * .6 * Math.sin(t * Math.PI * 5 + 1) };
}
/** 2–6 px, growing with the damage dealt. */
export const shakeAmplitude = (damage: number) => Math.max(2, Math.min(6, 2 + damage / 10));

export type BattleSpec = {
  key: string;
  /** `positions[0]` and `positions[1]` of BattleResolved: where the attacker and the target stood. */
  attacker: Hex; target: Hex;
  damage: number; counterDamage: number;
  /** false (reduced motion): no screen shake. Default true. */
  motion?: boolean;
  onFinish?(): void;
  /** Runs when the hit lands and, with a counter, when the counter lands. */
  onImpact?(counter: boolean): void;
};
/**
 * One battle: the target flashes and its damage pops up on the target; the counter-attack lands
 * COUNTER_DELAY_MS later and its number pops up on the attacker. Each hit shakes the frame.
 */
export function battleTrack(spec: BattleSpec): Track {
  const { attacker, target, damage, counterDamage } = spec, motion = spec.motion ?? true;
  const counterAt = counterDamage ? COUNTER_DELAY_MS : null;
  const duration = Math.max(BURST_MS, (counterAt ?? 0) + NUMBER_MS);
  const onImpact = spec.onImpact;
  const cues = onImpact ? [{ at: 0, run: () => onImpact(false) }, ...(counterAt === null ? [] : [{ at: counterAt, run: () => onImpact(true) }])] : undefined;
  return { key: spec.key, duration, onFinish: spec.onFinish, ...(cues ? { cues } : {}),
    sample(elapsed, _context, frame) {
      if (elapsed < BURST_MS) frame.effects.push({ kind: 'battle', position: target, progress: Math.min(1, elapsed / BURST_MS) });
      if (elapsed < NUMBER_MS) frame.effects.push({ kind: 'number', position: target, text: `−${damage}`, tone: 'damage', progress: elapsed / NUMBER_MS });
      if (counterAt !== null && elapsed >= counterAt && elapsed < counterAt + NUMBER_MS)
        frame.effects.push({ kind: 'number', position: attacker, text: `反击 −${counterDamage}`, tone: 'counter', progress: (elapsed - counterAt) / NUMBER_MS });
      if (!motion) return;
      addShake(frame, shakeAt(elapsed, shakeAmplitude(damage)));
      if (counterAt !== null) addShake(frame, shakeAt(elapsed - counterAt, shakeAmplitude(counterDamage) * .7));
    } };
}

/** Follows the target unit's live position, so a capture lands where the unit is shown. */
export function captureTrack(key: string, targetUnitId: number, success: boolean, onFinish?: () => void): Track {
  return { key, duration: BURST_MS, onFinish,
    sample(elapsed, context, frame) {
      const position = context.unitPosition(targetUnitId);
      if (position) frame.effects.push({ kind: 'capture', position, success, progress: Math.min(1, elapsed / BURST_MS) });
    } };
}

export const TAP_MS = 260;
/** Non-blocking click ripple; one at a time (same key), so rapid clicks restart it. */
export function tapTrack(position: Hex, tone: 'ok' | 'error' = 'ok'): Track {
  return { key: 'tap', duration: TAP_MS, blocking: false,
    sample(elapsed, _context, frame) { frame.effects.push({ kind: 'tap', position, tone, progress: Math.min(1, elapsed / TAP_MS) }); } };
}

export function evolveTrack(key: string, unitId: number, onFinish?: () => void): Track {
  return { key, duration: EVOLVE_MS, onFinish,
    sample(elapsed, context, frame) {
      const position = context.unitPosition(unitId);
      if (position) frame.effects.push({ kind: 'evolve', position, progress: Math.min(1, elapsed / EVOLVE_MS) });
    } };
}
