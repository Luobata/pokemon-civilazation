// ui-painted §2.8: explored-but-not-visible tiles become a cartographer's chart — warm parchment over the terrain, the land drawn
// back in brown ink (wave lines on the sea, little peaks, tree lollipops, dune stipple), an inked coastline with ripple lines, a
// scorched rim where the chart meets the living map, and dashed civ-coloured borders. Painted into the cached fog layer.
import type { Point } from '../../camera.ts';
import { neighbourIndexOf } from '../projection.ts';
import type { MapScene } from '../scene.ts';
import { DIRECTION_ANGLES, EDGE_CORNERS, addHex, alpha, bucket, corner, dab, darken, makeCanvas, spriteCache, stream, stroke } from './kit.ts';
import { flagsFor, groundKind, inkedProp, variantOf } from './terrain.ts';
import type { GroundKind } from './terrain.ts';

export const INK = '#4A3420';
const PARCHMENT = '#E9D6A6';

let parchmentTile: HTMLCanvasElement | null = null;
/** A seamless-enough 256 px parchment texture (blotches, fibres, speckles), baked once. */
function parchment(): HTMLCanvasElement {
  if (parchmentTile) return parchmentTile;
  const size = 256, { canvas, context: g } = makeCanvas(size, size), rnd = stream(4421);
  g.fillStyle = PARCHMENT; g.fillRect(0, 0, size, size);
  // Wrap every mark at the tile edges so the pattern repeats without seams.
  const wrapped = (x: number, y: number, reach: number, paint: (x: number, y: number) => void) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      if (x + dx < -reach || x + dx > size + reach || y + dy < -reach || y + dy > size + reach) continue;
      paint(x + dx, y + dy);
    }
  };
  for (let k = 0; k < 40; k++) {
    const x = rnd() * size, y = rnd() * size, r = 18 + rnd() * 46, tone = ['#D9BE86', '#F3E5C2', '#DCC48F', '#CDAF77'][k % 4];
    wrapped(x, y, r, (px, py) => dab(g, px, py, r, r * (.6 + rnd() * .5), tone, .28));
  }
  for (let k = 0; k < 140; k++) {
    const x = rnd() * size, y = rnd() * size, length = 6 + rnd() * 22, angle = (rnd() - .5) * .8;
    wrapped(x, y, length, (px, py) => stroke(g, px, py, length, angle, .15, .7, alpha(k % 3 ? '#B8955E' : '#FFF6DE', .3)));
  }
  for (let k = 0; k < 260; k++) { const x = rnd() * size, y = rnd() * size; g.fillStyle = alpha('#8A6A3A', .12 + rnd() * .18); g.fillRect(x, y, 1, 1); }
  parchmentTile = canvas;
  return canvas;
}
const patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

