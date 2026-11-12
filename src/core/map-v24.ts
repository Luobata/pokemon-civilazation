// Gameplay v24 A1 (docs/design/world-v24.md §2.1, §2.4): continents, islands and island chains, lakes, ridges and peaks, climate bands,
// hills, rivers and fair starts. Integer-only and deterministic from the map seed (one xorshift stream, every choice over index-sorted
// lists); wrap-aware (columns wrap east-west). Distance questions are answered with BFS fields and precomputed neighbour / disk tables,
// so a 56×36 map takes a few tens of milliseconds. Called by createGame only when `content.terrain`; `generateMap` is untouched.
import { CLIMATE_BANDS_V24, LANDMARKS, LANDMARK_IDS, LANDMARK_RULES_V24, MAP_GENERATION_V24, START_TILE_VALUES_V24 } from '../content/terrain.ts';
import type { LandmarkId, LandmarkSite } from '../content/terrain.ts';
import { stableSeed } from './civilization-systems.ts';
import { DEFAULT_MAP, START_DISTANCES } from '../content/rules.ts';
import type { BiomeId } from '../content/rules.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { GridSize } from './hex.ts';
import { createRng, randomBelow, shuffled } from './rng.ts';
import type { RngState } from './rng.ts';
import { selectStarts } from './map.ts';
import type { MapSetup, MapState } from './map.ts';
import type { MapFeatures } from './terrain.ts';

const P = MAP_GENERATION_V24;
const WATER = -1;
/** Index of the continent (0…C−1), C for islands and island-chain islets, WATER for sea and lakes. */
type World = {
  size: GridSize; n: number; width: number; height: number; rng: RngState;
  nbr: Int32Array; adj: number[][]; owner: Int32Array; lake: Uint8Array;
};
const row = (w: World, i: number) => Math.floor(i / w.width);
const isLand = (w: World, i: number) => w.owner[i] !== WATER;
/** The neighbours of tile i (HEX_DIRECTIONS order, wrap-aware, off-map rows dropped). */
const around = (w: World, i: number): readonly number[] => w.adj[i];
/** Tiles within `radius` of tile i (excluding i), wrap-aware; offsets are precomputed once per radius. */
function diskOffsets(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let dr = -radius; dr <= radius; dr++) for (let dq = -radius; dq <= radius; dq++) {
    if ((dq || dr) && Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= radius) out.push({ q: dq, r: dr });
  }
  return out;
}
function disk(w: World, i: number, offsets: readonly { q: number; r: number }[]): number[] {
  const hex = indexToHex(i, w.size), out: number[] = [];
  for (const o of offsets) { const j = hexToIndex({ q: hex.q + o.q, r: hex.r + o.r }, w.size); if (j !== null && j !== i) out.push(j); }
  return out;
}
/** Multi-source BFS distance (in steps) from every tile where `source` holds, through every tile. */
function bfs(w: World, source: (i: number) => boolean, through: (i: number) => boolean = () => true): Int32Array {
  const dist = new Int32Array(w.n).fill(1 << 20), queue: number[] = [];
  for (let i = 0; i < w.n; i++) if (source(i)) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const j of around(w, at)) if (dist[j] > dist[at] + 1 && through(j)) { dist[j] = dist[at] + 1; queue.push(j); }
  }
  return dist;
}
const isqrt = (value: number) => { let r = Math.floor(Math.sqrt(value)); while (r * r > value) r--; while ((r + 1) * (r + 1) <= value) r++; return r; };
function weightedPick(w: World, list: readonly number[], weight: (i: number) => number): number {
  let total = 0;
  for (const i of list) total += weight(i);
  let roll = randomBelow(w.rng, total);
  for (const i of list) { const value = weight(i); if (roll < value) return i; roll -= value; }
  return list[list.length - 1];
}

