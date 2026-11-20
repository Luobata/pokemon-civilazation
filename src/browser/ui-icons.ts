// Shared icon kit for DOM panels (docs/design/ui-icons/README.md). The pixel icons are palette grids in the same
// hard-edged GBA-like style as the map icons (src/browser/map-icons.ts, which it reuses); grids are rendered once into
// cached SVG data URLs, so the kit is plain strings: it needs no canvas and works in Node tests. All art here is
// original: badges are framed programmatically, glyphs are hand-placed fills that receive an automatic dark outline.
// Icon-only markup always carries an accessible name (alt / aria-label + title).
// The 绘卷 (painted) theme swaps in an original smooth vector set (setIconStyle, "Vector set" section); flat / 2.5D keep the
// pixel icons, snapped to a whole number of device pixels per cell (pixelIconBox).
import { mapIconGrid, MAP_ICON_NAMES } from './map-icons.ts';
import type { IconName } from './map-icons.ts';
import { TYPE_COLORS } from '../content/type-colors.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { TypeId } from '../content/species.ts';
import type { UnitClass } from '../content/unit-classes.ts';
import { ESSENCES } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
// Styles live in src/ui-icons.css, imported by the browser modules (ui-tip.ts) so this kit stays importable from Node.

// ---------- Integer-scale sprite sizing (docs/design/fidelity/README.md) ----------
// The fixed-canvas sprite sets are pixel art: drawn at a fractional device-pixel scale they get uneven pixel widths or blur.
// A sprite is therefore shown at the largest whole multiple of its canvas that fits the requested box, centred in that box so
// the layout does not change (artImage here, pokemonPortrait / spriteImage in sprites.ts). Node tests use devicePixelRatio 1.
/** Canvas side of each fixed-size pixel sprite set (public/sprites/<set>/manifest.json). */
const PIXEL_SPRITE_SETS: Readonly<Record<string, number>> = { gen3: 64, gen4: 80, gen5: 96 };
export type ArtFit = {
  /** CSS size of the drawn image (a whole number of device pixels per sprite pixel when `pixelated`). */
  size: number;
  /** CSS margin that centres the image in the requested box (a whole number of device pixels). */
  inset: number;
  /** Pixel art at an integer scale: draw with `image-rendering: pixelated`. Otherwise the image scales smoothly. */
  pixelated: boolean;
};
const deviceRatio = (): number => {
  const ratio = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
};
/** The pixel canvas side of a sprite path, or null for art that scales smoothly (gens 6–9, SVG art, official artwork). */
export function pixelSpriteSide(src: string): number | null {
  const set = /\/sprites\/(gen\d)\/\d+\.png$/.exec(src)?.[1];
  return set ? PIXEL_SPRITE_SETS[set] ?? null : null;
}
/**
 * How to draw `src` in a `box`×`box` CSS slot. Pixel sprites use the largest integer device scale that fits: at DPR 2 a 64 px
 * Emerald sprite in a 40 px slot draws at 32 CSS px (×1), in a 64 px slot at 64 CSS px (×2). A slot smaller than one device
 * pixel per sprite pixel falls back to a smooth downscale.
 */
export function artFit(src: string, box: number, dpr = deviceRatio()): ArtFit {
  const side = pixelSpriteSide(src);
  if (!side) return { size: box, inset: 0, pixelated: false };
  const scale = Math.floor(box * dpr / side + 1e-6);
  if (scale < 1) return { size: box, inset: 0, pixelated: false };
  const size = scale * side / dpr;
  return { size, inset: Math.round((box - size) / 2 * dpr) / dpr, pixelated: true };
}

type Palette = Record<string, string>;
export type Grid = { rows: readonly string[]; palette: Palette };

const INK = '#17262A', CREAM = '#FFF8E5';

