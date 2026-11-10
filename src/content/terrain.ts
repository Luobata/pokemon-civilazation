// Gameplay v24 A (docs/design/world-v24.md §2): map generation parameters, terrain feature rules, natural landmarks and habitats.
import type { BiomeId } from './rules.ts';
import type { Yield } from './economy.ts';
import type { EssenceId } from './essences.ts';
import type { SpeciesId } from './species.ts';

/** §2.1 generation (A1). All values are integers (percentages, permille latitudes, 0–999 moisture). */
export const MAP_GENERATION_V24 = {
  landPercent: 56, islandPercent: 5, continentGap: 3, poleRows: 2, islandLinkStep: 3,
  /** Islands: 2–5 tiles, at least this far from any continent tile. */
  islandSize: [2, 5], islandGap: 3,
  ridgeLandTilesPer: 45, ridgeLength: [4, 7], ridgeTurnPercent: 40, peakPercent: 35, peakMinCoastDistance: 2,
  /** Hills: flat land beside a ridge turns hilly at this rate, then random clusters fill up to `hillPercent` of the flat land. */
  ridgeHillPercent: 35, hillPercent: 13, volcanoTiles: 8, volcanoLandPer: 100,
  riverLandTilesPer: 70, riverMinLength: 4, riverSourceCoastDistance: 3, lakesPerContinent: 1, lakeCoastDistance: 3,
  /** Coarse moisture grid (columns × rows of tiles per cell) and the coastal bonus within `coastalMoistureRange` tiles of water. */
  moistureCell: [7, 5], coastalMoisture: 100, coastalMoistureRange: 2,
  startMinUsableLand: [26, 22, 18], startMinDistance: [8, 6, 4], startCoastRadius: 3, startMaxLatitude: 650, startCandidates: 30,
  landTilesPerLandmark: 110,
} as const;

/** §2.1 step 6: climate bands by latitude (permille from the equator) and the moisture thresholds inside each band. */
export const CLIMATE_BANDS_V24: readonly { maxLatitude: number; forestAt: number; desertBelow?: number; dry: BiomeId }[] = [
  { maxLatitude: 90, forestAt: 560, dry: 'grassland' },
  { maxLatitude: 300, forestAt: 760, desertBelow: 430, dry: 'grassland' },
  { maxLatitude: 660, forestAt: 640, dry: 'grassland' },
  { maxLatitude: 820, forestAt: 520, dry: 'snow' },
  { maxLatitude: 1001, forestAt: 1000, dry: 'snow' },
];

/** §2.4 start quality: value of each tile within 2 of a candidate (shallow water 5, deep 2), plus hills and rivers. */
export const START_TILE_VALUES_V24 = {
  grassland: 5, forest: 5, mountain: 4, shallow: 5, deep: 2, desert: 2, snow: 1, volcano: 0, hill: 1, river: 2,
} as const;

/** §2.2 feature rules (A1) and §2.3 embarking (A2). Strength values are flat labelled bonuses (src/core/strength.ts). */
export const TERRAIN_RULES_V24 = {
  hillProduction: 1, hillMoveCost: 1, hillDefense: 3, hillCityDefense: 3, hillVision: 1,
  riverGold: 1, riverCrossingCost: 1, riverCrossingAttack: -5, freshWaterFood: 1,
  deepOcean: { food: 1, production: 0, gold: 1, research: 0 },
  embarkedDefense: -10,
  /** AI travel fields (src/ai/travel.ts): an unexplored tile costs this much, embarking / landing this much. */
  unexploredCost: 2, embarkTravelCost: 3,
} as const;

/** §2.3: the technologies that open shallow (1) and deep (2) water to land units. */
export const EMBARK_TECHS = { shallow: 'seafaring', deep: 'oceanography' } as const;

/** §2.5 natural landmarks (A3), all original. */
export type LandmarkId = 'singingDunes' | 'stardustMere' | 'elderCanopy' | 'thunderMesa' | 'mistlockGorge' | 'tidesongGrotto' | 'everfrostHollow' | 'emberCaldera';
export const LANDMARK_IDS: readonly LandmarkId[] = ['singingDunes', 'stardustMere', 'elderCanopy', 'thunderMesa', 'mistlockGorge', 'tidesongGrotto', 'everfrostHollow', 'emberCaldera'];

