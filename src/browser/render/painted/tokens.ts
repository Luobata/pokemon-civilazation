// ui-painted §2.4–§2.6: the painted theme's map tokens — Pokémon as medallion unit flags (the sprite in a civ-coloured metal ring
// on a short pole with two pennant tails, a type badge, the colour-blind ring pattern and the civ number), illustrated towns that
// grow with population, ribbon city banners, and tile yields as small round coins. Frames, towns, type badges and yield rows are
// baked per look and size bucket; a frame draws them with a few drawImage calls (the sprite itself as before).
import type { TypeId } from '../../../content/species.ts';
import type { Yield } from '../../../content/economy.ts';
import { TYPE_COLORS } from '../../../content/type-colors.ts';
import type { Point } from '../../camera.ts';
import { TYPE_SYMBOLS } from '../../ui-icons.ts';
import { SERIF, alpha, bucket, dab, darken, lighten, makeCanvas, mix, spriteCache } from './kit.ts';

const BRASS = '#E2BE6E', BRASS_DARK = '#7A5626', OUTLINE = '#22170D', CREAM = '#FBF3DD';

/** Colour-blind-safe ring pattern by civ (same scheme as the pixel map: 1 plain, 2 stripes, 3 dots, 4 cross-hatch). */
function pattern(g: CanvasRenderingContext2D, ownerId: number | null, x: number, y: number, size: number) {
  if (ownerId === null || ownerId === 0) return;
  g.strokeStyle = 'rgba(255,250,236,.55)'; g.fillStyle = 'rgba(255,250,236,.6)'; g.lineWidth = Math.max(1, size * .045);
  const spacing = Math.max(3, size * .2);
  if (ownerId === 2) {
    for (let px = x - size; px <= x + size; px += spacing) for (let py = y - size; py <= y + size; py += spacing) { g.beginPath(); g.arc(px, py, Math.max(.8, size * .045), 0, Math.PI * 2); g.fill(); }
    return;
  }
  for (let offset = -size * 2; offset <= size * 2; offset += spacing) {
    g.beginPath(); g.moveTo(x - size + offset, y + size); g.lineTo(x + size + offset, y - size);
    if (ownerId === 3) { g.moveTo(x - size + offset, y - size); g.lineTo(x + size + offset, y + size); }
    g.stroke();
  }
}