/** §2.1 steps 1–3: continents grown round-robin from centres in the middle latitudes, islands, then shallow island chains. */
function shapeLand(w: World, playerCount: number): { continents: number; civsOn: number[] } {
  const C = Math.ceil(playerCount / 2);
  const civsOn = Array.from({ length: C }, (_, c) => Math.floor(playerCount / C) + (c < playerCount % C ? 1 : 0));
  const landTarget = Math.floor(w.n * P.landPercent / 100), islandTarget = Math.floor(landTarget * P.islandPercent / 100);
  const allowedRow = (i: number) => row(w, i) >= P.poleRows && row(w, i) < w.height - P.poleRows;
  const offset = randomBelow(w.rng, w.width), middle = Math.floor(w.height / 2);
  const centers = civsOn.map((_, c) => {
    const col = (offset + Math.floor(c * w.width / C) + randomBelow(w.rng, 5)) % w.width;
    const r = Math.min(w.height - 1 - P.poleRows, Math.max(P.poleRows, middle - 2 + randomBelow(w.rng, 5)));
    return r * w.width + col;
  });
  const targets = civsOn.map(count => Math.floor((landTarget - islandTarget) * count / playerCount));
  // Weight: nearer the centre and nearer its row grows first (continents come out wider than tall). Precomputed per continent.
  const weights = centers.map((center, c) => {
    const reach = 2 * isqrt(Math.floor(targets[c] / 3)) + 6, centreHex = indexToHex(center, w.size), out = new Int32Array(w.n);
    for (let i = 0; i < w.n; i++) out[i] = Math.max(1, reach - hexDistance(indexToHex(i, w.size), centreHex, w.size) - Math.abs(row(w, i) - row(w, center)));
    return out;
  });
  const gapOffsets = diskOffsets(P.continentGap);
  const near = new Int32Array(w.n); // bit c: within continentGap of continent c's land
  const claim = (i: number, c: number) => { w.owner[i] = c; near[i] |= 1 << c; for (const j of disk(w, i, gapOffsets)) near[j] |= 1 << c; };
  // Frontier per continent: a membership set plus the same tiles kept in index order (the weighted pick walks them in order).
  const frontier = centers.map(center => ({ has: new Set([center]), order: [center] }));
  const addFrontier = (c: number, i: number) => {
    const f = frontier[c];
    if (f.has.has(i)) return;
    f.has.add(i);
    let lo = 0, hi = f.order.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (f.order[mid] < i) lo = mid + 1; else hi = mid; }
    f.order.splice(lo, 0, i);
  };
  const sizes = new Array<number>(C).fill(0);
  for (let progress = true; progress;) {
    progress = false;
    for (let c = 0; c < C; c++) {
      if (sizes[c] >= targets[c] || !frontier[c].order.length) continue;
      progress = true;
      const pick = weightedPick(w, frontier[c].order, i => weights[c][i]);
      frontier[c].has.delete(pick); frontier[c].order.splice(frontier[c].order.indexOf(pick), 1);
      if (isLand(w, pick) || !allowedRow(pick) || (near[pick] & ~(1 << c)) !== 0) continue;
      claim(pick, c); sizes[c]++;
      for (const j of around(w, pick)) if (!isLand(w, j)) addFrontier(c, j);
    }
  }
  // Islands: 2–5 tiles, every tile at least islandGap from continental land.
  const continentDistance = bfs(w, i => isLand(w, i));
  let islandLand = 0;
  for (let guard = 0; islandLand < islandTarget && guard < 600; guard++) {
    const seed = randomBelow(w.rng, w.n);
    const fits = (i: number) => !isLand(w, i) && allowedRow(i) && continentDistance[i] >= P.islandGap;
    if (!fits(seed)) continue;
    const want = P.islandSize[0] + randomBelow(w.rng, P.islandSize[1] - P.islandSize[0] + 1), blob = [seed];
    w.owner[seed] = C; islandLand++;
    for (let k = 1; k < want; k++) {
      const options = [...new Set(blob.flatMap(i => around(w, i)))].filter(fits).sort((a, b) => a - b);
      if (!options.length) break;
      const next = options[randomBelow(w.rng, options.length)];
      w.owner[next] = C; blob.push(next); islandLand++;
    }
  }
  // Fill one-tile holes inside a single continent.
  for (let i = 0; i < w.n; i++) if (!isLand(w, i)) {
    const owners = around(w, i).map(j => w.owner[j]);
    if (owners.length === 6 && owners.every(o => o === owners[0] && o !== WATER && o < C)) w.owner[i] = owners[0];
  }
  linkContinents(w, C, allowedRow);
  return { continents: C, civsOn };
}
/** §2.1 step 3: until every continent is reachable over land and shallow water, drop a one-tile islet every third tile of the shortest sea path. */
function linkContinents(w: World, C: number, allowedRow: (i: number) => boolean): void {
  const firstOf = (c: number) => { for (let i = 0; i < w.n; i++) if (w.owner[i] === c) return i; return -1; };
  for (let attempt = 0; attempt < C; attempt++) {
    const coast = (i: number) => !isLand(w, i) && !w.lake[i] && around(w, i).some(j => isLand(w, j));
    const origin = firstOf(0);
    const reach = bfs(w, i => i === origin, i => isLand(w, i) || coast(i));
    const missing = Array.from({ length: C }, (_, c) => c).find(c => reach[firstOf(c)] >= 1 << 20);
    if (missing === undefined) return;
    // BFS over open water from everything already connected to continent 0 until continent `missing`.
    const previous = new Int32Array(w.n).fill(-2), queue: number[] = [];
    for (let i = 0; i < w.n; i++) if (reach[i] < 1 << 20 && isLand(w, i)) { previous[i] = -1; queue.push(i); }
    let hit = -1;
    for (let head = 0; head < queue.length && hit < 0; head++) for (const j of around(w, queue[head])) {
      if (previous[j] !== -2 || !allowedRow(j)) continue;
      previous[j] = queue[head];
      if (w.owner[j] === missing) { hit = j; break; }
      if (!isLand(w, j)) queue.push(j);
    }
    if (hit < 0) return;
    const path: number[] = [];
    for (let at = previous[hit]; at >= 0 && !isLand(w, at); at = previous[at]) path.push(at);
    for (let k = 1; k < path.length - 1; k += P.islandLinkStep) w.owner[path[k]] = C;
  }
}

