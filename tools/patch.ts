import { createHash } from 'node:crypto';
import { CONTENT } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { AI_THRESHOLDS } from '../src/ai/thresholds.ts';
import type { AiThresholds } from '../src/ai/thresholds.ts';
import type { JsonValue } from '../src/core/snapshot.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';

export type SimulationOptions = { content: Content; ai: AiThresholds };
export type Experiment = SimulationOptions & { patch: Record<string, JsonValue>; sha256: string };
type Schema = 'boolean' | readonly [number, number] | { [key: string]: Schema };
const cost = [1, 10_000] as const, amount = [0, 1000] as const;
const yields = { food: amount, production: amount, gold: amount, research: amount };
const unit = { move: [1, 12], vision: [1, 12], trainCost: cost, upkeep: [0, 100] } satisfies Schema;
const species = { ...unit, maxHp: [4, 1000], attack: [1, 1000], defense: [1, 1000], range: [1, 12], power: [1, 100] } satisfies Schema;
const keyed = <T>(values: Record<string, T>, schema: (value: T) => Schema): Schema =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, schema(value)]));
// Only these listed leaves are writable. Identity, unlocks and rule structure are not patches.
// The keyed tables follow the content being patched (`CONTENT` by default; a gameplay version's table via `parsePatch(value, base)`).
export function patchSchema(base: Content): Schema {
  return {
  species: keyed(base.species, value => ({ ...species, ...(value.evolution ? { evolution: { xp: amount, gold: amount } } : {}) })),
  settler: unit,
  buildings: keyed(base.buildings, value => ({ ...(value.cost === null ? {} : { cost }), yields, trainedXp: amount })),
  techs: keyed(base.techs, () => ({ cost })),
  balls: keyed(base.balls, () => ({ goldCost: cost })),
  biomes: keyed(base.biomes, () => yields),
  moveCosts: keyed(base.moveCosts, () => [1, 12]),
  balance: {
    city: { baseHp: [50, 1000], capturedHp: [1, 1000], buildingHp: [0, 1000], defense: [1, 1000], counterAttack: [0, 1000], squirtleCounterAttack: [0, 1000] },
    effects: { siegeMultiplier: [0, 5000], leagueScoreMultiplier: [0, 5000], meteorologyResearch: amount },
    score: { cities: amount, population: amount, species: amount, techs: amount, knockdowns: amount },
  },
  ai: {
    aggressiveSettlerCities: [1, 100], aggressiveWarStrength: [0, 10_000], aggressiveBorderDistance: [1, 24],
    aggressiveSiegeUnits: [1, 100], aggressiveCaptureRadius: [1, 24], conservativeStrength: [0, 10_000],
    conservativeCaptureTerritoryOnly: 'boolean', aggressiveSeekUnknownHq: 'boolean', conservativeSeekUnknownHq: 'boolean',
    aggressiveSiegeCaptureBonus: [0, 10_000], aggressiveSiegeTrainingBonus: [0, 10_000],
    conservativeMayDeclareWar: 'boolean', conservativeDeclareStrength: [0, 10_000], conservativeBorderDistance: [1, 24],
    expansionMaySiege: 'boolean', expansionSiegeStrength: [0, 10_000], expansionBorderDistance: [1, 24],
    conservativeSettlerInterval: [1, 300], peaceCitiesLost: [1, 100], expansionCaptureHpPercent: [1, 100],
  },
  // v24 knobs (src/content/world24-tuning.ts): only a content that carries them (gameplay v24) accepts them.
  ...(base.world24 ? { world24: {
    landPercent: [30, 80], rivalArrivals: indexed(base.world24.rivalArrivals, [2, 300]), rivalStrengthOffsets: indexed(base.world24.rivalStrengthOffsets, [-30, 30]),
    rivalStepsPerRound: [1, 6], gymTeamPower: indexed(base.world24.gymTeamPower, [10, 5000]), gymLatePowerPercent: [10, 300],
    eliteFourPower: indexed(base.world24.eliteFourPower, [10, 5000]),
    ...(base.world24.rivalStayRounds ? { rivalStayRounds: indexed(base.world24.rivalStayRounds, [1, 30]) } : {}),
  } } : {}),
  };
}
const indexed = (values: readonly unknown[], range: readonly [number, number]): Schema => Object.fromEntries(values.map((_, index) => [String(index), range]));
export const PATCH_SCHEMA: Schema = patchSchema(CONTENT);
function validate(value: unknown, schema: Schema, path: string): void {
  if (schema === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${path}: expected boolean`);
    return;
  }
  if (Array.isArray(schema)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < schema[0] || value > schema[1]) {
      throw new Error(`${path}: expected integer in [${schema[0]}, ${schema[1]}]`);
    }
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`);
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(schema, key)) throw new Error(`${path}.${key}: unknown field`);
    validate(child, (schema as Record<string, Schema>)[key], `${path}.${key}`);
  }
}
function apply(target: object, patch: Record<string, unknown>): void {
  const record = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'number' || typeof value === 'boolean') record[key] = value;
    else apply(record[key] as object, value as Record<string, unknown>);
  }
}
/** Validates and applies a patch to a copy of `base` (default: the legacy `CONTENT`; pass `contentFor(setup)` for a gameplay version). */
export function parsePatch(value: unknown, base: Content = CONTENT): Experiment {
  validate(value, base === CONTENT ? PATCH_SCHEMA : patchSchema(base), 'patch');
  const patch = JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
  const content = structuredClone(base), ai = { ...AI_THRESHOLDS };
  apply({ ...content, settler: content.units.settler, ai }, patch);
  // A building-free city is the minimum maximum HP; buildingHp is nonnegative.
  if (content.balance.city.capturedHp > content.balance.city.baseHp) {
    throw new Error('patch.balance.city.capturedHp: must not exceed balance.city.baseHp');
  }
  // Keep unit movement, training and upkeep queries on the same patched species definitions.
  for (const id of Object.keys(content.species) as (keyof Content['species'])[]) content.units[id] = content.species[id];
  return { content, ai, patch, sha256: createHash('sha256').update(canonicalSerialize(patch)).digest('hex') };
}
