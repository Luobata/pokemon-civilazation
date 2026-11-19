// ui-painted (docs/design/ui-painted.md): the painted theme's map backend. Same interface as the Canvas 2D backend (render, pick,
// lift, invalidate) and the same scene; a gently tilted ground plane (world y × PAINTED_TILT, no elevation, so picking is the flat
// inversion), illustrated terrain cached as world-space chunks (chunks25d.ts with the painted painter), a parchment fog layer
// cached like the flat map's, and painted tokens. Overlays that read well in any style (resource badges, districts, weather,
// trade routes, go-to routes, combat and event effects, debug) reuse the Canvas 2D layer functions.
import { contentForView } from '../../../content/units.ts';
import type { TypeId } from '../../../content/species.ts';
import { hexToIndex } from '../../../core/hex.ts';
import type { Hex } from '../../../core/hex.ts';
import type { PlayerView } from '../../../core/model.ts';
import { ROLE_POKEMON } from '../../../content/roles.ts';
import { HEX_RADIUS, copyShifts, mapSpan, mapTilt, toScreen, toWorld, worldToHex } from '../../camera.ts';
import type { Camera, Point } from '../../camera.ts';
import { drawPokemonSilhouette, drawPokemonSprite, drawSpritePath } from '../../sprites.ts';
import { EMPTY_FRAME } from '../animation.ts';
import type { AnimationFrame } from '../animation.ts';
import { DISTRICT_COLORS, MAX_COLORS, PARTICLE_CAP, YIELD_MIN_RADIUS, blit, cachedLayer, drawDebug, drawEffects, drawFeatures, drawGoTo, drawTradeRoutes, drawWeather, ownerColor } from '../canvas2d.ts';
import type { Draw, LayerCache, LayerStat, RenderStats, RendererOptions } from '../canvas2d.ts';
import { createChunkCache } from '../chunks25d.ts';
import type { MapScene, SceneCity, SceneUnit, UnitMarkIdentity } from '../scene.ts';
import { drawFogPainted } from './fog.ts';
import { DIRECTION_ANGLES, EDGE_CORNERS, SERIF, addHex, alpha, bucket, corner, darken, hexPath, lighten } from './kit.ts';
import { drawBasePainted } from './terrain.ts';
import { MEDALLION, TOWN, medallionFrame, plate, townSprite, typeBadge, yieldRow } from './tokens.ts';
import { drawIcon } from '../../map-icons.ts';

const ROLE_MARK = { settler: '拓', builder: '工', trader: '商' } as const;
const OUTLINE = '#22170D', BRASS = '#E2BE6E';

export type PaintedBackend = {
  render(scene: MapScene, camera: Camera, frame?: AnimationFrame, view?: PlayerView): RenderStats;
  invalidate(): void;
  pick(point: Point, camera: Camera): Hex;
  lift(hex: Hex): number;
};

type Ctx = Draw & { dpr: number; typeOf(unit: UnitMarkIdentity): TypeId | null };
/** Medallion radius (CSS px) for a tile radius. */
const medallionRadius = (radius: number) => Math.max(11, Math.min(25, radius * .5));
/** The medallion centre sits a little above the tile centre; its pole stands on the front of the tile. */
const medallionCentre = (p: Point, radius: number) => ({ x: p.x, y: p.y - radius * .28 });

