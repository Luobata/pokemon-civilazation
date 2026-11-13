// Presentation timeline: turns authoritative events into timed visual tracks.
// The game state is already final when a track starts; tracks only override how things look
// for a while (a unit drawn mid-path, a damage number). Pure: no DOM, testable in Node.
import { nearestCopy } from '../../core/hex.ts';
import type { Hex, MapShape } from '../../core/hex.ts';
import { hexToWorld } from '../camera.ts';
import type { Point } from '../camera.ts';
import type { SceneWeather, UnitMarkIdentity } from './scene.ts';
import type { SpeciesId } from '../../content/species.ts';

/** A hit landing on a tile: white flash, and with `burst` a ring and particles in the attack type's colour. */
export type MapEffect = { kind: 'impact'; position: Hex; color: string; burst: boolean; progress: number }
  /** A ranged attack in flight, in world coordinates (already the short way across a wrapping map's seam). */
  | { kind: 'projectile'; from: Point; to: Point; color: string; progress: number }
  /** Outlined combat text that pops, floats up and fades (`progress` 0..1 over its own life); `lift` raises it by hex radii. */
  | { kind: 'number'; position: Hex; text: string; tone: NumberTone; progress: number; lift?: number }
  /** City capture: the new owner's colour sweeps over its territory ring by ring (`ring` = distance from the city). */
  | { kind: 'sweep'; tiles: readonly { hex: Hex; ring: number }[]; ownerId: number | null; progress: number }
  /** City capture: the previous owner's banner tears off and falls. */
  | { kind: 'banner'; position: Hex; ownerId: number | null; progress: number }
  | { kind: 'capture'; position: Hex; success: boolean; progress: number }
  | { kind: 'evolve'; position: Hex; progress: number }
  /** depth-v26 §4.2: the evolution moment around a posed unit (`elapsed` ms; `motion` false = the still glow). */
  | { kind: 'evolution'; position: Hex; progress: number; elapsed: number; motion: boolean; from: SpeciesId; to: SpeciesId }
  /** Click feedback: a ring expanding from the tapped tile; `error` for a rejected click. */
  | { kind: 'tap'; position: Hex; progress: number; tone: 'ok' | 'error' }
  /** V8 big event: rings expanding from the tile in `color`, an optional rising icon and a floating label. */
  | { kind: 'pulse'; position: Hex; color: string; label?: string; icon?: PulseIcon; progress: number }
  /** V8 trade route established: a bright dash runs once along the route (world coordinates, the short way across the seam). */
  | { kind: 'route'; from: Point; to: Point; progress: number }
  /** V9 era form change on a unit: Mega rainbow ring, Dynamax red glow, Tera crystal (in `color`), Z-Move gold column. */
  | { kind: 'form'; position: Hex; form: FormKind; color: string; progress: number }
  /** V10 wonder reveal: a gold light pillar on the city, with rising particles when `burst`. */
  | { kind: 'pillar'; position: Hex; burst: boolean; progress: number };
export type PulseIcon = 'chevron' | 'alert' | 'star';
export type FormKind = 'mega' | 'dynamax' | 'tera' | 'zMove';
/** damage: the hit on the target; counter: the counter-attack, drawn on the attacker; super / weak: the type matchup; tag: 休养 / 击倒. */
export type NumberTone = 'damage' | 'counter' | 'super' | 'weak' | 'tag';
/**
 * A unit drawn at a world position instead of its tile; the scene unit with the same id is hidden.
 * `alpha` / `grey`: a knocked-down unit's fading afterimage (it is no longer in the scene).
 */
export type UnitPose = { unit: UnitMarkIdentity; position: Point; alpha?: number; grey?: boolean;
  /** Drawn larger (V9 Dynamax), 1 = normal size. */
  scale?: number;
  /** depth-v26 §4.2: an evolving unit — the form shown (`unit.speciesId`) under a white silhouette of strength `white`. */
  evolution?: { form: 'from' | 'to'; white: number; elapsed: number } };
