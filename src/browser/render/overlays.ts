// Shared map renderer constants, layer caching, drawing primitives, and overlays used by both Canvas2D and painted backends.
import { DISTRICTS } from '../../content/districts.ts';
import type { Hex } from '../../core/hex.ts';
import { HEX_RADIUS, toScreen } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import { drawIcon } from '../map-icons.ts';
import type { IconName } from '../map-icons.ts';
import { FONT_UI } from '../theme.ts';
import { EVOLUTION_REVEAL_AT, SWEEP_MS, SWEEP_RING_MS } from './animation.ts';
import type { AnimationFrame, MapEffect, NumberTone } from './animation.ts';
import type { RenderMode } from './projection.ts';
import type { MapScene, SceneWeather } from './scene.ts';
import { drawSpeciesSprite, drawSpriteFile } from './sprite-draw.ts';

export const FACTIONS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
export const DISTRICT_COLORS: Record<keyof typeof DISTRICTS, string> = {
  researchDistrict: '#83BCD0', gymDistrict: '#E07A6D', harborDistrict: '#4FA3B8', powerPlantDistrict: '#E6B85C', gardenDistrict: '#72C99E',
};
/** Yields are drawn on every known tile once a hex is at least this many CSS pixels in radius. */
export const YIELD_MIN_RADIUS = 16;

const MAX_PINK = '#F0507A', MAX_RED = '#E5304F', MAX_PHASE_TWO = '#A259E0', MAX_SHIELD = '#F0709A';
/** The Max raid palette, shared across flat, 2.5D, and painted backends. */
export const MAX_COLORS = { pink: MAX_PINK, red: MAX_RED, phaseTwo: MAX_PHASE_TWO, shield: MAX_SHIELD } as const;
export const MAX_SCALE = 1.5;

export const HEX_CORNERS = Array.from({ length: 6 }, (_, corner) => ({
  x: Math.cos((corner * 60 - 30) * Math.PI / 180),
  y: Math.sin((corner * 60 - 30) * Math.PI / 180),
}));
const edgeCorners = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

export type LayerName = 'base' | 'features' | 'cities' | 'yields' | 'weather' | 'units' | 'banners' | 'interaction' | 'fog' | 'selection' | 'debug' | 'effects';
/**
 * hit: reused the cached image. miss: rebuilt it (camera was still). direct: drawn straight to the
 * canvas because the camera is moving (rebuilding a cache every frame costs more than it saves).
 */
export type LayerStat = 'hit' | 'miss' | 'direct' | 'off';
/** `shake`: the whole-frame offset applied this frame, in device pixels. */
export type RenderStats = { base: LayerStat; fog: LayerStat | 'none'; shake: Point };

/** Per-frame drawing state shared by the layer functions. */
export type Draw = {
  context: CanvasRenderingContext2D; width: number; height: number; radius: number;
  centers: Point[]; onscreen(p: Point): boolean; scene: MapScene;
  /** v22 wrapping maps: screen-x offset of the map copy being drawn, and the width of one copy (0 on flat maps). */
  shift: number; span: number;
  /** Particles still allowed this frame, shared by every map copy (PARTICLE_CAP per frame). */
  budget: { particles: number };
  /** ui-25d: vertical squash of ground shapes (1 on the flat map) and the screen-px lift under a world point (0 on the flat map). */
  squash: number; liftAt(world: Point): number;
};

export type LayerCache = { key: string; canvas: HTMLCanvasElement };

export type RendererOptions = {
  /** Cache the terrain/border and fog layers. Off draws every layer directly (reference output). */
  cacheLayers?: boolean;
  /** ui-25d: '25d' draws tiles as lifted columns with billboards (needs `applyRenderMode('25d')`); default 'flat'. */
  mode?: RenderMode;
};

/** Upper bound on combat particles drawn in one frame, all map copies together. */
export const PARTICLE_CAP = 180;
/** Fixed particle spray (golden-angle directions, varied speed and size), reused by every impact: no allocation per frame. */
const PARTICLES = Array.from({ length: 14 }, (_, index) => {
  const angle = index * 2.39996 + .4;
  return { dx: Math.cos(angle), dy: Math.sin(angle), speed: .55 + (index * 37 % 11) / 18, size: .1 + (index % 3) * .03, white: index % 4 === 0 };
});

export const citySize = (radius: number) => Math.max(28, Math.min(42, radius * 1.65));

export function ownerColor(ownerId: number | null) {
  return ownerId === null ? '#855000' : FACTIONS[ownerId] ?? '#5F6E66';
}