function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, text: string, ink = '#FFF8E6', ring = OUTLINE) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  g.strokeStyle = ring; g.lineWidth = Math.max(1, r * .2); g.stroke();
  if (!text) return;
  g.fillStyle = ink; g.font = `800 ${Math.max(8, Math.round(r * 1.25))}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y + r * .06);
}

/** One unit as a medallion flag. `p` is the tile centre (or an animated position). */
type MedallionMarks = { spent?: boolean; hostile?: boolean; enraged?: boolean; status?: string; rank?: number; promotable?: boolean; hp?: { current: number; max: number };
  /** v27 ⑤: a Max raid boss (halo behind the medallion, shield pips over it, HP arc in the phase colour). */
  max?: SceneUnit['max']; /** v27 ②: an exhausted wild Pokémon (grey sprite, sweat-drop mark). */ exhausted?: boolean };
/** v27 ⑤ on the medallion: a red-pink Dynamax halo (stacked translucent rings, no shadowBlur; purple-tinged in phase two). */
function maxHalo(g: CanvasRenderingContext2D, c: Point, m: number, phase: 1 | 2) {
  g.save();
  for (const [index, scale] of [1.62, 1.42, 1.24].entries()) {
    g.globalAlpha = .28 + index * .12;
    g.beginPath(); g.arc(c.x, c.y, m * scale, 0, Math.PI * 2);
    g.fillStyle = index === 2 && phase === 2 ? MAX_COLORS.phaseTwo : index === 0 ? MAX_COLORS.red : MAX_COLORS.pink; g.fill();
  }
  g.globalAlpha = 1;
  g.beginPath(); g.arc(c.x, c.y, m * 1.62, 0, Math.PI * 2);
  g.strokeStyle = phase === 2 ? MAX_COLORS.phaseTwo : MAX_COLORS.pink; g.lineWidth = Math.max(2, m * .12); g.stroke();
  g.restore();
}
/** v27 ⑤ on the medallion: shield pips as small hexagon studs along the medallion's upper rim (standing filled, broken dark). */
function maxPips(g: CanvasRenderingContext2D, c: Point, m: number, max: NonNullable<SceneUnit['max']>) {
  if (max.shieldMax <= 0) return;
  const pip = Math.max(3.5, m * .2), step = Math.min(.42, 1.6 / Math.max(1, max.shieldMax - 1)), r = m * 1.32;
  for (let index = 0; index < max.shieldMax; index++) {
    const angle = -Math.PI / 2 + (index - (max.shieldMax - 1) / 2) * step, x = c.x + Math.cos(angle) * r, y = c.y + Math.sin(angle) * r;
    g.beginPath();
    for (let side = 0; side < 6; side++) { const a = (side * 60 - 30) * Math.PI / 180; if (side) g.lineTo(x + Math.cos(a) * pip, y + Math.sin(a) * pip); else g.moveTo(x + Math.cos(a) * pip, y + Math.sin(a) * pip); }
    g.closePath(); g.fillStyle = index < max.shields ? MAX_COLORS.shield : '#2A1A22'; g.fill();
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1, pip * .3); g.stroke();
  }
}
function medallion(d: Ctx, unit: UnitMarkIdentity, p: Point, o: MedallionMarks = {}, scale = 1) {
  if (!d.onscreen(p)) return;
  const g = d.context, m = medallionRadius(d.radius) * scale, mb = bucket(m * d.dpr), k = m / mb, c = medallionCentre(p, d.radius * scale);
  if (o.max) maxHalo(g, c, m, o.max.phase);
  const frame = medallionFrame({ ownerId: unit.ownerId, color: ownerColor(unit.ownerId), hostile: Boolean(o.hostile), spent: Boolean(o.spent) }, mb);
  g.drawImage(frame, c.x - MEDALLION.cx * m, c.y - MEDALLION.cy * m, frame.width * k, frame.height * k);
  const box = Math.round(m * 1.62), smoothing = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  if (unit.kind === 'pokemon') {
    if (o.exhausted) { g.save(); g.filter = 'grayscale(1) brightness(.9)'; }
    if (!drawPokemonSprite(g, unit.speciesId, Math.round(c.x - box / 2), Math.round(c.y - box * .56), box)) disc(g, c.x, c.y, m * .5, '#B9A57E', '?');
    if (o.exhausted) { g.restore(); drawIcon(g, 'exhausted', c.x + m * .78, c.y - m * .9, Math.max(11, m * .7)); }
  } else {
    const role = ROLE_POKEMON[unit.role];
    drawSpritePath(g, role.sprite, Math.round(c.x - box / 2), Math.round(c.y - box * .55), box);
    if (unit.role === 'settler' && unit.escortId) drawPokemonSprite(g, unit.escortId, Math.round(c.x - m * 1.25), Math.round(c.y), Math.round(m * .8));
  }
  g.imageSmoothingEnabled = smoothing;
  // Badges: type (or logistics role) lower right, done ✓ lower left, status / enraged upper left, rank and promotion on the right.
  const badge = m * .34;
  if (unit.kind === 'pokemon') {
    const type = d.typeOf(unit);
    if (type) { const rb = bucket(badge * d.dpr), sprite = typeBadge(type, rb), kb = badge / rb; g.drawImage(sprite, c.x + m * .74 - sprite.width * kb / 2, c.y + m * .72 - sprite.height * kb / 2, sprite.width * kb, sprite.height * kb); }
  } else disc(g, c.x + m * .74, c.y + m * .72, badge, '#F2C14E', ROLE_MARK[unit.role], OUTLINE);
  if (o.spent) disc(g, c.x - m * .74, c.y + m * .72, badge * .9, '#4A4136', '✓', '#E8DFC8');
  if (o.status) disc(g, c.x - m * .74, c.y - m * .74, badge, '#9A4FC0', o.status, '#FFF8E6', '#2A1636');
  if (o.enraged) disc(g, c.x - m * 1.08, c.y - m * .12, badge * .9, '#C0473E', '!');
  if (o.promotable) {
    const q = { x: c.x + m * 1.1, y: c.y - m * .18 }, r = badge * .95;
    disc(g, q.x, q.y, r, '#F2C14E', '');
    g.beginPath(); g.moveTo(q.x - r * .5, q.y + r * .3); g.lineTo(q.x, q.y - r * .45); g.lineTo(q.x + r * .5, q.y + r * .3); g.strokeStyle = OUTLINE; g.lineWidth = Math.max(1.5, r * .3); g.stroke();
  }
  for (let i = 0; i < (o.rank ?? 0); i++) {
    const x = c.x + m * 1.1, y = c.y + m * (.6 - i * .28), w = m * .36;
    g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x, y - w * .42); g.lineTo(x + w / 2, y);
    g.strokeStyle = OUTLINE; g.lineWidth = Math.max(3, m * .2); g.lineCap = 'round'; g.stroke();
    g.strokeStyle = '#F2C14E'; g.lineWidth = Math.max(1.5, m * .1); g.stroke();
  }
  if (o.hp) {
    // Health as an arc under the ring.
    const r = m * 1.12, from = Math.PI * 5 / 6, sweep = Math.PI * 2 / 3, share = Math.max(0, Math.min(1, o.hp.current / o.hp.max));
    g.lineCap = 'round';
    g.beginPath(); g.arc(c.x, c.y, r, from, from - sweep, true); g.strokeStyle = 'rgba(20,14,8,.9)'; g.lineWidth = Math.max(4, m * .24); g.stroke();
    g.beginPath(); g.arc(c.x, c.y, r, from, from - sweep * share, true);
    g.strokeStyle = o.max ? (o.max.phase === 2 ? MAX_COLORS.phaseTwo : MAX_COLORS.pink) : share * 2 < 1 ? '#E0604F' : '#7FD08A'; g.lineWidth = Math.max(2, m * .13); g.stroke();
  }
  if (o.max) maxPips(g, c, m, o.max);
}
/** The boss medallion is larger (the flat map draws the boss at 1.5×). */
const MAX_MEDALLION_SCALE = 1.35;

function drawUnits(d: Ctx, frame: AnimationFrame, camera: Camera) {
  const { context: g, centers, radius, scene } = d, posed = new Set(frame.poses.map(pose => pose.unit.id));
  const pokemonTiles = new Set(scene.units.filter(item => item.unit.kind === 'pokemon').map(item => item.index));
  const drawItem = (item: SceneUnit) => {
    const shared = item.unit.kind !== 'pokemon' && pokemonTiles.has(item.index), base = centers[item.index];
    const p = shared ? { x: base.x + radius * .62, y: base.y + radius * .3 } : base;
    medallion(d, item.unit, p, { spent: item.actionLeft === 0, hostile: item.hostile, enraged: item.enraged, status: item.status, rank: item.rank, promotable: item.promotable, hp: item.hp,
      max: item.max, exhausted: item.exhausted }, shared ? .6 : item.max ? MAX_MEDALLION_SCALE : 1);
  };
  // Back to front, so a nearer flag overlaps the one behind it.
  for (const item of [...scene.units].sort((a, b) => a.index - b.index)) if (!posed.has(item.unit.id)) drawItem(item);
  for (const pose of frame.poses) {
    const s = toScreen(pose.position, camera), point = { x: s.x + d.shift, y: s.y };
    if (!d.onscreen(point)) continue;
    const posedItem = scene.units.find(item => item.unit.id === pose.unit.id), hp = posedItem?.hp;
    if (pose.alpha !== undefined || pose.grey) {
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
      if (pose.grey) g.filter = 'grayscale(1) brightness(.8)';
      medallion(d, pose.unit, point); g.restore();
      continue;
    }
    medallion(d, pose.unit, point, { hp, max: posedItem?.max }, pose.scale ?? (posedItem?.max ? MAX_MEDALLION_SCALE : 1));
    if (pose.evolution && pose.evolution.white > 0 && pose.unit.kind === 'pokemon') {
      const m = medallionRadius(radius) * (pose.scale ?? 1), c = medallionCentre(point, radius), box = Math.round(m * 1.62);
      g.save(); g.globalAlpha = Math.min(1, pose.evolution.white);
      drawPokemonSilhouette(g, pose.unit.speciesId, Math.round(c.x - box / 2), Math.round(c.y - box * .56), box);
      g.restore();
    }
  }
}

function drawCities(d: Ctx) {
  const { context: g, centers, radius, scene, squash } = d, R = bucket(radius * d.dpr), k = radius / R;
  for (const city of scene.cities) {
    const p = centers[city.index];
    if (!d.onscreen(p)) continue;
    if (city.selected) {
      g.beginPath(); g.ellipse(p.x, p.y + radius * .06 * squash, radius * .95, radius * .7 * squash, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,214,110,.35)'; g.lineWidth = radius * .16; g.stroke();
      g.strokeStyle = '#F5CF62'; g.lineWidth = Math.max(2, radius * .05); g.stroke();
    }
    const { town } = townSprite({ color: ownerColor(city.ownerId), population: city.population ?? 3, capital: city.capital, wonders: city.wonders ?? 0 }, R, squash);
    g.drawImage(town, p.x - TOWN.ox * radius, p.y - TOWN.oy * radius, town.width * k, town.height * k);
  }
}
function drawTownLights(d: Ctx, level: number) {
  const { context: g, centers, radius, scene, squash } = d, R = bucket(radius * d.dpr), k = radius / R;
  g.save(); g.globalAlpha = level; g.globalCompositeOperation = 'lighter';
  for (const city of scene.cities) {
    const p = centers[city.index];
    if (!d.onscreen(p)) continue;
    const { lights } = townSprite({ color: ownerColor(city.ownerId), population: city.population ?? 3, capital: city.capital, wonders: city.wonders ?? 0 }, R, squash);
    g.drawImage(lights, p.x - TOWN.ox * radius, p.y - TOWN.oy * radius, lights.width * k, lights.height * k);
  }
  g.restore();
}

/** Ribbon banner: civ emblem, population medallion, name in serif, capital star / wonder crown, HP bar when damaged. */
function cityBanner(d: Ctx, city: SceneCity, p: Point) {
  const g = d.context, radius = d.radius, h = Math.max(15, Math.min(24, radius * .64)), color = ownerColor(city.ownerId);
  g.font = `700 ${Math.round(h * .6)}px ${SERIF}`;
  const nameWidth = g.measureText(city.name).width, extra = (city.capital ? h * .8 : 0) + (city.wonders ? h * .8 : 0);
  const pop = city.population !== undefined ? h * .95 : 0, width = h * .9 + pop + nameWidth + extra + h * .7;
  const left = p.x - width / 2 + h * .25, top = p.y - radius - h * .5;
  // Tails behind the body.
  for (const side of [-1, 1]) {
    const x = side < 0 ? left - h * .15 : left + width - h * .25;
    g.beginPath(); g.moveTo(x, top + h * .2); g.lineTo(x + side * h * .55, top + h * .25); g.lineTo(x + side * h * .32, top + h * .62); g.lineTo(x + side * h * .55, top + h * 1.0); g.lineTo(x, top + h * .95); g.closePath();
    g.fillStyle = darken(color, .4); g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = 1; g.stroke();
  }
  g.beginPath(); g.roundRect(left, top, width, h, h * .28);
  const body = g.createLinearGradient(0, top, 0, top + h);
  body.addColorStop(0, lighten(color, .12)); body.addColorStop(.55, darken(color, .12)); body.addColorStop(1, darken(color, .42));
  g.fillStyle = body; g.fill();
  g.strokeStyle = OUTLINE; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.roundRect(left + 1.5, top + 1.5, width - 3, h - 3, h * .22); g.strokeStyle = alpha(city.selected ? '#FFF0B0' : BRASS, city.selected ? 1 : .8); g.lineWidth = city.selected ? 1.6 : 1; g.stroke();
  // Emblem: a brass-rimmed civ disc with the number, hanging over the left end.
  const ex = left + h * .1, ey = top + h / 2, er = h * .62;
  g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2);
  const emblem = g.createRadialGradient(ex - er * .3, ey - er * .35, er * .1, ex, ey, er);
  emblem.addColorStop(0, lighten(color, .35)); emblem.addColorStop(1, darken(color, .3));
  g.fillStyle = emblem; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(ex, ey, er - 2, 0, Math.PI * 2); g.strokeStyle = BRASS; g.lineWidth = 1.4; g.stroke();
  g.fillStyle = '#FFF8E6'; g.font = `800 ${Math.round(er * 1.05)}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(city.ownerId === null ? '爪' : String(city.ownerId + 1), ex, ey + er * .06);
  let cursor = left + h * .85;
  if (city.population !== undefined) {
    const cx = cursor + h * .42, r = h * .38;
    g.beginPath(); g.arc(cx, ey, r, 0, Math.PI * 2); g.fillStyle = '#FBF1D8'; g.fill(); g.strokeStyle = BRASS; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#2A1C0E'; g.font = `800 ${Math.round(h * .52)}px ${SERIF}`; g.fillText(String(city.population), cx, ey + h * .03);
    cursor += pop;
  }
  g.font = `700 ${Math.round(h * .6)}px ${SERIF}`; g.textAlign = 'left';
  g.lineJoin = 'round'; g.lineWidth = Math.max(2, h * .16); g.strokeStyle = 'rgba(24,14,6,.85)'; g.strokeText(city.name, cursor + h * .12, ey + h * .04);
  g.fillStyle = '#FFF8E6'; g.fillText(city.name, cursor + h * .12, ey + h * .04);
  cursor += nameWidth + h * .3;
  const star = (x: number, y: number, r: number, fill: string) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, s = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); }
    g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = 1; g.stroke();
  };
  if (city.capital) { star(cursor + h * .35, ey, h * .36, '#F6D46A'); cursor += h * .8; }
  if (city.wonders) {
    const x = cursor + h * .35, r = h * .32;
    g.beginPath(); g.moveTo(x - r, ey + r * .6); g.lineTo(x - r, ey - r * .4); g.lineTo(x - r * .45, ey); g.lineTo(x, ey - r * .7); g.lineTo(x + r * .45, ey); g.lineTo(x + r, ey - r * .4); g.lineTo(x + r, ey + r * .6); g.closePath();
    g.fillStyle = '#F6D46A'; g.fill(); g.strokeStyle = OUTLINE; g.lineWidth = 1; g.stroke();
  }
  if (city.hp && city.hp.current < city.hp.max) {
    const barTop = top + h + 2, barLeft = left + h * .6, barWidth = width - h * .9;
    g.fillStyle = 'rgba(20,14,8,.9)'; g.beginPath(); g.roundRect(barLeft, barTop, barWidth, 5, 2.5); g.fill();
    g.fillStyle = city.hp.current * 2 < city.hp.max ? '#E0604F' : '#7FD08A'; g.beginPath(); g.roundRect(barLeft + 1, barTop + 1, (barWidth - 2) * city.hp.current / city.hp.max, 3, 1.5); g.fill();
  }
}