/** A weather field's opacity while it fades in or out (V11); `field` carries a field that has already left the scene. */
export type WeatherFade = { key: string; alpha: number; field?: SceneWeather };
/**
 * What the renderer applies on top of the scene for one frame. `shake` offsets the whole frame in CSS pixels
 * (cached layers included), so the camera and the layer caches are untouched.
 * `night` (0..1) overrides the scene's night overlay strength while day and night cross-fade; `weather` fades fields.
 * `camera` is the V10 wonder-reveal camera: the game loop applies it (the only track that moves the camera).
 */
export type AnimationFrame = { poses: UnitPose[]; effects: MapEffect[]; shake?: Point; night?: number; weather?: WeatherFade[];
  camera?: { x: number; y: number; zoom: number } };
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
  /**
   * true: a stalled main thread pauses this track's clock instead of skipping its frames (a frame gap longer than
   * MAX_FRAME_GAP_MS counts as one frame). For motion the player must see whole, like the wonder-reveal camera.
   */
  paced?: boolean;
};
/** Frame gaps longer than this (ms) count as a single frame for paced tracks. */
export const MAX_FRAME_GAP_MS = 100;

type Running = { track: Track; started: number; cued: number };

/**
 * Tracks run in parallel; callers that want sequencing (one event after another) add the next
 * track when `busy` turns false, exactly like the presentation queue does today.
 */
