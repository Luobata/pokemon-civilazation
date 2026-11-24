// Canvas 2D backend: draws a MapScene (plus an animation frame) for a camera.
// Layers are drawn in a fixed order; the two that rarely change (terrain/borders and fog)
// are cached as device-pixel images and reused until their inputs or the camera change.
import { FONT_UI } from '../theme.ts';
import { speciesDisplay } from '../../content/species.ts';
import { hexToIndex } from '../../core/hex.ts';
import type { Hex } from '../../core/hex.ts';
import { HEX_RADIUS, copyShifts, mapSpan, mapTilt, toScreen, toWorld, worldToHex } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import { buildingSprite, drawPokemonSilhouette } from '../sprites.ts';
import { ROLE_POKEMON } from '../../content/roles.ts';
import { drawTerrain } from '../terrain.ts';
import { drawTerrainFeatures } from './terrain-features.ts';
import { drawIcon, drawPixelNumber, drawYieldRow } from '../map-icons.ts';
import type { MapScene, SceneCity, UnitMarkIdentity } from './scene.ts';
import { EMPTY_FRAME, EVOLUTION_REVEAL_AT } from './animation.ts';
import type { AnimationFrame, UnitPose } from './animation.ts';
import { liftAtWorld, pickHex, sceneLifts } from './projection.ts';
import { drawBase25d, drawFog25d } from './terrain25d.ts';
import { drawSpeciesSprite, drawSpriteFile } from './sprite-draw.ts';
import { createChunkCache } from './chunks25d.ts';
import { drawTown25d, drawTownLights, unitPlinth } from './town25d.ts';
import {
  DISTRICT_COLORS, FACTIONS, HEX_CORNERS, MAX_COLORS, MAX_SCALE, PARTICLE_CAP, YIELD_MIN_RADIUS,
  blit, cachedLayer, centeredText, citySize, drawDebug, drawEffects, drawFeatures, drawGoTo,
  drawTradeRoutes, drawWeather, edgeLine, factionRect, ownerColor, polygon,
} from './overlays.ts';
import type { Draw, LayerCache, LayerName, LayerStat, RenderStats, RendererOptions } from './overlays.ts';

export {
  DISTRICT_COLORS, FACTIONS, MAX_COLORS, MAX_SCALE, PARTICLE_CAP, YIELD_MIN_RADIUS,
  blit, cachedLayer, drawDebug, drawEffects, drawFeatures, drawGoTo, drawTradeRoutes, drawWeather, ownerColor,
};
export type { Draw, LayerCache, LayerName, LayerStat, RenderStats, RendererOptions };

const ROLE_MARK = { settler: '拓', builder: '工', trader: '商' } as const;
const MAX_PINK = MAX_COLORS.pink, MAX_RED = MAX_COLORS.red, MAX_PHASE_TWO = MAX_COLORS.phaseTwo, MAX_SHIELD = MAX_COLORS.shield;

/** City-banner colours: red below half, otherwise green. */
const hpColor = (current: number, max: number) => current * 2 < max ? '#E07A6D' : '#72C99E';

function ownerBadge(d: Draw, ownerId: number | null, p: Point, size: number) {
  const badge = Math.max(13, size * .42), x = p.x + size * .32, y = p.y - size * .38;
  factionRect(d, ownerId, { x, y }, badge, badge / 2);
  d.context.strokeStyle = '#FFFDF7';
  d.context.lineWidth = 1;
  d.context.stroke();
  centeredText(d, ownerId === null ? '爪' : String(ownerId + 1), { x, y: y + .3 }, '#FFFDF7', badge * .65);
}

// ---------- Layers ----------
/** Terrain, hex grid, coastlines and territory borders. Cached. */
function drawBase(d: Draw) {
  const { context, centers, scene } = d;
  for (const tile of scene.tiles) {
    const p = centers[tile.index];
    if (!d.onscreen(p)) continue;
    if (tile.biome) drawTerrain(context, tile.biome, tile.index, p, d.radius);
    else { polygon(d, p); context.fillStyle = '#0C171C'; context.fill(); }
    polygon(d, p);
    context.strokeStyle = tile.biome ? '#0B1A1C99' : '#60807840';
    context.lineWidth = tile.biome ? Math.max(1, d.radius * .045) : .8;
    context.stroke();
  }
  // v24: hills, peaks, rivers, deep water and landmarks over the terrain (each wrapped copy draws its own).
  if (scene.terrain) drawTerrainFeatures(context, scene.terrain, centers, d.radius, d.onscreen);
  for (const edge of scene.coastEdges) {
    if (!d.onscreen(centers[edge.index])) continue;
    edgeLine(d, edge.index, edge.direction);
    context.strokeStyle = '#C9B67D'; context.lineWidth = Math.max(1.5, d.radius * .13); context.stroke();
    edgeLine(d, edge.index, edge.direction);
    context.strokeStyle = '#A7D1C8'; context.lineWidth = Math.max(.7, d.radius * .045); context.stroke();
  }
  for (const edge of scene.territoryEdges) {
    if (!d.onscreen(centers[edge.index])) continue;
    edgeLine(d, edge.index, edge.direction);
    context.strokeStyle = '#1D2B26'; context.lineWidth = 4; context.stroke();
    context.strokeStyle = ownerColor(edge.ownerId!); context.lineWidth = 2; context.stroke();
  }
}

