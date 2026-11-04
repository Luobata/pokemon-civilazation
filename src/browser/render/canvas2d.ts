// Canvas 2D backend: draws a MapScene (plus an animation frame) for a camera.
// Layers are drawn in a fixed order; the two that rarely change (terrain/borders and fog)
// are cached as device-pixel images and reused until their inputs or the camera change.
import { DISTRICTS } from '../../content/districts.ts';
import { speciesDisplay } from '../../content/species.ts';
import { hexToIndex } from '../../core/hex.ts';
import type { Hex } from '../../core/hex.ts';
import { HEX_RADIUS, toScreen } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import { buildingSprite, drawPokemonSprite, drawSpritePath } from '../sprites.ts';
import { drawTerrain } from '../terrain.ts';
import { drawIcon, drawPixelNumber, drawYieldRow } from '../map-icons.ts';
import type { IconName } from '../map-icons.ts';
import type { MapScene, SceneCity, UnitMarkIdentity } from './scene.ts';
import { EMPTY_FRAME } from './animation.ts';
import type { AnimationFrame } from './animation.ts';

export const FACTIONS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
const DISTRICT_COLORS: Record<keyof typeof DISTRICTS, string> = {
  researchDistrict: '#83BCD0', gymDistrict: '#E07A6D', harborDistrict: '#4FA3B8', powerPlantDistrict: '#E6B85C', gardenDistrict: '#72C99E',
};
/** Yields are drawn on every known tile once a hex is at least this many CSS pixels in radius. */
export const YIELD_MIN_RADIUS = 16;
const corners = Array.from({ length: 6 }, (_, corner) => ({ x: Math.cos((corner * 60 - 30) * Math.PI / 180), y: Math.sin((corner * 60 - 30) * Math.PI / 180) }));
const edgeCorners = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

export type LayerName = 'base' | 'features' | 'cities' | 'yields' | 'weather' | 'units' | 'banners' | 'interaction' | 'fog' | 'selection' | 'debug' | 'effects';
/**
 * hit: reused the cached image. miss: rebuilt it (camera was still). direct: drawn straight to the
 * canvas because the camera is moving (rebuilding a cache every frame costs more than it saves).
 */
export type LayerStat = 'hit' | 'miss' | 'direct' | 'off';
export type RenderStats = { base: LayerStat; fog: LayerStat | 'none' };

/** Per-frame drawing state shared by the layer functions. */
type Draw = {
  context: CanvasRenderingContext2D; width: number; height: number; radius: number;
  centers: Point[]; onscreen(p: Point): boolean; scene: MapScene;
};

