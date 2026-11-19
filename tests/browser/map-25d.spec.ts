import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { aiGameAt } from './fixtures/ui-25d.ts';
import { closeScreen, openDevDrawer } from './ui.ts';
import { isNight } from '../../src/content/era-abilities.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const shots = `${reports}/ui-25d`;
/** Mid-game round of the reference shots (41 keeps the fixture quick; the design shots use UI25D_ROUND=61) and the next night round. */
const dayRound = Number(process.env.UI25D_ROUND ?? 41), nightRound = [1, 2, 3, 4].map(step => dayRound + step).find(round => isNight(round))!;

/** Loads a save through the normal importer (the replay of a 60-round game takes a while on a busy machine). `open`: navigate first. */
async function importSave(page: Page, save: string, mode: '25d' | 'flat', open = true) {
  if (open) {
    await page.goto(`/?render=${mode}&seed=31&dev=1`);
    await page.locator('#animate').uncheck();
  }
  await page.evaluate(() => { document.querySelector('#action-notice')!.textContent = ''; });
  await page.locator('#import-save').setInputFiles({ name: 'ui-25d.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 240_000 });
}
/** Centres the camera on a tile at a zoom (and repaints through a zero wheel step, which keeps the camera). */
async function look(page: Page, index: number, zoom: number) {
  await page.evaluate(async ({ index, zoom }) => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { camera, session } = await import(mainPath), { hexToWorld } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, world = hexToWorld(indexToHex(index, session.getView().map));
    camera.zoom = zoom; camera.x = canvas.clientWidth / 2 - world.x * zoom; camera.y = canvas.clientHeight / 2 - world.y * zoom;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 10, clientY: 10, cancelable: true }));
  }, { index, zoom });
  await page.waitForTimeout(150);
}
/** Lifted top-face centre of tiles in CSS px of the map canvas (the copy nearest the viewport centre), for the active projection. */
async function tileCentres(page: Page, indexes: number[]) {
  return page.evaluate(async indexes => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts', scenePath = '/src/browser/render/scene.ts', projectionPath = '/src/browser/render/projection.ts';
    const { camera, session, developerAdapter } = await import(mainPath), { tileToScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const { buildScene } = await import(scenePath), { sceneLifts } = await import(projectionPath);
    const view = session.getView(), scene = buildScene({ view }), tilted = developerAdapter.renderMode() === '25d';
    const lifts = sceneLifts(scene.tiles, scene.terrain), canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    return indexes.map(index => {
      const p = tileToScreen(indexToHex(index, view.map), camera, view.map, canvas.clientWidth);
      return { index, x: p.x, y: p.y - (tilted ? lifts[index] * camera.zoom : 0), lift: lifts[index] };
    });
  }, indexes);
}

test('2.5D map: flag switches the projection, picking follows lifted tiles and cliffs, the menu setting persists', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { save } = aiGameAt(5, 40);
  await importSave(page, save, '25d');
  expect(await page.evaluate(async () => { const { developerAdapter } = await import('/src/browser/main.ts' as string); return developerAdapter.renderMode(); })).toBe('25d');
  // Every explored tile near the own capital picks itself at its lifted centre, whatever its height.
  const probe = await page.evaluate(async () => {
    const { session } = await import('/src/browser/main.ts' as string);
    const view = session.getView(), capital = view.cities.find((city: { ownerId: number }) => city.ownerId === view.playerId);
    return { capital: capital ? capital.position : null, known: view.map.tiles.flatMap((biome: string | null, index: number) => biome ? [index] : []) };
  });
  expect(probe.capital).not.toBeNull();
  const capitalIndex = await page.evaluate(async hex => { const { session } = await import('/src/browser/main.ts' as string), { hexToIndex } = await import('/src/core/hex.ts' as string); return hexToIndex(hex, session.getView().map); }, probe.capital);
  await look(page, capitalIndex, 1.6);
  const box = (await page.locator('#map').boundingBox())!;
  const centres = (await tileCentres(page, probe.known)).filter(p => p.x > 40 && p.x < box.width - 40 && p.y > 60 && p.y < box.height - 60);
  expect(centres.length).toBeGreaterThan(20);
  expect(new Set(centres.map(p => p.lift)).size).toBeGreaterThan(1);
  const picked = await page.evaluate(async points => {
    const { developerAdapter } = await import('/src/browser/main.ts' as string);
    return points.map(p => developerAdapter.pickTile(p.x, p.y));
  }, centres);
  // Each centre picks its own tile, unless a taller column in a nearer row really covers it (2.5D occlusion, docs/design/ui-25d.md §2).
  const width = await page.evaluate(async () => { const { session } = await import('/src/browser/main.ts' as string); return session.getView().map.width; });
  const coverers = await tileCentres(page, picked);
  const occluded = centres.filter((p, k) => picked[k] !== p.index);
  for (const [k, p] of centres.entries()) if (picked[k] !== p.index) {
    expect(Math.floor(picked[k] / width)).toBeGreaterThan(Math.floor(p.index / width));
    expect(coverers[k].lift).toBeGreaterThan(p.lift + 8);
  }
  expect(occluded.length).toBeLessThan(centres.length * .1);
  // The real pointer path: hovering the capital's lifted centre names that tile in the map tooltip.
  const capitalCentre = (await tileCentres(page, [capitalIndex]))[0];
  const summary = await page.evaluate(async index => {
    const { session } = await import('/src/browser/main.ts' as string), { describeTile, tileSummary } = await import('/src/browser/tile-info.ts' as string);
    return tileSummary(describeTile(session.getView(), index));
  }, capitalIndex);
  await page.mouse.move(box.x + capitalCentre.x, box.y + capitalCentre.y);
  await page.mouse.move(box.x + capitalCentre.x + 1, box.y + capitalCentre.y);
  await expect(page.locator('#map-tooltip')).toContainText(summary.slice(0, 12));
  // The menu setting switches back to the flat map and is remembered.
  await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('#render-settings input[value="flat"]')!; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(async () => { const { developerAdapter } = await import('/src/browser/main.ts' as string); return developerAdapter.renderMode(); })).toBe('flat');
  expect(await page.evaluate(() => localStorage.getItem('pokeciv.renderMode'))).toBe('flat');
  const flat = await tileCentres(page, [capitalIndex]);
  expect(await page.evaluate(async p => { const { developerAdapter } = await import('/src/browser/main.ts' as string); return developerAdapter.pickTile(p.x, p.y); }, flat[0])).toBe(capitalIndex);
  expect(errors).toEqual([]);
});