/** Where a landmark may stand (the generator picks a tile that already has this terrain). */
export type LandmarkSite = 'desert' | 'lake' | 'forest' | 'grasslandHill' | 'mountain' | 'coastalMountain' | 'snow' | 'volcano';
export type LandmarkDefinition = {
  name: string; site: LandmarkSite;
  /** Added to each worked tile beside the landmark; `waterOnly`: only to water tiles beside it. */
  adjacent: Partial<Yield>; waterOnly?: true;
  /** Essences per worked adjacent tile. */
  essences?: Partial<Record<EssenceId, number>>;
  /** Round-end healing of own units ending the round beside it: Pokémon +hp, or naval units back to full. */
  healing?: { units: 'pokemon' | 'naval'; hp?: number; full?: true };
  /** Stardust Mere: a moon-stone deposit beside it that regrows this many rounds after being harvested. */
  moonStoneRegrowRounds?: number;
  residents: readonly SpeciesId[]; effect: string;
};
/** §2.5 the eight original landmarks. */
export const LANDMARKS: Record<LandmarkId, LandmarkDefinition> = {
  singingDunes: { name: '鸣沙回廊', site: 'desert', adjacent: { gold: 1 }, essences: { spark: 1 }, residents: ['sandshrew', 'trapinch', 'drilbur'],
    effect: '相邻格金币 +1、雷金精华 +1' },
  stardustMere: { name: '星屑湖', site: 'lake', adjacent: { research: 1 }, moonStoneRegrowRounds: 30, residents: ['clefairy'],
    effect: '相邻格科研 +1；旁边有一处月之石矿脉，被采集后 30 轮再生' },
  elderCanopy: { name: '长老古树', site: 'forest', adjacent: { food: 1 }, healing: { units: 'pokemon', hp: 10 }, residents: ['bulbasaur', 'caterpie', 'scyther'],
    effect: '相邻格食物 +1；己方宝可梦在相邻格结束回合额外恢复 10 HP' },
  thunderMesa: { name: '雷鸣台地', site: 'grasslandHill', adjacent: { production: 1 }, essences: { spark: 1 }, residents: ['pikachu', 'magnemite'],
    effect: '相邻格生产 +1、雷金精华 +1' },
  mistlockGorge: { name: '雾锁峡谷', site: 'mountain', adjacent: { production: 1, research: 1 }, residents: ['gastly', 'abra'],
    effect: '相邻格生产 +1、科研 +1' },
  tidesongGrotto: { name: '潮音洞', site: 'coastalMountain', adjacent: { food: 1 }, waterOnly: true, healing: { units: 'naval', full: true }, residents: ['horsea', 'lapras'],
    effect: '相邻浅海食物 +1；水面单位在相邻格结束回合回满 HP' },
  everfrostHollow: { name: '永冻冰窟', site: 'snow', adjacent: { research: 2 }, residents: ['swinub', 'sneasel', 'dratini'],
    effect: '相邻格科研 +2' },
  emberCaldera: { name: '余烬火口', site: 'volcano', adjacent: { production: 2 }, residents: ['charmander', 'ponyta'],
    effect: '相邻格生产 +2' },
};
/** §2.5 placement and discovery. */
export const LANDMARK_RULES_V24 = { minStartDistance: 4, spacing: 6, firstDiscoveryResearch: 15, residentMultiplier: 5, residentBaseWeight: 10 } as const;

/** §2.6 habitats: weights added on top of the biome's table for tiles with a feature (base species of the v14 roster only). */
export const HABITAT_OVERLAYS_V24: Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>> = {
  hill: { geodude: 15, machop: 10, sandshrew: 10 },
  river: { squirtle: 20, ekans: 10, caterpie: 10 },
  peakside: { onix: 10, beldum: 10, zubat: 10 },
};
/** §2.6 deep water: Lapras ×3, Squirtle removed (the open sea is for the big ones). */
export const DEEP_WATER_HABITAT_V24: { multiply: Partial<Record<SpeciesId, number>>; remove: readonly SpeciesId[] } = { multiply: { lapras: 3 }, remove: ['squirtle'] };
/** §2.6 at night dark and ghost species are twice as common. */
export const NIGHT_SPAWN_MULTIPLIER_V24 = 2;
/** §2.7 a land mass of at least this many tiles is a continent (islands and island-chain islets are smaller). */
export const CONTINENT_MIN_TILES_V24 = 20;
