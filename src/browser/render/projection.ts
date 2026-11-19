// ui-25d (docs/design/ui-25d.md): the 2.5D map projection. World space is squashed vertically by TILT_25D (camera.ts
// `setMapTilt`), and every tile stands at an elevation ("lift", in world pixels at HEX_RADIUS scale) taken from its biome and
// v24 features. Screen point of a tile = toScreen(hexToWorld(hex)) moved up by lift × zoom. Pure: no DOM, testable in Node.
import type { BiomeId } from '../../content/rules.ts';
import { hexToIndex } from '../../core/hex.ts';
import type { GridSize, Hex } from '../../core/hex.ts';
import { HEX_RADIUS, hexToWorld, mapTilt, setMapTilt, toScreen, toWorld, worldToHex } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import type { SceneTerrain } from './terrain-features.ts';

export type RenderMode = 'flat' | '25d';
/** Vertical squash of the 2.5D map: a hex is drawn 3/4 as tall as it is in the flat map (a camera tilted ~41° from straight down). */
export const TILT_25D = .75;
export const RENDER_MODE_KEY = 'pokeciv.renderMode';

/** `?render=25d` / `?render=flat` wins over the saved setting; the default stays flat until the 2.5D map is accepted. */
export function requestedRenderMode(search: string, stored: string | null): RenderMode {
  const param = new URLSearchParams(search).get('render');
  if (param === '25d' || param === '2.5d') return '25d';
  if (param === 'flat') return 'flat';
  return stored === '25d' ? '25d' : 'flat';
}
/** Sets the world tilt for a mode (the scene's world-centre cache is keyed by it). */
export function applyRenderMode(mode: RenderMode): void { setMapTilt(mode === '25d' ? TILT_25D : 1); }

/**
 * Elevation steps in world pixels (HEX_RADIUS = 22). Unexplored tiles sit lowest, so explored land rises out of the dark like a
 * diorama; water is one step below land; hills, mountains, volcanoes and peaks climb in steps.
 */
export const ELEVATION = { unknown: -12, water: -6, land: 0, snow: 2, mountain: 8, volcano: 8, hill: 5, peak: 10 } as const;
export function tileLift(biome: BiomeId | null, hill: boolean, peak: boolean): number {
  if (biome === null) return ELEVATION.unknown;
  if (biome === 'ocean') return ELEVATION.water;
  const base = biome === 'mountain' ? ELEVATION.mountain : biome === 'volcano' ? ELEVATION.volcano : biome === 'snow' ? ELEVATION.snow : ELEVATION.land;
  return base + (hill ? ELEVATION.hill : 0) + (peak ? ELEVATION.peak : 0);
}
/** Per-tile lift for a scene's tiles (index order). */
export function sceneLifts(tiles: readonly { biome: BiomeId | null }[], terrain?: SceneTerrain): Float32Array {
  const hills = new Set(terrain?.hills ?? []), peaks = new Set(terrain?.peaks ?? []);
  const lifts = new Float32Array(tiles.length);
  for (let index = 0; index < tiles.length; index++) lifts[index] = tileLift(tiles[index].biome, hills.has(index), peaks.has(index));
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
