import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { reachableFixture, verifyImportedReplay } from './fixtures/reachable.ts';
import { generateRealGame, realGameSave } from './fixtures/real-game.ts';

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
    await page.goto(`/?seed=${scenario.seed}`);
    await page.locator('#import-save').setInputFiles({ name: `${scenario.name}.json`, mimeType: 'application/json', buffer: Buffer.from(saved) });
    await expect(page.locator('#action-notice')).toContainText('读档完成');
    await verifyImportedReplay(page, saved);
    await page.locator('#fit').click();
    await page.locator('#dev-drawer summary').click();
    await page.locator('#god').check();
    await expect(page.locator('#frame-metrics')).toContainText('p95');
    const measured = await page.evaluate(async () => {
      const mainPath = '/src/browser/main.ts', canvasPath = '/src/browser/canvas.ts';
      const { camera, developerAdapter } = await import(mainPath);
      const { drawMap } = await import(canvasPath);
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
      const view = developerAdapter.getDebugView();
      const durations: number[] = [];
      for (let frame = 0; frame < 260; frame++) {
        const started = performance.now();
        drawMap(canvas, view, camera, null, []);
        if (frame >= 20) durations.push(performance.now() - started);
      }
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        mapTiles: view.map.tiles.length,
        visibleUnits: view.units.length,
        samples: durations.length,
        mean: durations.reduce((sum, value) => sum + value, 0) / durations.length,
        p50: sorted[Math.ceil(sorted.length * .50) - 1],
        p95: sorted[Math.ceil(sorted.length * .95) - 1],
        max: sorted.at(-1),
        dpr: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent,
      };
    });
    if (dense) expect(measured.visibleUnits).toBeGreaterThanOrEqual(100);
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
