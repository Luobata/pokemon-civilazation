// Hand-authored pixel icons for the map: yields, resources, improvements and districts.
// Each icon is a palette grid rendered once per device scale into an offscreen canvas,
// so the map pays one drawImage per icon. No icon uses fillText: canvas text calls are
// reserved for labels (tests use them to detect fog leaks).

type Palette = Record<string, string>;
type IconDef = { rows: readonly string[]; palette: Palette };

const K = '#17262A';
const BASE: Palette = { k: K, w: '#FFF8E5', s: '#0000004D' };

function icon(rows: readonly string[], palette: Palette): IconDef {
  const width = rows[0].length;
  if (rows.some(row => row.length !== width)) throw new Error(`Icon rows must share a width: ${rows.join('|')}`);
  return { rows, palette: { ...BASE, ...palette } };
}

// ---------- Yields (9×9) ----------
export const YIELD_KEYS = ['food', 'production', 'gold', 'research'] as const;
export type YieldKey = typeof YIELD_KEYS[number];
const YIELD_ICONS: Record<YieldKey, IconDef> = {
  food: icon([
    '....kk...',
    '...kLk...',
    '.kkkkkkk.',
    'kgGGggggk',
    'kgGgggggk',
    'kggggggdk',
    'kgggggddk',
    '.kgggddk.',
    '..kkkkk..',
  ], { L: '#B6E388', g: '#6FBF4A', G: '#C9F29A', d: '#3F8A33' }),
  production: icon([
    '.kkkkkk..',
    'kOOOOOOk.',
    'kOooooOkk',
    '.kkkoOkOk',
    '...kbkkOk',
    '..kbbk.k.',
    '.kbbk....',
    'kbbk.....',
    '.kk......',
  ], { O: '#F5B266', o: '#E07F2E', b: '#9A6A3E' }),
  gold: icon([
    '..kkkkk..',
    '.kYYYYYk.',
    'kYyyyyyYk',
    'kYyYYYyYk',
    'kYyYyYyYk',
    'kYyYYYyYk',
    'kYyyyyyYk',
    '.kYYYYYk.',
    '..kkkkk..',
  ], { Y: '#F7D25C', y: '#C8952C' }),
  research: icon([
    '..kkkkk..',
    '...kBk...',
    '...kBk...',
    '..kBBBk..',
    '.kBbbbBk.',
    'kBbWbbbBk',
    'kBbbbWbBk',
    'kBBBBBBBk',
    '.kkkkkkk.',
  ], { B: '#9CD6F2', b: '#4A9FD4', W: '#E8F7FF' }),
};

// ---------- Resources (12×12) ----------
const BERRY_ROWS = [
  '.....kk.....',
  '....kLLk....',
  '...kLkkk....',
  '..kkkkkkk...',
  '.kHHccccck..',
  'kcHccccccck.',
  'kcHcccccccck',
  'kccccccccdck',
  'kcccccccddck',
  '.kcccccddck.',
  '..kkcddddk..',
  '....kkkk....',
];
const berry = (light: string, color: string, dark: string) => icon(BERRY_ROWS, { L: '#7BC85A', H: light, c: color, d: dark });
const GEM_ROWS = [
  '............',
  '...kkkkkk...',
  '..kHHcHHck..',
  '.kHHccHccck.',
  'kkkkkkkkkkkk',
  'kHccHccccdck',
  '.kcHcccccdk.',
  '..kcHcccdk..',
  '...kcccdk...',
  '....kcdk....',
  '.....kk.....',
  '............',
];
const gem = (light: string, color: string, dark: string) => icon(GEM_ROWS, { H: light, c: color, d: dark });

