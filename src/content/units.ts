import type { LeaderId } from './leaders.ts';
import { BALANCE } from './balance.ts';
import type { Balance } from './balance.ts';
import { SPECIES, validateSpecies } from './species.ts';
import type { BaseSpeciesId, EvolutionOption, SpeciesDefinition, SpeciesId } from './species.ts';
import {
  EXISTING_EVOLUTION_ADDITIONS, EXISTING_SPAWN_BIOME_ADDITIONS,
  ROSTER_V14_SPECIES, STONE_EVOLUTIONS_V14_ADDITIONS,
} from './roster-v14-data.ts';
import type { RosterEvolution, RosterTerrain } from './roster-v14-data.ts';
export { speciesDisplay } from './species.ts';
export type { SpeciesId } from './species.ts';
import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from './economy.ts';
import type { TechDefinition, TechId, TechTable } from './economy.ts';
import type { BiomeId } from './rules.ts';
import { WORLD24_TUNING } from './world24-tuning.ts';
import type { World24Tuning } from './world24-tuning.ts';
import type { EraProgression } from './eras.ts';
import type { LandmarkId } from './terrain.ts';
import type { ResolvedRecruit } from './recruit-slots.ts';
import { deriveRosterTables, drawRegionalDex, dexMaxGeneration, evolutionLines } from './regional-dex.ts';
import type { RegionalDexDraw } from './regional-dex.ts';
import { SPECIES_TAGS } from './species-tags.ts';
import { DEPTH26_TUNING } from './depth-v26.ts';
import { ROSTER_V26_EVOLUTIONS, ROSTER_V26_SPECIES, ROSTER_V26_TAGS } from './roster-v26-data.ts';
import type { Depth26Tuning } from './depth-v26.ts';
import { PACE27_TUNING } from './pace-v27.ts';
import type { Pace27Tuning } from './pace-v27.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: SpeciesId; uniqueLeader?: LeaderId }
  | { kind: 'logistics'; role: 'settler' | 'trader' | 'builder'; escortId?: SpeciesId; homeCityId?: number };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };

export type RosterStoneEvolution = {
  fromSpeciesId: SpeciesId;
  intoSpeciesId: SpeciesId;
  stoneId: 'fireStone' | 'waterStone' | 'leafStone' | 'thunderStone' | 'moonStone';
  requiredXp: number;
};

export type RosterTables = {
  spawnWeights: Record<BiomeId, Partial<Record<SpeciesId, number>>>;
  wanderers: readonly SpeciesId[];
  techRecruits: Partial<Record<TechId, SpeciesId>>;
  generationRecruits: Partial<Record<number, SpeciesId>>;
  leaderUnits: Partial<Record<LeaderId, SpeciesId>>;
  stoneEvolutions: readonly RosterStoneEvolution[];
  nestPriority: readonly SpeciesId[];
  pokedexTargetBonus: number;
  nestWeights?: Partial<Record<SpeciesId, number>>;
  habitatOverlays?: Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>>;
  deepWater?: { multiply: Partial<Record<SpeciesId, number>>; remove: readonly SpeciesId[] };
  residents?: Partial<Record<LandmarkId, readonly SpeciesId[]>>;
  recruitSlots?: readonly ResolvedRecruit[];
};

export type Content = {
  version: string;
  biomes: typeof BIOME_YIELDS;
  buildings: typeof BUILDINGS;
  techs: TechTable;
  balls: { [K in keyof typeof BALLS]: Omit<typeof BALLS[K], 'goldCost'> & { goldCost: number } };
  balance: Balance;
  units: Record<string, UnitDefinition>;
  species: Record<string, SpeciesDefinition>;
  moveCosts: Record<BiomeId, number>;
  roster: RosterTables;
  /** Present on seeded games: this game's regional Pokédex (`size` species of a `pool`-species mode pool). Absent on whole-pool base. */
  regionalDex?: { speciesIds: readonly SpeciesId[]; size: number; pool: number };
  world24: World24Tuning;
  depth26: Depth26Tuning;
  pace27: Pace27Tuning;
};

const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
const TERRAIN: Record<Exclude<RosterTerrain, BiomeId[]>, BiomeId[]> = { land, all: [...land, 'ocean', 'volcano'], ocean: ['ocean'] };

function toOption(evolution: RosterEvolution): EvolutionOption | null {
  const condition = evolution.condition;
  if (condition && typeof condition === 'object' && 'stone' in condition) return null;
  return {
    speciesId: evolution.speciesId as SpeciesId, xp: evolution.xp, gold: evolution.gold, requiresTraining: evolution.requiresTraining,
    ...(evolution.minGeneration ? { minGeneration: evolution.minGeneration } : {}),
    ...(condition === 'day' || condition === 'night' ? { time: condition } : condition && 'biome' in condition ? { biome: condition.biome } : {}),
  };
}