type Relief = { ridge: Uint8Array; peak: Uint8Array; hill: Uint8Array; river: Uint8Array; tiles: BiomeId[] };
/** §2.1 steps 4–9: lakes, ridges and peaks, climate, volcanoes, hills, rivers. */
function shapeRelief(w: World, C: number): Relief {
  const landOf = (c: number) => { const out: number[] = []; for (let i = 0; i < w.n; i++) if (w.owner[i] === c) out.push(i); return out; };
  // 4. Lakes: one per continent, deep inland.
  let water = bfs(w, i => !isLand(w, i));
  for (let c = 0; c < C; c++) for (let k = 0; k < P.lakesPerContinent; k++) {
    const options = landOf(c).filter(i => water[i] >= P.lakeCoastDistance);
    if (!options.length) continue;
    const at = options[randomBelow(w.rng, options.length)];
    w.lake[at] = 1; w.owner[at] = WATER;
    const second = around(w, at).filter(j => w.owner[j] === c && water[j] >= P.lakeCoastDistance - 1).sort((a, b) => a - b);
    if (second.length && randomBelow(w.rng, 2)) { const j = second[randomBelow(w.rng, second.length)]; w.lake[j] = 1; w.owner[j] = WATER; }
  }
  water = bfs(w, i => !isLand(w, i));
  // 5. Ridges: a random walk per 45 land tiles of each continent; peaks on inland ridge tiles that do not split their continent.
  const ridge = new Uint8Array(w.n), peak = new Uint8Array(w.n);
  for (let c = 0; c < C; c++) {
    const own = landOf(c);
    if (!own.length) continue;
    const count = Math.max(1, Math.floor(own.length / P.ridgeLandTilesPer));
    for (let k = 0; k < count; k++) {
      let at = own[randomBelow(w.rng, own.length)], direction = randomBelow(w.rng, 6);
      const length = P.ridgeLength[0] + randomBelow(w.rng, P.ridgeLength[1] - P.ridgeLength[0] + 1);
      for (let s = 0; s < length; s++) {
        ridge[at] = 1;
        if (randomBelow(w.rng, 100) < P.ridgeTurnPercent) direction = (direction + (randomBelow(w.rng, 2) ? 1 : 5)) % 6;
        const next = w.nbr[at * 6 + direction];
        if (next < 0 || w.owner[next] !== c) break;
        at = next;
      }
    }
  }
  const connectedWithout = (c: number) => {
    const own = landOf(c).filter(i => !peak[i]);
    if (!own.length) return true;
    const seen = new Uint8Array(w.n), stack = [own[0]]; seen[own[0]] = 1; let count = 1;
    while (stack.length) { const at = stack.pop()!; for (const j of around(w, at)) if (!seen[j] && w.owner[j] === c && !peak[j]) { seen[j] = 1; count++; stack.push(j); } }
    return count === own.length;
  };
  for (let i = 0; i < w.n; i++) {
    if (!ridge[i] || w.owner[i] >= C || randomBelow(w.rng, 100) >= P.peakPercent || water[i] < P.peakMinCoastDistance) continue;
    peak[i] = 1;
    if (!connectedWithout(w.owner[i])) peak[i] = 0;
  }
  // 6. Climate: latitude band × interpolated moisture (+ coastal bonus).
  const [cellW, cellH] = P.moistureCell;
  const gx = Math.max(1, Math.ceil(w.width / cellW)), gy = Math.max(2, Math.ceil(w.height / cellH) + 1);
  const grid = Array.from({ length: gx * gy }, () => randomBelow(w.rng, 1000));
  const moisture = (i: number) => {
    const col = i % w.width, r = row(w, i), tx = col * gx, ty = r * (gy - 1), dx = w.width, dy = Math.max(1, w.height - 1);
    const x0 = Math.floor(tx / dx), fx = tx % dx, y0 = Math.min(gy - 2, Math.floor(ty / dy)), fy = ty - y0 * dy;
    const g = (x: number, y: number) => grid[y * gx + (x % gx)];
    const top = g(x0, y0) * (dx - fx) + g(x0 + 1, y0) * fx, bottom = g(x0, y0 + 1) * (dx - fx) + g(x0 + 1, y0 + 1) * fx;
    return Math.floor((top * (dy - fy) + bottom * fy) / (dx * dy)) + (water[i] <= P.coastalMoistureRange ? P.coastalMoisture : 0);
  };
  const latitude = (i: number) => Math.floor(Math.abs(2 * row(w, i) - (w.height - 1)) * 1000 / Math.max(1, w.height - 1));
  const tiles: BiomeId[] = new Array<BiomeId>(w.n).fill('ocean');
  for (let i = 0; i < w.n; i++) {
    if (!isLand(w, i)) continue;
    if (ridge[i]) { tiles[i] = 'mountain'; continue; }
    const lat = latitude(i), wet = moisture(i), band = CLIMATE_BANDS_V24.find(item => lat < item.maxLatitude)!;
    tiles[i] = wet >= band.forestAt ? 'forest' : band.desertBelow !== undefined && wet < band.desertBelow ? 'desert' : band.dry;
  }
  // 7. Volcanoes on coastal ridge tiles (about 1% of the land, at most 8).
  const land = (() => { let count = 0; for (let i = 0; i < w.n; i++) if (isLand(w, i)) count++; return count; })();
  const vents = Array.from({ length: w.n }, (_, i) => i).filter(i => ridge[i] && !peak[i] && water[i] <= 2);
  for (const i of shuffled(vents, w.rng).slice(0, Math.min(P.volcanoTiles, Math.floor(land / P.volcanoLandPer)))) tiles[i] = 'volcano';
  // 8. Hills: beside ridges first, then random clusters up to hillPercent of the flat land.
  const hill = new Uint8Array(w.n);
  const flat = Array.from({ length: w.n }, (_, i) => i).filter(i => isLand(w, i) && tiles[i] !== 'mountain' && tiles[i] !== 'volcano');
  const flatSet = new Uint8Array(w.n); for (const i of flat) flatSet[i] = 1;
  for (const i of flat) if (around(w, i).some(j => ridge[j]) && randomBelow(w.rng, 100) < P.ridgeHillPercent) hill[i] = 1;
  let hills = flat.filter(i => hill[i]).length;
  const hillTarget = Math.floor(flat.length * P.hillPercent / 100);
  for (let guard = 0; hills < hillTarget && guard < 4 * w.n; guard++) {
    const i = flat[randomBelow(w.rng, flat.length)];
    if (hill[i]) continue;
    hill[i] = 1; hills++;
    const next = around(w, i).filter(j => flatSet[j] && !hill[j]).sort((a, b) => a - b);
    if (next.length && hills < hillTarget && randomBelow(w.rng, 2)) { hill[next[randomBelow(w.rng, next.length)]] = 1; hills++; }
  }
  // 9. Rivers: from inland highland down the distance-to-water gradient to the sea or a lake, joining earlier rivers.
  const river = new Uint8Array(w.n);
  for (let c = 0; c < C; c++) {
    const own = landOf(c), want = Math.max(1, Math.floor(own.length / P.riverLandTilesPer));
    const open = (i: number) => !peak[i] && tiles[i] !== 'volcano';
    let made = 0;
    // Pass 1: inland highland, rivers of at least riverMinLength. Pass 2 (only a continent still without a river, e.g. on small
    // maps where nothing lies three tiles from the sea): any land two tiles inland, a short river of two tiles.
    for (const [sourceDistance, minLength, highlandOnly] of [[P.riverSourceCoastDistance, P.riverMinLength, true], [2, 2, false]] as const) {
      if (made > 0 && !highlandOnly) break;
      const sources = shuffled(own.filter(i => water[i] >= sourceDistance && open(i) && (!highlandOnly || tiles[i] === 'mountain' || hill[i])), w.rng);
      for (const source of sources) {
        if (made >= want) break;
        if (river[source]) continue;
        const path = [source];
        let at = source;
        while (water[at] > 1 && !river[at]) {
          const down = around(w, at).filter(j => water[j] === water[at] - 1 && open(j)).sort((a, b) => a - b);
          if (!down.length) break;
          at = down[randomBelow(w.rng, down.length)];
          path.push(at);
        }
        if (path.length < minLength || (water[at] > 1 && !river[at])) continue;
        for (const i of path) river[i] = 1;
        made++;
      }
    }
  }
  return { ridge, peak, hill, river, tiles };
}

