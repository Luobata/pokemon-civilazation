import { RARE_BERRIES } from '../content/rare-berries.ts';
import { ERA_ABILITY_RULES, WEATHERS } from '../content/era-abilities.ts';
import { IMPROVEMENTS } from '../content/improvements.ts';
import type { BiomeId } from '../content/rules.ts';
import type { UnitIdentity } from '../content/units.ts';
import { speciesDisplay } from '../content/species.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { HEX_RADIUS, hexToWorld, toScreen } from './camera.ts';
import type { Camera, Point } from './camera.ts';
import { pokemonSprite } from './sprites.ts';
import { drawTerrain } from './terrain.ts';

export const BIOME_DISPLAY: Record<BiomeId, { label: string; color: string; symbol: string }> = {
  grassland: { label: '草原', color: '#76975D', symbol: '≈' },
  forest: { label: '森林', color: '#3F684E', symbol: '♠' },
  mountain: { label: '山地', color: '#737B70', symbol: '⋀⋀' },
  ocean: { label: '海洋', color: '#397B92', symbol: '≈' },
  desert: { label: '荒漠', color: '#C5A364', symbol: '∿' },
  snow: { label: '雪原', color: '#BFD5D5', symbol: '✣' },
  volcano: { label: '火山', color: '#594944', symbol: '⋀' },
};
const FACTIONS = ['#3BA68A', '#D3655C', '#9B83D0', '#D59A45'];
export const FACTION_LEGEND = [
  { id: 0, label: '文明 1 · 实心', className: 'faction-solid' },
  { id: 1, label: '文明 2 · 斜线', className: 'faction-diagonal' },
  { id: 2, label: '文明 3 · 圆点', className: 'faction-dots' },
  { id: 3, label: '文明 4 · 交叉线', className: 'faction-cross' },
];
export type AnimationPose = { unit: UnitIdentity & { id: number; ownerId: number | null }; position: Point };
export type MapEffect = { kind: 'battle'; position: Hex; damage: number; counterDamage: number; progress: number }
  | { kind: 'capture'; position: Hex; success: boolean; progress: number }
  | { kind: 'evolve'; position: Hex; progress: number };

export type DebugOverlay = 'none' | 'tiles' | 'vision' | 'wild' | 'ai';
const geometry = new Map<string, Point[]>();
const corners = Array.from({ length: 6 }, (_, corner) => ({ x: Math.cos((corner * 60 - 30) * Math.PI / 180), y: Math.sin((corner * 60 - 30) * Math.PI / 180) }));

