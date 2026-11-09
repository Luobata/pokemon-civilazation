// Frame-budget helper for tests/browser/performance.spec.ts: the animation frames of several simultaneous
// battles, built with the same tracks the game plays. Not used by the game itself.
import type { MapShape } from '../../core/hex.ts';
import type { MapUnit } from '../../core/model.ts';
import { Timeline, battleTrack } from './animation.ts';
import type { AnimationFrame } from './animation.ts';

export const BENCHMARK_CYCLE_MS = 900;

/** `count` battles between pairs of the given units, started 120 ms apart and restarted every 900 ms; 60 frames per second. */
export function combatBenchmarkFrames(units: readonly MapUnit[], map: MapShape, count: number, frames: number): AnimationFrame[] {
  const pairs = Array.from({ length: Math.min(count, Math.floor(units.length / 2)) }, (_, index) => [units[index * 2], units[index * 2 + 1]] as const);
  const timeline = new Timeline(), output: AnimationFrame[] = [], cycles = pairs.map(() => -1);
  const context = { unitPosition: (id: number) => units.find(unit => unit.id === id)?.position };
  for (let frame = 0; frame < frames; frame++) {
    const now = frame * 1000 / 60;
    for (const [index, [attacker, target]] of pairs.entries()) {
      const cycle = Math.floor((now - index * 120) / BENCHMARK_CYCLE_MS);
      if (cycle < 0 || cycle === cycles[index]) continue;
      cycles[index] = cycle;
      timeline.add(battleTrack({ key: `bench:${index}`, attacker: attacker.position, target: target.position, damage: 34, counterDamage: 12 }), now);
    }
    output.push(timeline.sample(now, context));
  }
  void map;
  return output;
}