function drawYields(d: Ctx) {
  const { context: g, centers, radius, scene, squash } = d, all = scene.layers.yields && radius >= YIELD_MIN_RADIUS;
  if (!all && radius < 10) return;
  const r = Math.max(4.5, Math.min(8.5, radius * .19)), rb = bucket(r * d.dpr), k = r / rb, fog = new Set(scene.fog);
  for (const row of scene.yields) {
    const p = centers[row.index];
    if (!d.onscreen(p) || (!all && !row.inFocus) || (fog.has(row.index) && !row.inFocus)) continue;
    const sprite = yieldRow(row.yields, rb);
    if (!sprite) continue;
    g.save(); if (!row.workable) g.globalAlpha = .45;
    g.drawImage(sprite, p.x - sprite.width * k / 2, p.y + radius * .55 * squash - sprite.height * k / 2, sprite.width * k, sprite.height * k);
    g.restore();
  }
  for (const index of scene.workedTiles) {
    const p = centers[index];
    if (!d.onscreen(p)) continue;
    hexPath(g, p.x, p.y, radius * .92, squash); g.strokeStyle = 'rgba(245,207,98,.75)'; g.lineWidth = Math.max(1.5, radius * .05); g.stroke();
    disc(g, p.x - radius * .52, p.y - radius * .38 * squash, Math.max(5, radius * .16), '#F5CF62', '民', OUTLINE);
  }
}

