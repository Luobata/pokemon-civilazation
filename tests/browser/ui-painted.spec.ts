import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { aiGameAt } from './fixtures/ui-25d.ts';
import { closeScreen, openDevDrawer } from './ui.ts';
import { isNight } from '../../src/content/era-abilities.ts';

// ui-painted (docs/design/ui-painted.md): the 绘卷 theme — switch, picking on the tilted plane, and the design screenshots.
const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const shots = `${reports}/ui-painted`;
const dayRound = Number(process.env.UI25D_ROUND ?? 61), nightRound = [1, 2, 3, 4].map(step => dayRound + step).find(round => isNight(round))!;

async function importSave(page: Page, save: string, query: string, open = true) {
  if (open) {
    await page.goto(`/?${query}&seed=31&dev=1`);
    await page.locator('#animate').uncheck();
  }
  await page.evaluate(() => { document.querySelector('#action-notice')!.textContent = ''; });
  await page.locator('#import-save').setInputFiles({ name: 'ui-painted.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 240_000 });
}
async function look(page: Page, index: number, zoom: number) {
  await page.evaluate(async ({ index, zoom }) => {
    const { camera, session } = await import('/src/browser/main.ts' as string), { hexToWorld } = await import('/src/browser/camera.ts' as string), { indexToHex } = await import('/src/core/hex.ts' as string);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, world = hexToWorld(indexToHex(index, session.getView().map));
    camera.zoom = zoom; camera.x = canvas.clientWidth / 2 - world.x * zoom; camera.y = canvas.clientHeight / 2 - world.y * zoom;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 10, clientY: 10, cancelable: true }));
  }, { index, zoom });
  // Two frames: the first builds the terrain chunks while the camera is new, the second is the settled frame.
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector<HTMLCanvasElement>('#map')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 10, clientY: 10, cancelable: true })));
  await page.waitForTimeout(250);
}
const ownCapital = (page: Page) => page.evaluate(async () => {
  const { session } = await import('/src/browser/main.ts' as string), { hexToIndex } = await import('/src/core/hex.ts' as string);
  const view = session.getView(), city = view.cities.find((item: { ownerId: number; id: number }) => item.ownerId === view.playerId && item.id === view.economy.player.headquartersCityId)
    ?? view.cities.find((item: { ownerId: number }) => item.ownerId === view.playerId);
  return hexToIndex(city.position, view.map) as number;
});

test('painted theme: ?theme switches map and HUD, picking follows the tilted plane, the 画风 setting persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?theme=painted&gameplay=26&seed=31&size=24x16&dev=1');
  await page.locator('#animate').uncheck();
  expect(await page.evaluate(() => document.documentElement.classList.contains('theme-painted'))).toBe(true);
  const state = await page.evaluate(async () => {
    const { developerAdapter, session, camera } = await import('/src/browser/main.ts' as string), { mapTilt, tileToScreen } = await import('/src/browser/camera.ts' as string);
    const { indexToHex } = await import('/src/core/hex.ts' as string);
    const view = session.getView(), canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const known = view.map.tiles.flatMap((biome: string | null, index: number) => biome ? [index] : []);
    const probes = known.map((index: number) => ({ index, p: tileToScreen(indexToHex(index, view.map), camera, view.map, canvas.clientWidth) }))
      .filter((item: { p: { x: number; y: number } }) => item.p.x > 20 && item.p.y > 20 && item.p.x < canvas.clientWidth - 20 && item.p.y < canvas.clientHeight - 20);
    return { mode: developerAdapter.renderMode(), tilt: mapTilt(), count: probes.length,
      wrong: probes.filter((item: { index: number; p: { x: number; y: number } }) => developerAdapter.pickTile(item.p.x, item.p.y) !== item.index).length,
      stats: developerAdapter.getPresentation().render };
  });
  expect(state.mode).toBe('painted');
  expect(state.tilt).toBe(.8);
  expect(state.count).toBeGreaterThan(10);
  expect(state.wrong).toBe(0);
  // 菜单 → 画风: back to the pixel map (the 地图视角 choice is enabled again), remembered, and forward again.
  const choose = (value: string) => page.evaluate(value => { const input = document.querySelector<HTMLInputElement>(`#theme-settings input[value="${value}"]`)!; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await choose('pixel');
  expect(await page.evaluate(async () => (await import('/src/browser/main.ts' as string)).developerAdapter.renderMode())).toBe('flat');
  expect(await page.evaluate(() => [document.documentElement.classList.contains('theme-painted'), localStorage.getItem('pokeciv.theme'), document.querySelector<HTMLFieldSetElement>('#render-settings')!.disabled])).toEqual([false, 'pixel', false]);
  await choose('painted');
  await page.goto('/?gameplay=26&seed=31&size=24x16&dev=1');
  expect(await page.evaluate(async () => (await import('/src/browser/main.ts' as string)).developerAdapter.renderMode())).toBe('painted');
  expect(await page.evaluate(() => document.querySelector<HTMLFieldSetElement>('#render-settings')!.disabled)).toBe(true);
  // ?theme=pixel overrides the saved choice for this load.
  await page.goto('/?theme=pixel&gameplay=26&seed=31&size=24x16&dev=1');
  expect(await page.evaluate(async () => (await import('/src/browser/main.ts' as string)).developerAdapter.renderMode())).toBe('flat');
  expect(errors).toEqual([]);
});

