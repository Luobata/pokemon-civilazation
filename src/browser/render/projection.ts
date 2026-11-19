// ui-25d (docs/design/ui-25d.md): the 2.5D map projection. World space is squashed vertically by TILT_25D (camera.ts
// `setMapTilt`), and every tile stands at an elevation ("lift", in world pixels at HEX_RADIUS scale) taken from its biome and
// v24 features. Screen point of a tile = toScreen(hexToWorld(hex)) moved up by lift × zoom. Pure: no DOM, testable in Node.
import type { BiomeId } from '../../content/rules.ts';
import { hexToIndex } from '../../core/hex.ts';
import type { GridSize, Hex } from '../../core/hex.ts';
import { HEX_RADIUS, hexToWorld, mapTilt, setMapTilt, toScreen, toWorld, worldToHex } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import type { SceneTerrain } from './terrain-features.ts';

/** `painted`: the 绘卷 theme's map (ui-painted), a gentler tilt with no elevation. */
export type RenderMode = 'flat' | '25d' | 'painted';
/** Vertical squash of the 2.5D map: a hex is drawn 3/4 as tall as it is in the flat map (a camera tilted ~41° from straight down). */
export const TILT_25D = .75;
/** ui-painted: the painted map's gentler tilt (~37° from straight down); tiles stay at ground level. */
export const PAINTED_TILT = .8;
export const RENDER_MODE_KEY = 'pokeciv.renderMode';

/** `?render=25d` / `?render=flat` wins over the saved setting; the default stays flat until the 2.5D map is accepted. */
export function requestedRenderMode(search: string, stored: string | null): RenderMode {
  const param = new URLSearchParams(search).get('render');
  if (param === '25d' || param === '2.5d') return '25d';
  if (param === 'flat') return 'flat';
  return stored === '25d' ? '25d' : 'flat';
}
/** Sets the world tilt for a mode (the scene's world-centre cache is keyed by it). */
export function applyRenderMode(mode: RenderMode): void { setMapTilt(mode === '25d' ? TILT_25D : mode === 'painted' ? PAINTED_TILT : 1); }

/**
 * Elevation steps in world pixels (HEX_RADIUS = 22). Unexplored tiles sit lowest, so explored land rises out of the dark like a
 * diorama; water is one step below land; hills, mountains, volcanoes and peaks climb in steps. A column more than ~8.25 above the
 * tile behind it covers that tile's centre (row spacing 24.75 − top-face half height 16.5 at tilt 0.75), so the common steps
 * (water → land, land → hill, land → mountain) stay at 8 or less; only peaks and hills on high ground rise further.
 */
export const ELEVATION = { unknown: -16, water: -8, land: 0, snow: 2, mountain: 8, volcano: 8, hill: 6, peak: 14 } as const;
export function tileLift(biome: BiomeId | null, hill: boolean, peak: boolean): number {
  if (biome === null) return ELEVATION.unknown;
  if (biome === 'ocean') return ELEVATION.water;
  const base = biome === 'mountain' ? ELEVATION.mountain : biome === 'volcano' ? ELEVATION.volcano : biome === 'snow' ? ELEVATION.snow : ELEVATION.land;
  return base + (hill ? ELEVATION.hill : 0) + (peak ? ELEVATION.peak : 0);
}
/**
 * Size factor for standing props and towns: a little larger at the default zoom (≤ 1.5), where the relief would otherwise read
 * thin, easing back to the native size by zoom 2.6 (close-ups already show the pixel detail).
 */
export function propScale(radius: number): number {
  const zoom = radius / HEX_RADIUS;
  return 1 + .25 * Math.max(0, Math.min(1, (2.6 - zoom) / 1.1));
}
/** Height of one inland terrace step (world px). */
export const TERRACE = 3.5;
/** Offset-row neighbour of a tile index in HEX_DIRECTIONS order (odd rows shifted right), folded across the wrap; -1 off the map. */
export function neighbourIndexOf(size: GridSize, index: number, direction: number): number {
  const width = size.width, row = Math.floor(index / width), col = index % width, step = DIRECTIONS[direction];
  const nr = row + step.r;
  if (nr < 0 || nr >= size.height) return -1;
  let nc = col - Math.floor(row / 2) + step.q + Math.floor(nr / 2);
  if (nc < 0 || nc >= width) { if (!size.wrap) return -1; nc = ((nc % width) + width) % width; }
  return nr * width + nc;
}
/**
 * Inland terraces: known land rises one TERRACE step two tiles from the water and another four tiles in, so a continent reads
 * as a stepped plateau with contour cliffs even where every tile is level grassland. Distance is counted over known land from
 * known water (ocean, lakes); land with no known water in reach sits on the top step.
 */
