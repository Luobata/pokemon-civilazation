// ui-painted §2 (docs/design/ui-painted.md): the painted terrain. Every biome is an illustrated ground sprite (gradient, soft dabs,
// brush strokes, feathered edge so neighbouring tiles blend) baked once per kind × variant × size bucket × tilt; standing props
// (round-canopy trees, rounded massifs with snow caps, soft hill domes, a smoking cone) are baked the same way. The base painter
// lays them out back to front and adds sandy beaches with surf, river ribbons and the civ-coloured border ribbons.
//
// Chunk mode (rows / cols given): the chunk paints its own tiles plus a ring of neighbours (so feathers and props that reach into
// its hexes are present) and clips to the union of its own hexes — every world pixel is painted by exactly one chunk, fully, so
// chunk seams are invisible whatever order the chunks are blitted in.
import type { LandmarkId } from '../../../content/terrain.ts';
import type { BiomeId } from '../../../content/rules.ts';
import type { Point } from '../../camera.ts';
import type { MapScene } from '../scene.ts';
import { landmarkGlyph } from '../terrain-features.ts';
import { neighbourIndexOf } from '../projection.ts';
import type { Base25d } from '../terrain25d.ts';
import { DIRECTION_ANGLES, EDGE_CORNERS, SERIF, addHex, alpha, bucket, corner, dab, darken, hexPath, lighten, makeCanvas, mix, noise, spriteCache, stream, stroke } from './kit.ts';

export type GroundKind = BiomeId | 'shallow' | 'deep' | 'lake' | 'unknown';
type Palette = { base: string; light: string; dark: string; tones: readonly string[] };
export const GROUND: Record<GroundKind, Palette> = {
  grassland: { base: '#8DB653', light: '#BCD56B', dark: '#5F8B37', tones: ['#A6C95E', '#76A345', '#C7D978', '#6E9A3F'] },
  forest: { base: '#5E8B3C', light: '#86AC4C', dark: '#3B642C', tones: ['#6F9A43', '#4C7832', '#94B457', '#557F36'] },
  desert: { base: '#E5BE72', light: '#F5DA98', dark: '#C49450', tones: ['#EFCB84', '#D6A862', '#F8E2AC', '#CF9F5A'] },
  snow: { base: '#E6EEF1', light: '#FFFFFF', dark: '#B4C7D4', tones: ['#F4F8F9', '#CCDCE5', '#DDE8EE', '#C2D4DF'] },
  mountain: { base: '#A39176', light: '#C9B694', dark: '#6F6150', tones: ['#B3A182', '#8E7D66', '#C2B08F', '#7E6E5A'] },
  volcano: { base: '#5C4541', light: '#7E5E52', dark: '#2F2426', tones: ['#6B5049', '#4A3836', '#866456', '#3D2F30'] },
  ocean: { base: '#2F86AE', light: '#4FA6CA', dark: '#1D6390', tones: ['#3A93B9', '#2779A3', '#5AAFD0', '#246F9A'] },
  shallow: { base: '#3A9DB4', light: '#6CC7C8', dark: '#2A8299', tones: ['#46A9BC', '#3290AA', '#62BFC4', '#2F8BA3'] },
  deep: { base: '#1F5482', light: '#2E6E9A', dark: '#143B62', tones: ['#25608D', '#1A4A76', '#3678A2', '#184470'] },
  lake: { base: '#55BDC2', light: '#8EE0D8', dark: '#348F9F', tones: ['#66C8C6', '#45A9B2', '#9BE5DC', '#3F9EAA'] },
  unknown: { base: '#241A13', light: '#30241A', dark: '#17110C', tones: ['#2B2017', '#1E160F', '#36291D', '#1A130D'] },
};
const WATER: ReadonlySet<GroundKind> = new Set(['ocean', 'shallow', 'deep', 'lake']);
/** Feathered edge, in radii: solid to `solid`, fading out by `outer`. Water blends over a much wider band, so the sea reads as one surface. */
// Opaque across the whole hex (so tiles tile without gaps or a step at the edge), fading over the neighbours drawn before it.
const featherOf = (kind: GroundKind) => WATER.has(kind) ? { solid: 1, outer: 1.5 } : kind === 'unknown' ? { solid: 1, outer: 1.3 } : { solid: 1, outer: 1.32 };

