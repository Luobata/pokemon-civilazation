// Gameplay v24 B / C (docs/design/world-v24.md §3.1, §4.1): "can a land unit stand here / walk there" for gym placement and
// rival spawn tiles. Placement only ever asks these two questions through a predicate, so the A2 terrain rules (peaks,
// landmarks, embarking) can be swapped in at one place: `landRule`. Integer BFS, tile-index order, no RNG.
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize } from './hex.ts';
import type { BiomeId } from '../content/rules.ts';

/** May a land unit stand on this tile (and walk through it)? */
export type StandRule = (tileIndex: number) => boolean;

/** Today's map: every non-ocean tile. A2 replaces this with its passage rules (no peaks, no landmarks). */
export const landRule = (map: { tiles: readonly (BiomeId | null)[] }): StandRule => index => {
  const biome = map.tiles[index];
  return biome !== undefined && biome !== null && biome !== 'ocean';
};

/** Steps over `passable` tiles from `from` (which itself need not be passable, e.g. a city or a gym). */
export function routeDistances(map: GridSize, from: number, passable: StandRule): Map<number, number> {
  const distance = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let steps = 1; frontier.length; steps++) {
    const next: number[] = [];
    for (const index of frontier) for (const hex of neighbors(indexToHex(index, map), map)) {
      const tile = hexToIndex(hex, map);
      if (tile === null || distance.has(tile) || !passable(tile)) continue;
      distance.set(tile, steps);
      next.push(tile);
    }
    frontier = next.sort((a, b) => a - b);
  }
  return distance;
}