type Candidate = { tile: number; quality: number };
/** §2.4 fair starts: per continent, groups of starts with the smallest quality spread (then the highest minimum). */
function chooseStarts(w: World, relief: Relief, civsOn: readonly number[]): { tiles: number[]; distance: 8 | 6 | 4 } | null {
  const { tiles, hill, river, peak } = relief;
  const shallowTile = new Uint8Array(w.n);
  for (let i = 0; i < w.n; i++) shallowTile[i] = tiles[i] === 'ocean' && (w.lake[i] === 1 || around(w, i).some(j => tiles[j] !== 'ocean')) ? 1 : 0;
  const shallow = (i: number) => shallowTile[i] === 1;
  const usable = (i: number) => tiles[i] !== 'ocean' && !peak[i] && tiles[i] !== 'volcano';
  const coast = bfs(w, i => tiles[i] === 'ocean' && !w.lake[i] && shallow(i));
  const value = (i: number) => {
    if (peak[i]) return 0;
    const v = START_TILE_VALUES_V24;
    const biome = tiles[i];
    const base = biome === 'ocean' ? (shallow(i) ? v.shallow : v.deep) : v[biome];
    return base + (hill[i] ? v.hill : 0) + (river[i] ? v.river : 0);
  };
  const ring2 = diskOffsets(2), ring3 = diskOffsets(3);
  const latitude = (i: number) => Math.floor(Math.abs(2 * row(w, i) - (w.height - 1)) * 1000 / Math.max(1, w.height - 1));
  const base = Array.from({ length: w.n }, (_, i) => i).filter(i => isLand(w, i) && w.owner[i] < civsOn.length
    && (tiles[i] === 'grassland' || tiles[i] === 'forest') && latitude(i) < P.startMaxLatitude && coast[i] <= P.startCoastRadius);
  const usableNear = new Map(base.map(i => [i, disk(w, i, ring3).filter(usable).length]));
  const quality = new Map(base.map(i => [i, disk(w, i, ring2).reduce((sum, j) => sum + value(j), 0)]));
  const tiers: [number, number][] = [];
  for (const minLand of P.startMinUsableLand) for (const distance of P.startMinDistance) tiers.push([minLand, distance]);
  tiers.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  for (const [minLand, distance] of tiers) {
    const groups = civsOn.map((count, c) => {
      const pool: Candidate[] = base.filter(i => w.owner[i] === c && usableNear.get(i)! >= minLand).map(tile => ({ tile, quality: quality.get(tile)! }))
        .sort((a, b) => b.quality - a.quality || a.tile - b.tile).slice(0, P.startCandidates);
      const out: { tiles: number[]; lo: number; hi: number }[] = [];
      if (count === 1) for (const a of pool) out.push({ tiles: [a.tile], lo: a.quality, hi: a.quality });
      else for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) {
        const a = pool[x], b = pool[y];
        if (hexDistance(indexToHex(a.tile, w.size), indexToHex(b.tile, w.size), w.size) >= distance) {
          out.push({ tiles: [a.tile, b.tile], lo: Math.min(a.quality, b.quality), hi: Math.max(a.quality, b.quality) });
        }
      }
      return out;
    });
    if (groups.some(group => !group.length)) continue;
    // Smallest spread (hi − lo), then the highest minimum; the first such combination in list order wins.
    let bestSpread = Infinity, bestLo = -Infinity, bestTiles: number[] = [];
    const second = groups[1] ?? [{ tiles: [], lo: Infinity, hi: -Infinity }];
    for (const g of groups[0]) for (const h of second) {
      const lo = Math.min(g.lo, h.lo), hi = Math.max(g.hi, h.hi);
      if (hi - lo < bestSpread || (hi - lo === bestSpread && lo > bestLo)) { bestSpread = hi - lo; bestLo = lo; bestTiles = [...g.tiles, ...h.tiles]; }
    }
    if (bestTiles.length) return { tiles: bestTiles, distance: (START_DISTANCES.includes(distance as 8 | 6 | 4) ? distance : 4) as 8 | 6 | 4 };
  }
  return null;
}

