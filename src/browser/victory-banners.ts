// Victory-route banners (docs/design/depth-v26.md §6.3): one original 120×24 GBA-style pixel scene per win path, shown at
// 240×48. Scenes are drawn in code (bands, silhouettes, hand-placed sprites) and reuse the icon kit's glyphs (trophy, ribbon,
// Pokédex, tablet, flag) scaled up; every cell is a flat colour, rendered once into a cached SVG data URL like the icons.
// Presentation only: no game data is read here.
import { gridUrl, iconGrid } from './ui-icons.ts';
import type { Grid, UiIconName } from './ui-icons.ts';

export const BANNER_WIDTH = 120, BANNER_HEIGHT = 24;
export type BannerId = 'conquest' | 'pokedex' | 'origin' | 'championship' | 'contest' | 'faith' | 'score';
/** Faction colours, the same as the map's (render/canvas2d.ts FACTIONS). */
const CIVS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
const INK = '#17262A', CREAM = '#FFF8E5';

class Scene {
  readonly cells: (string | null)[][] = Array.from({ length: BANNER_HEIGHT }, () => Array<string | null>(BANNER_WIDTH).fill(null));
  px(x: number, y: number, color: string) {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < BANNER_WIDTH && y < BANNER_HEIGHT) this.cells[y][x] = color;
  }
  rect(x: number, y: number, width: number, height: number, color: string) {
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) this.px(column, row, color);
  }
  /** Horizontal bands from the top, each boundary row dithered 50/50. */
  bands(colors: readonly string[], height = BANNER_HEIGHT) {
    const step = height / colors.length;
    for (let y = 0; y < height; y++) {
      const band = Math.min(colors.length - 1, Math.floor(y / step)), edge = band > 0 && y === Math.ceil(band * step);
      for (let x = 0; x < BANNER_WIDTH; x++) this.px(x, y, edge && (x + y) % 2 ? colors[band - 1] : colors[band]);
    }
  }
  /** Palette rows ('.' transparent), each cell `scale`×`scale`. */
  stamp(rows: readonly string[], palette: Record<string, string>, x: number, y: number, scale = 1) {
    rows.forEach((row, dy) => [...row].forEach((cell, dx) => { if (cell !== '.') this.rect(x + dx * scale, y + dy * scale, scale, scale, palette[cell] ?? '#FF00FF'); }));
  }
  /** A kit icon with its transparent margin trimmed; `recolor` swaps palette keys. Returns the drawn width. */
  icon(name: UiIconName, x: number, y: number, scale = 1, recolor: Record<string, string> = {}): number {
    const rows = trim(iconGrid(name).rows);
    this.stamp(rows, { ...iconGrid(name).palette, ...recolor }, x, y, scale);
    return rows[0].length * scale;
  }
  stars(color: string, seed: number, maxY: number, count: number) {
    for (let index = 0; index < count; index++) this.px((index * 37 + seed * 11) % BANNER_WIDTH, (index * 13 + seed) % maxY, color);
  }
  grid(): Grid {
    const keys = new Map<string, string>(), palette: Record<string, string> = {};
    const key = (color: string) => {
      let found = keys.get(color);
      if (!found) { found = String.fromCharCode(0x100 + keys.size); keys.set(color, found); palette[found] = color; }
      return found;
    };
    return { rows: this.cells.map(row => row.map(cell => cell === null ? '.' : key(cell)).join('')), palette };
  }
}
/** Drops fully transparent outer rows and columns of a grid. */
function trim(rows: readonly string[]): string[] {
  const used = rows.map(row => row.replace(/\./g, '').length > 0);
  const top = used.indexOf(true), bottom = used.lastIndexOf(true);
  const columns = rows[0].split('').map((_, x) => rows.some(row => row[x] !== '.'));
  const left = columns.indexOf(true), right = columns.lastIndexOf(true);
  return rows.slice(top, bottom + 1).map(row => row.slice(left, right + 1));
}