export class Timeline {
  private running: Running[] = [];
  private lastNow: number | null = null;

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
    const gap = this.lastNow === null ? 0 : now - this.lastNow;
    this.lastNow = now;
    if (gap > MAX_FRAME_GAP_MS) for (const item of this.running) if (item.track.paced) item.started += gap - 1000 / 60;
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

// ---------- Battle (handoff-combat-presentation V1–V6) ----------
// Timing, ms from the start of the track. The whole battle stays within 900 ms:
//   0–150 attacker lunges toward the target (ranged: a short step), 100–270 the projectile flies (ranged only),
//   impact at 150 (melee) / 270 (ranged): flash, type-coloured particles, shake, number and matchup hint,
//   the counter-attack lands COUNTER_DELAY_MS later on the attacker, a knocked-down unit's afterimage sinks and fades,
//   a captured city's old banner tears off while the new owner's colour sweeps out ring by ring.
export const LUNGE_MS = 150;
export const MELEE_IMPACT_MS = 150;
export const RANGED_IMPACT_MS = 270;
export const PROJECTILE_FROM_MS = 100;
export const COUNTER_DELAY_MS = 180;
export const NUMBER_MS = 450;
export const IMPACT_MS = 380;
export const GHOST_MS = 450;
export const SWEEP_MS = 600;
export const SWEEP_RING_MS = 110;
export const BANNER_MS = 380;
export const SHAKE_MS = 200;
/** Upper bound for any battle track, capture included. */
export const BATTLE_MAX_MS = 900;
const LUNGE = .3, RANGED_LUNGE = .12;

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
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** The type-matchup hint for an effectiveness percentage; none for neutral or unknown. */
export function matchupHint(effectiveness: number | null | undefined): { text: string; tone: 'super' | 'weak' } | null {
  if (effectiveness === null || effectiveness === undefined || effectiveness === 100) return null;
  return effectiveness > 100 ? { text: '效果拔群', tone: 'super' } : { text: effectiveness === 0 ? '没有效果' : '效果不佳', tone: 'weak' };
}

export type BattleSpec = {
  key: string;
  /** `positions[0]` and `positions[1]` of BattleResolved: where the attacker and the target stood. */
  attacker: Hex; target: Hex;
  damage: number; counterDamage: number;
  /** v22 wrapping maps: the lunge and the projectiles take the short way across the seam. */
  map?: MapShape;
  /** false (reduced motion): no lunge, projectile, particles, sinking or shake; flashes, numbers and fades stay. Default true. */
  motion?: boolean;
  /** Colours of the attack's and the counter-attack's types (projectiles, particles). */
  attackColor?: string; counterColor?: string;
  /** Fought from two or more tiles: both strikes fly as projectiles. */
  ranged?: boolean;
  /** Type matchup of the hit, percent (100 neutral). */
  effectiveness?: number | null;
  /** Identities for the lunge and the knockdown afterimages (units removed by the battle are not in the scene). */
  attackerUnit?: UnitMarkIdentity; targetUnit?: UnitMarkIdentity;
  /** Tag shown when the target / the attacker goes down (休养 / 击倒); absent when it stays up. */
  targetDown?: string; attackerDown?: string;
  /** City captured: its territory tiles with their distance from the city, and the owners before and after. */
  capture?: { tiles: readonly { hex: Hex; ring: number }[]; ownerId: number | null; previousOwner?: number | null };
  onFinish?(): void;
  /** Runs when the hit lands and, with a counter, when the counter lands. */
  onImpact?(counter: boolean): void;
};
/** When the hit and the counter-attack land, and how long the whole battle plays. */
export function battleTiming(spec: Pick<BattleSpec, 'counterDamage' | 'ranged' | 'targetDown' | 'attackerDown' | 'capture'>) {
  const impact = spec.ranged ? RANGED_IMPACT_MS : MELEE_IMPACT_MS;
  const counter = spec.counterDamage ? impact + COUNTER_DELAY_MS : null;
  const duration = Math.max(impact + NUMBER_MS, counter === null ? 0 : counter + NUMBER_MS, spec.targetDown ? impact + GHOST_MS : 0,
    spec.attackerDown && counter !== null ? counter + GHOST_MS : 0, spec.capture ? impact + SWEEP_MS : 0);
  return { impact, counter, duration: Math.min(BATTLE_MAX_MS, duration) };
}

/** One battle, built only from the presented event and what the viewer knows (see main.ts / battle-presentation.ts). */
export function battleTrack(spec: BattleSpec): Track {
  const { attacker, target, damage, counterDamage } = spec, motion = spec.motion ?? true, map = spec.map ?? { width: 0 };
  const { impact, counter, duration } = battleTiming(spec);
  const home = hexToWorld(attacker), aim = hexToWorld(nearestCopy(attacker, target, map)), there = hexToWorld(target);
  // The attacker's copy of the target, and the target's copy of the attacker: projectiles never cross the whole map.
  const back = hexToWorld(nearestCopy(target, attacker, map));
  const attackColor = spec.attackColor ?? '#FFF3C4', counterColor = spec.counterColor ?? '#D4DED5';
  const hint = matchupHint(spec.effectiveness);
  const onImpact = spec.onImpact;
  const cues = onImpact ? [{ at: impact, run: () => onImpact(false) }, ...(counter === null ? [] : [{ at: counter, run: () => onImpact(true) }])] : undefined;
  const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  /** Afterimage of a unit that went down at `at`: unchanged before, then sinks (with motion), greys and fades. */
  const ghost = (unit: UnitMarkIdentity, position: Point, elapsed: number, at: number, frame: AnimationFrame) => {
    const t = clamp01((elapsed - at) / GHOST_MS);
    if (t >= 1) return;
    frame.poses.push({ unit, position: { x: position.x, y: position.y + (motion ? easeOut(t) * 9 : 0) }, ...(t > 0 ? { alpha: 1 - t, grey: true } : {}) });
  };
  return { key: spec.key, duration, onFinish: spec.onFinish, ...(cues ? { cues } : {}),
    sample(elapsed, _context, frame) {
      // Attacker: lunge out, hold until the hit, step back; a knocked-down attacker fades after the counter.
      if (spec.attackerUnit) {
        const reach = spec.ranged ? RANGED_LUNGE : LUNGE;
        const out = elapsed < LUNGE_MS ? easeOut(elapsed / LUNGE_MS) : elapsed < impact ? 1 : 1 - clamp01((elapsed - impact) / 120);
        const position = motion ? lerp(home, aim, reach * out) : home;
        if (spec.attackerDown && counter !== null) ghost(spec.attackerUnit, position, elapsed, counter, frame);
        else if (motion && out > 0) frame.poses.push({ unit: spec.attackerUnit, position });
      }
      if (spec.targetDown && spec.targetUnit) ghost(spec.targetUnit, there, elapsed, impact, frame);
      if (motion && spec.ranged && elapsed >= PROJECTILE_FROM_MS && elapsed < impact)
        frame.effects.push({ kind: 'projectile', from: home, to: aim, color: attackColor, progress: (elapsed - PROJECTILE_FROM_MS) / (impact - PROJECTILE_FROM_MS) });
      if (elapsed >= impact) {
        const since = elapsed - impact;
        if (since < IMPACT_MS) frame.effects.push({ kind: 'impact', position: target, color: attackColor, burst: motion, progress: since / IMPACT_MS });
        if (since < NUMBER_MS) {
          frame.effects.push({ kind: 'number', position: target, text: `−${damage}`, tone: 'damage', progress: since / NUMBER_MS });
          if (hint) frame.effects.push({ kind: 'number', position: target, text: hint.text, tone: hint.tone, progress: since / NUMBER_MS, lift: .62 });
        }
        if (spec.targetDown && since >= 80 && since < 80 + NUMBER_MS)
          frame.effects.push({ kind: 'number', position: target, text: spec.targetDown, tone: 'tag', progress: (since - 80) / NUMBER_MS, lift: -.95 });
        if (spec.capture) {
          if (spec.capture.previousOwner !== undefined && since < BANNER_MS) frame.effects.push({ kind: 'banner', position: target, ownerId: spec.capture.previousOwner, progress: since / BANNER_MS });
          if (since < SWEEP_MS) frame.effects.push({ kind: 'sweep', tiles: spec.capture.tiles, ownerId: spec.capture.ownerId, progress: since / SWEEP_MS });
        }
        if (motion) addShake(frame, shakeAt(since, shakeAmplitude(damage)));
      }
      if (counter !== null) {
        if (motion && spec.ranged && elapsed >= impact + 40 && elapsed < counter)
          frame.effects.push({ kind: 'projectile', from: there, to: back, color: counterColor, progress: (elapsed - impact - 40) / (counter - impact - 40) });
        if (elapsed >= counter) {
          const since = elapsed - counter;
          if (since < IMPACT_MS) frame.effects.push({ kind: 'impact', position: attacker, color: counterColor, burst: motion, progress: since / IMPACT_MS });
          if (since < NUMBER_MS) frame.effects.push({ kind: 'number', position: attacker, text: `反击 −${counterDamage}`, tone: 'counter', progress: since / NUMBER_MS });
          if (spec.attackerDown && since >= 80 && since < 80 + NUMBER_MS)
            frame.effects.push({ kind: 'number', position: attacker, text: spec.attackerDown, tone: 'tag', progress: (since - 80) / NUMBER_MS, lift: -.95 });
          if (motion) addShake(frame, shakeAt(since, shakeAmplitude(counterDamage) * .7));
        }
      }
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

// ---------- depth-v26 §4.2: the evolution moment (presentation only) ----------
/** Flash in, silhouettes of the old and new form alternating ever faster, a white new form, then the colour reveal. */
export const EVOLUTION_MS = 2500, EVOLUTION_FLASH_MS = 350, EVOLUTION_REVEAL_AT = 1800, EVOLUTION_STILL_MS = 500;
/** Swap intervals of the alternating silhouettes (each 22% shorter), filling the flash-to-reveal window. */
export const EVOLUTION_SWAPS: readonly number[] = (() => {
  const window = EVOLUTION_REVEAL_AT - 150 - EVOLUTION_FLASH_MS, swaps: number[] = [];
  let interval = 260, total = 0;
  while (total + interval <= window && swaps.length < 14) { swaps.push(interval); total += interval; interval = Math.max(26, Math.round(interval * .78)); }
  return swaps;
})();
/** What the evolving unit looks like `elapsed` ms in: which form, how white (0 colour … 1 silhouette), how large. */
export function evolutionPhase(elapsed: number): { form: 'from' | 'to'; white: number; scale: number; revealed: boolean } {
  if (elapsed < EVOLUTION_FLASH_MS) { const t = elapsed / EVOLUTION_FLASH_MS; return { form: 'from', white: t, scale: 1 + .25 * t, revealed: false }; }
  if (elapsed < EVOLUTION_REVEAL_AT) {
    let local = elapsed - EVOLUTION_FLASH_MS, swap = 0;
    while (swap < EVOLUTION_SWAPS.length && local >= EVOLUTION_SWAPS[swap]!) { local -= EVOLUTION_SWAPS[swap]!; swap++; }
    // After the last swap the new form holds, white, until the reveal.
    const form = swap >= EVOLUTION_SWAPS.length ? 'to' : swap % 2 === 0 ? 'from' : 'to';
    return { form, white: 1, scale: form === 'to' ? 1.3 : 1.22, revealed: false };
  }
  const t = Math.min(1, (elapsed - EVOLUTION_REVEAL_AT) / 300);
  return { form: 'to', white: 1 - t, scale: 1.3 - .3 * Math.min(1, (elapsed - EVOLUTION_REVEAL_AT) / 500), revealed: true };
}
export type EvolutionSpec = { key: string; unit: UnitMarkIdentity; from: SpeciesId; to: SpeciesId; position: Hex; motion: boolean;
  /** Runs when the new form is revealed (the fanfare). */
  onReveal?: () => void; onFinish?: () => void };
/**
 * The unit is posed (the scene unit hidden) and drawn by the renderer from `evolution`; the `evolution` effect adds the
 * backdrop rays, the reveal sparkles and the caption. Without motion: the new form at once with a short glow.
 */
export function evolutionTrack(spec: EvolutionSpec): Track {
  const duration = spec.motion ? EVOLUTION_MS : EVOLUTION_STILL_MS;
  return { key: spec.key, duration, onFinish: spec.onFinish, paced: spec.motion,
    ...(spec.onReveal ? { cues: [{ at: spec.motion ? EVOLUTION_REVEAL_AT : 0, run: spec.onReveal }] } : {}),
    sample(elapsed, context, frame) {
      const position = context.unitPosition(spec.unit.id) ?? spec.position, progress = Math.min(1, elapsed / duration);
      if (spec.motion) {
        const phase = evolutionPhase(elapsed);
        frame.poses.push({ unit: { ...spec.unit, kind: 'pokemon', speciesId: phase.form === 'from' ? spec.from : spec.to } as UnitMarkIdentity, position: hexToWorld(position),
          scale: phase.scale, evolution: { form: phase.form, white: phase.white, elapsed } });
      }
      frame.effects.push({ kind: 'evolution', position, progress, elapsed, motion: spec.motion, from: spec.from, to: spec.to });
    } };
}

export function evolveTrack(key: string, unitId: number, onFinish?: () => void): Track {
  return { key, duration: EVOLVE_MS, onFinish,
    sample(elapsed, context, frame) {
      const position = context.unitPosition(unitId);
      if (position) frame.effects.push({ kind: 'evolve', position, progress: Math.min(1, elapsed / EVOLVE_MS) });
    } };
}

// ---------- Batch 3 (review 3-audio-visual V8–V11) ----------
export const PULSE_MS = 900;
export const FORM_MS = 900;
/** V10: the camera glides to the city, then the pillar rises (the horn sounds with it). */
export const WONDER_PAN_MS = 400;
export const WONDER_PILLAR_MS = 800;
/** V11: day / night and weather cross-fade. */
export const AMBIENT_FADE_MS = 1200;
const easeInOut = (t: number) => t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

/**
 * V8 big-event pulse on a tile (city founded, district completed, promotion, wild spawn...). `position` may be a
 * live lookup (a unit that can still move). Non-blocking: it plays alongside the event queue and never holds input.
 */
export function pulseTrack(key: string, position: Hex | ((context: TrackContext) => Hex | undefined), color: string, label?: string, icon?: PulseIcon): Track {
  return { key, duration: PULSE_MS, blocking: false,
    sample(elapsed, context, frame) {
      const at = typeof position === 'function' ? position(context) : position;
      if (at) frame.effects.push({ kind: 'pulse', position: at, color, progress: Math.min(1, elapsed / PULSE_MS), ...(label ? { label } : {}), ...(icon ? { icon } : {}) });
    } };
}
/** V8 trade route: a dash runs from one city to the other once (the destination's copy nearest the origin), with a pulse at each end. */
export function routeTrack(key: string, from: Hex, to: Hex, map: MapShape = { width: 0 }): Track {
  const a = hexToWorld(from), b = hexToWorld(nearestCopy(from, to, map));
  return { key, duration: PULSE_MS, blocking: false,
    sample(elapsed, _context, frame) {
      const progress = Math.min(1, elapsed / PULSE_MS);
      frame.effects.push({ kind: 'route', from: a, to: b, progress });
      if (progress < .5) frame.effects.push({ kind: 'pulse', position: from, color: '#F2C14E', progress: progress * 2 });
      else frame.effects.push({ kind: 'pulse', position: to, color: '#F2C14E', label: '商路', progress: (progress - .5) * 2 });
    } };
}

/**
 * V9 era form change on a unit (follows its live position). Dynamax also poses the unit at up to 1.5× size
 * (growing in the first 35 %, settling back over the last 30 %). Without `motion` the unit does not grow; colours and fades stay.
 */
export function formTrack(key: string, unit: UnitMarkIdentity, form: FormKind, color: string, options: { motion?: boolean; onFinish?(): void } = {}): Track {
  const motion = options.motion ?? true;
  return { key, duration: FORM_MS, onFinish: options.onFinish,
    sample(elapsed, context, frame) {
      const position = context.unitPosition(unit.id);
      if (!position) return;
      const progress = Math.min(1, elapsed / FORM_MS);
      frame.effects.push({ kind: 'form', position, form, color, progress });
      if (form === 'dynamax' && motion) {
        const grow = progress < .35 ? easeOut(progress / .35) : progress < .7 ? 1 : 1 - easeInOut((progress - .7) / .3);
        if (grow > 0) frame.poses.push({ unit, position: hexToWorld(position), scale: 1 + .5 * grow });
      }
    } };
}

/**
 * V10 wonder reveal: with `camera`, the camera glides from `camera.from` to `camera.to` (WONDER_PAN_MS) and holds while
 * the gold pillar rises on the city; without it (reduced motion, or the city already in view) only the pillar plays.
 * `onPillar` runs when the pillar starts (the horn); `onFinish` pops the story card.
 */
export function wonderRevealTrack(spec: { key: string; city: Hex; motion: boolean; camera?: { from: CameraPose; to: CameraPose }; onPillar?(): void; onFinish?(): void }): Track {
  const pan = spec.camera ? WONDER_PAN_MS : 0, { camera } = spec;
  return { key: spec.key, duration: pan + WONDER_PILLAR_MS, onFinish: spec.onFinish, paced: true,
    ...(spec.onPillar ? { cues: [{ at: pan, run: spec.onPillar }] } : {}),
    sample(elapsed, _context, frame) {
      if (camera) {
        const t = easeInOut(clamp01(elapsed / WONDER_PAN_MS)), lerp = (a: number, b: number) => a + (b - a) * t;
        frame.camera = { x: lerp(camera.from.x, camera.to.x), y: lerp(camera.from.y, camera.to.y), zoom: lerp(camera.from.zoom, camera.to.zoom) };
      }
      if (elapsed >= pan) frame.effects.push({ kind: 'pillar', position: spec.city, burst: spec.motion, progress: Math.min(1, (elapsed - pan) / WONDER_PILLAR_MS) });
    } };
}
type CameraPose = { x: number; y: number; zoom: number };

/** V11: the night overlay cross-fades from `from` to `to` (0 day, 1 night). Non-blocking; one at a time. */
export function nightTrack(from: number, to: number): Track {
  return { key: 'ambient:night', duration: AMBIENT_FADE_MS, blocking: false,
    sample(elapsed, _context, frame) { frame.night = from + (to - from) * easeInOut(Math.min(1, elapsed / AMBIENT_FADE_MS)); } };
}
/** V11: a weather field fades in (no `field`: it is in the scene) or out (`field`: as last seen, no longer in the scene). */
export function weatherFadeTrack(key: string, direction: 'in' | 'out', field?: SceneWeather): Track {
  return { key: `ambient:weather:${key}`, duration: AMBIENT_FADE_MS, blocking: false,
    sample(elapsed, _context, frame) {
      const t = easeInOut(Math.min(1, elapsed / AMBIENT_FADE_MS));
      (frame.weather ??= []).push({ key, alpha: direction === 'in' ? t : 1 - t, ...(field ? { field } : {}) });
    } };
}
