import '../styles.css';
import { generateMap } from '../core/map.ts';
import type { MapState } from '../core/map.ts';
import { BIOME_DISPLAY, drawMap } from './canvas.ts';

function start(): MapState | null {
  const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
  const info = document.querySelector<HTMLElement>('#map-info')!;
  try {
    const seed = Number(new URLSearchParams(window.location.search).get('seed') ?? '12345');
    const map = generateMap({ seed });
    drawMap(canvas, map);
    info.textContent = `种子 ${map.seed} · ${map.starts.length} 个文明 · 出生点间距 ≥${map.startDistance}`;
    const legend = document.querySelector<HTMLUListElement>('#legend')!;
    for (const { label, color } of Object.values(BIOME_DISPLAY)) {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = color;
      item.append(swatch, label);
      legend.append(item);
    }
    return map;
  } catch (error) {
    canvas.hidden = true;
    info.textContent = `无法生成地图：${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

// The same value drawn by Canvas; no browser globals are passed into the core.
export const mapState = start();