/** 征服：a castle at dusk, its towers flying the four civilizations' banners. */
function conquest(scene: Scene) {
  scene.bands(['#3E2E5C', '#7A4E8C', '#D9695B', '#F2A35E'], 20);
  for (let x = 0; x < BANNER_WIDTH; x++) {
    const hill = 17 + Math.round(2 * Math.sin(x / 9) + Math.sin(x / 4));
    scene.rect(x, hill, 1, BANNER_HEIGHT - hill, '#2F4A3A');
    scene.rect(x, 21, 1, 3, x % 5 ? '#3F6A4A' : '#2F4A3A');
  }
  const stone = '#9AA0B4', shade = '#6B7088';
  scene.rect(46, 12, 30, 9, stone); scene.rect(46, 19, 30, 2, shade);
  for (let x = 46; x < 76; x += 3) scene.rect(x, 10, 2, 2, stone);
  for (const left of [38, 75]) {
    scene.rect(left, 6, 8, 15, stone); scene.rect(left + 6, 6, 2, 15, shade);
    for (let x = left; x < left + 8; x += 3) scene.rect(x, 4, 2, 2, stone);
    scene.rect(left + 3, 9, 2, 3, INK);
  }
  scene.rect(57, 14, 8, 7, INK); scene.rect(58, 13, 6, 1, INK); scene.rect(58, 15, 6, 6, '#3A2A22');
  for (let x = 58; x < 64; x += 2) scene.rect(x, 15, 1, 6, '#5E3E22');
  // Poles and banners: two on the towers, two on the wall.
  const banner = (x: number, top: number, pole: number, color: string, flip = false) => {
    scene.rect(x, top, 1, pole, '#5E3E22');
    for (let row = 0; row < 4; row++) for (let column = 0; column < 6 - (row === 3 ? 2 : 0); column++)
      scene.px(flip ? x - 1 - column : x + 1 + column, top + row + (column % 3 === 2 ? 1 : 0), column === 0 && row === 0 ? CREAM : color);
  };
  banner(41, 0, 5, CIVS[0]); banner(79, 0, 5, CIVS[1], true);
  banner(51, 4, 6, CIVS[2]); banner(70, 4, 6, CIVS[3], true);
  // Torches along the wall and small tents in the field.
  for (const x of [48, 73]) { scene.px(x, 13, '#F2C14E'); scene.px(x, 14, '#F08A4B'); }
  for (const [x, color] of [[12, CIVS[0]], [24, CIVS[2]], [96, CIVS[1]], [108, CIVS[3]]] as const) {
    for (let row = 0; row < 4; row++) scene.rect(x - row, 17 + row, 1 + row * 2, 1, color);
    scene.px(x, 20, INK);
  }
}

/** 图鉴：an open Pokédex on a meadow, pages full of entries. */
function pokedex(scene: Scene) {
  scene.bands(['#6FB8E6', '#9FD8F0', '#C9EAF4'], 18);
  for (const [x, y] of [[8, 3], [92, 5], [104, 2]]) { scene.rect(x, y + 1, 12, 2, CREAM); scene.rect(x + 3, y, 6, 1, CREAM); scene.rect(x + 1, y + 3, 10, 1, '#D8E6EA'); }
  scene.rect(0, 18, BANNER_WIDTH, 6, '#6FBF4A');
  for (let x = 0; x < BANNER_WIDTH; x += 3) { scene.px(x, 17, '#6FBF4A'); scene.px(x + 1, 19 + (x % 4 ? 0 : 2), '#3F8A33'); }
  // Book: red covers, cream pages, a screen and entry lines.
  scene.rect(33, 2, 54, 21, INK);
  scene.rect(34, 3, 52, 19, '#E0483A'); scene.rect(34, 20, 52, 2, '#A82B22');
  scene.rect(36, 4, 23, 15, CREAM); scene.rect(61, 4, 23, 15, CREAM);
  scene.rect(59, 3, 2, 19, '#A82B22');
  scene.rect(38, 6, 12, 9, INK); scene.rect(39, 7, 10, 7, '#5BB6E8');
  scene.stamp(['..kk..', '.kGGk.', 'kGGGGk', '.kGGk.', '..kk..'], { k: '#2C6F96', G: '#9FE0C0' }, 41, 8);
  for (const y of [7, 10, 13]) scene.rect(52, y, 5, 1, '#C9C2B0');
  scene.rect(38, 16, 19, 1, '#C9C2B0');
  // Four entries: a tiny Poké Ball (red top, ink band, cream bottom) and two text lines each.
  for (let row = 0; row < 4; row++) {
    const y = 5 + row * 4;
    scene.stamp(['.rr.', 'kkkk', '.ww.'], { r: row === 3 ? '#C9C2B0' : '#E0483A', k: INK, w: '#C9C2B0' }, 63, y);
    scene.rect(68, y, row === 3 ? 6 : 14, 1, row === 3 ? '#E2DCCB' : '#9A9384');
    scene.rect(68, y + 2, row === 3 ? 4 : 10, 1, '#C9C2B0');
  }
  scene.px(37, 20, '#6BD08A'); scene.px(39, 20, '#F7D25C'); scene.px(41, 20, '#5BB6E8');
  // Footprints across the grass.
  for (let x = 6; x < 30; x += 6) { scene.px(x, 22 - (x / 6 % 2), '#3F8A33'); scene.px(x + 1, 22 - (x / 6 % 2), '#3F8A33'); }
  for (let x = 92; x < 116; x += 6) { scene.px(x, 22 - (x / 6 % 2), '#3F8A33'); scene.px(x + 1, 22 - (x / 6 % 2), '#3F8A33'); }
}

