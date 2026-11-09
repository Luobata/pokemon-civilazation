// Gameplay v24 A (docs/design/world-v24.md §2): map generation parameters, terrain feature rules, natural landmarks and habitats.
import type { BiomeId } from './rules.ts';

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