export function drawMap(canvas: HTMLCanvasElement, view: PlayerView, camera: Camera,
  selected: number | null, reachable: readonly number[], pose?: AnimationPose, cursorIndex?: number | null,
  effect?: MapEffect, actionMode: 'move' | 'attack' | 'capture' | null = null,
  actionTargets: readonly number[] = [], pendingTargetIndex?: number | null, selectedCity?: number | null, debugOverlay: DebugOverlay = 'none'): void {
  const context = canvas.getContext('2d')!;
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  const radius = HEX_RADIUS * camera.zoom;
  const geometryKey = `${view.map.width}:${view.map.height}`;
  if (!geometry.has(geometryKey)) {
    if (geometry.size >= 3) geometry.delete(geometry.keys().next().value!);
    geometry.set(geometryKey, view.map.tiles.map((_, i) => hexToWorld(indexToHex(i, view.map))));
  }
  const centers = geometry.get(geometryKey)!.map(position => toScreen(position, camera));
  const onscreen = (p: Point) => p.x >= -radius && p.x <= width + radius && p.y >= -radius && p.y <= height + radius;
  function polygon(p: Point) {
    context!.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const x = p.x + radius * corners[corner].x, y = p.y + radius * corners[corner].y;
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
  function factionRect(ownerId: number | null, p: Point, size: number, corner: number) {
    context!.beginPath();
    context!.roundRect(p.x - size / 2, p.y - size / 2, size, size, corner);
    context!.fillStyle = ownerColor(ownerId);
    context!.fill();
    if (ownerId === null || ownerId === 0) return;
    context!.save();
    context!.clip();
    context!.strokeStyle = '#FFFDF766';
    context!.fillStyle = '#FFFDF788';
    context!.lineWidth = 1;
    const spacing = Math.max(5, size / 5);
    if (ownerId === 2) {
      for (let x = p.x - size / 2 + 3; x < p.x + size / 2; x += spacing)
        for (let y = p.y - size / 2 + 3; y < p.y + size / 2; y += spacing) {
          context!.beginPath(); context!.arc(x, y, 1.2, 0, Math.PI * 2); context!.fill();
        }
    } else {
      for (let offset = -size; offset <= size; offset += spacing) {
        context!.beginPath();
        context!.moveTo(p.x - size + offset, p.y + size);
        context!.lineTo(p.x + size + offset, p.y - size);
        if (ownerId === 3) { context!.moveTo(p.x - size + offset, p.y - size); context!.lineTo(p.x + size + offset, p.y + size); }
        context!.stroke();
      }
    }
    context!.restore();
    // Canvas save/restore does not restore paths; callers stroke the badge outline.
    context!.beginPath();
    context!.roundRect(p.x - size / 2, p.y - size / 2, size, size, corner);
  }
  function ownerBadge(ownerId: number | null, p: Point, size: number) {
    const badge = Math.max(13, size * .42), x = p.x + size * .32, y = p.y - size * .38;
    factionRect(ownerId, { x, y }, badge, badge / 2);
    context!.strokeStyle = '#FFFDF7';
    context!.lineWidth = 1;
    context!.stroke();
    centeredText(ownerId === null ? '爪' : String(ownerId + 1), { x, y: y + .3 }, '#FFFDF7', badge * .65);
  }
  const visible = new Set(view.visibleTileIds);

  for (const [i, biome] of view.map.tiles.entries()) {
    if (!onscreen(centers[i])) continue;
    if (biome) drawTerrain(context, biome, i, centers[i], radius);
    else {
      polygon(centers[i]);
      context.fillStyle = '#0C171C';
      context.fill();
    }
    polygon(centers[i]);
    context.strokeStyle = biome ? '#162E304A' : '#60807826';
    context.lineWidth = biome ? .8 : .65;
    context.stroke();
  }

  const edgeCorners = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
  function edge(index: number, direction: number) {
    const [a, b] = edgeCorners[direction];
    const startAngle = (a * 60 - 30) * Math.PI / 180, endAngle = (b * 60 - 30) * Math.PI / 180;
    context.beginPath();
    context.moveTo(centers[index].x + radius * Math.cos(startAngle), centers[index].y + radius * Math.sin(startAngle));
    context.lineTo(centers[index].x + radius * Math.cos(endAngle), centers[index].y + radius * Math.sin(endAngle));
  }
  for (const [index, biome] of view.map.tiles.entries()) {
    if (biome !== 'ocean' || !onscreen(centers[index])) continue;
    const adjacent = neighbors(indexToHex(index, view.map)).map(hex => hexToIndex(hex, view.map));
    for (const [direction, neighbor] of adjacent.entries()) {
      const neighborBiome = neighbor === null ? null : view.map.tiles[neighbor];
      if (!neighborBiome || neighborBiome === 'ocean') continue;
      edge(index, direction);
      context.strokeStyle = '#C9B67D'; context.lineWidth = Math.max(1.5, radius * .13); context.stroke();
      edge(index, direction);
      context.strokeStyle = '#A7D1C8'; context.lineWidth = Math.max(.7, radius * .045); context.stroke();
    }
  }
  for (const [index, owners] of view.territoryOwnerIds.entries()) {
    if (!owners?.length || !onscreen(centers[index])) continue;
    const adjacent = neighbors(indexToHex(index, view.map)).map(hex => hexToIndex(hex, view.map));
    for (const ownerId of owners) for (const [direction, [a, b]] of edgeCorners.entries()) {
      const neighbor = adjacent[direction];
      if (neighbor !== null && view.territoryOwnerIds[neighbor]?.includes(ownerId)) continue;
      const startAngle = (a * 60 - 30) * Math.PI / 180, endAngle = (b * 60 - 30) * Math.PI / 180;
      context!.beginPath();
      context!.moveTo(centers[index].x + radius * Math.cos(startAngle), centers[index].y + radius * Math.sin(startAngle));
      context!.lineTo(centers[index].x + radius * Math.cos(endAngle), centers[index].y + radius * Math.sin(endAngle));
      context!.strokeStyle = '#1D2B26'; context!.lineWidth = 4; context!.stroke();
      context!.strokeStyle = ownerColor(ownerId); context!.lineWidth = 2; context!.stroke();
    }
  }

  if (view.expansion) {
    const siteMark = (position: Hex, label: string, color: string) => {
      const index = hexToIndex(position, view.map);
      if (index === null || !visible.has(index) || !onscreen(centers[index])) return;
      const p = { x: centers[index].x, y: centers[index].y + radius * .62 };
      const size = Math.max(10, radius * .38);
      context.beginPath(); context.roundRect(p.x - size, p.y - size * .65, size * 2, size * 1.3, 3);
      context.fillStyle = color; context.fill();
      context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(label, p, '#FFF8E5', size);
    };
    for (const tile of view.expansion.improvements?.tiles ?? []) {
      const index = hexToIndex(tile.position, view.map);
      if (index === null || !onscreen(centers[index])) continue;
      const p = { x: centers[index].x - radius * .55, y: centers[index].y + radius * .4 }, size = Math.max(8, radius * .3);
      context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2);
      context.fillStyle = '#B9822F'; context.fill(); context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
      centeredText(IMPROVEMENTS[tile.kind].mark, p, '#FFF8E5', size * 1.2);
    }
    for (const deposit of view.expansion.rareBerries?.deposits ?? []) siteMark(indexToHex(deposit.tileIndex, view.map), RARE_BERRIES[deposit.berry].mark, '#B0487A');
    for (const site of view.expansion.world.resources) siteMark(site.position, site.kind === 'berry' ? '果' : '石', site.remaining ? '#487744' : '#65706B');
    for (const site of view.expansion.world.nests) siteMark(site.position, '巢', '#A34F3F');
    for (const site of view.expansion.world.overlords) siteMark(site.position, '霸', '#8D6332');
    for (const site of view.expansion.civilization.sanctuaries) siteMark(site.position, site.guardianDefeated ? '碑' : '圣', '#66518E');
  }

  for (const city of view.cities) {
    const p = centers[hexToIndex(city.position, view.map)!];
    if (!onscreen(p)) continue;
    const size = Math.max(28, Math.min(42, radius * 1.65));
    if (city.id === selectedCity) {
      polygon(p); context.strokeStyle = '#10191B'; context.lineWidth = 6; context.stroke();
      polygon(p); context.strokeStyle = '#F2C14E'; context.lineWidth = 3; context.stroke();
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
    ownerBadge(city.ownerId, p, size);
  }

  function unitMark(unit: AnimationPose['unit'], point: Point, actionLeft?: number, enraged = false) {
    if (!onscreen(point)) return;
    const size = Math.max(26, Math.min(54, radius * 1.75));
    context.beginPath();
    context.ellipse(point.x, point.y + size * .32, size * .37, size * .15, 0, 0, Math.PI * 2);
    context.fillStyle = '#071114A6'; context.fill();
    const marker = size * .58;
    factionRect(unit.ownerId, { x: point.x, y: point.y + size * .2 }, marker, marker / 2);
    context.strokeStyle = '#132625'; context.lineWidth = 3; context.stroke();
    context.beginPath();
    context.arc(point.x, point.y + size * .2, marker * .43, 0, Math.PI * 2);
    context.strokeStyle = actionLeft === 0 ? '#81908A' : '#F2E7C9'; context.lineWidth = 1.2; context.stroke();
    const sprite = unit.kind === 'pokemon' ? pokemonSprite(unit.speciesId) : null;
    if (sprite) context.drawImage(sprite, Math.round(point.x - size * .54), Math.round(point.y - size * .62), Math.round(size * 1.08), Math.round(size * 1.08));
    else if (unit.kind === 'pokemon') centeredText(speciesDisplay(unit.speciesId).abbreviation, point, '#FFF3D4', size * .42);
    else {
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
    ownerBadge(unit.ownerId, point, size);
    if (actionLeft === 0) {
      context.beginPath(); context.arc(point.x - size * .3, point.y + size * .29, size * .15, 0, Math.PI * 2);
      context.fillStyle = '#263B39'; context.fill();
      centeredText('✓', { x: point.x - size * .3, y: point.y + size * .29 }, '#D4DED5', size * .25);
    }
    if (enraged) {
      context.beginPath();
      context.arc(point.x - size * .38, point.y - size * .35, size * .18, 0, Math.PI * 2);
      context.fillStyle = '#B84D45';
      context.fill();
      centeredText('!', { x: point.x - size * .38, y: point.y - size * .35 }, '#FFF3D4', size * .32);
    }
  }
  // Only the authorized PlayerView supplies entities; hidden live units never enter a draw call.
  const era = view.expansion?.eraAbilities;
  if (era) {
    // Weather tints its radius; night dims the whole visible map.
    for (const field of era.fields) {
      if (field.untilRound < view.round) continue;
      const weather = WEATHERS[field.weather];
      for (const index of visible) {
        if (!onscreen(centers[index]) || hexDistance(indexToHex(index, view.map), field.center) > ERA_ABILITY_RULES.weatherRadius) continue;
        polygon(centers[index]); context.fillStyle = `${weather.color}33`; context.fill();
      }
      const centerIndex = hexToIndex(field.center, view.map);
      if (centerIndex !== null && visible.has(centerIndex) && onscreen(centers[centerIndex])) {
        const p = { x: centers[centerIndex].x + radius * .6, y: centers[centerIndex].y + radius * .45 }, size = Math.max(9, radius * .32);
        context.beginPath(); context.arc(p.x, p.y, size, 0, Math.PI * 2); context.fillStyle = weather.color; context.fill();
        context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
        centeredText(weather.mark, p, '#10191B', size * 1.2);
      }
    }
    if (era.night) { context.fillStyle = '#0A143066'; context.fillRect(0, 0, width, height); }
  }
  for (const unit of view.units) if (unit.id !== pose?.unit.id) {
    unitMark(unit, centers[hexToIndex(unit.position, view.map)!], unit.actionLeft, unit.enraged);
    const status = era?.units[unit.id];
    if (status && (status.mega || status.tera || (status.dynamaxUntilRound ?? 0) >= view.round || status.zPrimed)) {
      const p = centers[hexToIndex(unit.position, view.map)!];
      if (onscreen(p)) {
        const label = status.mega ? 'M' : (status.dynamaxUntilRound ?? 0) >= view.round ? '极' : status.tera ? '晶' : 'Z';
        const q = { x: p.x - radius * .55, y: p.y - radius * .55 }, size = Math.max(8, radius * .28);
        context.beginPath(); context.arc(q.x, q.y, size, 0, Math.PI * 2); context.fillStyle = '#B15AD6'; context.fill();
        context.strokeStyle = '#F6EACA'; context.lineWidth = 1; context.stroke();
        centeredText(label, q, '#FFF8E5', size * 1.1);
      }
    }
  }
  if (pose) unitMark(pose.unit, toScreen(pose.position, camera));

  for (const index of reachable) if (visible.has(index) && onscreen(centers[index])) {
    const p = centers[index];
    polygon(p);
    context.fillStyle = '#42B99622';
    context.fill();
    context.strokeStyle = '#75D2AE';
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(p.x, p.y, Math.max(2, radius * .1), 0, Math.PI * 2);
    context.fillStyle = '#D5F0C9';
    context.fill();
    context.strokeStyle = '#245A49'; context.lineWidth = 1.5; context.stroke();
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

  if (debugOverlay !== 'none') {
    for (const [i, biome] of view.map.tiles.entries()) {
      if (!biome || !onscreen(centers[i])) continue;
      if (debugOverlay === 'tiles') {
        const hex = indexToHex(i, view.map);
        centeredText(`${i} (${hex.q},${hex.r})`, centers[i], '#fff', 9);
      } else if (debugOverlay === 'vision') {
        polygon(centers[i]); context.fillStyle = visible.has(i) ? '#38E0A438' : '#E0B03838'; context.fill();
      }
    }
    if (debugOverlay === 'wild' || debugOverlay === 'ai') for (const unit of view.units) {
      if ((debugOverlay === 'wild' && unit.ownerId !== null) || (debugOverlay === 'ai' && unit.ownerId === null)) continue;
      const p = centers[hexToIndex(unit.position, view.map)!];
      if (onscreen(p)) centeredText(`#${unit.id} A${unit.actionLeft}${unit.enraged ? ' 暴走' : ''}`, { x: p.x, y: p.y + radius * .75 }, '#fff', 9);
    }
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