function withEvolutions(species: SpeciesDefinition, evolutions: readonly RosterEvolution[], stoneTargets: readonly string[]): SpeciesDefinition {
  const options = evolutions.map(evolution => toOption(evolution) ?? (stoneTargets.includes(evolution.speciesId)
    ? { speciesId: evolution.speciesId as SpeciesId, xp: evolution.xp, gold: evolution.gold, requiresTraining: evolution.requiresTraining } : null))
    .filter((option): option is EvolutionOption => option !== null);
  if (!options.length) return species;
  const [first, ...rest] = species.evolution ? [{ ...species.evolution }, ...options] : options;
  const { speciesId, xp, gold, requiresTraining, ...condition } = first;
  return {
    ...species,
    evolution: { speciesId, xp, gold, requiresTraining },
    ...(Object.keys(condition).length ? { evolutionCondition: condition } : {}),
    ...(rest.length ? { branches: rest } : {}),
  };
}

const clonePlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Build the unified 115-species strength-combat table once.
const preBatchSpecies = (() => {
  const base = clonePlain(SPECIES) as Record<string, SpeciesDefinition>;
  for (const [id, stats] of Object.entries({
    geodude: { maxHp: 60, attack: 20, defense: 90 },
    graveler: { maxHp: 80, attack: 30, defense: 120 },
    onix: { maxHp: 80, attack: 40, defense: 120 },
    charizard: { maxHp: 100, attack: 83, defense: 98 },
    gyarados: { maxHp: 90, attack: 60, defense: 90 },
    bulbasaur: { maxHp: 55, attack: 45, defense: 57 },
    gastly: { maxHp: 53, attack: 43, defense: 60 },
  })) Object.assign(base[id as BaseSpeciesId], stats);
  validateSpecies(base);

  const stoneTargets = STONE_EVOLUTIONS_V14_ADDITIONS.map(path => path.intoSpeciesId);
  for (const [id, additions] of Object.entries(EXISTING_EVOLUTION_ADDITIONS)) base[id] = withEvolutions(base[id], additions, stoneTargets);
  for (const [id, biomes] of Object.entries(EXISTING_SPAWN_BIOME_ADDITIONS)) base[id].spawnBiomes = [...new Set([...base[id].spawnBiomes, ...biomes])];
  for (const [id, data] of Object.entries(ROSTER_V14_SPECIES)) {
    const { evolutions, terrain, ...rest } = data;
    base[id] = withEvolutions({ ...rest, terrain: Array.isArray(terrain) ? [...terrain] : [...TERRAIN[terrain]], spawnBiomes: [...data.spawnBiomes], evolution: null }, evolutions, stoneTargets);
  }
  validateSpecies(base);

  return Object.fromEntries(Object.entries(base).map(([id, species]) => {
    const biomes = Object.keys(SPECIES_TAGS[id]?.habitat ?? {}).filter((key): key is BiomeId => key in BIOME_YIELDS);
    const spawnBiomes = biomes.every(biome => species.spawnBiomes.includes(biome)) ? species.spawnBiomes : [...new Set([...species.spawnBiomes, ...biomes])];
    return [id, {
      ...species,
      attack: Math.max(1, Math.round(species.attack * 0.4) + 15),
      defense: Math.max(1, Math.round(species.defense * 0.4) + 15),
      maxHp: 100,
      spawnBiomes,
    }];
  })) as Record<SpeciesId, SpeciesDefinition>;
})();

const allSpecies = (() => {
  const species = { ...preBatchSpecies } as Record<SpeciesId, SpeciesDefinition>;
  for (const [id, { evolution }] of Object.entries(ROSTER_V26_EVOLUTIONS) as [SpeciesId, Pick<SpeciesDefinition, 'evolution'>][]) {
    species[id] = { ...species[id], evolution: evolution && { ...evolution } };
  }
  for (const [id, definition] of Object.entries(ROSTER_V26_SPECIES) as [keyof typeof ROSTER_V26_SPECIES, SpeciesDefinition][]) {
    const biomes = Object.keys(ROSTER_V26_TAGS[id].habitat ?? {}).filter((key): key is BiomeId => key in BIOME_YIELDS);
    species[id] = {
      ...definition,
      immunities: [...definition.immunities],
      terrain: [...definition.terrain],
      spawnBiomes: [...new Set([...definition.spawnBiomes, ...biomes])],
      evolution: definition.evolution && { ...definition.evolution },
    };
  }
  return species;
})();

const LOGISTICS_UNITS: Record<'settler' | 'trader' | 'builder', UnitDefinition> = {
  settler: { name: '开拓队', move: 2, vision: 2, terrain: land, trainCost: 24, upkeep: 0 },
  trader: { name: '商队', move: 4, vision: 2, terrain: land, trainCost: 35, upkeep: 1 },
  builder: { name: '工匠', move: 3, vision: 2, terrain: land, trainCost: 20, upkeep: 1 },
};

