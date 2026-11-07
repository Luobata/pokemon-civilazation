import { neighbors } from '../core/hex.ts';
import type { GridSize, Hex, MapShape } from '../core/hex.ts';

export const HEX_RADIUS = 22;
/** Pixel space is an unbounded plane: rounding never wraps (callers fold columns with canonicalHex). */
const PIXEL_PLANE = { width: 0 };
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export function hexToWorld(hex: Hex): Point {
  return { x: Math.sqrt(3) * HEX_RADIUS * (hex.q + hex.r / 2), y: HEX_RADIUS * 1.5 * hex.r };
}
export function worldToHex(point: Point): Hex {
  const r = point.y / (HEX_RADIUS * 1.5);
  const q = point.x / (Math.sqrt(3) * HEX_RADIUS) - r / 2;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const rounded = { q: rq, r: rr };
  // Resolve exact edges/vertices by r then q, independent of cube-round ties.
  return [rounded, ...neighbors(rounded, PIXEL_PLANE)].sort((a, b) => {
    const pa = hexToWorld(a), pb = hexToWorld(b);
    const difference = (pa.x - point.x) ** 2 + (pa.y - point.y) ** 2
      - (pb.x - point.x) ** 2 - (pb.y - point.y) ** 2;
    return Math.abs(difference) < 1e-7 ? a.r - b.r || a.q - b.q : difference;
  })[0];
}
/** World-space width of one copy of the map: shifting a tile by `width` columns (same row) moves it this far right. */
export function mapSpan(size: MapShape): number { return Math.sqrt(3) * HEX_RADIUS * size.width; }
/**
 * v22 wrapping maps are drawn as side-by-side copies. Screen-x shifts of every copy that may touch a
 * viewport `viewportWidth` pixels wide (`pad` px of overhang for badges and banners); `[0]` on a flat map.
 */
export function copyShifts(size: MapShape, camera: Camera, viewportWidth: number, pad: number): number[] {
  if (!size.wrap || !(size.width > 0)) return [0];
  const span = mapSpan(size) * camera.zoom;
  const first = Math.floor((-pad - camera.x) / span) - 1, last = Math.ceil((viewportWidth + pad - camera.x) / span);
  const shifts: number[] = [];
  for (let k = first; k <= last; k++) {
    const left = camera.x + k * span;
    if (left + span + pad >= 0 && left - pad <= viewportWidth) shifts.push(k * span);
  }
  return shifts;
}
/** A tile's screen point; on a wrapping map, the copy nearest the viewport centre (overlay anchors, tests). */
export function tileToScreen(hex: Hex, camera: Camera, size: MapShape, viewportWidth: number): Point {
  const point = toScreen(hexToWorld(hex), camera);
  if (!size.wrap || !(size.width > 0)) return point;
  const span = mapSpan(size) * camera.zoom;
  return { x: point.x + Math.round((viewportWidth / 2 - point.x) / span) * span, y: point.y };
}
export function toScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
export function toWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function fitCamera(size: GridSize, width: number, height: number): Camera {
  const mapWidth = Math.sqrt(3) * HEX_RADIUS * (size.width + 0.5);
  const mapHeight = HEX_RADIUS * (1.5 * (size.height - 1) + 2);
  const zoom = Math.min((width - 36) / mapWidth, (height - 36) / mapHeight);
  return { zoom, x: (width - mapWidth * zoom) / 2 + Math.sqrt(3) * HEX_RADIUS / 2 * zoom,
    y: (height - mapHeight * zoom) / 2 + HEX_RADIUS * zoom };
}
export function zoomAt(camera: Camera, point: Point, factor: number): void {
  const anchor = toWorld(point, camera);
  camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * factor));
  camera.x = point.x - anchor.x * camera.zoom;
  camera.y = point.y - anchor.y * camera.zoom;
}