const RESOURCE_ICONS = {
  // Rare berries (luxuries): fruit colours loosely follow the berries they are named after.
  liechi: berry('#F7A3A3', '#D9495B', '#8E2433'),
  ganlon: berry('#C3C3FA', '#6C6CD9', '#383893'),
  salac: berry('#C8F0A0', '#6DBB4A', '#367024'),
  petaya: berry('#FBC0DD', '#E36FA8', '#9C3468'),
  apicot: berry('#A9DDF0', '#3E8FB0', '#1E5269'),
  lansat: berry('#F9BE9F', '#E0603A', '#8F321A'),
  // Ordinary berries.
  oranBerry: berry('#A9D2FA', '#3E7FD6', '#1F4A8A'),
  sitrusBerry: berry('#FFF0A0', '#E9C53A', '#9A7C12'),
  lumBerry: berry('#C8F0A0', '#58A845', '#2C6522'),
  nanabBerry: berry('#FFE6A3', '#F0B54A', '#A0701C'),
  // Evolution stones.
  fireStone: gem('#FFD0A0', '#F07A2E', '#A03C10'),
  waterStone: gem('#C2E6FF', '#3C8FE0', '#1B4D8A'),
  leafStone: gem('#D2F5B5', '#58B04A', '#2D6B23'),
  thunderStone: gem('#FFF5B0', '#E8C930', '#8F7A12'),
  moonStone: gem('#E6DEF5', '#9C8BC2', '#5A4C80'),
  depleted: gem('#9AA6A0', '#6F7B75', '#4C5652'),
  sanctuary: icon([
    'kkkkkkkkkkkk',
    'kRRRRRRRRRRk',
    '.kkRkkkkRkk.',
    '.kRRRRRRRRk.',
    '..kRkkkkRk..',
    '..kRk..kRk..',
    '..kRk..kRk..',
    '..kRk..kRk..',
    '..kRk..kRk..',
    '.kkRkk.kRkk.',
    'kSSSSSSSSSSk',
    'kkkkkkkkkkkk',
  ], { R: '#C9506B', S: '#B9A57F' }),
  tablet: icon([
    '..kkkkkkkk..',
    '.kTTTTTTTTk.',
    'kTTtTTTTtTTk',
    'kTtTtTTtTtTk',
    'kTTTTTTTTTTk',
    'kTTtttttTTTk',
    'kTTTTTTTTTTk',
    'kTTttTttTTTk',
    'kTTTTTTTTTTk',
    'kTTTTTTTTTTk',
    'kkkkkkkkkkkk',
    '............',
  ], { T: '#C9B8E6', t: '#6E5A99' }),
  // v24 B: a circuit gym (a pokéball roof over a hall); the won one carries a green tick.
  gym: icon([
    '....kkkk....',
    '..kkRRRRkk..',
    '.kRRRRRRRRk.',
    'kkkkkwwkkkkk',
    'kWWWkwwkWWWk',
    '.kWWWkkWWWk.',
    '.kSSSSSSSSk.',
    '.kSkkSSkkSk.',
    '.kSkkSSkkSk.',
    '.kSSSkkSSSk.',
    '.kSSSkkSSSk.',
    'kkkkkkkkkkkk',
  ], { R: '#D9495B', W: '#FFF8E5', S: '#B9A57F' }),
  gymWon: icon([
    '....kkkk....',
    '..kkRRRRkk..',
    '.kRRRRRRRRk.',
    'kkkkkwwkkkkk',
    'kWWWkwwkWWWk',
    '.kWWWkkWWkkk',
    '.kSSSSSSkGGk',
    '.kSkkSkkGGk.',
    '.kkGkkkGGkk.',
    '.kSkGkGGkSk.',
    '.kSSkGGkSSk.',
    'kkkkkkkkkkkk',
  ], { R: '#D9495B', W: '#FFF8E5', S: '#B9A57F', G: '#5FC27A' }),
  crown: icon([
    '............',
    'k....k....k.',
    'kk..kYk..kk.',
    'kYk.kYk.kYk.',
    'kYYkYYYkYYk.',
    'kYYYYrYYYYk.',
    'kYYYYYYYYYk.',
    'kkkkkkkkkkk.',
    '............',
    '............',
    '............',
    '............',
  ], { Y: '#F7D25C', r: '#D9495B' }),
} satisfies Record<string, IconDef>;
export type ResourceIcon = keyof typeof RESOURCE_ICONS;

