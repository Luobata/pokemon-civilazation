// ui-25d §10: a small minimap for the 2.5D map. It stays straight top-down (no heights): one 4 × 3 px block per tile in the
// biome's colour, the owner's colour over claimed land, remembered tiles dimmed, cities as light blocks with the owner's core,
// and the camera's view as a frame. Original pixel art drawn with fillRect; the base image is redrawn only when the view's
// command number, player or known-tile count changes, so a frame costs one drawImage and four fillRects.
import type { BiomeId } from '../../content/rules.ts';
import { hexToIndex } from '../../core/hex.ts';
import type { PlayerView } from '../../core/model.ts';
import { HEX_RADIUS, mapTilt, toWorld } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';

const CELL_W = 4, CELL_H = 3;
const BIOME_PIXEL: Record<BiomeId, string> = {
  grassland: '#79A65A', forest: '#3F6E46', desert: '#D5B06C', snow: '#E1EAEA', mountain: '#8C8E80', volcano: '#6C4C44', ocean: '#2D6F90',
};
const UNKNOWN = '#0A1418';

export type Minimap = {
  /** Draws the minimap for this view and camera (`null` hides it, e.g. on the flat map). */
  update(view: PlayerView | null, camera: Camera, viewport: { width: number; height: number }): void;
};

/** Minimap block of a world point (canvas px), the inverse of the jump below. */
export function minimapPoint(world: Point): Point {
  return { x: world.x / (Math.sqrt(3) * HEX_RADIUS) * CELL_W + CELL_W / 2, y: world.y / (1.5 * HEX_RADIUS * mapTilt()) * CELL_H + CELL_H / 2 };
}
export function minimapWorld(point: Point): Point {
  return { x: (point.x - CELL_W / 2) / CELL_W * Math.sqrt(3) * HEX_RADIUS, y: (point.y - CELL_H / 2) / CELL_H * 1.5 * HEX_RADIUS * mapTilt() };
}

export function createMinimap(host: HTMLElement, colors: readonly string[], jump: (world: Point) => void): Minimap {
  // The element is created on the first 2.5D frame, so the flat map's page has no extra canvas.
  let root: HTMLDivElement | null = null;
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
  const base = document.createElement('canvas'), baseContext = base.getContext('2d')!;
  let baseKey = '', scale = 1, wrapWidth = 0;
  function mount(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'minimap';
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', '小地图：点击跳到该处');
    element.title = '小地图：点击跳到该处';
    element.append(canvas);
    host.append(element);
    const jumpAt = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      jump(minimapWorld({ x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale }));
    };
    let dragging = false;
    element.addEventListener('pointerdown', event => { dragging = true; element.setPointerCapture(event.pointerId); jumpAt(event); event.preventDefault(); });
    element.addEventListener('pointermove', event => { if (dragging) jumpAt(event); });
    element.addEventListener('pointerup', () => { dragging = false; });
    element.addEventListener('pointercancel', () => { dragging = false; });
    return element;
  }

  function paintBase(view: PlayerView) {
    const { width, height, tiles } = view.map;
    base.width = width * CELL_W + CELL_W / 2; base.height = height * CELL_H + 1;
    wrapWidth = width * CELL_W;
    const visible = new Set(view.visibleTileIds), g = baseContext;
    g.fillStyle = UNKNOWN; g.fillRect(0, 0, base.width, base.height);
    const cities = new Map(view.cities.map(city => [hexToIndex(city.position, view.map), city.ownerId]));
    for (let index = 0; index < tiles.length; index++) {
      const biome = tiles[index];
      if (!biome) continue;
      const row = Math.floor(index / width), col = index % width, x = col * CELL_W + (row % 2 ? CELL_W / 2 : 0), y = row * CELL_H;
      g.fillStyle = BIOME_PIXEL[biome]; g.fillRect(x, y, CELL_W, CELL_H);
      const owners = view.territoryOwnerIds[index];
      if (owners?.length) {
        // Claimed land: the owner's colour on the block's top row and a half-tone over the rest.
        g.fillStyle = colors[owners[0] % colors.length]; g.fillRect(x, y, CELL_W, 1);
        g.globalAlpha = .38; g.fillRect(x, y + 1, CELL_W, CELL_H - 1); g.globalAlpha = 1;
      }
      if (!visible.has(index)) { g.fillStyle = 'rgba(6,12,16,.42)'; g.fillRect(x, y, CELL_W, CELL_H); }
      const city = cities.get(index);
      if (city !== undefined) {
        g.fillStyle = '#FFF6D8'; g.fillRect(x, y, CELL_W, CELL_H);
        g.fillStyle = city === null ? '#8C978F' : colors[city % colors.length]; g.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
      }
    }
  }

  return {
    update(view, camera, viewport) {
      if (!view) { if (root) root.hidden = true; return; }
      root ??= mount();
      root.hidden = false;
      const key = `${view.playerId}|${view.commandSeq}|${view.round}|${view.visibleTileIds.length}|${view.map.tiles.length}|${mapTilt()}`;
      if (key !== baseKey) {
        baseKey = key;
        paintBase(view);
        // Integer CSS scale (crisp pixels): 2× on standard maps, 1× on the largest.
        scale = Math.max(1, Math.floor(260 / base.width));
        canvas.width = base.width; canvas.height = base.height;
        canvas.style.width = `${base.width * scale}px`; canvas.style.height = `${base.height * scale}px`;
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(base, 0, 0);
      // The camera's view: a 1 px light frame with a dark outline (both wrapped copies on an east-west map).
      const a = minimapPoint(toWorld({ x: 0, y: 0 }, camera)), b = minimapPoint(toWorld({ x: viewport.width, y: viewport.height }, camera));
      const frame = (x: number) => {
        const left = Math.round(x), top = Math.round(Math.max(0, a.y)), right = Math.round(x + b.x - a.x), bottom = Math.round(Math.min(canvas.height, b.y));
        if (right <= left || bottom <= top) return;
        context.fillStyle = '#0A1418';
        context.fillRect(left - 1, top - 1, right - left + 2, 3); context.fillRect(left - 1, bottom - 2, right - left + 2, 3);
        context.fillRect(left - 1, top - 1, 3, bottom - top + 2); context.fillRect(right - 2, top - 1, 3, bottom - top + 2);
        context.fillStyle = '#FFF3C4';
        context.fillRect(left, top, right - left, 1); context.fillRect(left, bottom - 1, right - left, 1);
        context.fillRect(left, top, 1, bottom - top); context.fillRect(right - 1, top, 1, bottom - top);
      };
      if (view.map.wrap && wrapWidth) {
        const start = ((a.x % wrapWidth) + wrapWidth) % wrapWidth;
        frame(start); frame(start - wrapWidth);
      } else frame(a.x);
    },
  };
}