/** City tiles: selection outline, plaza, built buildings and the town sprite. */
function drawCities(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const city of scene.cities) {
    const p = centers[city.index];
    if (!d.onscreen(p)) continue;
    const size = citySize(radius);
    if (city.selected) {
      polygon(d, p); context.strokeStyle = '#10191B'; context.lineWidth = 6; context.stroke();
      polygon(d, p); context.strokeStyle = '#F2C14E'; context.lineWidth = 3; context.stroke();
    }
    if (d.squash < 1) { drawTown25d(context, p, radius, d.squash, ownerColor(city.ownerId), city.population, city.capital, city.wonders ?? 0); continue; }
    polygon(d, p); context.fillStyle = `${ownerColor(city.ownerId)}2E`; context.fill();
    const slots = [[-.56, .3], [.56, .3], [-.5, -.28], [.5, -.28], [0, .58]] as const;
    for (const [slot, id] of city.buildings.slice(0, slots.length).entries()) {
      const art = buildingSprite(id);
      if (!art) continue;
      const width = radius * .66, height = width * 80 / 96;
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(art, Math.round(p.x + slots[slot][0] * radius - width / 2), Math.round(p.y + slots[slot][1] * radius - height / 2), Math.round(width), Math.round(height));
    }
    context.imageSmoothingEnabled = false;
    context.beginPath();
    context.ellipse(p.x, p.y + size * .36, size * .48, size * .17, 0, 0, Math.PI * 2);
    context.fillStyle = '#07111499'; context.fill();
    const pixel = size / 32;
    const block = (color: string, x: number, y: number, width: number, height: number) => {
      context.fillStyle = color;
      context.fillRect(Math.round(p.x + x * pixel), Math.round(p.y + y * pixel), Math.ceil(width * pixel), Math.ceil(height * pixel));
    };
    block('#263B39', -15, 8, 30, 6);
    block('#71875A', -14, 7, 28, 4);
    block('#D6BE85', -2, 1, 4, 11);
    block('#D6BE85', -12, 5, 24, 3);
    block('#263B39', -14, -2, 11, 10);
    block('#EAD8AE', -13, 0, 9, 7);
    block('#263B39', -15, -5, 13, 4);
    block('#4F8C81', -13, -7, 9, 3);
    block('#8BC0A5', -11, -7, 4, 1);
    block('#34504D', -11, 2, 3, 3);
    block('#8CC6C0', -10, 2, 1, 2);
    block('#263B39', 4, -1, 12, 9);
    block('#E6D2A5', 5, 1, 10, 6);
    block('#263B39', 3, -4, 14, 4);
    block('#B36B4E', 5, -6, 10, 3);
    block('#E49A68', 7, -6, 4, 1);
    block('#4A4B43', 11, 2, 3, 5);
    block('#263B39', -6, -5, 13, 12);
    block('#F0DFB5', -5, -3, 11, 9);
    block('#263B39', -7, -9, 15, 5);
    block('#C49A45', -5, -12, 11, 4);
    block('#F2C96C', -3, -12, 5, 1);
    block('#456575', -2, 1, 4, 6);
    block('#9BD1CB', -1, 2, 2, 2);
    block('#263B39', -12, -10, 1.5, 10);
    block('#263B39', -16, -17, 9, 8);
    block('#F7F0D8', -15, -16, 7, 6);
    block('#D95454', -15, -16, 7, 3);
    block('#263B39', -15, -13.5, 7, 1);
    block('#263B39', -12.5, -16, 2, 6);
    block('#F7F0D8', -12.5, -14, 2, 2);
  }
}

/** Yield rows and worked-tile markers (Civilization tile yields). */
function drawYields(d: Draw) {
  const { context, centers, radius, scene } = d;
  const all = scene.layers.yields && radius >= YIELD_MIN_RADIUS;
  if (all || radius >= 10) {
    const yieldSize = Math.max(7, Math.min(16, radius * .4));
    for (const row of scene.yields) {
      if (!d.onscreen(centers[row.index]) || (!all && !row.inFocus)) continue;
      drawYieldRow(context, row.yields, centers[row.index].x, centers[row.index].y + radius * (d.squash < 1 ? .5 : .6), yieldSize * (d.squash < 1 ? .9 : 1), row.workable ? 1 : .4);
    }
  }
  for (const index of scene.workedTiles) {
    if (!d.onscreen(centers[index])) continue;
    polygon(d, centers[index]); context.strokeStyle = '#F2C14EAA'; context.lineWidth = 1.5; context.stroke();
    drawIcon(context, 'citizen', centers[index].x - radius * .55, centers[index].y - radius * .42, Math.max(9, radius * .38));
  }
}