/** Whole-pool baseline content (v27 / pace-v27): 115 species, 30-tech branching tree, strength combat, full tuning. */
export const GAME_CONTENT: Content = {
  version: 'pace-v27',
  balance: BALANCE,
  species: allSpecies,
  biomes: BIOME_YIELDS,
  buildings: BUILDINGS,
  techs: TECHS,
  balls: BALLS,
  units: { ...allSpecies, ...LOGISTICS_UNITS },
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
  roster: deriveRosterTables(allSpecies, Object.keys(allSpecies).sort() as SpeciesId[], 'full-v1'),
  world24: clonePlain(WORLD24_TUNING),
  depth26: clonePlain(DEPTH26_TUNING),
  pace27: clonePlain(PACE27_TUNING),
};

type ContentSetup = {
  seed?: number;
  dexSeed?: number;
  eraProgression?: EraProgression;
  expansionVersion?: number;
  gameplayVersion?: number;
  players?: readonly { leaderId?: LeaderId }[];
};

const regionalContents = new Map<string, Content>();
const regionalDraws = new Map<string, RegionalDexDraw>();
const bySetup = new WeakMap<object, Content>();
const derivedContents = new WeakSet<Content>();

/** Reference pool size (P in the Pokédex target scaling) over the core 105-species base pool. */
export const regionalPoolSize = (mode: EraProgression): number =>
  evolutionLines(preBatchSpecies, dexMaxGeneration(mode)).reduce((sum, line) => sum + line.speciesIds.length, 0);

/** Regional Pokédex draw of a game setup (memoized, pure). */
export function regionalDexDraw(setup: { seed: number; dexSeed?: number; eraProgression?: EraProgression; players: readonly { leaderId?: LeaderId }[] }): RegionalDexDraw {
  const mode = setup.eraProgression ?? 'simple-v1';
  const leaders = [...new Set(setup.players.flatMap(player => player.leaderId ? [player.leaderId] : []))].sort();
  const dexSeed = setup.dexSeed ?? setup.seed;
  const key = `${dexSeed}|${mode}|${leaders.join(',')}`;
  let draw = regionalDraws.get(key);
  if (!draw) {
    if (regionalDraws.size > 512) regionalDraws.clear();
    regionalDraws.set(key, draw = drawRegionalDex({ species: allSpecies, mode, dexSeed, leaders }));
  }
  return draw;
}

/** Content for a specific regional Pokédex (memoized so authority and views share one object). */
export function regionalContentFromIds(speciesIds: readonly SpeciesId[], mode: EraProgression): Content {
  const sorted = [...new Set(speciesIds)].filter(id => allSpecies[id]).sort();
  const key = `${mode}|${sorted.join(',')}`;
  let content = regionalContents.get(key);
  if (!content) {
    if (regionalContents.size > 512) regionalContents.clear();
    content = {
      ...GAME_CONTENT,
      roster: deriveRosterTables(allSpecies, sorted, mode),
      regionalDex: { speciesIds: Object.freeze(sorted), size: sorted.length, pool: regionalPoolSize(mode) },
      world24: clonePlain(WORLD24_TUNING),
      depth26: clonePlain(DEPTH26_TUNING),
      pace27: clonePlain(PACE27_TUNING),
    };
    derivedContents.add(content);
    regionalContents.set(key, content);
  }
  return content;
}

export function contentFor(setup: ContentSetup = {}): Content {
  if (setup.seed === undefined || !setup.players) return GAME_CONTENT;
  const cached = bySetup.get(setup);
  if (cached) return cached;
  const mode = setup.eraProgression ?? 'simple-v1';
  const content = regionalContentFromIds(regionalDexDraw({ ...setup, seed: setup.seed, eraProgression: mode, players: setup.players }).speciesIds, mode);
  bySetup.set(setup, content);
  return content;
}

export function contentForView(view: { eraProgression?: EraProgression; regionalDex?: readonly SpeciesId[] }): Content {
  if (view.regionalDex) return regionalContentFromIds(view.regionalDex, view.eraProgression ?? 'simple-v1');
  return GAME_CONTENT;
}

export const STOCK_CONTENTS: readonly Content[] = [GAME_CONTENT];
export const isStockContent = (content: Content): boolean => content === GAME_CONTENT || derivedContents.has(content);

export function techOf(content: Content, id: TechId): TechDefinition {
  const tech = content.techs[id];
  if (!tech) throw new Error(`Unknown technology ${id} in ${content.version}`);
  return tech;
}

export function unitDefinition(unit: UnitIdentity, content: Content = GAME_CONTENT): UnitDefinition {
  const base = content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
  return unit.kind === 'pokemon' && unit.uniqueLeader ? { ...base, name: `${base.name}·${unit.uniqueLeader}`, vision: base.vision + 1 } : base;
}
