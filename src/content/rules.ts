export const DEFAULT_MAP = { width: 24, height: 16, playerCount: 4 } as const;
export const START_DISTANCES = [8, 6, 4] as const;

// 暂定，待 design 在 M5 校准。六种非火山群系中心的抽样权重，合计100；
// 每种先保留一个中心保证覆盖，实际地块比例还受最近中心分区影响。
export const BIOME_WEIGHTS = [
  { id: 'grassland', weight: 35 },
  { id: 'forest', weight: 25 },
  { id: 'mountain', weight: 15 },
  { id: 'ocean', weight: 12 },
  { id: 'desert', weight: 7 },
  { id: 'snow', weight: 6 },
] as const;
export type BiomeId = (typeof BIOME_WEIGHTS)[number]['id'] | 'volcano';

export const MAP_GENERATION = {
  tilesPerCenter: 12,
  volcanoPercent: 2, // 暂定2%；GDD硬上限3%，仅边缘连通簇。
} as const;