function polygon(d: Draw, p: Point) {
  const { context, radius } = d;
  context.beginPath();
  for (let corner = 0; corner < 6; corner++) {
    const x = p.x + radius * corners[corner].x, y = p.y + radius * corners[corner].y;
    if (corner === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
}
function centeredText(d: Draw, text: string, p: Point, color: string, size: number) {
  const { context } = d;
  context.fillStyle = color;
  context.font = `650 ${Math.max(9, size)}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, p.x, p.y);
}
export function ownerColor(ownerId: number | null) {
  return ownerId === null ? '#855000' : FACTIONS[ownerId] ?? '#5F6E66';
}
/** Faction swatch with a colour-blind-safe pattern; leaves its outline as the current path. */
function factionRect(d: Draw, ownerId: number | null, p: Point, size: number, corner: number) {
  const { context } = d;
  context.beginPath();
  context.roundRect(p.x - size / 2, p.y - size / 2, size, size, corner);
  context.fillStyle = ownerColor(ownerId);
  context.fill();
  if (ownerId === null || ownerId === 0) return;
  context.save();
  context.clip();
  context.strokeStyle = '#FFFDF766';
  context.fillStyle = '#FFFDF788';
  context.lineWidth = 1;
  const spacing = Math.max(5, size / 5);
  if (ownerId === 2) {
    for (let x = p.x - size / 2 + 3; x < p.x + size / 2; x += spacing)
      for (let y = p.y - size / 2 + 3; y < p.y + size / 2; y += spacing) {
        context.beginPath(); context.arc(x, y, 1.2, 0, Math.PI * 2); context.fill();
      }
  } else {
    for (let offset = -size; offset <= size; offset += spacing) {
      context.beginPath();
      context.moveTo(p.x - size + offset, p.y + size);
      context.lineTo(p.x + size + offset, p.y - size);
      if (ownerId === 3) { context.moveTo(p.x - size + offset, p.y - size); context.lineTo(p.x + size + offset, p.y + size); }
      context.stroke();
    }
  }
  context.restore();
  // Canvas save/restore does not restore paths; callers stroke the badge outline.
  context.beginPath();
  context.roundRect(p.x - size / 2, p.y - size / 2, size, size, corner);
}
function ownerBadge(d: Draw, ownerId: number | null, p: Point, size: number) {
  const badge = Math.max(13, size * .42), x = p.x + size * .32, y = p.y - size * .38;
  factionRect(d, ownerId, { x, y }, badge, badge / 2);
  d.context.strokeStyle = '#FFFDF7';
  d.context.lineWidth = 1;
  d.context.stroke();
  centeredText(d, ownerId === null ? '爪' : String(ownerId + 1), { x, y: y + .3 }, '#FFFDF7', badge * .65);
}
function edgeLine(d: Draw, index: number, direction: number) {
  const [a, b] = edgeCorners[direction], { context, centers, radius } = d;
  const startAngle = (a * 60 - 30) * Math.PI / 180, endAngle = (b * 60 - 30) * Math.PI / 180;
  context.beginPath();
  context.moveTo(centers[index].x + radius * Math.cos(startAngle), centers[index].y + radius * Math.sin(startAngle));
  context.lineTo(centers[index].x + radius * Math.cos(endAngle), centers[index].y + radius * Math.sin(endAngle));
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

/** Improvements, faith marks, resource badges, districts and construction marks. */
function drawFeatures(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const item of scene.improvements) {
    if (!d.onscreen(centers[item.index])) continue;
    drawIcon(context, item.kind, centers[item.index].x - radius * .5, centers[item.index].y + radius * .08, Math.max(10, radius * .58), item.dim ? .6 : 1);
  }
  for (const mark of scene.faith) {
    if (!d.onscreen(centers[mark.index])) continue;
    const p = { x: centers[mark.index].x - radius * .6, y: centers[mark.index].y - radius * .5 }, size = Math.max(8, radius * .28);
    context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2); context.fillStyle = mark.color; context.fill();
    context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
    centeredText(d, mark.mark, p, '#FFF8E5', size * 1.1);
  }
  // Round badge at the top of the hex; luxury (rare berry) badges get a double gold ring.
  for (const item of scene.badges) {
    const center = centers[item.index];
    if (d.onscreen(center)) {
      const size = Math.max(12, radius * .66), p = { x: center.x, y: center.y - radius * .5 };
      context.save();
      if (item.dim) context.globalAlpha = .55;
      context.beginPath(); context.arc(p.x, p.y, size * .56, 0, Math.PI * 2);
      context.fillStyle = item.luxury ? '#4A3A16F0' : '#14211FD9'; context.fill();
      context.strokeStyle = item.ring; context.lineWidth = item.luxury ? 2.5 : 1.5; context.stroke();
      if (item.luxury) {
        context.beginPath(); context.arc(p.x, p.y, size * .56 + 3, 0, Math.PI * 2); context.strokeStyle = '#14211FCC'; context.lineWidth = 2; context.stroke();
        // Four-point sparkle marks luxuries at a glance, even at small zoom.
        const sx = p.x + size * .48, sy = p.y - size * .44, r = Math.max(3, size * .2);
        context.beginPath(); context.moveTo(sx, sy - r); context.lineTo(sx + r * .3, sy - r * .3); context.lineTo(sx + r, sy); context.lineTo(sx + r * .3, sy + r * .3);
        context.lineTo(sx, sy + r); context.lineTo(sx - r * .3, sy + r * .3); context.lineTo(sx - r, sy); context.lineTo(sx - r * .3, sy - r * .3); context.closePath();
        context.fillStyle = '#FFF3B0'; context.fill(); context.strokeStyle = '#14211F'; context.lineWidth = 1; context.stroke();
      }
      if (item.kind === 'icon') drawIcon(context, item.icon as IconName, p.x, p.y, size * .74);
      else if (item.kind === 'legend') drawSpritePath(context, item.path, Math.round(p.x - size * .5), Math.round(p.y - size * .55), Math.round(size));
      else {
        if (!drawPokemonSprite(context, item.speciesId, Math.round(p.x - size * .55), Math.round(p.y - size * .62), Math.round(size * 1.1))) centeredText(d, item.fallback, p, '#FFF8E5', size * .5);
      }
      context.restore();
    }
    if (item.kind === 'sprite' && item.crown && d.onscreen(center)) drawIcon(context, 'crown', center.x, center.y - radius * .98, Math.max(10, radius * .5));
  }
  // A district occupies its whole tile, so it is drawn as a building filling the hex.
  for (const item of scene.districts) {
    if (!d.onscreen(centers[item.index])) continue;
    const p = centers[item.index], size = Math.max(16, radius * 1.12), progress = item.progress;
    context.save();
    polygon(d, p); context.fillStyle = `${item.ownerId === null ? '#65706B' : DISTRICT_COLORS[item.kind]}${progress === undefined ? '40' : '1F'}`; context.fill();
    context.globalAlpha = item.memory ? .55 : progress !== undefined ? .45 : item.ownerId === null ? .6 : 1;
    drawIcon(context, item.kind, p.x, p.y - radius * .08, size);
    context.globalAlpha = 1;
    if (progress !== undefined) {
      const barWidth = radius * 1.1, barY = p.y + radius * .5;
      context.fillStyle = '#14211FD9'; context.fillRect(p.x - barWidth / 2 - 1, barY - 1, barWidth + 2, 5);
      context.fillStyle = DISTRICT_COLORS[item.kind]; context.fillRect(p.x - barWidth / 2, barY, barWidth * progress / 100, 3);
      drawIcon(context, 'construction', p.x + radius * .5, p.y - radius * .45, Math.max(9, radius * .4));
    }
    if (item.ownerId === null) centeredText(d, '停', { x: p.x, y: p.y + radius * .55 }, '#FFF8E5', Math.max(8, radius * .32));
    if (item.memory) { polygon(d, p); context.setLineDash([3, 2]); context.strokeStyle = '#D4DED5AA'; context.lineWidth = 1; context.stroke(); context.setLineDash([]); }
    context.restore();
  }
  for (const site of scene.constructionSites) {
    if (!d.onscreen(centers[site.index])) continue;
    const p = { x: centers[site.index].x - radius * .48, y: centers[site.index].y + radius * .45 }, size = Math.max(8, radius * .28);
    context.beginPath();
    if (site.category === 'district') context.roundRect(p.x - size, p.y - size, size * 2, size * 2, 2);
    else { context.moveTo(p.x, p.y - size); context.lineTo(p.x + size, p.y + size); context.lineTo(p.x - size, p.y + size); context.closePath(); }
    context.fillStyle = ownerColor(site.ownerId); context.fill(); context.strokeStyle = '#FFFDF7'; context.lineWidth = 1; context.stroke();
    centeredText(d, '施', p, '#FFF8E5', size);
  }
}

const citySize = (radius: number) => Math.max(28, Math.min(42, radius * 1.65));
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
    // City centre plaza in the owner's colour, then the buildings this city has actually built
    // (own cities only: foreign building lists are not part of the PlayerView).
    polygon(d, p); context.fillStyle = `${ownerColor(city.ownerId)}2E`; context.fill();
    const slots = [[-.56, .3], [.56, .3], [-.5, -.28], [.5, -.28], [0, .58]] as const;
    for (const [slot, id] of city.buildings.slice(0, slots.length).entries()) {
      const art = buildingSprite(id);
      if (!art) continue;
      const width = radius * .66, height = width * 80 / 96;
      context.drawImage(art, Math.round(p.x + slots[slot][0] * radius - width / 2), Math.round(p.y + slots[slot][1] * radius - height / 2), Math.round(width), Math.round(height));
    }
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
      drawYieldRow(context, row.yields, centers[row.index].x, centers[row.index].y + radius * .6, yieldSize, row.workable ? 1 : .4);
    }
  }
  for (const index of scene.workedTiles) {
    if (!d.onscreen(centers[index])) continue;
    polygon(d, centers[index]); context.strokeStyle = '#F2C14EAA'; context.lineWidth = 1.5; context.stroke();
    drawIcon(context, 'citizen', centers[index].x - radius * .55, centers[index].y - radius * .42, Math.max(9, radius * .38));
  }
}

/** Weather tints its radius; night dims the whole map. */
function drawWeather(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const field of scene.weather) {
    for (const index of field.tiles) {
      if (!d.onscreen(centers[index])) continue;
      polygon(d, centers[index]); context.fillStyle = `${field.color}33`; context.fill();
    }
    if (field.center !== null && d.onscreen(centers[field.center])) {
      const p = { x: centers[field.center].x + radius * .6, y: centers[field.center].y + radius * .45 }, size = Math.max(9, radius * .32);
      context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2); context.fillStyle = field.color; context.fill();
      context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(d, field.mark, p, '#10191B', size * 1.2);
    }
  }
  if (scene.night) { context.fillStyle = '#0A143066'; context.fillRect(0, 0, d.width, d.height); }
}

function unitMark(d: Draw, unit: UnitMarkIdentity, point: Point, actionLeft?: number, enraged = false) {
  if (!d.onscreen(point)) return;
  const { context } = d;
  const size = Math.max(26, Math.min(54, d.radius * 1.75));
  context.beginPath();
  context.ellipse(point.x, point.y + size * .32, size * .37, size * .15, 0, 0, Math.PI * 2);
  context.fillStyle = '#071114A6'; context.fill();
  const marker = size * .58;
  factionRect(d, unit.ownerId, { x: point.x, y: point.y + size * .2 }, marker, marker / 2);
  context.strokeStyle = '#132625'; context.lineWidth = 3; context.stroke();
  context.beginPath();
  context.arc(point.x, point.y + size * .2, marker * .43, 0, Math.PI * 2);
  context.strokeStyle = actionLeft === 0 ? '#81908A' : '#F2E7C9'; context.lineWidth = 1.2; context.stroke();
  if (unit.kind === 'pokemon') {
    if (!drawPokemonSprite(context, unit.speciesId, Math.round(point.x - size * .54), Math.round(point.y - size * .62), Math.round(size * 1.08))) centeredText(d, speciesDisplay(unit.speciesId).abbreviation, point, '#FFF3D4', size * .42);
  } else {
    const pixel = size / 24;
    const block = (color: string, x: number, y: number, width: number, height: number) => {
      context.fillStyle = color;
      context.fillRect(Math.round(point.x + x * pixel), Math.round(point.y + y * pixel), Math.ceil(width * pixel), Math.ceil(height * pixel));
    };
    block('#263B39', -5, 7, 4, 4);
    block('#263B39', 2, 7, 4, 4);
    block('#D8C492', -6, -1, 12, 10);
    block('#47685B', -5, 0, 10, 8);
    block('#B88857', -8, 0, 3, 7);
    block('#E8BE91', -4, -7, 8, 7);
    block('#6A4935', -5, -9, 10, 3);
    block('#D9A857', -6, -7, 12, 2);
    block('#263B39', 1, -4, 2, 2);
    block('#F0E5C4', 7, -14, 1.5, 22);
    block(ownerColor(unit.ownerId), 8.5, -13, 8, 5);
    block('#F2C14E', 8.5, -8, 5, 1.5);
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

/** Units at their tiles, except those an animation is currently posing elsewhere. */
function drawUnits(d: Draw, frame: AnimationFrame, camera: Camera) {
  const { context, centers, radius, scene } = d;
  const posed = new Set(frame.poses.map(pose => pose.unit.id));
  for (const item of scene.units) if (!posed.has(item.unit.id)) {
    if (item.hostile && d.onscreen(centers[item.index])) {
      const p = centers[item.index], size = Math.max(26, Math.min(54, radius * 1.75));
      context.beginPath(); context.ellipse(p.x, p.y + size * .2, size * .5, size * .42, 0, 0, Math.PI * 2);
      context.strokeStyle = '#10191B'; context.lineWidth = 5; context.stroke();
      context.strokeStyle = '#E5554A'; context.lineWidth = 2.5; context.stroke();
    }
    unitMark(d, item.unit, centers[item.index], item.actionLeft, item.enraged);
    const p = centers[item.index];
    if (item.status && d.onscreen(p)) {
      const q = { x: p.x - radius * .55, y: p.y - radius * .55 }, size = Math.max(8, radius * .28);
      context.beginPath(); context.arc(q.x, q.y, size, 0, Math.PI * 2); context.fillStyle = '#B15AD6'; context.fill();
      context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(d, item.status, q, '#FFF8E5', size * 1.1);
    }
    if ((item.rank || item.promotable) && d.onscreen(p)) rankMark(d, p, item.rank ?? 0, item.promotable ?? false);
  }
  for (const pose of frame.poses) unitMark(d, pose.unit, toScreen(pose.position, camera));
}

/** Civilization-style banner: faction mark, population (own cities), name, capital star, HP when damaged. */
function cityBanner(d: Draw, city: SceneCity, p: Point, size: number) {
  const { context, radius } = d;
  const height = Math.max(16, Math.min(24, radius * .8));
  context.font = `650 ${Math.round(height * .62)}px system-ui, sans-serif`;
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
  for (const city of d.scene.cities) if (d.onscreen(d.centers[city.index])) cityBanner(d, city, d.centers[city.index], citySize(d.radius));
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
  // Attack reach: faint red wash plus a dashed red contour; movement range: a solid cyan contour on top.
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
    context.beginPath(); context.arc(p.x, p.y, radius * .76, 0, Math.PI * 2);
    context.strokeStyle = '#1D2B26'; context.lineWidth = 4; context.stroke();
    context.beginPath(); context.arc(p.x, p.y, radius * .76, 0, Math.PI * 2);
    context.strokeStyle = '#F0B73F'; context.lineWidth = 2.5; context.stroke();
  }
  if (scene.inspected !== null && d.onscreen(centers[scene.inspected])) {
    // Inspected tile: bright double outline with a soft fill, visible on every terrain.
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

function drawDebug(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const cell of scene.debug.vision) {
    if (!d.onscreen(centers[cell.index])) continue;
    polygon(d, centers[cell.index]); context.fillStyle = cell.visible ? '#38E0A438' : '#E0B03838'; context.fill();
  }
  for (const label of scene.debug.labels) {
    const p = centers[label.index];
    if (d.onscreen(p)) centeredText(d, label.text, label.offset ? { x: p.x, y: p.y + radius * .75 } : p, '#fff', 9);
  }
}

function drawEffects(d: Draw, frame: AnimationFrame, indexOf: (hex: Hex) => number | null) {
  const { context, centers, radius } = d;
  for (const effect of frame.effects) {
    const index = indexOf(effect.position);
    if (index === null) continue;
    const p = centers[index];
    if (!d.onscreen(p)) continue;
    if (effect.kind === 'tap') {
      const grow = .35 + effect.progress * .75;
      context.save(); context.globalAlpha = 1 - effect.progress;
      context.beginPath(); context.arc(p.x, p.y, radius * grow, 0, Math.PI * 2);
      context.strokeStyle = effect.tone === 'error' ? '#E07A6D' : '#FFF3C4'; context.lineWidth = 3; context.stroke();
      context.restore();
    } else if (effect.kind === 'battle') {
      if (effect.progress < .5) {
        polygon(d, p);
        context.fillStyle = `rgb(255 253 247 / ${45 - effect.progress * 60}%)`;
        context.fill();
      }
      centeredText(d, `−${effect.damage}`, { x: p.x, y: p.y - radius * (.7 + effect.progress * .5) }, '#F4E0DB', radius * .65);
      if (effect.counterDamage) centeredText(d, `反击 −${effect.counterDamage}`, { x: p.x, y: p.y - radius * .15 }, '#FFFDF7', radius * .35);
    } else if (effect.kind === 'capture') {
      const offset = effect.progress < .45 ? (1 - effect.progress / .45) * radius * 1.5 : 0;
      context.beginPath(); context.arc(p.x, p.y - offset, radius * .32, 0, Math.PI * 2);
      context.fillStyle = '#9B3833'; context.fill();
      context.strokeStyle = '#FFFDF7'; context.lineWidth = 2; context.stroke();
      centeredText(d, effect.progress < .45 ? '球' : effect.success ? '成功' : '失败', { x: p.x, y: p.y - offset - radius }, '#FFFDF7', radius * .42);
    } else {
      context.beginPath(); context.arc(p.x, p.y, radius * (.55 + effect.progress * .45), 0, Math.PI * 2);
      context.strokeStyle = '#F0B73F'; context.lineWidth = 3 * (1 - effect.progress) + 1; context.stroke();
      centeredText(d, '进化', { x: p.x, y: p.y - radius }, '#F0B73F', radius * .48);
    }
  }
}

// ---------- Renderer ----------
export type MapRenderer = {
  /** Draws one frame. `frame` carries animation overrides (posed units, effects). */
  render(scene: MapScene, camera: Camera, frame?: AnimationFrame): RenderStats;
  /** Drops cached layers (e.g. after sprites finish loading). */
  invalidate(): void;
};

type LayerCache = { key: string; canvas: HTMLCanvasElement };

/** Cached device-pixel layer; `paint` draws it in CSS pixels with the DPR transform applied. */
function cachedLayer(cache: LayerCache | null, key: string, deviceWidth: number, deviceHeight: number, dpr: number,
  paint: (context: CanvasRenderingContext2D) => void): { cache: LayerCache } {
  const canvas = cache?.canvas ?? document.createElement('canvas');
  if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
  if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
  const context = canvas.getContext('2d')!;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, deviceWidth, deviceHeight);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  paint(context);
  return { cache: { key, canvas } };
}

export type RendererOptions = {
  /** Cache the terrain/border and fog layers. Off draws every layer directly (reference output). */
  cacheLayers?: boolean;
};

export function createCanvas2DRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): MapRenderer {
  const caching = options.cacheLayers ?? true;
  let base: LayerCache | null = null, fog: LayerCache | null = null, generation = 0, lastView = '';
  return {
    invalidate() { generation++; },
    render(scene, camera, frame = EMPTY_FRAME) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const deviceWidth = Math.round(width * dpr), deviceHeight = Math.round(height * dpr);
      if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
      if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, width, height);
      const radius = HEX_RADIUS * camera.zoom;
      const centers = scene.tiles.map(tile => toScreen(tile.world, camera));
      const onscreen = (p: Point) => p.x >= -radius && p.x <= width + radius && p.y >= -radius && p.y <= height + radius;
      const draw = (target: CanvasRenderingContext2D): Draw => ({ context: target, width, height, radius, centers, onscreen, scene });
      const d = draw(context);
      const indexOf = (hex: Hex) => hexToIndex(hex, scene);
      const view = `${generation}|${deviceWidth}x${deviceHeight}@${dpr}|${camera.x},${camera.y},${camera.zoom}`;

      // Only (re)build caches once the camera has held still for a frame.
      const settled = view === lastView;
      lastView = view;
      const layer = (cache: LayerCache | null, key: string, paint: (draw: Draw) => void): { cache: LayerCache | null; stat: LayerStat } => {
        if (!caching) { paint(d); return { cache, stat: 'off' }; }
        if (cache?.key === key) { blit(context, cache.canvas, dpr); return { cache, stat: 'hit' }; }
        if (!settled) { paint(d); return { cache, stat: 'direct' }; }
        const built = cachedLayer(cache, key, deviceWidth, deviceHeight, dpr, target => paint(draw(target)));
        blit(context, built.cache.canvas, dpr);
        return { cache: built.cache, stat: 'miss' };
      };
      const baseKey = `${view}|${scene.tiles.map(tile => tile.biome ?? '-').join(',')}|${scene.territoryEdges.map(edge => `${edge.index}.${edge.direction}.${edge.ownerId}`).join(',')}`;
      const baseLayer = layer(base, baseKey, drawBase);
      base = baseLayer.cache;

      drawFeatures(d);
      drawCities(d);
      drawYields(d);
      drawWeather(d);
      drawUnits(d, frame, camera);
      drawBanners(d);
      drawInteraction(d);
      let fogStat: RenderStats['fog'] = 'none';
      if (scene.fog.length) {
        const fogLayer = layer(fog, `${view}|${scene.fog.join(',')}`, drawFog);
        fog = fogLayer.cache; fogStat = fogLayer.stat;
      }
      drawSelection(d, frame);
      if (scene.debug.overlay !== 'none') drawDebug(d);
      drawEffects(d, frame, indexOf);
      return { base: baseLayer.stat, fog: fogStat };
    },
  };
}

function blit(context: CanvasRenderingContext2D, layer: HTMLCanvasElement, dpr: number) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer, 0, 0);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
