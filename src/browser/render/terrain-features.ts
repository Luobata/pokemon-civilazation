// Gameplay v24 terrain features on the map (docs/design/world-v24.md §2.9): deep water and lakes tinted, hills as two small mounds,
// peaks as white-capped spikes, rivers as blue lines through tile centres (towards linked river / water tiles) and landmark glyphs.
// Pure canvas drawing from the scene; the base layer calls it once per wrapped copy, so the seam copies match.
import { LANDMARKS } from '../../content/terrain.ts';
import type { LandmarkId } from '../../content/terrain.ts';
import type { Point } from '../camera.ts';

/** What the scene knows about features (explored tiles only): `rivers[].links` are HEX_DIRECTIONS indexes to river or water neighbours. */
export type SceneTerrain = {
  hills: number[]; peaks: number[]; deep: number[]; lakes: number[];
  rivers: { index: number; links: number[] }[];
  landmarks: { index: number; id: LandmarkId }[];
};
/** Screen angle of each HEX_DIRECTIONS entry (E, NE, NW, W, SW, SE) on a pointy-top map with y downwards. */
const DIRECTION_ANGLES = [0, -60, -120, 180, 120, 60].map(degrees => degrees * Math.PI / 180);
const LANDMARK_GLYPHS: Record<LandmarkId, { mark: string; color: string }> = {
  singingDunes: { mark: '沙', color: '#E2B860' }, stardustMere: { mark: '星', color: '#B7A6F2' }, elderCanopy: { mark: '树', color: '#4F9A55' },
  thunderMesa: { mark: '雷', color: '#F2D24E' }, mistlockGorge: { mark: '雾', color: '#8C97B5' }, tidesongGrotto: { mark: '潮', color: '#4BB3C9' },
  everfrostHollow: { mark: '冰', color: '#BFE6F2' }, emberCaldera: { mark: '火', color: '#E1663C' },
};
export const landmarkGlyph = (id: LandmarkId) => ({ ...LANDMARK_GLYPHS[id], name: LANDMARKS[id].name });

function hexPath(context: CanvasRenderingContext2D, p: Point, radius: number) {
  context.beginPath();
  for (let k = 0; k < 6; k++) {
    const angle = (k * 60 - 30) * Math.PI / 180;
    if (k === 0) context.moveTo(p.x + radius * Math.cos(angle), p.y + radius * Math.sin(angle));
    else context.lineTo(p.x + radius * Math.cos(angle), p.y + radius * Math.sin(angle));
  }
  context.closePath();
}
/** Draws every feature of `terrain` at `centers` (one wrapped copy); `onscreen` skips tiles outside the view. */
export function drawTerrainFeatures(context: CanvasRenderingContext2D, terrain: SceneTerrain, centers: readonly Point[], radius: number, onscreen: (p: Point) => boolean): void {
  context.save();
  for (const [list, color] of [[terrain.deep, '#06243A73'], [terrain.lakes, '#9FE3E04D']] as const) for (const index of list) {
    const p = centers[index];
    if (!onscreen(p)) continue;
    hexPath(context, p, radius * .97);
    context.fillStyle = color; context.fill();
  }
  for (const river of terrain.rivers) {
    const p = centers[river.index];
    if (!onscreen(p)) continue;
    context.strokeStyle = '#3E8FD8'; context.lineCap = 'round'; context.lineWidth = Math.max(1.5, radius * .14);
    const ends = river.links.length ? river.links : [0];
    for (const direction of ends) {
      const reach = radius * .87;
      context.beginPath();
      context.moveTo(p.x, p.y);
      context.lineTo(p.x + reach * Math.cos(DIRECTION_ANGLES[direction]), p.y + reach * Math.sin(DIRECTION_ANGLES[direction]));
      context.stroke();
    }
  }
  for (const index of terrain.hills) {
    const p = centers[index];
    if (!onscreen(p)) continue;
    const w = radius * .32, h = radius * .2, y = p.y + radius * .42;
    for (const dx of [-radius * .26, radius * .2]) {
      context.beginPath();
      context.moveTo(p.x + dx - w / 2, y); context.quadraticCurveTo(p.x + dx, y - h * 2, p.x + dx + w / 2, y); context.closePath();
      context.fillStyle = '#8C7A4ACC'; context.fill();
      context.strokeStyle = '#3E331CAA'; context.lineWidth = 1; context.stroke();
    }
  }
  for (const index of terrain.peaks) {
    const p = centers[index];
    if (!onscreen(p)) continue;
    const h = radius * .72, w = radius * .62, top = { x: p.x, y: p.y - h * .55 };
    context.beginPath();
    context.moveTo(p.x - w / 2, p.y + h * .45); context.lineTo(top.x, top.y); context.lineTo(p.x + w / 2, p.y + h * .45); context.closePath();
    context.fillStyle = '#3B3A44'; context.fill();
    context.beginPath();
    context.moveTo(top.x - w * .17, top.y + h * .3); context.lineTo(top.x, top.y); context.lineTo(top.x + w * .17, top.y + h * .3); context.closePath();
    context.fillStyle = '#F4F6FA'; context.fill();
  }
  for (const site of terrain.landmarks) {
    const p = centers[site.index];
    if (!onscreen(p)) continue;
    const glyph = LANDMARK_GLYPHS[site.id], size = radius * .5;
    context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2);
    context.fillStyle = '#1B1F26E6'; context.fill();
    context.strokeStyle = glyph.color; context.lineWidth = Math.max(1.5, radius * .1); context.stroke();
    context.fillStyle = glyph.color; context.font = `bold ${Math.round(size * 1.1)}px sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(glyph.mark, p.x, p.y + 1);
  }
  context.restore();
}