test('painted theme: the panned terrain composite matches a fresh render at the same camera', async ({ page }) => {
  await page.goto('/?theme=painted&gameplay=26&seed=31&size=24x16&dev=1');
  await page.locator('#animate').uncheck();
  const result = await page.evaluate(async () => {
    const { session } = await import('/src/browser/main.ts' as string), { createMapRenderer } = await import('/src/browser/render/index.ts' as string);
    const view = session.getView(), make = () => { const canvas = document.createElement('canvas'); canvas.style.width = '640px'; canvas.style.height = '480px'; document.body.append(canvas); return canvas; };
    const a = make(), b = make(), panned = createMapRenderer(a, { mode: 'painted' }), fresh = createMapRenderer(b, { mode: 'painted' });
    const start = { x: 40, y: 30, zoom: 1.5 }, end = { x: start.x - 53, y: start.y + 29, zoom: 1.5 };
    panned.render({ view, camera: start }); panned.render({ view, camera: start });
    for (let k = 1; k <= 9; k++) panned.render({ view, camera: { zoom: 1.5, x: start.x + (end.x - start.x) * k / 9, y: start.y + (end.y - start.y) * k / 9 } });
    panned.render({ view, camera: end });
    fresh.render({ view, camera: end }); fresh.render({ view, camera: end });
    const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const settled = pixels(a), reference = pixels(b);
    let off = 0;
    for (let i = 0; i < reference.length; i++) if (Math.abs(settled[i] - reference[i]) > 3) off++;
    a.remove(); b.remove();
    return { off, size: reference.length };
  });
  expect(result.off).toBeLessThan(result.size * .001);
});