// ---------- Improvements (12×12) ----------
const IMPROVEMENT_ICONS = {
  berryFarm: icon([
    '............',
    '..G...G...G.',
    '.GrG.GrG.GrG',
    '..g...g...g.',
    'bbbbbbbbbbbb',
    'BBBBBBBBBBBB',
    '.G...G...G..',
    'GrG.GrG.GrG.',
    '.g...g...g..',
    'bbbbbbbbbbbb',
    'BBBBBBBBBBBB',
    '............',
  ], { G: '#7BC85A', g: '#3F8A33', r: '#D9495B', b: '#9A6A3E', B: '#6B4527' }),
  mine: icon([
    '.kkkk.......',
    'kSSSSk..kk..',
    '.kkSkSk.kHk.',
    '...kkSkkHk..',
    '.....kHHk...',
    '....kHkkSk..',
    '...kHk..kk..',
    '..kkkkkkk...',
    '.kRRRRrrRk..',
    'kRRRrRRRRrk.',
    'kRrRRRRrRRRk',
    'kkkkkkkkkkkk',
  ], { S: '#C9D2D6', H: '#9A6A3E', R: '#8C8577', r: '#5E594F' }),
  fishery: icon([
    '............',
    '......kk....',
    '....kkFFk...',
    '..kkFFFFFk.k',
    '.kFwFFFFFFkF',
    'kFFkFFFFFFFk',
    '.kFFFFfFFFkF',
    '..kkFfffFk.k',
    '....kkkkk...',
    'WWw.WWw.WWw.',
    '.wWW.wWW.wWW',
    '............',
  ], { F: '#F0A35C', f: '#C26A2C', w: '#5BA7D1', W: '#A9D8EE' }),
  observatoryCamp: icon([
    '.........kk.',
    '........kBk.',
    '.......kBk..',
    '....kkkBk...',
    '...kDDDkk...',
    '..kDDDDDDk..',
    '.kDDdDDDDDk.',
    '.kDDDDDDDDk.',
    'kkkkkkkkkkkk',
    'kWWWWWWWWWWk',
    'kWWWkkkWWWWk',
    'kkkkkkkkkkkk',
  ], { B: '#9CD6F2', D: '#C9D2D6', d: '#FFFFFF', W: '#B9A57F' }),
  // v23 tile improvements.
  ranch: icon([
    '............',
    '.kk..kk..kk.',
    'kHHkkHHkkHHk',
    'kHHHHHHHHHHk',
    'kHHkkHHkkHHk',
    '.kk..kk..kk.',
    '.kk..kk..kk.',
    'kHHkkHHkkHHk',
    'kHHHHHHHHHHk',
    'kHHkkHHkkHHk',
    '.Gk.GkG.kG..',
    'GGGGGGGGGGGG',
  ], { H: '#C08A52', G: '#7BC85A' }),
  honeyHive: icon([
    '....kkkk....',
    '...kYYYYk...',
    '..kYYYYYYk..',
    '..kkkkkkkk..',
    '.kYYYYYYYYk.',
    '.kkkkkkkkkk.',
    '.kYYYkkYYYk.',
    '.kYYk..kYYk.',
    '..kYYYYYYk..',
    '...kkkkkk...',
    '....kHHk....',
    '....kHHk....',
  ], { Y: '#F7C843', H: '#9A6A3E' }),
  pearlBed: icon([
    '............',
    '...kkkkkk...',
    '..kPPpPPPk..',
    '.kPpPPpPPPk.',
    '.kPPkkkkPPk.',
    '.kPkeeeekPk.',
    '.kPkeEeekPk.',
    '..kkeeeekk..',
    '...kkkkkk...',
    'WWw.WWw.WWw.',
    '.wWW.wWW.wWW',
    '............',
  ], { P: '#F4B6C2', p: '#D98A9C', e: '#FFFDF5', E: '#C9D2D6', w: '#5BA7D1', W: '#A9D8EE' }),
  // v23 resource improvements.
  berryGrove: icon([
    '....kkkk....',
    '..kkGGGGkk..',
    '.kGGrGGGGGk.',
    'kGGGGGGrGGGk',
    'kGrGGGGGGGGk',
    'kGGGGGrGGGGk',
    '.kGGGGGGGrk.',
    '..kkkGGkkk..',
    '....kHHk....',
    '....kHHk....',
    '...kHHHHk...',
    '..kkkkkkkk..',
  ], { G: '#5FAE4A', r: '#D9495B', H: '#9A6A3E' }),
  stoneQuarry: icon([
    '............',
    '.....kk.....',
    '....kRRk....',
    '...kRrRRk...',
    '..kRRkkRRk..',
    '..kRkFTkRk..',
    '.kRRkTFkRRk.',
    '.kRRRkkRRRk.',
    'kRRrRRRRrRRk',
    'kRRRRRrRRRRk',
    'kkkkkkkkkkkk',
    '............',
  ], { R: '#8C8577', r: '#5E594F', F: '#E05A3A', T: '#5BB6E8' }),
  plantation: icon([
    '..kk....kk..',
    '.kGGk..kGGk.',
    'kGYGGkkGGYGk',
    'kGGYGkkGYGGk',
    '.kGGk..kGGk.',
    '..kk....kk..',
    '..kk....kk..',
    '.kGGk..kGGk.',
    'kGYGGkkGGYGk',
    'kGGYGkkGYGGk',
    'bbbbbbbbbbbb',
    'BBBBBBBBBBBB',
  ], { G: '#3F8A33', Y: '#F7D25C', b: '#9A6A3E', B: '#6B4527' }),
} satisfies Record<string, IconDef>;

