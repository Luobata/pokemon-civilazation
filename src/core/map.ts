import { BIOME_WEIGHTS, DEFAULT_MAP, MAP_GENERATION, START_DISTANCES } from '../content/rules.ts';
import type { BiomeId } from '../content/rules.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize, Hex } from './hex.ts';
import { createRng, randomBelow, shuffled } from './rng.ts';
import type { RngState } from './rng.ts';

export type MapTerrain = GridSize & { tiles: BiomeId[] };
export type MapSetup = GridSize & { seed: number; playerCount: number };
export type MapState = MapTerrain & {
  generationVersion: 1;
  seed: number;
  rng: RngState;
  starts: { playerId: number; tileIndex: number }[];
  startDistance: (typeof START_DISTANCES)[number];
};

// Exhaustive, ordered combination search: fallback means no solution at the
// stronger distance, not merely a failed greedy attempt. At most four players.
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

function volcanoCluster(size: GridSize, rng: RngState): Set<number> {
  const edge = Array.from({ length: size.width * size.height }, (_, i) => i)
    .filter(i => edgeDistance(indexToHex(i, size), size) === 0);
  const count = Math.min(edge.length, Math.floor(size.width * size.height * MAP_GENERATION.volcanoPercent / 100));
  const cluster = new Set<number>();
  if (count === 0) return cluster;
  const frontier = new Set([edge[randomBelow(rng, edge.length)]]);
  while (cluster.size < count && frontier.size > 0) {
    const choices = [...frontier].sort((a, b) => a - b);
    const index = choices[randomBelow(rng, choices.length)];
    frontier.delete(index);
    cluster.add(index);
    for (const hex of neighbors(indexToHex(index, size), size)) {
      const next = hexToIndex(hex, size);
      if (next !== null && edgeDistance(hex, size) === 0 && !cluster.has(next)) frontier.add(next);
    }
  }
  return cluster;
}

function drawBiome(rng: RngState): BiomeId {
  let roll = randomBelow(rng, 100);
  for (const { id, weight } of BIOME_WEIGHTS) {
    if (roll < weight) return id;
    roll -= weight;
  }
  throw new Error('Biome weights must sum to 100.');
}

/**
 * Wrapping maps (v22) have poles instead of east/west walls: the outermost north and south rows become snow
 * (ocean stays ocean), the next row in leans to snow (one draw per tile, index order). Volcanoes stay.
 */
function applyPoles(tiles: BiomeId[], size: GridSize, rng: RngState): void {
  for (let index = 0; index < tiles.length; index++) {
    const ring = edgeDistance(indexToHex(index, size), size);
    if (ring > 1 || tiles[index] === 'ocean' || tiles[index] === 'volcano') continue;
    if (ring === 0 || randomBelow(rng, 100) < MAP_GENERATION.polarSnowPercent) tiles[index] = 'snow';
  }
}

export function generateMap({ seed, width = DEFAULT_MAP.width, height = DEFAULT_MAP.height,
  playerCount = DEFAULT_MAP.playerCount, wrap }: Partial<MapSetup> & { seed: number }): MapState {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(width * height) || !Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new RangeError('Map dimensions must be positive integers; player count must be 2..4.');
  }
  const rng = createRng(seed);
  // v22 (world-v22 §A): columns wrap east-west, so only the north and south rows are map edges.
  const size: GridSize = wrap ? { width, height, wrap: true } : { width, height };
  const volcanoes = volcanoCluster(size, rng);
  const land = shuffled(Array.from({ length: width * height }, (_, i) => i)
    .filter(i => !volcanoes.has(i)), rng);
  const centerCount = Math.min(land.length, Math.max(BIOME_WEIGHTS.length,
    Math.floor(width * height / MAP_GENERATION.tilesPerCenter)));
  const centers = land.slice(0, centerCount).map((index, i) => ({
    hex: indexToHex(index, size),
    biome: i < BIOME_WEIGHTS.length ? BIOME_WEIGHTS[i].id : drawBiome(rng),
  }));
  const tiles = Array.from({ length: width * height }, (_, i): BiomeId => {
    if (volcanoes.has(i)) return 'volcano';
    const hex = indexToHex(i, size);
    let nearest = centers[0];
    let distance = hexDistance(hex, nearest.hex, size);
    for (const center of centers.slice(1)) {
      const next = hexDistance(hex, center.hex, size);
      if (next < distance) { nearest = center; distance = next; }
    }
    return nearest.biome;
  });
  if (wrap) applyPoles(tiles, size, rng);
  const terrain = { ...size, tiles };
  return { generationVersion: 1, seed, ...terrain, ...selectStarts(terrain, playerCount, rng), rng };
}