const glyphs = spriteCache<HTMLCanvasElement | null>(120);
/** Ink drawing for a fogged tile (centre = canvas centre), or null for plain parchment. */
function inkGlyph(kind: GroundKind, hill: boolean, peak: boolean, variant: number, R: number, sq: number): HTMLCanvasElement | null {
  return glyphs.get(`${kind}|${hill ? 1 : 0}${peak ? 1 : 0}|${variant}|${R}|${sq}`, () => {
    const w = R * 2, h = R * 2.4, { canvas, context: g } = makeCanvas(w, h), cx = w / 2, cy = h * .58, rnd = stream(kind.length * 131 + variant * 977 + (hill ? 7 : 0) + (peak ? 11 : 0));
    const line = Math.max(1, R * .035), ink = alpha(INK, .78), soft = alpha(INK, .45);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const wave = (x: number, y: number, size: number, color = ink) => {
      g.beginPath(); g.moveTo(x - size, y);
      g.quadraticCurveTo(x - size / 2, y - size * .45, x, y); g.quadraticCurveTo(x + size / 2, y + size * .45, x + size, y);
      g.strokeStyle = color; g.lineWidth = line; g.stroke();
    };
    const peakGlyph = (x: number, y: number, size: number, snow: boolean) => {
      g.beginPath(); g.moveTo(x - size * .7, y); g.lineTo(x - size * .05, y - size); g.lineTo(x + size * .7, y);
      g.strokeStyle = ink; g.lineWidth = line * 1.2; g.stroke();
      // Hatching on the shaded east face.
      for (let k = 1; k <= 4; k++) { const t = k / 5; g.beginPath(); g.moveTo(x - size * .05 + size * .75 * t * .9, y - size + size * t); g.lineTo(x - size * .02 + size * .1 * t, y - size * .1 * (1 - t)); g.strokeStyle = soft; g.lineWidth = line * .7; g.stroke(); }
      if (snow) { g.beginPath(); g.moveTo(x - size * .28, y - size * .6); g.lineTo(x - size * .12, y - size * .5); g.lineTo(x, y - size * .62); g.lineTo(x + size * .18, y - size * .52); g.strokeStyle = ink; g.lineWidth = line * .8; g.stroke(); }
    };
    const tree = (x: number, y: number, size: number) => {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - size * .5); g.strokeStyle = ink; g.lineWidth = line; g.stroke();
      g.beginPath(); g.arc(x, y - size * .85, size * .38, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(x + size * .1, y - size * .8, size * .2, -.3, 1.6); g.strokeStyle = soft; g.stroke();
    };
    const pine = (x: number, y: number, size: number) => {
      g.beginPath(); g.moveTo(x, y - size * 1.2); g.lineTo(x - size * .38, y - size * .15); g.lineTo(x + size * .38, y - size * .15); g.closePath();
      g.strokeStyle = ink; g.lineWidth = line; g.stroke(); g.beginPath(); g.moveTo(x, y - size * .15); g.lineTo(x, y + size * .05); g.stroke();
    };
    const at = (spread = .55) => ({ x: cx + (rnd() - .5) * 2 * spread * R, y: cy + (rnd() - .5) * 2 * spread * R * sq });
    let drew = true;
    if (kind === 'ocean' || kind === 'shallow' || kind === 'deep' || kind === 'lake') {
      const count = kind === 'deep' ? 3 : kind === 'lake' ? 1 : 2;
      for (let k = 0; k < count; k++) wave(cx + (rnd() - .5) * R * .7, cy + (k - (count - 1) / 2) * R * .36 * sq, R * .16, kind === 'deep' ? ink : soft);
    } else if (kind === 'grassland') {
      for (let k = 0; k < 4; k++) { const { x, y } = at(); g.beginPath(); g.moveTo(x - R * .05, y - R * .07); g.lineTo(x, y); g.lineTo(x + R * .06, y - R * .09); g.strokeStyle = soft; g.lineWidth = line; g.stroke(); }
    } else if (kind === 'forest') {
      const spots = [[-.32, -.1], [.25, -.18], [-.02, .22], [.4, .2], [-.42, .26]].slice(0, 3 + variant % 3);
      for (const [dx, dy] of spots.sort((a, b) => a[1] - b[1])) tree(cx + dx * R, cy + dy * R * sq + R * .2, R * .32);
    } else if (kind === 'snow') {
      for (const [dx, dy] of [[-.25, 0], [.22, .15]]) pine(cx + dx * R, cy + dy * R * sq + R * .15, R * .32);
      for (let k = 0; k < 6; k++) { const { x, y } = at(); g.fillStyle = soft; g.fillRect(x, y, line, line); }
    } else if (kind === 'desert') {
      for (let k = 0; k < 2; k++) { const y = cy + (k - .5) * R * .4 * sq; g.beginPath(); g.moveTo(cx - R * .4, y); g.quadraticCurveTo(cx, y - R * .16, cx + R * .4, y); g.strokeStyle = soft; g.lineWidth = line; g.stroke(); }
      for (let k = 0; k < 18; k++) { const { x, y } = at(); g.fillStyle = soft; g.fillRect(x, y, line * .9, line * .9); }
    } else if (kind === 'mountain') {
      peakGlyph(cx + R * .28, cy + R * .1, R * .42, false);
      peakGlyph(cx - R * .12, cy + R * .25, R * (peak ? .78 : .6), peak);
    } else if (kind === 'volcano') {
      g.beginPath(); g.moveTo(cx - R * .45, cy + R * .25); g.lineTo(cx - R * .1, cy - R * .32); g.lineTo(cx + R * .1, cy - R * .32); g.lineTo(cx + R * .45, cy + R * .25);
      g.strokeStyle = ink; g.lineWidth = line * 1.2; g.stroke();
      g.beginPath(); g.moveTo(cx, cy - R * .36); g.bezierCurveTo(cx - R * .2, cy - R * .55, cx + R * .2, cy - R * .65, cx + R * .05, cy - R * .85); g.strokeStyle = soft; g.lineWidth = line; g.stroke();
    } else drew = false;
    if (hill && kind !== 'mountain' && kind !== 'volcano') {
      for (const [dx, size] of [[-.15, .32], [.25, .22]] as const) { g.beginPath(); g.arc(cx + dx * R, cy + R * .32, R * size, Math.PI * 1.1, Math.PI * 1.9); g.strokeStyle = ink; g.lineWidth = line; g.stroke(); }
      drew = true;
    }
    if (peak && kind !== 'mountain') { peakGlyph(cx, cy + R * .2, R * .7, true); drew = true; }
    return drew ? canvas : null;
  });
}

