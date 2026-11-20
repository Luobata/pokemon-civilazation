// ui-25d terrain (docs/design/ui-25d.md §2–§4): each explored tile is a short column — a squashed, textured top face, the two
// front cliff faces (SW lit, SE shaded; light comes from the north-west), and upright props (trees, crags, peaks, cones, mounds)
// standing on it. Tiles are painted row by row from the back, across every wrapped copy at once, so nearer columns cover farther
// ones. All art is original hard-edged pixel art drawn here with fillRect into small cached canvases (no image files).
import { FONT_UI } from '../theme.ts';
import type { BiomeId } from '../../content/rules.ts';
import type { LandmarkId } from '../../content/terrain.ts';
import type { Point } from '../camera.ts';
import type { MapScene } from './scene.ts';
import { landmarkGlyph } from './terrain-features.ts';
import type { SpeciesId } from '../../content/species.ts';
import { drawPokemonSprite, drawSpritePath, pokemonSprite } from '../sprites.ts';
import { CORNERS, EDGE_CORNERS, ELEVATION, SE, SW, neighbourIndexOf, propScale } from './projection.ts';

/** Texture hex radius (native pixels); textures are drawn scaled by radius / RT. */
const RT = 24;
const SQ = .75;
const TW = 44, TH = 38, GC = { x: 22, y: 19 };
/** Props canvas: headroom above the top face for peaks and trees. */
const HEAD = 36, PW = 48, PH = HEAD + 38, PC = { x: 24, y: HEAD + 19 };