/** 起源：four stone tablets on a plinth in a ruined hall, each rune a different colour. */
function origin(scene: Scene) {
  scene.bands(['#16242C', '#1E2E36', '#24363E'], 19);
  for (let index = 0; index < 60; index++) scene.px((index * 29) % BANNER_WIDTH, (index * 7) % 18, '#2B3F48');
  scene.rect(0, 19, BANNER_WIDTH, 5, '#4A5560');
  for (let x = 0; x < BANNER_WIDTH; x += 8) scene.rect(x, 19, 1, 5, '#3A444E');
  scene.rect(0, 19, BANNER_WIDTH, 1, '#5E6A74');
  for (const left of [4, 108]) {
    scene.rect(left, 3, 8, 16, '#7E8496'); scene.rect(left + 6, 3, 2, 16, '#5E6474');
    scene.rect(left - 1, 2, 10, 2, '#9AA0B4'); scene.rect(left - 1, 17, 10, 2, '#9AA0B4');
  }
  scene.rect(24, 17, 72, 2, '#7E8496'); scene.rect(26, 16, 68, 1, '#9AA0B4');
  ['#E0483A', '#4F93D6', '#4FB998', '#F7D25C'].forEach((rune, index) => {
    const x = 31 + index * 16;
    // A soft glow behind each tablet.
    for (let row = 2; row < 16; row++) scene.rect(x - 2, row, 15, 1, row % 2 ? '#24363E' : '#2A3E44');
    scene.icon('tablet', x, 3, 1, { G: rune });
    scene.px(x + 5, 1, rune);
  });
}

/** 冠军：a trophy under stadium spotlights, the stands full. */
function championship(scene: Scene) {
  scene.bands(['#141E3C', '#1B2648', '#24305A'], 14);
  scene.stars('#C9D2F0', 3, 10, 18);
  // Light beams from the corners.
  for (let y = 0; y < 14; y++) {
    const spread = (14 - y) * 2;
    scene.rect(8 + y * 3, y, Math.max(1, 6 - spread / 8 | 0), 1, '#3A4878');
    scene.rect(BANNER_WIDTH - 14 - y * 3, y, Math.max(1, 6 - spread / 8 | 0), 1, '#3A4878');
  }
  for (let y = 12; y < BANNER_HEIGHT; y++) {
    scene.rect(0, y, BANNER_WIDTH, 1, y % 2 ? '#2C3048' : '#3A3F58');
    if (y % 2) for (let x = (y * 3) % 4; x < BANNER_WIDTH; x += 4) scene.px(x, y, ['#E0483A', '#F7D25C', '#5BB6E8', '#F0C9A0', '#6FBF4A'][(x * 7 + y) % 5]);
  }
  scene.rect(44, 18, 32, 6, '#8A6D3B'); scene.rect(44, 18, 32, 1, '#C8952C');
  const width = scene.icon('trophy', 0, -100, 2);
  scene.icon('trophy', 60 - width / 2, 0, 2);
  scene.px(52, 3, CREAM); scene.px(68, 5, CREAM); scene.px(49, 9, '#F7D25C'); scene.px(71, 10, '#F7D25C');
}

/** 华丽大赛：a ribbon on a stage between red curtains. */
function contest(scene: Scene) {
  scene.bands(['#1E1024', '#2A1830'], 19);
  // A spotlight cone from the top, dithered at its edges, and its pool of light on the stage.
  for (let y = 3; y < 19; y++) {
    const half = 4 + Math.round(y * 1.1);
    for (let x = 60 - half; x < 60 + half; x++) {
      const edge = x < 60 - half + 2 || x >= 60 + half - 2;
      if (!edge || (x + y) % 2) scene.px(x, y, y > 12 ? '#5E3E62' : '#4A3052');
    }
  }
  scene.rect(0, 19, BANNER_WIDTH, 5, '#9A6A3E');
  for (let x = 0; x < BANNER_WIDTH; x += 10) scene.rect(x, 19, 1, 5, '#7A4F2A');
  scene.rect(0, 19, BANNER_WIDTH, 1, '#C08A52');
  for (const [left, width] of [[0, 24], [96, 24]] as const) for (let x = left; x < left + width; x++) {
    const fold = (x - left) % 4;
    for (let y = 0; y < 22; y++) {
      const inside = left === 0 ? x - left < width - Math.max(0, y - 14) : x - left >= Math.max(0, y - 14);
      if (inside) scene.px(x, y, fold === 0 ? '#8E2030' : fold === 1 ? '#E05A64' : '#C0303E');
    }
  }
  for (let x = 36; x < 84; x++) scene.px(x, 20, (x + 1) % 2 || (x > 42 && x < 78) ? '#D8A86A' : '#9A6A3E');
  scene.rect(0, 0, BANNER_WIDTH, 3, '#C0303E');
  for (let x = 0; x < BANNER_WIDTH; x++) scene.px(x, 3, x % 2 ? '#F2C14E' : '#C8952C');
  scene.icon('ribbon', 49, 2, 2);
  for (const [x, y] of [[40, 8], [79, 6], [36, 15], [84, 14]]) { scene.px(x, y, '#F7D25C'); scene.px(x - 1, y, '#C8952C'); scene.px(x + 1, y, '#C8952C'); }
}