export function polygon(d: Draw, p: Point) {
  const { context, radius } = d;
  context.beginPath();
  for (let corner = 0; corner < 6; corner++) {
    const x = p.x + radius * HEX_CORNERS[corner].x, y = p.y + radius * HEX_CORNERS[corner].y * d.squash;
    if (corner === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
}

export function centeredText(d: Draw, text: string, p: Point, color: string, size: number) {
  const { context } = d;
  context.fillStyle = color;
  context.font = `600 ${Math.max(10, size)}px ${FONT_UI}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, p.x, p.y);
}

/** Text with a dark outline (stroke under fill), readable on every terrain; no shadowBlur. */
export function outlinedText(d: Draw, text: string, p: Point, color: string, size: number, outline = '#10191B') {
  const { context } = d;
  context.font = `800 ${Math.max(11, size)}px ${FONT_UI}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2.5, size * .16);
  context.strokeStyle = outline;
  context.strokeText(text, p.x, p.y);
  context.fillStyle = color;
  context.fillText(text, p.x, p.y);
}

/** Faction swatch with a colour-blind-safe pattern; leaves its outline as the current path. */
export function factionRect(d: Draw, ownerId: number | null, p: Point, size: number, corner: number) {
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

export function edgeLine(d: Draw, index: number, direction: number) {
  const [a, b] = edgeCorners[direction], { context, centers, radius } = d;
  const startAngle = (a * 60 - 30) * Math.PI / 180, endAngle = (b * 60 - 30) * Math.PI / 180;
  context.beginPath();
  context.moveTo(centers[index].x + radius * Math.cos(startAngle), centers[index].y + radius * Math.sin(startAngle) * d.squash);
  context.lineTo(centers[index].x + radius * Math.cos(endAngle), centers[index].y + radius * Math.sin(endAngle) * d.squash);
}

/** Cached device-pixel layer; `paint` draws it in CSS pixels with the DPR transform applied. */
export function cachedLayer(cache: LayerCache | null, key: string, deviceWidth: number, deviceHeight: number, dpr: number,
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

/** Copies a cached device-pixel layer; `dx`/`dy` is the frame's shake in device pixels. */
export function blit(context: CanvasRenderingContext2D, layer: HTMLCanvasElement, dpr: number, dx: number, dy: number) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(layer, dx, dy);
  context.setTransform(dpr, 0, 0, dpr, dx, dy);
}

/** Improvements, faith marks, resource badges, districts and construction marks. */
export function drawFeatures(d: Draw) {
  const { context, centers, radius, scene } = d;
  for (const item of scene.improvements) {
    if (!d.onscreen(centers[item.index])) continue;
    const x = centers[item.index].x - radius * .5, y = centers[item.index].y + radius * .08, size = Math.max(10, radius * .58);
    // v23: a pillaged improvement is drawn greyed with a red cross over it (on every wrapped copy, like the icon itself).
    drawIcon(context, item.kind, x, y, size, item.damaged ? (item.dim ? .35 : .5) : item.dim ? .6 : 1);
    if (item.damaged) drawIcon(context, 'damaged', x, y, size * .8, item.dim ? .6 : 1);
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
      else if (item.kind === 'legend') drawSpriteFile(context, item.path, Math.round(p.x - size * .5), Math.round(p.y - size * .55), Math.round(size));
      else if (item.kind === 'itemBall') {
        // 道具球: a Poké Ball (red top, white bottom, black band and button).
        const r = size * .38;
        context.beginPath(); context.arc(p.x, p.y, r, Math.PI, 0); context.fillStyle = '#E5554A'; context.fill();
        context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI); context.fillStyle = '#F6F1E4'; context.fill();
        context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.strokeStyle = '#10191B'; context.lineWidth = Math.max(1.5, r * .18); context.stroke();
        context.beginPath(); context.moveTo(p.x - r, p.y); context.lineTo(p.x + r, p.y); context.stroke();
        context.beginPath(); context.arc(p.x, p.y, r * .3, 0, Math.PI * 2); context.fillStyle = '#F6F1E4'; context.fill(); context.stroke();
      }
      else {
        if (!drawSpeciesSprite(context, item.speciesId, Math.round(p.x - size * .55), Math.round(p.y - size * .62), Math.round(size * 1.1))) centeredText(d, item.fallback, p, '#FFF8E5', size * .5);
      }
      context.restore();
    }
    if (item.kind === 'sprite' && item.crown && d.onscreen(center)) drawIcon(context, 'crown', center.x, center.y - radius * .98, Math.max(10, radius * .5));
    if (item.kind === 'sprite' && item.warning && d.onscreen(center)) {
      const q = { x: center.x + radius * .42, y: center.y - radius * .92 }, r = Math.max(6, radius * .24);
      context.beginPath(); context.arc(q.x, q.y, r, 0, Math.PI * 2); context.fillStyle = '#E5554A'; context.fill();
      context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
      centeredText(d, '!', q, '#FFF8E5', r * 1.4);
    }
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

/** v17 trade routes: a dashed gold line between the two cities. */
export function drawTradeRoutes(d: Draw) {
  const { context, centers, radius, scene } = d;
  context.save(); context.setLineDash([radius * .35, radius * .25]); context.lineCap = 'round';
  for (const route of scene.tradeRoutes) {
    const a = centers[route.from], far = centers[route.to];
    // Across the seam the route runs to the destination's nearest copy, not back across the whole map.
    const b = far && d.span ? { x: far.x + Math.round((a.x - far.x) / d.span) * d.span, y: far.y } : far;
    if (!a || !b || (!d.onscreen(a) && !d.onscreen(b))) continue;
    for (const pass of [{ color: '#10191BCC', width: Math.max(4, radius * .16) }, { color: '#F2C14E', width: Math.max(2, radius * .08) }]) {
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.strokeStyle = pass.color; context.lineWidth = pass.width; context.stroke();
    }
  }
  context.restore();
}

/** Weather tints its radius; V11: fields fading in or out are drawn at the frame's opacity. */
export function drawWeather(d: Draw, frame: AnimationFrame) {
  const { context, centers, radius, scene } = d;
  const fades = frame.weather;
  const field = (item: SceneWeather, alpha: number) => {
    if (alpha <= 0) return;
    context.save();
    context.globalAlpha = Math.min(1, alpha);
    for (const index of item.tiles) {
      if (!d.onscreen(centers[index])) continue;
      polygon(d, centers[index]); context.fillStyle = `${item.color}33`; context.fill();
    }
    if (item.center !== null && d.onscreen(centers[item.center])) {
      const p = { x: centers[item.center].x + radius * .6, y: centers[item.center].y + radius * .45 }, size = Math.max(9, radius * .32);
      context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2); context.fillStyle = item.color; context.fill();
      context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(d, item.mark, p, '#10191B', size * 1.2);
    }
    context.restore();
  };
  for (const item of scene.weather) field(item, fades?.find(fade => fade.key === item.key && !fade.field)?.alpha ?? 1);
  // Fields that already left the scene (they ended this round), fading out as last seen.
  if (fades) for (const fade of fades) if (fade.field && !scene.weather.some(item => item.key === fade.key)) field(fade.field, fade.alpha);
}

/**
 * v26 §7.1 go-to route: a dashed line from the unit to its waypoint with a numbered disc where each turn ends and a flag on
 * the target. Steps across the v22 seam take the short way (the copy of the next tile nearest the previous one). Static: no
 * animation, so reduced motion needs nothing more.
 */
export function drawGoTo(d: Draw) {
  const { context, centers, radius, scene } = d, route = scene.goTo;
  if (!route || route.path.length < 2) return;
  const points: Point[] = [centers[route.path[0]]];
  for (let k = 1; k < route.path.length; k++) {
    const previous = points[k - 1], raw = centers[route.path[k]];
    let dx = raw.x - centers[route.path[k - 1]].x;
    if (d.span && Math.abs(dx) > d.span / 2) dx -= Math.sign(dx) * d.span;
    points.push({ x: previous.x + dx, y: raw.y });
  }
  if (!points.some(p => d.onscreen(p))) return;
  const color = route.preview ? '#FFF3C4' : '#7FE3FF';
  context.save();
  context.lineCap = 'round'; context.lineJoin = 'round';
  context.setLineDash([Math.max(4, radius * .22), Math.max(4, radius * .2)]);
  for (const pass of [{ stroke: '#0A1214D9', width: Math.max(4, radius * .16) }, { stroke: color, width: Math.max(2, radius * .08) }]) {
    context.beginPath(); context.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) context.lineTo(p.x, p.y);
    context.strokeStyle = pass.stroke; context.lineWidth = pass.width; context.stroke();
  }
  context.setLineDash([]);
  const at = new Map(route.path.map((index, k) => [index, points[k]]));
  const size = Math.max(9, radius * .3);
  for (const stop of route.stops) {
    const p = at.get(stop.index);
    if (!p || !d.onscreen(p)) continue;
    context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2);
    context.fillStyle = '#10191B'; context.fill();
    context.lineWidth = 2; context.strokeStyle = color; context.stroke();
    centeredText(d, String(stop.turn), p, '#FFFDF7', size * 1.25);
  }
  const end = points.at(-1)!;
  if (d.onscreen(end)) {
    // A small pennant on the waypoint itself.
    const pole = radius * .55;
    context.fillStyle = '#10191B'; context.fillRect(Math.round(end.x + size * .9), Math.round(end.y - pole), 3, Math.round(pole));
    context.beginPath(); context.moveTo(end.x + size * .9 + 3, end.y - pole); context.lineTo(end.x + size * .9 + 3 + radius * .32, end.y - pole + radius * .12);
    context.lineTo(end.x + size * .9 + 3, end.y - pole + radius * .24); context.closePath();
    context.fillStyle = color; context.fill(); context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
  }
  context.restore();
}