const grounds = spriteCache<HTMLCanvasElement>(160);
/** Ground sprite for a kind at a device-pixel radius bucket `R`; its centre is the canvas centre. */
export function groundSprite(kind: GroundKind, variant: number, R: number, squash: number): HTMLCanvasElement {
  return grounds.get(`${kind}|${variant}|${R}|${squash}`, () => {
    const { solid, outer } = featherOf(kind), w = Math.sqrt(3) * R * outer + 4, h = 2 * R * outer * squash + 4;
    const { canvas, context: g } = makeCanvas(w, h), cx = canvas.width / 2, cy = canvas.height / 2, pal = GROUND[kind];
    const rnd = stream((kind.length * 7919 + kind.charCodeAt(0) * 131 + variant * 104729) | 0);
    g.save();
    hexPath(g, cx, cy, R * outer, squash); g.clip();
    if (WATER.has(kind)) g.fillStyle = pal.base;
    else {
      // A gentle light from the north-west; kept weak so neighbouring tiles do not read as a repeated tile.
      const light = g.createLinearGradient(cx - R, cy - R * squash, cx + R * .8, cy + R * squash);
      light.addColorStop(0, mix(pal.base, pal.light, .35)); light.addColorStop(.5, pal.base); light.addColorStop(1, mix(pal.base, pal.dark, .3));
      g.fillStyle = light;
    }
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Soft colour dabs (the painterly mottling), spilling past the hex so they cross into the neighbours' blend.
    for (let k = 0; k < 18; k++) {
      const x = cx + (rnd() - .5) * R * 2.2, y = cy + (rnd() - .5) * R * 2 * squash, size = R * (.25 + rnd() * .4);
      dab(g, x, y, size, size * squash * .8, pal.tones[k % pal.tones.length], .28 + rnd() * .22);
    }
    detail(g, kind, rnd, cx, cy, R, squash, pal);
    g.restore();
    feather(g, cx, cy, R, squash, solid, outer);
    return canvas;
  });
}
/** Fades the sprite's rim from `solid` to `outer` radii (destination-out rings, smoothstep falloff). */
function feather(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, squash: number, solid: number, outer: number) {
  const steps = 12, band = (outer - solid) * R / steps;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.translate(cx, cy); g.scale(1, squash);
  g.lineJoin = 'round';
  for (let i = 0; i < steps; i++) {
    const t = (i + .5) / steps, cut = t * t * (3 - 2 * t);
    hexPath(g, 0, 0, solid * R + band * (i + .5), 1);
    g.lineWidth = band + .6; g.strokeStyle = `rgba(0,0,0,${cut.toFixed(3)})`; g.stroke();
  }
  g.restore();
}
function detail(g: CanvasRenderingContext2D, kind: GroundKind, rnd: () => number, cx: number, cy: number, R: number, sq: number, pal: Palette) {
  const at = () => ({ x: cx + (rnd() - .5) * R * 1.7, y: cy + (rnd() - .5) * R * 1.5 * sq });
  if (kind === 'grassland' || kind === 'forest') {
    // Grass flicks: little V tufts in light and dark greens.
    for (let k = 0; k < (kind === 'forest' ? 18 : 30); k++) {
      const { x, y } = at(), s = R * (.05 + rnd() * .05), tone = k % 3 ? lighten(pal.light, .1) : pal.dark;
      stroke(g, x - s * .3, y, s, -Math.PI / 2 - .5, .2, Math.max(1, R * .018), alpha(tone, .55));
      stroke(g, x + s * .3, y, s, -Math.PI / 2 + .45, -.2, Math.max(1, R * .018), alpha(tone, .55));
    }
    if (kind === 'grassland' && rnd() < .7) for (let k = 0; k < 5; k++) {
      const { x, y } = at();
      g.fillStyle = alpha(['#F6E27C', '#F7F1DA', '#F0A08E'][k % 3], .85);
      g.beginPath(); g.arc(x, y, Math.max(1, R * .028), 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'desert') {
    // Dunes: long soft ridges, lit crest over a shaded lee.
    for (let k = 0; k < 4; k++) {
      const y = cy + (k - 1.5) * R * .42 * sq + (rnd() - .5) * R * .1, x = cx + (rnd() - .5) * R * .4, length = R * (.9 + rnd() * .6);
      stroke(g, x, y + R * .04, length, 0, -.22, R * .07, alpha(pal.dark, .35));
      stroke(g, x, y, length, 0, -.22, R * .03, alpha(pal.light, .8));
    }
    for (let k = 0; k < 26; k++) { const { x, y } = at(); g.fillStyle = alpha(k % 2 ? pal.dark : '#FFF4D6', .35); g.fillRect(x, y, Math.max(1, R * .02), Math.max(1, R * .02)); }
  } else if (kind === 'snow') {
    for (let k = 0; k < 7; k++) { const { x, y } = at(); stroke(g, x, y, R * (.3 + rnd() * .4), (rnd() - .5) * .3, -.25, R * .05, alpha('#A9C0D0', .35)); }
    for (let k = 0; k < 5; k++) { const { x, y } = at(); stroke(g, x, y - R * .03, R * (.2 + rnd() * .3), (rnd() - .5) * .3, -.25, R * .03, alpha('#FFFFFF', .9)); }
  } else if (kind === 'mountain' || kind === 'volcano') {
    for (let k = 0; k < 14; k++) {
      const { x, y } = at();
      stroke(g, x, y, R * (.08 + rnd() * .14), rnd() * Math.PI, .4, Math.max(1, R * .02), alpha(kind === 'volcano' ? '#1D1517' : pal.dark, .5));
    }
    if (kind === 'volcano') for (let k = 0; k < 5; k++) {
      const { x, y } = at(), angle = rnd() * Math.PI, length = R * (.15 + rnd() * .2);
      stroke(g, x, y, length, angle, .5, R * .04, alpha('#E2582A', .55));
      stroke(g, x, y, length * .8, angle, .5, R * .015, alpha('#FFC36A', .85));
    }
  } else if (kind === 'ocean' || kind === 'shallow' || kind === 'deep' || kind === 'lake') {
    // Wave crescents (lit crest, dark trough).
    const count = kind === 'deep' ? 5 : 8;
    for (let k = 0; k < count; k++) {
      const { x, y } = at(), length = R * (.18 + rnd() * .22);
      stroke(g, x, y + R * .03, length, 0, .35, R * .03, alpha(pal.dark, .4));
      stroke(g, x, y, length, 0, .35, R * .022, alpha('#F2FBFF', kind === 'deep' ? .22 : .5));
    }
  } else {
    // Unexplored: dark paper fibres.
    for (let k = 0; k < 20; k++) { const { x, y } = at(); stroke(g, x, y, R * (.2 + rnd() * .4), (rnd() - .5) * .6, .1, Math.max(1, R * .012), alpha(k % 2 ? '#3A2B1E' : '#120D09', .5)); }
  }
}

// ---------- Standing props ----------
// Every prop is drawn the same way (fidelity pass, docs/design/fidelity/README.md): a soft contact shadow cast to the south-east,
// a thin dark ink silhouette, the shade colour as the body, the mid tone shifted toward the light (north-west) so the shade
// remains as a rim on the lower right, light caps on the lit lobes and a little texture. Sizes are in device pixels.
export type Prop = { canvas: HTMLCanvasElement; ox: number; oy: number } | null;
const props = spriteCache<Prop>(260);
type TreeTone = { light: string; mid: string; dark: string; ink: string };
const BROADLEAF: readonly TreeTone[] = [
  { light: '#BEDD6E', mid: '#6FA944', dark: '#2F652F', ink: '#1B341A' },
  { light: '#CFE27A', mid: '#86B24B', dark: '#40702F', ink: '#21391A' },
  { light: '#A8D366', mid: '#5B9B3F', dark: '#295B2D', ink: '#17301A' },
];
const INK = '#21170D';
const ink = (s: number) => Math.max(1, s * .055);
const shadow = (g: CanvasRenderingContext2D, x: number, y: number, rx: number, sq: number) => dab(g, x, y, rx, rx * sq * .5, '#1A140C', .42);
/** Union of discs as one path (nonzero fill), each grown by `grow` and shifted by (dx, dy). */
function discs(g: CanvasRenderingContext2D, lobes: readonly (readonly [number, number, number])[], dx = 0, dy = 0, grow = 0) {
  g.beginPath();
  for (const [x, y, r] of lobes) { if (r + grow <= 0) continue; g.moveTo(x + dx + r + grow, y + dy); g.arc(x + dx, y + dy, r + grow, 0, Math.PI * 2); }
}

/** A tapered trunk with a root flare, lit on the left. */
function trunk(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, lean = 0) {
  const top = y - height, tx = x + lean;
  g.beginPath(); g.moveTo(x - width * 1.5, y); g.quadraticCurveTo(x - width * .55, y - height * .15, tx - width * .5, top);
  g.lineTo(tx + width * .5, top); g.quadraticCurveTo(x + width * .55, y - height * .15, x + width * 1.5, y); g.quadraticCurveTo(x, y + width * .35, x - width * 1.5, y);
  const bark = g.createLinearGradient(x - width * 1.5, 0, x + width * 1.5, 0);
  bark.addColorStop(0, '#93693F'); bark.addColorStop(.42, '#6E4B2B'); bark.addColorStop(1, '#3B2716');
  g.fillStyle = bark; g.fill(); g.strokeStyle = alpha(INK, .75); g.lineWidth = Math.max(1, width * .3); g.stroke();
}

/** A round-crowned broadleaf tree: seeded lobes around a centre, `s` ≈ a fifth of its height. */
function broadleaf(g: CanvasRenderingContext2D, x: number, y: number, s: number, tone: TreeTone, sq: number, rnd: () => number) {
  shadow(g, x + s * .45, y + s * .04, s * 1.15, sq);
  trunk(g, x, y, s * .12, s * 1.05, (rnd() - .5) * s * .1);
  const cx = x + (rnd() - .5) * s * .12, cy = y - s * 1.62, count = 5 + Math.floor(rnd() * 2), lobes: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / count + (rnd() - .5) * .55;
    lobes.push([cx + Math.cos(a) * s * .5, cy + Math.sin(a) * s * .42, s * (.36 + rnd() * .12)]);
  }
  lobes.push([cx, cy - s * .04, s * .52]);
  discs(g, lobes, 0, 0, ink(s)); g.fillStyle = tone.ink; g.fill();
  discs(g, lobes); g.fillStyle = tone.dark; g.fill();
  g.save(); discs(g, lobes); g.clip();
  discs(g, lobes, -s * .09, -s * .11, -s * .05); g.fillStyle = tone.mid; g.fill();
  // Light caps on the lobes facing the light.
  g.beginPath();
  for (const [lx, ly, r] of lobes) if ((lx - cx) + (ly - cy) * 1.3 < s * .12) { g.moveTo(lx - r * .32 + r * .42, ly - r * .38); g.arc(lx - r * .32, ly - r * .38, r * .42, 0, Math.PI * 2); }
  g.fillStyle = alpha(tone.light, .78); g.fill();
  // Leaf texture: shade crescents on the lower right, bright flecks on the upper left.
  g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * s * .62, px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * .85, lit = (px - cx) + (py - cy) < 0;
    g.beginPath(); g.arc(px, py, s * (.09 + rnd() * .05), lit ? Math.PI * 1.05 : Math.PI * .05, lit ? Math.PI * 1.65 : Math.PI * .75);
    g.strokeStyle = lit ? alpha('#F2F7B4', .6) : alpha(tone.ink, .45); g.lineWidth = Math.max(1, s * .045); g.stroke();
  }
  g.restore();
}