export type MedallionLook = { ownerId: number | null; color: string; hostile: boolean; spent: boolean };
/** Medallion geometry in units of its radius m: centre (1.5m, 1.3m) of a 3m × 3.1m canvas, ground (pole foot) 1.55m below the centre. */
export const MEDALLION = { width: 3, height: 3.1, cx: 1.5, cy: 1.3, ground: 1.55 };
const frames = spriteCache<HTMLCanvasElement>(96);
/** The baked frame (shadow, pole, pennant tails, ring, inner disc, civ number) for a radius of `m` device px. */
export function medallionFrame(look: MedallionLook, m: number): HTMLCanvasElement {
  return frames.get(`${look.ownerId}|${look.color}|${look.hostile ? 1 : 0}${look.spent ? 1 : 0}|${m}`, () => {
    const { canvas, context: g } = makeCanvas(m * MEDALLION.width, m * MEDALLION.height), cx = m * MEDALLION.cx, cy = m * MEDALLION.cy, gy = cy + m * MEDALLION.ground;
    const base = look.spent ? mix(look.color, '#9A958A', .55) : look.color, line = Math.max(1, m * .07);
    dab(g, cx + m * .15, gy, m * .75, m * .26, '#140E08', .55);
    g.fillStyle = '#3A2A18'; g.fillRect(cx - m * .05, cy + m * .6, m * .1, gy - cy - m * .6);
    // Pennant tails behind the medallion.
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + side * m * .62, cy + m * .45); g.lineTo(cx + side * m * .2, cy + m * .72); g.lineTo(cx + side * m * .26, cy + m * 1.42);
      g.lineTo(cx + side * m * .42, cy + m * 1.22); g.lineTo(cx + side * m * .62, cy + m * 1.36); g.closePath();
      const fill = g.createLinearGradient(cx, cy + m * .5, cx, cy + m * 1.4);
      fill.addColorStop(0, darken(base, .1)); fill.addColorStop(1, darken(base, .45));
      g.fillStyle = fill; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = line * .8; g.stroke();
    }
    if (look.hostile) {
      g.beginPath(); g.arc(cx, cy, m * 1.13, 0, Math.PI * 2); g.strokeStyle = OUTLINE; g.lineWidth = m * .2; g.stroke();
      g.strokeStyle = '#E5554A'; g.lineWidth = m * .11; g.stroke();
    }
    // The metal ring in the civ colour, lit from the upper left, with the colour-blind pattern.
    g.beginPath(); g.arc(cx, cy, m, 0, Math.PI * 2);
    const ring = g.createLinearGradient(cx - m, cy - m, cx + m, cy + m);
    ring.addColorStop(0, lighten(base, .5)); ring.addColorStop(.45, base); ring.addColorStop(1, darken(base, .45));
    g.fillStyle = ring; g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, m, 0, Math.PI * 2); g.arc(cx, cy, m * .78, 0, Math.PI * 2, true); g.clip(); pattern(g, look.ownerId, cx, cy, m); g.restore();
    g.beginPath(); g.arc(cx, cy, m * .93, Math.PI * 1.05, Math.PI * 1.7); g.strokeStyle = 'rgba(255,252,240,.6)'; g.lineWidth = m * .06; g.lineCap = 'round'; g.stroke();
    g.beginPath(); g.arc(cx, cy, m, 0, Math.PI * 2); g.strokeStyle = OUTLINE; g.lineWidth = line; g.stroke();
    // Inner disc: warm cream, a brass bevel line.
    g.beginPath(); g.arc(cx, cy, m * .78, 0, Math.PI * 2);
    const disc = g.createRadialGradient(cx - m * .2, cy - m * .25, m * .1, cx, cy, m * .8);
    disc.addColorStop(0, look.spent ? '#E9E4D8' : CREAM); disc.addColorStop(1, look.spent ? '#BDB6A6' : mix('#E2CFA2', base, .18));
    g.fillStyle = disc; g.fill();
    g.strokeStyle = look.spent ? '#8C8576' : BRASS_DARK; g.lineWidth = line * .9; g.stroke();
    g.beginPath(); g.arc(cx, cy, m * .78 + line, Math.PI * .1, Math.PI * .9); g.strokeStyle = alpha(BRASS, .7); g.lineWidth = line * .6; g.stroke();
    // Civ number (or 爪 for wild Pokémon) on a small boss at the upper right.
    const bx = cx + m * .74, by = cy - m * .74, br = m * .32;
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fillStyle = darken(base, .3); g.fill(); g.strokeStyle = BRASS; g.lineWidth = line * .8; g.stroke();
    g.fillStyle = '#FFF8E6'; g.font = `800 ${Math.round(br * 1.25)}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(look.ownerId === null ? '爪' : String(look.ownerId + 1), bx, by + br * .08);
    return canvas;
  });
}

const typeBadges = spriteCache<HTMLCanvasElement>(64);
/** A round type badge (type colour, brass rim, the type's symbol in cream) of radius `r` device px; centre = canvas centre. */
export function typeBadge(type: TypeId, r: number): HTMLCanvasElement {
  return typeBadges.get(`${type}|${r}`, () => {
    const size = Math.ceil(r * 2 + 4), { canvas, context: g } = makeCanvas(size, size), c = size / 2, color = TYPE_COLORS[type];
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2);
    const fill = g.createRadialGradient(c - r * .3, c - r * .35, r * .1, c, c, r);
    fill.addColorStop(0, lighten(color, .35)); fill.addColorStop(1, darken(color, .35));
    g.fillStyle = fill; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, r * .2); g.stroke();
    g.beginPath(); g.arc(c, c, r * .86, 0, Math.PI * 2); g.strokeStyle = alpha(BRASS, .9); g.lineWidth = Math.max(.6, r * .08); g.stroke();
    const rows = TYPE_SYMBOLS[type], cell = r * 1.1 / rows.length, left = c - cell * rows.length / 2;
    g.fillStyle = '#FFF8E6';
    for (const [y, row] of rows.entries()) for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.fillRect(left + x * cell, left + y * cell, cell + .3, cell + .3);
    return canvas;
  });
}

// ---------- Towns ----------
const ROOFS = ['#C8553D', '#D9733F', '#B5483A', '#C9663A'];
/** House slots (x, y in tile radii, y before the tilt), nearest the centre first. */
const SLOTS: readonly (readonly [number, number])[] = [[-.48, .16], [.46, .12], [-.2, .46], [.26, .48], [-.6, -.22], [.62, -.2], [-.08, -.46], [-.72, .44], [.74, .4], [.36, -.5], [-.4, -.52]];
export type TownLook = { color: string; population: number; capital: boolean; wonders: number };
/** Town geometry: canvas 2.8R × 2.6R, tile centre at (1.4R, 1.7R). */
export const TOWN = { width: 2.8, height: 2.6, ox: 1.4, oy: 1.7 };
const towns = spriteCache<{ town: HTMLCanvasElement; lights: HTMLCanvasElement }>(64);
const houseCount = (population: number) => Math.min(SLOTS.length, 2 + Math.floor(population / 2));

function house(g: CanvasRenderingContext2D, x: number, y: number, s: number, roof: string, windows: Point[]) {
  dab(g, x + s * .45, y + s * .05, s * .95, s * .3, '#140E08', .45);
  g.beginPath(); g.moveTo(x + s * .5, y); g.lineTo(x + s * .86, y - s * .2); g.lineTo(x + s * .86, y - s * .76); g.lineTo(x + s * .5, y - s * .56); g.closePath();
  g.fillStyle = '#B99D74'; g.fill();
  g.beginPath(); g.moveTo(x - s * .5, y); g.lineTo(x + s * .5, y); g.lineTo(x + s * .5, y - s * .56); g.lineTo(x, y - s * .98); g.lineTo(x - s * .5, y - s * .56); g.closePath();
  const wall = g.createLinearGradient(x - s * .5, y - s, x + s * .5, y);
  wall.addColorStop(0, '#FBEED3'); wall.addColorStop(1, '#DCC39A');
  g.fillStyle = wall; g.fill();
  g.beginPath(); g.moveTo(x, y - s * .98); g.lineTo(x + s * .5, y - s * .56); g.lineTo(x + s * .88, y - s * .78); g.lineTo(x + s * .38, y - s * 1.2); g.closePath();
  const tile = g.createLinearGradient(x, y - s * 1.2, x + s * .8, y - s * .6);
  tile.addColorStop(0, lighten(roof, .25)); tile.addColorStop(1, darken(roof, .2));
  g.fillStyle = tile; g.fill();
  g.beginPath(); g.moveTo(x - s * .58, y - s * .5); g.lineTo(x, y - s * 1.01); g.lineTo(x + s * .56, y - s * .52);
  g.strokeStyle = darken(roof, .35); g.lineWidth = s * .12; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  g.fillStyle = '#5A3A22'; g.beginPath(); g.roundRect(x - s * .1, y - s * .3, s * .2, s * .3, [s * .1, s * .1, 0, 0]); g.fill();
  g.fillStyle = '#4A5868'; g.fillRect(x - s * .36, y - s * .45, s * .14, s * .13); g.fillRect(x + s * .22, y - s * .45, s * .14, s * .13);
  windows.push({ x: x - s * .29, y: y - s * .385 }, { x: x + s * .29, y: y - s * .385 });
}
function tower(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, windows: Point[]) {
  dab(g, x + s * .4, y, s * .8, s * .28, '#140E08', .5);
  const body = g.createLinearGradient(x - s * .3, 0, x + s * .3, 0);
  body.addColorStop(0, '#EADCC0'); body.addColorStop(.6, '#BFA985'); body.addColorStop(1, '#8E7A5E');
  g.fillStyle = body; g.fillRect(x - s * .3, y - s * 1.3, s * .6, s * 1.3);
  for (let k = 0; k < 3; k++) g.fillRect(x - s * .34 + k * s * .26, y - s * 1.42, s * .16, s * .14);
  g.beginPath(); g.moveTo(x - s * .4, y - s * 1.36); g.lineTo(x, y - s * 2.05); g.lineTo(x + s * .4, y - s * 1.36); g.closePath();
  const roof = g.createLinearGradient(x - s * .4, 0, x + s * .4, 0);
  roof.addColorStop(0, lighten(color, .3)); roof.addColorStop(1, darken(color, .35));
  g.fillStyle = roof; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * .04); g.stroke();
  g.fillStyle = '#3A2A18'; g.fillRect(x - s * .025, y - s * 2.45, s * .05, s * .42);
  g.beginPath(); g.moveTo(x + s * .025, y - s * 2.45); g.lineTo(x + s * .42, y - s * 2.33); g.lineTo(x + s * .025, y - s * 2.2); g.closePath(); g.fillStyle = lighten(color, .1); g.fill();
  g.fillStyle = '#4A5868'; g.beginPath(); g.roundRect(x - s * .09, y - s * 1.05, s * .18, s * .26, [s * .09, s * .09, 0, 0]); g.fill();
  windows.push({ x, y: y - s * .92 });
  g.fillStyle = '#5A3A22'; g.beginPath(); g.roundRect(x - s * .12, y - s * .4, s * .24, s * .4, [s * .12, s * .12, 0, 0]); g.fill();
}
function hall(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, windows: Point[]) {
  house(g, x, y, s, color, windows);
  // A small round dome on the hall in the civ colour, banded like a capture ball.
  const dx = x + s * .42, dy = y - s * 1.08, r = s * .26;
  g.beginPath(); g.arc(dx, dy, r, Math.PI, 0); g.closePath();
  const dome = g.createLinearGradient(dx - r, 0, dx + r, 0);
  dome.addColorStop(0, lighten(color, .35)); dome.addColorStop(1, darken(color, .3));
  g.fillStyle = dome; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, s * .035); g.stroke();
  g.fillStyle = '#F6EBD2'; g.fillRect(dx - r, dy - s * .02, r * 2, s * .06);
}
function wonderSpire(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dab(g, x + s * .3, y, s * .6, s * .2, '#140E08', .45);
  const gold = g.createLinearGradient(x - s * .25, 0, x + s * .25, 0);
  gold.addColorStop(0, '#FFF0B0'); gold.addColorStop(.5, '#E6B84E'); gold.addColorStop(1, '#9C7022');
  g.beginPath(); g.arc(x, y - s * .55, s * .3, Math.PI, 0); g.lineTo(x + s * .3, y); g.lineTo(x - s * .3, y); g.closePath(); g.fillStyle = gold; g.fill();
  g.beginPath(); g.moveTo(x - s * .07, y - s * .82); g.lineTo(x, y - s * 1.5); g.lineTo(x + s * .07, y - s * .82); g.closePath(); g.fill();
  g.strokeStyle = '#6E4C14'; g.lineWidth = Math.max(1, s * .04); g.stroke();
}
/** The baked town and its night window glow, for a tile radius bucket R (device px). */
export function townSprite(look: TownLook, R: number, sq: number) {
  const count = houseCount(look.population);
  return towns.get(`${look.color}|${count}|${look.capital ? 1 : 0}|${Math.min(look.wonders, 1)}|${R}|${sq}`, () => {
    const { canvas, context: g } = makeCanvas(R * TOWN.width, R * TOWN.height), ox = R * TOWN.ox, oy = R * TOWN.oy;
    const windows: Point[] = [];
    // The square: warm paving under the houses, with a low stone wall ring for capitals and big towns.
    dab(g, ox, oy + R * .08 * sq, R * .9, R * .62 * sq, '#3A2A16', .4);
    g.beginPath(); g.ellipse(ox, oy + R * .06 * sq, R * .86, R * .62 * sq, 0, 0, Math.PI * 2);
    const plaza = g.createRadialGradient(ox - R * .2, oy - R * .2 * sq, R * .1, ox, oy, R * .8);
    plaza.addColorStop(0, '#E2CDA2'); plaza.addColorStop(1, '#AE9268');
    g.fillStyle = plaza; g.fill();
    const walled = look.capital || look.population >= 8;
    if (walled) { g.beginPath(); g.ellipse(ox, oy + R * .06 * sq, R * .8, R * .58 * sq, 0, Math.PI, 0); g.strokeStyle = '#8A7556'; g.lineWidth = R * .07; g.stroke(); }
    const items: { y: number; draw: () => void }[] = [];
    const s = R * .34;
    for (let k = 0; k < count; k++) {
      const [sx, sy] = SLOTS[k], x = ox + sx * R, y = oy + sy * R * sq;
      items.push({ y, draw: () => house(g, x, y, s * (.86 + (k % 3) * .07), k % 3 === 2 ? look.color : ROOFS[k % ROOFS.length], windows) });
    }
    const cy = oy + R * .02 * sq;
    items.push({ y: cy, draw: () => look.capital ? tower(g, ox, cy, R * .44, look.color, windows) : hall(g, ox, cy, R * .44, look.color, windows) });
    if (look.wonders) { const wy = oy - R * .22 * sq; items.push({ y: wy, draw: () => wonderSpire(g, ox + R * .5, wy, R * .4) }); }
    for (const item of items.sort((a, b) => a.y - b.y)) item.draw();
    if (walled) {
      g.beginPath(); g.ellipse(ox, oy + R * .06 * sq, R * .8, R * .58 * sq, 0, 0, Math.PI);
      g.strokeStyle = '#A38D6A'; g.lineWidth = R * .08; g.stroke();
      g.strokeStyle = '#6E5C44'; g.lineWidth = Math.max(1, R * .015); g.stroke();
    }
    const { canvas: lights, context: l } = makeCanvas(canvas.width, canvas.height);
    for (const w of windows) { dab(l, w.x, w.y, R * .16, R * .13, '#FFB04A', .55); dab(l, w.x, w.y, R * .05, R * .045, '#FFF0B8', 1); }
    dab(l, ox, oy, R * .9, R * .6 * sq, '#FFA040', .16);
    return { town: canvas, lights };
  });
}

// ---------- Yields ----------
const YIELD_LOOK = {
  food: { color: '#5DAA3E', glyph: 'leaf' }, production: { color: '#C9783A', glyph: 'hammer' },
  gold: { color: '#E2AE36', glyph: 'coin' }, research: { color: '#3F8FD0', glyph: 'flask' },
} as const;
type YieldKey = keyof typeof YIELD_LOOK;
const YIELD_ORDER: readonly YieldKey[] = ['food', 'production', 'gold', 'research'];
const yieldRows = spriteCache<HTMLCanvasElement | null>(240);
function coin(g: CanvasRenderingContext2D, x: number, y: number, r: number, key: YieldKey) {
  const { color, glyph } = YIELD_LOOK[key];
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  const fill = g.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
  fill.addColorStop(0, lighten(color, .45)); fill.addColorStop(1, darken(color, .3));
  g.fillStyle = fill; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, r * .16); g.stroke();
  g.fillStyle = '#FFF8E6'; g.strokeStyle = '#FFF8E6'; g.lineWidth = Math.max(1, r * .16); g.lineCap = 'round';
  if (glyph === 'leaf') {
    g.beginPath(); g.moveTo(x - r * .45, y + r * .4); g.quadraticCurveTo(x - r * .5, y - r * .45, x + r * .45, y - r * .45); g.quadraticCurveTo(x + r * .4, y + r * .4, x - r * .45, y + r * .4); g.fill();
    g.beginPath(); g.moveTo(x - r * .45, y + r * .4); g.lineTo(x + r * .1, y - r * .1); g.strokeStyle = darken(color, .2); g.lineWidth = Math.max(.7, r * .1); g.stroke();
  } else if (glyph === 'hammer') {
    g.save(); g.translate(x, y); g.rotate(-.7);
    g.fillRect(-r * .1, -r * .2, r * .2, r * .78); g.fillRect(-r * .45, -r * .5, r * .9, r * .32); g.restore();
  } else if (glyph === 'coin') {
    g.beginPath(); g.arc(x, y, r * .5, 0, Math.PI * 2); g.lineWidth = Math.max(1, r * .18); g.stroke();
    g.fillRect(x - r * .07, y - r * .3, r * .14, r * .6);
  } else {
    g.beginPath(); g.moveTo(x - r * .14, y - r * .55); g.lineTo(x + r * .14, y - r * .55); g.lineTo(x + r * .14, y - r * .1); g.lineTo(x + r * .48, y + r * .45);
    g.lineTo(x - r * .48, y + r * .45); g.lineTo(x - r * .14, y - r * .1); g.closePath(); g.fill();
  }
}
/** Baked yield row (round coins, a number beside a coin worth more than 1) for coin radius `r` device px; centre = canvas centre. */
export function yieldRow(yields: Yield, r: number): HTMLCanvasElement | null {
  const values = YIELD_ORDER.map(key => Math.max(0, Math.round((yields as Record<string, number>)[key] ?? 0)));
  return yieldRows.get(`${values.join(',')}|${r}`, () => {
    const shown = YIELD_ORDER.map((key, k) => ({ key, value: values[k] })).filter(item => item.value > 0);
    if (!shown.length) return null;
    const digit = r * .95, gap = r * .25, widths = shown.map(item => r * 2 + (item.value > 1 ? digit * String(item.value).length * .62 + r * .1 : 0));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
    const { canvas, context: g } = makeCanvas(total + 4, r * 2 + 4), cy = canvas.height / 2;
    // A soft dark backing so the coins read on bright snow and sand.
    g.beginPath(); g.roundRect(1, cy - r - 1, total + 2, r * 2 + 2, r + 1); g.fillStyle = 'rgba(28,20,10,.42)'; g.fill();
    let x = 2;
    g.font = `800 ${Math.round(digit * 1.15)}px ${SERIF}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (const [k, item] of shown.entries()) {
      coin(g, x + r, cy, r, item.key);
      if (item.value > 1) {
        const tx = x + r * 2 + r * .05;
        g.lineWidth = Math.max(2, r * .35); g.strokeStyle = OUTLINE; g.lineJoin = 'round'; g.strokeText(String(item.value), tx, cy + r * .08);
        g.fillStyle = '#FFF8E6'; g.fillText(String(item.value), tx, cy + r * .08);
      }
      x += widths[k] + gap;
    }
    return canvas;
  });
}

