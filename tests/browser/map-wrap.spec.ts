import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

/** Real mouse drag on the map: moves the camera by (dx, dy) CSS pixels. */
async function drag(page: Page, dx: number, dy: number) {
  const box = (await page.locator('#map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/**
 * After the pan: the canonical copy's last column, the copy of the first column just east of it (same row), and how many
 * canvas pixels on a vertical probe through that copy are painted. A flat map paints nothing there.
 */
async function probeSeam(page: Page) {
  return page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, mapSpan, toScreen } = await import(cameraPath), { offsetToHex } = await import(hexPath);
    const view = session.getView(), { width, height } = view.map;
    const occupied = new Set([...view.units.map((unit: { position: object }) => JSON.stringify(unit.position)), ...view.cities.map((city: { position: object }) => JSON.stringify(city.position))]);
    // A middle row whose first-column tile has nothing of ours on it (a click there opens the tile inspector).
    const rows = Array.from({ length: height - 4 }, (_, i) => i + 2).sort((a, b) => Math.abs(a - height / 2) - Math.abs(b - height / 2));
    const row = rows.find(r => !occupied.has(JSON.stringify(offsetToHex({ col: 0, row: r }))))!;
    const east = toScreen(hexToWorld(offsetToHex({ col: width - 1, row })), camera);
    const west = toScreen(hexToWorld(offsetToHex({ col: 0, row })), camera);
    const copy = { x: west.x + mapSpan(view.map) * camera.zoom, y: west.y };
    // A quarter hex east of that copy's centre: inside the first column on every row, past every tile of a flat map.
    const probeX = copy.x + Math.sqrt(3) * 22 * camera.zoom / 4;
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, context = canvas.getContext('2d')!, dpr = canvas.width / canvas.clientWidth;
    let painted = 0, samples = 0;
    for (let y = 20; y < canvas.clientHeight - 20; y += 10) {
      samples++;
      if (context.getImageData(Math.round(probeX * dpr), Math.round(y * dpr), 1, 1).data[3] > 0) painted++;
    }
    const top = toScreen(hexToWorld(offsetToHex({ col: 0, row: 0 })), camera).y, bottom = toScreen(hexToWorld(offsetToHex({ col: 0, row: height - 1 })), camera).y;
    return { wrap: view.map.wrap === true, span: mapSpan(view.map) * camera.zoom, width, row, index: row * width, east, copy, painted, samples, canvasWidth: canvas.clientWidth, top, bottom };
  });
}

test('v22: panning past the east edge shows the west columns; a click across the seam picks the right tile', async ({ page }) => {
  await page.goto('/?gameplay=22&seed=12345&size=24x16');
  await page.locator('#animate').uncheck();
  await page.locator('#fit').click();
  const start = await probeSeam(page);
  expect(start.wrap).toBe(true);
  // Pan west (drag the map left) until the east edge sits left of the centre: the far side of it is the next copy.
  await drag(page, -(start.east.x - start.canvasWidth * .35), 0);
  const seam = await probeSeam(page);
  expect(seam.east.x).toBeLessThan(seam.canvasWidth * .5);
  expect(seam.copy.x).toBeGreaterThan(seam.east.x);
  expect(seam.copy.x).toBeLessThan(seam.canvasWidth);
  // Every probe point inside the map's rows is painted across the seam (terrain or the unexplored hex fill).
  const inRows = Math.floor((seam.bottom - seam.top) / 10) - 2;
  expect(seam.painted).toBeGreaterThanOrEqual(Math.min(seam.samples, inRows));
  // Clicking the copy east of the seam selects the canonical first-column tile.
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(box.x + seam.copy.x, box.y + seam.copy.y);
  await expect(page.locator('#tile-info')).toBeVisible();
  await expect(page.locator('#tile-info .subpanel-head span')).toHaveText(`地块 ${seam.index}`);
  // Hover across the seam: the tooltip describes the same tile.
  await page.mouse.move(box.x + seam.copy.x + 2, box.y + seam.copy.y + 2);
  await expect(page.locator('#map-tooltip')).toBeVisible();
  // Keep panning west by more than a whole map width: there is no limit, and the seam is still drawn.
  await drag(page, -seam.span * 1.3, 0);
  const far = await probeSeam(page);
  expect(far.east.x).toBeCloseTo(seam.east.x - seam.span * 1.3, 0);
  // Screenshot: the seam copy nearest the middle moved to the centre, terrain revealed by the developer god view (view-only).
  const nearest = far.east.x + Math.round((far.canvasWidth / 2 - far.east.x) / far.span) * far.span;
  await drag(page, far.canvasWidth / 2 - nearest, 0);
  await page.evaluate(() => { const god = document.querySelector<HTMLInputElement>('#god')!; god.checked = true; god.dispatchEvent(new Event('change')); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${reports}/map-wrap.png` });
});

test('v21 keeps the flat map: nothing is drawn past the east edge', async ({ page }) => {
  await page.goto('/?gameplay=21&seed=12345&size=24x16');
  await page.locator('#animate').uncheck();
  await page.locator('#fit').click();
  const start = await probeSeam(page);
  expect(start.wrap).toBe(false);
  await drag(page, -(start.east.x - start.canvasWidth * .35), 0);
  const seam = await probeSeam(page);
  expect(seam.copy.x).toBeLessThan(seam.canvasWidth);
  expect(seam.painted).toBe(0);
});