function edgeSegments(d: Draw, edges: readonly { index: number; direction: number }[], inset = 0): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const edge of edges) {
    const p = d.centers[edge.index];
    if (!d.onscreen(p)) continue;
    const [a, b] = EDGE_CORNERS[edge.direction], angle = DIRECTION_ANGLES[edge.direction], pa = corner(p, d.radius, d.squash, a), pb = corner(p, d.radius, d.squash, b);
    const nx = -Math.cos(angle) * inset * d.radius, ny = -Math.sin(angle) * d.squash * inset * d.radius;
    out.push([{ x: pa.x + nx, y: pa.y + ny }, { x: pb.x + nx, y: pb.y + ny }]);
  }
  return out;
}
function strokeAll(g: CanvasRenderingContext2D, segments: readonly [Point, Point][], passes: readonly { color: string; width: number; dash?: number[] }[]) {
  if (!segments.length) return;
  const path = new Path2D();
  for (const [a, b] of segments) { path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of passes) { g.setLineDash(pass.dash ?? []); g.strokeStyle = pass.color; g.lineWidth = pass.width; g.stroke(path); }
  g.setLineDash([]);
}
/** Move range (soft wash and a glowing cyan contour), attack reach (dashed red), targets and district sites. */
function drawInteraction(d: Ctx) {
  const { context: g, centers, radius, scene, squash } = d;
  const fill = (indexes: readonly number[], color: string) => {
    g.beginPath(); let any = false;
    for (const index of indexes) if (d.onscreen(centers[index])) { addHex(g, centers[index].x, centers[index].y, radius * .97, squash); any = true; }
    if (any) { g.fillStyle = color; g.fill(); }
  };
  fill(scene.attackArea, 'rgba(229,85,74,.1)');
  fill(scene.reachable, 'rgba(160,236,255,.16)');
  strokeAll(g, edgeSegments(d, scene.attackEdges, .04), [{ color: 'rgba(30,8,6,.75)', width: Math.max(4, radius * .14) }, { color: '#FF7A66', width: Math.max(2, radius * .07), dash: [radius * .28, radius * .16] }]);
  strokeAll(g, edgeSegments(d, scene.moveEdges, .04), [{ color: 'rgba(120,226,255,.22)', width: Math.max(7, radius * .3) }, { color: 'rgba(12,36,48,.7)', width: Math.max(4, radius * .14) },
    { color: '#8FE9FF', width: Math.max(2.4, radius * .085) }, { color: 'rgba(255,255,255,.85)', width: Math.max(.8, radius * .025) }]);
  for (const target of scene.targets) {
    const p = centers[target.index];
    if (!d.onscreen(p)) continue;
    const c = medallionCentre(p, radius), r = medallionRadius(radius) * 1.28, capture = target.mode === 'capture', color = capture ? '#F2B441' : '#FF6B5E';
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.strokeStyle = 'rgba(20,10,6,.8)'; g.lineWidth = Math.max(4, r * .2); g.stroke();
    g.setLineDash([r * .5, r * .28]); g.strokeStyle = target.pending ? '#FFF8E6' : color; g.lineWidth = Math.max(2, r * .1); g.stroke(); g.setLineDash([]);
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + q * Math.PI / 2;
      g.beginPath(); g.moveTo(c.x + Math.cos(a) * r * .82, c.y + Math.sin(a) * r * .82); g.lineTo(c.x + Math.cos(a) * r * 1.18, c.y + Math.sin(a) * r * 1.18);
      g.strokeStyle = color; g.lineWidth = Math.max(2, r * .12); g.stroke();
    }
    disc(g, c.x - r * .8, c.y + r * .8, Math.max(6, r * .3), color, capture ? '球' : '×', '#20140A');
  }
  for (const site of scene.placement) {
    const p = centers[site.index];
    if (!d.onscreen(p)) continue;
    hexPath(g, p.x, p.y, radius * .94, squash);
    g.fillStyle = site.legal ? 'rgba(242,193,78,.16)' : 'rgba(155,56,51,.12)'; g.fill();
    g.strokeStyle = site.selected ? '#FFF8E6' : site.legal ? '#F2C14E' : '#A66B65'; g.lineWidth = site.selected ? 3 : site.legal ? 2 : 1; g.stroke();
  }
}
function drawSelection(d: Ctx, frame: AnimationFrame) {
  const { context: g, centers, radius, scene, squash } = d;
  if (scene.selectedUnit !== null && !frame.poses.length && d.onscreen(centers[scene.selectedUnit])) {
    const p = centers[scene.selectedUnit], c = medallionCentre(p, radius), r = medallionRadius(radius) * 1.2;
    g.beginPath(); g.ellipse(p.x, p.y + radius * .5 * squash, radius * .62, radius * .62 * squash * .55, 0, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,214,110,.5)'; g.lineWidth = radius * .1; g.stroke();
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,214,110,.35)'; g.lineWidth = r * .32; g.stroke();
    g.strokeStyle = OUTLINE; g.lineWidth = r * .14; g.stroke();
    g.strokeStyle = '#F7D36A'; g.lineWidth = r * .08; g.stroke();
  }
  if (scene.inspected !== null && d.onscreen(centers[scene.inspected])) {
    const p = centers[scene.inspected];
    hexPath(g, p.x, p.y, radius * .96, squash); g.fillStyle = 'rgba(255,248,226,.14)'; g.fill();
    g.strokeStyle = OUTLINE; g.lineWidth = 5; g.stroke(); g.strokeStyle = '#FFF0C4'; g.lineWidth = 2.5; g.stroke();
  }
  if (scene.cursor !== null && d.onscreen(centers[scene.cursor])) {
    const p = centers[scene.cursor];
    hexPath(g, p.x, p.y, radius * .96, squash); g.setLineDash([4, 3]); g.strokeStyle = '#B48CFF'; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
  }
}
/** Improvements as small parchment plates with their icon; districts as a tinted square with a large seal in the district colour. */
function drawPlates(d: Ctx) {
  const { context: g, centers, radius, scene, squash } = d;
  const blit = (sprite: HTMLCanvasElement, x: number, y: number, k: number) => g.drawImage(sprite, x - sprite.width * k / 2, y - sprite.height * k / 2, sprite.width * k, sprite.height * k);
  for (const item of scene.districts) {
    const p = centers[item.index];
    if (!d.onscreen(p)) continue;
    const color = item.ownerId === null ? '#8C8576' : DISTRICT_COLORS[item.kind];
    g.save();
    g.globalAlpha = item.memory ? .6 : item.progress !== undefined ? .75 : 1;
    g.beginPath(); g.ellipse(p.x, p.y + radius * .12 * squash, radius * .82, radius * .6 * squash, 0, 0, Math.PI * 2);
    g.fillStyle = alpha(color, .32); g.fill(); g.strokeStyle = alpha(darken(color, .3), .8); g.lineWidth = Math.max(1.5, radius * .05); g.stroke();
    const r = Math.max(9, radius * .46), rb = bucket(r * d.dpr), k = r / rb, cy = p.y - radius * .08;
    blit(plate(color, rb), p.x, cy, k);
    g.imageSmoothingEnabled = false;
    drawIcon(g, item.kind, p.x, cy, r * 1.45);
    g.imageSmoothingEnabled = true;
    if (item.progress !== undefined) {
      g.globalAlpha = 1;
      g.beginPath(); g.arc(p.x, cy, r * 1.22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * item.progress / 100);
      g.strokeStyle = color; g.lineWidth = Math.max(2.5, r * .2); g.lineCap = 'round'; g.stroke();
    }
    if (item.ownerId === null) disc(g, p.x + r * .9, cy + r * .8, Math.max(6, r * .34), '#5A5348', '停');
    g.restore();
  }
  for (const item of scene.improvements) {
    const p = centers[item.index];
    if (!d.onscreen(p)) continue;
    const r = Math.max(6, radius * .24), rb = bucket(r * d.dpr), k = r / rb, x = p.x - radius * .5, y = p.y + radius * .18 * squash;
    g.save();
    if (item.dim) g.globalAlpha = .7;
    blit(plate(item.damaged ? '#8E3A30' : '#9A7438', rb), x, y, k);
    g.imageSmoothingEnabled = false;
    drawIcon(g, item.kind, x, y, r * 1.5, item.damaged ? .5 : 1);
    if (item.damaged) drawIcon(g, 'damaged', x, y, r * 1.2);
    g.restore();
  }
}
function drawBanners(d: Ctx) { for (const city of d.scene.cities) if (d.onscreen(d.centers[city.index])) cityBanner(d, city, d.centers[city.index]); }
function drawNight(d: Ctx | undefined, frame: AnimationFrame) {
  if (!d) return 0;
  const level = Math.max(0, Math.min(1, frame.night ?? (d.scene.night ? 1 : 0)));
  if (level <= 0) return 0;
  d.context.save(); d.context.globalAlpha = level;
  d.context.fillStyle = 'rgba(14,22,58,.46)'; d.context.fillRect(-8, -8, d.width + 16, d.height + 16);
  d.context.restore();
  return level;
}