/** A layered conifer, `h` tall; snowy ones carry snow on the lit side of every tier. */
function conifer(g: CanvasRenderingContext2D, x: number, y: number, h: number, snowy: boolean, sq: number) {
  shadow(g, x + h * .2, y + h * .01, h * .34, sq);
  trunk(g, x, y, h * .035, h * .22);
  const tiers = h > 26 ? 4 : 3, inkWidth = Math.max(1, h * .022);
  const colors = snowy ? ['#5B8A72', '#356452', '#1E4036'] : ['#4F9A55', '#2E6E3C', '#1B4628'];
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers, base = y - h * (.16 + t * .74), top = base - h * (.44 - t * .1), half = h * (.32 - t * .2);
    const path = new Path2D();
    path.moveTo(x, top); path.quadraticCurveTo(x - half * .3, base - h * .14, x - half, base);
    // A scalloped hem: three small drooping arcs.
    for (let k = 0; k < 3; k++) { const x0 = x - half + k * half * 2 / 3, x1 = x0 + half * 2 / 3; path.quadraticCurveTo((x0 + x1) / 2, base + h * .05, x1, base); }
    path.quadraticCurveTo(x + half * .3, base - h * .14, x, top); path.closePath();
    g.lineJoin = 'round'; g.strokeStyle = INK; g.lineWidth = inkWidth * 2; g.stroke(path);
    const fill = g.createLinearGradient(x - half, 0, x + half, 0);
    fill.addColorStop(0, colors[0]); fill.addColorStop(.48, colors[1]); fill.addColorStop(1, colors[2]);
    g.fillStyle = fill; g.fill(path);
    g.save(); g.clip(path);
    // Shade under the hem and a lit ridge down the left flank.
    dab(g, x + half * .2, base, half * 1.1, h * .06, colors[2], .55);
    g.beginPath(); g.moveTo(x - inkWidth, top + h * .04); g.quadraticCurveTo(x - half * .35, base - h * .16, x - half * .82, base - h * .02);
    g.strokeStyle = snowy ? '#F4FAFC' : alpha('#B6DB78', .75); g.lineWidth = snowy ? h * .06 : Math.max(1, h * .025); g.lineCap = 'round'; g.stroke();
    g.restore();
  }
}

/** A palm: a leaning ringed trunk and a crown of drooping fronds. */
function palm(g: CanvasRenderingContext2D, x: number, y: number, s: number, lean: number, sq: number) {
  shadow(g, x + s * .6, y, s * .75, sq);
  const top = { x: x + lean * s * .45, y: y - s * 1.7 };
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * s * .05, y - s * .9, top.x, top.y);
  g.strokeStyle = INK; g.lineWidth = s * .2; g.stroke();
  g.strokeStyle = '#8E6A43'; g.lineWidth = s * .13; g.stroke();
  for (let k = 1; k < 7; k++) {
    const t = k / 7, px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (x + lean * s * .05) + t * t * top.x, py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y - s * .9) + t * t * top.y;
    g.beginPath(); g.moveTo(px - s * .065, py); g.lineTo(px + s * .065, py - s * .02); g.strokeStyle = alpha('#4A3220', .8); g.lineWidth = Math.max(1, s * .03); g.stroke();
  }
  for (const [angle, length] of [[-2.9, .95], [-2.3, .85], [-1.75, .7], [-1.2, .85], [-.55, .95], [.1, .8], [2.6, .7]] as const) {
    const tip = { x: top.x + Math.cos(angle) * s * length, y: top.y + Math.sin(angle) * s * length * .7 + s * .32 };
    const mid = { x: (top.x + tip.x) / 2, y: Math.min(top.y, tip.y) - s * .18 }, nx = -(tip.y - top.y) * .16, ny = (tip.x - top.x) * .16;
    g.beginPath(); g.moveTo(top.x, top.y); g.quadraticCurveTo(mid.x + nx, mid.y + ny, tip.x, tip.y); g.quadraticCurveTo(mid.x - nx, mid.y - ny, top.x, top.y);
    const lit = Math.cos(angle) < 0;
    g.fillStyle = lit ? '#6FAE45' : '#3F7A32'; g.fill(); g.strokeStyle = INK; g.lineWidth = Math.max(1, s * .035); g.stroke();
    g.beginPath(); g.moveTo(top.x, top.y); g.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y); g.strokeStyle = lit ? alpha('#D8EC92', .8) : alpha('#7DB255', .7); g.lineWidth = Math.max(1, s * .025); g.stroke();
  }
  for (const [dx, dy] of [[-.08, .1], [.08, .12], [0, .2]] as const) { g.beginPath(); g.arc(top.x + dx * s, top.y + dy * s, s * .07, 0, Math.PI * 2); g.fillStyle = '#5A3B1E'; g.fill(); }
}