export function drawDebug(d: Draw) {
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

/** Combat text styles: colour, size as a share of the hex radius, and a cap in CSS px. */
const NUMBER_STYLES: Record<NumberTone, { color: string; scale: number; max: number }> = {
  damage: { color: '#FFF3E8', scale: .8, max: 30 }, counter: { color: '#FFD27A', scale: .62, max: 22 },
  super: { color: '#F2C14E', scale: .42, max: 17 }, weak: { color: '#B8C2BD', scale: .4, max: 16 }, tag: { color: '#D4DED5', scale: .4, max: 16 },
};
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const fadeTail = (t: number, tail = .3) => t > 1 - tail ? Math.max(0, (1 - t) / tail) : 1;
const RAINBOW = ['#E5554A', '#F2A33C', '#F2D64E', '#72C99E', '#4FA3D8', '#9B83D0'];

function drawShatter(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'shatter' }>) {
  const { context, radius } = d, t = effect.progress, center = { x: p.x, y: p.y - radius * .2 };
  context.save();
  context.globalAlpha = 1 - t;
  context.beginPath(); context.arc(center.x, center.y, radius * (.6 + .7 * easeOut(t)), 0, Math.PI * 2);
  context.strokeStyle = MAX_SHIELD; context.lineWidth = Math.max(2, 5 * (1 - t)); context.stroke();
  if (effect.motion) {
    const count = Math.min(PARTICLES.length, 5 + effect.broken * 4);
    for (let index = 0; index < count; index++) {
      if (d.budget.particles <= 0) break;
      d.budget.particles--;
      const particle = PARTICLES[index], reach = radius * (.3 + 1.3 * particle.speed * easeOut(t)), size = Math.max(2, Math.round(radius * (particle.size + .05) * (1 - t * .5)));
      context.fillStyle = particle.white ? '#FFF8E5' : index % 2 ? MAX_SHIELD : MAX_RED;
      context.fillRect(Math.round(center.x + particle.dx * reach - size / 2), Math.round(center.y + particle.dy * reach + t * t * radius * .6 - size / 2), size, size);
    }
  }
  if (effect.phaseTwo) {
    context.globalAlpha = fadeTail(t, .35);
    context.beginPath(); context.arc(center.x, center.y, radius * (effect.motion ? .8 + 1.2 * easeOut(t) : 1.1), 0, Math.PI * 2);
    context.strokeStyle = MAX_PHASE_TWO; context.lineWidth = Math.max(3, radius * .16); context.stroke();
    outlinedText(d, '极巨护盾再展开', { x: p.x, y: p.y - radius * (1.5 + (effect.motion ? t * .3 : 0)) }, '#FFF8E5', Math.min(16, radius * .42));
  }
  context.restore();
}

