// Shared pixel icon kit for DOM panels (docs/design/ui-icons/README.md). Every icon is a palette grid in the same
// hard-edged GBA-like style as the map icons (src/browser/map-icons.ts, which it reuses); grids are rendered once into
// cached SVG data URLs, so the kit is plain strings: it needs no canvas and works in Node tests. All art here is
// original: badges are framed programmatically, glyphs are hand-placed fills that receive an automatic dark outline.
// Icon-only markup always carries an accessible name (alt / aria-label + title).
import { mapIconGrid, MAP_ICON_NAMES } from './map-icons.ts';
import type { IconName } from './map-icons.ts';
import { TYPE_COLORS } from '../content/type-colors.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { TypeId } from '../content/species.ts';
import type { UnitClass } from '../content/unit-classes.ts';
import { ESSENCES } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
// Styles live in src/ui-icons.css, imported by the browser modules (ui-tip.ts) so this kit stays importable from Node.

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
const TYPE_SYMBOLS: Record<TypeId, readonly string[]> = {
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
  trainer: glyph(['..RRRRR...', '.RRWRRRR..', '.RRRRRRRRR', '..SSSSSS..', '..SkSSkS..', '..SSSSSS..', '...SSSS...', '..BBBBBB..', '.BBBBBBBB.', '.BBBBBBBB.'],
    { R: '#D9495B', W: CREAM, S: '#F0C9A0', B: '#4A7FD8' }),
  // Terrain conditions (Eevee's forest / snow branches and the like).
  grassTuft: glyph(['..G....G.', '.GgG..GgG', 'GGgGGGGgG', 'ggggggggg'], { G: '#7BC85A', g: '#3F8A33' }),
  tree: glyph(['....G....', '...GGG...', '..GGgGG..', '.GGGGGgG.', '..GGGGG..', '.GGGgGGG.', 'GGGGGGGgG', '....b....', '....b....'],
    { G: '#58B04A', g: '#2D6B23', b: '#7A4F2A' }),
  peak: glyph(['....W....', '...WWS...', '..SSSSS..', '.SSsSSSS.', 'SSSSsSSSS'], { W: CREAM, S: '#9AA6A0', s: '#6F7B75' }),
  dune: glyph(['......C..', '.....CCC.', '......C..', '..DD..C..', '.DDDD.DD.', 'DDDDDDDDD'], { D: '#E8C97A', C: '#58B04A' }),
  snowflake: glyph(['....S....', '.S..S..S.', '..S.S.S..', '...SSS...', 'SSSSWSSSS', '...SSS...', '..S.S.S..', '.S..S..S.', '....S....'],
    { S: '#BFE3F7', W: CREAM }),
  volcanoCone: glyph(['...O.O...', '....O....', '...RRR...', '..SSRSS..', '.SSSSSSS.', 'SSSSSSSSS'], { O: '#F2A93B', R: '#E0483A', S: '#5C4A44' }),
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

const urls = new Map<string, string>();
/** Cached SVG data URL of an icon (one rect per horizontal run, crisp edges). */
export function iconUrl(name: UiIconName): string {
  let url = urls.get(name);
  if (url) return url;
  const { rows, palette } = gridOf(name);
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
  url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  urls.set(name, url);
  return url;
}

export const escapeAttr = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

type IconOptions = { size?: number; label?: string; className?: string };
/**
 * `<img>` markup for a kit icon. With a `label` the image is named (alt + title); without one it is decorative
 * (aria-hidden), for icons that sit next to text that already says the same thing.
 */
export function uiIcon(name: UiIconName, { size = 24, label, className = '' }: IconOptions = {}): string {
  const grid = gridOf(name), width = Math.round(size * grid.rows[0].length / Math.max(grid.rows[0].length, grid.rows.length));
  const height = Math.round(size * grid.rows.length / Math.max(grid.rows[0].length, grid.rows.length));
  const named = label ? `alt="${escapeAttr(label)}" title="${escapeAttr(label)}"` : 'alt="" aria-hidden="true"';
  return `<img class="px-icon${className ? ` ${className}` : ''}" src="${iconUrl(name)}" width="${width}" height="${height}" ${named} draggable="false">`;
}

/** An image file (species sprite, building SVG) in the same named-or-decorative form. */
export function artImage(src: string, { size = 24, label, className = '' }: IconOptions = {}): string {
  const named = label ? `alt="${escapeAttr(label)}" title="${escapeAttr(label)}"` : 'alt="" aria-hidden="true"';
  return `<img class="px-art${className ? ` ${className}` : ''}" src="${src}" width="${size}" height="${size}" ${named} loading="lazy" draggable="false">`;
}

/** A compact "icon + number" stat: the number stays visible text, the icon names what it counts. */
export function statChip(name: UiIconName, value: string | number, label: string, className = ''): string {
  return `<span class="icon-stat${className ? ` ${className}` : ''}" title="${escapeAttr(`${label} ${value}`)}" aria-label="${escapeAttr(`${label} ${value}`)}" role="img">${uiIcon(name, { size: 16 })}<b aria-hidden="true">${value}</b></span>`;
}

/** Type badge with its Chinese name as the accessible name. */
export const typeBadge = (type: TypeId, size = 20, label = `${TYPE_NAMES[type]}属性`) => uiIcon(`type:${type}`, { size, label, className: 'type-badge' });