function bush(g: CanvasRenderingContext2D, x: number, y: number, s: number, sq: number, rnd: () => number, berries = false) {
  shadow(g, x + s * .35, y, s, sq);
  const lobes: [number, number, number][] = [[x - s * .42, y - s * .38, s * .42], [x + s * .4, y - s * .36, s * .4], [x, y - s * .6, s * .5]];
  discs(g, lobes, 0, 0, Math.max(1, s * .08)); g.fillStyle = '#1D3A1B'; g.fill();
  discs(g, lobes); g.fillStyle = '#356B2E'; g.fill();
  g.save(); discs(g, lobes); g.clip();
  discs(g, lobes, -s * .12, -s * .14, -s * .08); g.fillStyle = '#6FA944'; g.fill();
  dab(g, x - s * .3, y - s * .78, s * .34, s * .24, '#D6EC8C', .7);
  g.restore();
  if (berries) for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x + (rnd() - .5) * s, y - s * (.35 + rnd() * .35), Math.max(1, s * .08), 0, Math.PI * 2); g.fillStyle = '#E2584A'; g.fill(); }
}

type Rock = { light: string; mid: string; dark: string };
const ROCK: Rock = { light: '#E0D0AC', mid: '#A58F70', dark: '#5B4E40' };
const ROCK_SNOW: Rock = { light: '#ECF1F3', mid: '#A9B2B9', dark: '#56626B' };
const DARK_ROCK: Rock = { light: '#8A6A5C', mid: '#4E3A37', dark: '#2A1E20' };
function massif(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rock: Rock, cap: number, rnd: () => number, sq: number) {
  shadow(g, x + w * .18, y + h * .02, w * .62, sq);
  const peak = x + (rnd() - .5) * w * .14, shoulder = (rnd() - .5) * .1;
  const outline = () => {
    g.beginPath(); g.moveTo(x - w / 2, y);
    g.quadraticCurveTo(x - w * (.34 + shoulder), y - h * .5, x - w * .16, y - h * .72); g.lineTo(peak, y - h);
    g.lineTo(x + w * .1, y - h * .78); g.quadraticCurveTo(x + w * .3, y - h * .48, x + w / 2, y);
    g.quadraticCurveTo(x, y + h * .06, x - w / 2, y); g.closePath();
  };
  outline(); g.strokeStyle = INK; g.lineWidth = Math.max(1.5, w * .03); g.lineJoin = 'round'; g.stroke();
  const fill = g.createLinearGradient(x - w / 2, y - h, x + w * .2, y);
  fill.addColorStop(0, rock.light); fill.addColorStop(.6, rock.mid); fill.addColorStop(1, mix(rock.mid, rock.dark, .4));
  outline(); g.fillStyle = fill; g.fill();
  g.save(); outline(); g.clip();
  // The shaded east face, from the summit down a slightly wandering ridge.
  const ridge = peak + w * (.02 + rnd() * .04);
  g.beginPath(); g.moveTo(peak, y - h); g.quadraticCurveTo(ridge, y - h * .5, x + w * .1, y + h * .06); g.lineTo(x + w * .6, y + h * .06); g.lineTo(x + w * .6, y - h * 1.1); g.closePath();
  g.fillStyle = alpha(rock.dark, .58); g.fill();
  // Gullies on the lit face, strata on the shade face.
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const sx = peak - w * (.05 + rnd() * .25), sy = y - h * (.45 + rnd() * .35);
    stroke(g, sx, sy + h * .12, h * (.22 + rnd() * .18), Math.PI * (.6 + rnd() * .12), .15, Math.max(1, w * .016), alpha(rock.dark, .5));
  }
  for (let k = 0; k < 3; k++) stroke(g, ridge + w * (.08 + k * .08), y - h * (.25 + k * .14), w * .16, -.15, .1, Math.max(1, w * .012), alpha(INK, .35));
  // Lit ridge line.
  g.beginPath(); g.moveTo(peak, y - h); g.quadraticCurveTo(ridge - w * .01, y - h * .5, x + w * .08, y + h * .04);
  g.strokeStyle = alpha(lighten(rock.light, .4), .55); g.lineWidth = Math.max(1, w * .012); g.stroke();
  if (cap > 0) {
    const capY = y - h * (1 - cap), left = peak - w * .5 * cap * 1.1, right = peak + w * .5 * cap * 1.05;
    g.beginPath(); g.moveTo(peak, y - h * 1.02); g.lineTo(right, capY);
    for (let k = 0; k <= 5; k++) { const t = 1 - k / 5, px = left + (right - left) * t; g.lineTo(px, capY + (k % 2 ? h * .08 : -h * .015) * (1 + rnd() * .5)); }
    g.lineTo(left, capY); g.closePath();
    g.fillStyle = '#F7FAFC'; g.fill();
    g.save(); g.clip();
    g.beginPath(); g.moveTo(peak, y - h * 1.05); g.quadraticCurveTo(ridge, y - h * .7, x + w * .3, capY + h * .2); g.lineTo(x + w * .6, y - h * 1.1); g.closePath();
    g.fillStyle = '#B9CCDB'; g.fill();
    g.restore();
  }
  g.restore();
}
function mound(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pal: Palette, sq: number, rnd: () => number) {
  shadow(g, x + w * .12, y + h * .06, w * .58, sq);
  const path = new Path2D();
  path.moveTo(x - w / 2, y); path.bezierCurveTo(x - w * .38, y - h * 1.32, x + w * .38, y - h * 1.32, x + w / 2, y); path.quadraticCurveTo(x, y + h * .18, x - w / 2, y);
  g.strokeStyle = alpha(darken(pal.dark, .4), .55); g.lineWidth = Math.max(1, w * .015); g.stroke(path);
  const fill = g.createRadialGradient(x - w * .18, y - h * .85, w * .04, x, y - h * .3, w * .62);
  fill.addColorStop(0, lighten(pal.light, .2)); fill.addColorStop(.5, pal.base); fill.addColorStop(1, mix(pal.base, pal.dark, .75));
  g.fillStyle = fill; g.fill(path);
  g.save(); g.clip(path);
  dab(g, x + w * .3, y - h * .1, w * .35, h * .5, pal.dark, .4);
  g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const tx = x + (rnd() - .5) * w * .7, ty = y - h * (.15 + rnd() * .6), t = Math.max(1, w * .012), l = w * .035;
    g.beginPath(); g.moveTo(tx - l * .5, ty); g.lineTo(tx - l * .2, ty - l); g.moveTo(tx + l * .1, ty); g.lineTo(tx + l * .4, ty - l * .9);
    g.strokeStyle = alpha(tx < x ? lighten(pal.light, .25) : pal.dark, .6); g.lineWidth = t; g.stroke();
  }
  g.restore();
  // A lit crest line instead of a hard outline.
  g.beginPath(); g.moveTo(x - w * .32, y - h * .62); g.bezierCurveTo(x - w * .2, y - h * .98, x + w * .1, y - h * 1.02, x + w * .22, y - h * .82);
  g.strokeStyle = alpha(lighten(pal.light, .35), .6); g.lineWidth = Math.max(1, w * .02); g.lineCap = 'round'; g.stroke();
}
function cone(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sq: number) {
  shadow(g, x + w * .14, y, w * .62, sq);
  const outline = () => { g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x - w * .22, y - h * .6, x - w * .12, y - h); g.lineTo(x + w * .12, y - h); g.quadraticCurveTo(x + w * .22, y - h * .6, x + w / 2, y); g.quadraticCurveTo(x, y + h * .06, x - w / 2, y); };
  outline(); g.strokeStyle = INK; g.lineWidth = Math.max(1.5, w * .03); g.lineJoin = 'round'; g.stroke();
  const fill = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  fill.addColorStop(0, '#93715F'); fill.addColorStop(.45, '#523D39'); fill.addColorStop(1, '#2A1E20');
  outline(); g.fillStyle = fill; g.fill();
  g.save(); outline(); g.clip();
  for (let k = 0; k < 4; k++) stroke(g, x - w * (.3 - k * .17), y - h * .35, h * .5, Math.PI * (.5 - (k - 1.5) * .06), .1, Math.max(1, w * .014), alpha('#1C1416', .45));
  g.restore();
  stroke(g, x - w * .05, y - h * .55, h * .7, Math.PI * .56, .25, w * .065, alpha('#E0522A', .85));
  stroke(g, x - w * .05, y - h * .55, h * .62, Math.PI * .56, .25, w * .024, '#FFC36A');
  g.beginPath(); g.ellipse(x, y - h, w * .13, w * .045, 0, 0, Math.PI * 2); g.fillStyle = '#2A1716'; g.fill();
  dab(g, x, y - h, w * .2, w * .09, '#FF8A3A', .9);
  for (const [dx, dy, r] of [[.04, -1.18, .12], [.12, -1.36, .15], [.2, -1.56, .17]] as const) dab(g, x + dx * w, y + dy * h, r * w, r * w * .8, '#857C78', .55);
}
function cactus(g: CanvasRenderingContext2D, x: number, y: number, s: number, sq: number) {
  shadow(g, x + s * .3, y, s * .5, sq);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const arms = new Path2D();
  arms.moveTo(x, y); arms.lineTo(x, y - s * 1.1);
  arms.moveTo(x, y - s * .42); arms.quadraticCurveTo(x - s * .32, y - s * .42, x - s * .32, y - s * .82);
  arms.moveTo(x, y - s * .58); arms.quadraticCurveTo(x + s * .3, y - s * .58, x + s * .3, y - s * .92);
  g.strokeStyle = INK; g.lineWidth = s * .3 + Math.max(2, s * .08); g.stroke(arms);
  g.strokeStyle = '#3F7A3A'; g.lineWidth = s * .3; g.stroke(arms);
  g.save(); g.translate(-s * .06, -s * .02); g.strokeStyle = '#7DB55A'; g.lineWidth = s * .1; g.stroke(arms); g.restore();
  g.fillStyle = '#F07AB0'; g.beginPath(); g.arc(x, y - s * 1.14, Math.max(1.5, s * .08), 0, Math.PI * 2); g.fill();
}
function boulder(g: CanvasRenderingContext2D, x: number, y: number, s: number, rock: Rock, sq: number) {
  shadow(g, x + s * .3, y, s * .8, sq);
  const path = new Path2D();
  path.moveTo(x - s * .66, y - s * .1); path.quadraticCurveTo(x - s * .6, y - s * .62, x - s * .1, y - s * .74); path.quadraticCurveTo(x + s * .5, y - s * .7, x + s * .66, y - s * .18);
  path.quadraticCurveTo(x + s * .6, y + s * .06, x, y + s * .04); path.quadraticCurveTo(x - s * .5, y + s * .04, x - s * .66, y - s * .1);
  g.strokeStyle = INK; g.lineWidth = Math.max(1.5, s * .1); g.lineJoin = 'round'; g.stroke(path);
  g.fillStyle = rock.dark; g.fill(path);
  g.save(); g.clip(path);
  g.beginPath(); g.ellipse(x - s * .12, y - s * .42, s * .5, s * .36, -.3, 0, Math.PI * 2); g.fillStyle = rock.mid; g.fill();
  g.beginPath(); g.moveTo(x - s * .5, y - s * .3); g.quadraticCurveTo(x - s * .4, y - s * .62, x - s * .05, y - s * .66); g.lineTo(x - s * .12, y - s * .42); g.closePath(); g.fillStyle = rock.light; g.fill();
  g.restore();
}

