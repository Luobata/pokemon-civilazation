import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { reachableFixture, verifyImportedReplay } from './fixtures/reachable.ts';
import { generateRealGame, realGameSave } from './fixtures/real-game.ts';
import { openDevDrawer } from './ui.ts';

const scenarios = [
  { name: 'default-384', seed: 7, width: 24 as const, height: 16 as const },
  { name: 'standard-600', seed: 8, width: 30 as const, height: 20 as const },
  { name: 'large-1040', seed: 9, width: 40 as const, height: 26 as const },
  { name: 'dense-105-units', seed: 8, width: 40 as const, height: 26 as const },
];

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

test('measure Canvas2D draw time in four reachable late-game scenes including 100 visible units', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  for (const scenario of scenarios) {
    const dense = scenario.name === 'dense-105-units' ? reachableFixture('dense') : null;
    const game = dense ? null : generateRealGame({ ...scenario, expansionVersion: 1, leaderIds: ['oak', 'lance', 'jenny', 'joy'], personalities: ['expansion', 'expansion', 'expansion', 'expansion'] });
    if (game) {
      expect(game.finalState.outcome).not.toBeNull();
      expect(game.invalid).toBe(0);
      expect(game.maxUnits).toBeGreaterThanOrEqual(40);
    }
    const saved = dense ? dense.save : realGameSave(game!, true);
    const peakState = dense ? dense.state : game!.maxState;
    await page.goto(`/?dev=1&seed=${scenario.seed}`);
    await page.locator('#import-save').setInputFiles({ name: `${scenario.name}.json`, mimeType: 'application/json', buffer: Buffer.from(saved) });
    await expect(page.locator('#action-notice')).toContainText('读档完成');
    await verifyImportedReplay(page, saved);
    await page.locator('#fit').click();
    await openDevDrawer(page);
    await page.locator('#god').check();
    await expect(page.locator('#frame-metrics')).toContainText('p95');
    const measured = await page.evaluate(async combat => {
      const mainPath = '/src/browser/main.ts', renderPath = '/src/browser/render/index.ts', benchmarkPath = '/src/browser/render/benchmark.ts';
      const { camera, developerAdapter } = await import(mainPath);
      const { createMapRenderer } = await import(renderPath);
      const { combatBenchmarkFrames, eventBenchmarkFrames } = await import(benchmarkPath);
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const view = developerAdapter.getDebugView();
      const stats = (durations: number[]) => {
        const sorted = [...durations].sort((a, b) => a - b);
        return { samples: durations.length, mean: durations.reduce((sum, value) => sum + value, 0) / durations.length,
          p50: sorted[Math.ceil(sorted.length * .50) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)! };
      };
      type Frames = ReturnType<typeof combatBenchmarkFrames>;
      /** 20 warm-up + 240 measured frames; `pan` moves the camera one pixel per frame (cache miss every frame); `frames`: combat effects per frame. */
      const measure = (cacheLayers: boolean, pan: boolean, input = view, frames?: Frames) => {
        const renderer = createMapRenderer(canvas, { cacheLayers }), durations: number[] = [];
        for (let frame = 0; frame < 260; frame++) {
          const started = performance.now();
          renderer.render({ view: input, camera: pan ? { ...camera, x: camera.x + frame } : camera, animation: frames?.[frame % frames.length] });
          if (frame >= 20) durations.push(performance.now() - started);
        }
        return stats(durations);
      };
      const uncached = measure(false, false), cachedStill = measure(true, false), cachedPan = measure(true, true);
      // Combat effects (handoff-combat-presentation §4): four simultaneous battles between visible units, sampled across
      // their whole length, on the scene as loaded and with the map drawn east-west wrapped (render input only; the game is untouched).
      let combatEffects;
      if (combat) {
        const frames = combatBenchmarkFrames(view.units, view.map, 4, 260);
        const wrapped = { ...view, map: { ...view.map, wrap: true as const } };
        combatEffects = { effectsPerFrame: Math.max(...frames.map((frame: { effects: unknown[] }) => frame.effects.length)),
          direct: measure(false, false, view, frames), cachedStill: measure(true, false, view, frames),
          wrappedDirect: measure(false, false, wrapped, frames), wrappedCachedStill: measure(true, false, wrapped, frames) };
      }
      // Batch 3 (V8–V11): big-event pulses, era forms, a wonder pillar and a night cross-fade, on the wrapped map.
      let eventEffects;
      if (combat) {
        const frames = eventBenchmarkFrames(view.units, 260);
        const wrapped = { ...view, map: { ...view.map, wrap: true as const } };
        eventEffects = { effectsPerFrame: Math.max(...frames.map((frame: { effects: unknown[] }) => frame.effects.length)),
          wrappedDirect: measure(false, false, wrapped, frames), wrappedCachedStill: measure(true, false, wrapped, frames) };
      }
      return {
        mapTiles: view.map.tiles.length,
        visibleUnits: view.units.length,
        // Top-level figures stay comparable with earlier reports: every layer drawn directly.
        ...uncached,
        cachedStill, cachedPan, ...(combatEffects ? { combatEffects } : {}), ...(eventEffects ? { eventEffects } : {}),
        dpr: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent,
      };
    }, Boolean(dense));
    if (dense) expect(measured.visibleUnits).toBeGreaterThanOrEqual(100);
    if (dense) expect(measured.combatEffects!.effectsPerFrame).toBeGreaterThan(4);
    if (dense) expect(measured.eventEffects!.effectsPerFrame).toBeGreaterThanOrEqual(6);
    results.push({ scenario: scenario.name, seed: scenario.seed, round: peakState.round,
      commandSeq: peakState.commandSeq, expansionVersion: peakState.setup.expansionVersion,
      contentVersion: peakState.contentVersion, ...measured });
    expect(errors).toEqual([]);
  }
  const output = {
    measuredAt: new Date().toISOString(),
    environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, chromium: browser.version(),
      node: process.version, playwrightDeviceScaleFactor: 2 },
    method: 'Accepted commands replayed identically in Node and Chromium; peak map-unit state loaded through the normal save importer; god view with the full map fitted into the viewport; synchronous Canvas2D CPU draw duration, excluding GPU presentation and frame scheduling; 20 warm-up + 240 measured drawMap calls.',
    results,
  };
  await writeFile(process.env.M6_PERF_OUTPUT ?? '/tmp/m6-perf-results.json', JSON.stringify(output, null, 2));
});
