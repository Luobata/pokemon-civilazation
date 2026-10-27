import type { BiomeId } from '../content/rules.ts';
import { hexToOffset, indexToHex } from '../core/hex.ts';
import type { MapState } from '../core/map.ts';

export const BIOME_DISPLAY: Record<BiomeId, { label: string; color: string }> = {
  grassland: { label: '草原', color: '#a5b87a' },
  forest: { label: '森林', color: '#4e7961' },
  mountain: { label: '山地', color: '#8b8980' },
  ocean: { label: '海洋', color: '#7facbb' },
  desert: { label: '荒漠', color: '#dbbe81' },
  snow: { label: '雪原', color: '#dae4df' },
  volcano: { label: '火山', color: '#b4644c' },
};

export function drawMap(canvas: HTMLCanvasElement, map: MapState): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D。');
  const radius = 22;
  const margin = 18;
  const hexWidth = Math.sqrt(3) * radius;
  const width = Math.ceil(hexWidth * (map.width + 0.5) + margin * 2);
  const height = Math.ceil(radius * (1.5 * (map.height - 1) + 2) + margin * 2);
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.aspectRatio = `${width} / ${height}`;
  context.scale(scale, scale);

  function center(index: number) {
    const { col, row } = hexToOffset(indexToHex(index, map));
    return {
      x: margin + hexWidth * (col + (row % 2) / 2 + 0.5),
      y: margin + radius * (row * 1.5 + 1),
    };
  }

  for (const [index, biome] of map.tiles.entries()) {
    const { x, y } = center(index);
    context.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const angle = (corner * 60 - 30) * Math.PI / 180;
      const px = x + radius * Math.cos(angle);
      const py = y + radius * Math.sin(angle);
      if (corner === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fillStyle = BIOME_DISPLAY[biome].color;
    context.fill();
    context.strokeStyle = '#f5f1e466';
    context.lineWidth = 0.8;
    context.stroke();
  }

  for (const start of map.starts) {
    const { x, y } = center(start.tileIndex);
    context.beginPath();
    context.arc(x, y, 13, 0, Math.PI * 2);
    context.fillStyle = '#233d32';
    context.fill();
    context.strokeStyle = '#fff9e9';
    context.lineWidth = 2.5;
    context.stroke();
    context.fillStyle = '#fff9e9';
    context.font = 'bold 14px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(start.playerId + 1), x, y);
  }
}
