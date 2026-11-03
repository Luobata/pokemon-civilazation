// Public entry for map rendering: build a scene from game + UI state, then draw it.
import type { Camera } from '../camera.ts';
import { buildScene } from './scene.ts';
import type { MapRenderInput } from './scene.ts';
import { createCanvas2DRenderer } from './canvas2d.ts';
import type { RenderStats, RendererOptions } from './canvas2d.ts';
import type { AnimationFrame } from './animation.ts';

export { buildScene, DEFAULT_MAP_LAYERS } from './scene.ts';
export type { DebugOverlay, MapLayers, MapRenderInput, MapScene } from './scene.ts';
export { FACTIONS, YIELD_MIN_RADIUS } from './canvas2d.ts';
export type { RenderStats, RendererOptions } from './canvas2d.ts';
export { EMPTY_FRAME, Timeline } from './animation.ts';
export type { AnimationFrame, MapEffect, Track, UnitPose } from './animation.ts';

export type MapFrameInput = MapRenderInput & { camera: Camera; animation?: AnimationFrame };

/** One renderer per canvas: it owns that canvas's layer caches. */
export function createMapRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
  const backend = createCanvas2DRenderer(canvas, options);
  return {
    render(input: MapFrameInput): RenderStats { return backend.render(buildScene(input), input.camera, input.animation); },
    invalidate: backend.invalidate,
  };
}
export type MapRenderer = ReturnType<typeof createMapRenderer>;
