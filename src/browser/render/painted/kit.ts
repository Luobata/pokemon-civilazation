// ui-painted (docs/design/ui-painted.md): shared helpers for the painted theme's offscreen art — seeded noise, colour mixing,
// soft dabs and strokes, hex paths and the size buckets every sprite cache is keyed by. Everything here runs while a sprite is
// baked (never per frame), so gradients are fine; no `filter` and no `shadowBlur` anywhere.
import type { Point } from '../../camera.ts';
import { FONT_DISPLAY } from '../../theme.ts';

export function noise(seed: number, index: number): number {
  let value = Math.imul(seed + index * 374761393, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}
/** A seeded random stream (each call advances). */
export function stream(seed: number): () => number {
  let index = 0;
  return () => noise(seed, index++);
}

const parse = (hex: string): [number, number, number] => {
  const value = parseInt(hex.slice(1, 7), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
};
const toHex = (rgb: readonly number[]) => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Linear mix of two #rrggbb colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a), y = parse(b);
  return toHex(x.map((v, k) => v + (y[k] - v) * t));
}
export const lighten = (color: string, t: number) => mix(color, '#FFF8E8', t);
export const darken = (color: string, t: number) => mix(color, '#120C08', t);
/** #rrggbb plus an alpha 0..1 as rgba(). */
export function alpha(color: string, a: number): string {
  const [r, g, b] = parse(color);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width)); canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/** Pointy-top hex outline (corner k at 60k − 30°), squashed vertically. Starts a new path. */
export function hexPath(context: CanvasRenderingContext2D, x: number, y: number, radius: number, squash: number): void {
  context.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (k * 60 - 30) * Math.PI / 180, px = x + radius * Math.cos(angle), py = y + radius * Math.sin(angle) * squash;
    if (k === 0) context.moveTo(px, py); else context.lineTo(px, py);
  }
  context.closePath();
}
/** Adds a squashed hex to the current path (for one batched fill). */
export function addHex(context: CanvasRenderingContext2D, x: number, y: number, radius: number, squash: number): void {
  for (let k = 0; k < 6; k++) {
    const angle = (k * 60 - 30) * Math.PI / 180, px = x + radius * Math.cos(angle), py = y + radius * Math.sin(angle) * squash;
    if (k === 0) context.moveTo(px, py); else context.lineTo(px, py);
  }
  context.closePath();
}
/** Screen angle of each HEX_DIRECTIONS entry (E, NE, NW, W, SW, SE), y down. */
export const DIRECTION_ANGLES = [0, -60, -120, 180, 120, 60].map(degrees => degrees * Math.PI / 180);
/** Corner indexes bounding each direction's edge. */
export const EDGE_CORNERS: readonly (readonly [number, number])[] = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
export function corner(p: Point, radius: number, squash: number, k: number): Point {
  const angle = (k * 60 - 30) * Math.PI / 180;
  return { x: p.x + radius * Math.cos(angle), y: p.y + radius * Math.sin(angle) * squash };
}

/** A soft round dab (radial gradient from `color` at `a` to transparent). */
export function dab(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  context.save();
  context.translate(x, y);
  context.scale(1, ry / rx);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, alpha(color, a)); gradient.addColorStop(.6, alpha(color, a * .55)); gradient.addColorStop(1, alpha(color, 0));
  context.fillStyle = gradient;
  context.beginPath(); context.arc(0, 0, rx, 0, Math.PI * 2); context.fill();
  context.restore();
}
/** A short curved brush stroke. */
export function stroke(context: CanvasRenderingContext2D, x: number, y: number, length: number, angle: number, bend: number, width: number, color: string): void {
  const dx = Math.cos(angle) * length / 2, dy = Math.sin(angle) * length / 2;
  context.beginPath();
  context.moveTo(x - dx, y - dy);
  context.quadraticCurveTo(x - dy * bend, y + dx * bend, x + dx, y + dy);
  context.strokeStyle = color; context.lineWidth = width; context.lineCap = 'round'; context.stroke();
}

/**
 * Size buckets: sprites are baked at an eighth-octave step of the device-pixel radius, rounded UP, and drawn at the exact size
 * (k = size / bucket ≤ 1). They are only ever shrunk by at most ~8 % with high-quality smoothing — never stretched, which is
 * what made them soft — and zooming still does not bake a new set for every wheel step.
 */
export function bucket(devicePixels: number): number {
  return Math.ceil(2 ** (Math.ceil(Math.log2(Math.max(4, devicePixels)) * 8 - 1e-9) / 8));
}

/** Bounded sprite cache (cleared wholesale when full: sprites are cheap to rebake and zoom changes are rare). */
export function spriteCache<T>(cap: number) {
  const map = new Map<string, T>();
  return {
    get(key: string, make: () => T): T {
      let value = map.get(key);
      if (value === undefined) {
        if (map.size >= cap) map.clear();
        value = make();
        map.set(key, value);
      }
      return value;
    },
    clear() { map.clear(); },
  };
}

/** Canvas font stack for painted labels: the display-serif role (FONT_DISPLAY in src/browser/theme.ts) (system fonts only, never bundled). */
export const SERIF = FONT_DISPLAY;