const typeCache = new WeakMap<PlayerView, (unit: UnitMarkIdentity) => TypeId | null>();
function typeReader(view: PlayerView | undefined): (unit: UnitMarkIdentity) => TypeId | null {
  if (!view) return () => null;
  let reader = typeCache.get(view);
  if (!reader) {
    const content = contentForView(view);
    reader = unit => unit.kind === 'pokemon' ? content.species[unit.speciesId]?.typeId ?? null : null;
    typeCache.set(view, reader);
  }
  return reader;
}

export function createPaintedRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): PaintedBackend {
  const caching = options.cacheLayers ?? true, chunks = createChunkCache();
  let fog: LayerCache | null = null, generation = 0, lastView = '', zeros = new Float32Array(0);
  return {
    invalidate() { generation++; chunks.clear(); },
    pick(point, camera) { return worldToHex(toWorld(point, camera)); },
    lift() { return 0; },
    render(scene, camera, frame = EMPTY_FRAME, view) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
      const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      const deviceWidth = Math.round(width * dpr), deviceHeight = Math.round(height * dpr);
      if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
      if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
      const shakeX = Math.round((frame.shake?.x ?? 0) * dpr), shakeY = Math.round((frame.shake?.y ?? 0) * dpr);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, deviceWidth, deviceHeight);
      context.setTransform(dpr, 0, 0, dpr, shakeX, shakeY);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      const radius = HEX_RADIUS * camera.zoom, squash = mapTilt();
      if (zeros.length !== scene.tiles.length) zeros = new Float32Array(scene.tiles.length);
      const centers = scene.tiles.map(tile => toScreen(tile.world, camera));
      const onscreen = (p: Point) => p.x >= -radius * 1.5 && p.x <= width + radius * 1.5 && p.y >= -radius * 1.5 && p.y <= height + radius * 2;
      const span = scene.wrap ? mapSpan(scene) * camera.zoom : 0;
      const copies = copyShifts(scene, camera, width, radius * 4).map(shift => ({ shift, centers: shift === 0 ? centers : centers.map(p => ({ x: p.x + shift, y: p.y })) }));
      const budget = { particles: PARTICLE_CAP }, typeOf = typeReader(view);
      const all: Ctx[] = copies.map(copy => ({ context, width, height, radius, centers: copy.centers, onscreen, scene, shift: copy.shift, span, budget, squash, liftAt: () => 0, dpr, typeOf }));
      const indexOf = (hex: Hex) => hexToIndex(hex, scene);
      const viewKey = `${generation}|painted${squash}|${deviceWidth}x${deviceHeight}@${dpr}|${camera.x},${camera.y},${camera.zoom}`;
      const settled = viewKey === lastView;
      lastView = viewKey;
      const baseArgs = (target: CanvasRenderingContext2D) => ({ context: target, scene, lifts: zeros, radius, zoom: camera.zoom, squash, copies: copies.map(copy => copy.centers), width, height, ownerColor });
      const terrainKey = `${scene.tiles.map(tile => tile.biome ?? '-').join(',')}|${scene.terrain ? `${scene.terrain.hills.length}.${scene.terrain.rivers.length}.${scene.terrain.landmarks.length}` : ''}|${scene.territoryEdges.map(edge => `${edge.index}.${edge.direction}.${edge.ownerId}`).join(',')}`;
      let baseStat: LayerStat;
      if (caching) {
        baseStat = chunks.draw({ context, scene, lifts: zeros, camera, squash, dpr, shifts: copies.map(copy => copy.shift), width, height, shakeX, shakeY,
          key: `${generation}|painted|${terrainKey}`, settled, ownerColor, paint: drawBasePainted, fogReach: { rows: 3, cols: 2 } });
        if (baseStat === 'direct') drawBasePainted(baseArgs(context));
      } else { drawBasePainted(baseArgs(context)); baseStat = 'off'; }

      // The parchment chart sits right on the terrain: remembered towns, badges and districts read as notes drawn on it.
      let fogStat: RenderStats['fog'] = 'none';
      if (scene.fog.length) {
        const paint = (target: CanvasRenderingContext2D) => drawFogPainted({ context: target, scene, radius, squash, copies: copies.map(copy => copy.centers), onscreen, ownerColor });
        const key = `${viewKey}|${scene.fog.join(',')}|${terrainKey.length}`;
        if (!caching) { paint(context); fogStat = 'off'; }
        else if (fog?.key === key) { blit(context, fog.canvas, dpr, shakeX, shakeY); fogStat = 'hit'; }
        else if (!settled) { paint(context); fogStat = 'direct'; }
        else { fog = cachedLayer(fog, key, deviceWidth, deviceHeight, dpr, target => { target.imageSmoothingEnabled = true; paint(target); }).cache; blit(context, fog.canvas, dpr, shakeX, shakeY); fogStat = 'miss'; }
      }
      // Reused pixel-icon layers keep their crisp (unsmoothed) scaling.
      context.imageSmoothingEnabled = false;
      // Improvements and districts get painted plates; resource badges, faith marks and construction signs are reused as they are.
      const rest = { ...scene, improvements: [], districts: [] };
      for (const item of all) drawFeatures({ ...item, scene: rest });
      context.imageSmoothingEnabled = true;
      for (const item of all) drawPlates(item);
      context.imageSmoothingEnabled = false;
      context.imageSmoothingEnabled = true;
      for (const item of all) drawTradeRoutes(item);
      for (const item of all) drawCities(item);
      for (const item of all) drawYields(item);
      for (const item of all) drawWeather(item, frame);
      const night = drawNight(all[0], frame);
      if (night > 0) for (const item of all) drawTownLights(item, night);
      for (const item of all) drawUnits(item, frame, camera);
      // City banners over the flags (city names stay readable); they sit low enough to cover only the rim of a flag above.
      for (const item of all) drawBanners(item);
      for (const item of all) drawInteraction(item);
      for (const item of all) drawGoTo(item);
      for (const item of all) drawSelection(item, frame);
      if (scene.debug.overlay !== 'none') for (const item of all) drawDebug(item);
      context.imageSmoothingEnabled = false;
      for (const item of all) drawEffects(item, frame, indexOf, camera);
      return { base: baseStat, fog: fogStat, shake: { x: shakeX, y: shakeY } };
    },
  };
}
