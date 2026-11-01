import { EXPANSION_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { SpeciesDefinition, SpeciesId, TypeId } from '../content/species.ts';
import { damage, dualEffectiveness } from '../core/combat-math.ts';

const BASELINE = EXPANSION_CONTENT;

const TYPES = [...new Set(Object.values(BASELINE.species).flatMap(definition => [definition.typeId, ...definition.secondaryTypeId === undefined ? [] : [definition.secondaryTypeId]]))] as TypeId[];
const BIOMES = Object.keys(BASELINE.moveCosts);
const SPECIES_IDS = Object.keys(BASELINE.species) as SpeciesId[];
const TECH_IDS = Object.keys(BASELINE.techs);
const STAGE_BUDGETS: readonly (readonly [number, number])[] = [[150, 170], [210, 240], [280, 320]];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, requirement: string): never {
  throw new Error(`Invalid content at ${path}: ${requirement}`);
}

function keysExactly(value: Record<string, unknown>, required: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(), expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(path, `expected keys ${expected.join(', ')}`);
}

function string(value: unknown, path: string, nonempty = true): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) fail(path, 'expected a nonempty string');
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(path, `expected an integer from ${minimum} to ${maximum}`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function enumerated<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const result = typeof value === 'string' && allowed.includes(value as T) ? value as T : undefined;
  if (result === undefined) fail(path, `expected one of ${allowed.join(', ')}`);
  return result;
}

function stringArray(value: unknown, allowed: readonly string[] | null, path: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || (allowed !== null && !allowed.includes(item)))
    || new Set(value).size !== value.length) fail(path, 'expected unique known string values');
  return value as string[];
}

function keysWithin(value: Record<string, unknown>, required: readonly string[], allowed: readonly string[], path: string): void {
  const requiredSet = new Set(required), allowedSet = new Set(allowed);
  if ([...requiredSet].some(key => !(key in value)) || Object.keys(value).some(key => !allowedSet.has(key))) {
    fail(path, `expected keys ${[...requiredSet].sort().join(', ')} with no unknown fields`);
  }
}

function sameKeys(value: unknown, reference: Record<string, unknown>, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  const actual = Object.keys(value).sort(), expected = Object.keys(reference).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(path, 'expected the fixed definition IDs');
}

function validateYield(value: unknown, path: string): void {
  if (!isRecord(value) || Object.keys(value).length !== 4) fail(path, 'expected food, production, gold, and research');
  for (const key of ['food', 'production', 'gold', 'research']) integer(value[key], `${path}.${key}`, 0, 1000);
}