export function terraceLevels(tiles: readonly { biome: BiomeId | null }[], size: GridSize): Uint8Array {
  const count = tiles.length, distance = new Int16Array(count).fill(-1), queue = new Int32Array(count);
  let head = 0, tail = 0;
  for (let index = 0; index < count; index++) if (tiles[index].biome === 'ocean') { distance[index] = 0; queue[tail++] = index; }
  while (head < tail) {
    const index = queue[head++];
    for (let direction = 0; direction < 6; direction++) {
      const other = neighbourIndexOf(size, index, direction);
      if (other < 0 || distance[other] >= 0 || !tiles[other].biome) continue;
      distance[other] = distance[index] + 1; queue[tail++] = other;
    }
  }
  const levels = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    if (!tiles[index].biome || tiles[index].biome === 'ocean') continue;
    const d = distance[index];
    levels[index] = d < 0 || d >= 4 ? 2 : d >= 2 ? 1 : 0;
  }
  return levels;
}
/** Per-tile lift for a scene's tiles (index order); with the map size, land also stands on its inland terrace. */
export function sceneLifts(tiles: readonly { biome: BiomeId | null }[], terrain?: SceneTerrain, size?: GridSize): Float32Array {
  const hills = new Set(terrain?.hills ?? []), peaks = new Set(terrain?.peaks ?? []);
  const lifts = new Float32Array(tiles.length), levels = size ? terraceLevels(tiles, size) : null;
  for (let index = 0; index < tiles.length; index++) lifts[index] = tileLift(tiles[index].biome, hills.has(index), peaks.has(index)) + (levels ? levels[index] * TERRACE : 0);
  return lifts;
}

/** HEX_DIRECTIONS order (E, NE, NW, W, SW, SE) as axial offsets, without wrapping (pixel plane). */
export const DIRECTIONS: readonly Hex[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
export const SW = 4, SE = 5;
/** Unit hex corners (pointy top, y down): corner k at angle 60k − 30°. Direction d's edge runs between EDGE_CORNERS[d]. */
export const CORNERS: readonly Point[] = Array.from({ length: 6 }, (_, k) => ({ x: Math.cos((k * 60 - 30) * Math.PI / 180), y: Math.sin((k * 60 - 30) * Math.PI / 180) }));
export const EDGE_CORNERS: readonly (readonly [number, number])[] = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

/** Lift of the neighbour in `direction` (off the map: the unexplored floor). */
export function neighbourLift(hex: Hex, direction: number, size: GridSize, lifts: ArrayLike<number>): number {
  const step = DIRECTIONS[direction], index = hexToIndex({ q: hex.q + step.q, r: hex.r + step.r }, size);
  return index === null ? ELEVATION.unknown : lifts[index];
}

/** Screen centre of a tile's top face for the current tilt. */
export function topCentre(hex: Hex, camera: Camera, lift: number): Point {
  const p = toScreen(hexToWorld(hex), camera);
  return { x: p.x, y: p.y - lift * camera.zoom };
}

/** Whether `point` lies on the drawn column of a tile: its squashed top face or its two front side faces (SW, SE). */
function onColumn(point: Point, centre: Point, radius: number, squash: number, sideSW: number, sideSE: number): boolean {
  const dx = (point.x - centre.x) / radius, dy = (point.y - centre.y) / (radius * squash);
  const half = Math.sqrt(3) / 2;
  if (Math.abs(dx) <= half && Math.abs(dy) <= 1 - Math.abs(dx) / Math.sqrt(3)) return true;
  if (Math.abs(dx) > half) return false;
  // The front edges run from the bottom vertex (0, 1) up to (±half, .5); a face hangs `side` px below its edge.
  const edgeY = centre.y + radius * squash * (1 - Math.abs(dx) / Math.sqrt(3));
  const side = dx < 0 ? sideSW : sideSE;
  return side > 0 && point.y >= edgeY && point.y <= edgeY + side;
}

/**
 * Screen → tile under the 2.5D projection: the frontmost tile (largest row, so drawn last) whose top face or front cliff contains
 * the point. Candidates are the flat inversion and its two rings (lifts never exceed a row and a half). Returns a pixel-plane hex
 * (callers fold it with hexToIndex, which also handles the east-west wrap); with no hit, the flat inversion.
 */
export function pickHex(point: Point, camera: Camera, size: GridSize, lifts: ArrayLike<number>): Hex {
  const naive = worldToHex(toWorld(point, camera));
  const squash = mapTilt(), radius = HEX_RADIUS * camera.zoom;
  const candidates: Hex[] = [];
  for (let dq = -2; dq <= 2; dq++) for (let dr = -1; dr <= 3; dr++) if (Math.abs(dq + dr) <= 3) candidates.push({ q: naive.q + dq, r: naive.r + dr });
  candidates.sort((a, b) => b.r - a.r || a.q - b.q);
  for (const hex of candidates) {
    const index = hexToIndex(hex, size);
    if (index === null) continue;
    const lift = lifts[index], centre = topCentre(hex, camera, lift);
    const side = (direction: number) => Math.max(0, lift - neighbourLift(hex, direction, size, lifts)) * camera.zoom;
    if (onColumn(point, centre, radius, squash, side(SW), side(SE))) return hex;
  }
  return naive;
}

/**
 * Lift (world px) under an arbitrary world point, blended between the nearest tile and its neighbours so animated units glide
 * over steps instead of jumping at the tile midpoint.
 */
export function liftAtWorld(world: Point, size: GridSize, lifts: ArrayLike<number>): number {
  const near = worldToHex(world), squash = mapTilt(), spacing = Math.sqrt(3) * HEX_RADIUS;
  let total = 0, weight = 0;
  for (const offset of [{ q: 0, r: 0 }, ...DIRECTIONS]) {
    const hex = { q: near.q + offset.q, r: near.r + offset.r }, index = hexToIndex(hex, size);
    if (index === null) continue;
    const centre = hexToWorld(hex), distance = Math.hypot(centre.x - world.x, (centre.y - world.y) / squash);
    const w = Math.max(0, 1 - distance / spacing);
    total += w * lifts[index]; weight += w;
  }
  return weight > 0 ? total / weight : 0;
}