function drawEvolution(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'evolution' }>) {
  const { context, radius } = d;
  context.save();
  if (!effect.motion) {
    context.globalAlpha = (1 - effect.progress) * .8;
    context.beginPath(); context.arc(p.x, p.y, radius * .8, 0, Math.PI * 2);
    context.fillStyle = '#F2C14E33'; context.fill(); context.strokeStyle = '#F2C14E'; context.lineWidth = 3; context.stroke();
    context.restore();
    return;
  }
  const center = { x: p.x, y: p.y - radius * .1 };
  if (effect.elapsed < EVOLUTION_REVEAL_AT) {
    for (const [index, particle] of PARTICLES.entries()) {
      if (d.budget.particles <= 0) break;
      d.budget.particles--;
      const phase = (effect.elapsed / 900 * particle.speed + index / PARTICLES.length) % 1, reach = radius * (1.25 - phase * .9);
      const size = Math.max(2, Math.round(radius * .09 * (index % 2 ? 1 : 1.5)));
      context.globalAlpha = Math.sin(phase * Math.PI);
      context.fillStyle = index % 3 ? '#CFEFF7' : '#FFFDF7';
      context.fillRect(Math.round(center.x + particle.dx * reach - size / 2), Math.round(center.y + particle.dy * reach - size / 2), size, size);
    }
  } else {
    const t = Math.min(1, (effect.elapsed - EVOLUTION_REVEAL_AT) / 700);
    context.globalAlpha = 1 - t;
    context.beginPath(); context.arc(center.x, center.y, radius * (.5 + 1.1 * easeOut(t)), 0, Math.PI * 2);
    context.strokeStyle = '#FFE08A'; context.lineWidth = Math.max(2, 5 * (1 - t)); context.stroke();
    for (const [index, particle] of PARTICLES.entries()) {
      if (d.budget.particles <= 0) break;
      d.budget.particles--;
      const reach = radius * (.35 + (1.2 + particle.speed * .5) * easeOut(t)), arm = Math.max(1, Math.round(radius * .12 * (1 - t * .7)));
      const x = Math.round(center.x + particle.dx * reach), y = Math.round(center.y + particle.dy * reach);
      context.fillStyle = particle.white ? '#FFFDF7' : index % 2 ? '#F2C14E' : '#9CD6F2';
      context.fillRect(x - arm, y, arm * 2 + 1, 1 + (arm > 2 ? 1 : 0)); context.fillRect(x, y - arm, 1 + (arm > 2 ? 1 : 0), arm * 2 + 1);
    }
    context.globalAlpha = t > .75 ? Math.max(0, 1 - (t - .75) / .25) : 1;
    outlinedText(d, '进化！', { x: center.x, y: center.y - radius * (1.05 + .25 * easeOut(t)) }, '#FFE08A', Math.min(22, radius * .62));
  }
  context.restore();
}