// ---------- Colour helpers ----------
const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
function mix(hex: string, target: number, amount: number): string {
  return `#${[0, 1, 2].map(index => Math.round(channel(hex, index) + (target - channel(hex, index)) * amount).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
export const darken = (hex: string, amount = .45) => mix(hex, 0, amount);
export const lighten = (hex: string, amount = .45) => mix(hex, 255, amount);

// ---------- Grid builders ----------
/** Pads a fill grid to a centred square and adds a 1-cell dark outline (4-neighbour), map-icon style. */
function glyph(rows: readonly string[], palette: Palette, outline = 'k'): Grid {
  const width = rows[0].length;
  if (rows.some(row => row.length !== width)) throw new Error(`Glyph rows must share a width: ${rows.join('|')}`);
  const side = Math.max(width, rows.length), left = Math.floor((side - width) / 2), top = Math.floor((side - rows.length) / 2);
  const cells = Array.from({ length: side + 2 }, () => Array<string>(side + 2).fill('.'));
  rows.forEach((row, y) => [...row].forEach((cell, x) => { if (cell !== '.') cells[y + top + 1][x + left + 1] = cell; }));
  const filled = (x: number, y: number) => cells[y]?.[x] !== undefined && cells[y][x] !== '.' && cells[y][x] !== outline;
  const out = cells.map((row, y) => row.map((cell, x) => cell === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ? outline : cell).join(''));
  return { rows: out, palette: { k: INK, w: CREAM, ...palette } };
}

type Shape = 'square' | 'circle' | 'shield' | 'octagon';
const SIDE = 12;
function inside(shape: Shape, x: number, y: number): boolean {
  const dx = Math.abs(x - 5.5), dy = Math.abs(y - 5.5);
  if (shape === 'circle') return dx * dx + dy * dy <= 6.2 * 6.2 && dx + dy <= 8.6;
  if (shape === 'octagon') return dx + dy <= 8.1;
  if (shape === 'square') return dx + dy <= 9.6;
  return y <= 6 ? dx + dy <= 9.6 || y > 1 : dx <= 5.5 - (y - 6) * 1.05;
}
/**
 * A 12×12 badge: a framed shape in `color` with a lighter top-left rim, a darker bottom-right rim, and an 8×8 symbol
 * stamped in the middle. Symbol cells use `symbol` palette keys; each symbol gets a 1-cell outline in the badge's dark shade.
 */
function badge(shape: Shape, color: string, symbolRows: readonly string[], symbolPalette: Palette = {}): Grid {
  const cells = Array.from({ length: SIDE }, (_, y) => Array.from({ length: SIDE }, (_, x): string => inside(shape, x, y) ? 'c' : '.'));
  const isIn = (x: number, y: number) => cells[y]?.[x] !== undefined && cells[y][x] !== '.';
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) if (isIn(x, y) && (!isIn(x - 1, y) || !isIn(x + 1, y) || !isIn(x, y - 1) || !isIn(x, y + 1))) cells[y][x] = 'k';
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) if (cells[y][x] === 'c') {
    if (cells[y - 1][x] === 'k' || cells[y][x - 1] === 'k') cells[y][x] = 'h';
    if (cells[y + 1][x] === 'k' || cells[y][x + 1] === 'k') cells[y][x] = 'd';
  }
  const offset = (SIDE - symbolRows.length) / 2 | 0, offsetX = (SIDE - symbolRows[0].length) / 2 | 0;
  const symbolAt = (x: number, y: number) => symbolRows[y - offset]?.[x - offsetX] ?? '.';
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const cell = symbolAt(x, y);
    if (cell !== '.' && cells[y][x] !== '.' && cells[y][x] !== 'k') cells[y][x] = cell;
  }
  // Outline the symbol in the badge's dark shade so it reads on light colours too.
  const isSymbol = (x: number, y: number) => symbolAt(x, y) !== '.' && cells[y]?.[x] !== undefined && cells[y][x] !== 'k' && cells[y][x] !== '.';
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) if (['c', 'h', 'd'].includes(cells[y][x]) && (isSymbol(x - 1, y) || isSymbol(x + 1, y) || isSymbol(x, y - 1) || isSymbol(x, y + 1))) cells[y][x] = 'o';
  return { rows: cells.map(row => row.join('')), palette: { k: INK, c: color, h: lighten(color, .35), d: darken(color, .2), o: darken(color, .55), '#': CREAM, w: CREAM, ...symbolPalette } };
}

// ---------- Type symbols (8×8; '#' = cream) ----------
export const TYPE_SYMBOLS: Record<TypeId, readonly string[]> = {
  normal: ['..####..', '.######.', '##....##', '##....##', '##....##', '##....##', '.######.', '..####..'],
  fire: ['...#....', '...##...', '..###.#.', '..#####.', '.######.', '.###.###', '.##...##', '..##.##.'],
  water: ['...##...', '...##...', '..####..', '.######.', '.#.####.', '########', '.######.', '..####..'],
  electric: ['....###.', '...###..', '..###...', '.######.', '...###..', '..###...', '.##.....', '.#......'],
  grass: ['.....###', '...#####', '..######', '.###.###', '.##.###.', '.#.###..', '#.##....', '#.......'],
  ice: ['...##...', '.#.##.#.', '..####..', '########', '########', '..####..', '.#.##.#.', '...##...'],
  fighting: ['.######.', '########', '#.#.#.##', '########', '########', '.######.', '..####..', '..####..'],
  poison: ['.##.....', '####..#.', '####.###', '.##..###', '......#.', '..####..', '.######.', '.######.'],
  ground: ['........', '...##...', '..####..', '..#..#..', '.######.', '.#....#.', '########', '########'],
  flying: ['.......#', '.....###', '...#####', '.#######', '########', '.##.##.#', '..#..#..', '........'],
  psychic: ['........', '..####..', '.##..##.', '##.##.##', '##.##.##', '.##..##.', '..####..', '........'],
  bug: ['.#....#.', '..####..', '.##..##.', '###..###', '###..###', '###..###', '.##..##.', '..#..#..'],
  rock: ['...###..', '..#####.', '.#######', '########', '####.###', '###.####', '.######.', '........'],
  ghost: ['..####..', '.######.', '#..##..#', '#..##..#', '########', '########', '########', '##.##.##'],
  dragon: ['#......#', '##....##', '###..###', '.######.', '..####..', '..####..', '...##...', '...##...'],
  dark: ['..####..', '.###....', '###.....', '###.....', '###.....', '###.....', '.###....', '..####..'],
  steel: ['.#.##.#.', '.######.', '###..###', '.#....#.', '.#....#.', '###..###', '.######.', '.#.##.#.'],
  fairy: ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
};
export const TYPE_IDS = Object.keys(TYPE_SYMBOLS) as TypeId[];

// ---------- Unit class and HM symbols ----------
const CLASS_SYMBOLS: Record<UnitClass, readonly string[]> = {
  melee: ['########', '###..###', '###..###', '#......#', '###..###', '.##..##.', '..####..', '...##...'],
  ranged: ['......##', '.....###', '....###.', '#..###..', '.####...', '..##....', '.#.#....', '#...#...'],
  fast: ['#...#...', '##..##..', '###.###.', '.###.###', '.###.###', '###.###.', '##..##..', '#...#...'],
  scout: ['##....##', '##....##', '###..###', '########', '###..###', '###..###', '###..###', '.##..##.'],
  siege: ['#.......', '.#..###.', '...#####', '#.######', '..######', '.#######', '..#####.', '........'],
  air: ['.......#', '.....###', '...#####', '.#######', '########', '.##.##.#', '..#..#..', '........'],
  naval: ['........', '.##...##', '####.###', '#..###..', '........', '.##...##', '####.###', '#..###..'],
};
export const CLASS_COLORS: Record<UnitClass, string> = {
  melee: '#C8664F', ranged: '#D79A3A', fast: '#E2C14A', scout: '#7FB86A', siege: '#9A7B58', air: '#8EA6EE', naval: '#4F93D6',
};
export type HmId = 'surf' | 'strength' | 'ride' | 'fly';
const HM_SYMBOLS: Record<HmId, readonly string[]> = {
  surf: CLASS_SYMBOLS.naval,
  strength: TYPE_SYMBOLS.fighting,
  ride: ['..####..', '.######.', '###..###', '##....##', '##....##', '##....##', '##....##', '.#....#.'],
  fly: CLASS_SYMBOLS.air,
};
export const HM_COLORS: Record<HmId, string> = { surf: '#3F86D8', strength: '#B0703A', ride: '#E0913A', fly: '#8A9FF0' };
export const HM_NAMES: Record<HmId, string> = { surf: '冲浪', strength: '怪力', ride: '骑乘', fly: '飞翔' };
export const HM_OF_CLASS: Partial<Record<UnitClass, HmId>> = { naval: 'surf', siege: 'strength', fast: 'ride', air: 'fly' };

// ---------- Hand-drawn glyphs (fill only; the outline is added) ----------
const GLYPHS = {
  // Resources and meters.
  civics: glyph(['.PPPPPPPP.', 'PpPPPPPPPp', '.PiiiiiiP.', '.PPPPPPPP.', '.PiiiiiPP.', '.PPPPPPPP.', '.PiiiiiiP.', '.PPPPPPPP.', 'PpPPPPPPPp', '.PPPPPPPP.'],
    { P: '#F2E3B8', p: '#C9A86A', i: '#8A63C8' }),
  faith: glyph(['....YY....', '...YYY....', '...YOYY...', '..YOOOY...', '..YORROY..', '...ORRO...', 'BBBBBBBBBB', '.BBBBBBBB.', '..bbbbbb..', '...bbbb...'],
    { Y: '#FFE680', O: '#F2A93B', R: '#D9495B', B: '#C9B48A', b: '#8C7650' }),
  eraScore: glyph(['....YY....', '....YY....', '...YWYY...', 'YYYYWYYYYY', '.YYYYYYYY.', '..YYYYYy..', '..YYyyYY..', '.YYy..yYY.', '.Yy....yY.'],
    { Y: '#F7D25C', y: '#C8952C', W: CREAM }),
  turns: glyph(['FFFFFFFFFF', '.GSSSSSSG.', '.GGSSSSGG.', '..GGSSGG..', '...GSSG...', '...GGSG...', '..GGGSGG..', '.GGGSSSGG.', '.GSSSSSSG.', 'FFFFFFFFFF'],
    { F: '#9A6A3E', G: '#CFEFF7', S: '#F2C14E' }),
  satisfaction: glyph(['...YYYY...', '.YYYYYYYY.', '.YYkYYkYY.', 'YYYkYYkYYY', 'YYYYYYYYYY', 'YkYYYYYYkY', 'YYkYYYYkYY', '.YYkkkkYY.', '.yYYYYYYy.', '...yyyy...'],
    { Y: '#F7D25C', y: '#C8952C' }),
  badge: glyph(['...YYYY...', '..YWYYYY..', '.YWYRRYYY.', 'YYYRRRRYYY', 'YYRRWRRRYy', 'YYRRRRRRYy', 'YYYRRRRYyy', '.YYYRRYYy.', '..YYYYyy..', '...yyyy...'],
    { Y: '#F7D25C', y: '#C8952C', R: '#D9495B', W: CREAM }),
  essence: glyph(['....CC....', '...CWCC...', '..CWccCC..', '.CWcccCCd.', 'CCcccCCCdd', '.CCccCCdd.', '..CCCCdd..', '...Cddd...', '....dd....'],
    { C: '#C8B4EE', c: '#9C7AD8', d: '#5E4596', W: CREAM }),
  heart: glyph(['.RRR..RRR.', 'RRWRRRRRRr', 'RWRRRRRRRr', 'RRRRRRRRRr', '.RRRRRRRr.', '..RRRRRr..', '...RRRr...', '....Rr....'],
    { R: '#E0483A', r: '#A82B22', W: CREAM }),
  medicine: glyph(['.RRR..RRR.', 'RRRRRRRRRr', 'RRRRWWRRRr', 'RRWWWWWWRr', '.RWWWWWWr.', '..RRWWRr..', '...RRRr...', '....Rr....'],
    { R: '#E0483A', r: '#A82B22', W: CREAM }),
  // Balls (original pixel art in the game's red-and-white motif).
  pokeBall: glyph(['...RRRR...', '.RRWRRRRr.', '.RWRRRRRr.', 'RRRRkkRRrr', 'kkkkWWkkkk', 'kkkkWWkkkk', 'WWWWkkWWww', '.WWWWWWWw.', '.WWWWWWww.', '...wwww...'],
    { R: '#E0483A', r: '#A82B22', W: CREAM, w: '#C9C2B0' }),
  greatBall: glyph(['...BBBB...', '.BRWBBRBb.', '.RWBBBBRb.', 'RBBBkkBBRb', 'kkkkWWkkkk', 'kkkkWWkkkk', 'WWWWkkWWww', '.WWWWWWWw.', '.WWWWWWww.', '...wwww...'],
    { B: '#4A7FD8', b: '#2C5296', R: '#E0483A', W: CREAM, w: '#C9C2B0' }),
  masterBall: glyph(['...MMMM...', '.PMWMMPMm.', '.MWMMMMMm.', 'MMMMkkMMmm', 'kkkkWWkkkk', 'kkkkWWkkkk', 'WWWWkkWWww', '.WWWWWWWw.', '.WWWWWWww.', '...wwww...'],
    { M: '#8B4FC2', m: '#5C2F88', P: '#F07AB0', W: CREAM, w: '#C9C2B0' }),
  // Unlock kinds.
  building: glyph(['....RR....', '...RRRR...', '..RRRRRR..', '.RRRRRRRR.', 'RRRRRRRRRR', '.WWWWWWWW.', '.WbbWWddW.', '.WbbWWddW.', '.WWWWWddW.', '.SSSSSSSS.'],
    { R: '#D9534F', W: '#F2E8D0', b: '#7FC6E8', d: '#6B4527', S: '#B9A57F' }),
  unit: glyph(['..PP..PP..', '..PP..PP..', 'PP......PP', 'PP......PP', '....PP....', '..PPPPPP..', '.PPPPPPPP.', '.PPPPPPPP.', '..PPPPPP..'],
    { P: '#E8B07A' }),
  district: glyph(['..R....B..', '.RRR..BBB.', '.WWW..WWW.', '.WdW..WdW.', '.WWWGGWWW.', 'GGGGGGGGGG', 'gGGGGGGGGg', '.gGGGGGGg.', '..gggggg..'],
    { R: '#D9534F', B: '#4A9FD4', W: '#F2E8D0', d: '#6B4527', G: '#7BC85A', g: '#3F8A33' }),
  improvement: glyph(['....GG....', '...GGgG...', '....Gg....', '.....g....', 'bbbbbbbbbb', 'BBBBBBBBBB', 'bbbbbbbbbb', 'BBBBBBBBBB', 'bbbbbbbbbb'],
    { G: '#7BC85A', g: '#3F8A33', b: '#B07A48', B: '#7A4F2A' }),
  policyCard: glyph(['.CCCCCCCC.', '.CbbbbbbC.', '.CCCCCCCC.', '.CkkkkkCC.', '.CCCCCCCC.', '.CkkkkCCC.', '.CCCCYCCC.', '.CCCYYYCC.', '.CCCCYCCC.', '.CCCCCCCC.'],
    { C: '#F2E3B8', b: '#8A63C8', Y: '#E0A030' }),
  wonder: glyph(['....YY....', '....YY....', '...SSSS...', '..SSSSSS..', '..SdSSdS..', '..SdSSdS..', '..SdSSdS..', '..SdSSdS..', '.SSSSSSSS.', 'SSSSSSSSSS'],
    { Y: '#F7D25C', S: '#E8DCC0', d: '#A8946C' }),
  effect: glyph(['....Y.....', '....Y.....', '...YWY....', 'YYYWWWYYY.', '...YWY....', '....Y...Y.', '....Y..YWY', '........Y.'],
    { Y: '#F7D25C', W: CREAM }),
  // States and markers.
  lock: glyph(['..SSSS..', '.SS..SS.', '.S....S.', 'YYYYYYYY', 'YYYkkYYY', 'YYYkkYYY', 'YYYYYYYY', 'yyyyyyyy'],
    { S: '#C9D2D6', Y: '#D7A63C', y: '#9A7020' }),
  check: glyph(['......GG', '.....GG.', 'G...GG..', 'GG.GG...', '.GGG....', '..G.....'], { G: '#6BD08A' }),
  play: glyph(['BB......', 'BBBB....', 'BBBBBB..', 'BBBBBBBB', 'BBBBBB..', 'BBBB....', 'BB......'], { B: '#6FC0F0' }),
  pokedex: glyph(['RRRRRRRRRR', 'RWWBBRRRRr', 'RWBBBRgRyr', 'RBBBBRRRRr', 'RRRRRRRRRr', 'RkkkkkkkkR', 'RkGGGGGGkr', 'RkGGGGGGkr', 'RkkkkkkkkR', 'rrrrrrrrrr'],
    { R: '#E0483A', r: '#A82B22', B: '#5BB6E8', W: CREAM, g: '#6BD08A', y: '#F7D25C', G: '#9FE0C0' }),
  // Technology subjects.
  cloud: glyph(['......YY..', '.....YYYY.', '...WWWYYY.', '..WWWWWWY.', '.WWWWWWWW.', 'WWWWWWWWWW', 'wwwwwwwwww', '.B..B..B..', 'B..B..B...'],
    { Y: '#F7D25C', W: '#F4F8FA', w: '#B9CBD6', B: '#5BA7D1' }),
  ribbon: glyph(['.PP....PP.', 'PPPP..PPPP', 'PPPPYYPPPP', '.PPYYYYPP.', '..PPYYPP..', '...PppP...', '..PP..PP..', '..Pp..pP..', '.PP....PP.'],
    { P: '#F07AB0', p: '#B8487E', Y: '#F7D25C' }),
  egg: glyph(['...WWWW...', '..WWWWWW..', '.WWGGWWWW.', '.WGGGWWWW.', 'WWWGWWWGWW', 'WWWWWWGGGW', 'WWWWWWWGWw', '.WWGWWWWw.', '.WWWWWWww.', '..wwwwww..'],
    { W: CREAM, w: '#C9C2B0', G: '#6FBF4A' }),
  map: glyph(['PPPPPPPPPP', 'PbbbPGGGPP', 'PbbGGGGPPP', 'PbGGGRPRPP', 'PbbGGPRPPP', 'PbbbGRPRPP', 'PbbbbGGPPP', 'PPPPPPPPPP'],
    { P: '#F2E3B8', b: '#5BA7D1', G: '#7BC85A', R: '#D9495B' }),
  brick: glyph(['RRRRrRRRRr', 'rrrrrrrrrr', 'RRrRRRRrRR', 'rrrrrrrrrr', 'RRRRrRRRRr', 'rrrrrrrrrr', 'RRrRRRRrRR'],
    { R: '#C0704A', r: '#7E4428' }),
  anvil: glyph(['SSSSSSSSS.', '.SSSSSSSSS', '..SSSSSS..', '...SSSS...', '...SSSS...', '..ssssss..', '.ssssssss.'],
    { S: '#BFC3D6', s: '#7E8496' }),
  trophy: glyph(['YYYYYYYYYY', 'YYWYYYYYYY', '.YWYYYYYy.', '..YYYYYy..', '...YYYy...', '....Yy....', '....Yy....', '...yyyy...', '..BBBBBB..'],
    { Y: '#F7D25C', y: '#C8952C', W: CREAM, B: '#8A6D3B' }),
  // Unit stats.
  attack: glyph(['R..R..R...', 'RR.RR.RR..', '.RR.RR.RR.', '..RR.RR.RR', '...RR.RR.R', '....R..R..'], { R: '#F08A4B' }),
  defense: glyph(['BBBBBBBBBB', 'BWWBBBBBBb', 'BWBBBBBBBb', 'BBBBBBBBBb', 'BBBBBBBBBb', '.BBBBBBBb.', '.BBBBBBbb.', '..BBBBbb..', '...BBbb...', '....bb....'],
    { B: '#6FA5EE', b: '#3F6FB8', W: CREAM }),
  move: glyph(['..BBBB....', '..BBBB....', '..BWWB....', '..BBBB....', '..BBBBBB..', '.BBBBBBBB.', '.BBBBBBBBB', '.ssssssss.'],
    { B: '#B07A48', W: '#F2E8D0', s: '#5E3E22' }),
  range: glyph(['..RRRRRR..', '.RRWWWWRR.', 'RRWWRRWWRR', 'RWWRRRRWWR', 'RWWRRRRWWR', 'RRWWRRWWRR', '.RRWWWWRR.', '..RRRRRR..'],
    { R: '#E0483A', W: CREAM }),
  // World.
  nest: glyph(['...WWW....', '..WWWWW...', '..WWWWWw..', 'BbBWWWwBbB', 'bBbBbBbBbB', '.bBbBbBbB.', '..bbbbbb..'],
    { W: CREAM, w: '#C9C2B0', B: '#B07A48', b: '#7A4F2A' }),
  clipboard: glyph(['...SSSS...', 'BBBSSSSBBB', 'BWWWWWWWWB', 'BWkkkkkWWB', 'BWWWWWWWWB', 'BWkkkkWWWB', 'BWWWWWWWWB', 'BWkkkkkkWB', 'BWWWWWWWWB', 'BBBBBBBBBB'],
    { S: '#BFC3D6', B: '#9A6A3E', W: '#F2E8D0' }),
  swords: glyph(['S........S', 'SS......SS', '.SS....SS.', '..SS..SS..', '...SSSS...', '...SSSS...', '..hSS.SSh.', '.hh....hh.', 'hh......hh'],
    { S: '#DDE3E8', h: '#9A6A3E' }),
  // Unit orders (v26 §7, go-to and suggested city sites).
  goTo: glyph(['P.........', 'PBBBBBB...', 'PBWBBBBBB.', 'PBBBBBBBBB', 'PBBBBBB...', 'P.........', 'P.........', 'P..d..d..d', 'PP........'],
    { P: '#C9A86A', B: '#4FB0E0', W: CREAM, d: '#F2E3B8' }),
  sitePin: glyph(['..RRRRRR..', '.RRRRRRRR.', 'RRRWWWWRRR', 'RRWWWWWWRR', 'RRWWWWWWRR', 'RRRWWWWRRR', '.RRRRRRRR.', '..RRRRRR..', '...RRRR...', '....RR....'],
    { R: '#F2A93B', W: CREAM }),
  freshWater: glyph(['....BB....', '...BBBB...', '..BBBBBB..', '.BBWBBBBB.', '.BWBBBBBB.', 'BBWBBBBBBb', 'BBBBBBBBBb', '.BBBBBBBb.', '..bbbbbb..'],
    { B: '#5BB6E8', b: '#2F7FB8', W: CREAM }),
  coast: glyph(['.BB...BB..', 'BWWB.BWWB.', 'B..BBB..BB', '..........', '.BB...BB..', 'BWWB.BWWB.', 'B..BBB..BB'],
    { B: '#3F86D8', W: '#CFEFF7' }),
  handshake: glyph(['..........', 'YY......BB', 'YYY....BBB', '.YYYSSBBB.', '..YSSSSB..', '...SSSS...', '....SS....'],
    { Y: '#F0C9A0', B: '#C08A52', S: '#E8B07A' }),
  // World page and victory routes (docs/design/depth-v26.md §6).
  /** Crosshair of the 定位 (locate) buttons. */
  locate: glyph(['....YY....', '..YYYYYY..', '.YY.YY.YY.', '.Y..YY..Y.', 'YYYYWWYYYY', 'YYYYWWYYYY', '.Y..YY..Y.', '.YY.YY.YY.', '..YYYYYY..', '....YY....'],
    { Y: '#F2C14E', W: CREAM }),
  /** The own rival: a half-length trainer portrait with a red cap (original). */
  rival: glyph(['...CCCC...', '..CCWCCC..', '.CCCCCCCC.', '.bbbbbbbbb', '.HSSSSSH..', '.HSkSSkS..', '..SSSSSS..', '...SSSS...', '.JJJJJJJJ.', 'JJJJJJJJJJ'],
    { C: '#D9495B', b: '#8E2A36', W: CREAM, H: '#5A3A2A', S: '#F0C9A0', J: '#3F6FB8' }),
  /** A league NPC trainer (conference bracket): blue cap, green jacket. */
  trainer: glyph(['...CCCC...', '..CCWCCC..', '.CCCCCCCC.', '.bbbbbbbbb', '.HSSSSSH..', '.HSkSSkS..', '..SSSSSS..', '...SSSS...', '.JJJJJJJJ.', 'JJJJJJJJJJ'],
    { C: '#4A7FD8', b: '#2C5296', W: CREAM, H: '#2B2B3A', S: '#F0C9A0', J: '#6BA35A' }),
  /** An origin stone tablet with a carved rune. */
  tablet: glyph(['..SSSSSS..', '.SSSSSSSS.', '.SSGGGGSs.', '.SSGSSGSs.', '.SSGGGGSs.', '.SSSGSSSs.', '.SSGGGSSs.', '.SSSSSSSs.', '.ssssssss.'],
    { S: '#BFC3D6', s: '#7E8496', G: '#4FB998' }),
  /** A civilization banner on a pole (`F` is recoloured per civilization by `flagImage`). */
  flag: glyph(['P.........', 'PFFFFFFF..', 'PFWFFFFFF.', 'PFFFFFFFF.', 'PFFFFFFF..', 'PFFFFFF...', 'P.........', 'P.........', 'P.........', 'PP........'],
    { P: '#9A6A3E', F: '#E6B85C', W: CREAM }),
  // Battles and evolution (depth-v26 §2.5, §4.1): Rare Candy, day / night, matchup arrows, a league trainer.
  candy: glyph(['B........B', 'BB.CCCC.BB', 'BBCCWCCCBB', 'BBCCCCCcBB', 'BB.cccc.BB', 'B........B'],
    { B: '#4A7FD8', C: '#9CD6F2', c: '#5BA7D1', W: CREAM }),
  sun: glyph(['....Y....', '.Y.....Y.', '...YYY...', '..YYWYY..', 'Y.YWYYY.Y', '..YYYYY..', '...YYY...', '.Y.....Y.', '....Y....'],
    { Y: '#F7C843', W: CREAM }),
  moon: glyph(['...MMM..', '.MMM....', '.MM.....', 'MMM...S.', 'MMM.....', 'MMMM..M.', '.MMMMMM.', '..MMMM..'],
    { M: '#E8E0A8', S: '#F7D25C' }),
  matchupUp: glyph(['....G....', '...GGG...', '..GGWGG..', '.GGWGGGG.', 'GGGGGGGGG', '...GGG...', '...GGG...', '...ggg...'],
    { G: '#6BD08A', g: '#3F8A5A', W: CREAM }),
  matchupDown: glyph(['...OOO...', '...OOO...', '...OOO...', 'OOOOOOOOO', '.OOOOOOO.', '..OOOOO..', '...OOO...', '....o....'],
    { O: '#F2A93B', o: '#B8701C' }),
  matchupNone: glyph(['XX....XX', 'XXX..XXX', '.XXXXXX.', '..XXXX..', '..XXXX..', '.XXXXXX.', 'XXX..XXX', 'XX....XX'],
    { X: '#9AA6A0' }),
  matchupEven: glyph(['SSSSSS', 'SSSSSS'], { S: '#C9D2D6' }),
  // Terrain conditions (Eevee's forest / snow branches and the like).
  grassTuft: glyph(['..G....G.', '.GgG..GgG', 'GGgGGGGgG', 'ggggggggg'], { G: '#7BC85A', g: '#3F8A33' }),
  tree: glyph(['....G....', '...GGG...', '..GGgGG..', '.GGGGGgG.', '..GGGGG..', '.GGGgGGG.', 'GGGGGGGgG', '....b....', '....b....'],
    { G: '#58B04A', g: '#2D6B23', b: '#7A4F2A' }),
  peak: glyph(['....W....', '...WWS...', '..SSSSS..', '.SSsSSSS.', 'SSSSsSSSS'], { W: CREAM, S: '#9AA6A0', s: '#6F7B75' }),
  dune: glyph(['......C..', '.....CCC.', '......C..', '..DD..C..', '.DDDD.DD.', 'DDDDDDDDD'], { D: '#E8C97A', C: '#58B04A' }),
  snowflake: glyph(['....S....', '.S..S..S.', '..S.S.S..', '...SSS...', 'SSSSWSSSS', '...SSS...', '..S.S.S..', '.S..S..S.', '....S....'],
    { S: '#BFE3F7', W: CREAM }),
  volcanoCone: glyph(['...O.O...', '....O....', '...RRR...', '..SSRSS..', '.SSSSSSS.', 'SSSSSSSSS'], { O: '#F2A93B', R: '#E0483A', S: '#5C4A44' }),
  // Gameplay v26 late game (docs/design/depth-v26.md §4.2, §5, §10): original glyphs.
  /** A Max Raid den: a red-violet glow over a dark den. */
  raid: glyph(['....RR....', '...RWWR...', '..RWRRWR..', '.RRRRRRRR.', 'RRMRRRRMRR', '.MMMMMMMM.', 'MMbbbbbbMM', 'bbbbbbbbbb'],
    { R: '#E0405A', M: '#9A3AC8', W: CREAM, b: '#5A3A2A' }),
  /** v27 ⑤ a Max shield pip: a pink-red pixel hexagon (12×12 with its outline). */
  shield: glyph(['...SSSS...', '..SWWSSS..', '.SWSSSSSS.', 'SWSSSSSSSs', 'SSSSSSSSSs', 'SSSSSSSSSs', 'SSSSSSSSss', '.SSSSSSss.', '..SSSsss..', '...ssss...'],
    { S: '#F0709A', s: '#B8406A', W: CREAM }),
  /** A TM disc with its label hole. */
  tm: glyph(['...SSSS...', '.SSWWSSSS.', '.SWSSSSSSs', 'SSSSkkSSSs', 'SSSkTTkSss', 'SSSSkkSSss', '.SSSSSSss.', '.SSSSSsss.', '...ssss...'],
    { S: '#9AA7C8', s: '#6A7590', T: '#E3C34F', W: CREAM }),
  /** Rush production: an hourglass. */
  rush: glyph(['YYYYYYYY', '.WSSSSW.', '..WSSW..', '...WW...', '...WW...', '..W..W..', '.WSSSSW.', 'YYYYYYYY'],
    { Y: '#C08A52', W: '#CFEFF7', S: '#F2C14E' }),
  /** Special training: a dumbbell. */
  training: glyph(['BB......BB', 'BBB....BBB', 'BBBSSSSBBB', 'BBB....BBB', 'BB......BB'], { B: '#5A6A80', S: '#BFC3D6' }),
  /** Near-victory warning: an alarm bell. */
  alarm: glyph(['....YY....', '...YYYY...', '..YWYYYY..', '..YWYYYY..', '.YYYYYYYY.', '.YYYYYYYY.', 'YYYYYYYYYy', '..........', '....RR....'],
    { Y: '#F2C14E', y: '#C8932E', R: '#E0405A', W: CREAM }),
  /** Contest categories: cool (flame), beauty (bubble), cute (heart), smart (spectacles), tough (fist). */
  contestCool: glyph(['...R....', '..RR..R.', '..RRR.RR', '.RROORRR', '.ROOYORR', 'RROYYORR', '.ROYYOR.', '..RRRR..'], { R: '#D9495B', O: '#F08A4B', Y: '#F2C14E' }),
  contestBeauty: glyph(['..BBBB..', '.BWBBBB.', 'BWBBBBBB', 'BBBBBBBb', 'BBBBBBbb', '.BBBBbb.', '..bbbb..'], { B: '#5B9BD0', b: '#3F6FA0', W: '#CFEFF7' }),
  contestCute: glyph(['.PP..PP.', 'PWPPPPPP', 'PPPPPPPP', '.PPPPPP.', '..PPPP..', '...PP...'], { P: '#F0A0C8', W: CREAM }),
  contestSmart: glyph(['GGGG..GGGG', 'GWWG..GWWG', 'GWWGGGGWWG', 'GWWG..GWWG', 'GGGG..GGGG'], { G: '#4FB998', W: '#CFEFF7' }),
  contestTough: glyph(['.YYYYYY.', 'YYYYYYYY', 'Y.Y.Y.YY', 'YYYYYYYY', 'YYYYYYYY', '.YYYYYY.', '..YYYY..'], { Y: '#C9A04A' }),
  /** v27 ⑥: a league trainer's signature (ace) Pokémon — a five-point star. */
  star: glyph(['....YY....', '....YY....', '...YWYY...', 'YYYYWYYYYY', '.YYYYYYYy.', '..YYYYYy..', '..YYYYYy..', '.YYy..YYy.', '.Yy....Yy.'], { Y: '#F7D25C', y: '#C8952C', W: CREAM }),
} satisfies Record<string, Grid>;
/** The terrain-condition icon of a biome (evolution conditions, arena captions). */
export const BIOME_ICONS = { grassland: 'grassTuft', forest: 'tree', mountain: 'peak', ocean: 'coast', desert: 'dune', snow: 'snowflake', volcano: 'volcanoCone' } as const;
export type GlyphName = keyof typeof GLYPHS;

// ---------- Registry ----------
export type UiIconName = GlyphName | IconName | `type:${TypeId}` | `class:${UnitClass}` | `hm:${HmId}` | `gym:${TypeId}` | `essence:${EssenceId}`;

const grids = new Map<string, Grid>();
function gridOf(name: UiIconName): Grid {
  let grid = grids.get(name);
  if (grid) return grid;
  const [family, id] = name.includes(':') ? name.split(':') as [string, string] : ['', name];
  if (family === 'type') grid = badge('square', TYPE_COLORS[id as TypeId], TYPE_SYMBOLS[id as TypeId]);
  else if (family === 'gym') grid = badge('octagon', TYPE_COLORS[id as TypeId], TYPE_SYMBOLS[id as TypeId]);
  else if (family === 'class') grid = badge('shield', CLASS_COLORS[id as UnitClass], CLASS_SYMBOLS[id as UnitClass]);
  else if (family === 'hm') grid = badge('circle', HM_COLORS[id as HmId], HM_SYMBOLS[id as HmId]);
  else if (family === 'essence') {
    const color = ESSENCES[id as EssenceId].color;
    grid = { rows: GLYPHS.essence.rows, palette: { ...GLYPHS.essence.palette, C: lighten(color, .35), c: color, d: darken(color, .35) } };
  } else if (Object.hasOwn(GLYPHS, id)) grid = GLYPHS[id as GlyphName];
  else if ((MAP_ICON_NAMES as readonly string[]).includes(id)) {
    const map = mapIconGrid(id as IconName);
    grid = { rows: map.rows, palette: map.palette };
  } else throw new Error(`Unknown UI icon: ${name}`);
  grids.set(name, grid);
  return grid;
}

/** Every icon of the kit, for tests and the design README contact sheet. */
export const UI_ICON_NAMES: readonly UiIconName[] = [
  ...Object.keys(GLYPHS) as GlyphName[],
  ...TYPE_IDS.map(id => `type:${id}` as const), ...TYPE_IDS.map(id => `gym:${id}` as const),
  ...(Object.keys(CLASS_SYMBOLS) as UnitClass[]).map(id => `class:${id}` as const),
  ...(Object.keys(HM_SYMBOLS) as HmId[]).map(id => `hm:${id}` as const),
  ...(Object.keys(ESSENCES) as EssenceId[]).map(id => `essence:${id}` as const),
  ...MAP_ICON_NAMES,
];
export const iconGrid = (name: UiIconName): Readonly<Grid> => gridOf(name);

// ---------- Vector set of the 绘卷 (painted) theme ----------
// Fidelity pass (docs/design/fidelity/README.md): original SVG icons on a 24×24 grid in one style — filled enamel shapes with an
// automatic bevel (a light top-left rim and a darker bottom-right rim, clipped to the shape), one walnut-ink outline of 1.5 units
// with round joins, and the colours of the matching pixel icon so meaning carries over between looks. Plain strings (cached data
// URLs), so the kit still needs no DOM. Names follow the pixel kit, plus `action:*` for the unit action bar; a name without a
// vector falls back to its pixel icon.
export const VECTOR_INK = '#2A1B0E';

const light = (hex: string, amount = .42) => lighten(hex, amount);
const dark = (hex: string, amount = .28) => darken(hex, amount);

// ---------- Drawing helpers (each returns SVG markup in the 24×24 space) ----------
const OUTLINE = `stroke="${VECTOR_INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;
let clipSeq = 0;
/**
 * An enamel shape: base fill with a bevel (light rim top-left, dark rim bottom-right), optional `inner` art clipped to the
 * shape, and the ink outline on top. `bevel: false` keeps a flat fill (thin shapes, where a rim would turn to mud).
 */
function shape(d: string, fill: string, inner = '', { bevel = true, outline = true }: { bevel?: boolean; outline?: boolean } = {}): string {
  const id = `c${clipSeq++}`, inset = `i${id}`;
  const rim = bevel
    ? `<path d="${d}" fill="${light(fill)}"/><path d="${d}" fill="${dark(fill)}" transform="translate(1.4 1.4)"/>`
      + `<clipPath id="${inset}"><path d="${d}" transform="translate(-1.3 -1.3)"/></clipPath><g clip-path="url(#${inset})"><path d="${d}" fill="${fill}" transform="translate(1.3 1.3)"/></g>`
    : `<path d="${d}" fill="${fill}"/>`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${rim}${inner}</g>${outline ? `<path d="${d}" fill="none" ${OUTLINE}/>` : ''}`;
}
/** A flat filled path with the ink outline. */
const flat = (d: string, fill: string) => `<path d="${d}" fill="${fill}" ${OUTLINE}/>`;
/** A stroked line with an ink casing (the casing is 2.4 units wider than the line). */
const line = (d: string, color: string, width = 1.6) =>
  `<path d="${d}" fill="none" stroke="${VECTOR_INK}" stroke-width="${width + 2.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** A plain stroke without casing (details inside a shape). */
const stroke = (d: string, color: string, width = 1.2, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const circle = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
/** A soft specular highlight. */
const gloss = (cx: number, cy: number, rx: number, ry: number, angle = -30, opacity = .55) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#FFFFFF" opacity="${opacity}" transform="rotate(${angle} ${cx} ${cy})"/>`;
/** A scalloped rosette outline (contest ribbon). */
function rosette(cx: number, cy: number, radius: number, amplitude: number, lobes: number): string {
  const points = Array.from({ length: 96 }, (_, step) => {
    const angle = step / 96 * Math.PI * 2, r = radius + amplitude * Math.cos(angle * lobes);
    return `${(cx + r * Math.sin(angle)).toFixed(2)} ${(cy - r * Math.cos(angle)).toFixed(2)}`;
  });
  return `M${points.join('L')}Z`;
}

// ---------- Shared shapes ----------
const COIN = circle(12, 12, 9);
const HEART = 'M12 20.6C6.6 16.8 3 13.4 3 9.2 3 6.4 5.1 4.4 7.7 4.4c1.8 0 3.4 1 4.3 2.6.9-1.6 2.5-2.6 4.3-2.6C18.9 4.4 21 6.4 21 9.2c0 4.2-3.6 7.6-9 11.4Z';
const HOURGLASS_GLASS = 'M7 5.4h10c0 3.8-3.2 5-3.6 6.6.4 1.6 3.6 2.8 3.6 6.6H7c0-3.8 3.2-5 3.6-6.6C10.2 10.4 7 9.2 7 5.4Z';
const STAR = 'M12 2.6l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z';
const SPARKLE = 'M12 2.6c.8 4.8 2.6 6.6 7.4 7.4-4.8.8-6.6 2.6-7.4 7.4-.8-4.8-2.6-6.6-7.4-7.4 4.8-.8 6.6-2.6 7.4-7.4Z';
const PIN = 'M12 21.6c-4.4-5-7-8.6-7-12a7 7 0 0 1 14 0c0 3.4-2.6 7-7 12Z';
const FLAG = 'M7.2 4c3-1.4 5.4 1.4 8.4 0 1.6-.8 3.2-.6 4.4 0v8.4c-1.2-.6-2.8-.8-4.4 0-3 1.4-5.4-1.4-8.4 0Z';
const WING = 'M3 15.4C8 15.2 12.8 12.6 16.2 5.4c1.4 3.4 3.8 5 4.8 5.4-.6 4.2-4.4 8.2-10.6 8.6-3 .2-5.8-1.2-7.4-4Z';
const HOUSE_ROOF = 'M12 3.2 21.4 11H2.6Z';

function hourglass(): string {
  return `${shape(HOURGLASS_GLASS, '#DDF3F8',
    `<path d="M8.6 7.6h6.8c-.8 1.6-2.4 2.6-3.4 3.4-1-.8-2.6-1.8-3.4-3.4Z" fill="#F2C14E"/><path d="M7.6 18.8c.6-2.4 2.8-3.4 4.4-3.8 1.6.4 3.8 1.4 4.4 3.8Z" fill="#F2C14E"/>`
    + stroke('M12 11.6v3.6', '#F2C14E', 1) + gloss(9.2, 8, .7, 1.6, -35, .7), { bevel: false })}`
    + `<rect x="4.6" y="2.8" width="14.8" height="3" rx="1.2" fill="#B07A48" ${OUTLINE}/><rect x="4.6" y="18.2" width="14.8" height="3" rx="1.2" fill="#B07A48" ${OUTLINE}/>`;
}
function ball(top: string, extra = ''): string {
  return shape('M3 12a9 9 0 0 1 18 0Z', top, extra)
    + shape('M3 12a9 9 0 0 0 18 0Z', '#F4EEDF')
    + `<path d="M3 12h18" stroke="${VECTOR_INK}" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="#FFF8E5" ${OUTLINE}/><circle cx="12" cy="12" r="1.3" fill="none" stroke="#C9C2B0" stroke-width="1"/>`
    + gloss(8, 7, 1.4, 2.4, 40, .5);
}
const house = (roof: string) => shape('M5 10.6h14V20.4H5Z', '#F2E8D0',
  `<path d="M10.4 14h3.2v6.4h-3.2Z" fill="#7A4F2A"/><path d="M6.6 12.4h2.4v2.4H6.6ZM15 12.4h2.4v2.4H15Z" fill="#7FC6E8"/>`)
  + shape(HOUSE_ROOF, roof);

// ---------- Vector glyphs ----------
const VECTOR_GLYPHS: Record<string, () => string> = {
  // Yields.
  food: () => line('M12 8.2C11.9 6.2 12.4 4.6 13.6 3.4', '#7A4F2A', 1.4)
    + shape('M12 8C8.6 5.6 3.6 7.4 4.3 13.2 4.9 18 8.4 21.2 12 20.2 15.6 21.2 19.1 18 19.7 13.2 20.4 7.4 15.4 5.6 12 8Z', '#6FBF4A', gloss(8.2, 11.6, 1.3, 2.4, 25, .6))
    + shape('M13.2 5.6C14.2 3 17.4 2.2 19.6 3.4 18.6 5.8 15.8 6.9 13.2 5.6Z', '#B6E388', '', { bevel: false }),
  production: () => shape('M3.75 18.55 15.15 8.15 16.85 9.85 5.45 20.25Z', '#C99257', '', { bevel: false })
    + shape('M11.4 4.4Q20.24 4.76 20.6 13.6Q16.35 8.65 11.4 4.4Z', '#E8873A', gloss(16.6, 6.6, .8, 2.2, -45, .6))
    + `<circle cx="16" cy="9" r="1.6" fill="#7E8496" ${OUTLINE}/>`,
  gold: () => shape(COIN, '#F2C14E',
    `<circle cx="12" cy="12" r="5.8" fill="none" stroke="#B7832C" stroke-width="1.3"/><path d="M12 8.6 15.4 12 12 15.4 8.6 12Z" fill="#FFE9A0" stroke="#B7832C" stroke-width="1.1" stroke-linejoin="round"/>`)
    + gloss(8, 7.4, 1.2, 2.2, 40, .55),
  research: () => shape('M10 3.6h4v5.6l5.4 8.4a2.2 2.2 0 0 1-1.9 3.4h-11a2.2 2.2 0 0 1-1.9-3.4L10 9.2Z', '#DFF4FB',
    `<path d="M3 14.2c3.4-1.2 6.2.8 9 0s5.6-1.4 9 .2V22H3Z" fill="#4A9FD4"/><path d="M3 14.2c3.4-1.2 6.2.8 9 0s5.6-1.4 9 .2" fill="none" stroke="#9CD6F2" stroke-width="1.1"/>`
    + `<circle cx="10.6" cy="17.6" r="1.1" fill="#E8F7FF"/><circle cx="13.8" cy="16.4" r=".7" fill="#E8F7FF"/>` + gloss(10.6, 11.4, .6, 1.8, 30, .8), { bevel: false })
    + `<rect x="8.6" y="2.4" width="6.8" height="2.4" rx="1" fill="#CFEFFA" ${OUTLINE}/>`,
  civics: () => shape('M6 5.2h12v13.6H6Z', '#F2E3B8', stroke('M8.6 10.2h6.8M8.6 12.8h6.8M8.6 15.4h4.2', '#8A63C8', 1.4))
    + shape('M4.6 3.6h14.8a1.8 1.8 0 0 1 0 3.6H4.6a1.8 1.8 0 0 1 0-3.6Z', '#C9A86A')
    + shape('M4.6 16.8h14.8a1.8 1.8 0 0 1 0 3.6H4.6a1.8 1.8 0 0 1 0-3.6Z', '#C9A86A'),
  faith: () => shape('M12 2.8C14.8 5.8 16.6 8 16.2 10.6 15.9 12.6 14.2 13.6 12 13.6 9.8 13.6 8.1 12.6 7.8 10.6 7.6 8.8 8.8 7.4 9.8 6.6 10 8.2 10.8 9 11.6 9.2 11 7 11.4 4.8 12 2.8Z', '#F2A93B',
    '<path d="M12 7.6C13.4 9.2 14 10.4 13.6 11.6 13.3 12.4 12.7 12.8 12 12.8 11.3 12.8 10.6 12.4 10.5 11.5 10.3 10.4 11.2 9.2 12 7.6Z" fill="#FFE680"/>', { bevel: false })
    + shape('M9 18.6h6l1.2 2.8H7.8Z', '#8C7650', '', { bevel: false })
    + shape('M3.6 13.6h16.8c-.4 3.6-3.6 5.8-8.4 5.8s-8-2.2-8.4-5.8Z', '#C9B48A'),
  /** 满意度 and the 宝可梦嘉年华 festival project: a beaming face with blush and two festival sparkles. */
  satisfaction: () => shape(circle(12, 12.6, 8.6), '#F7D25C',
    `<ellipse cx="7.2" cy="14.4" rx="1.7" ry="1.1" fill="#F08A70" opacity=".75"/><ellipse cx="16.8" cy="14.4" rx="1.7" ry="1.1" fill="#F08A70" opacity=".75"/>`)
    + stroke('M7.6 11.2q1.5-1.8 3 0M13.4 11.2q1.5-1.8 3 0', VECTOR_INK, 1.5)
    + `<path d="M8.6 14.2q3.4 4.4 6.8 0Z" fill="#9A3A2A" ${OUTLINE}/>`
    + `<g transform="translate(19.4 4.6) scale(.34) translate(-12 -10)">${shape(SPARKLE, '#FFF0A8', '', { bevel: false })}</g>`
    + `<g transform="translate(4.4 4.2) scale(.26) translate(-12 -10)">${shape(SPARKLE, '#F7A8C8', '', { bevel: false })}</g>`,
  turns: hourglass,
  rush: () => hourglass() + shape('M20 10.2 14.6 17.2h3.2l-1.6 5.4 6-7.6h-3.4l2.2-4.8Z', '#FFE066', '', { bevel: false }),
  clipboard: () => shape('M5.2 4.4h13.6a1.2 1.2 0 0 1 1.2 1.2v14.8a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 20.4V5.6a1.2 1.2 0 0 1 1.2-1.2Z', '#B07A48')
    + shape('M6.8 7h10.4v12.6H6.8Z', '#F7EED8', stroke('M8.8 10.6h6.4M8.8 13.2h6.4M8.8 15.8h3.8', '#7A5626', 1.3), { bevel: false })
    + shape('M9.2 2.6h5.6a1 1 0 0 1 1 1v2.6H8.2V3.6a1 1 0 0 1 1-1Z', '#C9D2D6'),
  // Balls.
  pokeBall: () => ball('#E0483A'),
  greatBall: () => ball('#4A7FD8', stroke('M5.6 9.2 8.4 6M18.4 9.2 15.6 6', '#E0483A', 2.2)),
  masterBall: () => ball('#8B4FC2', '<circle cx="7.6" cy="8.4" r="1.6" fill="#F07AB0"/><circle cx="16.4" cy="8.4" r="1.6" fill="#F07AB0"/>'),
  // Unit stats.
  /** Three claw slashes, each a tapered crescent. */
  attack: () => [[0, 1.6], [4.6, .2], [9.2, -1.2]]
    .map(([x, y]) => flat(`M${2 + x} ${3 + y}Q${10 + x} ${8 + y} ${12.5 + x} ${19 + y}Q${5 + x} ${12.5 + y} ${2 + x} ${3 + y}Z`, '#F08A4B')).join(''),
  defense: () => shape('M12 2.8 20 5.6V11c0 5.2-3.4 8.6-8 10.4C7.4 19.6 4 16.2 4 11V5.6Z', '#6FA5EE',
    stroke('M8 9.4 12 12.2 16 9.4M8 13.4 12 16.2 16 13.4', '#EAF2FF', 1.6)),
  move: () => shape('M7 3h6v8.2l5.6 3.2c1.4.8 2 1.8 2 3.4V20H5.2v-6.4c0-1.4.6-2.6 1.8-3.6Z', '#B07A48', gloss(9, 8, .8, 2.4, 0, .45))
    + shape('M4.4 19.2h16.4v2.4H4.4Z', '#5E3E22', '', { bevel: false })
    + shape('M6.6 2.8h6.8v2.8H6.6Z', '#F2E8D0', '', { bevel: false }),
  range: () => shape(circle(12, 12, 9), '#E0483A',
    `<circle cx="12" cy="12" r="6.1" fill="#F7EED8" stroke="${VECTOR_INK}" stroke-width="1"/><circle cx="12" cy="12" r="3.2" fill="#E0483A" stroke="${VECTOR_INK}" stroke-width="1"/>`),
  heart: () => shape(HEART, '#E0483A', gloss(7.6, 8.4, 1.3, 2.2, 40, .55)),
  medicine: () => shape(HEART, '#E0483A', `<path d="M10.6 7.8h2.8v2.8h2.8v2.8h-2.8v2.8h-2.8v-2.8H7.8v-2.8h2.8Z" fill="${CREAM}" stroke="${dark('#E0483A', .5)}" stroke-width="1"/>`),
  shield: () => shape('M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3Z', '#F0709A', stroke('M12 6 17.2 9v6L12 18 6.8 15V9Z', '#FFD0E0', 1)),
  swords: () => {
    const blade = '<path d="M3.4 3.4 6.4 3.6 16.4 13.6 13.6 16.4 3.6 6.4Z" fill="#E6EBEF" ' + OUTLINE + '/>' + stroke('M5 5 14.4 14.4', '#A9B4BC', 1)
      + '<path d="M12.6 18.4 18.4 12.6 19.8 14 14 19.8Z" fill="#E0B24A" ' + OUTLINE + '/>' + line('M16.8 17 19.6 19.8', '#9A6A3E', 1.8);
    return blade + `<g transform="matrix(-1 0 0 1 24 0)">${blade}</g>`;
  },
  // Achievement and state.
  trophy: () => line('M6.2 5.4H4v1.6c0 2.2 1.6 3.6 3.6 3.8M17.8 5.4H20v1.6c0 2.2-1.6 3.6-3.6 3.8', '#E0B24A', 1.4)
    + shape('M10.6 13.4h2.8v4.2h-2.8Z', '#D9A93A', '', { bevel: false })
    + shape('M6 3h12v4.6c0 3.6-2.6 6.4-6 6.4S6 11.2 6 7.6Z', '#F2C14E', gloss(9, 6.6, .9, 2.4, 0, .6))
    + `<rect x="6.6" y="17.4" width="10.8" height="3.6" rx="1" fill="#8A6D3B" ${OUTLINE}/>`,
  star: () => shape(STAR, '#F7D25C'),
  check: () => line('M5 12.6l4.4 4.4L19 7.4', '#6BD08A', 3),
  lock: () => line('M8 10.6V7.6a4 4 0 0 1 8 0v3', '#C9D2D6', 2.2)
    + shape('M6.4 10.4h11.2a1.6 1.6 0 0 1 1.6 1.6v7.4a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V12a1.6 1.6 0 0 1 1.6-1.6Z', '#D7A63C',
      `<circle cx="12" cy="14.4" r="1.5" fill="${VECTOR_INK}"/><path d="M11.3 15h1.4l.4 3h-2.2Z" fill="${VECTOR_INK}"/>`),
  play: () => shape('M7 4.6 19.4 12 7 19.4Z', '#6FC0F0'),
  effect: () => shape(SPARKLE, '#F7D25C') + `<g transform="translate(17.6 17.8) scale(.42) translate(-12 -10)">${shape(SPARKLE, '#FFF0A8', '', { bevel: false })}</g>`,
  /** A star in a laurel wreath. */
  eraScore: () => line('M7 20.4C3.4 17.6 2.6 12.4 4.8 7.6M17 20.4c3.6-2.8 4.4-8 2.2-12.8', '#5E9A44', 1)
    + [[3.6, 16.4, -50], [3.1, 12.4, -80], [4.2, 8.6, -110]].map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="2.1" ry="1.1" fill="#8CCB62" stroke="${VECTOR_INK}" stroke-width="1" transform="rotate(${a} ${x} ${y})"/>`
      + `<ellipse cx="${24 - x}" cy="${y}" rx="2.1" ry="1.1" fill="#8CCB62" stroke="${VECTOR_INK}" stroke-width="1" transform="rotate(${-a} ${24 - x} ${y})"/>`).join('')
    + `<g transform="translate(12 12.6) scale(.72) translate(-12 -12)">${shape(STAR, '#F7D25C')}</g>`,
  badge: () => shape('M8.6 12.6 6 21.2l3-1.4 2 2.4 1.6-7.2Z', '#3FA796', '', { bevel: false })
    + shape('M15.4 12.6 18 21.2l-3-1.4-2 2.4-1.6-7.2Z', '#D9495B', '', { bevel: false })
    + shape(circle(12, 9.4, 6.6), '#F7D25C', `<path d="M12 6.2 15 9.4 12 12.6 9 9.4Z" fill="#D9495B" stroke="${dark('#F7D25C', .45)}" stroke-width="1"/>`),
  pokedex: () => shape('M5.6 2.8h12.8a1.6 1.6 0 0 1 1.6 1.6v15.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.6V4.4a1.6 1.6 0 0 1 1.6-1.6Z', '#E0483A',
    stroke('M4 8.4h16', dark('#E0483A', .4), 1))
    + `<rect x="6.6" y="10.4" width="10.8" height="7.8" rx="1" fill="#9FE0C0" ${OUTLINE}/>` + stroke('M8.4 13h4.4M8.4 15.4h6.6', '#3F8A5A', 1.2)
    + `<circle cx="8.4" cy="5.8" r="1.7" fill="#5BB6E8" ${OUTLINE}/><circle cx="12.4" cy="5.8" r=".8" fill="#F7D25C"/><circle cx="14.8" cy="5.8" r=".8" fill="#6BD08A"/>`,
  map: () => shape('M3 6 8.6 4l6.8 2 5.6-2v14l-5.6 2-6.8-2L3 20Z', '#F2E3B8',
    `<path d="M3 6 8.6 4v14L3 20Z" fill="#7FC6E8" opacity=".75"/>` + stroke('M8.6 4v14M15.4 6v14', '#C9A86A', 1.1)
    + stroke('M6 15.4c2-2.6 4-.8 5.8-3.4s3-2 4.6-4.4', '#D9495B', 1.4, ' stroke-dasharray="1.6 1.8"') + stroke('M16.2 6.6l2 2M18.2 6.6l-2 2', '#D9495B', 1.4)),
  // Unlock kinds.
  building: () => house('#D9534F'),
  unit: () => [circle(5.8, 10, 2), circle(9.6, 6, 2.1), circle(14.4, 6, 2.1), circle(18.2, 10, 2)].map(d => shape(d, '#E8B07A', '', { bevel: false })).join('')
    + shape('M12 11.4c3 0 5.6 2.6 5.6 5.2 0 2.2-1.8 3.4-3.4 3.4-1 0-1.4-.6-2.2-.6s-1.2.6-2.2.6c-1.6 0-3.4-1.2-3.4-3.4 0-2.6 2.6-5.2 5.6-5.2Z', '#E8B07A'),
  district: () => shape('M2.6 17.4 12 13.6l9.4 3.8L12 21.4Z', '#7BC85A', '', { bevel: false })
    + shape('M13.6 7.6h5.2v10.2l-2.6 1-2.6-1Z', '#F2E8D0', '<path d="M15.2 10h2v2h-2Z" fill="#7FC6E8"/>') + shape('M12.8 8 16.2 3.6 19.6 8Z', '#4A9FD4', '', { bevel: false })
    + shape('M4.8 11.4h5.6v6.8L7.6 19.4l-2.8-1.2Z', '#F2E8D0', '<path d="M6.6 13.4h2v2h-2Z" fill="#7FC6E8"/>') + shape('M4 11.6 7.6 8.2l3.6 3.4Z', '#D9534F', '', { bevel: false }),
  improvement: () => shape('M3 14h18v5.4a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 19.4Z', '#B07A48', stroke('M3 17.2h18', '#7A4F2A', 1.2))
    + line('M12 14V8.6', '#3F8A33', 1.4)
    + shape('M12 10C9.4 10.2 7.4 8.6 7 6c2.6-.2 4.6 1.4 5 4Z', '#7BC85A', '', { bevel: false })
    + shape('M12 8.8c.6-2.6 2.6-4 5-3.8-.2 2.6-2.4 4.2-5 3.8Z', '#7BC85A', '', { bevel: false }),
  wonder: () => shape('M8.8 6.6h6.4l1 12.4H7.8Z', '#E8DCC0', stroke('M10.8 8.4v9M13.2 8.4v9', '#A8946C', 1))
    + `<rect x="7" y="4.8" width="10" height="2.2" rx=".8" fill="#D7C79E" ${OUTLINE}/><rect x="5" y="18.8" width="14" height="2.6" rx=".8" fill="#C9B48A" ${OUTLINE}/>`
    + shape('M12 1.4l2 2.4-2 1.4-2-1.4Z', '#F7D25C', '', { bevel: false }),
  policyCard: () => shape('M7 3h10a1.6 1.6 0 0 1 1.6 1.6v14.8A1.6 1.6 0 0 1 17 21H7a1.6 1.6 0 0 1-1.6-1.6V4.6A1.6 1.6 0 0 1 7 3Z', '#F2E3B8',
    '<path d="M4 3h16v4.2H4Z" fill="#8A63C8"/>' + stroke('M8 10.4h8M8 13h5.4', '#7A5626', 1.2))
    + `<circle cx="14.6" cy="16.6" r="2.4" fill="#E0A030" ${OUTLINE}/>`,
  construction: () => shape('M10.4 3.4h3.2l4.6 15H5.8Z', '#F2A93B', '<path d="M4 8.6h16v2.4H4ZM4 13h16v2.6H4Z" fill="#FFF3DC"/>')
    + `<rect x="3.6" y="17.8" width="16.8" height="3.2" rx="1" fill="#6B5444" ${OUTLINE}/>`,
  // Items and tools.
  training: () => line('M7.4 12h9.2', '#BFC3D6', 2)
    + `<rect x="2.8" y="7.2" width="4.4" height="9.6" rx="1.2" fill="#5A6A80" ${OUTLINE}/><rect x="16.8" y="7.2" width="4.4" height="9.6" rx="1.2" fill="#5A6A80" ${OUTLINE}/>`
    + `<rect x="7" y="9" width="2" height="6" rx=".6" fill="#7E8EA6" ${OUTLINE}/><rect x="15" y="9" width="2" height="6" rx=".6" fill="#7E8EA6" ${OUTLINE}/>`,
  tm: () => shape(circle(12, 12, 9), '#9AA7C8', stroke('M6.2 8.2a7 7 0 0 1 4-3.4', '#FFFFFF', 1.2, ' opacity=".7"'))
    + `<circle cx="12" cy="12" r="3.8" fill="#E3C34F" ${OUTLINE}/><circle cx="12" cy="12" r="1.3" fill="${VECTOR_INK}"/>`,
  egg: () => shape('M12 2.8c3.8 0 6.8 6 6.8 10.4 0 4.6-3 7.8-6.8 7.8s-6.8-3.2-6.8-7.8C5.2 8.8 8.2 2.8 12 2.8Z', '#FBF4E2',
    '<circle cx="9.4" cy="10" r="1.8" fill="#6FBF4A"/><circle cx="15" cy="14.4" r="2.2" fill="#6FBF4A"/><circle cx="10.4" cy="17.6" r="1.3" fill="#6FBF4A"/>'),
  ribbon: () => shape('M9.6 13 7 21.4l2.8-1.4 1.8 2.2 1.4-7.2Z', '#B8487E', '', { bevel: false })
    + shape('M14.4 13 17 21.4l-2.8-1.4-1.8 2.2-1.4-7.2Z', '#B8487E', '', { bevel: false })
    + shape(rosette(12, 9.4, 7, .9, 9), '#F07AB0') + `<circle cx="12" cy="9.4" r="3.2" fill="#F7D25C" ${OUTLINE}/>`,
  // Orders and places.
  locate: () => `<circle cx="12" cy="12" r="6.6" fill="none" stroke="${VECTOR_INK}" stroke-width="4"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#F2C14E" stroke-width="1.8"/>`
    + line('M12 2.4v4.2M12 17.4v4.2M2.4 12h4.2M17.4 12h4.2', '#F2C14E', 1.8) + `<circle cx="12" cy="12" r="1.8" fill="${CREAM}" ${OUTLINE}/>`,
  goTo: () => stroke('M3 20.6c3-.4 5.4-1.8 8-3.4', CREAM, 1.6, ' stroke-dasharray="1.4 2"')
    + line('M12.6 3v17.6', '#C9A86A', 1.6) + shape('M13.4 3.4h7.4l-2 3.2 2 3.2h-7.4Z', '#4FB0E0'),
  sitePin: () => shape(PIN, '#F2A93B') + `<circle cx="12" cy="9.4" r="2.8" fill="${CREAM}" ${OUTLINE}/>`,
  flag: () => flagSvg('#E6B85C'),
};

function flagSvg(color: string): string {
  return line('M5.6 2.6v19', '#9A6A3E', 1.6) + shape(FLAG, color);
}

// ---------- Badges: types, gyms, classes, HMs ----------
const TYPE_SYMBOL: Record<TypeId, string> = {
  normal: `<path d="${circle(12, 12, 7.6)}${circle(12, 12, 3.6)}" fill-rule="evenodd"/>`,
  fire: '<path d="M12 2C15.6 6 19 9.6 19 14a7 7 0 0 1-14 0c0-2.6 1.4-4.6 3-6 .2 2 1 3.4 2.4 4C10 9 10.6 5.4 12 2Z"/>',
  water: '<path d="M12 2.4C15.4 7.4 18.6 11 18.6 14.6a6.6 6.6 0 0 1-13.2 0C5.4 11 8.6 7.4 12 2.4Z"/>',
  electric: '<path d="M14 2 5.6 13.4h5.6L9.6 22l8.8-12h-5.8Z"/>',
  grass: '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16Z"/><path d="M5.6 18.4 14.6 9.4" fill="none" stroke="{d}" stroke-width="1.8" stroke-linecap="round"/>',
  ice: '<path d="M12 2.6v18.8M3.9 7.3l16.2 9.4M3.9 16.7l16.2-9.4" fill="none" stroke="{s}" stroke-width="3" stroke-linecap="round"/>',
  fighting: '<path d="M5.6 9.6c0-1.6 1.2-2.8 2.8-2.8h8.2c1.6 0 2.8 1.2 2.8 2.8v5c0 3.4-2.6 5.8-5.8 5.8H11c-3 0-5.4-2.4-5.4-5.4Z"/><path d="M9.8 7v3.6M13.2 7v3.6M16.6 7v3.6M5.8 13h5.6" fill="none" stroke="{d}" stroke-width="1.6" stroke-linecap="round"/>',
  poison: `<path d="${circle(9, 15, 5.2)}"/><path d="${circle(16.2, 7.6, 3.8)}"/><path d="${circle(18, 17.4, 2.2)}"/>`,
  ground: '<path d="M2.4 19.6 9.2 6.8l3.6 5.4 2.4-3.4 6.4 10.8Z"/><path d="M6.4 15.2h6.4M10.6 18h6" fill="none" stroke="{d}" stroke-width="1.6" stroke-linecap="round"/>',
  flying: `<path d="${WING}"/>`,
  psychic: '<path d="M2.4 12C5.2 7 8.6 5.2 12 5.2S18.8 7 21.6 12c-2.8 5-6.2 6.8-9.6 6.8S5.2 17 2.4 12Z"/><circle cx="12" cy="12" r="3.4" fill="{d}"/>',
  bug: '<path d="M8.6 4.4 10.4 7M15.4 4.4 13.6 7" fill="none" stroke="{s}" stroke-width="2" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="6" ry="7.2"/><circle cx="12" cy="7.2" r="2.8"/><path d="M12 8.6v12.2" fill="none" stroke="{d}" stroke-width="1.6"/>',
  rock: '<path d="M7.4 4.4 15.8 3.2 20.8 9.6 18.6 18.8 8.2 20.8 3.2 13Z"/><path d="M7.4 4.4 10 11l-6.8 2M10 11l8.6 7.8M10 11l10.8-1.4" fill="none" stroke="{d}" stroke-width="1.3" stroke-linejoin="round"/>',
  ghost: '<path d="M4.6 21V11a7.4 7.4 0 0 1 14.8 0v10l-2.5-1.9-2.5 1.9-2.4-1.9-2.4 1.9-2.5-1.9Z"/><ellipse cx="9.4" cy="11.4" rx="1.4" ry="2" fill="{d}"/><ellipse cx="14.6" cy="11.4" rx="1.4" ry="2" fill="{d}"/>',
  dragon: '<path d="M3 3.4c1.4 6 4.6 9.6 9 9.6s7.6-3.6 9-9.6c-2.4 3.4-5.4 5-9 5s-6.6-1.6-9-5Z"/><path d="M12 11.6 8.6 21.4 12 19l3.4 2.4Z"/>',
  dark: '<path d="M15.2 2.8a9.4 9.4 0 1 0 6.2 15.6A7.6 7.6 0 0 1 15.2 2.8Z"/>',
  steel: `<path d="M12 2.4l8.4 4.8v9.6L12 21.6l-8.4-4.8V7.2Z${circle(12, 12, 3.6)}" fill-rule="evenodd"/>`,
  fairy: `<path d="${SPARKLE}" transform="translate(0 1)"/>`,
};
const CLASS_SYMBOL: Record<UnitClass, string> = {
  melee: '<path d="M12 2.4 14 5v9.8h-4V5Z"/><path d="M7.2 14.6h9.6v2.6H7.2Z"/><path d="M10.8 17.2h2.4v4.4h-2.4Z"/>',
  ranged: '<path d="M4.6 19.4 17.4 6.6" fill="none" stroke="{s}" stroke-width="2.6" stroke-linecap="round"/><path d="M20.4 3.6 19 10.4 13.6 5Z"/><path d="M3 15.4 8.6 21 6 21.6 2.4 18Z"/>',
  fast: '<path d="M3.4 5.4 10 12l-6.6 6.6M12.4 5.4 19 12l-6.6 6.6" fill="none" stroke="{s}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  scout: `<path d="${circle(7.4, 14.6, 4.6)}${circle(16.6, 14.6, 4.6)}"/><path d="M5.2 4.6h4.6v8H5.2ZM14.2 4.6h4.6v8h-4.6ZM9.8 9.4h4.4v3.6H9.8Z"/><path d="${circle(7.4, 14.6, 2)}${circle(16.6, 14.6, 2)}" fill="{d}"/>`,
  siege: '<path d="M9.6 6.4 16.8 5.2 21.2 10.6 19.4 18.4 10.4 20.2 6 13.6Z"/><path d="M9.6 6.4 12 12.2 6 13.6M12 12.2l7.4 6.2M12 12.2l9.2-1.6" fill="none" stroke="{d}" stroke-width="1.3" stroke-linejoin="round"/><path d="M1.6 8.4h3.4M1 12.4h3M1.6 16.4h3.4" fill="none" stroke="{s}" stroke-width="2" stroke-linecap="round"/>',
  air: `<path d="${WING}"/>`,
  naval: '<path d="M2 9.4c2.5-3 5-3 7.5 0s5 3 7.5 0 5-3 5 0M2 16.4c2.5-3 5-3 7.5 0s5 3 7.5 0 5-3 5 0" fill="none" stroke="{s}" stroke-width="3" stroke-linecap="round"/>',
};
const HM_VECTOR_SYMBOL = { surf: CLASS_SYMBOL.naval, strength: TYPE_SYMBOL.fighting, ride: '<path d="M4.6 20V11a7.4 7.4 0 0 1 14.8 0v9h-3.6v-8.6a3.8 3.8 0 0 0-7.6 0V20Z"/>', fly: CLASS_SYMBOL.air } as const;

const FRAMES = {
  type: 'M7.4 2.6h9.2a4.8 4.8 0 0 1 4.8 4.8v9.2a4.8 4.8 0 0 1-4.8 4.8H7.4a4.8 4.8 0 0 1-4.8-4.8V7.4a4.8 4.8 0 0 1 4.8-4.8Z',
  gym: 'M8.2 2.4h7.6l5.8 5.8v7.6l-5.8 5.8H8.2l-5.8-5.8V8.2Z',
  class: 'M12 2.2 20.8 5.2v6.2c0 5.4-3.6 8.8-8.8 10.6-5.2-1.8-8.8-5.2-8.8-10.6V5.2Z',
  hm: circle(12, 12, 9.6),
} as const;
/** An enamel badge: the frame in `color`, a cream symbol (outlined in the badge's dark shade) scaled into its centre. */
function badgeSvg(frame: keyof typeof FRAMES, color: string, symbol: string, scale = .6): string {
  const deep = dark(color, .55);
  // Casing layer: the symbol in the dark shade, every stroke 3.6 units wider; then the cream symbol with dark details on top.
  const casing = symbol.replace(/\{[sd]\}/g, deep).replace(/stroke-width="([\d.]+)"/g, (_, width: string) => `stroke-width="${Number(width) + 3.6}"`);
  const face = symbol.replace(/\{s\}/g, CREAM).replace(/\{d\}/g, deep);
  const art = `<g transform="translate(12 ${frame === 'class' ? 11.4 : 12}) scale(${scale}) translate(-12 -12)">`
    + `<g fill="${deep}" stroke="${deep}" stroke-width="3.6" stroke-linejoin="round">${casing}</g><g fill="${CREAM}">${face}</g></g>`;
  return shape(FRAMES[frame], color, gloss(7.4, 6.4, 1.2, 3, 45, .35)) + art;
}

/** A crystal essence in its own colour. */
function essenceSvg(color: string): string {
  return shape('M12 2.4 18.8 9.4 12 21.6 5.2 9.4Z', color,
    `<path d="M12 2.4 9.4 9.4 12 21.6 14.6 9.4Z" fill="#FFFFFF" opacity=".28"/>` + stroke('M5.2 9.4h13.6', dark(color, .45), 1) + gloss(9.4, 6.6, .7, 1.8, 40, .7));
}

// ---------- Unit action bar (src/browser/unit-action-bar.ts icon names) ----------
const ACTIONS: Record<string, () => string> = {
  move: () => shape('M3 9.4h9.4V5l8.6 7-8.6 7v-4.4H3Z', '#72C99E'),
  attack: () => `<g transform="rotate(45 12 12)">${shape('M10.6 2.4h2.8l.6 12.4h-4Z', '#E6EBEF', '', { bevel: false })}${stroke('M12 4v10', '#A9B4BC', 1)}`
    + `<rect x="7" y="14.4" width="10" height="2.4" rx="1" fill="#E6B85C" ${OUTLINE}/><rect x="10.8" y="16.8" width="2.4" height="4.8" rx="1" fill="#9A6A3E" ${OUTLINE}/></g>`,
  capture: () => ball('#D3655C'),
  evolve: () => shape(SPARKLE, '#9CD6F2') + `<g transform="translate(18 17.6) scale(.4) translate(-12 -10)">${shape(SPARKLE, '#E8F7FF', '', { bevel: false })}</g>`,
  found: () => house('#D3655C'),
  improve: () => line('M6 20 14.4 11.6', '#A0703A', 1.8) + shape('M10.4 3.6 15.4 3l5.6 5.6-.6 5-3.6-3.6-3 3-3.4-3.4 3-3Z', '#B3C2BA'),
  pillage: () => shape('M12 2.6l2.2 5.2 5.6-1.6-2.2 5.2 4.2 3.6-5.6.8.6 5.8L12 18l-4.8 3.6.6-5.8-5.6-.8 4.2-3.6-2.2-5.2 5.6 1.6Z', '#E0483A',
    '<path d="M12 7.6l1.2 2.8 3-.8-1.2 2.8 2.2 2-3 .4.4 3.2-2.6-2-2.6 2 .4-3.2-3-.4 2.2-2-1.2-2.8 3 .8Z" fill="#F2A93B"/>'),
  /** A spanner: open jaw up and right, wooden grip. */
  repair: () => line('M4.8 19.6 13.2 11.2', '#A0703A', 2.4) + shape('M15.4 2.7A5 5 0 1 0 21.3 8.6L18.2 8.6 15.4 5.8Z', '#B3C2BA'),
  gym: () => shape('M4.6 9.6h14.8v10.8H4.6Z', '#D8C9A2', '<path d="M10.6 14h2.8v6.4h-2.8Z" fill="#7A4F2A"/><path d="M6.4 12.4h2.4v2.4H6.4ZM15.2 12.4h2.4v2.4h-2.4Z" fill="#7FC6E8"/>')
    + shape('M2.6 10 12 3.4 21.4 10Z', '#D9495B', `<path d="${circle(12, 9.2, 1.8)}" fill="${CREAM}"/>`),
  skip: () => line('M4 5.6 10.4 12 4 18.4M12.4 5.6 18.8 12l-6.4 6.4', CREAM, 2.2),
};

// ---------- Vector registry ----------
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" class="vector-icon" viewBox="0 0 24 24">${body}</svg>`;
const toUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

function vectorBody(name: string): string | null {
  const [family, id] = name.includes(':') ? name.split(':') as [string, string] : ['', name];
  if (family === 'type' && Object.hasOwn(TYPE_SYMBOL, id)) return badgeSvg('type', TYPE_COLORS[id as TypeId], TYPE_SYMBOL[id as TypeId]);
  if (family === 'gym' && Object.hasOwn(TYPE_SYMBOL, id)) return badgeSvg('gym', TYPE_COLORS[id as TypeId], TYPE_SYMBOL[id as TypeId], .56);
  if (family === 'class' && Object.hasOwn(CLASS_SYMBOL, id)) return badgeSvg('class', CLASS_COLORS[id as UnitClass], CLASS_SYMBOL[id as UnitClass], .54);
  if (family === 'hm' && Object.hasOwn(HM_VECTOR_SYMBOL, id)) return badgeSvg('hm', HM_COLORS[id as HmId], HM_VECTOR_SYMBOL[id as HmId], .56);
  if (family === 'essence' && Object.hasOwn(ESSENCES, id)) return essenceSvg(ESSENCES[id as EssenceId].color);
  if (family === 'action' && Object.hasOwn(ACTIONS, id)) return ACTIONS[id]();
  if (family === '' && id === 'essence') return essenceSvg('#9C7AD8');
  if (family === '' && Object.hasOwn(VECTOR_GLYPHS, id)) return VECTOR_GLYPHS[id]();
  return null;
}

const vectorUrls = new Map<string, string | null>();
/** Cached data URL of the vector version of a kit icon (or an `action:*` bar icon), or null when it has none. */
export function vectorIconUrl(name: string): string | null {
  if (vectorUrls.has(name)) return vectorUrls.get(name)!;
  clipSeq = 0;
  const body = vectorBody(name), url = body === null ? null : toUrl(wrap(body));
  vectorUrls.set(name, url);
  return url;
}
const vectorFlagUrls = new Map<string, string>();
/** A civilization banner in its colour. */
export function vectorFlagUrl(color: string): string {
  let url = vectorFlagUrls.get(color);
  if (!url) { clipSeq = 0; url = toUrl(wrap(flagSvg(color))); vectorFlagUrls.set(color, url); }
  return url;
}

/** Names that have a vector version (for tests and the contact sheet). */
export const VECTOR_ICON_NAMES: readonly string[] = [
  ...Object.keys(VECTOR_GLYPHS), 'essence',
  ...(Object.keys(TYPE_SYMBOL) as TypeId[]).flatMap(id => [`type:${id}`, `gym:${id}`]),
  ...(Object.keys(CLASS_SYMBOL) as UnitClass[]).map(id => `class:${id}`),
  ...Object.keys(HM_VECTOR_SYMBOL).map(id => `hm:${id}`),
  ...(Object.keys(ESSENCES) as EssenceId[]).map(id => `essence:${id}`),
  ...Object.keys(ACTIONS).map(id => `action:${id}`),
];

// ---------- Style: pixel grids (flat / 2.5D) or the painted theme's vector set ----------
export type IconStyle = 'pixel' | 'vector';
let style: IconStyle = 'pixel';
/** The 绘卷 theme switches the kit to its smooth vector set (above); names without one stay pixel. */
export function setIconStyle(next: IconStyle): void { style = next; }
export const iconStyle = (): IconStyle => style;
/** The vector data URL of `name` while the vector style is on, else null. */
const vectorOf = (name: string): string | null => style === 'vector' ? vectorIconUrl(name) : null;

const urls = new Map<string, string>();
/** Cached data URL of an icon: the vector version in the vector style when there is one, else the pixel grid (one rect per run). */
export function iconUrl(name: UiIconName): string {
  const vector = vectorOf(name);
  if (vector) return vector;
  let url = urls.get(name);
  if (url) return url;
  url = gridUrl(gridOf(name));
  urls.set(name, url);
  return url;
}
/** SVG data URL of any palette grid (one rect per horizontal run, crisp edges): recoloured icons, scene art. */
export function gridUrl({ rows, palette }: Readonly<Grid>): string {
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const cell = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === cell) end++;
      if (cell !== '.') rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${palette[cell] ?? '#FF00FF'}"/>`;
      x = end;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const escapeAttr = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

type IconOptions = { size?: number; label?: string; className?: string };
const accessibleName = (label?: string) => label ? `alt="${escapeAttr(label)}" title="${escapeAttr(label)}"` : 'alt="" aria-hidden="true"';
const devicePixelRatioNow = () => (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1;
const cssPx = (value: number) => String(Math.round(value * 1000) / 1000);
/**
 * Pixel icons draw each grid cell as a whole number of device pixels: the cell is `max(1, round(size × dpr / side))` device
 * pixels, so the CSS box is `cell × columns / dpr` wide (12 cells asked at 16 px: 12 px at DPR 1, 18 px at DPR 2).
 */
export function pixelIconBox(columns: number, rows: number, size: number, dpr = devicePixelRatioNow()): { width: number; height: number } {
  const cell = Math.max(1, Math.round(size * dpr / Math.max(columns, rows)));
  return { width: cell * columns / dpr, height: cell * rows / dpr };
}
/**
 * `<img>` markup for a kit icon. With a `label` the image is named (alt + title); without one it is decorative
 * (aria-hidden), for icons that sit next to text that already says the same thing. In the vector style an icon with a
 * vector version is a smooth `vec-icon` of exactly `size`; pixel icons snap to whole device pixels per cell.
 */
export function uiIcon(name: UiIconName, { size = 24, label, className = '' }: IconOptions = {}): string {
  const extra = className ? ` ${className}` : '';
  const vector = vectorOf(name);
  if (vector) return `<img class="px-icon vec-icon${extra}" src="${vector}" width="${size}" height="${size}" ${accessibleName(label)} draggable="false">`;
  const grid = gridOf(name), box = pixelIconBox(grid.rows[0].length, grid.rows.length, size);
  return `<img class="px-icon${extra}" src="${iconUrl(name)}" width="${cssPx(box.width)}" height="${cssPx(box.height)}" ${accessibleName(label)} draggable="false">`;
}

/** An image file (species sprite, building SVG) in the same named-or-decorative form. */
export function artImage(src: string, { size = 24, label, className = '' }: IconOptions = {}): string {
  // Pixel sprites draw at a whole device-pixel scale, centred so the layout box stays `size` (artFit above).
  const fit = artFit(src, size);
  return `<img class="px-art ${fit.pixelated ? 'px-art-pixel' : 'px-art-smooth'}${className ? ` ${className}` : ''}" src="${src}" width="${cssPx(fit.size)}" height="${cssPx(fit.size)}"${fit.inset ? ` style="margin:${cssPx(fit.inset)}px"` : ''} ${accessibleName(label)} loading="lazy" draggable="false">`;
}

/** A compact "icon + number" stat: the number stays visible text, the icon names what it counts. */
export function statChip(name: UiIconName, value: string | number, label: string, className = ''): string {
  return `<span class="icon-stat${className ? ` ${className}` : ''}" title="${escapeAttr(`${label} ${value}`)}" aria-label="${escapeAttr(`${label} ${value}`)}" role="img">${uiIcon(name, { size: 16 })}<b aria-hidden="true">${value}</b></span>`;
}

/** Type badge with its Chinese name as the accessible name. */
export const typeBadge = (type: TypeId, size = 20, label = `${TYPE_NAMES[type]}属性`) => uiIcon(`type:${type}`, { size, label, className: 'type-badge' });

const flagUrls = new Map<string, string>();
/** A civilization's banner (the `flag` icon in its colour), named like `uiIcon`. */
export function flagImage(color: string, { size = 24, label, className = '' }: IconOptions = {}): string {
  const extra = className ? ` ${className}` : '';
  if (style === 'vector') return `<img class="px-icon vec-icon${extra}" src="${vectorFlagUrl(color)}" width="${size}" height="${size}" ${accessibleName(label)} draggable="false">`;
  const grid = gridOf('flag');
  let url = flagUrls.get(color);
  if (!url) { url = gridUrl({ rows: grid.rows, palette: { ...grid.palette, F: color } }); flagUrls.set(color, url); }
  const box = pixelIconBox(grid.rows[0].length, grid.rows.length, size);
  return `<img class="px-icon${extra}" src="${url}" width="${cssPx(box.width)}" height="${cssPx(box.height)}" ${accessibleName(label)} draggable="false">`;
}