/** Spots inside the (squashed) hex for a tile's props, back to front. */
function spots(rnd: () => number, count: number, R: number, sq: number, spread = .62, gap = .26): Point[] {
  const list: Point[] = [];
  for (let tries = 0; list.length < count && tries < count * 14; tries++) {
    const x = (rnd() - .5) * 2 * spread * R, y = (rnd() - .5) * 2 * spread * R * sq;
    if (Math.abs(x) / (.866 * R) + Math.abs(y) / (R * sq) * .55 > .92) continue;
    if (list.some(p => Math.hypot(p.x - x, (p.y - y) / sq) < R * gap)) continue;
    list.push({ x, y });
  }
  return list.sort((a, b) => a.y - b.y);
}

/** Share of conifers in a forest tile, per variant: two broadleaf woods, a pine stand and a mixed wood. */
const CONIFER_SHARE = [.15, .3, .8, .5];
/** Baked props of a tile (null when it has none); (ox, oy) is the tile centre inside the canvas. */
export function propSprite(biome: BiomeId, variant: number, hill: boolean, peak: boolean, R: number, sq: number): Prop {
  return props.get(`${biome}|${variant}|${hill ? 1 : 0}${peak ? 1 : 0}|${R}|${sq}`, () => {
    if (biome === 'ocean' && !peak) return null;
    const w = R * 2.6, h = R * 3.4, ox = w / 2, oy = R * 2.3;
    const { canvas, context: g } = makeCanvas(w, h), rnd = stream(biome.charCodeAt(0) * 977 + biome.length * 31 + variant * 7907 + (hill ? 13 : 0) + (peak ? 29 : 0));
    const pal = GROUND[biome];
    let drew = false, ground = 0;
    if (hill && biome !== 'mountain' && biome !== 'volcano') {
      // Soft rounded relief: one broad dome, a smaller one behind it on some variants.
      if (variant % 2) mound(g, ox + R * .32, oy - R * .24 * sq, R * .95, R * .26, pal, sq, rnd);
      mound(g, ox - R * .06, oy + R * .14 * sq, R * 1.5, R * .36, pal, sq, rnd);
      ground = R * .4; drew = true;
    }
    const lift = (p: Point) => hill ? ground * Math.max(0, 1 - Math.hypot(p.x / R, p.y / (R * sq)) * 1.2) : 0;
    const tree = (p: Point, size: number, coniferShare: number) => {
      const x = ox + p.x, y = oy + p.y - lift(p);
      if (rnd() < coniferShare) conifer(g, x, y, R * .56 * size, false, sq);
      else broadleaf(g, x, y, R * .21 * size, BROADLEAF[Math.floor(rnd() * BROADLEAF.length)], sq, rnd);
    };
    if (biome === 'forest') {
      // A wood: a dense clump, the trees at the back a little taller, a bush or two in front.
      const list = spots(rnd, 9, R, sq, .7, .2);
      list.forEach((p, i) => tree(p, .82 + (1 - i / list.length) * .22 + rnd() * .14, CONIFER_SHARE[variant]));
      for (const p of spots(rnd, 2, R, sq, .5, .3).filter(q => q.y > 0)) bush(g, ox + p.x, oy + p.y + R * .25 * sq - lift(p), R * .1, sq, rnd);
      drew = true;
    } else if (biome === 'grassland' && variant === 3 && !hill) {
      // A copse: two or three trees close together.
      for (const p of spots(rnd, 3, R * .6, sq, .7, .3)) tree(p, .9 + rnd() * .2, .25);
      drew = true;
    } else if (biome === 'grassland') {
      for (const p of spots(rnd, variant === 0 ? 3 : 1 + variant % 2, R, sq, .55)) bush(g, ox + p.x, oy + p.y - (hill ? ground * .6 : 0), R * (.12 + rnd() * .05), sq, rnd, variant === 1);
      drew = true;
    } else if (biome === 'snow') {
      for (const p of spots(rnd, 2 + variant % 2, R, sq, .55)) conifer(g, ox + p.x, oy + p.y - (hill ? ground * .6 : 0), R * (.5 + rnd() * .15), true, sq);
      drew = true;
    } else if (biome === 'desert') {
      if (variant === 0) {
        // An oasis: a small pool with two palms.
        const px = ox - R * .05, py = oy + R * .22 * sq;
        g.beginPath(); g.ellipse(px, py, R * .3, R * .3 * sq * .55, 0, 0, Math.PI * 2); g.fillStyle = '#C49450'; g.fill();
        g.beginPath(); g.ellipse(px, py, R * .26, R * .26 * sq * .5, 0, 0, Math.PI * 2); g.fillStyle = '#4FB0C6'; g.fill();
        dab(g, px - R * .08, py - R * .03, R * .1, R * .03, '#E8FBFF', .8);
        palm(g, ox - R * .3, oy + R * .05 * sq, R * .26, -.5, sq);
        palm(g, ox + R * .22, oy - R * .05 * sq, R * .3, .6, sq);
        drew = true;
      }
      if (variant === 1 || variant === 3) { cactus(g, ox + R * (rnd() - .5) * .6, oy + R * .15 * sq, R * .32, sq); drew = true; }
      if (variant === 3) boulder(g, ox + R * .38, oy + R * .3 * sq, R * .12, ROCK, sq);
      if (variant === 2) { boulder(g, ox + R * .25, oy + R * .2 * sq, R * .22, ROCK, sq); boulder(g, ox - R * .1, oy + R * .3 * sq, R * .14, ROCK, sq); drew = true; }
    } else if (biome === 'mountain') {
      // A small range: two shoulders behind, the main summit in front, scree and (on two variants) a pine on the lower slope.
      const tall = peak ? 1.75 : 1.1;
      massif(g, ox - R * .42, oy - R * .1 * sq, R * .9, R * .62, ROCK, .25, rnd, sq);
      massif(g, ox + R * .38, oy - R * .05 * sq, R * .85, R * .7, ROCK, .28, rnd, sq);
      massif(g, ox + R * (rnd() - .5) * .15, oy + R * .22 * sq, R * 1.25, R * tall, peak ? ROCK_SNOW : ROCK, peak ? .48 : .32, rnd, sq);
      boulder(g, ox - R * .5, oy + R * .42 * sq, R * .1, ROCK, sq);
      if (variant % 2 && !peak) conifer(g, ox + R * .55, oy + R * .38 * sq, R * .36, false, sq);
      drew = true;
    } else if (biome === 'volcano') {
      boulder(g, ox - R * .5, oy + R * .3 * sq, R * .16, DARK_ROCK, sq);
      cone(g, ox, oy + R * .25 * sq, R * 1.3, R * (peak ? 1.5 : 1.05), sq);
      drew = true;
    }
    if (peak && biome !== 'mountain' && biome !== 'volcano') {
      massif(g, ox, oy + R * .25 * sq, R * 1.05, R * 1.55, ROCK_SNOW, .5, rnd, sq);
      drew = true;
    }
    return drew ? { canvas, ox, oy } : null;
  });
}