// ---------- Districts (16×16) ----------
const DISTRICT_ICONS = {
  researchDistrict: icon([
    '......kkkk......',
    '....kkBBBBkk....',
    '...kBBbBBBBBk...',
    '..kBBBBBBBBBBk..',
    '..kBBBBBBBBkBk..',
    '..kkkkkkkkkkkk..',
    '..kWWWWWWWWWWk..',
    '..kWkkWWWWkkWk..',
    '..kWkbWWWWkbWk..',
    '..kWWWWWWWWWWk..',
    'kkkkkkkkkkkkkkkk',
    'kWWWWWkkkkWWWWWk',
    'kWkkWWkddkWWkkWk',
    'kWkbWWkddkWWkbWk',
    'kWWWWWkddkWWWWWk',
    'kkkkkkkkkkkkkkkk',
  ], { B: '#9CD6F2', b: '#4A9FD4', W: '#E8E2CF', d: '#6B4527' }),
  gymDistrict: icon([
    '................',
    '......kkkk......',
    '....kkRRRRkk....',
    '...kRRRRRRRRk...',
    '..kRRkkkkkkRRk..',
    '..kRkWWWWWWkRk..',
    'kkkkkkkkkkkkkkkk',
    'kWWWWWWWWWWWWWWk',
    'kWkkWWWkkWWWkkWk',
    'kWkRWWWkRWWWkRWk',
    'kWWWWWWWWWWWWWWk',
    'kWWWWWkkkkWWWWWk',
    'kWWWWWkddkWWWWWk',
    'kWWWWWkddkWWWWWk',
    'kSSSSSkddkSSSSSk',
    'kkkkkkkkkkkkkkkk',
  ], { R: '#E07A6D', W: '#F2E8D0', d: '#6B4527', S: '#B9A57F' }),
  harborDistrict: icon([
    '.......k........',
    '......kFk.......',
    '......kFFk......',
    '......kFFFk.....',
    '......kFFFFk....',
    '......kkkkkk....',
    '.......k........',
    '..kkkkkkkkkkkk..',
    '..kHHHHHHHHHHk..',
    '...kHHHHHHHHk...',
    '....kkkkkkkk....',
    'WWwWWWwWWWwWWWwW',
    'kkkkkkkkkkkkkkkk',
    'kPPkPPkPPkPPkPPk',
    'kPPkPPkPPkPPkPPk',
    'kkkkkkkkkkkkkkkk',
  ], { F: '#F2E8D0', H: '#C9506B', W: '#A9D8EE', w: '#5BA7D1', P: '#9A6A3E' }),
  powerPlantDistrict: icon([
    '..kkk...........',
    '..kGk...........',
    '..kGk.....kk....',
    '..kGk....kYk....',
    '..kGk...kYk.....',
    '..kGk..kYYkk....',
    '..kGk..kkYYk....',
    '..kGk...kYk.....',
    'kkkkkkkkkYkkkkkk',
    'kWWWWWWWkkWWWWWk',
    'kWkkWWWWWWWWkkWk',
    'kWkYWWWWWWWWkYWk',
    'kWWWWWkkkkWWWWWk',
    'kWWWWWkddkWWWWWk',
    'kWWWWWkddkWWWWWk',
    'kkkkkkkkkkkkkkkk',
  ], { G: '#8C8577', Y: '#F7D25C', W: '#D8CFB8', d: '#6B4527' }),
  gardenDistrict: icon([
    '....kkk.........',
    '...kGGGk...kkk..',
    '..kGGgGGk.kGGGk.',
    '..kGgGGGkkGGgGGk',
    '...kGGGk.kGgGGGk',
    '....kbk...kGGGk.',
    '....kbk....kbk..',
    '.p..kbk..p.kbk..',
    'pYp.....pYp.....',
    '.p...r...p...r..',
    '.g..rYr..g..rYr.',
    '.g...r...g...r..',
    'kkkkkkkkkkkkkkkk',
    'kLLLLLLLLLLLLLLk',
    'kLlLLLlLLLlLLLlk',
    'kkkkkkkkkkkkkkkk',
  ], { G: '#7BC85A', g: '#3F8A33', b: '#9A6A3E', p: '#F2A7C8', Y: '#F7D25C', r: '#E07A6D', L: '#6FBF4A', l: '#3F8A33' }),
} satisfies Record<string, IconDef>;