/** Night dims the whole frame once (not once per map copy); the margin covers the screen-shake offset. */
function drawNight(d: Draw | undefined, frame: AnimationFrame) {
  if (!d) return;
  const level = Math.max(0, Math.min(1, frame.night ?? (d.scene.night ? 1 : 0)));
  if (level <= 0) return;
  d.context.save();
  d.context.globalAlpha = level;
  d.context.fillStyle = '#0A143066'; d.context.fillRect(-8, -8, d.width + 16, d.height + 16);
  d.context.restore();
}

function unitMark(d: Draw, unit: UnitMarkIdentity, point: Point, actionLeft?: number, enraged = false, scale = 1) {
  if (!d.onscreen(point)) return;
  const { context } = d;
  const size = Math.max(26, Math.min(54, d.radius * 1.75)) * scale;
  if (d.squash < 1) unitPlinth(context, { x: point.x, y: point.y + size * .3 }, size, d.squash, unit.ownerId, ownerColor(unit.ownerId), actionLeft === 0);
  else {
    context.beginPath();
    context.ellipse(point.x, point.y + size * .32, size * .37, size * .15, 0, 0, Math.PI * 2);
    context.fillStyle = '#071114A6'; context.fill();
    const marker = size * .58;
    factionRect(d, unit.ownerId, { x: point.x, y: point.y + size * .2 }, marker, marker / 2);
    context.strokeStyle = '#132625'; context.lineWidth = 3; context.stroke();
    context.beginPath();
    context.arc(point.x, point.y + size * .2, marker * .43, 0, Math.PI * 2);
    context.strokeStyle = actionLeft === 0 ? '#81908A' : '#F2E7C9'; context.lineWidth = 1.2; context.stroke();
  }
  if (unit.kind === 'pokemon') {
    if (!drawSpeciesSprite(context, unit.speciesId, Math.round(point.x - size * .54), Math.round(point.y - size * .62), Math.round(size * 1.08))) centeredText(d, speciesDisplay(unit.speciesId).abbreviation, point, '#FFF3D4', size * .42);
  } else {
    const role = ROLE_POKEMON[unit.role];
    if (!drawSpriteFile(context, role.sprite, Math.round(point.x - size * .5), Math.round(point.y - size * .58), Math.round(size))) centeredText(d, role.unitName.slice(0, 1), point, '#FFF3D4', size * .42);
    const q = { x: point.x - size * .36, y: point.y - size * .34 };
    context.beginPath(); context.arc(q.x, q.y, size * .17, 0, Math.PI * 2); context.fillStyle = '#F2C14E'; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
    centeredText(d, ROLE_MARK[unit.role], q, '#10191B', size * .22);
    if (unit.role === 'settler' && unit.escortId) drawSpeciesSprite(context, unit.escortId, Math.round(point.x + size * .08), Math.round(point.y - size * .05), Math.round(size * .5));
  }
  ownerBadge(d, unit.ownerId, point, size);
  if (actionLeft === 0) {
    context.beginPath(); context.arc(point.x - size * .3, point.y + size * .29, size * .15, 0, Math.PI * 2);
    context.fillStyle = '#263B39'; context.fill();
    centeredText(d, '✓', { x: point.x - size * .3, y: point.y + size * .29 }, '#D4DED5', size * .25);
  }
  if (enraged) {
    context.beginPath();
    context.arc(point.x - size * .38, point.y - size * .35, size * .18, 0, Math.PI * 2);
    context.fillStyle = '#B84D45';
    context.fill();
    centeredText(d, '!', { x: point.x - size * .38, y: point.y - size * .35 }, '#FFF3D4', size * .32);
  }
}

/** v13 promotions: gold chevrons per trait at the lower right; a gold arrow when an own unit can promote. */
function rankMark(d: Draw, p: Point, rank: number, promotable: boolean) {
  const { context, radius } = d;
  const w = Math.max(6, radius * .24), x = p.x + radius * .5, y = p.y + radius * .42;
  for (let i = 0; i < rank; i++) {
    const cy = y - i * w * .55;
    context.beginPath(); context.moveTo(x - w / 2, cy); context.lineTo(x, cy - w * .4); context.lineTo(x + w / 2, cy);
    context.strokeStyle = '#10191B'; context.lineWidth = 4; context.stroke();
    context.strokeStyle = '#F2C14E'; context.lineWidth = 2; context.stroke();
  }
  if (promotable) {
    const q = { x: p.x + radius * .55, y: p.y - radius * .55 }, size = Math.max(8, radius * .28);
    context.beginPath(); context.arc(q.x, q.y, size, 0, Math.PI * 2); context.fillStyle = '#F2C14E'; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
    context.beginPath(); context.moveTo(q.x - size * .5, q.y + size * .3); context.lineTo(q.x, q.y - size * .45); context.lineTo(q.x + size * .5, q.y + size * .3);
    context.strokeStyle = '#10191B'; context.lineWidth = 2; context.stroke();
  }
}

