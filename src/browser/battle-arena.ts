// depth-v26 §2.5: original pixel-art battle stages for the replay viewer (battle-viewer.ts). Each arena is painted once
// with fillRect into a 240×135 canvas (one stage per biome, the league stadium and the sanctuary altar) and cached; the
// viewer scales it up with smoothing off. No image files, no filters.
import type { ArenaId } from './battle-replay.ts';

export const ARENA_WIDTH = 240, ARENA_HEIGHT = 135;
/** The two battle platforms (arena pixels): the opponent's far right, the viewer's near left. */
export const PLATFORMS = { away: { x: 174, y: 62, rx: 46, ry: 9 }, home: { x: 66, y: 116, rx: 58, ry: 12 } } as const;
export const ARENA_NAMES: Record<ArenaId, string> = {
  grassland: '草原', forest: '森林', mountain: '山地', ocean: '海洋', desert: '荒漠', snow: '雪原', volcano: '火山', league: '联盟会场', altar: '圣所祭坛',
};

type Palette = { sky: readonly string[]; ground: string; speck: string; plateRim: string; plate: string; plateTop: string };
const PALETTES: Record<ArenaId, Palette> = {
  grassland: { sky: ['#7CC4EC', '#A4D8F2', '#CDEEFA'], ground: '#93CF62', speck: '#6FAF45', plateRim: '#5E9440', plate: '#B9E07E', plateTop: '#D6F0A2' },
  forest: { sky: ['#8EC9B6', '#AEDAC8', '#CFEADC'], ground: '#5F9E48', speck: '#46813A', plateRim: '#3F6E30', plate: '#89BE5E', plateTop: '#A8D67C' },
  mountain: { sky: ['#93B6D6', '#B3CDE4', '#D3E3F0'], ground: '#A99A78', speck: '#8A7C5E', plateRim: '#76694E', plate: '#C6B994', plateTop: '#DED3B2' },
  ocean: { sky: ['#78C2EE', '#9CD6F2', '#C4E9FA'], ground: '#3F86D8', speck: '#6FA9E8', plateRim: '#A08A5E', plate: '#D9C48E', plateTop: '#EEDDB0' },
  desert: { sky: ['#F2C46E', '#F6D892', '#FAEAB8'], ground: '#E8CB86', speck: '#CFAE66', plateRim: '#B8944E', plate: '#F2DCA2', plateTop: '#FAEBC4' },
  snow: { sky: ['#A9C9E2', '#C6DCEE', '#E2EEF7'], ground: '#E6F1F8', speck: '#C3D9E8', plateRim: '#9DBCD2', plate: '#F6FBFE', plateTop: '#FFFFFF' },
  volcano: { sky: ['#4A2C30', '#6E3A34', '#94503A'], ground: '#5C4A44', speck: '#3F322E', plateRim: '#3A2C28', plate: '#7E665C', plateTop: '#98806F' },
  league: { sky: ['#30485E', '#3E5B74', '#4D6C86'], ground: '#3F8A5E', speck: '#367A52', plateRim: '#E8F0E0', plate: '#4FA06E', plateTop: '#5CB07C' },
  altar: { sky: ['#2E2A4E', '#463A68', '#62508A'], ground: '#8A806C', speck: '#6F6656', plateRim: '#6E6248', plate: '#C9B88A', plateTop: '#DCCDA4' },
};
const HORIZON = 74;
const hash = (x: number, y: number) => (Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0;

function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) { c.fillStyle = color; c.fillRect(x, y, w, h); }
/** A filled pixel ellipse, row by row. */
function ellipse(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  c.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) { const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)))); c.fillRect(cx - half, cy + dy, half * 2, 1); }
}
/** A pixel triangle (tree, peak, cone) with its apex at (cx, top). */
function spike(c: CanvasRenderingContext2D, cx: number, top: number, height: number, slope: number, color: string) {
  c.fillStyle = color;
  for (let row = 0; row < height; row++) { const half = Math.floor(row * slope); c.fillRect(cx - half, top + row, half * 2 + 1, 1); }
}
/** Sky bands with a checker dither row between them. */
function sky(c: CanvasRenderingContext2D, colors: readonly string[], bottom: number) {
  const band = Math.ceil(bottom / colors.length);
  colors.forEach((color, index) => rect(c, 0, index * band, ARENA_WIDTH, band + 1, color));
  for (let index = 1; index < colors.length; index++) for (let x = 0; x < ARENA_WIDTH; x += 2) rect(c, x + (index % 2), index * band, 1, 1, colors[index - 1]!);
}
function platform(c: CanvasRenderingContext2D, p: { x: number; y: number; rx: number; ry: number }, palette: Palette) {
  ellipse(c, p.x, p.y + 2, p.rx + 2, p.ry + 2, palette.plateRim);
  ellipse(c, p.x, p.y, p.rx, p.ry, palette.plate);
  ellipse(c, p.x - Math.round(p.rx * .12), p.y - Math.round(p.ry * .25), Math.round(p.rx * .62), Math.round(p.ry * .45), palette.plateTop);
}