/** 传说共鸣：an abstract winged silhouette inside a golden halo on a violet night. */
function faith(scene: Scene) {
  scene.bands(['#140F26', '#1A1430', '#241A40', '#2E2050']);
  scene.stars('#E8DCF8', 5, 22, 24);
  for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI / 8;
    for (let r = 13; r < 40; r += 2) scene.px(60 + Math.round(Math.cos(angle) * r * 1.6), 12 + Math.round(Math.sin(angle) * r * .5), '#6A4E3A');
  }
  for (let y = 0; y < BANNER_HEIGHT; y++) for (let x = 44; x < 77; x++) {
    const d = Math.hypot((x - 60) / 1.3, y - 12);
    if (d < 9) scene.px(x, y, d < 6 ? '#8A78C8' : '#6A58A8');
    if (d >= 9 && d < 10.5) scene.px(x, y, '#F7D25C');
    if (d >= 10.5 && d < 11.5) scene.px(x, y, '#C8952C');
  }
  const body = '#0E0A1C';
  scene.rect(58, 7, 5, 11, body); scene.rect(59, 5, 3, 2, body); scene.px(60, 4, body);
  for (let row = 0; row < 7; row++) {
    const span = Math.round(row * 1.4) + 2;
    scene.rect(58 - span, 8 + row, span, 1, body);
    scene.rect(63, 8 + row, span, 1, body);
  }
  scene.rect(59, 18, 1, 2, body); scene.rect(61, 18, 1, 2, body);
  scene.px(59, 6, '#F7D25C'); scene.px(61, 6, '#F7D25C');
  for (let x = 0; x < BANNER_WIDTH; x++) {
    const cloud = 21 + Math.round(Math.sin(x / 5) + Math.sin(x / 11));
    scene.rect(x, cloud, 1, BANNER_HEIGHT - cloud, '#3A2E5E');
  }
}

/** 分数：a stadium scoreboard with round and score readouts. */
function score(scene: Scene) {
  scene.bands(['#1A2830', '#22303A'], 24);
  for (let y = 0; y < BANNER_HEIGHT; y += 4) for (let x = (y / 4 % 2) * 6; x < BANNER_WIDTH; x += 12) { scene.rect(x, y, 11, 1, '#2A3A44'); scene.rect(x, y, 1, 4, '#2A3A44'); }
  scene.rect(28, 1, 64, 22, '#8A6D3B'); scene.rect(29, 2, 62, 20, '#5E4A2A'); scene.rect(31, 4, 58, 16, '#0E1A12');
  const DIGITS: Record<string, readonly string[]> = {
    1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'], 0: ['###', '#.#', '#.#', '#.#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'], 8: ['###', '#.#', '###', '#.#', '###'],
  };
  const digits = (text: string, x: number, y: number, color: string) => [...text].forEach((digit, index) => scene.stamp(DIGITS[digit], { '#': color }, x + index * 8, y, 2));
  digits('120', 34, 7, '#F2C14E');
  digits('84', 68, 7, '#72C99E');
  scene.rect(62, 8, 2, 2, '#4A5560'); scene.rect(62, 13, 2, 2, '#4A5560');
  scene.icon('eraScore', 6, 6, 1);
  scene.icon('turns', 102, 6, 1);
  for (let x = 32; x < 88; x += 3) scene.px(x, 18, '#2A4A30');
}

const DRAW: Record<BannerId, (scene: Scene) => void> = { conquest, pokedex, origin, championship, contest, faith, score };
const cache = new Map<BannerId, string>();
export function bannerGrid(id: BannerId): Grid {
  const scene = new Scene();
  DRAW[id](scene);
  return scene.grid();
}
/** Cached SVG data URL of a route banner. */
export function bannerUrl(id: BannerId): string {
  let url = cache.get(id);
  if (!url) { url = gridUrl(bannerGrid(id)); cache.set(id, url); }
  return url;
}
export const BANNER_IDS = Object.keys(DRAW) as BannerId[];
