import { START_DISTANCES } from '../content/rules.ts';
import type { BiomeId } from '../content/rules.ts';
import { edgeDistance, hexDistance, indexToHex } from './hex.ts';
import type { GridSize, Hex } from './hex.ts';
import { shuffled } from './rng.ts';
import type { RngState } from './rng.ts';
import type { MapFeatures } from './terrain.ts';

export type MapTerrain = GridSize & { tiles: BiomeId[]; features?: MapFeatures };
export type MapSetup = GridSize & { seed: number; playerCount: number };
export type MapState = MapTerrain & {
  generationVersion: 1;
  seed: number;
  rng: RngState;
  starts: { playerId: number; tileIndex: number }[];
  startDistance: (typeof START_DISTANCES)[number];
};

export function selectStarts(terrain: MapTerrain, playerCount: number, rng: RngState) {
  const candidates = shuffled(terrain.tiles.flatMap((biome, tileIndex) => {
    const hex = indexToHex(tileIndex, terrain);
    return (biome === 'grassland' || biome === 'forest') && edgeDistance(hex, terrain) >= 2
      ? [{ tileIndex, hex }] : [];
  }), rng);

  type Candidate = { tileIndex: number; hex: Hex };
  function search(remaining: Candidate[], needed: number, distance: number): Candidate[] | null {
    if (needed === 0) return [];
    for (let i = 0; i <= remaining.length - needed; i++) {
      const candidate = remaining[i];
      const compatible = remaining.slice(i + 1).filter(other => hexDistance(candidate.hex, other.hex, terrain) >= distance);
      if (compatible.length < needed - 1) continue;
      const tail = search(compatible, needed - 1, distance);
      if (tail) return [candidate, ...tail];
    }
    return null;
  }

  for (const distance of START_DISTANCES) {
    const selection = search(candidates, playerCount, distance);
    if (selection) return {
      starts: selection.map(({ tileIndex }, playerId) => ({ playerId, tileIndex })),
      startDistance: distance,
    };
  }
  throw new Error('No legal starting positions at distances 8, 6 or 4; choose another seed or map size.');
}