/** A 3 px HP bar along the bottom of a damaged unit; a Max boss gets a wide one, purple in phase two. */
function unitHpBar(d: Draw, point: Point, hp: { current: number; max: number }, max?: { phase: 1 | 2 }) {
  if (!d.onscreen(point)) return;
  const { context } = d;
  const size = Math.max(26, Math.min(54, d.radius * 1.75));
  const width = Math.round(size * (max ? 1.1 : .62)), height = max ? 4 : 3, left = Math.round(point.x - width / 2), top = Math.round(point.y + size * (max ? .5 : .46));
  context.fillStyle = '#10191BE6'; context.fillRect(left - 1, top - 1, width + 2, height + 2);
  context.fillStyle = '#3A2A28'; context.fillRect(left, top, width, height);
  context.fillStyle = max ? (max.phase === 2 ? MAX_PHASE_TWO : MAX_PINK) : hpColor(hp.current, hp.max); context.fillRect(left, top, Math.max(1, Math.round(width * hp.current / hp.max)), height);
}

function maxAura(d: Draw, p: Point, phase: 1 | 2) {
  if (!d.onscreen(p)) return;
  const { context, radius } = d, size = Math.max(26, Math.min(54, radius * 1.75)) * MAX_SCALE;
  context.save();
  context.beginPath(); context.ellipse(p.x, p.y + size * .3, size * .52, size * .2 * Math.min(1, d.squash / .7), 0, 0, Math.PI * 2);
  context.fillStyle = '#5A0F2266'; context.fill();
  for (const [index, scale] of [1, .82, .64].entries()) {
    context.globalAlpha = .3 + index * .12;
    context.beginPath(); context.ellipse(p.x, p.y - size * .05, size * .5 * scale, size * .58 * scale, 0, 0, Math.PI * 2);
    context.fillStyle = index === 2 && phase === 2 ? MAX_PHASE_TWO : index === 0 ? MAX_RED : MAX_PINK; context.fill();
  }
  context.globalAlpha = 1;
  context.beginPath(); context.ellipse(p.x, p.y - size * .05, size * .5, size * .58, 0, 0, Math.PI * 2);
  context.strokeStyle = phase === 2 ? MAX_PHASE_TWO : MAX_PINK; context.lineWidth = 3; context.stroke();
  context.restore();
}

function maxShieldPips(d: Draw, p: Point, max: { shields: number; shieldMax: number }) {
  if (!d.onscreen(p) || max.shieldMax <= 0) return;
  const { context, radius } = d, size = Math.max(26, Math.min(54, radius * 1.75)) * MAX_SCALE;
  const pip = Math.max(4, Math.round(radius * .17)), gap = Math.round(pip * .5), total = max.shieldMax * pip * 2 + (max.shieldMax - 1) * gap;
  const y = Math.round(p.y - size * .66);
  for (let index = 0; index < max.shieldMax; index++) {
    const cx = Math.round(p.x - total / 2 + pip + index * (pip * 2 + gap));
    context.beginPath();
    for (let corner = 0; corner < 6; corner++) { const x = cx + pip * HEX_CORNERS[corner].x, yy = y + pip * HEX_CORNERS[corner].y; if (corner === 0) context.moveTo(x, yy); else context.lineTo(x, yy); }
    context.closePath();
    context.fillStyle = index < max.shields ? MAX_SHIELD : '#2A1A22'; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
    if (index < max.shields) { context.fillStyle = '#FFF8E5'; context.fillRect(cx - Math.round(pip * .45), y - Math.round(pip * .45), Math.max(1, Math.round(pip * .35)), Math.max(1, Math.round(pip * .35))); }
  }
}

