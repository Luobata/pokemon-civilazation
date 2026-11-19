// Public entry for map rendering: build a scene from game + UI state, then draw it.
import { tileToScreen } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import type { Hex, MapShape } from '../../core/hex.ts';
import { applyRenderMode } from './projection.ts';
import type { RenderMode } from './projection.ts';
import { buildScene } from './scene.ts';
import type { MapRenderInput } from './scene.ts';
import { createCanvas2DRenderer } from './canvas2d.ts';
import type { RenderStats, RendererOptions } from './canvas2d.ts';
import type { AnimationFrame } from './animation.ts';
import { createPaintedRenderer } from './painted/backend.ts';
import type { PaintedBackend } from './painted/backend.ts';

export { buildScene, DEFAULT_MAP_LAYERS } from './scene.ts';
export type { DebugOverlay, MapLayers, MapRenderInput, MapScene } from './scene.ts';
export { FACTIONS, YIELD_MIN_RADIUS } from './canvas2d.ts';
export type { RenderStats, RendererOptions } from './canvas2d.ts';
export { EMPTY_FRAME, Timeline } from './animation.ts';
export type { AnimationFrame, MapEffect, Track, UnitPose } from './animation.ts';

export { RENDER_MODE_KEY, applyRenderMode, requestedRenderMode } from './projection.ts';
export type { RenderMode } from './projection.ts';

export type MapFrameInput = MapRenderInput & { camera: Camera; animation?: AnimationFrame };

/** One renderer per canvas: it owns that canvas's layer caches. `setMode` swaps the backend (flat ⇄ 2.5D, ui-25d). */
export function createMapRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
  // ui-painted: the 绘卷 theme has its own backend with the same interface (it also reads the view, for unit type badges).
  const make = (next: RenderMode): PaintedBackend => next === 'painted' ? createPaintedRenderer(canvas, { ...options, mode: next }) : createCanvas2DRenderer(canvas, { ...options, mode: next });
  let mode: RenderMode = options.mode ?? 'flat', backend = make(mode);
  return {
    render(input: MapFrameInput): RenderStats { return backend.render(buildScene(input), input.camera, input.animation, input.view); },
    invalidate() { backend.invalidate(); },
    /** The tile under a screen point (pixel-plane hex: fold it with hexToIndex). */
    pick(point: Point, camera: Camera): Hex { return backend.pick(point, camera); },
    /** A tile's lift in world px under the active projection (0 on the flat map): overlay anchors and camera focus use it. */
    lift(hex: Hex): number { return backend.lift(hex); },
    /** Screen anchor of a tile's (lifted) top face: `tileToScreen` moved up by the lift at this zoom. */
    anchor(hex: Hex, camera: Camera, size: MapShape, viewportWidth: number): Point {
      const p = tileToScreen(hex, camera, size, viewportWidth);
      return { x: p.x, y: p.y - backend.lift(hex) * camera.zoom };
    },
    get mode(): RenderMode { return mode; },
    /** Switches projection (flat / 2.5D / painted): sets the world tilt (camera.ts) and rebuilds the backend; callers refit the camera. */
    setMode(next: RenderMode) {
      if (next === mode) return;
      mode = next;
      applyRenderMode(next);
      backend = make(next);
    },
  };
}
export type MapRenderer = ReturnType<typeof createMapRenderer>;