const DECOR: Record<ArenaId, (c: CanvasRenderingContext2D, palette: Palette) => void> = {
  grassland: c => {
    for (let x = 0; x < ARENA_WIDTH; x++) { const top = 58 + Math.round(4 * Math.sin(x / 17) + 3 * Math.sin(x / 7 + 1)); rect(c, x, top, 1, HORIZON - top, x % 3 ? '#79B957' : '#71B050'); }
    for (let x = 6; x < ARENA_WIDTH; x += 11) { const y = HORIZON + 6 + hash(x, 3) % 56; rect(c, x, y, 1, 2, '#5E9E3C'); rect(c, x + 2, y, 1, 2, '#5E9E3C'); rect(c, x + 1, y - 1, 1, 2, '#78BB50'); }
    ellipse(c, 34, 16, 12, 4, '#F2FAFE'); ellipse(c, 46, 14, 9, 4, '#F2FAFE'); ellipse(c, 196, 24, 10, 3, '#F2FAFE');
  },
  forest: c => {
    for (let x = -6; x < ARENA_WIDTH + 8; x += 13) { const height = 26 + hash(x, 1) % 14; spike(c, x, HORIZON - height, height, .42, x % 2 ? '#2F6A2A' : '#3A7A31'); rect(c, x - 1, HORIZON - 3, 3, 3, '#5A3E22'); }
    for (let x = 3; x < ARENA_WIDTH; x += 9) { const y = HORIZON + 8 + hash(x, 5) % 52; rect(c, x, y, 2, 1, '#3E7A32'); }
  },
  mountain: c => {
    for (const [x, height] of [[24, 46], [70, 38], [120, 54], [178, 42], [226, 48]] as const) {
      spike(c, x, HORIZON - height, height, .9, '#7F8C92'); spike(c, x, HORIZON - height, Math.round(height * .28), .9, '#F2F6F8');
      spike(c, x + 4, HORIZON - height + 8, height - 8, .45, '#6E7A80');
    }
  },
  ocean: c => {
    for (let y = HORIZON; y < ARENA_HEIGHT; y += 5) for (let x = (y * 3) % 14; x < ARENA_WIDTH; x += 14) { rect(c, x, y, 5, 1, '#8CC3F0'); rect(c, x + 5, y + 1, 2, 1, '#2F70C0'); }
    ellipse(c, 206, 18, 14, 4, '#F2FAFE'); rect(c, 18, HORIZON - 4, 26, 2, '#5C7FA6');
  },
  desert: c => {
    ellipse(c, 204, 20, 11, 11, '#FFF2C4'); ellipse(c, 204, 20, 8, 8, '#FFE48A');
    for (let x = 0; x < ARENA_WIDTH; x++) { const top = 62 + Math.round(6 * Math.sin(x / 23 + 2) + 2 * Math.sin(x / 9)); rect(c, x, top, 1, HORIZON - top, '#E0B868'); }
    for (const x of [30, 128]) { rect(c, x, HORIZON - 14, 3, 14, '#4E9A44'); rect(c, x - 3, HORIZON - 10, 3, 2, '#4E9A44'); rect(c, x - 3, HORIZON - 13, 2, 3, '#4E9A44'); rect(c, x + 3, HORIZON - 8, 3, 2, '#4E9A44'); rect(c, x + 4, HORIZON - 11, 2, 3, '#4E9A44'); }
  },
  snow: c => {
    for (let x = 0; x < ARENA_WIDTH; x++) { const top = 56 + Math.round(5 * Math.sin(x / 19) + 3 * Math.sin(x / 8 + 2)); rect(c, x, top, 1, HORIZON - top, '#D8E8F2'); }
    for (let x = 8; x < ARENA_WIDTH; x += 31) { spike(c, x, HORIZON - 22, 22, .38, '#3D6A5E'); spike(c, x, HORIZON - 22, 6, .38, '#F6FBFE'); }
    for (let i = 0; i < 46; i++) { const x = hash(i, 9) % ARENA_WIDTH, y = hash(i, 11) % (ARENA_HEIGHT - 4); rect(c, x, y, 1, 1, '#FFFFFF'); }
  },
  volcano: c => {
    spike(c, 120, 18, HORIZON - 18, 1.6, '#3E302C'); rect(c, 112, 18, 17, 3, '#E0483A');
    for (let row = 0; row < 40; row++) rect(c, 118 + Math.round(3 * Math.sin(row / 4)), 21 + row, 2, 1, row % 6 < 3 ? '#F2A93B' : '#E0483A');
    for (let i = 0; i < 30; i++) { const x = hash(i, 4) % ARENA_WIDTH, y = hash(i, 6) % 60; rect(c, x, y, 1, 1, i % 3 ? '#F2A93B' : '#FFE08A'); }
  },
  league: c => {
    rect(c, 0, 20, ARENA_WIDTH, HORIZON - 20, '#24303C');
    const crowd = ['#E0483A', '#F2C14E', '#4FA3D8', '#F07AB0', '#72C99E', '#FFF8E5', '#9B83D0'];
    for (let y = 24; y < HORIZON - 4; y += 4) for (let x = (y % 8) / 2; x < ARENA_WIDTH; x += 4) rect(c, x, y, 2, 2, crowd[hash(x, y) % crowd.length]!);
    rect(c, 0, HORIZON - 4, ARENA_WIDTH, 4, '#B9A57F'); rect(c, 0, 18, ARENA_WIDTH, 2, '#F2C14E');
    for (let x = 10; x < ARENA_WIDTH; x += 40) { rect(c, x, 4, 2, 16, '#9AA6A0'); rect(c, x - 3, 2, 8, 3, '#FFF8E5'); }
    rect(c, 8, HORIZON + 4, ARENA_WIDTH - 16, 1, '#E8F0E0'); rect(c, 8, ARENA_HEIGHT - 3, ARENA_WIDTH - 16, 1, '#E8F0E0');
    rect(c, 8, HORIZON + 4, 1, ARENA_HEIGHT - HORIZON - 7, '#E8F0E0'); rect(c, ARENA_WIDTH - 9, HORIZON + 4, 1, ARENA_HEIGHT - HORIZON - 7, '#E8F0E0');
  },
  altar: c => {
    for (let i = 0; i < 40; i++) rect(c, hash(i, 2) % ARENA_WIDTH, hash(i, 8) % 50, 1, 1, i % 4 ? '#E6DEF5' : '#F7D25C');
    for (const x of [12, 52, 188, 226]) { rect(c, x, 22, 10, HORIZON - 22, '#B9A57F'); rect(c, x - 2, 18, 14, 5, '#D8C8A0'); rect(c, x + 2, 26, 2, HORIZON - 30, '#9C8862'); }
    for (let y = HORIZON + 6; y < ARENA_HEIGHT; y += 8) rect(c, 0, y, ARENA_WIDTH, 1, '#76705E');
    for (let y = HORIZON; y < ARENA_HEIGHT; y += 8) for (let x = (y / 8 % 2) * 12; x < ARENA_WIDTH; x += 24) rect(c, x, y, 1, 8, '#76705E');
  },
};

const cache = new Map<ArenaId, HTMLCanvasElement>();
/** The arena's 240×135 backdrop (cached). */
export function arenaCanvas(arena: ArenaId): HTMLCanvasElement {
  let canvas = cache.get(arena);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = ARENA_WIDTH; canvas.height = ARENA_HEIGHT;
  const c = canvas.getContext('2d')!, palette = PALETTES[arena] ?? PALETTES.grassland;
  sky(c, palette.sky, HORIZON);
  rect(c, 0, HORIZON, ARENA_WIDTH, ARENA_HEIGHT - HORIZON, palette.ground);
  for (let y = HORIZON + 2; y < ARENA_HEIGHT; y += 2) for (let x = 0; x < ARENA_WIDTH; x += 3) if (hash(x, y) % 17 === 0) rect(c, x, y, 1, 1, palette.speck);
  DECOR[arena]?.(c, palette);
  platform(c, PLATFORMS.away, palette); platform(c, PLATFORMS.home, palette);
  cache.set(arena, canvas);
  return canvas;
}