// ---------- Small markers ----------
const MARKER_ICONS = {
  citizen: icon([
    '..kkk..',
    '.kSSSk.',
    '.kSSSk.',
    '..kkk..',
    '.kCCCk.',
    'kCCCCCk',
    'kkkkkkk',
  ], { S: '#F0C9A0', C: '#F2C14E' }),
  star: icon([
    '...k...',
    '..kYk..',
    'kkkYkkk',
    'kYYYYYk',
    '.kYYYk.',
    '.kYkYk.',
    '.kk.kk.',
  ], { Y: '#F7D25C' }),
  construction: icon([
    '....k....',
    '...kYk...',
    '...kYk...',
    '..kYkYk..',
    '..kYkYk..',
    '.kYYYYYk.',
    '.kYYkYYk.',
    'kYYYYYYYk',
    'kkkkkkkkk',
  ], { Y: '#F2A93B' }),
  /** v23: a pillaged (damaged) improvement. */
  damaged: icon([
    'k.......k',
    'kRk...kRk',
    '.kRk.kRk.',
    '..kRkRk..',
    '...kRk...',
    '..kRkRk..',
    '.kRk.kRk.',
    'kRk...kRk',
    'k.......k',
  ], { R: '#E0483A' }),
} satisfies Record<string, IconDef>;

const ICONS = { ...YIELD_ICONS, ...RESOURCE_ICONS, ...IMPROVEMENT_ICONS, ...DISTRICT_ICONS, ...MARKER_ICONS } as const;
export type IconName = keyof typeof ICONS;
export const MAP_ICON_NAMES = Object.keys(ICONS) as IconName[];
/** The palette grid of a map icon, for DOM panels (src/browser/ui-icons.ts renders it as an SVG data URL). */
export const mapIconGrid = (name: IconName): Readonly<IconDef> => ICONS[name];

