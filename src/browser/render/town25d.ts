// ui-25d billboards (docs/design/ui-25d.md §5–§6): pseudo-3D towns that grow with population, and the unit plinth (a squashed
// faction-coloured token with a thickness and a contact shadow cast to the south-east). Original pixel art drawn with fillRect into
// cached canvases; the faction patterns repeat the flat map's colour-blind-safe marks (stripes, dots, cross-hatch).
import type { Point } from '../camera.ts';
import { propScale } from './projection.ts';
import { drawPixelArt, snappedScale } from './terrain25d.ts';

const RT = 24;
/** Town canvas (native pixels): room above the tile for the keep and its flag. */
const TW = 48, TH = 52, TC = { x: 24, y: 36 };

type Paint = { context: CanvasRenderingContext2D; cx: number; cy: number };
const rect = (g: Paint, color: string, x: number, y: number, width = 1, height = 1) => {
  g.context.fillStyle = color;
  g.context.fillRect(Math.round(g.cx + x), Math.round(g.cy + y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
};
/** Lighter / darker variant of a #RRGGBB colour (pixel-art ramps without filters). */
function tone(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1, 7), 16), channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  };
  return `#${[16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

const OUTLINE = '#263B39';
/** A house seen from the south, a little from above: roof ridge, front roof slope in the owner's colour, lit wall, door, window. */
function house(g: Paint, x: number, y: number, width: number, wall: number, roof: string, windows: Point[]) {
  rect(g, 'rgba(8,20,24,.38)', x - width / 2 + 2, y - 1, width + 2, 3);
  rect(g, OUTLINE, x - width / 2 - 1, y - wall - 1, width + 2, wall + 2);
  rect(g, '#EADCB8', x - width / 2, y - wall, width, wall);
  rect(g, '#C9B88F', x + width / 2 - 2, y - wall, 2, wall);
  rect(g, '#6B4A35', x - 1, y - 3, 2, 3);
  if (width >= 7) { rect(g, '#5C7F8C', x - width / 2 + 1, y - wall + 1, 2, 2); windows.push({ x: x - width / 2 + 1, y: y - wall + 1 }); }
  // Roof: three rows, widest at the eaves, lit on the left.
  const rows = 4;
  for (let j = 0; j < rows; j++) {
    const half = width / 2 + 1 - j, top = y - wall - 1 - (rows - j);
    rect(g, OUTLINE, x - half - 1, top - (j === 0 ? 1 : 0), half * 2 + 2, 1 + (j === 0 ? 1 : 0));
    rect(g, tone(roof, j === 0 ? .25 : 0), x - half, top, half, 1);
    rect(g, tone(roof, -.25), x, top, half, 1);
  }
  rect(g, tone(roof, -.45), x - width / 2 - 1, y - wall - 1, width + 2, 1);
}
/** The centre building: a hall (or a keep with crenellations and a pennant for a capital). */
function keep(g: Paint, x: number, y: number, roof: string, capital: boolean, windows: Point[]) {
  if (!capital) { house(g, x, y, 11, 7, roof, windows); rect(g, '#F2C96C', x - 1, y - 15, 2, 2); return; }
  const width = 10, wall = 15;
  rect(g, 'rgba(8,20,24,.4)', x - width / 2 + 2, y - 1, width + 3, 3);
  rect(g, OUTLINE, x - width / 2 - 1, y - wall - 1, width + 2, wall + 2);
  rect(g, '#E2D3AE', x - width / 2, y - wall, width, wall);
  rect(g, '#B9A884', x + 1, y - wall, width / 2 - 1, wall);
  for (let k = 0; k < 3; k++) { rect(g, OUTLINE, x - width / 2 - 1 + k * 4, y - wall - 3, 3, 3); rect(g, '#E2D3AE', x - width / 2 + k * 4, y - wall - 2, 1, 2); }
  rect(g, '#6B4A35', x - 2, y - 4, 4, 4); rect(g, '#3E2A1E', x - 1, y - 4, 2, 1);
  for (const wy of [y - 12, y - 8]) { rect(g, '#5C7F8C', x - 3, wy, 2, 2); windows.push({ x: x - 3, y: wy }); }
  rect(g, OUTLINE, x, y - wall - 12, 1, 10);
  rect(g, roof, x + 1, y - wall - 12, 6, 2); rect(g, tone(roof, -.3), x + 1, y - wall - 10, 5, 2); rect(g, tone(roof, .3), x + 1, y - wall - 12, 2, 1);
}
/** A gold spire for a city holding legendary wonders. */
function spire(g: Paint, x: number, y: number) {
  rect(g, 'rgba(8,20,24,.38)', x, y - 1, 5, 2);
  for (let j = 0; j < 14; j++) { const half = Math.round(.5 + j / 6); rect(g, OUTLINE, x - half - 1, y - 14 + j, half * 2 + 2, 1); rect(g, '#F2C14E', x - half, y - 14 + j, half, 1); rect(g, '#B88A2C', x, y - 14 + j, half, 1); }
  rect(g, '#FFF3B0', x - 1, y - 16, 1, 2);
}

/** House slots in native pixels (squashed tile coordinates), filled in this order as the population grows. */
const SLOTS: readonly [number, number][] = [[-10, -2], [10, -2], [-14, 6], [13, 6], [0, -8], [-5, 10], [6, 10], [-6, -9], [7, -9]];
export const townHouses = (population: number | undefined) => Math.max(2, Math.min(SLOTS.length, 2 + Math.floor((population ?? 3) / 2)));

type Town = { canvas: HTMLCanvasElement; windows: Point[] };
const towns = new Map<string, Town>();
function townArt(roof: string, houses: number, capital: boolean, wonder: boolean): Town {
  const key = `${roof}|${houses}|${capital ? 1 : 0}|${wonder ? 1 : 0}`;
  const cached = towns.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TW; canvas.height = TH;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  const g: Paint = { context, cx: TC.x, cy: TC.y }, windows: Point[] = [];
  const items: { y: number; draw: () => void }[] = SLOTS.slice(0, houses).map(([x, y], index) => ({ y, draw: () => house(g, x, y, index % 3 === 2 ? 7 : 8, index % 2 ? 5 : 6, roof, windows) }));
  items.push({ y: 2, draw: () => keep(g, 0, 2, roof, capital, windows) });
  if (wonder) items.push({ y: -6, draw: () => spire(g, 14, -6) });
  for (const item of items.sort((a, b) => a.y - b.y)) item.draw();
  const town = { canvas, windows };
  towns.set(key, town);
  return town;
}

/** Paved plaza on the city's top face, then the town; returns the screen y of the town's top (for the banner). */
export function drawTown25d(context: CanvasRenderingContext2D, p: Point, radius: number, squash: number, ownerColor: string,
  population: number | undefined, capital: boolean, wonders: number): number {
  const s = snappedScale(context, radius / RT * propScale(radius));
  context.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (k * 60 - 30) * Math.PI / 180, x = p.x + radius * .78 * Math.cos(angle), y = p.y + radius * .78 * Math.sin(angle) * squash;
    if (k) context.lineTo(x, y); else context.moveTo(x, y);
  }
  context.closePath();
  context.fillStyle = '#B9A77CD0'; context.fill();
  context.strokeStyle = `${ownerColor}CC`; context.lineWidth = Math.max(1.5, radius * .07); context.stroke();
  const art = townArt(ownerColor, townHouses(population), capital, wonders > 0);
  drawPixelArt(context, art.canvas, p.x, p.y, s, { snap: true, anchorX: TC.x, anchorY: TC.y });
  return p.y - (capital ? 30 : 20) * s;
}
/** Night: warm window lights over the (already dimmed) town, drawn after the night overlay. */
export function drawTownLights(context: CanvasRenderingContext2D, p: Point, radius: number, ownerColor: string, population: number | undefined,
  capital: boolean, wonders: number, level: number): void {
  if (level <= 0) return;
  const s = snappedScale(context, radius / RT * propScale(radius)), art = townArt(ownerColor, townHouses(population), capital, wonders > 0);
  context.save();
  context.globalAlpha = level;
  // Two flat halos (no blur): a wide faint one on the ground and a tighter warm one around the houses.
  context.fillStyle = '#FFC85A1C';
  context.beginPath(); context.ellipse(p.x, p.y, radius * 1.15, radius * .7, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#FFD66B2E';
  context.beginPath(); context.ellipse(p.x, p.y - 4 * s, radius * .72, radius * .42, 0, 0, Math.PI * 2); context.fill();
  const pixel = Math.max(1, Math.round(2 * s));
  for (const w of art.windows) {
    const x = Math.round(p.x + w.x * s), y = Math.round(p.y + w.y * s);
    context.fillStyle = '#FFF2B0'; context.fillRect(x, y, pixel, pixel);
    context.fillStyle = '#FFD66B66'; context.fillRect(x - 1, y + pixel, pixel + 2, Math.max(1, Math.round(s)));
  }
  context.restore();
}

/**
 * The unit's token in 2.5D: a contact shadow cast to the south-east, the token's dark rim (its thickness) and a squashed
 * faction-coloured top with the faction pattern. `centre` is where the token sits (the sprite stands on it).
 */
export function unitPlinth(context: CanvasRenderingContext2D, centre: Point, size: number, squash: number, ownerId: number | null, color: string, spent: boolean): void {
  // Baked once per look and device size (a clip and a pattern per unit per frame added up in dense scenes): one drawImage.
  const dpr = context.getTransform().a || 1, rounded = Math.round(size * 2) / 2;
  const key = `${ownerId}|${color}|${rounded}|${squash}|${spent ? 1 : 0}|${dpr}`;
  let art = plinths.get(key);
  if (!art) {
    const rx = rounded * .31, pad = 3, half = Math.ceil(rx * 1.5) + pad, top = Math.ceil(rx * squash * .55) + pad, bottom = Math.ceil(rx * squash * .55 * 1.6 + Math.max(2, rounded * .07)) + pad;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(half * 2 * dpr); canvas.height = Math.ceil((top + bottom) * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintPlinth(g, { x: half, y: top }, rounded, squash, ownerId, color, spent);
    art = { canvas, x: half, y: top, width: half * 2, height: top + bottom };
    if (plinths.size > 256) plinths.clear();
    plinths.set(key, art);
  }
  context.drawImage(art.canvas, centre.x - art.x, centre.y - art.y, art.width, art.height);
}
const plinths = new Map<string, { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number }>();
function paintPlinth(context: CanvasRenderingContext2D, centre: Point, size: number, squash: number, ownerId: number | null, color: string, spent: boolean): void {
  const rx = size * .31, ry = rx * squash * .55, thick = Math.max(2, size * .07);
  context.beginPath(); context.ellipse(centre.x + rx * .3, centre.y + thick + ry * .35, rx * 1.12, ry * 1.15, 0, 0, Math.PI * 2);
  context.fillStyle = '#07111480'; context.fill();
  context.beginPath(); context.ellipse(centre.x, centre.y + thick, rx, ry, 0, 0, Math.PI * 2);
  context.fillStyle = '#132625'; context.fill();
  context.fillRect(centre.x - rx, centre.y, rx * 2, thick);
  context.beginPath(); context.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2);
  context.fillStyle = color; context.fill();
  if (ownerId !== null && ownerId !== 0) {
    context.save(); context.clip();
    context.strokeStyle = '#FFFDF766'; context.fillStyle = '#FFFDF788'; context.lineWidth = 1;
    const spacing = Math.max(4, rx / 2.5);
    if (ownerId === 2) {
      for (let x = centre.x - rx + 2; x < centre.x + rx; x += spacing) for (let y = centre.y - ry + 1; y < centre.y + ry; y += spacing * squash) context.fillRect(Math.round(x), Math.round(y), 2, 2);
    } else {
      context.beginPath();
      for (let offset = -rx * 2; offset <= rx * 2; offset += spacing) {
        context.moveTo(centre.x + offset - ry, centre.y + ry); context.lineTo(centre.x + offset + ry, centre.y - ry);
        if (ownerId === 3) { context.moveTo(centre.x + offset - ry, centre.y - ry); context.lineTo(centre.x + offset + ry, centre.y + ry); }
      }
      context.stroke();
    }
    context.restore();
  }
  context.beginPath(); context.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2);
  context.strokeStyle = '#132625'; context.lineWidth = 1.5; context.stroke();
  context.beginPath(); context.ellipse(centre.x, centre.y, rx * .82, ry * .78, 0, Math.PI * 1.05, Math.PI * 1.75);
  context.strokeStyle = spent ? '#81908A' : '#F2E7C9'; context.lineWidth = 1.2; context.stroke();
}
