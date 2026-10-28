import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { generateRealGame, realGameSave } from './fixtures/real-game.ts';

const scenarios = [
  { name: 'default-384', seed: 7, width: 24 as const, height: 16 as const },
  { name: 'standard-600', seed: 8, width: 30 as const, height: 20 as const },
];

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

test('measure Canvas2D draw time in two reachable late-game scenes', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const results = [];
  for (const scenario of scenarios) {
    const game = generateRealGame({ ...scenario, personalities: ['expansion', 'expansion', 'expansion', 'expansion'] });
    expect(game.finalState.outcome).not.toBeNull();
    expect(game.invalid).toBe(0);
    expect(game.maxUnits).toBeGreaterThanOrEqual(40);
    await page.goto(`/?seed=${scenario.seed}`);
    await page.locator('#import-save').setInputFiles({ name: `${scenario.name}.json`, mimeType: 'application/json', buffer: Buffer.from(realGameSave(game, true)) });
    await expect(page.locator('#action-notice')).toContainText('读档完成');
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
        p95: sorted[Math.ceil(sorted.length * .95) - 1],
        max: sorted.at(-1),
        dpr: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        userAgent: navigator.userAgent,
      };
    });
    results.push({ scenario: scenario.name, seed: scenario.seed, round: game.maxState.round,
      commandSeq: game.maxState.commandSeq, ...measured });
  }
  const output = {
    measuredAt: new Date().toISOString(),
    environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, chromium: browser.version(),
      node: process.version, playwrightDeviceScaleFactor: 2 },
    method: 'Real planNext/step command replay; peak map-unit state loaded through the normal save importer; god view; 20 warm-up + 240 measured drawMap calls.',
    results,
  };
  await writeFile(process.env.M6_PERF_OUTPUT ?? '/tmp/m6-perf-results.json', JSON.stringify(output, null, 2));
});