const plates = spriteCache<HTMLCanvasElement>(48);
/** A round plate (parchment face, `ring` colour rim, brass bevel, soft shadow) of radius `r` device px; centre = canvas centre. */
export function plate(ring: string, r: number): HTMLCanvasElement {
  return plates.get(`${ring}|${r}`, () => {
    const size = Math.ceil(r * 2.6 + 4), { canvas, context: g } = makeCanvas(size, size), c = size / 2;
    dab(g, c + r * .2, c + r * .35, r * 1.15, r * .8, '#140E08', .45);
    g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2);
    const face = g.createRadialGradient(c - r * .3, c - r * .35, r * .1, c, c, r);
    face.addColorStop(0, '#FBF3DD'); face.addColorStop(1, '#D6C194');
    g.fillStyle = face; g.fill();
    g.strokeStyle = ring; g.lineWidth = Math.max(1.5, r * .18); g.stroke();
    g.beginPath(); g.arc(c, c, r + Math.max(1.5, r * .18) / 2 + .5, 0, Math.PI * 2); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, r * .07); g.stroke();
    g.beginPath(); g.arc(c, c, r * .8, Math.PI * 1.05, Math.PI * 1.75); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = Math.max(1, r * .08); g.lineCap = 'round'; g.stroke();
    return canvas;
  });
}

/** Device-pixel bucket for a CSS size at this DPR. */
export const sized = (css: number, dpr: number) => bucket(css * dpr);
