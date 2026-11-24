// Pixel art scaling and sprite blitting shared by flat, 2.5D, and painted map renderers.
import type { SpeciesId } from '../../content/species.ts';
import { drawPokemonSprite, drawSpritePath, pokemonSprite } from '../sprites.ts';

type Art = HTMLCanvasElement | HTMLImageElement;

/** Largest relative size change accepted to land on an exact whole (or 1/whole) scale. */
export const SNAP = .2;

/** The device scale actually used for art requested at `device` device pixels per art pixel, and how to draw it. */
export function fitPixels(device: number, snap: boolean): { device: number; mode: 'nearest' | 'prescale' | 'smooth' } {
  if (device >= 1) {
    const whole = Math.round(device);
    if (Math.abs(device - whole) < 1e-3 || (snap && Math.abs(device - whole) / whole <= SNAP)) return { device: whole, mode: 'nearest' };
    return { device, mode: 'prescale' };
  }
  const part = 1 / Math.max(1, Math.round(1 / device));
  if (snap && Math.abs(device - part) / part <= SNAP) return { device: part, mode: 'smooth' };
  return { device, mode: 'smooth' };
}

/** The CSS scale a snapping blit of `scale` actually uses on this context (for overlays that must line up with it). */
export function snappedScale(context: CanvasRenderingContext2D, scale: number): number {
  const dpr = context.getTransform().a || 1;
  return fitPixels(scale * dpr, true).device / dpr;
}

const enlarged = new WeakMap<Art, Map<number, HTMLCanvasElement>>();
function nearest(art: Art, factor: number, width: number, height: number): HTMLCanvasElement {
  let byFactor = enlarged.get(art);
  if (!byFactor) { byFactor = new Map(); enlarged.set(art, byFactor); }
  let canvas = byFactor.get(factor);
  if (!canvas) {
    if (byFactor.size >= 3) byFactor.clear();
    canvas = document.createElement('canvas');
    canvas.width = width * factor; canvas.height = height * factor;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(art, 0, 0, canvas.width, canvas.height);
    byFactor.set(factor, canvas);
  }
  return canvas;
}

const sizeOf = (art: Art) => art instanceof HTMLImageElement ? { width: art.naturalWidth, height: art.naturalHeight } : { width: art.width, height: art.height };

export type PixelArtOptions = {
  /** May the drawn size move (by up to SNAP) to land on an exact scale? */
  snap?: boolean;
  /** The art pixel (from the top left) placed at the anchor point; snapping keeps it there. */
  anchorX?: number; anchorY?: number;
};

/**
 * Draws pixel art with the art pixel (anchorX, anchorY) at (x, y) CSS px, `scale` CSS px per art pixel. The context's transform
 * must be a plain DPR scale (plus whole-device-pixel translation), as on every map layer. Returns the CSS scale used.
 */
export function drawPixelArt(context: CanvasRenderingContext2D, art: Art, x: number, y: number, scale: number, options: PixelArtOptions = {}): number {
  const { width, height } = sizeOf(art);
  if (!width || !height || scale <= 0) return scale;
  const dpr = context.getTransform().a || 1, fit = fitPixels(scale * dpr, options.snap ?? false), s = fit.device / dpr;
  const left = Math.round((x - (options.anchorX ?? 0) * s) * dpr) / dpr, top = Math.round((y - (options.anchorY ?? 0) * s) * dpr) / dpr;
  const smoothing = context.imageSmoothingEnabled, quality = context.imageSmoothingQuality;
  if (fit.mode === 'nearest') {
    context.imageSmoothingEnabled = false;
    context.drawImage(art, left, top, width * s, height * s);
  } else {
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const source = fit.mode === 'prescale' ? nearest(art, Math.ceil(fit.device), width, height) : art;
    context.drawImage(source, left, top, width * s, height * s);
  }
  context.imageSmoothingEnabled = smoothing; context.imageSmoothingQuality = quality;
  return s;
}

/** A square pixel sprite (Emerald 64, Platinum 80, Black/White 96 px); later generations are cropped smooth art (false). */
export const isPixelSprite = (image: HTMLImageElement | null): image is HTMLImageElement =>
  Boolean(image?.complete && image.naturalWidth && image.naturalWidth === image.naturalHeight && image.naturalWidth <= 96);

const pathImages = new Map<string, HTMLImageElement>();
/** The image of a sprite file, once loaded (sprites.ts loads the same URLs and triggers the redraw). */
export function loadedImage(path: string): HTMLImageElement | null {
  let image = pathImages.get(path);
  if (!image) { image = new Image(); image.src = path; pathImages.set(path, image); }
  return image.complete && image.naturalWidth ? image : null;
}

/**
 * Draws a square pixel sprite filling a `box`-sized square whose centre-top area is anchored like the callers expect: the box's
 * horizontal centre at `cx`, the fraction `fy` of its height at `cy`. Returns false when the image is not a pixel sprite (the
 * caller then draws it the old way, e.g. smooth cropped art).
 */
export function drawPixelSprite(context: CanvasRenderingContext2D, image: HTMLImageElement | null, cx: number, cy: number, box: number, fy: number): boolean {
  if (!isPixelSprite(image)) return false;
  const n = image.naturalWidth;
  drawPixelArt(context, image, cx, cy, box / n, { snap: true, anchorX: n / 2, anchorY: n * fy });
  return true;
}

/** `drawPokemonSprite` with pixel sprites at whole scales around the box centre (smooth cropped art keeps sprites.ts's fit). */
export function drawSpeciesSprite(context: CanvasRenderingContext2D, id: SpeciesId, x: number, y: number, box: number): boolean {
  return drawPixelSprite(context, pokemonSprite(id), x + box / 2, y + box / 2, box, .5) || drawPokemonSprite(context, id, x, y, box);
}

/** `drawSpritePath` with pixel sprites at whole scales around the box centre. */
export function drawSpriteFile(context: CanvasRenderingContext2D, path: string, x: number, y: number, box: number): boolean {
  const drawn = drawSpritePath(context, path, x, y, 0);
  if (!drawn) return false;
  return drawPixelSprite(context, loadedImage(path), x + box / 2, y + box / 2, box, .5) || drawSpritePath(context, path, x, y, box);
}
