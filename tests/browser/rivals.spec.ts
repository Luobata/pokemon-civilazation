import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { rivalWarningFixture } from './fixtures/world-v24.ts';
import type { GameState } from '../../src/core/model.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'v24.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function clickTile(page: Page, index: number) {
  const point = await page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
  await page.mouse.click(point.x, point.y);
}
/** Tile of a rival Pokémon hunting seat 0, as seat 0 sees it (null when none is in sight). */
const rivalTile = (page: Page) => page.evaluate(async () => {
  const mainPath = '/src/browser/main.ts', hexPath = '/src/core/hex.ts';
  const { session } = await import(mainPath), { hexToIndex } = await import(hexPath);
  const view = session.getView(), sighting = view.expansion?.rivals?.sightings.find((item: { targetPlayerId: number }) => item.targetPlayerId === 0);
  const unit = sighting && view.units.find((item: { id: number }) => item.id === sighting.unitId);
  return unit ? hexToIndex(unit.position, view.map) : null;
});

test('v24: the rival warning shows only to its target; after Shift+click end turns the rival arrives and reads as 劲敌', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = rivalWarningFixture(), pending = fixture.state.expansion!.rivals!.byPlayer[0].pending!;
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  await clickTile(page, fixture.id);
  const panel = page.locator('#tile-info');
  await expect(panel.locator('[data-entity="rival"]')).toContainText(`第 ${pending.round} 轮`);
  await page.screenshot({ path: `${reports}/rivals-warning.png` });
  // Other seats' views carry no warning of seat 0's rival.
  const others = await page.evaluate(async () => {
    const statePath = '/src/browser/main.ts', visionPath = '/src/core/vision.ts';
    const { developerAdapter } = await import(statePath), { observe } = await import(visionPath);
    const game = developerAdapter.getState();
    // Each seat's view holds only its own warning: a city it owns, never seat 0's.
    return [1, 2, 3].map(id => { const pending = observe(game, id).expansion?.rivals?.pending; return pending ? game.cities[pending.cityId].ownerId === id : true; });
  });
  expect(others).toEqual([true, true, true]);
  await page.keyboard.press('Escape');
  for (let turn = 0; turn < 6 && (await state(page)).round < pending.round; turn++) await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await state(page)).round).toBeGreaterThanOrEqual(pending.round);
  const game = await state(page);
  expect(Object.values(game.expansion!.rivals!.unitTargets)).toContain(0);
  const tile = await rivalTile(page);
  if (tile !== null) {
    await clickTile(page, tile);
    await expect(panel.locator('[data-entity="unit"]').first()).toContainText('劲敌');
    await page.screenshot({ path: `${reports}/rivals-arrived.png` });
  }
  expect(errors).toEqual([]);
});
