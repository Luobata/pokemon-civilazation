// Presentation timeline: turns authoritative events into timed visual tracks.
// The game state is already final when a track starts; tracks only override how things look
// for a while (a unit drawn mid-path, a damage number). Pure: no DOM, testable in Node.
import { nearestCopy } from '../../core/hex.ts';
import type { Hex, MapShape } from '../../core/hex.ts';
import { hexToWorld } from '../camera.ts';
import type { Point } from '../camera.ts';
import type { UnitMarkIdentity } from './scene.ts';

export type MapEffect = { kind: 'battle'; position: Hex; damage: number; counterDamage: number; progress: number }
  | { kind: 'capture'; position: Hex; success: boolean; progress: number }
  | { kind: 'evolve'; position: Hex; progress: number }
  /** Click feedback: a ring expanding from the tapped tile; `error` for a rejected click. */
  | { kind: 'tap'; position: Hex; progress: number; tone: 'ok' | 'error' };
/** A unit drawn at a world position instead of its tile; the scene unit with the same id is hidden. */
export type UnitPose = { unit: UnitMarkIdentity; position: Point };
/** What the renderer applies on top of the scene for one frame. */
export type AnimationFrame = { poses: UnitPose[]; effects: MapEffect[] };
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
};

type Running = { track: Track; started: number };

/**
 * Tracks run in parallel; callers that want sequencing (one event after another) add the next
 * track when `busy` turns false, exactly like the presentation queue does today.
 */
export class Timeline {
  private running: Running[] = [];

  add(track: Track, now: number): void {
    this.running = this.running.filter(item => item.track.key !== track.key);
    this.running.push({ track, started: now });
  }

  /** True while any finite, blocking track is playing. Ambient loops and click feedback don't count. */
  get busy(): boolean { return this.running.some(item => Number.isFinite(item.track.duration) && item.track.blocking !== false); }
  /** True while anything (including ambient loops) needs further frames. */
  get animating(): boolean { return this.running.length > 0; }

  /** Ends tracks whose time is up, calling their onFinish. Call before queueing follow-up tracks. */
  advance(now: number): void {
    const ended = this.running.filter(item => now - item.started >= item.track.duration);
    this.running = this.running.filter(item => !ended.includes(item));
    for (const item of ended) item.track.onFinish?.();
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

export function battleTrack(key: string, position: Hex, damage: number, counterDamage: number, onFinish?: () => void): Track {
  return { key, duration: BURST_MS, onFinish,
    sample(elapsed, _context, frame) { frame.effects.push({ kind: 'battle', position, damage, counterDamage, progress: Math.min(1, elapsed / BURST_MS) }); } };
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