// ---------- Scene flags ----------
type Flags = { hill: Uint8Array; peak: Uint8Array; deep: Uint8Array; lake: Uint8Array; rivers: Map<number, number[]>; landmarks: Map<number, LandmarkId>;
  coast: Map<number, number[]>; fog: Uint8Array };
const flagCache = new WeakMap<MapScene, Flags>();
export function flagsFor(scene: MapScene): Flags {
  let flags = flagCache.get(scene);
  if (!flags) {
    const n = scene.tiles.length, mark = (list: readonly number[] | undefined) => { const out = new Uint8Array(n); for (const i of list ?? []) out[i] = 1; return out; };
    const coast = new Map<number, number[]>();
    for (const edge of scene.coastEdges) { const list = coast.get(edge.index); if (list) list.push(edge.direction); else coast.set(edge.index, [edge.direction]); }
    flags = { hill: mark(scene.terrain?.hills), peak: mark(scene.terrain?.peaks), deep: mark(scene.terrain?.deep), lake: mark(scene.terrain?.lakes),
      rivers: new Map((scene.terrain?.rivers ?? []).map(river => [river.index, river.links])), landmarks: new Map((scene.terrain?.landmarks ?? []).map(site => [site.index, site.id])),
      coast, fog: mark(scene.fog) };
    flagCache.set(scene, flags);
  }
  return flags;
}
export const variantOf = (index: number) => Math.floor(noise(9173, index) * 4);
export function groundKind(scene: MapScene, flags: Flags, index: number): GroundKind {
  const biome = scene.tiles[index].biome;
  if (!biome) return 'unknown';
  if (biome !== 'ocean') return biome;
  return flags.lake[index] ? 'lake' : flags.deep[index] ? 'deep' : flags.coast.has(index) ? 'shallow' : 'ocean';
}

