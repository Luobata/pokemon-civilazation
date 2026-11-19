// ui-25d §12: the 2.5D terrain is cached in world space as chunks (a few rows × columns each, ~600 device px), rendered once per
// zoom and reused while the camera pans. Round 2: the visible chunks are composited into a screen-sized canvas, so a still frame
// is one blit and a panning frame blits that composite shifted and paints chunks only into the strips that scrolled into view.
// Chunks are blitted back row first (wrapped copies interleaved), so a nearer chunk's tall columns cover the farther chunk, as
// in the direct drawing. Rebuilt lazily when the terrain key (biomes, features, borders), zoom, DPR or tilt changes.
import { HEX_RADIUS } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import type { MapScene } from './scene.ts';
import { drawBase25d } from './terrain25d.ts';
import type { Base25d } from './terrain25d.ts';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Rect = { x: number; y: number; width: number; height: number };
/** `fog`: the chunk's fogged tiles when it was built (fogged props carry a veil, so a chunk is rebuilt when its fog changes). */
type Chunk = { canvas: HTMLCanvasElement; ox: number; oy: number; used: number; fog: string };
/** Chunks kept at most (least recently used ones are dropped). */
const CHUNK_CAP = 96;

export type ChunkFrame = {
  context: CanvasRenderingContext2D; scene: MapScene; lifts: Float32Array; camera: Camera; squash: number; dpr: number;
  /** Screen-x shift of each wrapped copy (CSS px). */
  shifts: readonly number[];
  width: number; height: number; shakeX: number; shakeY: number;
  /** Terrain inputs (biomes, features, territory edges) and the cache generation; zoom, DPR and tilt are added here. */
  key: string;
  /** The camera held still since the last frame (chunks for a new zoom are only built then). */
  settled: boolean;
  ownerColor(ownerId: number | null): string;
  /** ui-painted: the chunk painter (default: the 2.5D terrain). */
  paint?: (args: Base25d) => void;
  /** ui-painted: a chunk also paints this many rows / columns of neighbours, so their fogged tiles count in its fog signature. */
  fogReach?: { rows: number; cols: number };
};

