// Gameplay v24 A (docs/design/world-v24.md §2.2–2.3): terrain feature queries (hills, peaks, rivers, lakes, deep ocean, landmarks).
// Scaffolding: no map carries `features` yet (the v24 generator in map-v24.ts still delegates to the v23 one), so the rules equal v23.
import type { LandmarkId } from '../content/terrain.ts';
import type { GridSize } from './hex.ts';

/** Sorted tile indexes per feature (written only by the v24 generator; absent on v≤23 maps). */
export type MapFeatures = {
  hills: number[]; peaks: number[]; rivers: number[]; lakes: number[]; deep: number[];
  landmarks: { tileIndex: number; id: LandmarkId }[];
};
type VersionSource = { setup?: { gameplayVersion?: number }; gameplayVersion?: number };
/** Gameplay v24 terrain rules (A1). */
export const usesTerrainV24 = (source: VersionSource) => ((source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0) >= 24;

/** The features a player's view carries: only explored tiles (features are static, so seeing a tile once reveals them). */
export function viewFeatures(map: GridSize & { features?: MapFeatures }, exploredTileIds: readonly number[]): MapFeatures | undefined {
  const features = map.features;
  if (!features) return undefined;
  const explored = new Set(exploredTileIds);
  const known = (tiles: readonly number[]) => tiles.filter(tile => explored.has(tile));
  return { hills: known(features.hills), peaks: known(features.peaks), rivers: known(features.rivers), lakes: known(features.lakes), deep: known(features.deep),
    landmarks: features.landmarks.filter(site => explored.has(site.tileIndex)).map(site => ({ ...site })) };
}