// ---------- The base painter ----------
type Item = { index: number; p: Point };
/** Tiles to paint, row-major (wrapped copies interleaved). Chunk mode adds a ring of neighbours around the chunk's own tiles. */
function itemsFor(args: Base25d, ring: boolean): { items: Item[]; own: Item[] } {
  const { scene, copies, radius, width, height } = args, items: Item[] = [], own: Item[] = [];
  if (args.rows && args.cols) {
    const [r0, r1] = args.rows, [c0, c1] = args.cols, span = Math.sqrt(3) * radius * scene.width, base = copies[0];
    for (let row = Math.max(0, r0 - (ring ? 3 : 0)); row < Math.min(scene.height, r1 + (ring ? 3 : 0)); row++) for (let col = c0 - (ring ? 2 : 0); col < c1 + (ring ? 2 : 0); col++) {
      let c = col, shift = 0;
      if (c < 0 || c >= scene.width) { if (!scene.wrap) continue; shift = c < 0 ? -span : span; c = (c + scene.width) % scene.width; }
      const index = row * scene.width + c, at = base[index], item = { index, p: shift ? { x: at.x + shift, y: at.y } : at };
      items.push(item);
      if (row >= r0 && row < r1 && col >= c0 && col < c1) own.push(item);
    }
    return { items, own };
  }
  const margin = radius * 2.2;
  for (let row = 0; row < scene.height; row++) for (const centres of copies) for (let col = 0; col < scene.width; col++) {
    const index = row * scene.width + col, p = centres[index];
    if (p.x < -margin || p.x > width + margin || p.y < -margin || p.y > height + margin * 1.4) continue;
    items.push({ index, p });
  }
  return { items, own: items };
}

export function drawBasePainted(args: Base25d): void {
  const { context: g, scene, radius, squash: sq } = args;
  const dpr = g.getTransform().a || 1, R = bucket(radius * dpr), k = radius / R, flags = flagsFor(scene);
  const { items, own } = itemsFor(args, true);
  g.save();
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (args.rows && args.cols) {
    // Clip to the chunk's own hexes (a hair larger, so neighbouring chunks overlap instead of leaving an anti-aliased seam).
    g.beginPath();
    for (const item of own) addHex(g, item.p.x, item.p.y, radius + .8 / dpr, sq);
    if (args.rows[0] === 0) for (const item of own) if (Math.floor(item.index / scene.width) === 0) g.rect(item.p.x - radius, item.p.y - radius * 3, radius * 2, radius * 3);
    g.clip();
  }
  // 1. Ground: each sprite is opaque over its own hex and bleeds softly over the tiles drawn before it.
  // Unexplored tiles go down first, so explored land fades into the dark on every side instead of ending in a hex outline.
  for (const pass of [false, true]) for (const { index, p } of items) {
    if (Boolean(scene.tiles[index].biome) !== pass) continue;
    const kind = groundKind(scene, flags, index), sprite = groundSprite(kind, variantOf(index), R, sq);
    g.drawImage(sprite, p.x - sprite.width * k / 2, p.y - sprite.height * k / 2, sprite.width * k, sprite.height * k);
  }
  // 2. A faint hand-ruled hex grid over explored land and sea.
  g.beginPath();
  for (const { index, p } of items) { const biome = scene.tiles[index].biome; if (biome && biome !== 'ocean') addHex(g, p.x, p.y, radius, sq); }
  g.strokeStyle = 'rgba(40,28,14,.11)'; g.lineWidth = Math.max(.6, radius * .02); g.stroke();
  // 3. Coasts: shallows glowing off the shore (clipped to the water), a sandy beach, a wet line and two surf lines.
  g.save();
  g.beginPath(); let water = false;
  for (const { index, p } of items) if (scene.tiles[index].biome === 'ocean') { addHex(g, p.x, p.y, radius + .5, sq); water = true; }
  if (water) {
    g.clip();
    for (const [width, offset, a] of [[1.15, -.32, .16], [.7, -.2, .22], [.34, -.1, .3]] as const) {
      g.beginPath();
      for (const { index, p } of items) for (const direction of flags.coast.get(index) ?? []) {
        const [ea, eb] = edgePoints(p, radius, sq, direction), angle = DIRECTION_ANGLES[direction], nx = Math.cos(angle) * offset * radius, ny = Math.sin(angle) * sq * offset * radius;
        g.moveTo(ea.x + nx, ea.y + ny); g.lineTo(eb.x + nx, eb.y + ny);
      }
      g.strokeStyle = alpha('#8FE0D2', a); g.lineWidth = width * radius; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    }
  }
  g.restore();
  for (const { index, p } of items) {
    const directions = flags.coast.get(index);
    if (!directions) continue;
    for (const direction of directions) coastEdge(g, p, radius, sq, direction, scene, index);
  }
  // 4. Rivers.
  for (const { index, p } of items) {
    const links = flags.rivers.get(index);
    if (links) river(g, p, radius, sq, links.length ? links : [0], index);
  }
  // 5. Standing props, back to front (fogged tiles get the fog layer's ink drawings instead).
  for (const { index, p } of items) {
    const biome = scene.tiles[index].biome;
    if (!biome || flags.fog[index]) continue;
    const prop = propSprite(biome, variantOf(index), Boolean(flags.hill[index]), Boolean(flags.peak[index]), R, sq);
    if (prop) g.drawImage(prop.canvas, p.x - prop.ox * k, p.y - prop.oy * k, prop.canvas.width * k, prop.canvas.height * k);
    const landmark = flags.landmarks.get(index);
    if (landmark) landmarkStone(g, p, radius, landmark, sq);
  }
  // 6. Border ribbons on top.
  borders(g, args, items);
  g.restore();
}

