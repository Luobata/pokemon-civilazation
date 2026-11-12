// Gameplay v24 B / C (docs/design/world-v24.md §3.1, §4.1): "can a land unit stand here / walk there" for gym placement and
// rival spawn tiles. Placement only ever asks these two questions through a predicate (`landRule`), which follows the A2 passage
// rules on v24 maps: no water, no peaks, no landmark tiles. Integer BFS / Dijkstra, tile-index order, no RNG.
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize } from './hex.ts';
import type { Content } from '../content/units.ts';
import { featureMoveExtra, worldSiteAllowed } from './terrain.ts';
import type { FeatureMap } from './terrain.ts';

/** May a land unit stand on this tile (and walk through it)? */
export type StandRule = (tileIndex: number) => boolean;

/** Every non-ocean tile; on v24 maps the A2 passage rules for a land walker: no peak, no landmark tile (`worldSiteAllowed`), no volcano. */
export const landRule = (map: FeatureMap): StandRule => index => {
  const biome = map.tiles[index];
  return biome !== undefined && biome !== null && biome !== 'ocean' && worldSiteAllowed(map, index, 'land') && !(map.features && biome === 'volcano');
};

function neighbourIndexes(map: GridSize, index: number): number[] {
  return neighbors(indexToHex(index, map), map).map(hex => hexToIndex(hex, map)).filter((tile): tile is number => tile !== null);
}

/** Steps over `passable` tiles from `from` (which itself need not be passable, e.g. a city or a gym). */
export function routeDistances(map: GridSize, from: number, passable: StandRule): Map<number, number> {
  const distance = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let steps = 1; frontier.length; steps++) {
    const next: number[] = [];
    for (const index of frontier) for (const tile of neighbourIndexes(map, index)) {
      if (distance.has(tile) || !passable(tile)) continue;
      distance.set(tile, steps);
      next.push(tile);
    }
    frontier = next.sort((a, b) => a - b);
  }
  return distance;
}

const WALKER = { kind: 'logistics', role: 'settler' } as const;
/**
 * Land travel cost from `from` over `passable` tiles: the biome's move cost plus hills and river crossings (the A2 movement rules for
 * a land walker). Before v24 (no features) every step costs the biome's move cost. Dial's bucket queue, deterministic.
 */
export function routeCosts(map: FeatureMap, from: number, passable: StandRule, content: Content): Map<number, number> {
  const cost = new Map<number, number>([[from, 0]]), buckets: number[][] = [[from]];
  for (let d = 0; d < buckets.length; d++) {
    for (const index of (buckets[d] ?? []).sort((a, b) => a - b)) {
      if (cost.get(index) !== d) continue;
      for (const tile of neighbourIndexes(map, index)) {
        if (!passable(tile)) continue;
        const next = d + content.moveCosts[map.tiles[tile]!] + featureMoveExtra(map, index, tile, WALKER, content);
        if (next < (cost.get(tile) ?? Infinity)) { cost.set(tile, next); (buckets[next] ??= []).push(tile); }
      }
    }
  }
  return cost;
}
