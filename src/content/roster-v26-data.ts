// Gameplay v26 species batch (docs/design/depth-v26.md §4.3, content `roster-v26`): the first-generation completion (metapod, butterfree,
// weedle line, persian, spearow line, doduo line). `depthContentFor` (src/content/units.ts) is the single place that turns these tables into
// the v26 regional draw; v<=25 contents never see them (the new ids are in no v25 pool, so the v25 draws and golden files are unchanged).
//
// Stats are on the v20 strength scale (100 HP, power 10) exactly as the §4.3 table gives them. Each one has a pre-v20 equivalent on the
// `validateSpecies` stage budgets (attack / defense = round(x × 0.4) + 15, trainCost = floor(sum / 8)); tests/core/roster-v26.test.ts checks
// it. Movement, range, vision and terrain follow the existing species of the same class and stage: scouts 4 / 3, fast 5 / 2 on land,
// melee 3 / 2, air 5 / 3 over every terrain (spearow, a stage-1 flyer, keeps the stage-1 scout pace 4), flyers cross every terrain.
// The early lines (caterpie, weedle) evolve at 60 / 150 XP instead of 100 / 250 and their stage 2 → 3 needs no training (§4.3).
import type { BiomeId } from './rules.ts';
import type { RosterV26SpeciesId, SpeciesDefinition, SpeciesId } from './species.ts';
import type { SpeciesTags } from './species-tags.ts';

/** The content version of the batch (roster-v25 §5.2: one batch = one content version, with its own golden draws). */
export const ROSTER_V26_VERSION = 'roster-v26';
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
const allTerrain: BiomeId[] = [...land, 'ocean', 'volcano'];
const evolve = (speciesId: SpeciesId, xp: number, gold: number): SpeciesDefinition['evolution'] => ({ speciesId, xp, gold, requiresTraining: false });
type Stats = Pick<SpeciesDefinition, 'name' | 'typeId' | 'secondaryTypeId' | 'stage' | 'role' | 'attack' | 'defense' | 'move' | 'vision' | 'immunities'
  | 'trainCost' | 'terrain' | 'spawnBiomes' | 'evolution'> & { dex: number };
const species = (stats: Stats): SpeciesDefinition => {
  const { name, typeId, secondaryTypeId, stage, role, attack, defense, move, vision, immunities, trainCost, terrain, spawnBiomes, evolution, dex } = stats;
  return { name, typeId, ...(secondaryTypeId ? { secondaryTypeId } : {}), stage, role, maxHp: 100, attack, defense, move, range: 1, power: 10, vision,
    rare: false, immunities, trainCost, upkeep: stage, terrain, spawnBiomes, evolution, dex, generation: 1 };
};