function validateSpeciesDefinition(raw: unknown, id: string, all: Record<string, SpeciesDefinition>): SpeciesDefinition {
  const path = `species.${id}`;
  if (!isRecord(raw)) fail(path, 'expected an object');
    const baseKeys = ['name', 'typeId', 'stage', 'role', 'maxHp', 'attack', 'defense', 'move', 'range', 'power', 'vision', 'rare', 'immunities', 'trainCost', 'upkeep', 'terrain', 'spawnBiomes', 'evolution'];
  keysExactly(raw, raw.secondaryTypeId === undefined ? baseKeys : [...baseKeys, 'secondaryTypeId'], path);
  const typeId = enumerated(raw.typeId, TYPES, `${path}.typeId`);
  const stage = integer(raw.stage, `${path}.stage`, 1, 3) as 1 | 2 | 3;
  const role = enumerated(raw.role, ['ranged', 'melee', 'scout', 'fast', 'siege', 'naval', 'air'], `${path}.role`);
  const secondaryTypeId = raw.secondaryTypeId === undefined ? undefined : enumerated(raw.secondaryTypeId, TYPES, `${path}.secondaryTypeId`);
  const maxHp = integer(raw.maxHp, `${path}.maxHp`, 1, 500);
  const attack = integer(raw.attack, `${path}.attack`, 1, 500);
  const defense = integer(raw.defense, `${path}.defense`, 1, 500);
  const move = integer(raw.move, `${path}.move`, 1, 10);
  const range = integer(raw.range, `${path}.range`, 1, 5);
  const power = integer(raw.power, `${path}.power`, 10, 10);
  const vision = integer(raw.vision, `${path}.vision`, 1, 8);
  const trainCost = integer(raw.trainCost, `${path}.trainCost`, 1, 200);
  const upkeep = integer(raw.upkeep, `${path}.upkeep`, 0, 100);
  const immunities = stringArray(raw.immunities, TYPES, `${path}.immunities`);
  const terrain = stringArray(raw.terrain, BIOMES, `${path}.terrain`);
  const spawnBiomes = stringArray(raw.spawnBiomes, BIOMES, `${path}.spawnBiomes`);
  if (!terrain.length) fail(`${path}.terrain`, 'a species must enter at least one biome');
  const evolutionRaw = raw.evolution;
  let evolution: SpeciesDefinition['evolution'];
  if (evolutionRaw === null) evolution = null;
  else if (isRecord(evolutionRaw)) {
    keysExactly(evolutionRaw, ['speciesId', 'xp', 'gold', 'requiresTraining'], `${path}.evolution`);
    evolution = {
      speciesId: enumerated(evolutionRaw.speciesId, SPECIES_IDS, `${path}.evolution.speciesId`),
      xp: integer(evolutionRaw.xp, `${path}.evolution.xp`, 1, 1000),
      gold: integer(evolutionRaw.gold, `${path}.evolution.gold`, 1, 1000),
      requiresTraining: boolean(evolutionRaw.requiresTraining, `${path}.evolution.requiresTraining`),
    };
  } else fail(`${path}.evolution`, 'expected null or an evolution object');
  const sum = maxHp + attack + defense;
  const [minimum, maximum] = STAGE_BUDGETS[stage - 1];
  if (sum < minimum || sum > maximum) fail(path, `${id} stage ${stage} stat budget ${sum} is outside ${minimum}–${maximum}`);
  if (trainCost !== Math.floor(sum / 8)) fail(`${path}.trainCost`, `must equal Math.floor((${minimum}–${maximum}) budget / 8)`);
  if (evolution && (!all[evolution.speciesId] || all[evolution.speciesId].stage !== stage + 1)) fail(`${path}.evolution.speciesId`, 'must reference the next development stage');
  return { name: string(raw.name, path), typeId, ...(secondaryTypeId === undefined ? {} : { secondaryTypeId }), stage, role, maxHp, attack, defense, move, range, power, vision,
    rare: boolean(raw.rare, `${path}.rare`), immunities, trainCost, upkeep, terrain, spawnBiomes, evolution } as SpeciesDefinition;
}

export function validateD15(species: Record<SpeciesId, SpeciesDefinition>): void {
  for (const attacker of Object.values(species)) for (const defender of Object.values(species)) {
    if (attacker.stage !== defender.stage) continue;
    const effectivenessValue = dualEffectiveness(attacker.typeId, [defender.typeId, ...(defender.secondaryTypeId ? [defender.secondaryTypeId] : [])], true);
    if (effectivenessValue < 220) continue;
    const hit = damage(attacker.attack, defender.defense, attacker.power, effectivenessValue, 120, 100);
    if (hit * 100 > defender.maxHp * 60) {
      throw new Error(`D15 violation: ${attacker.name} can deal ${hit} to ${defender.name} (${defender.maxHp} HP)`);
    }
  }
}

export function cloneContent(): Content {
  return structuredClone(EXPANSION_CONTENT);
}

