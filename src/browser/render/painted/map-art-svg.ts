// 绘卷 map art, option A (docs/design/map-art-options.md): original authored SVG pieces (public/map-art/painted/, drawn for this
// project, no third-party sources — public/map-art/README.md) composed into the painted theme's prop, town and coast caches at the
// exact device size. Each piece has its anchor at (0, 0) and 100 units per tile radius; a piece is rasterised once per size step and
// blitted, so a tile costs a handful of drawImage calls. Tiles vary by the stable per-tile variant (terrain.ts variantOf) and, for
// woods, by which neighbours are wooded; nothing is random at draw time. Fogged tiles get the same composition in brown ink (inked()).
import type { LandmarkId } from '../../../content/terrain.ts';
import { dab, darken, lighten, makeCanvas, spriteCache, stream } from './kit.ts';
import type { ArtProp, ArtTile, ArtTown, ArtTownLook, CoastEnd, MapArt, Shore } from './map-art.ts';

const BASE = '/map-art/painted/';
const PIECES = [
  'tree-oak', 'tree-linden', 'tree-fir', 'tree-spruce', 'tree-fir-snow', 'tree-palm', 'tree-dead', 'tree-charred',
  'bush', 'bush-berry', 'flowers', 'cactus-saguaro', 'cactus-pad', 'rocks-sand', 'rocks-grey', 'rocks-snow', 'rocks-dark', 'dune', 'drift', 'reeds', 'lilypads',
  'hill-grass', 'hill-desert', 'hill-snow', 'mountain-high', 'mountain-mid', 'mountain-low', 'mountain-far', 'volcano', 'volcano-2',
  'coast-sand', 'coast-snow', 'coast-rock', 'coast-volcanic',
  'house-cottage', 'house-tall', 'house-long', 'town-hall', 'keep', 'wall-back', 'wall-front', 'wonder', 'market',
  'landmark-singing-dunes', 'landmark-stardust-mere', 'landmark-elder-canopy', 'landmark-thunder-mesa', 'landmark-mistlock-gorge',
  'landmark-tidesong-grotto', 'landmark-everfrost-hollow', 'landmark-ember-caldera',
] as const;
type Name = typeof PIECES[number];
type Piece = { image: HTMLImageElement; x: number; y: number; w: number; h: number; windows: readonly (readonly [number, number])[] };
/** Owner colours a town can take (canvas2d.ts FACTIONS, wild and unknown). */
const TOWN_COLORS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45', '#855000', '#5F6E66'];
/** Plain roofs (tile red, burnt orange, weathered brown) with their lit eave colour. */
const ROOFS: readonly (readonly [string, string])[] = [['#C4553A', '#E58A5E'], ['#B5643C', '#D98A5C'], ['#8E6A4A', '#B48A62']];
const HOUSES = ['house-cottage', 'house-tall', 'house-long'] as const;
type House = typeof HOUSES[number];
/** Pieces whose look depends on the owner colour (CSS variables on the root element). */
const ACCENTED: readonly Name[] = ['town-hall', 'keep', 'wall-front'];
/** The tilt the pieces are drawn for (projection.ts PAINTED_TILT). */
const SQUASH = .8;
/** HEX_DIRECTIONS screen angles (E, NE, NW, W, SW, SE). */
const ANGLES = [0, -60, -120, 180, 120, 60].map(degrees => degrees * Math.PI / 180);
const LANDMARK_PIECE: Record<LandmarkId, Name> = {
  singingDunes: 'landmark-singing-dunes', stardustMere: 'landmark-stardust-mere', elderCanopy: 'landmark-elder-canopy', thunderMesa: 'landmark-thunder-mesa',
  mistlockGorge: 'landmark-mistlock-gorge', tidesongGrotto: 'landmark-tidesong-grotto', everfrostHollow: 'landmark-everfrost-hollow', emberCaldera: 'landmark-ember-caldera',
};
const INK = [74, 52, 32], PAPER = [246, 234, 200];