/** Units at their tiles, except those an animation is currently posing elsewhere. */
function drawUnits(d: Draw, frame: AnimationFrame, camera: Camera) {
  const { context, centers, radius, scene } = d;
  const posed = new Set(frame.poses.map(pose => pose.unit.id));
  const pokemonTiles = new Set(scene.units.filter(item => item.unit.kind === 'pokemon').map(item => item.index));
  for (const item of scene.units) if (!posed.has(item.unit.id)) {
    if (item.hostile && d.onscreen(centers[item.index])) {
      const p = centers[item.index], size = Math.max(26, Math.min(54, radius * 1.75));
      context.beginPath();
      if (d.squash < 1) context.ellipse(p.x, p.y + size * .3, size * .42, size * .42 * d.squash * .55, 0, 0, Math.PI * 2);
      else context.ellipse(p.x, p.y + size * .2, size * .5, size * .42, 0, 0, Math.PI * 2);
      context.strokeStyle = '#10191B'; context.lineWidth = 5; context.stroke();
      context.strokeStyle = '#E5554A'; context.lineWidth = 2.5; context.stroke();
    }
    const shared = item.unit.kind !== 'pokemon' && pokemonTiles.has(item.index), base = centers[item.index];
    const p = shared ? { x: base.x + radius * .48, y: base.y + radius * .42 } : base;
    if (item.max) maxAura(d, p, item.max.phase);
    const scale = shared ? .55 : item.max ? MAX_SCALE : 1;
    if (item.exhausted) {
      context.save(); context.filter = 'grayscale(1) brightness(.9)';
      unitMark(d, item.unit, p, item.actionLeft, item.enraged, scale);
      context.restore();
      if (d.onscreen(p)) drawIcon(context, 'exhausted', p.x + radius * .45, p.y - radius * .7, Math.max(12, radius * .5));
    } else unitMark(d, item.unit, p, item.actionLeft, item.enraged, scale);
    if (item.max) maxShieldPips(d, p, item.max);
    if (item.status && d.onscreen(p)) {
      const q = { x: p.x - radius * .55, y: p.y - radius * .55 }, size = Math.max(8, radius * .28);
      context.beginPath(); context.arc(q.x, q.y, size, 0, Math.PI * 2); context.fillStyle = '#B15AD6'; context.fill();
      context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(d, item.status, q, '#FFF8E5', size * 1.1);
    }
    if ((item.rank || item.promotable) && d.onscreen(p)) rankMark(d, p, item.rank ?? 0, item.promotable ?? false);
    if (item.hp) unitHpBar(d, p, item.hp, item.max);
  }
  for (const pose of frame.poses) {
    const p = toScreen(pose.position, camera), point = { x: p.x + d.shift, y: p.y - d.liftAt(pose.position) };
    if (pose.evolution) { evolvingUnit(d, pose, point); continue; }
    if (pose.alpha !== undefined || pose.grey) {
      if (!d.onscreen(point)) continue;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, pose.alpha ?? 1));
      if (pose.grey) context.filter = 'grayscale(1) brightness(.8)';
      unitMark(d, pose.unit, point);
      context.restore();
      continue;
    }
    const posedItem = scene.units.find(item => item.unit.id === pose.unit.id);
    if (posedItem?.max) maxAura(d, point, posedItem.max.phase);
    unitMark(d, pose.unit, point, undefined, false, pose.scale ?? (posedItem?.max ? MAX_SCALE : 1));
    if (posedItem?.max) maxShieldPips(d, point, posedItem.max);
    if (posedItem?.hp) unitHpBar(d, point, posedItem.hp, posedItem.max);
  }
}

function evolvingUnit(d: Draw, pose: UnitPose, point: Point) {
  if (!d.onscreen(point)) return;
  const { context, radius } = d, evolution = pose.evolution!, scale = pose.scale ?? 1, revealed = evolution.elapsed >= EVOLUTION_REVEAL_AT;
  const fade = revealed ? Math.max(0, 1 - (evolution.elapsed - EVOLUTION_REVEAL_AT) / 600) : Math.min(1, evolution.elapsed / 250);
  context.save();
  context.globalAlpha = .6 * fade;
  context.beginPath(); context.arc(point.x, point.y - radius * .05, radius * 1.15, 0, Math.PI * 2); context.fillStyle = '#0A1430'; context.fill();
  const spin = evolution.elapsed / 1400 * Math.PI;
  context.globalAlpha = .3 * fade; context.fillStyle = revealed ? '#FFE08A' : '#CFEFF7';
  for (let ray = 0; ray < 8; ray++) {
    const angle = spin + ray * Math.PI / 4;
    context.beginPath(); context.moveTo(point.x, point.y);
    context.lineTo(point.x + Math.cos(angle - .12) * radius * 1.15, point.y + Math.sin(angle - .12) * radius * 1.15);
    context.lineTo(point.x + Math.cos(angle + .12) * radius * 1.15, point.y + Math.sin(angle + .12) * radius * 1.15);
    context.closePath(); context.fill();
  }
  context.restore();
  unitMark(d, pose.unit, point, undefined, false, scale);
  if (evolution.white > 0 && pose.unit.kind === 'pokemon') {
    const size = Math.max(26, Math.min(54, radius * 1.75)) * scale;
    context.save(); context.globalAlpha = Math.min(1, evolution.white);
    drawPokemonSilhouette(context, pose.unit.speciesId, Math.round(point.x - size * .54), Math.round(point.y - size * .62), Math.round(size * 1.08));
    context.restore();
  }
}