function drawProjectile(d: Draw, effect: Extract<MapEffect, { kind: 'projectile' }>, camera: Camera) {
  const { context, radius } = d;
  const at = (t: number): Point => {
    const ground = { x: effect.from.x + (effect.to.x - effect.from.x) * t, y: effect.from.y + (effect.to.y - effect.from.y) * t };
    const s = toScreen({ x: ground.x, y: ground.y - Math.sin(Math.PI * t) * HEX_RADIUS * .45 }, camera);
    return { x: s.x + d.shift, y: s.y - d.liftAt(ground) };
  };
  const t = Math.max(0, Math.min(1, effect.progress)), head = at(t);
  if (!d.onscreen(head)) return;
  const size = Math.max(4, radius * .2);
  context.save();
  context.fillStyle = effect.color;
  for (let i = 4; i >= 1; i--) {
    const q = at(Math.max(0, t - i * .07)), s = Math.max(2, size * (1 - i * .18));
    context.globalAlpha = 1 - i * .2;
    context.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), Math.ceil(s), Math.ceil(s));
  }
  context.globalAlpha = 1;
  context.beginPath(); context.arc(head.x, head.y, size, 0, Math.PI * 2);
  context.fill(); context.strokeStyle = '#10191B'; context.lineWidth = 2; context.stroke();
  context.beginPath(); context.arc(head.x, head.y, size * .42, 0, Math.PI * 2); context.fillStyle = '#FFFDF7'; context.fill();
  context.restore();
}

function drawImpact(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'impact' }>) {
  const { context, radius } = d, t = effect.progress;
  context.save();
  if (t < .45) {
    context.globalCompositeOperation = 'lighter';
    polygon(d, p); context.fillStyle = `rgb(255 253 247 / ${Math.round((1 - t / .45) * 40)}%)`; context.fill();
    context.globalCompositeOperation = 'source-over';
  }
  if (effect.burst) {
    context.globalAlpha = 1 - t;
    context.beginPath(); context.arc(p.x, p.y, radius * (.25 + .8 * easeOut(t)), 0, Math.PI * 2);
    context.strokeStyle = effect.color; context.lineWidth = Math.max(1.5, 4 * (1 - t)); context.stroke();
    const reach = radius * 1.05 * easeOut(t);
    for (const particle of PARTICLES) {
      if (d.budget.particles <= 0) break;
      d.budget.particles--;
      const size = Math.max(2, radius * particle.size * (1 - t * .6));
      context.fillStyle = particle.white ? '#FFFDF7' : effect.color;
      context.fillRect(Math.round(p.x + particle.dx * reach * particle.speed - size / 2), Math.round(p.y + particle.dy * reach * particle.speed - radius * .15 - size / 2), Math.ceil(size), Math.ceil(size));
    }
  }
  context.restore();
}

function drawSweep(d: Draw, effect: Extract<MapEffect, { kind: 'sweep' }>, indexOf: (hex: Hex) => number | null) {
  const { context, centers } = d, color = ownerColor(effect.ownerId), elapsed = effect.progress * SWEEP_MS;
  context.save();
  for (const tile of effect.tiles) {
    const local = (elapsed - tile.ring * SWEEP_RING_MS) / (SWEEP_MS - 3 * SWEEP_RING_MS);
    if (local <= 0 || local >= 1) continue;
    const index = indexOf(tile.hex);
    if (index === null || !d.onscreen(centers[index])) continue;
    const alpha = local < .25 ? local / .25 : 1 - (local - .25) / .75;
    polygon(d, centers[index]);
    context.globalAlpha = alpha * .5; context.fillStyle = color; context.fill();
    context.globalAlpha = alpha; context.strokeStyle = color; context.lineWidth = 2.5; context.stroke();
  }
  context.restore();
}