/** New species definitions (v20 strength scale: 100 HP, power 10), keyed by id. */
export const ROSTER_V26_SPECIES: Readonly<Record<RosterV26SpeciesId, SpeciesDefinition>> = {
  // Cocoon: low attack, high defense — holds a city or escorts (§7.2); fire, flying and rock beat it.
  metapod: species({ name: '铁甲蛹', dex: 11, typeId: 'bug', stage: 2, role: 'melee', attack: 28, defense: 60, move: 3, vision: 2, immunities: [], trainCost: 26,
    terrain: land, spawnBiomes: [], evolution: evolve('butterfree', 150, 50) }),
  // The stage-3 scout both modes lacked: a late scout that still matters (vision +1).
  butterfree: species({ name: '巴大蝶', dex: 12, typeId: 'bug', secondaryTypeId: 'flying', stage: 3, role: 'scout', attack: 48, defense: 50, move: 4, vision: 4,
    immunities: ['ground'], trainCost: 35, terrain: allTerrain, spawnBiomes: [], evolution: null }),
  weedle: species({ name: '独角虫', dex: 13, typeId: 'bug', secondaryTypeId: 'poison', stage: 1, role: 'scout', attack: 36, defense: 33, move: 4, vision: 3,
    immunities: [], trainCost: 19, terrain: land, spawnBiomes: ['grassland', 'forest'], evolution: evolve('kakuna', 60, 20) }),
  kakuna: species({ name: '铁壳蛹', dex: 14, typeId: 'bug', secondaryTypeId: 'poison', stage: 2, role: 'melee', attack: 30, defense: 58, move: 3, vision: 2,
    immunities: [], trainCost: 26, terrain: land, spawnBiomes: [], evolution: evolve('beedrill', 150, 50) }),
  // The stage-3 fast unit simple mode lacked; psychic, fire, flying and rock beat it.
  beedrill: species({ name: '大针蜂', dex: 15, typeId: 'bug', secondaryTypeId: 'poison', stage: 3, role: 'fast', attack: 55, defense: 45, move: 5, vision: 2,
    immunities: [], trainCost: 35, terrain: land, spawnBiomes: [], evolution: null }),
  // A second normal-type stage-2 fast unit; fighting beats it.
  persian: species({ name: '猫老大', dex: 53, typeId: 'normal', stage: 2, role: 'fast', attack: 49, defense: 42, move: 5, vision: 2, immunities: ['ghost'],
    trainCost: 26, terrain: land, spawnBiomes: [], evolution: null }),
  // The stage-1 flyer both modes lacked: flight training finally has a stage-1 recruit; electric, ice and rock beat it.
  spearow: species({ name: '烈雀', dex: 21, typeId: 'normal', secondaryTypeId: 'flying', stage: 1, role: 'air', attack: 38, defense: 32, move: 4, vision: 3,
    immunities: ['ghost', 'ground'], trainCost: 18, terrain: allTerrain, spawnBiomes: ['grassland', 'desert'], evolution: evolve('fearow', 100, 30) }),
  fearow: species({ name: '大嘴雀', dex: 22, typeId: 'normal', secondaryTypeId: 'flying', stage: 2, role: 'air', attack: 48, defense: 42, move: 5, vision: 3,
    immunities: ['ghost', 'ground'], trainCost: 26, terrain: allTerrain, spawnBiomes: [], evolution: null }),
  // The second stage-1 fast candidate (ponyta was the only one, so it was in every game): riding no longer always gives ponyta.
  doduo: species({ name: '嘟嘟', dex: 84, typeId: 'normal', secondaryTypeId: 'flying', stage: 1, role: 'fast', attack: 41, defense: 34, move: 5, vision: 2,
    immunities: ['ghost', 'ground'], trainCost: 20, terrain: land, spawnBiomes: ['grassland', 'desert'], evolution: evolve('dodrio', 100, 30) }),
  dodrio: species({ name: '嘟嘟利', dex: 85, typeId: 'normal', secondaryTypeId: 'flying', stage: 2, role: 'fast', attack: 52, defense: 41, move: 5, vision: 2,
    immunities: ['ghost', 'ground'], trainCost: 26, terrain: land, spawnBiomes: [], evolution: null }),
};
/** Tags of the new species (habitats, nest weights, recruit slots), same shape as `SPECIES_TAGS`. Metapod and kakuna never spawn (evolution only). */
export const ROSTER_V26_TAGS: Readonly<Record<RosterV26SpeciesId, SpeciesTags>> = {
  beedrill: { rarity: 'common' },
  butterfree: { rarity: 'common' },
  dodrio: { rarity: 'common' },
  // Riding's named fallback after ponyta (RECRUIT_SLOTS `fallback`), not a first choice.
  doduo: { habitat: { grassland: 10, desert: 5 }, rarity: 'common' },
  fearow: { rarity: 'common' },
  kakuna: { rarity: 'common' },
  metapod: { rarity: 'common' },
  persian: { rarity: 'common' },
  // Flight training's first choice from roster-v26 on (RECRUIT_SLOTS `upgrade`); pidgey becomes its fallback.
  spearow: { habitat: { grassland: 15, desert: 5 }, rarity: 'common', recruit: ['aviation'] },
  weedle: { habitat: { forest: 10, grassland: 5 }, rarity: 'uncommon', nest: 2 },
};
/** Evolutions the batch adds to existing species (caterpie → metapod, meowth → persian), applied over the v25 species. */
export const ROSTER_V26_EVOLUTIONS: Readonly<Partial<Record<SpeciesId, Pick<SpeciesDefinition, 'evolution'>>>> = {
  caterpie: { evolution: evolve('metapod', 60, 20) },
  meowth: { evolution: evolve('persian', 100, 30) },
};