function cityBanner(d: Draw, city: SceneCity, p: Point, size: number) {
  const { context, radius } = d;
  const height = Math.max(19, Math.min(26, radius * .8));
  context.font = `600 ${Math.max(12, Math.round(height * .62))}px ${FONT_UI}`;
  const nameWidth = context.measureText(city.name).width;
  const width = height + (city.population !== undefined ? height : 0) + nameWidth + height * .55 + (city.capital ? height * .85 : 0) + (city.wonders ? height * .85 : 0);
  const left = p.x - width / 2, top = p.y - size * .66 - height;
  context.beginPath(); context.roundRect(left, top, width, height, height / 2);
  context.fillStyle = '#14211FE6'; context.fill();
  context.strokeStyle = ownerColor(city.ownerId); context.lineWidth = 2; context.stroke();
  const square = { x: left + height / 2, y: top + height / 2 };
  factionRect(d, city.ownerId, square, height - 4, (height - 4) / 2);
  context.strokeStyle = '#FFFDF7'; context.lineWidth = 1; context.stroke();
  centeredText(d, city.ownerId === null ? '爪' : String(city.ownerId + 1), { x: square.x, y: square.y + .3 }, '#FFFDF7', (height - 4) * .65);
  let cursor = left + height;
  if (city.population !== undefined) {
    context.beginPath(); context.arc(cursor + height * .48, top + height / 2, height * .38, 0, Math.PI * 2);
    context.fillStyle = '#F2E7C9'; context.fill();
    drawPixelNumber(context, String(city.population), cursor + height * .48, top + height / 2, height * .42, '#14211F');
    cursor += height;
  }
  context.fillStyle = '#FFF8E5'; context.textAlign = 'left'; context.textBaseline = 'middle';
  context.fillText(city.name, cursor + height * .15, top + height / 2 + .5);
  cursor += nameWidth + height * .4;
  if (city.capital) { drawIcon(context, 'star', cursor + height * .35, top + height / 2, height * .7); cursor += height * .85; }
  if (city.wonders) drawIcon(context, 'crown', cursor + height * .35, top + height / 2, height * .7);
  if (city.hp && city.hp.current < city.hp.max) {
    const barTop = top + height + 2;
    context.fillStyle = '#14211FD9'; context.fillRect(left + 4, barTop, width - 8, 4);
    context.fillStyle = city.hp.current * 2 < city.hp.max ? '#E07A6D' : '#72C99E';
    context.fillRect(left + 5, barTop + 1, (width - 10) * city.hp.current / city.hp.max, 2);
  }
}

function drawBanners(d: Draw) {
  const size = citySize(d.radius) * (d.squash < 1 ? 1.3 : 1);
  for (const city of d.scene.cities) if (d.onscreen(d.centers[city.index])) cityBanner(d, city, d.centers[city.index], size);
}

/** Move range, attack/capture targets and district placement sites. */
function drawInteraction(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const index of scene.reachable) if (d.onscreen(centers[index])) {
    const p = centers[index];
    polygon(d, p);
    context.fillStyle = '#42B99626';
    context.fill();
    context.strokeStyle = '#75D2AE40';
    context.lineWidth = 1;
    context.stroke();
    context.beginPath();
    context.arc(p.x, p.y, Math.max(2, radius * .1), 0, Math.PI * 2);
    context.fillStyle = '#D5F0C9';
    context.fill();
    context.strokeStyle = '#245A49'; context.lineWidth = 1.5; context.stroke();
  }
  for (const index of scene.attackArea) if (d.onscreen(centers[index])) { polygon(d, centers[index]); context.fillStyle = '#E5554A12'; context.fill(); }
  const outline = (edges: readonly { index: number; direction: number }[], color: string, width: number, dash: number[]) => {
    context.setLineDash(dash);
    for (const pass of [{ stroke: '#0A1214D9', width: width + 3 }, { stroke: color, width }]) for (const edge of edges) if (d.onscreen(centers[edge.index])) {
      edgeLine(d, edge.index, edge.direction); context.strokeStyle = pass.stroke; context.lineWidth = pass.width; context.lineCap = 'round'; context.stroke();
    }
    context.setLineDash([]); context.lineCap = 'butt';
  };
  outline(scene.attackEdges, '#FF6B5E', Math.max(2, radius * .09), [Math.max(5, radius * .28), Math.max(3, radius * .16)]);
  outline(scene.moveEdges, '#7FE3FF', Math.max(2.5, radius * .11), []);
  for (const target of scene.targets) if (d.onscreen(centers[target.index])) {
    const p = centers[target.index], capture = target.mode === 'capture';
    polygon(d, p);
    context.fillStyle = capture ? '#85500030' : '#9B383333';
    context.fill();
    context.setLineDash([4, 3]);
    context.strokeStyle = target.pending ? '#FFFDF7' : capture ? '#C18412' : '#D77D75';
    context.lineWidth = target.pending ? 3 : 2;
    context.stroke();
    context.setLineDash([]);
    centeredText(d, capture ? '球' : '×', { x: p.x - radius * .45, y: p.y + radius * .4 }, capture ? '#855000' : '#9B3833', radius * .38);
  }
  for (const site of scene.placement) {
    if (!d.onscreen(centers[site.index])) continue;
    const p = centers[site.index];
    polygon(d, p); context.fillStyle = site.legal ? '#E6B85C26' : '#9B38331A'; context.fill();
    context.strokeStyle = site.selected ? '#FFFDF7' : site.legal ? '#F2C14E' : '#A66B65';
    context.lineWidth = site.selected ? 3 : site.legal ? 2 : 1; context.stroke();
    if (!site.legal) centeredText(d, '×', p, '#9B6460', radius * .25);
  }
}