export function createChunkCache() {
  let key = '', frameNumber = 0, fogFor: readonly number[] | null = null, fogKeys: string[] = [];
  let layout: { rows: number; cols: number; bounds: Bounds[]; zoomed: Point[] } | null = null;
  let front: CanvasRenderingContext2D | null = null, screenKey = '', screenX = 0, screenY = 0, lastX = NaN, lastY = NaN;
  const chunks = new Map<number, Chunk>();
  return {
    /** Draws the terrain from chunks; 'direct' when the zoom just changed and the camera is still moving (no chunks built). */
    draw(f: ChunkFrame): 'hit' | 'miss' | 'direct' {
      const { scene, camera, dpr } = f, zoom = camera.zoom, radius = HEX_RADIUS * zoom;
      const full = `${f.key}|${zoom}|${dpr}|${f.squash}`;
      if (full !== key) {
        if (!f.settled && key) return 'direct';
        key = full; chunks.clear(); fogFor = null;
        // World positions at this zoom (lifted), relative to the camera origin: screen = zoomed + camera + shift.
        const zoomed = scene.tiles.map((tile, index) => ({ x: tile.world.x * zoom, y: tile.world.y * zoom - f.lifts[index] * zoom }));
        const tileWidth = Math.sqrt(3) * radius * dpr, rowHeight = 1.5 * radius * f.squash * dpr;
        const cols = Math.max(2, Math.min(16, Math.floor(640 / tileWidth))), rows = Math.max(2, Math.min(16, Math.floor(480 / rowHeight)));
        const across = Math.ceil(scene.width / cols), bounds: Bounds[] = [];
        for (let index = 0; index < zoomed.length; index++) {
          const row = Math.floor(index / scene.width), col = index % scene.width, id = Math.floor(row / rows) * across + Math.floor(col / cols), p = zoomed[index];
          const box = bounds[id] ??= { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          // Room for props and landmark stones above a tile, and for its cliffs down to the unexplored floor below it.
          box.minX = Math.min(box.minX, p.x - radius * 1.3); box.maxX = Math.max(box.maxX, p.x + radius * 1.3);
          box.minY = Math.min(box.minY, p.y - radius * 3); box.maxY = Math.max(box.maxY, p.y + radius * 2.8);
        }
        layout = { rows, cols, bounds, zoomed };
      }
      const { rows, cols, bounds, zoomed } = layout!, across = Math.ceil(scene.width / cols), down = Math.ceil(scene.height / rows);
      // Per-chunk fog signature (only the chunks whose fogged tiles changed are rebuilt after a move).
      let fogChanged = false;
      if (scene.fog !== fogFor) {
        fogFor = scene.fog;
        const lists: number[][] = [];
        const reach = f.fogReach;
        for (const index of scene.fog) {
          const row = Math.floor(index / scene.width), col = index % scene.width;
          if (!reach) { (lists[Math.floor(row / rows) * across + Math.floor(col / cols)] ??= []).push(index); continue; }
          // Every chunk whose ring of neighbours includes this tile (columns folded across the wrap).
          const ids = new Set<number>();
          for (let r = Math.max(0, row - reach.rows); r <= Math.min(scene.height - 1, row + reach.rows); r++) for (let c = col - reach.cols; c <= col + reach.cols; c++) {
            if ((c < 0 || c >= scene.width) && !scene.wrap) continue;
            ids.add(Math.floor(r / rows) * across + Math.floor(((c % scene.width) + scene.width) % scene.width / cols));
          }
          for (const id of ids) (lists[id] ??= []).push(index);
        }
        const next = lists.map(list => list.join(','));
        fogChanged = next.length !== fogKeys.length || next.some((item, id) => item !== fogKeys[id]);
        fogKeys = next;
      }
      let built = false;
      frameNumber++;
      // Paints the chunks onto a screen-sized target (device px, moved by ox / oy), only inside `rects` when given.
      const paint = (target: CanvasRenderingContext2D, rects: readonly Rect[] | null, ox = 0, oy = 0) => {
        target.save();
        target.setTransform(1, 0, 0, 1, 0, 0);
        if (rects) { target.beginPath(); for (const r of rects) target.rect(r.x, r.y, r.width, r.height); target.clip(); }
        for (let chunkRow = 0; chunkRow < down; chunkRow++) for (const shift of f.shifts) for (let chunkCol = 0; chunkCol < across; chunkCol++) {
          const id = chunkRow * across + chunkCol, box = bounds[id];
          if (!box) continue;
          const x = Math.floor(box.minX * dpr) + Math.round((camera.x + shift) * dpr) + ox, y = Math.floor(box.minY * dpr) + Math.round(camera.y * dpr) + oy;
          const w = Math.ceil((box.maxX - box.minX) * dpr) + 2, h = Math.ceil((box.maxY - box.minY) * dpr) + 2;
          if (x > target.canvas.width || x + w < 0 || y > target.canvas.height || y + h < 0) continue;
          if (rects && !rects.some(r => x < r.x + r.width && r.x < x + w && y < r.y + r.height && r.y < y + h)) continue;
          let chunk = chunks.get(id);
          const fog = fogKeys[id] ?? '';
          if (!chunk || chunk.fog !== fog) {
            chunk = build(f, zoomed, box, [chunkRow * rows, Math.min(scene.height, (chunkRow + 1) * rows)], [chunkCol * cols, Math.min(scene.width, (chunkCol + 1) * cols)], fog);
            chunks.set(id, chunk);
            built = true;
          }
          chunk.used = frameNumber;
          target.drawImage(chunk.canvas, chunk.ox + Math.round((camera.x + shift) * dpr) + ox, chunk.oy + Math.round(camera.y * dpr) + oy);
        }
        target.restore();
      };
      // Screen composite: a still frame is one blit. While the camera pans, the composite (built at an earlier camera) is blitted
      // shifted by the integer device-pixel step and only the strips that scrolled into view are painted from chunks, straight
      // onto the frame; it is rebuilt once the camera holds still, or when those strips pass 30 % of the screen.
      const deviceWidth = f.context.canvas.width, deviceHeight = f.context.canvas.height;
      const sx = Math.round(camera.x * dpr), sy = Math.round(camera.y * dpr), held = sx === lastX && sy === lastY;
      lastX = sx; lastY = sy;
      if (!front || front.canvas.width !== deviceWidth || front.canvas.height !== deviceHeight) { front = screenCanvas(deviceWidth, deviceHeight); screenKey = ''; }
      let dx = sx - screenX, dy = sy - screenY;
      if (screenKey !== key || fogChanged || (dx || dy) && (held || Math.abs(dx) > deviceWidth * .3 || Math.abs(dy) > deviceHeight * .3)) {
        front.clearRect(0, 0, deviceWidth, deviceHeight);
        paint(front, null);
        screenKey = key; screenX = sx; screenY = sy; dx = 0; dy = 0; built = true;
      }
      f.context.save();
      f.context.setTransform(1, 0, 0, 1, 0, 0);
      f.context.drawImage(front.canvas, dx + f.shakeX, dy + f.shakeY);
      f.context.restore();
      if (dx || dy) {
        const rects: Rect[] = [], x0 = f.shakeX, y0 = f.shakeY;
        if (dx > 0) rects.push({ x: x0, y: y0, width: dx, height: deviceHeight }); else if (dx < 0) rects.push({ x: x0 + deviceWidth + dx, y: y0, width: -dx, height: deviceHeight });
        if (dy > 0) rects.push({ x: x0, y: y0, width: deviceWidth, height: dy }); else if (dy < 0) rects.push({ x: x0, y: y0 + deviceHeight + dy, width: deviceWidth, height: -dy });
        paint(f.context, rects, f.shakeX, f.shakeY);
      }
      if (chunks.size > CHUNK_CAP) {
        const old = [...chunks.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, chunks.size - CHUNK_CAP);
        for (const [id] of old) chunks.delete(id);
      }
      return built ? 'miss' : 'hit';
    },
    clear() { key = ''; chunks.clear(); layout = null; fogFor = null; screenKey = ''; },
  };
}

function screenCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  return context;
}

function build(f: ChunkFrame, zoomed: readonly Point[], box: Bounds, rows: readonly [number, number], cols: readonly [number, number], fog: string): Chunk {
  const { dpr } = f, ox = Math.floor(box.minX * dpr), oy = Math.floor(box.minY * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(box.maxX * dpr) - ox + 1; canvas.height = Math.ceil(box.maxY * dpr) - oy + 1;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const local = zoomed.map(p => ({ x: p.x - ox / dpr, y: p.y - oy / dpr }));
  (f.paint ?? drawBase25d)({ context, scene: f.scene, lifts: f.lifts, radius: HEX_RADIUS * f.camera.zoom, zoom: f.camera.zoom, squash: f.squash,
    copies: [local], width: canvas.width / dpr, height: canvas.height / dpr, ownerColor: f.ownerColor, rows, cols });
  return { canvas, ox, oy, used: 0, fog };
}
