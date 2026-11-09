import type { LeaderId } from './leaders.ts';
import { BALANCE } from './balance.ts';
import type { Balance } from './balance.ts';
import { SPECIES, validateSpecies } from './species.ts';
import { LEGACY_SPECIES } from './legacy-species.ts';
import type { BaseSpeciesId, EvolutionOption, SpeciesDefinition, SpeciesId } from './species.ts';
import { EXISTING_EVOLUTION_ADDITIONS, EXISTING_SPAWN_BIOME_ADDITIONS, GENERATION_RECRUITS_V14, LEADER_UNITS_V14, NEST_PRIORITY_V14, NEST_WEIGHTS_V14,
  ROSTER_V14_SPECIES, SPAWN_WEIGHTS_V14, STONE_EVOLUTIONS_V14_ADDITIONS, TECH_RECRUITS_V14, WANDERERS_V14 } from './roster-v14-data.ts';
import type { RosterEvolution, RosterTerrain } from './roster-v14-data.ts';
export { speciesDisplay } from './species.ts';
export type { SpeciesId } from './species.ts';
import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from './economy.ts';
import type { BuildingId, TechDefinition, TechId, TechTable } from './economy.ts';
import { TREE_BUILDING_TECH, TREE_RECRUITS, TREE_TECHS } from './tech-tree.ts';
import type { BiomeId } from './rules.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: SpeciesId; uniqueLeader?: LeaderId }
  /** v17: `escortId` = the escort / carrier Pokémon; traders remember the city that trained them. */
  | { kind: 'logistics'; role: 'settler' | 'trader' | 'builder'; escortId?: SpeciesId; homeCityId?: number };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };
