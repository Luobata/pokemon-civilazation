export type Ratio = { numerator: number; n: number; independentSeeds: number; pointEstimate: number | null; wilson95: [number, number] | null };
export function wilson95(successes: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.959963984540054, p = successes / n, factor = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / factor;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / factor;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function ratio(samples: { seed: number; successes: number; trials: number }[]): Ratio {
  const numerator = samples.reduce((sum, sample) => sum + sample.successes, 0), n = samples.reduce((sum, sample) => sum + sample.trials, 0);
  return { numerator, n, independentSeeds: new Set(samples.filter(sample => sample.trials > 0).map(sample => sample.seed)).size,
    pointEstimate: n ? numerator / n : null, wilson95: wilson95(numerator, n) };
}
export function mean(samples: { seed: number; value: number }[]) {
  return { n: samples.length, independentSeeds: new Set(samples.map(sample => sample.seed)).size,
    value: samples.length ? samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length : null };
}
export function winCredit(winners: number[], playerId: number): number {
  return winners.includes(playerId) ? winners.length === 1 ? 1 : 0.5 : 0;
}
export function threshold(value: number | null, lower: number | null, upper: number | null, isRatio: boolean, strictLower = false) {
  if (value === null) return { passes: null, needsAdditionalSeeds: null, reason: 'not-computable' };
  const passes = (lower === null || (strictLower ? value > lower : value >= lower)) && (upper === null || value <= upper);
  const distance = Math.min(...[lower, upper].filter((limit): limit is number => limit !== null).map(limit => Math.abs(value - limit)));
  // Round binary floating point noise at the exact five-percentage-point boundary.
  const near = isRatio && distance < 0.05 - 1e-12;
  return { passes, needsAdditionalSeeds: !passes || near, reason: !passes ? 'outside-target' : near ? 'within-five-percentage-points' : 'inside-target' };
}