/** Remembered-but-not-visible tiles get a hatched veil. Cached. */
function drawFog(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const index of scene.fog) {
    const p = centers[index];
    if (!d.onscreen(p)) continue;
    polygon(d, p);
    context.fillStyle = '#1018159E';
    context.fill();
    context.save();
    polygon(d, p);
    context.clip();
    context.strokeStyle = '#FFFDF71A';
    context.lineWidth = 1;
    for (let offset = -radius * 3; offset < radius * 3; offset += 8) {
      context.beginPath();
      context.moveTo(p.x - radius * 2 + offset, p.y + radius * 2);
      context.lineTo(p.x + radius * 2 + offset, p.y - radius * 2);
      context.stroke();
    }
    context.restore();
  }
}

function drawSelection(d: Draw, frame: AnimationFrame) {
  const { context, centers, radius, scene } = d;
  if (scene.selectedUnit !== null && !frame.poses.length) {
    const p = centers[scene.selectedUnit];
    const ring = () => { context.beginPath(); context.ellipse(p.x, p.y, radius * .76, radius * .76 * d.squash, 0, 0, Math.PI * 2); };
    ring(); context.strokeStyle = '#1D2B26'; context.lineWidth = 4; context.stroke();
    ring(); context.strokeStyle = '#F0B73F'; context.lineWidth = 2.5; context.stroke();
  }
  if (scene.inspected !== null && d.onscreen(centers[scene.inspected])) {
    const p = centers[scene.inspected];
    polygon(d, p); context.fillStyle = '#FFFDF71F'; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 5; context.stroke();
    context.strokeStyle = '#FFF3C4'; context.lineWidth = 2.5; context.stroke();
  }
  if (scene.cursor !== null && d.onscreen(centers[scene.cursor])) {
    const p = centers[scene.cursor];
    polygon(d, p);
    context.setLineDash([4, 3]); context.strokeStyle = '#7C4DFF'; context.lineWidth = 2; context.stroke(); context.setLineDash([]);
    context.beginPath(); context.arc(p.x, p.y, 2.5, 0, Math.PI * 2); context.fillStyle = '#7C4DFF'; context.fill();
  }
}

// ---------- Renderer ----------
export type MapRenderer = {
  /** Draws one frame. `frame` carries animation overrides (posed units, effects). */
  render(scene: MapScene, camera: Camera, frame?: AnimationFrame): RenderStats;
  /** Drops cached layers (e.g. after sprites finish loading). */
  invalidate(): void;
  /** ui-25d: the tile under a screen point (pixel-plane hex; fold with hexToIndex). Flat: worldToHex(toWorld(point)). */
  pick(point: Point, camera: Camera): Hex;
  /** ui-25d: a tile's lift in world px as last drawn (0 on the flat map or before the first frame). */
  lift(hex: Hex): number;
};

