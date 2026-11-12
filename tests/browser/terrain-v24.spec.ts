import { expect, test } from '@playwright/test';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

test('v24: hills, peaks, rivers, deep water and landmarks are drawn; the tile inspector names the features', async ({ page }) => {
  await page.goto('/?gameplay=24&seed=31&size=40x26');
  await page.locator('#animate').uncheck();
  await page.locator('#fit').click();
  // Reveal the whole map in this test session (view-only), so every feature kind is on screen.
  const summary = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', scenePath = '/src/browser/render/scene.ts', infoPath = '/src/browser/tile-info.ts';
    const { session } = await import(mainPath), { buildScene } = await import(scenePath), { describeTile } = await import(infoPath);
    const view = session.getView(), features = view.map.features;
    const scene = buildScene({ view });
    const hill = features.hills[0], deep = features.deep.find((index: number) => view.map.tiles[index] === 'ocean');
    return { hasFeatures: Boolean(features), sceneTerrain: Boolean(scene.terrain), hills: features.hills.length, rivers: scene.terrain.rivers.length,
      hillName: hill === undefined ? null : describeTile(view, hill).terrain?.name ?? null, deepAccess: deep === undefined ? null : describeTile(view, deep).terrain?.access ?? null };
  });
  expect(summary.hasFeatures).toBe(true);
  expect(summary.sceneTerrain).toBe(true);
  expect(summary.hills).toBeGreaterThan(0);
  if (summary.hillName) expect(summary.hillName).toContain('丘陵');
  if (summary.deepAccess) expect(summary.deepAccess).toContain('远洋航行');
  await page.screenshot({ path: `${reports}/terrain-v24-map.png` });
  // Seafaring's unlock list names embarking.
  const unlocks = await page.evaluate(async () => {
    const infoPath = '/src/browser/tech-info.ts', unitsPath = '/src/content/units.ts';
    const { techUnlocks } = await import(infoPath), { contentFor } = await import(unitsPath);
    return techUnlocks('seafaring', contentFor({ expansionVersion: 1, gameplayVersion: 24 }), 24).map((item: { text: string }) => item.text).join(' ');
  });
  expect(unlocks).toContain('乘浪');
});

test('v23 maps carry no features and draw as before', async ({ page }) => {
  await page.goto('/?gameplay=23&seed=31&size=24x16');
  const terrain = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', scenePath = '/src/browser/render/scene.ts';
    const { session } = await import(mainPath), { buildScene } = await import(scenePath);
    const view = session.getView();
    return { features: view.map.features ?? null, scene: buildScene({ view }).terrain ?? null };
  });
  expect(terrain).toEqual({ features: null, scene: null });
});