function drawFallingBanner(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'banner' }>) {
  const { context, radius } = d, t = effect.progress;
  const height = Math.max(16, Math.min(24, radius * .8)), width = height * 2.8, top = p.y - citySize(radius) * .66 - height;
  context.save();
  context.globalAlpha = 1 - t * t;
  context.translate(p.x - width / 2, top + height / 2 + t * t * radius * 1.5);
  context.rotate(t * .9);
  context.beginPath(); context.roundRect(0, -height / 2, width, height, height / 2);
  context.fillStyle = '#14211FE6'; context.fill();
  context.strokeStyle = ownerColor(effect.ownerId); context.lineWidth = 2; context.stroke();
  const square = { x: height / 2, y: 0 };
  factionRect(d, effect.ownerId, square, height - 4, (height - 4) / 2);
  context.strokeStyle = '#FFFDF7'; context.lineWidth = 1; context.stroke();
  centeredText(d, effect.ownerId === null ? '爪' : String(effect.ownerId + 1), { x: square.x, y: .3 }, '#FFFDF7', (height - 4) * .65);
  context.beginPath(); context.moveTo(width - 3, -height / 2);
  for (let i = 1; i <= 4; i++) context.lineTo(width - (i % 2 ? 9 : 3), -height / 2 + i * height / 4);
  context.strokeStyle = ownerColor(effect.ownerId); context.lineWidth = 2; context.stroke();
  context.restore();
}

function drawPulse(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'pulse' }>) {
  const { context, radius } = d, t = effect.progress;
  context.save();
  if (t < .4) { context.globalAlpha = .35 * (1 - t / .4); polygon(d, p); context.fillStyle = effect.color; context.fill(); }
  for (const delay of [0, .2]) {
    const local = (t - delay) / (1 - delay);
    if (local <= 0 || local >= 1) continue;
    const grow = .55 + easeOut(local) * 1.05;
    context.globalAlpha = 1 - local;
    context.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const x = p.x + radius * grow * HEX_CORNERS[corner].x, y = p.y + radius * grow * HEX_CORNERS[corner].y * d.squash;
      if (corner === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath();
    context.strokeStyle = '#10191B'; context.lineWidth = Math.max(2, 5 * (1 - local)) + 2; context.stroke();
    context.strokeStyle = effect.color; context.lineWidth = Math.max(2, 5 * (1 - local)); context.stroke();
  }
  context.globalAlpha = fadeTail(t);
  const rise = easeOut(Math.min(1, t / .6)) * radius * .9;
  if (effect.icon === 'chevron') {
    const w = Math.max(9, radius * .42);
    for (let i = 0; i < 3; i++) {
      const y = p.y - rise - i * w * .45 + w * .3;
      context.beginPath(); context.moveTo(p.x - w / 2, y); context.lineTo(p.x, y - w * .42); context.lineTo(p.x + w / 2, y);
      context.strokeStyle = '#10191B'; context.lineWidth = 6; context.stroke();
      context.strokeStyle = effect.color; context.lineWidth = 3; context.stroke();
    }
  } else if (effect.icon === 'alert') {
    const pop = t < .15 ? .6 + t / .15 * .6 : t < .25 ? 1.2 - (t - .15) / .1 * .2 : 1, r = Math.max(8, radius * .3) * pop, q = { x: p.x, y: p.y - radius * .35 - rise * .4 };
    context.beginPath(); context.arc(q.x, q.y, r, 0, Math.PI * 2); context.fillStyle = effect.color; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 2; context.stroke();
    centeredText(d, '!', q, '#FFF8E5', r * 1.5);
  } else if (effect.icon === 'star') {
    const r = Math.max(7, radius * .3), q = { x: p.x, y: p.y - rise * .6 };
    context.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, s = i % 2 ? r * .45 : r; context.lineTo(q.x + Math.cos(a) * s, q.y + Math.sin(a) * s); }
    context.closePath(); context.fillStyle = effect.color; context.fill(); context.strokeStyle = '#10191B'; context.lineWidth = 1.5; context.stroke();
  }
  if (effect.label) {
    const pop = t < .12 ? 1.3 - t / .12 * .3 : 1;
    outlinedText(d, effect.label, { x: p.x, y: p.y - radius * (1.05 + t * .45) }, '#FFF8E5', Math.min(17, radius * .44) * pop, '#10191B');
    context.fillStyle = effect.color;
    const width = Math.min(60, radius * 1.4);
    context.fillRect(Math.round(p.x - width / 2), Math.round(p.y - radius * (1.05 + t * .45) + Math.min(17, radius * .44) * .62), Math.round(width), 2);
  }
  context.restore();
}