export function createCanvas2DRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): MapRenderer {
  const caching = options.cacheLayers ?? true, tilted = options.mode === '25d';
  let base: LayerCache | null = null, fog: LayerCache | null = null, generation = 0, lastView = '';
  let picking: { scene: MapScene; lifts: Float32Array } | null = null;
  const chunks = createChunkCache();
  return {
    invalidate() { generation++; chunks.clear(); },
    pick(point, camera) {
      if (!tilted || !picking) return worldToHex(toWorld(point, camera));
      return pickHex(point, camera, picking.scene, picking.lifts);
    },
    lift(hex) {
      const index = tilted && picking ? hexToIndex(hex, picking.scene) : null;
      return index === null ? 0 : picking!.lifts[index];
    },
    render(scene, camera, frame = EMPTY_FRAME) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const deviceWidth = Math.round(width * dpr), deviceHeight = Math.round(height * dpr);
      if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
      if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
      const shakeX = Math.round((frame.shake?.x ?? 0) * dpr), shakeY = Math.round((frame.shake?.y ?? 0) * dpr);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, deviceWidth, deviceHeight);
      context.setTransform(dpr, 0, 0, dpr, shakeX, shakeY);
      context.imageSmoothingEnabled = false;
      const radius = HEX_RADIUS * camera.zoom;
      const squash = tilted ? mapTilt() : 1, lifts = tilted ? sceneLifts(scene.tiles, scene.terrain, scene) : null;
      if (lifts) picking = { scene, lifts };
      const liftAt = (world: Point) => lifts ? liftAtWorld(world, scene, lifts) * camera.zoom : 0;
      const centers = scene.tiles.map((tile, index) => {
        const p = toScreen(tile.world, camera);
        return lifts ? { x: p.x, y: p.y - lifts[index] * camera.zoom } : p;
      });
      const onscreen = (p: Point) => p.x >= -radius && p.x <= width + radius && p.y >= -radius && p.y <= height + radius;
      const span = scene.wrap ? mapSpan(scene) * camera.zoom : 0;
      const copies = copyShifts(scene, camera, width, radius * 4).map(shift => ({
        shift, centers: shift === 0 ? centers : centers.map(p => ({ x: p.x + shift, y: p.y })) }));
      const budget = { particles: PARTICLE_CAP };
      const draws = (target: CanvasRenderingContext2D): Draw[] => copies.map(copy => ({
        context: target, width, height, radius, centers: copy.centers, onscreen, scene, shift: copy.shift, span, budget, squash, liftAt }));
      const every = (paint: (draw: Draw) => void) => (target: CanvasRenderingContext2D) => { for (const item of draws(target)) paint(item); };
      const all = draws(context);
      const indexOf = (hex: Hex) => hexToIndex(hex, scene);
      const view = `${generation}|${tilted ? `25d${squash}` : 'flat'}|${deviceWidth}x${deviceHeight}@${dpr}|${camera.x},${camera.y},${camera.zoom}`;

      const settled = view === lastView;
      lastView = view;
      const tilt25 = (paint: typeof drawBase25d) => (target: CanvasRenderingContext2D) => paint({ context: target, scene, lifts: lifts!, radius, zoom: camera.zoom, squash,
        copies: copies.map(copy => copy.centers), width, height, ownerColor });
      const layer = (cache: LayerCache | null, key: string, paint: ((draw: Draw) => void) | ((target: CanvasRenderingContext2D) => void), whole = false): { cache: LayerCache | null; stat: LayerStat } => {
        const painter = whole ? paint as (target: CanvasRenderingContext2D) => void : every(paint as (draw: Draw) => void);
        if (!caching) { painter(context); return { cache, stat: 'off' }; }
        if (cache?.key === key) { blit(context, cache.canvas, dpr, shakeX, shakeY); return { cache, stat: 'hit' }; }
        if (!settled) { painter(context); return { cache, stat: 'direct' }; }
        const built = cachedLayer(cache, key, deviceWidth, deviceHeight, dpr, painter);
        blit(context, built.cache.canvas, dpr, shakeX, shakeY);
        return { cache: built.cache, stat: 'miss' };
      };
      const baseKey = `${view}|${scene.tiles.map(tile => tile.biome ?? '-').join(',')}|${scene.terrain ? `${scene.terrain.hills.length}.${scene.terrain.rivers.length}.${scene.terrain.landmarks.length}` : ''}|${scene.territoryEdges.map(edge => `${edge.index}.${edge.direction}.${edge.ownerId}`).join(',')}`;
      let baseLayer: { cache: LayerCache | null; stat: LayerStat };
      if (tilted && caching) {
        const terrainKey = baseKey.slice(view.length);
        const stat = chunks.draw({ context, scene, lifts: lifts!, camera, squash, dpr, shifts: copies.map(copy => copy.shift), width, height, shakeX, shakeY,
          key: `${generation}|${terrainKey}`, settled, ownerColor });
        if (stat === 'direct') tilt25(drawBase25d)(context);
        baseLayer = { cache: null, stat };
      } else baseLayer = tilted ? layer(base, baseKey, tilt25(drawBase25d), true) : layer(base, baseKey, drawBase);
      base = baseLayer.cache;

      for (const item of all) drawFeatures(item);
      for (const item of all) drawTradeRoutes(item);
      for (const item of all) drawCities(item);
      for (const item of all) drawYields(item);
      for (const item of all) drawWeather(item, frame);
      drawNight(all[0], frame);
      if (tilted) {
        const level = Math.max(0, Math.min(1, frame.night ?? (scene.night ? 1 : 0)));
        if (level > 0) for (const item of all) for (const city of scene.cities) {
          const p = item.centers[city.index];
          if (onscreen(p)) drawTownLights(context, p, radius, ownerColor(city.ownerId), city.population, city.capital, city.wonders ?? 0, level);
        }
      }
      for (const item of all) drawUnits(item, frame, camera);
      for (const item of all) drawBanners(item);
      for (const item of all) drawInteraction(item);
      let fogStat: RenderStats['fog'] = 'none';
      if (scene.fog.length) {
        const fogLayer = tilted ? layer(fog, `${view}|${scene.fog.join(',')}`, tilt25(drawFog25d), true) : layer(fog, `${view}|${scene.fog.join(',')}`, drawFog);
        fog = fogLayer.cache; fogStat = fogLayer.stat;
      }
      for (const item of all) drawGoTo(item);
      for (const item of all) drawSelection(item, frame);
      if (scene.debug.overlay !== 'none') for (const item of all) drawDebug(item);
      for (const item of all) drawEffects(item, frame, indexOf, camera);
      return { base: baseLayer.stat, fog: fogStat, shake: { x: shakeX, y: shakeY } };
    },
  };
}