export function validateEditorContent(value: unknown): Content {
  if (!isRecord(value)) fail('content', 'expected an object');
  const editableKeys = ['version', 'biomes', 'buildings', 'techs', 'balls', 'balance', 'units', 'species', 'moveCosts'];
  keysExactly(value, editableKeys, 'content');
  string(value.version, 'content.version');

  sameKeys(value.biomes, BASELINE.biomes as Record<string, unknown>, 'content.biomes');
  for (const [id, definition] of Object.entries(value.biomes)) validateYield(definition, `content.biomes.${id}`);

  sameKeys(value.buildings, BASELINE.buildings as Record<string, unknown>, 'content.buildings');
  for (const [id, definition] of Object.entries(value.buildings)) {
    const path = `content.buildings.${id}`;
    if (!isRecord(definition)) fail(path, 'expected an object');
    const required = definition.requiredTech === undefined ? ['name', 'cost', 'yields', 'trainedXp'] : ['name', 'cost', 'yields', 'trainedXp', 'requiredTech'];
    keysExactly(definition, required, path);
    string(definition.name, path);
    if (definition.cost !== null) integer(definition.cost, `${path}.cost`, 1, 1000);
    validateYield(definition.yields, `${path}.yields`);
    integer(definition.trainedXp, `${path}.trainedXp`, 0, 1000);
    if (definition.requiredTech !== undefined) enumerated(definition.requiredTech, TECH_IDS, `${path}.requiredTech`);
  }

  sameKeys(value.techs, BASELINE.techs as Record<string, unknown>, 'content.techs');
  for (const [id, definition] of Object.entries(value.techs)) {
    const path = `content.techs.${id}`;
    if (!isRecord(definition)) fail(path, 'expected an object');
    keysExactly(definition, ['name', 'tier', 'cost'], path);
    string(definition.name, path);
    integer(definition.tier, `${path}.tier`, 1, 3);
    integer(definition.cost, `${path}.cost`, 1, 1000);
  }

  sameKeys(value.balls, BASELINE.balls as Record<string, unknown>, 'content.balls');
  for (const [id, definition] of Object.entries(value.balls)) {
    const path = `content.balls.${id}`;
    if (!isRecord(definition)) fail(path, 'expected an object');
    keysExactly(definition, ['name', 'goldCost', 'requiredTech'], path);
    string(definition.name, path);
    integer(definition.goldCost, `${path}.goldCost`, 1, 1000);
    enumerated(definition.requiredTech, TECH_IDS, `${path}.requiredTech`);
  }

  const species = {} as Record<string, SpeciesDefinition>;
  sameKeys(value.species, BASELINE.species as Record<string, unknown>, 'content.species');
  for (const id of Object.keys(value.species)) species[id] = validateSpeciesDefinition(value.species[id], id, value.species as Record<string, SpeciesDefinition>);
  validateD15(species as Record<SpeciesId, SpeciesDefinition>);

  sameKeys(value.units, BASELINE.units as Record<string, unknown>, 'content.units');
  for (const [id, definition] of Object.entries(value.units)) {
    const path = `content.units.${id}`;
    if (!isRecord(definition)) fail(path, 'expected an object');
    const unitKeys = ['name', 'move', 'vision', 'terrain', 'trainCost', 'upkeep'];
    if (id === 'settler') keysExactly(definition, unitKeys, path);
    else keysWithin(definition, unitKeys, [...unitKeys, ...Object.keys(species[id]), 'secondaryTypeId'], path);
    string(definition.name, path);
    integer(definition.move, `${path}.move`, 1, 10);
    integer(definition.vision, `${path}.vision`, 1, 8);
    stringArray(definition.terrain, BIOMES, `${path}.terrain`);
    integer(definition.trainCost, `${path}.trainCost`, 1, 200);
    integer(definition.upkeep, `${path}.upkeep`, 0, 100);
    const source = id === 'settler' ? null : species[id];
    if (source && JSON.stringify(definition) !== JSON.stringify(source)) fail(path, 'the unit definition must exactly match its species definition');
  }

  const balance = value.balance;
  if (!isRecord(balance)) fail('content.balance', 'expected an object');
  function validateNumericTree(node: unknown, reference: unknown, path: string): void {
    if (typeof reference === 'number') integer(node, path, 0, 100000);
    else if (isRecord(reference)) {
      if (!isRecord(node)) fail(path, 'expected an object');
      sameKeys(node, reference, path);
      for (const [key, child] of Object.entries(node)) validateNumericTree(child, (reference as Record<string, unknown>)[key], `${path}.${key}`);
    } else fail(path, 'expected the balance shape');
  }
  validateNumericTree(balance, BASELINE.balance, 'content.balance');

  sameKeys(value.moveCosts, BASELINE.moveCosts as Record<string, unknown>, 'content.moveCosts');
  for (const [id, cost] of Object.entries(value.moveCosts)) integer(cost, `content.moveCosts.${id}`, 1, 10);

  return value as Content;
}

export function importEditorContent(text: string): Content {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) { throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  return validateEditorContent(parsed);
}

export function exportContent(content: Content): string {
  return JSON.stringify(validateEditorContent(content), null, 2);
}
