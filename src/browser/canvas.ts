import type { BiomeId } from '../content/rules.ts';
import type { UnitIdentity } from '../content/units.ts';
import { speciesDisplay } from '../content/species.ts';
import { hexToIndex, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { HEX_RADIUS, hexToWorld, toScreen } from './camera.ts';
import type { Camera, Point } from './camera.ts';

export const BIOME_DISPLAY: Record<BiomeId, { label: string; color: string; symbol: string }> = {
  grassland: { label: '草原', color: '#91AC72', symbol: '≈' },
  forest: { label: '森林', color: '#49735A', symbol: '♠' },
  mountain: { label: '山地', color: '#8A8981', symbol: '⋀⋀' },
  ocean: { label: '海洋', color: '#6FA5B8', symbol: '≈' },
  desert: { label: '荒漠', color: '#D3B574', symbol: '∿' },
  snow: { label: '雪原', color: '#D9E5E3', symbol: '✣' },
  volcano: { label: '火山', color: '#B76049', symbol: '⋀' },
};
const FACTIONS = ['#2C6E63', '#963F38', '#62508F', '#87550D'];
export type AnimationPose = { unit: UnitIdentity & { id: number; ownerId: number | null }; position: Point };
export type MapEffect = { kind: 'battle'; position: Hex; damage: number; counterDamage: number; progress: number }
  | { kind: 'capture'; position: Hex; success: boolean; progress: number }
  | { kind: 'evolve'; position: Hex; progress: number };

export function drawMap(canvas: HTMLCanvasElement, view: PlayerView, camera: Camera,
  selected: number | null, reachable: readonly number[], pose?: AnimationPose, cursorIndex?: number | null,
  effect?: MapEffect, actionMode: 'attack' | 'capture' | null = null,
  actionTargets: readonly number[] = [], pendingTargetIndex?: number | null): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const radius = HEX_RADIUS * camera.zoom;
  const centers = view.map.tiles.map((_, i) => toScreen(hexToWorld(indexToHex(i, view.map)), camera));
  const onscreen = (p: Point) => p.x >= -radius && p.x <= width + radius && p.y >= -radius && p.y <= height + radius;
  function polygon(p: Point) {
    context!.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const angle = (corner * 60 - 30) * Math.PI / 180;
      const x = p.x + radius * Math.cos(angle), y = p.y + radius * Math.sin(angle);
      if (corner === 0) context!.moveTo(x, y); else context!.lineTo(x, y);
    }
    context!.closePath();
  }
  function centeredText(text: string, p: Point, color: string, size: number) {
    context!.fillStyle = color;
    context!.font = `650 ${Math.max(9, size)}px system-ui, sans-serif`;
    context!.textAlign = 'center';
    context!.textBaseline = 'middle';
    context!.fillText(text, p.x, p.y);
  }
  function ownerColor(ownerId: number | null) {
    return ownerId === null ? '#855000' : FACTIONS[ownerId] ?? '#5F6E66';
  }
  function ownerBadge(ownerId: number | null, p: Point, size: number) {
    const badge = Math.max(13, size * .42), x = p.x + size * .32, y = p.y - size * .38;
    context!.beginPath();
    context!.arc(x, y, badge / 2, 0, Math.PI * 2);
    context!.fillStyle = ownerColor(ownerId);
    context!.fill();
    context!.strokeStyle = '#FFFDF7';
    context!.lineWidth = 1;
    context!.stroke();
    centeredText(ownerId === null ? '爪' : String(ownerId + 1), { x, y: y + .3 }, '#FFFDF7', badge * .65);
  }
  const visible = new Set(view.visibleTileIds);

  for (const [i, biome] of view.map.tiles.entries()) {
    if (!onscreen(centers[i])) continue;
    polygon(centers[i]);
    context.fillStyle = biome ? BIOME_DISPLAY[biome].color : '#101815';
    context.fill();
    context.strokeStyle = '#FFFDF73D';
    context.lineWidth = .7;
    context.stroke();
    if (biome && radius >= 12) {
      const p = centers[i];
      centeredText(BIOME_DISPLAY[biome].symbol, { x: p.x + radius * .42, y: p.y - radius * .38 },
        biome === 'forest' ? '#FFFDF752' : '#1D2B2638', radius * .38);
    }
  }

  for (const city of view.cities) {
    const p = centers[hexToIndex(city.position, view.map)!];
    if (!onscreen(p)) continue;
    const size = Math.max(20, Math.min(30, radius * 1.25));
    context.fillStyle = ownerColor(city.ownerId);
    context.strokeStyle = '#FFFDF7';
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(p.x - size / 2, p.y - size / 2, size, size, 4);
    context.fill();
    context.stroke();
    centeredText('营', p, '#FFFDF7', size * .48);
    ownerBadge(city.ownerId, p, size);
  }

  function unitMark(unit: AnimationPose['unit'], point: Point, actionLeft?: number, enraged = false) {
    if (!onscreen(point)) return;
    const size = Math.max(24, Math.min(36, radius * 1.45));
    context!.beginPath();
    context!.roundRect(point.x - size / 2, point.y - size / 2, size, size, size * .24);
    context!.fillStyle = ownerColor(unit.ownerId);
    context!.fill();
    context!.strokeStyle = actionLeft === 0 ? '#AEB4A5' : '#FFFDF7';
    context!.lineWidth = 2;
    context!.stroke();
    const abbreviation = unit.kind === 'pokemon' ? speciesDisplay(unit.speciesId).abbreviation : '拓';
    centeredText(abbreviation, point, '#FFFDF7', size * .42);
    ownerBadge(unit.ownerId, point, size);
    if (actionLeft === 0) centeredText('✓', { x: point.x - size * .32, y: point.y + size * .34 }, '#FFFDF7', size * .35);
    if (enraged) {
      context!.beginPath();
      context!.arc(point.x - size * .38, point.y - size * .35, size * .2, 0, Math.PI * 2);
      context!.fillStyle = '#9B3833';
      context!.fill();
      centeredText('!', { x: point.x - size * .38, y: point.y - size * .35 }, '#FFFDF7', size * .35);
    }
  }
  // Only the authorized PlayerView supplies entities; hidden live units never enter a draw call.
  for (const unit of view.units) if (unit.id !== pose?.unit.id) {
    unitMark(unit, centers[hexToIndex(unit.position, view.map)!], unit.actionLeft, unit.enraged);
  }
  if (pose) unitMark(pose.unit, toScreen(pose.position, camera));

  for (const index of reachable) if (visible.has(index) && onscreen(centers[index])) {
    const p = centers[index];
    polygon(p);
    context.fillStyle = '#236B6338';
    context.fill();
    context.strokeStyle = '#63B7A9';
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.arc(p.x, p.y, Math.max(2, radius * .1), 0, Math.PI * 2);
    context.fillStyle = '#174E48';
    context.fill();
  }

  for (const index of actionTargets) if (visible.has(index) && onscreen(centers[index])) {
    const p = centers[index];
    polygon(p);
    context.fillStyle = actionMode === 'capture' ? '#85500030' : '#9B383333';
    context.fill();
    context.setLineDash([4, 3]);
    context.strokeStyle = index === pendingTargetIndex ? '#FFFDF7' : actionMode === 'capture' ? '#C18412' : '#D77D75';
    context.lineWidth = index === pendingTargetIndex ? 3 : 2;
    context.stroke();
    context.setLineDash([]);
    centeredText(actionMode === 'capture' ? '球' : '×', { x: p.x - radius * .45, y: p.y + radius * .4 },
      actionMode === 'capture' ? '#855000' : '#9B3833', radius * .38);
  }

  for (const [i, biome] of view.map.tiles.entries()) if (biome && !visible.has(i) && onscreen(centers[i])) {
    const p = centers[i];
    polygon(p);
    context.fillStyle = '#1018159E';
    context.fill();
    context.save();
    polygon(p);
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

  const unit = view.units.find(unit => unit.id === selected);
  if (unit && !pose) {
    const p = centers[hexToIndex(unit.position, view.map)!];
    context.beginPath();
    context.arc(p.x, p.y, radius * .76, 0, Math.PI * 2);
    context.strokeStyle = '#1D2B26';
    context.lineWidth = 4;
    context.stroke();
    context.beginPath();
    context.arc(p.x, p.y, radius * .76, 0, Math.PI * 2);
    context.strokeStyle = '#F0B73F';
    context.lineWidth = 2.5;
    context.stroke();
  }
  if (cursorIndex !== null && cursorIndex !== undefined && onscreen(centers[cursorIndex])) {
    const p = centers[cursorIndex];
    polygon(p);
    context.setLineDash([4, 3]);
    context.strokeStyle = '#7C4DFF';
    context.lineWidth = 2;
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    context.fillStyle = '#7C4DFF';
    context.fill();
  }

  if (effect) {
    const index = hexToIndex(effect.position, view.map)!, p = centers[index];
    if (onscreen(p)) {
      if (effect.kind === 'battle') {
        if (effect.progress < .5) {
          polygon(p);
          context.fillStyle = `rgb(255 253 247 / ${45 - effect.progress * 60}%)`;
          context.fill();
        }
        centeredText(`−${effect.damage}`, { x: p.x, y: p.y - radius * (.7 + effect.progress * .5) }, '#F4E0DB', radius * .65);
        if (effect.counterDamage) centeredText(`反击 −${effect.counterDamage}`, { x: p.x, y: p.y - radius * .15 }, '#FFFDF7', radius * .35);
      } else if (effect.kind === 'capture') {
        const offset = effect.progress < .45 ? (1 - effect.progress / .45) * radius * 1.5 : 0;
        context.beginPath();
        context.arc(p.x, p.y - offset, radius * .32, 0, Math.PI * 2);
        context.fillStyle = '#9B3833';
        context.fill();
        context.strokeStyle = '#FFFDF7';
        context.lineWidth = 2;
        context.stroke();
        centeredText(effect.progress < .45 ? '球' : effect.success ? '成功' : '失败', { x: p.x, y: p.y - offset - radius }, '#FFFDF7', radius * .42);
      } else {
        context.beginPath();
        context.arc(p.x, p.y, radius * (.55 + effect.progress * .45), 0, Math.PI * 2);
        context.strokeStyle = '#F0B73F';
        context.lineWidth = 3 * (1 - effect.progress) + 1;
        context.stroke();
        centeredText('进化', { x: p.x, y: p.y - radius }, '#F0B73F', radius * .48);
      }
    }
  }
}