for (const variant of ['painted', 'flat'] as const) test(`painted theme: design screenshots (${variant})`, async ({ page }) => {
  test.skip(!process.env.PAINTED_SHOTS, 'design screenshots: set PAINTED_SHOTS=1');
  test.setTimeout(1_500_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const query = variant === 'painted' ? 'theme=painted' : 'theme=pixel&render=flat';
  const shot = (name: string) => page.screenshot({ path: `${shots}/${variant}-${name}.png` });
  // Opening: a fresh v26 game on the standard map.
  await page.goto(`/?${query}&gameplay=26&seed=31&size=30x20`);
  await page.locator('#animate').uncheck();
  const start = await page.evaluate(async () => {
    const { session } = await import('/src/browser/main.ts' as string), { hexToIndex } = await import('/src/core/hex.ts' as string);
    const view = session.getView();
    return hexToIndex(view.cities[0]?.position ?? view.units.find((unit: { ownerId: number }) => unit.ownerId === view.playerId).position, view.map);
  });
  await look(page, start, 2.2);
  await shot('01-opening');
  // Night first, then the day save in the same page.
  for (const [label, round] of [['05-night', nightRound], ['02-city-cluster', dayRound]] as const) {
    const { save } = aiGameAt(5, round);
    await importSave(page, save, query, label === '05-night');
    const capital = await ownCapital(page);
    await look(page, capital, 1.5);
    if (label === '05-night') { await shot(label); continue; }
    const select = page.locator('#selection-panel select').nth(1), labels = await select.locator('option').allInnerTexts();
    const pick = labels.findIndex((text, k) => k > 0 && !/开拓|工匠|商队/.test(text));
    if (pick > 0) await select.selectOption({ index: pick });
    await page.waitForTimeout(300);
    await shot(label);
    await shot('06-unit-panel');
    // City panel: the capital selected.
    await page.keyboard.press('Escape');
    const cities = page.locator('#selection-panel select').nth(0), cityLabels = await cities.locator('option').allInnerTexts();
    if (cityLabels.length > 1) await cities.selectOption({ index: 1 });
    await page.waitForTimeout(300);
    await look(page, capital, 1.5);
    await shot('07-city-panel');
    await page.keyboard.press('Escape');
    // Fog: own view, wider.
    await look(page, capital, .9);
    await shot('04-fog');
    // Research tree.
    await page.locator('[data-open-screen="research"]').click();
    await page.waitForTimeout(400);
    await shot('08-research');
    await closeScreen(page);
  }
  // Coast and mountains: god view on the most rugged coastal spot, yields off.
  await openDevDrawer(page);
  await page.locator('#god').check();
  await closeScreen(page);
  const rugged = await page.evaluate(async () => {
    const { developerAdapter } = await import('/src/browser/main.ts' as string), { indexToHex, hexDistance } = await import('/src/core/hex.ts' as string);
    const map = developerAdapter.getDebugView().map, peaks = new Set(map.features?.peaks ?? []), hills = new Set(map.features?.hills ?? []);
    let best = 0, bestScore = -1;
    for (let index = 0; index < map.tiles.length; index++) {
      const row = Math.floor(index / map.width);
      if (row < 3 || row > map.height - 4) continue;
      let score = 0, water = 0;
      for (let other = 0; other < map.tiles.length; other++) {
        if (hexDistance(indexToHex(index, map), indexToHex(other, map), map) > 2) continue;
        score += peaks.has(other) ? 3 : map.tiles[other] === 'mountain' || map.tiles[other] === 'volcano' ? 2 : hills.has(other) ? 1 : 0;
        if (map.tiles[other] === 'ocean') water++;
      }
      const total = score + Math.min(water, 6) * 1.5;
      if (water >= 3 && total > bestScore) { bestScore = total; best = index; }
    }
    return best;
  });
  await page.locator('#show-yields').uncheck();
  await look(page, rugged, 1.8);
  await shot('03-coast-mountains');
  await look(page, rugged, 3.2);
  await shot('09-closeup');
  expect(errors).toEqual([]);
});

test.describe('painted theme: dense-scene frame time', () => {
  test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  test('flat vs painted, alternating rounds (PAINTED_PERF=1)', async ({ page }) => {
    test.skip(!process.env.PAINTED_PERF, 'perf measurement: set PAINTED_PERF=1');
    test.setTimeout(900_000);
    const { reachableFixture } = await import('./fixtures/reachable.ts');
    const dense = reachableFixture('dense');
    await page.goto('/?dev=1&seed=8&theme=pixel&render=flat');
    await page.locator('#import-save').setInputFiles({ name: 'dense.json', mimeType: 'application/json', buffer: Buffer.from(dense.save) });
    await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 240_000 });
    const rounds = Number(process.env.PAINTED_PERF_ROUNDS ?? 3);
    const results = await page.evaluate(async rounds => {
      const { developerAdapter } = await import('/src/browser/main.ts' as string), { createMapRenderer, applyRenderMode } = await import('/src/browser/render/index.ts' as string);
      const { fitCamera, hexToWorld } = await import('/src/browser/camera.ts' as string), { indexToHex } = await import('/src/core/hex.ts' as string);
      const canvas = document.querySelector<HTMLCanvasElement>('#map')!, view = developerAdapter.getDebugView();
      const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
      const measure = (mode: 'flat' | 'painted', cacheLayers: boolean, pan: boolean, fitted: boolean) => {
        applyRenderMode(mode);
        const middle = hexToWorld(indexToHex(Math.floor(view.map.tiles.length / 2) + Math.floor(view.map.width / 2), view.map));
        const from = fitted ? fitCamera(view.map, canvas.clientWidth, canvas.clientHeight) : { zoom: 1.5, x: canvas.clientWidth / 2 - middle.x * 1.5, y: canvas.clientHeight / 2 - middle.y * 1.5 };
        const renderer = createMapRenderer(canvas, { cacheLayers, mode }), durations: number[] = [];
        for (let frame = 0; frame < 260; frame++) {
          const started = performance.now();
          renderer.render({ view, camera: pan ? { ...from, x: from.x + frame } : from });
          if (frame >= 20) durations.push(performance.now() - started);
        }
        applyRenderMode('flat');
        return p95(durations);
      };
      const scenes = [['fitted still', true, false, true], ['fitted pan', true, true, true], ['zoom 1.5 still', true, false, false], ['zoom 1.5 pan', true, true, false], ['fitted direct', false, false, true]] as const;
      const out: Record<string, { flat: number[]; painted: number[] }> = {};
      for (let round = 0; round < rounds; round++) for (const [name, cache, pan, fitted] of scenes) for (const mode of ['flat', 'painted'] as const) {
        (out[name] ??= { flat: [], painted: [] })[mode].push(Math.round(measure(mode, cache, pan, fitted) * 100) / 100);
      }
      return { out, units: view.units.length, tiles: view.map.tiles.length };
    }, rounds);
    console.log('PAINTED_PERF', JSON.stringify(results));
  });
});