async function decode(text: string): Promise<Piece> {
  const [x, y, w, h] = /viewBox="([^"]+)"/.exec(text)![1].split(/[\s,]+/).map(Number);
  const windows = [...text.matchAll(/data-win="([-\d.]+) ([-\d.]+)"/g)].map(match => [Number(match[1]), Number(match[2])] as const);
  const image = new Image();
  image.decoding = 'async';
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { image, x, y, w, h, windows };
}
/** The text with its root CSS variables replaced (roof and owner colours). */
const recolour = (text: string, vars: Record<string, string>) =>
  text.replace(/(<svg[^>]*?) style="[^"]*"/, `$1 style="${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}"`);
const accentVars = (color: string) => ({ '--accent': color, '--accent-light': lighten(color, .32), '--accent-dark': darken(color, .3) });

export async function loadSvgArt(): Promise<MapArt> {
  const texts = new Map<Name, string>();
  await Promise.all(PIECES.map(async name => {
    const response = await fetch(`${BASE}${name}.svg`);
    if (!response.ok) throw new Error(`${name}.svg: ${response.status}`);
    texts.set(name, await response.text());
  }));
  const pieces = new Map<string, Piece>();
  const jobs: Promise<void>[] = PIECES.map(name => decode(texts.get(name)!).then(piece => { pieces.set(name, piece); }));
  // Houses in each plain roof, and every owner-coloured piece in each owner colour.
  for (const house of HOUSES) for (const [roof, edge] of ROOFS) jobs.push(decode(recolour(texts.get(house)!, { '--roof': roof, '--roof-edge': edge })).then(piece => { pieces.set(`${house}@${roof}`, piece); }));
  for (const color of TOWN_COLORS) {
    const vars = accentVars(color);
    for (const house of HOUSES) jobs.push(decode(recolour(texts.get(house)!, { '--roof': color, '--roof-edge': vars['--accent-light'] })).then(piece => { pieces.set(`${house}@${color}`, piece); }));
    for (const name of ACCENTED) jobs.push(decode(recolour(texts.get(name)!, vars)).then(piece => { pieces.set(`${name}@${color}`, piece); }));
  }
  await Promise.all(jobs);
  const piece = (id: string) => pieces.get(id)!;

  // ---------- Rasters ----------
  const rasters = spriteCache<HTMLCanvasElement>(700);
  /** `id` rasterised at `unit` device px per SVG unit, with a 1 px margin. */
  const raster = (id: string, unit: number) => rasters.get(`${id}|${unit}`, () => {
    const p = piece(id), { canvas, context } = makeCanvas(p.w * unit + 2, p.h * unit + 2);
    context.drawImage(p.image, 1, 1, p.w * unit, p.h * unit);
    return canvas;
  });
  /** Raster sizes: one per octave (the next power of two up), drawn smaller with high-quality smoothing; rasters are shared across zoom buckets. */
  const stepOf = (want: number) => 2 ** Math.ceil(Math.log2(want) - 1e-9);
  /** Draws piece `id` with its anchor at tile units (x, y) from the canvas point (cx, cy); `unit` = device px per tile unit. */
  const put = (g: CanvasRenderingContext2D, id: string, cx: number, cy: number, unit: number, x: number, y: number, scale = 1) => {
    const p = piece(id), want = unit * scale, step = stepOf(want), r = raster(id, step), k = want / step;
    g.drawImage(r, cx + (x + p.x * scale) * unit - k, cy + (y + p.y * scale) * unit - k, r.width * k, r.height * k);
  };

  // Rasterising an SVG is the expensive step (0.3–2 ms a piece); do it in idle time for the raster sizes the usual zooms need
  // (zoom 1–3 at this device's pixel ratio), so baking a tile is only blits. Zooms outside that range rasterise on first use.
  const scale = stepOf(Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)) / 2;
  const queue = [1, .5, 2].flatMap(step => [...pieces.keys()].map(id => [id, step * scale] as const));
  // Ranges and volcanoes are drawn above full size, so close up they need the next raster up as well.
  for (const id of ['mountain-high', 'mountain-mid', 'mountain-low', 'mountain-far', 'volcano', 'volcano-2']) queue.push([id, 4 * scale]);
  // So are a village's houses and a small capital's keep.
  for (const id of pieces.keys()) if (/^(house-|town-hall@|keep@)/.test(id)) queue.push([id, 4 * scale]);
  const idle = (work: (until: () => boolean) => void) => typeof requestIdleCallback === 'function'
    ? requestIdleCallback(deadline => work(() => deadline.timeRemaining() > 2), { timeout: 2000 })
    : setTimeout(() => { const end = performance.now() + 8; work(() => performance.now() < end); }, 30);
  const warm = (until: () => boolean) => {
    while (queue.length && until()) { const [id, step] = queue.shift()!; raster(id, step); }
    if (queue.length) idle(warm);
  };
  idle(warm);

  // ---------- Tile props ----------
  type Item = { id: string; x: number; y: number; s: number };
  /** The pieces of a tile, back to front, in tile units (y already squashed); `under` is painted first (hill domes, woodland floor). */
  type Scene = { items: Item[]; under?: (g: CanvasRenderingContext2D, cx: number, cy: number, unit: number) => void };
  const seedOf = (tile: ArtTile) => 7919 * (tile.biome.length + 3) + tile.biome.charCodeAt(0) * 131 + tile.variant * 104729 + (tile.hill ? 17 : 0) + (tile.peak ? 29 : 0) + tile.woods * 7 + tile.alt * 3301;

  /** A wood: trees on a jittered grid inside the hex; the rim facing open land thins to saplings and shrubs, the rim facing more woods stays full. */
  function woods(tile: ArtTile, rnd: () => number, lift: (x: number, y: number) => number): Item[] {
    const mix = ([[['tree-oak', .7], ['tree-linden', .12], ['tree-fir', .18]], [['tree-oak', .55], ['tree-linden', .25], ['tree-fir', .2]],
      [['tree-fir', .55], ['tree-spruce', .4], ['tree-oak', .05]], [['tree-oak', .36], ['tree-fir', .34], ['tree-linden', .15], ['tree-spruce', .15]]] as const)[tile.variant] ?? [['tree-oak', 1]];
    const pick = () => { let r = rnd(); for (const [id, share] of mix) { if ((r -= share) <= 0) return id; } return mix[0][0]; };
    const items: Item[] = [];
    for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
      const x = col * 36 + (row % 2 ? 18 : 0) + (rnd() - .5) * 14, y = row * 25 + (rnd() - .5) * 9, uy = y / SQUASH;
      let reach = -1, side = 0;
      for (let d = 0; d < 6; d++) { const n = x * Math.cos(ANGLES[d]) + uy * Math.sin(ANGLES[d]); if (n > reach) { reach = n; side = d; } }
      if (reach > 80) continue;
      const open = !(tile.woods >> side & 1);
      if (reach > 54 && open) {
        // The wood's edge: about half the rim slots get a sapling or a shrub.
        const r = rnd();
        if (r < .3) items.push({ id: pick(), x, y: y - lift(x, y), s: .44 + rnd() * .08 });
        else if (r < .5) items.push({ id: rnd() < .5 ? 'bush' : 'bush-berry', x, y: y + 4 - lift(x, y), s: .8 + rnd() * .2 });
        continue;
      }
      // A few clearings inside the wood, so it reads as trees rather than a carpet.
      if (rnd() < .14) { if (rnd() < .5) items.push({ id: 'bush', x, y: y + 4 - lift(x, y), s: .85 }); continue; }
      items.push({ id: pick(), x, y: y - lift(x, y), s: (.64 + rnd() * .12) * (1 + Math.max(0, -y) / 260) });
    }
    return items;
  }
  const hillLift = (x: number, y: number) => 30 * Math.max(0, 1 - Math.hypot(x / 100, (y - 6) / 80) * 1.25);
  const domeOf = (tile: ArtTile) => tile.biome === 'desert' ? 'hill-desert' : tile.biome === 'snow' ? 'hill-snow' : 'hill-grass';

  function compose(tile: ArtTile): Scene | null {
    const rnd = stream(seedOf(tile)), v = tile.variant, items: Item[] = [];
    if (tile.landmark) return { items: [{ id: LANDMARK_PIECE[tile.landmark], x: 0, y: 6, s: 1.09 }] };
    const hill = tile.hill && tile.biome !== 'mountain' && tile.biome !== 'volcano' && tile.biome !== 'ocean';
    // Hills: a broad dome, a smaller one behind it on odd variants; whatever stands on the tile rises with the dome.
    const domes: Item[] = hill ? [...(v % 2 ? [{ id: domeOf(tile), x: 30, y: -20, s: .62 }] : []), { id: domeOf(tile), x: -4, y: 26, s: 1.12 }] : [];
    const lift = hill ? hillLift : () => 0;
    const at = (id: string, x: number, y: number, s: number) => items.push({ id, x, y: y - lift(x, y), s });
    switch (tile.biome) {
      case 'forest': {
        const trees = woods(tile, rnd, lift);
        return { items: [...domes, ...trees], under: (g, cx, cy, unit) => {
          // A soft woodland floor under the trees, so a wood reads as one stand rather than loose trees.
          for (const tree of trees) if (tree.s > .5) dab(g, cx + tree.x * unit, cy + (tree.y + 3) * unit, 24 * unit, 12 * unit, '#2E4A22', .16);
        } };
      }
      case 'grassland':
        if (v === 0) { at('bush', -30, 18, 1.1); at('bush', 34, 30, .95); at('flowers', 4, 44, 1.1); }
        else if (v === 1) { at('bush-berry', 26, 12, 1.15); at('flowers', -34, 34, 1.1); }
        else if (v === 2) { at('flowers', -18, -6, 1); at('flowers', 30, 40, .9); at('bush', -40, 40, .85); }
        else if (hill) { at('tree-oak', 8, 14, .62); at('bush', -36, 36, .9); }
        else { at('tree-oak', -26, 6, .66); at('tree-linden', 22, 0, .6); at('tree-fir', 4, 30, .62); at('bush', 44, 40, .8); }
        break;
      case 'desert':
        if (v === 0 && !hill && tile.alt) {
          at('tree-palm', -34, 20, .78); at('tree-palm', 30, 8, .9); at('bush', -6, 42, .7);
          return { items: [...items].sort((a, b) => a.y - b.y), under: (g, cx, cy, unit) => {
            // An oasis pool.
            g.beginPath(); g.ellipse(cx - 2 * unit, cy + 26 * unit, 34 * unit, 15 * unit, 0, 0, Math.PI * 2); g.fillStyle = '#C49450'; g.fill();
            g.beginPath(); g.ellipse(cx - 2 * unit, cy + 26 * unit, 30 * unit, 12.5 * unit, 0, 0, Math.PI * 2); g.fillStyle = '#4FB0C6'; g.fill();
            g.lineWidth = Math.max(1, 1.2 * unit); g.strokeStyle = 'rgba(43,30,16,.55)'; g.stroke();
            dab(g, cx - 12 * unit, cy + 22 * unit, 12 * unit, 3 * unit, '#E8FBFF', .8);
          } };
        }
        if (v === 0) { at('dune', -10, 0, 1); at('tree-palm', 36, 30, .7); at('rocks-sand', -40, 40, .6); }
        else if (v === 1) { at('dune', 22, -16, .7); at('cactus-saguaro', -16, 20, 1.15); at('rocks-sand', 40, 40, .7); }
        else if (v === 2) { at('dune', -16, 4, .95); at('rocks-sand', 36, 34, .9); at('cactus-pad', -42, 40, .8); }
        else { at('dune', 6, -22, .8); at('cactus-pad', 34, 20, 1); at('cactus-saguaro', -26, 34, .95); }
        break;
      case 'snow':
        if (v === 0) { at('tree-fir-snow', -26, 6, .68); at('tree-fir-snow', 16, 26, .74); at('drift', 40, 44, .8); }
        else if (v === 1) { at('tree-fir-snow', 20, -10, .62); at('tree-fir-snow', -34, 18, .7); at('tree-fir-snow', 8, 36, .74); }
        else if (v === 2) { at('drift', -22, 10, 1); at('rocks-snow', 30, 30, .85); at('tree-dead', -42, 40, .7); }
        else { at('tree-fir-snow', -10, 14, .76); at('rocks-snow', 34, 36, .75); at('drift', -40, 42, .7); }
        break;
      case 'mountain':
        // A range fills its tile and reaches into the row behind, as the procedural massifs do.
        if (tile.peak) { at('mountain-far', -44, -10, 1); at('mountain-high', 2, 32, 1.28); at('mountain-low', 52, 40, .9); at('rocks-snow', -50, 52, .66); }
        else if (v === 0) { at('mountain-far', -40, -16, 1.08); at('mountain-far', 44, -20, .96); at('mountain-mid', -2, 30, 1.3); at('rocks-grey', 48, 50, .66); at('tree-fir', -60, 50, .58); }
        else if (v === 1) { at('mountain-far', 32, -20, 1.12); at('mountain-mid', -24, 22, 1.24); at('mountain-low', 44, 42, 1.1); at('rocks-grey', -54, 50, .62); }
        else if (v === 2) { at('mountain-low', -42, 10, 1.1); at('mountain-mid', 14, 34, 1.32); at('tree-spruce', 58, 50, .56); at('tree-fir', -62, 48, .52); }
        else { at('mountain-far', -42, -18, 1.02); at('mountain-far', 38, -14, 1.08); at('mountain-low', -22, 40, 1.18); at('mountain-mid', 30, 34, 1.12); }
        break;
      case 'volcano':
        at(v % 2 ? 'volcano-2' : 'volcano', 0, 34, 1.28); at('rocks-dark', -56, 50, .6);
        if (v < 2) at('tree-charred', 60, 46, .62); else at('rocks-dark', 56, 48, .5);
        break;
      case 'ocean':
        if (!tile.lake) return null;
        if (v === 0) { at('reeds', -50, 34, 1.05); at('lilypads', 18, -10, 1); }
        else if (v === 1) { at('reeds', 48, 30, 1); at('lilypads', -16, 12, 1.05); }
        else if (v === 2) at('lilypads', 10, 20, 1.1);
        else { at('reeds', -14, -40, .95); at('lilypads', 30, 24, 1); }
        break;
    }
    // The other half of the tiles mirror the layout (positions only: the pieces keep their north-west light).
    if (tile.alt) for (const item of items) item.x = -item.x;
    return { items: [...domes, ...items.sort((a, b) => a.y - b.y)] };
  }
  const props = spriteCache<ArtProp>(260);
  /** A tile's props, cropped to what is drawn (so blitting a tile moves only its pixels); (ox, oy) is the tile centre in the canvas. */
  const bake = (tile: ArtTile, R: number) => props.get(`${key(tile)}|${R}`, (): ArtProp => {
    const scene = compose(tile);
    if (!scene || (!scene.items.length && !scene.under)) return null;
    // Bounds in tile units: every piece's box, grown by the reach of the floor or pool painted under them.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { id, x, y, s: k } of scene.items) {
      const p = piece(id);
      x0 = Math.min(x0, x + p.x * k); y0 = Math.min(y0, y + p.y * k); x1 = Math.max(x1, x + (p.x + p.w) * k); y1 = Math.max(y1, y + (p.y + p.h) * k);
    }
    if (scene.under) { x0 = Math.min(x0, -40) - 26; x1 = Math.max(x1, 40) + 26; y0 -= 14; y1 = Math.max(y1, 45) + 14; }
    x0 = Math.max(x0, -130); x1 = Math.min(x1, 130); y0 = Math.max(y0, -230); y1 = Math.min(y1, 110);
    const unit = R / 100, left = Math.floor(x0 * unit) - 2, top = Math.floor(y0 * unit) - 2;
    const { canvas, context: g } = makeCanvas(Math.ceil(x1 * unit) + 2 - left, Math.ceil(y1 * unit) + 2 - top), cx = -left, cy = -top;
    const domes = scene.items.filter(item => item.id.startsWith('hill-')), rest = scene.items.filter(item => !item.id.startsWith('hill-'));
    for (const item of domes) put(g, item.id, cx, cy, unit, item.x, item.y, item.s);
    scene.under?.(g, cx, cy, unit);
    for (const item of rest) put(g, item.id, cx, cy, unit, item.x, item.y, item.s);
    return { canvas, ox: cx, oy: cy };
  });
  const key = (tile: ArtTile) => `${tile.biome}|${tile.variant}${tile.alt}|${tile.hill ? 1 : 0}${tile.peak ? 1 : 0}|${tile.lake ? 'L' : ''}|${tile.landmark ?? ''}|${tile.biome === 'forest' ? tile.woods : ''}`;

  /** A prop canvas redrawn as the fog's ink: dark lines become brown ink, light fills a pale wash, so it sits on the parchment. */
  const inkOf = (source: HTMLCanvasElement) => {
    const { canvas, context } = makeCanvas(source.width, source.height);
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (!a) continue;
      // Dark outlines become firm ink lines; mid tones a light hatch-like wash; light fills almost vanish into the paper.
      const lum = (data[i] * .3 + data[i + 1] * .59 + data[i + 2] * .11) / 255, line = Math.min(1, Math.max(0, (.42 - lum) / .3)), t = Math.min(1, lum);
      data[i] = INK[0] + (PAPER[0] - INK[0]) * t * .5; data[i + 1] = INK[1] + (PAPER[1] - INK[1]) * t * .5; data[i + 2] = INK[2] + (PAPER[2] - INK[2]) * t * .5;
      data[i + 3] = a * (.1 + .12 * (1 - t) + .62 * line);
    }
    context.putImageData(image, 0, 0);
    return canvas;
  };

  // ---------- Towns ----------
  type Place = { id: string; x: number; y: number; s: number };
  function townPlan(look: ArtTownLook): { places: Place[]; walled: boolean; plaza: number } {
    const accent = look.color, roof = (k: number) => ROOFS[k % ROOFS.length][0];
    const house = (kind: House, x: number, y: number, s: number, colour: string): Place => ({ id: `${kind}@${colour}`, x, y, s });
    const civic = (x: number, y: number, s: number): Place => ({ id: `${look.capital ? 'keep' : 'town-hall'}@${accent}`, x, y, s });
    const pop = look.population, walled = look.capital || pop >= 8;
    let places: Place[];
    if (walled) {
      places = [house('house-tall', -42, -34, 1.02, accent), house('house-cottage', 2, -44, 1.05, roof(1)), house('house-tall', 44, -32, 1, roof(0)),
        house('house-long', -70, -4, .98, roof(2)), civic(-2, -2, 1.12), house('house-cottage', 56, 0, 1.08, accent),
        house('house-cottage', -40, 26, 1.08, roof(0)), house('house-tall', 34, 28, 1.02, accent), { id: 'market', x: -4, y: 30, s: 1.1 }];
      if (look.wonders) places[2] = { id: 'wonder', x: 44, y: -30, s: 1.05 };
    } else if (pop >= 4) {
      places = [house('house-cottage', -50, -28, 1.22, accent), house('house-tall', 44, -32, 1.16, roof(0)), civic(0, -8, 1.2),
        house('house-long', -70, 14, 1.08, roof(1)), house('house-cottage', 54, 12, 1.2, accent), house('house-tall', -20, 40, 1.14, roof(2)),
        house('house-cottage', 26, 44, 1.14, roof(0)), { id: 'market', x: 2, y: 22, s: 1.15 }, { id: 'tree-oak', x: 74, y: -6, s: .5 }];
      if (look.wonders) places[1] = { id: 'wonder', x: 46, y: -32, s: 1.1 };
    } else {
      places = [house('house-cottage', -6, -22, 1.5, accent), house('house-long', -52, 8, 1.36, roof(1)), house('house-tall', 40, 0, 1.4, roof(0)),
        house('house-cottage', 2, 36, 1.42, roof(2)), { id: 'tree-oak', x: -60, y: -26, s: .56 }, { id: 'tree-linden', x: 62, y: -28, s: .52 },
        { id: 'bush', x: -36, y: 46, s: .9 }, { id: 'flowers', x: 44, y: 44, s: 1 }];
      if (look.capital) places[0] = civic(-6, -20, 1.25);
      if (look.wonders) places.push({ id: 'wonder', x: 58, y: -36, s: 1 });
    }
    return { places: places.sort((a, b) => a.y - b.y), walled, plaza: walled ? 84 : pop >= 4 ? 80 : 70 };
  }
  /**
   * A coast edge with both ends mitred along the line through the corner and the centre of the water tile (a bay) or of the land
   * tile (a cape), so neighbouring edges meet without the surf doubling up; one raster pixel of overlap hides the seam. Baked once
   * per shore, raster size and pair of ends, so drawing an edge is a single blit.
   */
  const mitres = spriteCache<HTMLCanvasElement>(160);
  const mitred = (shore: Shore, step: number, ends: readonly [CoastEnd, CoastEnd]) => mitres.get(`${shore}|${step}|${ends[0]}|${ends[1]}`, () => {
    const id = `coast-${shore}`, p = piece(id), sprite = raster(id, step), pad = 1 / step;
    const left = (y: number) => ends[0] === 'bay' ? -50 + 50 * y / 86.6 - pad : ends[0] === 'cape' ? -50 - 50 * y / 86.6 - pad : p.x;
    const right = (y: number) => ends[1] === 'bay' ? 50 - 50 * y / 86.6 + pad : ends[1] === 'cape' ? 50 + 50 * y / 86.6 + pad : p.x + p.w;
    const { canvas, context } = makeCanvas(sprite.width, sprite.height), X = (u: number) => (u - p.x) * step + 1, Y = (u: number) => (u - p.y) * step + 1;
    const top = p.y, bottom = p.y + p.h;
    context.beginPath(); context.moveTo(X(left(top)), Y(top)); context.lineTo(X(right(top)), Y(top)); context.lineTo(X(right(bottom)), Y(bottom)); context.lineTo(X(left(bottom)), Y(bottom));
    context.closePath(); context.clip();
    context.drawImage(sprite, 0, 0);
    return canvas;
  });
  const towns = spriteCache<ArtTown>(48);
  /** One lit window (a warm halo round a bright pane), baked once per size and stamped on every window. */
  const glows = spriteCache<HTMLCanvasElement>(16);
  const glowOf = (R: number) => glows.get(`${R}`, () => {
    const { canvas, context } = makeCanvas(R * .26, R * .22), x = canvas.width / 2, y = canvas.height / 2;
    dab(context, x, y, R * .12, R * .1, '#FFB04A', .5); dab(context, x, y, R * .035, R * .032, '#FFF0B8', 1);
    return canvas;
  });

  return {
    id: 'svg',
    landmarks: true,
    propKey: (tile: ArtTile) => (tile.biome === 'ocean' && !tile.lake && !tile.landmark ? 'sea' : key(tile)),
    prop(tile: ArtTile, R: number, sq: number): ArtProp | undefined {
      if (Math.abs(sq - SQUASH) > .01) return undefined;
      return bake(tile, R);
    },
    inked(tile: ArtTile, R: number, sq: number) {
      if (Math.abs(sq - SQUASH) > .01 || (tile.biome === 'ocean' && !tile.lake && !tile.landmark)) return undefined;
      // Plain grassland stays a chart note (the procedural ink tufts); everything that stands up is inked.
      if (tile.biome === 'grassland' && !tile.hill && !tile.landmark && tile.variant !== 3) return undefined;
      const made = bake(tile, R);
      return made ? { canvas: inkOf(made.canvas), ox: made.ox, oy: made.oy } : null;
    },
    town(look: ArtTownLook, R: number, sq: number) {
      if (Math.abs(sq - SQUASH) > .01 || !pieces.has(`town-hall@${look.color}`)) return undefined;
      const plan = townPlan(look);
      return towns.get(`${look.color}|${plan.places.map(place => place.id).join(',')}|${plan.walled}|${R}`, () => {
        const unit = R / 100, { canvas, context: g } = makeCanvas(R * 2.8, R * 2.6), cx = R * 1.4, cy = R * 1.7;
        // The ground: a packed-earth square with two lanes leaving it.
        dab(g, cx, cy + 6 * unit, plan.plaza * unit, plan.plaza * .66 * unit, '#3A2A16', .22);
        const plaza = g.createRadialGradient(cx - 18 * unit, cy - 10 * unit, 6 * unit, cx, cy + 4 * unit, plan.plaza * unit);
        plaza.addColorStop(0, '#E6D5AE'); plaza.addColorStop(.7, 'rgba(196,170,126,.9)'); plaza.addColorStop(1, 'rgba(176,149,106,0)');
        g.save(); g.translate(cx, cy + 4 * unit); g.scale(1, .66); g.beginPath(); g.arc(0, 0, plan.plaza * unit, 0, Math.PI * 2); g.restore();
        g.fillStyle = plaza; g.fill();
        g.lineCap = 'round';
        for (const [width, color] of [[11, 'rgba(150,120,80,.55)'], [8, '#D5BD90']] as const) {
          g.beginPath(); g.moveTo(cx - 92 * unit, cy + 58 * unit); g.quadraticCurveTo(cx - 40 * unit, cy + 30 * unit, cx, cy + 12 * unit);
          g.quadraticCurveTo(cx + 50 * unit, cy - 6 * unit, cx + 100 * unit, cy + 14 * unit);
          g.strokeStyle = color; g.lineWidth = width * unit; g.stroke();
        }
        const windows: [number, number][] = [];
        const place = (id: string, x: number, y: number, s: number) => {
          put(g, id, cx, cy, unit, x, y, s);
          for (const [wx, wy] of piece(id).windows) windows.push([cx + (x + wx * s) * unit, cy + (y + wy * s) * unit]);
        };
        if (plan.walled) place('wall-back', 0, 0, 1);
        for (const item of plan.places) place(item.id, item.x, item.y, item.s);
        if (plan.walled) place(`wall-front@${look.color}`, 0, 0, 1);
        const { canvas: lights, context: l } = makeCanvas(canvas.width, canvas.height);
        const glow = glowOf(R);
        for (const [x, y] of windows) l.drawImage(glow, x - glow.width / 2, y - glow.height / 2);
        dab(l, cx, cy, R * .9, R * .6 * SQUASH, '#FFA040', .14);
        return { town: canvas, lights };
      });
    },
    coastEdge(g: CanvasRenderingContext2D, radius: number, R: number, shore: Shore, ends: readonly [CoastEnd, CoastEnd]) {
      const step = stepOf(R / 100), sprite = mitred(shore, step, ends), p = piece(`coast-${shore}`), k = radius / 100, px = k / step;
      g.drawImage(sprite, p.x * k - px, p.y * k - px, sprite.width * px, sprite.height * px);
      return true;
    },
  };
}