test('2.5D map: wrap seam draws both copies and picks across it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?render=25d&gameplay=26&seed=31&size=24x16&dev=1');
  await page.locator('#animate').uncheck();
  const wrap = await page.evaluate(async () => { const { session } = await import('/src/browser/main.ts' as string); return Boolean(session.getView().map.wrap); });
  test.skip(!wrap, 'this map does not wrap');
  // Put the seam (column 0 / last column) in the middle of the view.
  await page.evaluate(async () => {
    const { camera, session } = await import('/src/browser/main.ts' as string), { mapSpan } = await import('/src/browser/camera.ts' as string);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, map = session.getView().map;
    camera.zoom = 1.2; camera.x = canvas.clientWidth / 2 - mapSpan(map) * camera.zoom + 20; camera.y = canvas.clientHeight / 2 - 8 * 22 * .75 * 1.5 * camera.zoom;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, cancelable: true }));
  });
  await page.waitForTimeout(150);
  const width = await page.evaluate(async () => { const { session } = await import('/src/browser/main.ts' as string); return session.getView().map.width; });
  const rows = [6, 7, 8, 9, 10].flatMap(row => [row * width, row * width + width - 1]);
  const centres = await tileCentres(page, rows);
  const picked = await page.evaluate(async points => { const { developerAdapter } = await import('/src/browser/main.ts' as string); return points.map(p => developerAdapter.pickTile(p.x, p.y)); }, centres);
  expect(picked).toEqual(centres.map(p => p.index));
  await page.screenshot({ path: `${shots}/wrap-seam.png` });
  expect(errors).toEqual([]);
});

for (const mode of ['25d', 'flat'] as const) test(`2.5D map: reference screenshots (opening, city cluster, coast and mountains, night, fog), ${mode}`, async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  {
    // Opening: a fresh v26 game on the standard map.
    await page.goto(`/?render=${mode}&gameplay=26&seed=31&size=30x20`);
    await page.locator('#animate').uncheck();
    const start = await page.evaluate(async () => {
      const { session } = await import('/src/browser/main.ts' as string), { hexToIndex } = await import('/src/core/hex.ts' as string);
      const view = session.getView();
      return hexToIndex(view.cities[0]?.position ?? view.units.find((unit: { ownerId: number }) => unit.ownerId === view.playerId).position, view.map);
    });
    await look(page, start, 2.2);
    await page.screenshot({ path: `${shots}/${mode}-01-opening.png` });

    // Mid-game: the own capital and its neighbours, with a unit selected (move range and selection ring).
    // Night first, then the day save in the same page (two imports per projection instead of three).
    for (const [label, round] of [['04-night', nightRound], ['02-city-cluster', dayRound]] as const) {
      const { save } = aiGameAt(5, round);
      await importSave(page, save, mode, label === '04-night');
      const capital = await page.evaluate(async () => {
        const { session } = await import('/src/browser/main.ts' as string), { hexToIndex } = await import('/src/core/hex.ts' as string);
        const view = session.getView(), city = view.cities.find((item: { ownerId: number; id: number }) => item.ownerId === view.playerId && item.id === view.economy.player.headquartersCityId)
          ?? view.cities.find((item: { ownerId: number }) => item.ownerId === view.playerId);
        return hexToIndex(city.position, view.map);
      });
      await look(page, capital, 1.5);
      if (label === '02-city-cluster') {
        // Select a ready Pokémon from the unit picker (selection ring, move range and attack reach on the lifted tiles).
        const select = page.locator('#selection-panel select').nth(1), labels = await select.locator('option').allInnerTexts();
        const pick = labels.findIndex((label, k) => k > 0 && !/开拓|工匠|商队/.test(label));
        if (pick > 0) await select.selectOption({ index: pick });
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `${shots}/${mode}-${label}.png` });
      await look(page, capital, 3);
      await page.screenshot({ path: `${shots}/${mode}-${label}-closeup.png`, clip: { x: 0, y: 60, width: 880, height: 840 } });
      await look(page, capital, 1.5);
      if (label === '02-city-cluster') {
        // Fog: the same game, own view, wider.
        await look(page, capital, .9);
        await page.screenshot({ path: `${shots}/${mode}-05-fog.png` });
      }
    }

    // Coast and mountains: god view on the tile with the most peaks, mountains and water around it.
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
    // Terrain-only view: tile yields off (the 地块产出 toggle), so the relief reads.
    await page.locator('#show-yields').uncheck();
    await look(page, rugged, 1.8);
    await page.screenshot({ path: `${shots}/${mode}-03-coast-mountains.png` });
    // Close-up of the same spot (pixel art at ~3× zoom).
    await look(page, rugged, 3.2);
    await page.screenshot({ path: `${shots}/${mode}-06-closeup.png`, clip: { x: 0, y: 60, width: 880, height: 840 } });
  }
  expect(errors).toEqual([]);
});
