// Gameplay v27 opening lane (docs/design/pace-v27.md §2.4, §3.4): real v27 AI games loaded through the menu, real input.
// 1. An exhausted wild Pokémon: the tile card says so, the capture preview says the first ball is certain (100%), the capture succeeds.
// 2. A civilian next to a wild Pokémon: ending the turn (Shift+click) lets the round's wild phase startle it — the rail shows the notice.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { exhaustedFixture, startledFixture } from './fixtures/pace-v27.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameState, MapUnit } from '../../src/core/model.ts';

const shots = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'pace.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function clickHex(page: Page, hex: Hex) {
  const p = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(mainPath), { tileToScreen } = await import(cameraPath);
    return tileToScreen(hex, camera, session.getView().map, document.querySelector<HTMLCanvasElement>('#map')!.clientWidth);
  }, hex);
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
async function endTurn(page: Page) {
  const round = (await state(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => { const game = await state(page); return game.activePlayerId === 0 && game.round > round; }, { timeout: 180_000 }).toBe(true);
  await expect(page.locator('#end-turn')).toBeEnabled({ timeout: 60_000 });
}

test('v27 wild encounters: an exhausted wild Pokémon is caught with the certain first ball', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = exhaustedFixture();
  await importSave(page, fixture.save);
  // Aim the capture at the exhausted target: the preview names the rule and shows 100%.
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await page.locator('#capture-unit').click();
  await clickHex(page, fixture.target);
  await expect(page.locator('#capture-preview')).toContainText('捕捉成功率 100%（力竭：第一颗球必中）');
  await page.screenshot({ path: `${shots}/pace-v27-exhausted-capture.png` });
  // Confirm with a second click: the wild Pokémon joins seat 0.
  await clickHex(page, fixture.target);
  await expect.poll(async () => (await state(page)).units[fixture.targetId]?.ownerId).toBe(0);
  const caught = (await state(page)).units[fixture.targetId] as MapUnit;
  expect(caught.exhaustedUntilRound).toBeUndefined();
  expect((await state(page)).expansion!.wildEncounters!.firstBall[0]).toBe(true);
  await endTurn(page);
  expect(errors).toEqual([]);
});

test('v27 opening safety: ending the turn, the wild phase startles a civilian instead of knocking it out', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = startledFixture();
  await importSave(page, fixture.save);
  await endTurn(page);
  const civilian = (await state(page)).units[fixture.unitId] as MapUnit;
  expect(civilian?.location).toBe('map');
  // The rail notice: the original `startled` icon (named by the button), the civilian's name and what happened.
  const notice = page.locator('#toast-host .toast', { hasText: '吓跑了' });
  await expect(notice).toHaveCount(1);
  await expect(notice.locator('.toast-icon')).toHaveAttribute('aria-label', /被野生的.+吓跑了/);
  await expect(notice.locator('img.toast-pixel')).toBeAttached();
  await page.screenshot({ path: `${shots}/pace-v27-startled.png` });
  expect(errors).toEqual([]);
});