/** §2.5: one landmark per 110 land tiles, ≥ 4 from starts and ≥ 6 apart, each kind at most once, on tiles that already have its terrain. */
function placeLandmarks(w: World, relief: Relief, C: number, seed: number, starts: readonly number[]): { tileIndex: number; id: LandmarkId }[] {
  const { tiles, hill, river, peak } = relief;
  let land = 0;
  for (let i = 0; i < w.n; i++) if (tiles[i] !== 'ocean') land++;
  const count = Math.floor(land / P.landTilesPerLandmark);
  const placed: { tileIndex: number; id: LandmarkId }[] = [];
  const blocked = new Uint8Array(w.n);
  const hexOf = (i: number) => indexToHex(i, w.size);
  const continental = (i: number) => w.owner[i] >= 0 && w.owner[i] < C;
  const seaside = (i: number) => around(w, i).some(j => tiles[j] === 'ocean' && !w.lake[j]);
  const fits: Record<LandmarkSite, (i: number) => boolean> = {
    desert: i => tiles[i] === 'desert' && !hill[i], lake: i => w.lake[i] === 1, forest: i => tiles[i] === 'forest' && !hill[i],
    grasslandHill: i => tiles[i] === 'grassland' && hill[i] === 1, mountain: i => tiles[i] === 'mountain' && !peak[i] && !seaside(i),
    coastalMountain: i => tiles[i] === 'mountain' && !peak[i] && seaside(i), snow: i => tiles[i] === 'snow' && !hill[i], volcano: i => tiles[i] === 'volcano',
  };
  // A land landmark must not split its continent (walkable land = not peak, not landmark).
  const keepsConnected = (i: number) => {
    const c = w.owner[i], open = (j: number) => w.owner[j] === c && !peak[j] && !blocked[j] && j !== i;
    const start = around(w, i).find(open);
    if (start === undefined) return true;
    let total = 0;
    for (let j = 0; j < w.n; j++) if (open(j)) total++;
    const seen = new Uint8Array(w.n), stack = [start]; seen[start] = 1; let reached = 1;
    while (stack.length) { const at = stack.pop()!; for (const j of around(w, at)) if (!seen[j] && open(j)) { seen[j] = 1; reached++; stack.push(j); } }
    return reached === total;
  };
  const kinds = [...LANDMARK_IDS].sort((a, b) => stableSeed(seed, a, 'landmark') - stableSeed(seed, b, 'landmark') || (a < b ? -1 : 1));
  for (const id of kinds) {
    if (placed.length >= count) break;
    const site = LANDMARKS[id].site;
    const order = Array.from({ length: w.n }, (_, i) => i).filter(i => fits[site](i) && !river[i] && (site === 'lake' || continental(i)))
      .sort((a, b) => stableSeed(seed, id, a, 'landmark-site') - stableSeed(seed, id, b, 'landmark-site') || a - b);
    const tile = order.find(i => starts.every(start => hexDistance(hexOf(start), hexOf(i), w.size) >= LANDMARK_RULES_V24.minStartDistance)
      && placed.every(other => hexDistance(hexOf(other.tileIndex), hexOf(i), w.size) >= LANDMARK_RULES_V24.spacing)
      && (site === 'lake' || keepsConnected(i)));
    if (tile === undefined) continue;
    blocked[tile] = 1;
    placed.push({ tileIndex: tile, id });
  }
  return placed.sort((a, b) => a.tileIndex - b.tileIndex);
}

