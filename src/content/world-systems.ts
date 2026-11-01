import { EXPANSION_CONTENT } from './units.ts';
import type { Content } from './units.ts';
import type { SpeciesId } from './species.ts';

export type StoneId = 'fireStone' | 'waterStone' | 'leafStone' | 'thunderStone' | 'moonStone';
export type BerryId = 'oranBerry' | 'sitrusBerry' | 'lumBerry' | 'nanabBerry';

export type BerryDefinition = {
  id: BerryId;
  name: string;
  food: number;
  satisfaction: number;
  uses: number;
  regrowthRounds: number;
};

export type StoneDefinition = {
  id: StoneId;
  name: string;
  deposits: number;
};

export type StoneEvolutionDefinition = {
  fromSpeciesId: SpeciesId;
  intoSpeciesId: SpeciesId;
  stoneId: StoneId;
  requiredXp: number;
};

export type NestDefinition = {
  count: number;
  hp: number;
  damage: number;
  spawnIntervalRounds: number;
  maxActivePerNest: number;
  spawnHpPercent: number;
  clearGoldReward: number;
  clearSatisfactionReward: number;
};

export type OverlordDefinition = {
  count: number;
  bondPerOffering: number;
  foodCost: number;
  goldCost: number;
  reach: number;
  tier1Bond: number;
  tier2Bond: number;
  tier3Bond: number;
  tier1VisionRadius: number;
  tier2Yield: { food: number; production: number; gold: number; research: number };
  tier3Yield: { food: number; production: number; gold: number; research: number };
};

export type PokedexDefinition = {
  targetDocumentedSpecies: number;
};

export type WorldDefinitions = {
  version: 'world-v1';
  pokedex: PokedexDefinition;
  nests: NestDefinition;
  overlords: OverlordDefinition;
  berries: Record<BerryId, BerryDefinition>;
  berryDeposits: number;
  stones: Record<StoneId, StoneDefinition>;
  stoneEvolutions: StoneEvolutionDefinition[];
  satisfaction: { decayPerRound: number; prosperousThreshold: number; prosperousGold: number; maximum: number };
};

export const WORLD_DEFINITIONS: WorldDefinitions = {
  version: 'world-v1',
  pokedex: { targetDocumentedSpecies: 18 },
  nests: {
    count: 6,
    hp: 52,
    damage: 8,
    spawnIntervalRounds: 6,
    maxActivePerNest: 3,
    spawnHpPercent: 80,
    clearGoldReward: 24,
    clearSatisfactionReward: 10,
  },
  overlords: {
    count: 3,
    bondPerOffering: 5,
    foodCost: 10,
    goldCost: 20,
    reach: 3,
    tier1Bond: 15,
    tier2Bond: 40,
    tier3Bond: 75,
    tier1VisionRadius: 2,
    tier2Yield: { food: 1, production: 1, gold: 1, research: 0 },
    tier3Yield: { food: 1, production: 1, gold: 2, research: 1 },
  },
  berries: {
    oranBerry: { id: 'oranBerry', name: '橙果', food: 8, satisfaction: 10, uses: 3, regrowthRounds: 5 },
    sitrusBerry: { id: 'sitrusBerry', name: '文柚果', food: 12, satisfaction: 14, uses: 2, regrowthRounds: 7 },
    lumBerry: { id: 'lumBerry', name: '木子果', food: 6, satisfaction: 16, uses: 2, regrowthRounds: 8 },
    nanabBerry: { id: 'nanabBerry', name: '蕉香果', food: 10, satisfaction: 12, uses: 3, regrowthRounds: 6 },
  },
  berryDeposits: 10,
  stones: {
    fireStone: { id: 'fireStone', name: '火之石', deposits: 2 },
    waterStone: { id: 'waterStone', name: '水之石', deposits: 2 },
    leafStone: { id: 'leafStone', name: '叶之石', deposits: 2 },
    thunderStone: { id: 'thunderStone', name: '雷之石', deposits: 2 },
    moonStone: { id: 'moonStone', name: '月之石', deposits: 2 },
  },
  stoneEvolutions: [
    { fromSpeciesId: 'pikachu', intoSpeciesId: 'raichu', stoneId: 'thunderStone', requiredXp: 100 },
    { fromSpeciesId: 'ivysaur', intoSpeciesId: 'venusaur', stoneId: 'leafStone', requiredXp: 250 },
    { fromSpeciesId: 'charmeleon', intoSpeciesId: 'charizard', stoneId: 'fireStone', requiredXp: 250 },
    { fromSpeciesId: 'wartortle', intoSpeciesId: 'blastoise', stoneId: 'waterStone', requiredXp: 250 },
    { fromSpeciesId: 'clefairy', intoSpeciesId: 'clefable', stoneId: 'moonStone', requiredXp: 100 },
  ],
  satisfaction: { decayPerRound: 4, prosperousThreshold: 50, prosperousGold: 2, maximum: 100 },
};

export type WorldSystemContent = { base: Content; world: WorldDefinitions };
export const WORLD_CONTENT: WorldSystemContent = { base: EXPANSION_CONTENT, world: WORLD_DEFINITIONS };

export function validateWorldDefinitions(world: WorldDefinitions, content: Content = EXPANSION_CONTENT): void {
  const counts = [world.nests.count, world.overlords.count, world.berryDeposits];
  if (counts.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('World entity counts must be positive integers.');
  if (world.nests.hp < 1 || world.nests.damage < 0 || world.nests.spawnIntervalRounds < 2 || world.nests.maxActivePerNest < 1) {
    throw new Error('Invalid nest definition.');
  }
  if (world.overlords.bondPerOffering < 1 || world.overlords.foodCost < 1 || world.overlords.goldCost < 1
    || world.overlords.tier1Bond >= world.overlords.tier2Bond || world.overlords.tier2Bond >= world.overlords.tier3Bond) {
    throw new Error('Invalid overlord definition.');
  }
  if (world.pokedex.targetDocumentedSpecies < 2 || world.pokedex.targetDocumentedSpecies > Object.keys(content.species).length) {
    throw new Error('Pokedex target is outside the species-content boundary.');
  }
  for (const evolution of world.stoneEvolutions) {
    const from = content.species[evolution.fromSpeciesId];
    const into = content.species[evolution.intoSpeciesId];
    if (!from || !into || from.stage + 1 !== into.stage || !Object.hasOwn(world.stones, evolution.stoneId)) {
      throw new Error(`Invalid stone evolution: ${evolution.fromSpeciesId} -> ${evolution.intoSpeciesId}`);
    }
  }
}

validateWorldDefinitions(WORLD_DEFINITIONS, EXPANSION_CONTENT);
