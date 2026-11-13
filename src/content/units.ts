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
import { WORLD24_TUNING } from './world24-tuning.ts';
import { RIVAL_RULES_V25 } from './rivals.ts';
import type { World24Tuning } from './world24-tuning.ts';
import type { EraProgression } from './eras.ts';
import type { LandmarkId } from './terrain.ts';
import type { ResolvedRecruit } from './recruit-slots.ts';
import { deriveRosterTables, drawRegionalDex, dexMaxGeneration, evolutionLines } from './regional-dex.ts';
import type { RegionalDexDraw } from './regional-dex.ts';
import { SPECIES_TAGS } from './species-tags.ts';
import { DEPTH26_TUNING, DEPTH_FLAGS } from './depth-v26.ts';
import type { Depth26Tuning, DepthFlags } from './depth-v26.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: SpeciesId; uniqueLeader?: LeaderId }
  /** v17: `escortId` = the escort / carrier Pokémon; traders remember the city that trained them. */
  | { kind: 'logistics'; role: 'settler' | 'trader' | 'builder'; escortId?: SpeciesId; homeCityId?: number };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };
export type Content = DepthFlags & {
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
  /** Gameplay v24 (docs/design/world-v24.md): terrain generation and features (A1), embarking and impassable peaks (A2), landmarks and
   * habitats (A3), gym circuit (B), rival trainers (C), Pokédex research tasks (D). */
  terrain?: true; embark?: true; landmarks?: true; gymCircuit?: true; rivals?: true; researchTasks?: true;
  /** Gameplay v24 balance knobs (src/content/world24-tuning.ts); only the v24 content carries them, so patches cannot reach older rules. */
  world24?: World24Tuning;
  /** Gameplay v14 only: species-keyed tables that older contents read from their global constants. */
  roster?: RosterTables;
  /** Gameplay v25 (docs/design/roster-v25.md): this game's regional Pokédex (`size` species of a `pool`-species mode pool). Absent = every species. */
  regionalDex?: { speciesIds: readonly SpeciesId[]; size: number; pool: number };
  /** Gameplay v26 balance knobs (src/content/depth-v26.ts); only the v26 content carries them. The v26 flags come from `DepthFlags`. */
  depth26?: Depth26Tuning;
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
  /** v25 (roster-v25 §3.2): habitat overlays, deep water and landmark residents of the regional Pokédex; absent = the v24 tables. */
  habitatOverlays?: Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>>;
  deepWater?: { multiply: Partial<Record<SpeciesId, number>>; remove: readonly SpeciesId[] };
  residents?: Partial<Record<LandmarkId, readonly SpeciesId[]>>;
  /** v25: how each recruit slot resolved in this region (tech cards, research tree). */
  recruitSlots?: readonly ResolvedRecruit[];
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
/** What picks a content: versions, plus (v25) the public setup the regional Pokédex is drawn from. */
type ContentSetup = { expansionVersion?: 1; gameplayVersion?: number; seed?: number; dexSeed?: number; eraProgression?: EraProgression;
  players?: readonly { leaderId?: LeaderId }[] };
/** The single place that maps a game setup to its content table; logs and saves record `content.version`. */
/** v22: v21 content plus the three flags; the tech tree replaces `techs`, rewires building techs and the recruit table. */
export const WORLD_CONTENT: Content = { ...OPENING_CONTENT, version: 'world-v22', wrap: true, techTree: true, dedications: true,
  techs: TREE_TECHS as TechTable,
  buildings: Object.fromEntries(Object.entries(OPENING_CONTENT.buildings).map(([id, building]) =>
    [id, TREE_BUILDING_TECH[id as BuildingId] ? { ...building, requiredTech: TREE_BUILDING_TECH[id as BuildingId] } : building])) as Content['buildings'],
  roster: { ...OPENING_CONTENT.roster!, techRecruits: TREE_RECRUITS } };
/** v23: v22 content plus the three improvement flags (spec docs/design/improvements-v23.md). */
export const IMPROVEMENT_CONTENT: Content = { ...WORLD_CONTENT, version: 'improvements-v23', resourceImprovements: true, pillage: true, builderCrews: true };
/** v24: v23 content plus the six world flags (spec docs/design/world-v24.md). */
export const WORLD24_CONTENT: Content = { ...IMPROVEMENT_CONTENT, version: 'world-v24', terrain: true, embark: true, landmarks: true, gymCircuit: true, rivals: true, researchTasks: true,
  world24: JSON.parse(JSON.stringify(WORLD24_TUNING)) as typeof WORLD24_TUNING };
/** v25 species: v24 species, with every tagged wild habitat also listed in `spawnBiomes` (sneasel and clefairy gain one, roster-v25 §3.1). */
const regionalSpecies = Object.fromEntries(Object.entries(WORLD24_CONTENT.species).map(([id, species]) => {
  const biomes = Object.keys(SPECIES_TAGS[id]?.habitat ?? {}).filter((key): key is BiomeId => key in BIOME_YIELDS);
  return [id, biomes.every(biome => species.spawnBiomes.includes(biome)) ? species : { ...species, spawnBiomes: [...new Set([...species.spawnBiomes, ...biomes])] }];
})) as Record<SpeciesId, SpeciesDefinition>;
const regionalRoster = (speciesIds: readonly SpeciesId[], mode: EraProgression): RosterTables => deriveRosterTables(regionalSpecies, speciesIds, mode);
/** v25 base (spec docs/design/roster-v25.md): the v24 content with roster tables derived from the species tags over the whole pool. A game's
 * own content (`regionalContentFor`) narrows the tables to its regional Pokédex; this base serves setups without a seed (the manual). */
export const REGIONAL_CONTENT: Content = { ...WORLD24_CONTENT, version: 'roster-v25', species: regionalSpecies, units: { ...WORLD24_CONTENT.units, ...regionalSpecies },
  world24: { ...JSON.parse(JSON.stringify(WORLD24_CONTENT.world24)) as World24Tuning, rivalStrengthOffsets: [...RIVAL_RULES_V25.strengthOffsets],
    rivalStayRounds: [...RIVAL_RULES_V25.staysRounds] }, roster: regionalRoster(Object.keys(regionalSpecies).sort() as SpeciesId[], 'full-v1') };
const regionalContents = new Map<string, Content>(), regionalDraws = new Map<string, RegionalDexDraw>(), bySetup = new WeakMap<object, Content>();
const derivedContents = new WeakSet<Content>();
/** Pool size of a mode (P in the Pokédex target scaling, §2.6). */
export const regionalPoolSize = (mode: EraProgression): number => evolutionLines(regionalSpecies, dexMaxGeneration(mode)).reduce((sum, line) => sum + line.speciesIds.length, 0);
/** v25 §2.2: the regional Pokédex draw of a setup (dexSeed, else the map seed; era mode; seated leaders). Memoized; pure. */
export function regionalDexDraw(setup: { seed: number; dexSeed?: number; eraProgression: EraProgression; players: readonly { leaderId?: LeaderId }[] }): RegionalDexDraw {
  const leaders = [...new Set(setup.players.flatMap(player => player.leaderId ? [player.leaderId] : []))].sort();
  const dexSeed = setup.dexSeed ?? setup.seed, key = `${dexSeed}|${setup.eraProgression}|${leaders.join(',')}`;
  let draw = regionalDraws.get(key);
  if (!draw) {
    if (regionalDraws.size > 512) regionalDraws.clear();
    regionalDraws.set(key, draw = drawRegionalDex({ species: regionalSpecies, mode: setup.eraProgression, dexSeed, leaders }));
  }
  return draw;
}
/** v25: the content of a regional Pokédex (memoized by mode and species list, so the authority and every view share one object). */
export function regionalContentFromIds(speciesIds: readonly SpeciesId[], mode: EraProgression): Content {
  const sorted = [...new Set(speciesIds)].filter(id => regionalSpecies[id]).sort(), key = `${mode}|${sorted.join(',')}`;
  let content = regionalContents.get(key);
  if (!content) {
    if (regionalContents.size > 512) regionalContents.clear();
    content = { ...REGIONAL_CONTENT, roster: regionalRoster(sorted, mode), regionalDex: { speciesIds: Object.freeze(sorted), size: sorted.length, pool: regionalPoolSize(mode) } };
    derivedContents.add(content);
    regionalContents.set(key, content);
  }
  return content;
}
/** v25: the content of one game's regional Pokédex; setups without a seed or era mode get the whole-pool base. */
export function regionalContentFor(setup: ContentSetup): Content {
  if (setup.seed === undefined || setup.eraProgression === undefined || !setup.players) return REGIONAL_CONTENT;
  const cached = bySetup.get(setup);
  if (cached) return cached;
  const content = regionalContentFromIds(regionalDexDraw(setup as Parameters<typeof regionalDexDraw>[0]).speciesIds, setup.eraProgression);
  bySetup.set(setup, content);
  return content;
}
/** v26 (docs/design/depth-v26.md): the v25 regional content with the depth flags, its own knobs and its own copy of the world24 tuning. */
const depthOverlay = (base: Content): Content => ({ ...base, version: 'depth-v26', ...DEPTH_FLAGS,
  world24: JSON.parse(JSON.stringify(base.world24)) as World24Tuning, depth26: JSON.parse(JSON.stringify(DEPTH26_TUNING)) as Depth26Tuning });
/** v26 base: the v25 base plus the depth flags (setups without a seed, the manual). */
export const DEPTH_CONTENT: Content = depthOverlay(REGIONAL_CONTENT);
const depthContents = new WeakMap<Content, Content>();
/** v26 of a v25 regional content (memoized, so the authority and every view of one game share one object). */
function depthOf(regional: Content): Content {
  if (regional === REGIONAL_CONTENT) return DEPTH_CONTENT;
  let content = depthContents.get(regional);
  if (!content) {
    depthContents.set(regional, content = depthOverlay(regional));
    derivedContents.add(content);
  }
  return content;
}
/**
 * v26: the content of one game. Species batch (§4.3, src/content/roster-v26-data.ts): the batch lane replaces the v25 draw here with a
 * draw over the v25 species plus `ROSTER_V26_SPECIES` (empty for now, so v26 draws the v25 Pokédex).
 */
export function depthContentFor(setup: ContentSetup): Content {
  return depthOf(regionalContentFor(setup));
}
/** Stock contents plus the derived v25 regional contents (saves re-derive them from the setup). */
export const isStockContent = (content: Content): boolean => STOCK_CONTENTS.includes(content) || derivedContents.has(content);
/** A technology of this content (throws for ids the content does not define, e.g. a v22 id in an older game). */
export function techOf(content: Content, id: TechId): TechDefinition {
  const tech = content.techs[id];
  if (!tech) throw new Error(`Unknown technology ${id} in ${content.version}`);
  return tech;
}
export function contentFor(setup: ContentSetup): Content {
  return setup.expansionVersion !== 1 ? CONTENT : (setup.gameplayVersion ?? 0) >= 26 ? depthContentFor(setup) : (setup.gameplayVersion ?? 0) >= 25 ? regionalContentFor(setup) : (setup.gameplayVersion ?? 0) >= 24 ? WORLD24_CONTENT : (setup.gameplayVersion ?? 0) >= 23 ? IMPROVEMENT_CONTENT : (setup.gameplayVersion ?? 0) >= 22 ? WORLD_CONTENT : (setup.gameplayVersion ?? 0) >= 21 ? OPENING_CONTENT : (setup.gameplayVersion ?? 0) >= 20 ? BATTLE_CONTENT : (setup.gameplayVersion ?? 0) >= 14 ? ROSTER_CONTENT : EXPANSION_CONTENT;
}
/** Same choice from a player's view (views carry `expansion` and `gameplayVersion` but not the setup; v25 views carry the regional Pokédex). */
export function contentForView(view: { expansion?: unknown; gameplayVersion?: number; eraProgression?: EraProgression; regionalDex?: readonly SpeciesId[] }): Content {
  if (view.expansion && view.regionalDex && view.eraProgression && (view.gameplayVersion ?? 0) >= 26) return depthOf(regionalContentFromIds(view.regionalDex, view.eraProgression));
  if (view.expansion && view.regionalDex && view.eraProgression && (view.gameplayVersion ?? 0) >= 25) return regionalContentFromIds(view.regionalDex, view.eraProgression);
  return view.expansion ? contentFor({ expansionVersion: 1, gameplayVersion: view.gameplayVersion }) : CONTENT;
}
export const STOCK_CONTENTS: readonly Content[] = [CONTENT, EXPANSION_CONTENT, ROSTER_CONTENT, BATTLE_CONTENT, OPENING_CONTENT, WORLD_CONTENT, IMPROVEMENT_CONTENT, WORLD24_CONTENT, REGIONAL_CONTENT, DEPTH_CONTENT];
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  const base = content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
  return unit.kind === 'pokemon' && unit.uniqueLeader ? { ...base, name: `${base.name}·${unit.uniqueLeader}`, vision: base.vision + 1 } : base;
}