function drawRoute(d: Draw, effect: Extract<MapEffect, { kind: 'route' }>, camera: Camera) {
  const { context, radius } = d, t = effect.progress;
  const at = (s: number): Point => {
    const ground = { x: effect.from.x + (effect.to.x - effect.from.x) * s, y: effect.from.y + (effect.to.y - effect.from.y) * s };
    const q = toScreen(ground, camera);
    return { x: q.x + d.shift, y: q.y - d.liftAt(ground) };
  };
  const head = at(Math.min(1, t * 1.25)), tail = at(Math.max(0, t * 1.25 - .3));
  if (!d.onscreen(head) && !d.onscreen(tail)) return;
  context.save();
  context.globalAlpha = fadeTail(t, .2);
  context.lineCap = 'round';
  for (const pass of [{ color: '#10191B', width: Math.max(6, radius * .24) }, { color: '#FFE08A', width: Math.max(3, radius * .12) }]) {
    context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.strokeStyle = pass.color; context.lineWidth = pass.width; context.stroke();
  }
  context.beginPath(); context.arc(head.x, head.y, Math.max(3.5, radius * .14), 0, Math.PI * 2); context.fillStyle = '#FFFDF7'; context.fill();
  context.restore();
}

function lightColumn(d: Draw, p: Point, width: number, alpha: number, color: string) {
  const { context } = d, top = -8;
  if (alpha <= 0 || p.y < top) return;
  context.save();
  context.globalAlpha = alpha;
  const gradient = context.createLinearGradient(p.x - width / 2, 0, p.x + width / 2, 0);
  gradient.addColorStop(0, `${color}00`); gradient.addColorStop(.3, `${color}AA`); gradient.addColorStop(.5, '#FFFDF7EE'); gradient.addColorStop(.7, `${color}AA`); gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(Math.round(p.x - width / 2), top, Math.round(width), Math.round(p.y - top));
  context.beginPath(); context.ellipse(p.x, p.y, width * .75, width * .26, 0, 0, Math.PI * 2); context.fillStyle = `${color}99`; context.fill();
  context.restore();
}

function risingParticles(d: Draw, p: Point, t: number, colors: readonly string[], spread: number) {
  const { context, radius } = d;
  for (const [index, particle] of PARTICLES.entries()) {
    if (d.budget.particles <= 0) break;
    d.budget.particles--;
    const phase = (t * particle.speed * 1.4 + index / PARTICLES.length) % 1, size = Math.max(2, radius * particle.size * (1 - phase * .5));
    context.fillStyle = particle.white ? '#FFFDF7' : colors[index % colors.length];
    context.fillRect(Math.round(p.x + particle.dx * radius * spread - size / 2), Math.round(p.y - phase * radius * 2.2 - size / 2), Math.ceil(size), Math.ceil(size));
  }
}

function drawForm(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'form' }>) {
  const { context, radius } = d, t = effect.progress, fade = fadeTail(t, .35), center = { x: p.x, y: p.y - radius * .05 };
  context.save();
  if (effect.form === 'mega') {
    if (t < .3) { context.globalCompositeOperation = 'lighter'; polygon(d, p); context.fillStyle = `rgb(255 253 247 / ${Math.round((1 - t / .3) * 55)}%)`; context.fill(); context.globalCompositeOperation = 'source-over'; }
    const r = radius * (.5 + .45 * easeOut(Math.min(1, t / .4))), spin = t * Math.PI * 2.5;
    context.globalAlpha = fade; context.lineWidth = Math.max(3, radius * .14); context.lineCap = 'round';
    for (const [index, color] of RAINBOW.entries()) {
      const start = spin + index * Math.PI / 3;
      context.beginPath(); context.arc(center.x, center.y, r, start, start + Math.PI / 3 - .12); context.strokeStyle = color; context.stroke();
    }
    risingParticles(d, center, t, RAINBOW, .7);
  } else if (effect.form === 'dynamax') {
    const beat = .5 + .5 * Math.sin(t * Math.PI * 6);
    for (const [index, scale] of [1.15, .95, .75].entries()) {
      context.globalAlpha = fade * (.22 + index * .12) * (.7 + .3 * beat);
      context.beginPath(); context.arc(center.x, center.y, radius * scale * (1 + .2 * easeOut(Math.min(1, t / .35))), 0, Math.PI * 2);
      context.strokeStyle = '#E5554A'; context.lineWidth = Math.max(4, radius * .22); context.stroke();
    }
    context.globalAlpha = fade;
    risingParticles(d, center, t, ['#E5554A', '#B84D45', '#F28B6E'], 1);
  } else if (effect.form === 'tera') {
    const form = easeOut(Math.min(1, t / .25)), shatter = t > .75 ? (t - .75) / .25 : 0, w = radius * .95 * form, h = radius * 1.2 * form;
    const points = [[0, -1], [.75, -.45], [.75, .45], [0, 1], [-.75, .45], [-.75, -.45]].map(([x, y]) => ({ x: center.x + x * w * (1 + shatter * .6), y: center.y + y * h * (1 + shatter * .6) }));
    context.globalAlpha = 1 - shatter;
    context.beginPath(); points.forEach((q, i) => i ? context.lineTo(q.x, q.y) : context.moveTo(q.x, q.y)); context.closePath();
    context.fillStyle = `${effect.color}55`; context.fill();
    context.strokeStyle = '#10191B'; context.lineWidth = 3.5; context.stroke();
    context.strokeStyle = effect.color; context.lineWidth = 2; context.stroke();
    context.beginPath();
    for (const q of points) { context.moveTo(center.x, center.y - h * .25); context.lineTo(q.x, q.y); }
    context.strokeStyle = '#FFFDF7AA'; context.lineWidth = 1; context.stroke();
    context.save();
    context.beginPath(); points.forEach((q, i) => i ? context.lineTo(q.x, q.y) : context.moveTo(q.x, q.y)); context.closePath(); context.clip();
    const band = center.x - w + (t * 2.4 % 1.2) * w * 2;
    context.fillStyle = '#FFFDF766'; context.fillRect(Math.round(band - radius * .12), Math.round(center.y - h), Math.round(radius * .24), Math.round(h * 2));
    context.restore();
    if (shatter > 0) risingParticles(d, center, t, [effect.color], .9);
  } else {
    const grow = easeOut(Math.min(1, t / .2));
    lightColumn(d, center, radius * (.4 + .6 * grow) * (1 + .08 * Math.sin(t * Math.PI * 8)), fade, '#F2C14E');
    context.globalAlpha = fade;
    context.beginPath(); context.arc(center.x, center.y, radius * (.5 + .5 * easeOut(t)), 0, Math.PI * 2); context.strokeStyle = '#F2C14E'; context.lineWidth = 3; context.stroke();
  }
  context.restore();
}