function noise(seed: number, index: number): number {
  let value = Math.imul(seed + index * 374761393, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

type Paint = { context: CanvasRenderingContext2D; cx: number; cy: number };
const rect = (g: Paint, color: string, x: number, y: number, width = 1, height = 1) => {
  g.context.fillStyle = color;
  g.context.fillRect(Math.round(g.cx + x), Math.round(g.cy + y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
};
const poly = (g: Paint, color: string, points: readonly (readonly [number, number])[]) => {
  g.context.fillStyle = color; g.context.beginPath();
  points.forEach(([x, y], index) => index ? g.context.lineTo(g.cx + x, g.cy + y) : g.context.moveTo(g.cx + x, g.cy + y));
  g.context.closePath(); g.context.fill();
};
function canvas(width: number, height: number): { element: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  const context = element.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  return { element, context };
}
/** Squashed hex path around (cx, cy). */
function hexPath(context: CanvasRenderingContext2D, cx: number, cy: number, radius: number, squash: number) {
  context.beginPath();
  for (let k = 0; k < 6; k++) {
    const x = cx + radius * CORNERS[k].x, y = cy + radius * CORNERS[k].y * squash;
    if (k) context.lineTo(x, y); else context.moveTo(x, y);
  }
  context.closePath();
}
/** Scattered points inside the squashed top face (|x| ≤ 18, |y| ≤ 12). */
function scatter(seed: number, count: number, each: (x: number, y: number, index: number) => void) {
  for (let index = 0; index < count; index++) {
    const x = Math.round((noise(seed, index * 3) - .5) * 34), y = Math.round((noise(seed, index * 3 + 1) - .5) * 22);
    if (Math.abs(y) + Math.abs(x) * .35 <= 12) each(x, y, index);
  }
}

// ---------- Ground (top face) textures ----------
type GroundKind = BiomeId | 'deep' | 'lake' | 'unknown';
const grounds = new Map<string, HTMLCanvasElement>();
function ground(kind: GroundKind, variant: number): HTMLCanvasElement {
  const key = `${kind}:${variant}`;
  let cached = grounds.get(key);
  if (cached) return cached;
  const { element, context } = canvas(TW, TH), g: Paint = { context, cx: GC.x, cy: GC.y };
  const seed = key.length * 977 + variant * 7919 + kind.charCodeAt(0) * 31 + kind.charCodeAt(1);
  hexPath(context, GC.x, GC.y, RT + .8, SQ);
  context.clip();
  const base = (color: string) => { context.fillStyle = color; context.fillRect(0, 0, TW, TH); };
  // Light from the north-west: a lighter patch on the upper left, a darker one on the lower right.
  const light = (color: string) => poly(g, color, [[-24, -8], [-4, -19], [14, -14], [4, -4], [-12, 0]]);
  const shade = (color: string) => poly(g, color, [[-6, 9], [12, 2], [24, 5], [24, 20], [-8, 20]]);
  if (kind === 'grassland') {
    base('#7AA65A'); light('#87B366'); shade('#6C9850');
    scatter(seed, 16, (x, y, i) => { const c = i % 3 ? '#5E8A47' : '#A3C87A'; rect(g, c, x, y, 1, 2); rect(g, c, x + 2, y, 1, 2); rect(g, c, x + 1, y + 1); });
    if (variant % 2) scatter(seed + 5, 3, (x, y, i) => { rect(g, i % 2 ? '#F4E7A1' : '#EFA0A0', x, y); rect(g, '#5E8A47', x, y + 1); });
  } else if (kind === 'forest') {
    base('#4B7A4E'); light('#578858'); shade('#3E6B44');
    scatter(seed, 14, (x, y, i) => rect(g, i % 2 ? '#6E9A64' : '#35593B', x, y, 2, 1));
  } else if (kind === 'desert') {
    base('#D7B26E'); light('#E3C285'); shade('#C79F5F');
    for (const [row, offset] of [[-11, 0], [-5, 5], [1, -3], [7, 3], [12, -6]] as const)
      for (let x = -20 + offset + (variant * 3) % 7; x < 20; x += 11) { rect(g, '#BE965A', x, row, 5, 1); rect(g, '#EBD29A', x + 1, row - 1, 3, 1); }
  } else if (kind === 'snow') {
    base('#E1EAE9'); light('#F4F8F6'); shade('#C6D6DC');
    scatter(seed, 12, (x, y, i) => rect(g, i % 3 ? '#B4C8D0' : '#FFFFFF', x, y, i % 2 ? 2 : 1, 1));
  } else if (kind === 'mountain') {
    base('#878A7B'); light('#979A8B'); shade('#74776A');
    scatter(seed, 6, (x, y) => { rect(g, '#5F6257', x, y, 3, 1); rect(g, '#5F6257', x + 3, y + 1, 2, 1); });
    scatter(seed + 9, 8, (x, y) => rect(g, '#A9AA99', x, y, 2, 1));
  } else if (kind === 'volcano') {
    base('#5D4843'); light('#6C564C'); shade('#4A3936');
    const crack: [number, number][] = [[-16, -2], [-11, 0], [-7, -1], [-3, 2], [2, 1], [6, 4], [11, 3], [15, 6]];
    for (const [x, y] of crack) { rect(g, '#E2703E', x, y + variant % 3 - 1, 4, 1); rect(g, '#FFC25A', x + 1, y + variant % 3 - 1, 2, 1); }
    scatter(seed, 6, (x, y) => rect(g, '#7B5F52', x, y, 2, 1));
  } else if (kind === 'ocean' || kind === 'deep' || kind === 'lake') {
    // Round 2: water a shade darker than the flat map's, so the lower level reads as depth.
    const palette = kind === 'deep' ? ['#1D5276', '#235C82', '#184769', '#3D7A9E', '#5A93B3'] : kind === 'lake' ? ['#3F91A8', '#4A9DB3', '#35829A', '#98D0D4', '#C6EAE6'] : ['#2F7495', '#3880A0', '#286686', '#7AB8C8', '#A9D9DD'];
    base(palette[0]); light(palette[1]); shade(palette[2]);
    scatter(seed, 9, (x, y, i) => { rect(g, i % 3 ? palette[3] : palette[4], x, y, i % 2 ? 3 : 4, 1); if (i % 4 === 0) rect(g, palette[2], x + 2, y + 2, 4, 1); });
  } else {
    base('#081116');
    scatter(seed, 6, (x, y) => rect(g, '#0E1C24', x, y, 3, 1));
  }
  grounds.set(key, element);
  cached = element;
  return cached;
}

// ---------- Props (upright billboards baked per tile kind) ----------
type Tree = { dark: string; mid: string; light: string; snow?: boolean };
const PINE: Tree = { dark: '#244A35', mid: '#336447', light: '#4F8E58' };
const SNOW_PINE: Tree = { dark: '#2C4A44', mid: '#3D6058', light: '#5C8577', snow: true };
const shadow = (g: Paint, x: number, y: number, width: number) => rect(g, 'rgba(8,24,20,.38)', x - 1, y - 1, width + 2, 2);
function pine(g: Paint, x: number, y: number, height: number, tree: Tree) {
  shadow(g, x + 1, y, 6);
  rect(g, '#5B4330', x - 1, y - 3, 2, 3);
  const rows = height - 3;
  for (let j = 0; j < rows; j++) {
    const half = Math.max(1, Math.round(1 + j / rows * 4 + (j % 3 === 2 ? .6 : 0))), top = y - 3 - rows + j;
    rect(g, tree.dark, x - half - 1, top, half * 2 + 2, 1);
    rect(g, tree.light, x - half, top, half, 1);
    rect(g, tree.mid, x, top, half, 1);
    if (tree.snow && j % 3 === 0) rect(g, '#EEF4F2', x - half, top, half + 1, 1);
  }
}
function broadleaf(g: Paint, x: number, y: number, size: number) {
  shadow(g, x + 1, y, 7);
  rect(g, '#5B4330', x - 1, y - 4, 2, 4);
  const widths = size > 10 ? [3, 5, 6, 6, 6, 5, 3] : [2, 4, 5, 5, 4, 2];
  widths.forEach((half, j) => {
    const top = y - 3 - widths.length + j;
    rect(g, '#245036', x - half - 1, top, half * 2 + 2, 1);
    rect(g, '#5A9A55', x - half, top, half, 1);
    rect(g, '#3C7445', x, top, half, 1);
  });
  rect(g, '#8CC07A', x - 2, y - 2 - widths.length, 2, 1);
}
function bush(g: Paint, x: number, y: number) {
  shadow(g, x, y, 5);
  rect(g, '#2E5A3A', x - 3, y - 3, 6, 3); rect(g, '#5E9C58', x - 2, y - 4, 3, 2); rect(g, '#447E4A', x + 1, y - 3, 2, 2);
}
function grassTuft(g: Paint, x: number, y: number) {
  for (const [dx, h] of [[-2, 3], [0, 4], [2, 3]] as const) { rect(g, '#4F7D3E', dx + x, y - h, 1, h); rect(g, '#9CC475', dx + x, y - h, 1, 1); }
}
function rock(g: Paint, x: number, y: number, snowy = false) {
  shadow(g, x, y, 6);
  rect(g, '#55574F', x - 3, y - 3, 6, 3); rect(g, snowy ? '#EEF3F1' : '#AEB0A3', x - 2, y - 4, 3, 2); rect(g, '#7D7F74', x + 1, y - 3, 2, 2);
}
function cactus(g: Paint, x: number, y: number) {
  shadow(g, x, y, 4);
  rect(g, '#3D6B3A', x - 1, y - 8, 3, 8); rect(g, '#7FAF67', x - 1, y - 8, 1, 7);
  rect(g, '#3D6B3A', x - 4, y - 6, 2, 3); rect(g, '#3D6B3A', x - 4, y - 4, 3, 1);
  rect(g, '#3D6B3A', x + 3, y - 7, 2, 3); rect(g, '#3D6B3A', x + 2, y - 5, 3, 1);
}
/** A rock spire: left face lit, right face shaded, optional snow cap. */
function crag(g: Paint, x: number, y: number, height: number, half: number, snow: number, palette = ['#A2A496', '#6A6D62', '#4C4F47', '#C6C7BA']) {
  // Cast shadow to the south-east (light from the north-west), longer for taller rocks.
  poly(g, 'rgba(8,20,24,.34)', [[x - half + 1, y], [x + half + 1, y - 1], [x + half + 2 + height * .45, y + 2 + height * .14], [x + height * .3, y + 3 + height * .16]]);
  for (let j = 0; j <= height; j++) {
    const w = Math.round(half * j / height + (j % 4 === 1 ? .7 : 0)), top = y - height + j;
    rect(g, palette[2], x - w - 1, top, w * 2 + 2, 1);
    if (j < height * snow) { rect(g, '#F3F7F5', x - w, top, w, 1); rect(g, '#C7D5DA', x, top, w, 1); }
    else { rect(g, palette[0], x - w, top, w, 1); rect(g, palette[1], x, top, w, 1); }
  }
  rect(g, palette[3], x - 1, y - height + 2, 1, Math.round(height * .5));
}
function mound(g: Paint, x: number, y: number, half: number, height: number, palette: readonly [string, string, string]) {
  rect(g, 'rgba(8,24,20,.3)', x - half + 2, y - 1, half * 2 + 2, 2);
  for (let j = 0; j <= height; j++) {
    const w = Math.round(half * Math.sqrt(1 - ((height - j) / (height + .6)) ** 2)), top = y - height + j;
    rect(g, palette[2], x - w - 1, top, w * 2 + 2, 1);
    rect(g, palette[0], x - w, top, Math.max(1, Math.round(w * 1.2)), 1);
    rect(g, palette[1], x + Math.round(w * .2), top, Math.max(1, Math.round(w * .8)), 1);
  }
}
function cone(g: Paint, x: number, y: number) {
  poly(g, 'rgba(8,20,24,.35)', [[x - 6, y], [x + 12, y], [x + 16, y - 3], [x + 4, y - 4]]);
  const height = 15;
  for (let j = 0; j <= height; j++) {
    const w = Math.round(3 + j * .62), top = y - height + j;
    rect(g, '#2E2423', x - w - 1, top, w * 2 + 2, 1);
    rect(g, '#7C6052', x - w, top, w, 1); rect(g, '#4D3C38', x, top, w, 1);
  }
  rect(g, '#2A1F1E', x - 3, y - height, 6, 2); rect(g, '#F08A3E', x - 2, y - height, 4, 1); rect(g, '#FFD36A', x - 1, y - height, 2, 1);
  rect(g, '#F08A3E', x - 1, y - height + 2, 1, 4); rect(g, '#E2703E', x + 1, y - height + 3, 1, 3);
  rect(g, '#A59C99', x - 1, y - height - 4, 3, 2); rect(g, '#C9C2BE', x + 1, y - height - 7, 3, 2); rect(g, '#8C8380', x + 3, y - height - 10, 2, 2);
}
const HILL_PALETTE: Partial<Record<BiomeId, readonly [string, string, string]>> & { default: readonly [string, string, string] } = {
  default: ['#93BB6C', '#6E9852', '#3E5E34'], forest: ['#6A9A5E', '#4D7C4B', '#2C4B33'], desert: ['#E6C68A', '#C59D5E', '#8A6A3E'],
  snow: ['#F6FAF8', '#C9D8DE', '#8EA6B0'], mountain: ['#A3A596', '#7A7D70', '#4C4F47'], volcano: ['#7C6052', '#56443D', '#2E2423'],
};
const props = new Map<string, HTMLCanvasElement | null>();
function propsFor(biome: BiomeId, variant: number, hill: boolean, peak: boolean, seed: number): HTMLCanvasElement | null {
  const key = `${biome}:${variant}:${hill ? 1 : 0}:${peak ? 1 : 0}`;
  if (props.has(key)) return props.get(key)!;
  if (biome === 'ocean') { props.set(key, null); return null; }
  const { element, context } = canvas(PW, PH), g: Paint = { context, cx: PC.x, cy: PC.y };
  const jitter = (index: number) => Math.round((noise(seed, index) - .5) * 4);
  const items: { y: number; draw: () => void }[] = [];
  const add = (y: number, draw: () => void) => items.push({ y, draw });
  if (peak) {
    add(5, () => crag(g, 1, 5, 30, 10, .38));
    add(8, () => crag(g, -10, 8, 13, 6, .25));
  } else if (biome === 'mountain') {
    add(3, () => crag(g, -5, 3, 22, 10, variant % 2 ? .3 : 0));
    add(8, () => crag(g, 8, 8, 15, 8, variant % 2 ? 0 : .3));
  } else if (biome === 'volcano') add(7, () => cone(g, 0, 7));
  if (hill && !peak) {
    const palette = HILL_PALETTE[biome] ?? HILL_PALETTE.default;
    add(2, () => mound(g, -6, 2, 10, 8, palette));
    add(8, () => mound(g, 7, 8, 9, 7, palette));
  }
  if (!peak && biome === 'forest') {
    const spots = hill ? [[-12, -2], [12, 0], [0, -7]] : [[-10, -5], [2, -8], [12, -3], [-4, 1], [-5, 5], [8, 6], [-13, 6]];
    spots.forEach(([x, y], index) => add(y, () => variant % 2 || index % 3 === 1 ? pine(g, x + jitter(index), y, 14 + index % 3, PINE) : broadleaf(g, x + jitter(index), y, 10 + index % 3)));
  } else if (!peak && !hill && biome === 'grassland') {
    if (variant === 0) add(2, () => bush(g, 6 + jitter(1), 2));
    if (variant === 1) { add(-3, () => grassTuft(g, -8, -3)); add(6, () => grassTuft(g, 7, 6)); }
    if (variant === 2) add(-2, () => broadleaf(g, -6 + jitter(2), -2, 9));
    if (variant === 3) { add(4, () => rock(g, 8, 4)); add(-4, () => bush(g, -9, -4)); }
  } else if (!peak && biome === 'desert') {
    if (variant === 0) add(3, () => rock(g, -7, 3));
    if (variant === 2) add(2, () => cactus(g, 6, 2));
    if (variant === 3) { add(-3, () => rock(g, 9, -3)); add(6, () => cactus(g, -8, 6)); }
  } else if (!peak && biome === 'snow') {
    if (variant === 1) add(1, () => pine(g, 5, 1, 13, SNOW_PINE));
    if (variant === 2) { add(-4, () => pine(g, -8, -4, 12, SNOW_PINE)); add(5, () => pine(g, 7, 5, 11, SNOW_PINE)); }
    if (variant === 3) add(3, () => rock(g, -4, 3, true));
  }
  if (!items.length) { props.set(key, null); return null; }
  for (const item of items.sort((a, b) => a.y - b.y)) item.draw();
  props.set(key, element);
  return element;
}

// ---------- Side faces ----------
// Round 2: a wider split between the lit SW face and the shaded SE face, so steps read at the default zoom.
type Sides = { lip: string; lit: string; dark: string; strata: string };
const SIDES: Record<BiomeId, Sides> = {
  grassland: { lip: '#5C8A43', lit: '#B08A5C', dark: '#654830', strata: '#5A4230' },
  forest: { lip: '#2F573D', lit: '#9C774D', dark: '#563F2B', strata: '#4A3727' },
  desert: { lip: '#CFA764', lit: '#D7A46A', dark: '#8A5C36', strata: '#7A5232' },
  snow: { lip: '#F3F7F4', lit: '#C2D4DC', dark: '#6C8496', strata: '#62788A' },
  mountain: { lip: '#9A9C8D', lit: '#8E9183', dark: '#474A43', strata: '#3E413B' },
  volcano: { lip: '#6E574F', lit: '#5C4A43', dark: '#2C2222', strata: '#E0703F' },
  ocean: { lip: '#4D98B6', lit: '#2E6E8A', dark: '#1F4F66', strata: '#1D4A5E' },
};
/** Wet-sand lip on land cliffs that drop into water (the shoreline reads as a rim, not just a colour change). */
const BEACH = '#E2CF97';

export type Base25d = {
  context: CanvasRenderingContext2D;
  scene: MapScene;
  lifts: Float32Array;
  radius: number; zoom: number; squash: number;
  /** Lifted screen centres, one array per wrapped copy. */
  copies: readonly Point[][];
  width: number; height: number;
  ownerColor(ownerId: number | null): string;
  /** Only these rows / columns (end exclusive): one chunk of the chunk cache. Default: the whole map. */
  rows?: readonly [number, number]; cols?: readonly [number, number];
};

type Flags = { hill: Uint8Array; peak: Uint8Array; deep: Uint8Array; lake: Uint8Array; river: Map<number, number[]>; landmark: Map<number, LandmarkId> };
const flagCache = new WeakMap<object, Flags>();
function flagsFor(scene: MapScene): Flags {
  const terrain = scene.terrain, key = terrain ?? scene.tiles;
  let flags = flagCache.get(key);
  if (flags) return flags;
  const size = scene.tiles.length, mark = (list: readonly number[] | undefined) => { const bits = new Uint8Array(size); for (const index of list ?? []) bits[index] = 1; return bits; };
  flags = { hill: mark(terrain?.hills), peak: mark(terrain?.peaks), deep: mark(terrain?.deep), lake: mark(terrain?.lakes),
    river: new Map((terrain?.rivers ?? []).map(river => [river.index, river.links])), landmark: new Map((terrain?.landmarks ?? []).map(site => [site.index, site.id])) };
  flagCache.set(key, flags);
  return flags;
}
/** Index of the neighbour in HEX_DIRECTIONS order (offset rows: index = row × width + col), or -1 off the map. */
const neighbourIndex = (scene: MapScene, index: number, direction: number) => neighbourIndexOf(scene, index, direction);
export { neighbourIndex as neighbourIndex25d };

const DIRECTION_ANGLES = [0, -60, -120, 180, 120, 60].map(degrees => degrees * Math.PI / 180);

/**
 * Per-row batches: every fill or stroke of one style in a row goes into one Path2D and is painted once at the end of the row
 * (faces, then top faces, then the overlays on them). Rows stay in back-to-front order, so occlusion is unchanged; a row is a
 * single depth band, and nothing of one tile overlaps a same-row neighbour except its props, which are drawn last.
 */
class Batch {
  private fills = new Map<string, Path2D>();
  private strokes = new Map<string, { color: string; path: Path2D; width: number; dash: number[] }>();
  fill(color: string): Path2D {
    let path = this.fills.get(color);
    if (!path) { path = new Path2D(); this.fills.set(color, path); }
    return path;
  }
  stroke(color: string, width: number, dash: number[] = []): Path2D {
    const key = `${color}|${width}|${dash.join(',')}`;
    let entry = this.strokes.get(key);
    if (!entry) { entry = { color, path: new Path2D(), width, dash }; this.strokes.set(key, entry); }
    return entry.path;
  }
  flush(context: CanvasRenderingContext2D) {
    for (const [color, path] of this.fills) { context.fillStyle = color; context.fill(path); }
    for (const entry of this.strokes.values()) {
      context.strokeStyle = entry.color; context.lineWidth = entry.width;
      if (entry.dash.length) context.setLineDash(entry.dash);
      context.stroke(entry.path);
      if (entry.dash.length) context.setLineDash([]);
    }
    this.fills.clear(); this.strokes.clear();
  }
}
const quad = (path: Path2D, a: Point, b: Point, c: Point, d: Point) => { path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); path.lineTo(c.x, c.y); path.lineTo(d.x, d.y); path.closePath(); };
const segment = (path: Path2D, a: Point, b: Point) => { path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); };

/** The 2.5D base layer: terrain columns (all copies, back rows first), then territory borders. */
export function drawBase25d(b: Base25d): void {
  const { context, scene, lifts, radius, zoom, squash } = b;
  const flags = flagsFor(scene), s = radius / RT, ps = s * propScale(radius), fogged = fogSet(scene);
  const margin = radius * 2.2;
  const corner = (p: Point, k: number): Point => ({ x: p.x + radius * CORNERS[k].x, y: p.y + radius * CORNERS[k].y * squash });
  const toward = (a: Point, p: Point, t: number): Point => ({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t });
  const down = (q: Point, y: number): Point => ({ x: q.x, y: q.y + y });
  const liftOf = (index: number) => index < 0 ? ELEVATION.unknown : lifts[index];
  const faces = new Batch(), overlay = new Batch();
  const thin = Math.max(1, s * .9), lipHeight = Math.max(1, 1.6 * s), foamWidth = Math.max(1, s * 1.1), outlineWidth = Math.max(.6, radius * .04);
  const foamDash = [Math.max(2, 3 * s), Math.max(1, 1.5 * s)], fallWidth = Math.max(2, radius * .12);
  const riverOuter = Math.max(1.6, radius * .17), riverInner = Math.max(1, radius * .08), reach = radius * .87;
  const tiles: { p: Point; index: number }[] = [], propsDraws: { art: HTMLCanvasElement; p: Point; index: number }[] = [], stones: { p: Point; id: LandmarkId }[] = [];
  context.save();
  context.lineJoin = 'round';
  const [rowFrom, rowTo] = b.rows ?? [0, scene.height], [colFrom, colTo] = b.cols ?? [0, scene.width];
  for (let row = rowFrom; row < rowTo; row++) {
    tiles.length = 0; propsDraws.length = 0; stones.length = 0;
    for (const centres of b.copies) for (let col = colFrom; col < colTo; col++) {
      const index = row * scene.width + col, p = centres[index];
      if (p.x < -margin || p.x > b.width + margin || p.y < -margin * 1.6 || p.y > b.height + margin * 1.4) continue;
      tiles.push({ p, index });
      const biome = scene.tiles[index].biome;
      if (!biome) continue;
      const lift = lifts[index], sides = SIDES[biome], water = biome === 'ocean';
      // Front cliff faces, down to each front neighbour's top: lit SW, shaded SE, a lip, a stratum line, surf, waterfalls.
      for (const direction of [SW, SE]) {
        const other = neighbourIndex(scene, index, direction), h = (lift - liftOf(other)) * zoom;
        if (h <= .4) continue;
        const [ka, kb] = EDGE_CORNERS[direction], a = corner(p, ka), c = corner(p, kb);
        const otherBiome = other < 0 ? null : scene.tiles[other].biome, shore = !water && otherBiome === 'ocean';
        quad(faces.fill(direction === SW ? sides.lit : sides.dark), a, c, down(c, h), down(a, h));
        // Ambient occlusion at the foot of the cliff: the lowest third is a step darker (one translucent band per row).
        if (h > 3 * s) { const foot = Math.min(h * .34, 5 * s); quad(faces.fill('rgba(12,14,18,.30)'), down(a, h - foot), down(c, h - foot), down(c, h), down(a, h)); }
        const lip = Math.min(h, lipHeight * (shore ? 1.5 : 1));
        quad(faces.fill(shore && biome !== 'snow' ? BEACH : sides.lip), a, c, down(c, lip), down(a, lip));
        if (shore && biome !== 'snow') quad(faces.fill(sides.lip), a, c, down(c, Math.min(h, lipHeight * .6)), down(a, Math.min(h, lipHeight * .6)));
        if (h > 7 * s) segment(faces.stroke(sides.strata, thin), down(a, h * .58), down(c, h * .58));
        if (shore) segment(faces.stroke('#E4F3EFCC', foamWidth), down(a, h - Math.max(.8, s * .7)), down(c, h - Math.max(.8, s * .7)));
        if (flags.river.get(index)?.includes(direction)) {
          const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
          faces.fill('#6FB6E6').rect(Math.round(mid.x - fallWidth / 2), Math.round(mid.y), Math.round(fallWidth), Math.round(h));
          faces.fill('#E4F3EF').rect(Math.round(mid.x - fallWidth / 2), Math.round(mid.y + h - Math.max(1, s)), Math.round(fallWidth), Math.max(1, Math.round(s * 1.5)));
        }
      }
    }
    faces.flush(context);
    for (const { p, index } of tiles) {
      const biome = scene.tiles[index].biome, variant = Math.floor(noise(index + 137, 3) * 4);
      if (!biome) { drawPixelArt(context, ground('unknown', variant % 2), p.x, p.y, s, { anchorX: GC.x, anchorY: GC.y }); continue; }
      const lift = lifts[index], water = biome === 'ocean';
      const kind: GroundKind = water ? flags.deep[index] ? 'deep' : flags.lake[index] ? 'lake' : 'ocean' : biome;
      drawPixelArt(context, ground(kind, variant), p.x, p.y, s, { anchorX: GC.x, anchorY: GC.y });
      // Shadows cast by higher neighbours to the west, north-west and north-east (light from the north-west).
      for (const direction of [3, 2, 1]) {
        const other = neighbourIndex(scene, index, direction), rise = liftOf(other) - lift;
        if (other < 0 || rise <= 1 || !scene.tiles[other].biome) continue;
        const depth = Math.min(.46, rise * .03 + .12) * (direction === 1 ? .7 : 1), [ka, kb] = EDGE_CORNERS[direction], a = corner(p, ka), c = corner(p, kb);
        quad(overlay.fill('rgba(10,26,36,.22)'), a, c, toward(c, p, depth), toward(a, p, depth));
        quad(overlay.fill('rgba(10,26,36,.22)'), a, c, toward(c, p, depth * .4), toward(a, p, depth * .4));
      }
      // Water: dashed foam along the shore behind and beside it.
      if (water) for (const direction of [0, 1, 2, 3]) {
        const other = neighbourIndex(scene, index, direction), otherBiome = other < 0 ? null : scene.tiles[other].biome;
        if (!otherBiome || otherBiome === 'ocean') continue;
        const [ka, kb] = EDGE_CORNERS[direction];
        segment(overlay.stroke('#D9EFEA', foamWidth, foamDash), toward(corner(p, ka), p, .1), toward(corner(p, kb), p, .1));
      }
      // Rim light on the back edges of a column standing above its neighbour.
      for (const direction of [2, 1]) {
        if (lift - liftOf(neighbourIndex(scene, index, direction)) < 1.5) continue;
        const [ka, kb] = EDGE_CORNERS[direction];
        segment(overlay.stroke(water ? '#9FD3DD80' : '#FFF8DC70', thin), corner(p, ka), corner(p, kb));
      }
      // Grid: a faint outline of the top face, and a pixel bevel just inside it (lit W / NW / NE edges, shaded E / SE / SW edges),
      // so every tile reads as a slab even on level ground.
      const outline = overlay.stroke(water ? '#0B2A3A30' : '#0B1A1C38', outlineWidth);
      for (let k = 0; k < 6; k++) { const q = corner(p, k); if (k) outline.lineTo(q.x, q.y); else outline.moveTo(q.x, q.y); }
      outline.closePath();
      if (!water) {
        const inset = Math.min(.12, (thin * 1.1 + outlineWidth) / radius), lit = overlay.stroke('#FFF6D82E', thin), dim = overlay.stroke('#0A141A3A', thin);
        for (const direction of [3, 2, 1]) { const [ka, kb] = EDGE_CORNERS[direction]; segment(lit, toward(corner(p, ka), p, inset), toward(corner(p, kb), p, inset)); }
        for (const direction of [0, 5, 4]) { const [ka, kb] = EDGE_CORNERS[direction]; segment(dim, toward(corner(p, ka), p, inset), toward(corner(p, kb), p, inset)); }
      }
      const links = flags.river.get(index);
      if (links) for (const direction of links.length ? links : [0]) {
        const end = { x: p.x + reach * Math.cos(DIRECTION_ANGLES[direction]), y: p.y + reach * Math.sin(DIRECTION_ANGLES[direction]) * squash };
        segment(overlay.stroke('#2F6FB0', riverOuter), p, end);
        segment(overlay.stroke('#6FB6E6', riverInner), p, end);
      }
      const art = propsFor(biome, variant, flags.hill[index] === 1, flags.peak[index] === 1, index * 13 + 5);
      if (art) propsDraws.push({ art, p, index });
      const landmark = flags.landmark.get(index);
      if (landmark) stones.push({ p, id: landmark });
    }
    context.lineCap = 'round';
    overlay.flush(context);
    context.lineCap = 'butt';
    for (const { art, p, index } of propsDraws) {
      // Props may snap to a whole device scale (their size is free); the tile centre stays put.
      const used = drawPixelArt(context, art, p.x, p.y, ps, { snap: true, anchorX: PC.x, anchorY: PC.y }), x = p.x - PC.x * used, y = p.y - PC.y * used;
      // Fog: the part of a prop standing out of its tile's veil outline gets a pre-veiled copy here (under the units); the part
      // inside the outline is veiled by the fog layer, so every pixel of the prop is veiled exactly once.
      if (fogged.has(index)) {
        const clip = new Path2D();
        clip.rect(x - 2, y - 2, PW * used + 4, PH * used + 4);
        veilOutline(clip, scene, lifts, index, p, radius, zoom, squash);
        context.save(); context.clip(clip, 'evenodd');
        drawPixelArt(context, veiledArt(art), p.x, p.y, ps, { snap: true, anchorX: PC.x, anchorY: PC.y });
        context.restore();
      }
    }
    for (const stone of stones) landmarkStone(context, stone.p, radius, stone.id);
  }
  // Territory: a soft inner band in the owner's colour and a dark under-stroke, then the border line on the lifted top-face edge.
  const inside = (index: number) => { const row = Math.floor(index / scene.width), col = index % scene.width; return row >= rowFrom && row < rowTo && col >= colFrom && col < colTo; };
  const visible = (p: Point) => p.x >= -margin && p.x <= b.width + margin && p.y >= -margin && p.y <= b.height + margin;
  for (const centres of b.copies) for (const edge of scene.territoryEdges) {
    const p = centres[edge.index];
    if (!visible(p) || !inside(edge.index)) continue;
    const [ka, kb] = EDGE_CORNERS[edge.direction], a = corner(p, ka), c = corner(p, kb);
    quad(overlay.fill(`${b.ownerColor(edge.ownerId!)}40`), a, c, toward(c, p, .2), toward(a, p, .2));
    segment(overlay.stroke('#1D2B26', 4), a, c);
  }
  overlay.flush(context);
  for (const centres of b.copies) for (const edge of scene.territoryEdges) {
    const p = centres[edge.index];
    if (!visible(p) || !inside(edge.index)) continue;
    const [ka, kb] = EDGE_CORNERS[edge.direction];
    segment(overlay.stroke(b.ownerColor(edge.ownerId!), 2), corner(p, ka), corner(p, kb));
  }
  overlay.flush(context);
  context.restore();
}

function landmarkStone(context: CanvasRenderingContext2D, p: Point, radius: number, id: LandmarkId) {
  const glyph = landmarkGlyph(id), w = radius * .34, h = radius * .62, top = p.y - h - radius * .1;
  context.fillStyle = 'rgba(8,20,24,.4)';
  context.beginPath(); context.ellipse(p.x + w * .5, p.y - radius * .02, w * 1.05, w * .32, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#2A2F38'; context.fillRect(Math.round(p.x - w / 2 - 1), Math.round(top), Math.round(w + 2), Math.round(h + 1));
  context.fillStyle = '#5A606C'; context.fillRect(Math.round(p.x - w / 2), Math.round(top + 1), Math.round(w / 2), Math.round(h - 1));
  context.fillStyle = '#434957'; context.fillRect(Math.round(p.x), Math.round(top + 1), Math.round(w / 2), Math.round(h - 1));
  const size = radius * .36, q = { x: p.x, y: top - size * .45 };
  context.beginPath(); context.arc(q.x, q.y, size, 0, Math.PI * 2);
  context.fillStyle = '#1B1F26F0'; context.fill();
  context.strokeStyle = glyph.color; context.lineWidth = Math.max(1.5, radius * .08); context.stroke();
  context.fillStyle = glyph.color; context.font = `700 ${Math.max(10, Math.round(size * 1.15))}px ${FONT_UI}`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(glyph.mark, q.x, q.y + 1);
}

const FOG_VEIL = '#121C23A8';
const fogSets = new WeakMap<readonly number[], Set<number>>();
const fogSet = (scene: MapScene) => { let set = fogSets.get(scene.fog); if (!set) { set = new Set(scene.fog); fogSets.set(scene.fog, set); } return set; };
/** A prop canvas with the fog veil composited onto its pixels (cached per prop canvas). */
const veiled = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function veiledArt(art: HTMLCanvasElement): HTMLCanvasElement {
  let copy = veiled.get(art);
  if (copy) return copy;
  const { element, context } = canvas(art.width, art.height);
  context.drawImage(art, 0, 0);
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = FOG_VEIL; context.fillRect(0, 0, art.width, art.height);
  veiled.set(art, copy = element);
  return copy;
}
/** Adds a tile column's veil outline (top face and its visible SW / SE cliffs) to a path. */
function veilOutline(path: Path2D, scene: MapScene, lifts: Float32Array, index: number, p: Point, radius: number, zoom: number, squash: number) {
  const lift = lifts[index];
  const h = (direction: number) => { const other = neighbourIndex(scene, index, direction); return Math.max(0, (lift - (other < 0 ? ELEVATION.unknown : lifts[other])) * zoom); };
  const hw = h(SW), he = h(SE), pt = (k: number, down = 0) => ({ x: p.x + radius * CORNERS[k].x, y: p.y + radius * CORNERS[k].y * squash + down });
  // Outline: top corners 5, 0, 1, then down the SE face, along the bottom, up the SW face, back to 3 and 4.
  const outline = [pt(5), pt(0), pt(1), pt(1, he), pt(2, Math.max(he, hw)), pt(3, hw), pt(3), pt(4)];
  outline.forEach((q, i) => i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y));
  path.closePath();
}

/** The 2.5D fog veil: top face plus the visible cliff faces of every remembered-but-not-visible tile. */
export function drawFog25d(b: Base25d): void {
  const { context, scene, lifts, radius, zoom, squash } = b;
  const margin = radius * 2;
  // One path for every veiled column (each covers its top face and visible cliffs), one fill, then one clipped hatch.
  const veil = new Path2D();
  let any = false;
  for (const centres of b.copies) for (const index of scene.fog) {
    const p = centres[index];
    if (p.x < -margin || p.x > b.width + margin || p.y < -margin || p.y > b.height + margin) continue;
    veilOutline(veil, scene, lifts, index, p, radius, zoom, squash);
    any = true;
  }
  if (!any) return;
  context.save();
  context.fillStyle = FOG_VEIL; context.fill(veil);
  context.clip(veil);
  context.strokeStyle = '#E8F0F012'; context.lineWidth = 1;
  context.beginPath();
  for (let x = -b.height; x < b.width + b.height; x += 7) { context.moveTo(x, b.height + 8); context.lineTo(x + b.height + 16, -8); }
  context.stroke();
  context.restore();
}

// ---------- Pixel art at whole scales (fidelity pass, docs/design/fidelity/README.md) ----------
// Pixel art on the map at any zoom and DPR without uneven pixels. Drawing a pixel
// canvas at 1.83× with smoothing off makes some art pixels 3 device pixels wide and others 4 (and drops rows when shrinking);
// with smoothing on it blurs. Instead every blit goes through `drawPixelArt`:
// - at a whole device scale (or one that may snap to it, see SNAP) the art is drawn nearest-neighbour, aligned to device pixels;
// - between whole scales it is first enlarged nearest-neighbour to the next whole scale (cached), then shrunk smoothly to the
//   exact size, so all art pixels are the same size and only their edges are anti-aliased ("sharp bilinear");
// - below 1× it is shrunk smoothly (snapped to 1/2, 1/3 … when allowed), which averages pixels instead of dropping them.
// Ground textures that must tile pass `snap: false` (exact size); props, towns and sprites may snap (their size is free).
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