export function generateWorldMap({ seed, width = DEFAULT_MAP.width, height = DEFAULT_MAP.height,
  playerCount = DEFAULT_MAP.playerCount }: Partial<MapSetup> & { seed: number }): MapState {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(width * height) || !Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) {
    throw new RangeError('Map dimensions must be positive integers; player count must be 2..4.');
  }
  const size: GridSize = { width, height, wrap: true }, n = width * height;
  const nbr = new Int32Array(n * 6).fill(-1), adj: number[][] = [];
  for (let i = 0; i < n; i++) {
    neighbors(indexToHex(i, size), size).forEach((hex, k) => { nbr[i * 6 + k] = hexToIndex(hex, size) ?? -1; });
    adj.push(Array.from(nbr.subarray(i * 6, i * 6 + 6)).filter(j => j >= 0));
  }
  const w: World = { size, n, width, height, rng: createRng(seed), nbr, adj, owner: new Int32Array(n).fill(WATER), lake: new Uint8Array(n) };
  const { continents, civsOn } = shapeLand(w, playerCount);
  const relief = shapeRelief(w, continents);
  const { tiles } = relief;
  const deep: number[] = [];
  for (let i = 0; i < n; i++) {
    if (tiles[i] !== 'ocean' || w.lake[i]) continue;
    const polar = row(w, i) === 0 || row(w, i) === height - 1;
    if (polar || !around(w, i).some(j => tiles[j] !== 'ocean')) deep.push(i);
  }
  const list = (bits: Uint8Array) => { const out: number[] = []; for (let i = 0; i < n; i++) if (bits[i]) out.push(i); return out; };
  const features: MapFeatures = { hills: list(relief.hill), peaks: list(relief.peak), rivers: list(relief.river), lakes: list(w.lake), deep, landmarks: [] };
  const chosen = chooseStarts(w, relief, civsOn);
  const terrain = { ...size, tiles };
  // A degenerate map (tiny sizes) falls back to the v23 start search on the same terrain, so createGame never fails on a legal size.
  const placed = chosen
    ? { starts: shuffled(chosen.tiles, w.rng).map((tileIndex, playerId) => ({ playerId, tileIndex })), startDistance: chosen.distance }
    : selectStarts(terrain, playerCount, w.rng);
  // §2.5 landmarks: after the starts, from stableSeed orders (no draws from the map stream).
  features.landmarks = placeLandmarks(w, relief, continents, seed, placed.starts.map(start => start.tileIndex));
  return { generationVersion: 1, seed, ...terrain, features, ...placed, rng: w.rng };
}