function drawPillar(d: Draw, p: Point, effect: Extract<MapEffect, { kind: 'pillar' }>) {
  const { context, radius } = d, t = effect.progress, grow = easeOut(Math.min(1, t / .25));
  lightColumn(d, p, radius * (.5 + 1 * grow), fadeTail(t, .35), '#F2C14E');
  context.save();
  context.globalAlpha = 1 - t;
  context.beginPath(); context.arc(p.x, p.y, radius * (.6 + 1.2 * easeOut(t)), 0, Math.PI * 2); context.strokeStyle = '#FFE08A'; context.lineWidth = Math.max(2, 5 * (1 - t)); context.stroke();
  context.globalAlpha = fadeTail(t, .35);
  if (effect.burst) risingParticles(d, p, t, ['#F2C14E', '#FFE08A'], 1.1);
  context.restore();
}

export function drawEffects(d: Draw, frame: AnimationFrame, indexOf: (hex: Hex) => number | null, camera: Camera) {
  const { context, centers, radius } = d;
  for (const effect of frame.effects) if (effect.kind === 'sweep') drawSweep(d, effect, indexOf);
  for (const effect of frame.effects) {
    if (effect.kind === 'sweep') continue;
    if (effect.kind === 'projectile') { drawProjectile(d, effect, camera); continue; }
    if (effect.kind === 'route') { drawRoute(d, effect, camera); continue; }
    const index = indexOf(effect.position);
    if (index === null) continue;
    const p = centers[index];
    if (!d.onscreen(p)) continue;
    if (effect.kind === 'tap') {
      const progress = Math.max(0, Math.min(1, effect.progress)), grow = .35 + progress * .75;
      context.save(); context.globalAlpha = 1 - progress;
      context.beginPath(); context.arc(p.x, p.y, radius * grow, 0, Math.PI * 2);
      context.strokeStyle = effect.tone === 'error' ? '#E07A6D' : '#FFF3C4'; context.lineWidth = 3; context.stroke();
      context.restore();
    } else if (effect.kind === 'impact') drawImpact(d, p, effect);
    else if (effect.kind === 'pulse') drawPulse(d, p, effect);
    else if (effect.kind === 'form') drawForm(d, p, effect);
    else if (effect.kind === 'evolution') drawEvolution(d, p, effect);
    else if (effect.kind === 'pillar') drawPillar(d, p, effect);
    else if (effect.kind === 'shatter') drawShatter(d, p, effect);
    else if (effect.kind === 'banner') drawFallingBanner(d, p, effect);
    else if (effect.kind === 'number') {
      const t = effect.progress, style = NUMBER_STYLES[effect.tone];
      const pop = effect.tone !== 'tag' && t < .15 ? 1.4 - (t / .15) * .4 : 1, size = Math.min(style.max, radius * style.scale) * pop;
      context.save();
      context.globalAlpha = t > .6 ? Math.max(0, 1 - (t - .6) / .4) : 1;
      outlinedText(d, effect.text, { x: p.x, y: p.y - radius * (.55 + (effect.lift ?? 0) + t * .55) }, style.color, size);
      context.restore();
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