export type Content = {
  version: string;
  biomes: typeof BIOME_YIELDS; buildings: typeof BUILDINGS; techs: TechTable;
  balls: { [K in keyof typeof BALLS]: Omit<typeof BALLS[K], 'goldCost'> & { goldCost: number } };
  balance: Balance;
  units: Record<string, UnitDefinition>;
  species: Record<string, SpeciesDefinition>;
  moveCosts: Record<BiomeId, number>;
  /** Gameplay v20: Civilization 6-style combat strength (attack/defense are strengths, every unit has 100 HP). */
  combat?: 'strength';
  /** Gameplay v21: opening pace (city-centre research, sturdier cities, objectives, item balls). */
  opening?: true;
  /** Gameplay v22 (docs/design/world-v22.md): east-west map wrap, branching tech tree, era dedications. */
  wrap?: true; techTree?: true; dedications?: true;
  /** Gameplay v23 (docs/design/improvements-v23.md): resource improvements (A), pillage and repair (B), builder escorts (C). */
  resourceImprovements?: true; pillage?: true; builderCrews?: true;
  /** Gameplay v14 only: species-keyed tables that older contents read from their global constants. */
  roster?: RosterTables;
};
/** A stone evolution path (same shape as `WORLD_DEFINITIONS.stoneEvolutions`). */
export type RosterStoneEvolution = { fromSpeciesId: SpeciesId; intoSpeciesId: SpeciesId; stoneId: 'fireStone' | 'waterStone' | 'leafStone' | 'thunderStone' | 'moonStone'; requiredXp: number };
export type RosterTables = {
  spawnWeights: Record<BiomeId, Partial<Record<SpeciesId, number>>>;
  wanderers: readonly SpeciesId[];
  techRecruits: Partial<Record<TechId, SpeciesId>>;
  /** Generation (2–9) -> species every city may train once the player reaches that generation. */
  generationRecruits: Partial<Record<number, SpeciesId>>;
  leaderUnits: Partial<Record<LeaderId, SpeciesId>>;
  /** Added to the world's stone evolutions. */
  stoneEvolutions: readonly RosterStoneEvolution[];
  nestPriority: readonly SpeciesId[];
  /** More species to document for the Pokédex victory (the wild is richer). */
  pokedexTargetBonus: number;
  /** Weights for the nest picker (absent = uniform). */
  nestWeights?: Partial<Record<SpeciesId, number>>;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
export const CONTENT: Content = {
  version: 'm3-v1', balance: BALANCE, species: LEGACY_SPECIES, biomes: BIOME_YIELDS, buildings: BUILDINGS, techs: TECHS, balls: BALLS,
  units: {
    ...LEGACY_SPECIES,
    settler: { name: '开拓队', move: 2, vision: 2, terrain: land, trainCost: 30, upkeep: 0 },
  },
  // D28: flight grants passage, not a terrain cost discount.
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
};
// Reallocate the same stage stat budgets for double weaknesses. The legacy table
// above remains the source of truth for existing m3-v1 saves and command logs.
const expandedSpecies = JSON.parse(JSON.stringify(SPECIES)) as typeof SPECIES;
for (const [id, stats] of Object.entries({
  geodude: { maxHp: 60, attack: 20, defense: 90 },
  graveler: { maxHp: 80, attack: 30, defense: 120 },
  onix: { maxHp: 80, attack: 40, defense: 120 },
  charizard: { maxHp: 100, attack: 83, defense: 98 },
  gyarados: { maxHp: 90, attack: 60, defense: 90 },
  bulbasaur: { maxHp: 55, attack: 45, defense: 57 },
  gastly: { maxHp: 53, attack: 43, defense: 60 },
})) Object.assign(expandedSpecies[id as BaseSpeciesId], stats);
validateSpecies(expandedSpecies);
export const EXPANSION_CONTENT: Content = {
  ...CONTENT, version: 'expansion-v1', species: expandedSpecies,
  units: { ...expandedSpecies, settler: CONTENT.units.settler },
};
/** Gameplay v14: expansion-v1's 47 species plus the 58 roster species (data in roster-v14-data.ts, spec docs/design/roster-v14.md). */
const TERRAIN: Record<Exclude<RosterTerrain, BiomeId[]>, BiomeId[]> = { land, all: [...land, 'ocean', 'volcano'], ocean: ['ocean'] };
function toOption(evolution: RosterEvolution): EvolutionOption | null {
  const condition = evolution.condition;
  if (condition && typeof condition === 'object' && 'stone' in condition) return null; // stone paths live in roster.stoneEvolutions
  return { speciesId: evolution.speciesId as SpeciesId, xp: evolution.xp, gold: evolution.gold, requiresTraining: evolution.requiresTraining,
    ...(evolution.minGeneration ? { minGeneration: evolution.minGeneration } : {}),
    ...(condition === 'day' || condition === 'night' ? { time: condition } : condition && 'biome' in condition ? { biome: condition.biome } : {}) };
}
/** First option becomes `evolution` (+ `evolutionCondition`), the rest become `branches`. */
function withEvolutions(species: SpeciesDefinition, evolutions: readonly RosterEvolution[], stoneTargets: readonly string[]): SpeciesDefinition {
  const options = evolutions.map(evolution => toOption(evolution) ?? (stoneTargets.includes(evolution.speciesId)
    ? { speciesId: evolution.speciesId as SpeciesId, xp: evolution.xp, gold: evolution.gold, requiresTraining: evolution.requiresTraining } : null))
    .filter((option): option is EvolutionOption => option !== null);
  if (!options.length) return species;
  const [first, ...rest] = species.evolution ? [{ ...species.evolution }, ...options] : options;
  const { speciesId, xp, gold, requiresTraining, ...condition } = first;
  return { ...species, evolution: { speciesId, xp, gold, requiresTraining },
    ...(Object.keys(condition).length ? { evolutionCondition: condition } : {}), ...(rest.length ? { branches: rest } : {}) };
}
const rosterStoneTargets = STONE_EVOLUTIONS_V14_ADDITIONS.map(path => path.intoSpeciesId);
const rosterSpecies = JSON.parse(JSON.stringify(expandedSpecies)) as Record<SpeciesId, SpeciesDefinition>;
for (const [id, additions] of Object.entries(EXISTING_EVOLUTION_ADDITIONS)) rosterSpecies[id as SpeciesId] = withEvolutions(rosterSpecies[id as SpeciesId], additions, rosterStoneTargets);
for (const [id, biomes] of Object.entries(EXISTING_SPAWN_BIOME_ADDITIONS)) rosterSpecies[id as SpeciesId].spawnBiomes = [...new Set([...rosterSpecies[id as SpeciesId].spawnBiomes, ...biomes])];
for (const [id, data] of Object.entries(ROSTER_V14_SPECIES)) {
  const { evolutions, terrain, ...rest } = data;
  rosterSpecies[id as SpeciesId] = withEvolutions({ ...rest, terrain: Array.isArray(terrain) ? [...terrain] : [...TERRAIN[terrain]], spawnBiomes: [...data.spawnBiomes], evolution: null }, evolutions, rosterStoneTargets);
}
validateSpecies(rosterSpecies);
export const ROSTER_CONTENT: Content = {
  ...EXPANSION_CONTENT, version: 'roster-v14', species: rosterSpecies,
  units: { ...rosterSpecies, settler: CONTENT.units.settler,
    trader: { name: '商队', move: 4, vision: 2, terrain: land, trainCost: 35, upkeep: 1 },
    builder: { name: '工匠', move: 3, vision: 2, terrain: land, trainCost: 20, upkeep: 1 } },
  roster: {
    spawnWeights: SPAWN_WEIGHTS_V14 as RosterTables['spawnWeights'], wanderers: WANDERERS_V14 as SpeciesId[],
    techRecruits: TECH_RECRUITS_V14 as RosterTables['techRecruits'], generationRecruits: GENERATION_RECRUITS_V14 as RosterTables['generationRecruits'],
    leaderUnits: LEADER_UNITS_V14 as RosterTables['leaderUnits'], stoneEvolutions: STONE_EVOLUTIONS_V14_ADDITIONS as RosterStoneEvolution[],
    nestPriority: NEST_PRIORITY_V14 as SpeciesId[], nestWeights: NEST_WEIGHTS_V14 as RosterTables['nestWeights'], pokedexTargetBonus: 5,
  },
};
/** Gameplay v20: the roster with attack / defense turned into combat strength (×0.4 + 15) and 100 HP for every Pokémon. */
const battleSpecies = Object.fromEntries(Object.entries(ROSTER_CONTENT.species).map(([id, species]) => [id,
  { ...species, attack: Math.max(1, Math.round(species.attack * 0.4) + 15), defense: Math.max(1, Math.round(species.defense * 0.4) + 15), maxHp: 100 }])) as Record<SpeciesId, SpeciesDefinition>;
export const BATTLE_CONTENT: Content = { ...ROSTER_CONTENT, version: 'battle-v20', combat: 'strength', species: battleSpecies,
  units: { ...ROSTER_CONTENT.units, ...battleSpecies } };
/** Gameplay v21: faster opening — cheaper tier-1/2 techs, 100 HP cities (spec docs/design/opening-v21.md). */
export const OPENING_CONTENT: Content = { ...BATTLE_CONTENT, version: 'opening-v21', opening: true,
  techs: Object.fromEntries(Object.entries(BATTLE_CONTENT.techs).map(([id, tech]) => [id, { ...tech, cost: tech.tier === 1 ? 14 : tech.tier === 2 ? 32 : tech.cost }])) as Content['techs'],
  units: { ...BATTLE_CONTENT.units, settler: { ...BATTLE_CONTENT.units.settler, trainCost: 24 } },
  balance: { ...BATTLE_CONTENT.balance, city: { ...BATTLE_CONTENT.balance.city, baseHp: 100, capturedHp: 50 } } };
type ContentSetup = { expansionVersion?: 1; gameplayVersion?: number };
/** The single place that maps a game setup to its content table; logs and saves record `content.version`. */
/** v22: v21 content plus the three flags; the tech tree replaces `techs`, rewires building techs and the recruit table. */
export const WORLD_CONTENT: Content = { ...OPENING_CONTENT, version: 'world-v22', wrap: true, techTree: true, dedications: true,
  techs: TREE_TECHS as TechTable,
  buildings: Object.fromEntries(Object.entries(OPENING_CONTENT.buildings).map(([id, building]) =>
    [id, TREE_BUILDING_TECH[id as BuildingId] ? { ...building, requiredTech: TREE_BUILDING_TECH[id as BuildingId] } : building])) as Content['buildings'],
  roster: { ...OPENING_CONTENT.roster!, techRecruits: TREE_RECRUITS } };
/** v23: v22 content plus the three improvement flags (spec docs/design/improvements-v23.md). */
export const IMPROVEMENT_CONTENT: Content = { ...WORLD_CONTENT, version: 'improvements-v23', resourceImprovements: true, pillage: true, builderCrews: true };
/** A technology of this content (throws for ids the content does not define, e.g. a v22 id in an older game). */
export function techOf(content: Content, id: TechId): TechDefinition {
  const tech = content.techs[id];
  if (!tech) throw new Error(`Unknown technology ${id} in ${content.version}`);
  return tech;
}
export function contentFor(setup: ContentSetup): Content {
  return setup.expansionVersion !== 1 ? CONTENT : (setup.gameplayVersion ?? 0) >= 23 ? IMPROVEMENT_CONTENT : (setup.gameplayVersion ?? 0) >= 22 ? WORLD_CONTENT : (setup.gameplayVersion ?? 0) >= 21 ? OPENING_CONTENT : (setup.gameplayVersion ?? 0) >= 20 ? BATTLE_CONTENT : (setup.gameplayVersion ?? 0) >= 14 ? ROSTER_CONTENT : EXPANSION_CONTENT;
}
/** Same choice from a player's view (views carry `expansion` and `gameplayVersion` but not the setup). */
export function contentForView(view: { expansion?: unknown; gameplayVersion?: number }): Content {
  return view.expansion ? contentFor({ expansionVersion: 1, gameplayVersion: view.gameplayVersion }) : CONTENT;
}
export const STOCK_CONTENTS: readonly Content[] = [CONTENT, EXPANSION_CONTENT, ROSTER_CONTENT, BATTLE_CONTENT, OPENING_CONTENT, WORLD_CONTENT, IMPROVEMENT_CONTENT];
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  const base = content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
  return unit.kind === 'pokemon' && unit.uniqueLeader ? { ...base, name: `${base.name}·${unit.uniqueLeader}`, vision: base.vision + 1 } : base;
}
