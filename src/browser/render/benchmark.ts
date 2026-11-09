// Frame-budget helper for tests/browser/performance.spec.ts: the animation frames of several simultaneous
// battles, built with the same tracks the game plays. Not used by the game itself.
import { TYPE_COLORS } from '../../content/type-colors.ts';
import type { Hex, MapShape } from '../../core/hex.ts';
import type { MapUnit } from '../../core/model.ts';
import { AMBIENT_FADE_MS, BATTLE_MAX_MS, FORM_MS, PULSE_MS, Timeline, battleTrack, formTrack, nightTrack, pulseTrack, wonderRevealTrack } from './animation.ts';
import type { AnimationFrame, BattleSpec } from './animation.ts';

/** Every hex within three steps of `center`, with its distance (a captured city's territory sweep). */
function rings(center: Hex): { hex: Hex; ring: number }[] {
  const tiles: { hex: Hex; ring: number }[] = [];
  for (let dq = -3; dq <= 3; dq++) for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++)
    tiles.push({ hex: { q: center.q + dq, r: center.r + dr }, ring: Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) });
  return tiles;
}

/**
 * `count` battles between pairs of the given units, started 120 ms apart and restarted every 900 ms; 60 frames per second.
 * They cycle through the heaviest looks: a ranged exchange (projectiles both ways, super effective), a melee knockdown
 * (afterimage and tag) and a city capture (banner and a 37-tile territory sweep), all with particles and shake.
 */
export function combatBenchmarkFrames(units: readonly MapUnit[], map: MapShape, count: number, frames: number): AnimationFrame[] {
  const pairs = Array.from({ length: Math.min(count, Math.floor(units.length / 2)) }, (_, index) => [units[index * 2], units[index * 2 + 1]] as const);
  const timeline = new Timeline(), output: AnimationFrame[] = [], cycles = pairs.map(() => -1);
  const context = { unitPosition: (id: number) => units.find(unit => unit.id === id)?.position };
  const spec = (index: number, attacker: MapUnit, target: MapUnit): BattleSpec => {
    const base = { key: `bench:${index}`, attacker: attacker.position, target: target.position, damage: 34, counterDamage: 12, map,
      attackColor: TYPE_COLORS.fire, counterColor: TYPE_COLORS.water, attackerUnit: attacker, targetUnit: target };
    if (index % 3 === 0) return { ...base, ranged: true, effectiveness: 200 };
    if (index % 3 === 1) return { ...base, counterDamage: 0, targetDown: '休养', effectiveness: 50 };
    return { ...base, counterDamage: 0, capture: { tiles: rings(target.position), ownerId: attacker.ownerId, previousOwner: target.ownerId } };
  };
  for (let frame = 0; frame < frames; frame++) {
    const now = frame * 1000 / 60;
    for (const [index, [attacker, target]] of pairs.entries()) {
      const cycle = Math.floor((now - index * 120) / BATTLE_MAX_MS);
      if (cycle < 0 || cycle === cycles[index]) continue;
      cycles[index] = cycle;
      timeline.add(battleTrack(spec(index, attacker, target)), now);
    }
    output.push(timeline.sample(now, context));
  }
  return output;
}

/**
 * Batch 3 (V8–V11): `frames` frames of big-event feedback over the given units: four pulses (one per unit, restarted
 * every PULSE_MS), two era forms (Dynamax with its enlarged unit, Mega), a wonder pillar with particles and a night cross-fade.
 */
export function eventBenchmarkFrames(units: readonly MapUnit[], frames: number): AnimationFrame[] {
  const timeline = new Timeline(), output: AnimationFrame[] = [];
  const context = { unitPosition: (id: number) => units.find(unit => unit.id === id)?.position };
  const pulsed = units.slice(0, 4), formed = units.filter(unit => unit.kind === 'pokemon').slice(0, 2), city = units[4]?.position ?? units[0].position;
  const started = new Map<string, number>();
  const every = (key: string, period: number, now: number, make: () => Parameters<Timeline['add']>[0]) => {
    if (started.has(key) && now - started.get(key)! < period) return;
    started.set(key, now); timeline.add(make(), now);
  };
  const colors = ['#3BA68A', '#F2C14E', '#E07A6D', '#E5554A'];
  for (let frame = 0; frame < frames; frame++) {
    const now = frame * 1000 / 60;
    for (const [index, unit] of pulsed.entries()) every(`pulse:${index}`, PULSE_MS, now, () => pulseTrack(`pulse:${index}`, unit.position, colors[index], index % 2 ? '晋升' : '建城', index % 2 ? 'chevron' : 'star'));
    for (const [index, unit] of formed.entries()) every(`form:${index}`, FORM_MS, now, () => formTrack(`form:${index}`, unit, index ? 'mega' : 'dynamax', index ? '#FFFDF7' : '#E5554A'));
    every('pillar', 800, now, () => wonderRevealTrack({ key: 'pillar', city, motion: true }));
    every('night', AMBIENT_FADE_MS, now, () => nightTrack(0, 1));
    output.push(timeline.sample(now, context));
  }
  return output;
}