function edgePoints(p: Point, radius: number, sq: number, direction: number): [Point, Point] {
  const [a, b] = EDGE_CORNERS[direction];
  return [corner(p, radius, sq, a), corner(p, radius, sq, b)];
}
function coastEdge(g: CanvasRenderingContext2D, p: Point, radius: number, sq: number, direction: number, scene: MapScene, index: number) {
  const [a, b] = edgePoints(p, radius, sq, direction), angle = DIRECTION_ANGLES[direction];
  const n = { x: Math.cos(angle), y: Math.sin(angle) * sq };
  const line = (offset: number, inset: number, width: number, color: string) => {
    const ax = a.x + (b.x - a.x) * inset, ay = a.y + (b.y - a.y) * inset, bx = b.x + (a.x - b.x) * inset, by = b.y + (a.y - b.y) * inset;
    g.beginPath(); g.moveTo(ax + n.x * offset * radius, ay + n.y * offset * radius); g.lineTo(bx + n.x * offset * radius, by + n.y * offset * radius);
    g.strokeStyle = color; g.lineWidth = width * radius; g.lineCap = 'round'; g.stroke();
  };
  // The land across this edge decides the shore colour (sand, snow, dark volcanic sand, rock).
  const other = neighbourIndexOf(scene, index, direction), land = other >= 0 ? scene.tiles[other].biome : null;
  const sand = land === 'snow' ? '#F2F6F7' : land === 'volcano' ? '#6E5A52' : land === 'mountain' ? '#C8B48E' : '#EED69C';
  line(.06, 0, .2, alpha(sand, .95));
  line(-.02, .02, .06, alpha(mix(sand, '#6B8F8A', .45), .6));
  line(-.11, .06, .04, 'rgba(250,255,255,.6)');
  line(-.24, .16, .028, 'rgba(240,252,255,.28)');
}
function river(g: CanvasRenderingContext2D, p: Point, radius: number, sq: number, links: readonly number[], index: number) {
  const paths = links.map((direction, k) => {
    const angle = DIRECTION_ANGLES[direction], end = { x: p.x + Math.cos(angle) * radius * .87, y: p.y + Math.sin(angle) * radius * .87 * sq };
    const bend = (noise(index * 7 + k, 3) - .5) * .5, mid = { x: (p.x + end.x) / 2 - Math.sin(angle) * radius * bend * .4, y: (p.y + end.y) / 2 + Math.cos(angle) * radius * bend * .4 * sq };
    return { end, mid };
  });
  for (const [width, color] of [[.22, 'rgba(46,88,96,.45)'], [.14, '#4B9CCB'], [.05, 'rgba(178,228,246,.85)']] as const) {
    g.beginPath();
    for (const { end, mid } of paths) { g.moveTo(p.x, p.y); g.quadraticCurveTo(mid.x, mid.y, end.x, end.y); }
    g.strokeStyle = color; g.lineWidth = Math.max(1, width * radius); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  }
}
function landmarkStone(g: CanvasRenderingContext2D, p: Point, radius: number, id: LandmarkId, sq: number) {
  const glyph = landmarkGlyph(id), w = radius * .34, h = radius * .62, x = p.x + radius * .3, y = p.y + radius * .25 * sq;
  dab(g, x + w * .4, y, w * 1.1, w * .4, '#1A140C', .45);
  const fill = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  fill.addColorStop(0, '#D8CDB4'); fill.addColorStop(.6, '#9C917C'); fill.addColorStop(1, '#5E5649');
  g.beginPath(); g.roundRect(x - w / 2, y - h, w, h, [w * .45, w * .45, 2, 2]); g.fillStyle = fill; g.fill();
  const r = radius * .22, cy = y - h - r * .55;
  g.beginPath(); g.arc(x, cy, r, 0, Math.PI * 2);
  const disc = g.createRadialGradient(x - r * .3, cy - r * .3, r * .1, x, cy, r);
  disc.addColorStop(0, lighten(glyph.color, .35)); disc.addColorStop(1, darken(glyph.color, .25));
  g.fillStyle = disc; g.fill(); g.strokeStyle = '#E9C979'; g.lineWidth = Math.max(1.2, r * .2); g.stroke();
  g.strokeStyle = '#3A2A14'; g.lineWidth = 1; g.beginPath(); g.arc(x, cy, r + Math.max(1.2, r * .2) / 2, 0, Math.PI * 2); g.stroke();
  g.font = `700 ${Math.max(8, r * 1.15)}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = Math.max(2, r * .22); g.strokeStyle = 'rgba(30,20,10,.75)'; g.strokeText(glyph.mark, x, cy + r * .05);
  g.fillStyle = '#FFF8E6'; g.fillText(glyph.mark, x, cy + r * .05);
}

/**
 * Border ribbons (§2.3): inside the owner's edge, a soft wash of the civ colour fading inward, then a dark rim, the ribbon and a
 * light thread. Edges are pulled 9 % toward the tile centre so two civs' ribbons on one edge sit side by side.
 */
function borders(g: CanvasRenderingContext2D, args: Base25d, items: readonly Item[]) {
  const { scene, radius, squash: sq, ownerColor } = args, at = new Map<number, Point[]>();
  // Wrapped copies may place one index more than once: draw each edge at every placement.
  for (const item of items) { const list = at.get(item.index); if (list) list.push(item.p); else at.set(item.index, [item.p]); }
  const lines = new Map<number, [Point, Point][]>();
  for (const edge of scene.territoryEdges) {
    for (const p of at.get(edge.index) ?? []) {
      const [a, b] = edgePoints(p, radius, sq, edge.direction), pull = (q: Point, t: number) => ({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t });
      const a1 = pull(a, .09), b1 = pull(b, .09), a2 = pull(a, .45), b2 = pull(b, .45), color = ownerColor(edge.ownerId ?? null);
      const wash = g.createLinearGradient((a1.x + b1.x) / 2, (a1.y + b1.y) / 2, (a2.x + b2.x) / 2, (a2.y + b2.y) / 2);
      wash.addColorStop(0, alpha(color, .5)); wash.addColorStop(1, alpha(color, 0));
      g.beginPath(); g.moveTo(a1.x, a1.y); g.lineTo(b1.x, b1.y); g.lineTo(b2.x, b2.y); g.lineTo(a2.x, a2.y); g.closePath(); g.fillStyle = wash; g.fill();
      const list = lines.get(edge.ownerId ?? -1);
      if (list) list.push([a1, b1]); else lines.set(edge.ownerId ?? -1, [[a1, b1]]);
    }
  }
  for (const [owner, segments] of lines) {
    const color = ownerColor(owner < 0 ? null : owner), path = new Path2D();
    for (const [a, b] of segments) { path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = alpha(darken(color, .55), .75); g.lineWidth = Math.max(2.4, radius * .17); g.stroke(path);
    g.strokeStyle = lighten(color, .12); g.lineWidth = Math.max(1.4, radius * .1); g.stroke(path);
    g.strokeStyle = alpha(lighten(color, .6), .9); g.lineWidth = Math.max(.7, radius * .028); g.stroke(path);
  }
}