export type FogArgs = {
  context: CanvasRenderingContext2D; scene: MapScene; radius: number; squash: number;
  /** Screen centres, one array per wrapped copy. */
  copies: readonly Point[][];
  onscreen(p: Point): boolean;
  ownerColor(ownerId: number | null): string;
};

/** The parchment chart over every fogged tile (all wrapped copies). */
export function drawFogPainted(f: FogArgs): void {
  const { context: g, scene, radius, squash: sq } = f;
  if (!scene.fog.length) return;
  const dpr = g.getTransform().a || 1, R = bucket(radius * dpr), k = radius / R, flags = flagsFor(scene), fog = flags.fog;
  let pattern = patterns.get(g);
  if (!pattern) { pattern = g.createPattern(parchment(), 'repeat')!; patterns.set(g, pattern); }
  // The paper moves with the map: anchor the pattern on the first copy's tile 0 (CSS px; the context carries the DPR scale).
  const origin = f.copies[0][0];
  pattern.setTransform(new DOMMatrix().translate(origin.x, origin.y).scale(.5 + .5 * Math.min(2, radius / 22)));
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  const shown: { index: number; p: Point }[] = [];
  for (const centres of f.copies) for (const index of scene.fog) if (f.onscreen(centres[index])) shown.push({ index, p: centres[index] });
  // 1. Parchment over the fogged hexes (one fill), with a faint tint by terrain so sea and land still read.
  g.beginPath();
  for (const { p } of shown) addHex(g, p.x, p.y, radius + .6, sq);
  g.fillStyle = pattern; g.globalAlpha = .94; g.fill(); g.globalAlpha = 1;
  // Soft washes (overlapping dabs, no hex edges): the sea a little blue-grey, forests olive, mountains umber.
  const washes: Partial<Record<string, string>> = { ocean: '#5E7F8C', shallow: '#6A8C8E', deep: '#4A6880', lake: '#6A8C8E', forest: '#6E7A3A', mountain: '#7A5E3C', volcano: '#6E3E30', snow: '#FFFFFF' };
  g.save();
  g.beginPath(); for (const { p } of shown) addHex(g, p.x, p.y, radius + .6, sq); g.clip();
  for (const { index, p } of shown) {
    const kind = groundKind(scene, flags, index), color = washes[kind];
    if (color) dab(g, p.x, p.y, radius * 1.25, radius * 1.25 * sq, color, kind === 'deep' ? .34 : kind === 'snow' ? .3 : .24);
  }
  g.restore();
  // 2. The land in ink: the map art's own props redrawn in brown ink when it covers the tile, else the procedural ink glyph.
  for (const { index, p } of shown) {
    const biome = scene.tiles[index].biome;
    if (!biome) continue;
    const inked = inkedProp(scene, flags, index, R, sq);
    if (inked) { g.drawImage(inked.canvas, p.x - inked.ox * k, p.y - inked.oy * k, inked.canvas.width * k, inked.canvas.height * k); continue; }
    const glyph = inkGlyph(groundKind(scene, flags, index), Boolean(flags.hill[index]), Boolean(flags.peak[index]), variantOf(index), R, sq);
    if (glyph) g.drawImage(glyph, p.x - glyph.width * k / 2, p.y - glyph.height * .58 * k, glyph.width * k, glyph.height * k);
  }
  const edge = (p: Point, direction: number, offset: number, inset = 0): [Point, Point] => {
    const [a, b] = EDGE_CORNERS[direction], angle = DIRECTION_ANGLES[direction];
    const pa = corner(p, radius, sq, a), pb = corner(p, radius, sq, b), nx = Math.cos(angle) * offset * radius, ny = Math.sin(angle) * sq * offset * radius;
    return [{ x: pa.x + (pb.x - pa.x) * inset + nx, y: pa.y + (pb.y - pa.y) * inset + ny }, { x: pb.x + (pa.x - pb.x) * inset + nx, y: pb.y + (pa.y - pb.y) * inset + ny }];
  };
  const strokeSegments = (segments: [Point, Point][], color: string, width: number, dash: number[] = []) => {
    if (!segments.length) return;
    g.beginPath(); for (const [a, b] of segments) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.setLineDash([]);
  };
  // 3. Inked coastline with two ripple lines on the water side; rivers as single ink lines.
  const coast: [Point, Point][] = [], ripple1: [Point, Point][] = [], ripple2: [Point, Point][] = [];
  for (const { index, p } of shown) {
    if (!flags.coast.has(index)) continue;
    for (const direction of flags.coast.get(index)!) { coast.push(edge(p, direction, .02)); ripple1.push(edge(p, direction, -.13, .1)); ripple2.push(edge(p, direction, -.25, .2)); }
  }
  for (const centres of f.copies) for (const [index, directions] of flags.coast) {
    // Land side fogged while the water tile is visible: ink that shore too.
    if (fog[index]) continue;
    const p = centres[index];
    if (!f.onscreen(p)) continue;
    for (const direction of directions) { const other = neighbourIndexOf(scene, index, direction); if (other >= 0 && fog[other]) coast.push(edge(p, direction, .02)); }
  }
  strokeSegments(ripple2, alpha(INK, .28), Math.max(.8, radius * .025));
  strokeSegments(ripple1, alpha(INK, .45), Math.max(.8, radius * .03));
  strokeSegments(coast, alpha(INK, .85), Math.max(1.2, radius * .065));
  g.beginPath();
  for (const { index, p } of shown) for (const direction of flags.rivers.get(index) ?? []) {
    const angle = DIRECTION_ANGLES[direction];
    g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(angle) * radius * .87, p.y + Math.sin(angle) * radius * .87 * sq);
  }
  g.strokeStyle = alpha(INK, .7); g.lineWidth = Math.max(1, radius * .05); g.stroke();
  // 4. Borders in fog: dashed ink in the civ's colour.
  const byOwner = new Map<number, [Point, Point][]>(), fogAt = new Map<number, Point[]>();
  for (const { index, p } of shown) { const list = fogAt.get(index); if (list) list.push(p); else fogAt.set(index, [p]); }
  for (const item of scene.territoryEdges) for (const p of fogAt.get(item.index) ?? []) {
    const list = byOwner.get(item.ownerId ?? -1), segment = edge(p, item.direction, -.08);
    if (list) list.push(segment); else byOwner.set(item.ownerId ?? -1, [segment]);
  }
  for (const [owner, segments] of byOwner) strokeSegments(segments, darken(f.ownerColor(owner < 0 ? null : owner), .15), Math.max(1.4, radius * .07), [radius * .22, radius * .14]);
  // 5. Where the chart meets the living map: a scorched rim and a fine ink edge.
  const rim: [Point, Point][] = [];
  for (const { index, p } of shown) for (let direction = 0; direction < 6; direction++) {
    const other = neighbourIndexOf(scene, index, direction);
    if (other >= 0 && !fog[other] && scene.tiles[other].biome) rim.push(edge(p, direction, -.02));
  }
  strokeSegments(rim, 'rgba(120,80,36,.3)', Math.max(3, radius * .24));
  strokeSegments(rim, alpha(INK, .6), Math.max(.8, radius * .03));
  g.restore();
}