const cache = new Map<string, HTMLCanvasElement>();
function rendered(name: IconName, scale: number): HTMLCanvasElement {
  const key = `${name}:${scale}`;
  let canvas = cache.get(key);
  if (canvas) return canvas;
  const { rows, palette } = ICONS[name];
  canvas = document.createElement('canvas');
  canvas.width = rows[0].length * scale; canvas.height = rows.length * scale;
  const context = canvas.getContext('2d')!;
  for (const [y, row] of rows.entries()) for (const [x, cell] of [...row].entries()) {
    if (cell === '.') continue;
    context.fillStyle = palette[cell] ?? '#FF00FF';
    context.fillRect(x * scale, y * scale, scale, scale);
  }
  cache.set(key, canvas);
  return canvas;
}

/** Width in grid cells of an icon. */
export const iconWidth = (name: IconName) => ICONS[name].rows[0].length;

/**
 * Draws an icon centred on (x, y) at roughly `size` CSS pixels wide. The pixel scale is an
 * integer in device pixels, so icons stay crisp at any zoom.
 */
export function drawIcon(context: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, alpha = 1): void {
  const dpr = context.getTransform().a || 1;
  const cells = iconWidth(name), scale = Math.max(1, Math.round(size * dpr / cells));
  const image = rendered(name, scale), width = image.width / dpr, height = image.height / dpr;
  if (alpha !== 1) { context.save(); context.globalAlpha *= alpha; }
  context.drawImage(image, Math.round((x - width / 2) * dpr) / dpr, Math.round((y - height / 2) * dpr) / dpr, width, height);
  if (alpha !== 1) context.restore();
}

// ---------- Pixel digits (3×5), drawn without fillText ----------
const DIGITS: Record<string, readonly string[]> = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'], '+': ['...', '.#.', '###', '.#.', '...'],
};
/** Draws a short number in a pixel font centred on (x, y); `height` is the glyph height in CSS pixels. */
export function drawPixelNumber(context: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, color: string): void {
  const dpr = context.getTransform().a || 1;
  const cell = Math.max(1, Math.round(height * dpr / 5)) / dpr, glyphs = [...text].filter(char => DIGITS[char]);
  const width = glyphs.length * 4 * cell - cell;
  let left = Math.round((x - width / 2) * dpr) / dpr;
  const top = Math.round((y - cell * 2.5) * dpr) / dpr;
  context.fillStyle = color;
  for (const char of glyphs) {
    for (const [row, line] of DIGITS[char].entries()) for (const [column, bit] of [...line].entries()) {
      if (bit === '#') context.fillRect(left + column * cell, top + row * cell, cell, cell);
    }
    left += cell * 4;
  }
}

/**
 * Draws a Civilization-style yield row: each yield type is a small cluster of overlapping icons
 * (one per point, up to 3, then a number). Returns nothing; callers decide placement.
 */
export function drawYieldRow(context: CanvasRenderingContext2D, yields: Readonly<Record<YieldKey, number>>, x: number, y: number, size: number, alpha = 1): void {
  const step = size * .5, gap = size * .25;
  const groups = YIELD_KEYS.filter(key => yields[key] > 0).map(key => ({ key, count: yields[key], shown: Math.min(3, yields[key]) }));
  if (!groups.length) return;
  const widthOf = (group: typeof groups[number]) => size + step * (group.shown - 1);
  const total = groups.reduce((sum, group) => sum + widthOf(group), 0) + gap * (groups.length - 1);
  let left = x - total / 2;
  for (const group of groups) {
    for (let index = 0; index < group.shown; index++) drawIcon(context, group.key, left + size / 2 + index * step, y, size, alpha);
    if (group.count > 3) {
      const cx = left + widthOf(group) - size * .15, cy = y + size * .3;
      context.save(); context.globalAlpha *= alpha;
      context.beginPath(); context.arc(cx, cy, size * .34, 0, Math.PI * 2); context.fillStyle = K; context.fill();
      drawPixelNumber(context, String(group.count), cx, cy, size * .36, '#FFF8E5');
      context.restore();
    }
    left += widthOf(group) + gap;
  }
}
