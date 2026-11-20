// Map-art option A (docs/design/map-art-options.md): original authored SVGs (public/map-art/painted/, drawn for this project, no
// third-party sources) rasterised into the painted theme's prop / town / coast caches at the exact device size. Dev-only: installed by
// `?mapart=svg` (map-art.ts). Covers the comparison subset — broadleaf, pine and mixed woods, lone trees, grassy hills, a
// mountain range, a high peak, sandy coast edges and one town size; everything else falls back to the procedural art.
import type { BiomeId } from '../../../content/rules.ts';
import { dab, darken, lighten, makeCanvas, spriteCache } from './kit.ts';
import type { ArtProp, ArtTown, ArtTownLook, MapArt } from './map-art.ts';

const FILES = ['forest-broadleaf', 'forest-pine', 'forest-mixed', 'tree-oak', 'tree-fir', 'hills', 'mountains', 'mountain-peak', 'coast-edge'] as const;
type Name = typeof FILES[number];
/** Owner colours a town can take (canvas2d.ts FACTIONS plus wild and unknown). */
const TOWN_COLORS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45', '#855000', '#5F6E66'];
/** Painted tilt the art is drawn for (projection.ts PAINTED_TILT). */
const SQUASH = .8;
/** Window / glow spots of town.svg in its own units (tile centre at 140, 170). */
const TOWN_WINDOWS: readonly [number, number][] = [[104, 122], [182, 120], [124, 146], [150, 148], [121, 128], [84, 160], [200, 158], [116, 192], [172, 194], [96, 162], [128, 196]];

function load(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  return image.decode().then(() => image);
}

export async function loadSvgArt(): Promise<MapArt> {
  const base = '/map-art/painted/';
  const images = new Map<Name, HTMLImageElement>();
  await Promise.all(FILES.map(name => load(`${base}${name}.svg`).then(image => { images.set(name, image); })));
  // The town's accent roofs read CSS variables from the root element: one decoded copy per owner colour.
  const townText = await (await fetch(`${base}town.svg`)).text();
  const towns = new Map<string, HTMLImageElement>();
  await Promise.all(TOWN_COLORS.map(color => {
    const text = townText.replace(/style="--accent:[^"]*"/, `style="--accent:${color};--accent-light:${lighten(color, .3)};--accent-dark:${darken(color, .32)}"`);
    return load(URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))).then(image => { towns.set(color, image); });
  }));
  const svg = (name: Name) => images.get(name)!;
  const props = spriteCache<ArtProp>(200), townCache = spriteCache<ArtTown>(48), edges = spriteCache<HTMLCanvasElement>(24);

  /** Prop canvas in the procedural frame (2.6 R × 3.4 R, tile centre at 1.3 R, 2.3 R); the SVG frame is 260 × 340 with R = 100. */
  const propCanvas = (R: number, paint: (g: CanvasRenderingContext2D, unit: number) => void): ArtProp => {
    const { canvas, context: g } = makeCanvas(R * 2.6, R * 3.4);
    paint(g, R / 100);
    return { canvas, ox: R * 1.3, oy: R * 2.3 };
  };
  const tile = (g: CanvasRenderingContext2D, name: Name, unit: number, dx = 0, dy = 0, scale = 1) => {
    // Scale about the tile centre (130, 230).
    const w = 260 * unit * scale, h = 340 * unit * scale;
    g.drawImage(svg(name), 130 * unit * (1 - scale) + dx * unit, 230 * unit * (1 - scale) + dy * unit, w, h);
  };
  const tree = (g: CanvasRenderingContext2D, name: 'tree-oak' | 'tree-fir', unit: number, x: number, y: number, scale: number) => {
    // tree-*.svg: 80 × 90, trunk base at (40, 84); (x, y) in tile units.
    g.drawImage(svg(name), (x - 40 * scale) * unit, (y - 84 * scale) * unit, 80 * scale * unit, 90 * scale * unit);
  };

  return {
    id: 'svg',
    prop(biome: BiomeId, variant: number, hill: boolean, peak: boolean, R: number, sq: number) {
      if (Math.abs(sq - SQUASH) > .01) return undefined;
      const grassyHill = hill && (biome === 'grassland' || biome === 'forest');
      if (biome === 'forest') {
        const wood: Name = (['forest-broadleaf', 'forest-broadleaf', 'forest-pine', 'forest-mixed'] as const)[variant] ?? 'forest-broadleaf';
        return props.get(`${biome}|${variant}|${hill}|${R}`, () => propCanvas(R, (g, unit) => {
          if (grassyHill) { tile(g, 'hills', unit); tile(g, wood, unit, 0, -26, .9); } else tile(g, wood, unit, variant === 1 ? 8 : 0);
        }));
      }
      if (biome === 'mountain') {
        return props.get(`${biome}|${variant}|${peak}|${R}`, () => propCanvas(R, (g, unit) => tile(g, peak ? 'mountain-peak' : 'mountains', unit, (variant % 2 ? 1 : -1) * 6)));
      }
      if (biome === 'grassland' && grassyHill) return props.get(`hill|${variant}|${R}`, () => propCanvas(R, (g, unit) => tile(g, 'hills', unit)));
      if (biome === 'grassland' && variant === 3 && !peak) {
        return props.get(`copse|${R}`, () => propCanvas(R, (g, unit) => {
          tree(g, 'tree-oak', unit, 112, 220, .82); tree(g, 'tree-fir', unit, 150, 226, .8); tree(g, 'tree-oak', unit, 136, 250, .9);
        }));
      }
      return undefined;
    },
    town(look: ArtTownLook, R: number) {
      const image = towns.get(look.color);
      if (!image) return undefined;
      return townCache.get(`${look.color}|${R}`, () => {
        const unit = R / 100, { canvas, context: g } = makeCanvas(R * 2.8, R * 2.6);
        g.drawImage(image, 0, 0, 280 * unit, 260 * unit);
        const { canvas: lights, context: l } = makeCanvas(canvas.width, canvas.height);
        for (const [x, y] of TOWN_WINDOWS) { dab(l, x * unit, y * unit, R * .14, R * .11, '#FFB04A', .55); dab(l, x * unit, y * unit, R * .045, R * .04, '#FFF0B8', 1); }
        dab(l, 140 * unit, 170 * unit, R * .9, R * .6 * SQUASH, '#FFA040', .16);
        return { town: canvas, lights };
      });
    },
    coastEdge(g: CanvasRenderingContext2D, radius: number, R: number, shore: 'sand' | 'snow' | 'volcanic' | 'rock') {
      if (shore !== 'sand') return false;
      // coast-edge.svg spans 112 × 40 units around the edge midpoint; 100 units = one edge = one radius.
      const sprite = edges.get(`${R}`, () => {
        const unit = R / 100, { canvas, context } = makeCanvas(112 * unit, 40 * unit);
        context.drawImage(svg('coast-edge'), 0, 0, 112 * unit, 40 * unit);
        return canvas;
      });
      const k = radius / 100;
      g.drawImage(sprite, -56 * k, -16 * k, 112 * k, 40 * k);
      return true;
    },
  };
}
