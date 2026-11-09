// Gameplay v24 A (docs/design/world-v24.md §2): map generation parameters, terrain feature rules, natural landmarks and habitats.
// Scaffolding: the values below are the spec's numbers; no rule reads them yet (feature A1/A2/A3 branches fill in the tables).

/** §2.1 generation (A1). */
export const MAP_GENERATION_V24 = {
  landPercent: 56, islandPercent: 5, continentGap: 3, poleRows: 2, islandLinkStep: 3,
  ridgeLandTilesPer: 45, ridgeLength: [4, 7], peakPercent: 35, hillPercent: 13, volcanoTiles: 8,
  riverLandTilesPer: 70, riverMinLength: 4, lakesPerContinent: 1,
  startMinUsableLand: [26, 22, 18], startMinDistance: [8, 6, 4], startCoastRadius: 3, startMaxLatitude: 650,
  landTilesPerLandmark: 110,
} as const;

/** §2.2 feature rules (A1) and §2.3 embarking (A2). Strength values are flat labelled bonuses (src/core/strength.ts). */
export const TERRAIN_RULES_V24 = {
  hillProduction: 1, hillMoveCost: 1, hillDefense: 3, hillCityDefense: 3,
  riverGold: 1, riverCrossingCost: 1, riverCrossingAttack: -5, freshWaterFood: 1,
  deepOcean: { food: 1, production: 0, gold: 1, research: 0 },
  embarkedDefense: -10,
} as const;

/** §2.5 natural landmarks (A3), all original. */
export type LandmarkId = 'singingDunes' | 'stardustMere' | 'elderCanopy' | 'thunderMesa' | 'mistlockGorge' | 'tidesongGrotto' | 'everfrostHollow' | 'emberCaldera';
export const LANDMARK_IDS: readonly LandmarkId[] = ['singingDunes', 'stardustMere', 'elderCanopy', 'thunderMesa', 'mistlockGorge', 'tidesongGrotto', 'everfrostHollow', 'emberCaldera'];
