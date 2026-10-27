import type { BiomeId } from '../content/rules.ts';
import type { UnitIdentity } from '../content/units.ts';
import { hexToIndex, indexToHex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { HEX_RADIUS, hexToWorld, toScreen } from './camera.ts';
import type { Camera, Point } from './camera.ts';

export const BIOME_DISPLAY: Record<BiomeId, { label: string; color: string }> = {
  grassland: { label: '草原', color: '#a5b87a' }, forest: { label: '森林', color: '#4e7961' },
  mountain: { label: '山地', color: '#8b8980' }, ocean: { label: '海洋', color: '#7facbb' },
  desert: { label: '荒漠', color: '#dbbe81' }, snow: { label: '雪原', color: '#dae4df' },
  volcano: { label: '火山', color: '#b4644c' },
};
export type AnimationPose = { unit: UnitIdentity & { id: number; ownerId: number }; position: Point };
export function drawMap(canvas: HTMLCanvasElement, view: PlayerView, camera: Camera,
  selected: number | null, reachable: readonly number[], pose?: AnimationPose): void {
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
  const visible = new Set(view.visibleTileIds);
  for (const [i, biome] of view.map.tiles.entries()) {
    if (!onscreen(centers[i])) continue;
    polygon(centers[i]);
    context.fillStyle = biome ? BIOME_DISPLAY[biome].color : '#111a17';
    context.fill();
    context.strokeStyle = '#f5f1e444'; context.lineWidth = 0.7; context.stroke();
  }
  for (const city of view.cities) {
    const p = centers[hexToIndex(city.position, view.map)!];
    if (!onscreen(p)) continue;
    context.strokeStyle = '#fff9e9'; context.lineWidth = 3;
    context.strokeRect(p.x - radius * .62, p.y - radius * .62, radius * 1.24, radius * 1.24);
  }
  function unitMark(unit: AnimationPose['unit'], point: Point, actionLeft?: number) {
    if (!onscreen(point)) return;
    context!.beginPath(); context!.arc(point.x, point.y, radius * .48, 0, Math.PI * 2);
    context!.fillStyle = unit.ownerId === view.playerId ? '#233d32' : '#8a3e38'; context!.fill();
    context!.strokeStyle = actionLeft === 0 ? '#aeb4a5' : '#fff9e9'; context!.lineWidth = 2; context!.stroke();
    context!.font = `bold ${Math.max(9, radius * .55)}px system-ui`;
    context!.textAlign = 'center'; context!.textBaseline = 'middle'; context!.fillStyle = '#fff9e9';
    const names = { bulbasaur: '草', charmander: '火', squirtle: '水' };
    context!.fillText(unit.kind === 'pokemon' ? names[unit.speciesId] : '拓', point.x, point.y);
  }
  // PlayerView contains current visible entities only; historical markers never
  // become live units under the translucent fog.
  for (const unit of view.units) if (unit.id !== pose?.unit.id) {
    unitMark(unit, centers[hexToIndex(unit.position, view.map)!], unit.actionLeft);
  }
  if (pose) unitMark(pose.unit, toScreen(pose.position, camera));
  for (const index of reachable) if (visible.has(index) && onscreen(centers[index])) {
    polygon(centers[index]); context.strokeStyle = '#faff91'; context.lineWidth = 2; context.stroke();
  }
  for (const [i, biome] of view.map.tiles.entries()) if (biome && !visible.has(i) && onscreen(centers[i])) {
    polygon(centers[i]); context.fillStyle = '#111a17b8'; context.fill();
  }
  const unit = view.units.find(unit => unit.id === selected);
  if (unit && !pose) {
    const p = centers[hexToIndex(unit.position, view.map)!];
    context.beginPath(); context.arc(p.x, p.y, radius * .7, 0, Math.PI * 2);
    context.strokeStyle = '#fff495'; context.lineWidth = 2; context.stroke();
  }
}
