// Production-build smoke (playwright.prod.config.ts): overlays render on screen where their CSS puts them. The built bundle orders the
// stylesheets differently from the dev server (styles.css after lineup.css), which once pushed the lineup picker off-screen (9d4ec63).
// Real input only (no dev-server module imports): saves from the Node fixtures are loaded through the menu's file input.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { conferenceFixture } from '../browser/fixtures/depth-v26.ts';
import { guardianFixture } from '../browser/fixtures/battle-evo.ts';
import { openScreen } from '../browser/ui.ts';

const dir = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/fixes-2-cd`;
const VIEWPORT = { width: 1280, height: 900 };
test.use({ viewport: VIEWPORT });

async function importSave(page: Page, save: string, gameplay: number) {
  await page.goto(`/?seed=1&gameplay=${gameplay}`);
  await page.locator('#import-save').setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
}
type Box = { x: number; y: number; width: number; height: number };
async function boxOf(element: Locator): Promise<Box> {
  const box = await element.boundingBox();
  expect(box, 'the element has a layout box').not.toBeNull();
  return box!;
}
function expectInside(box: Box, area: Box, what: string) {
  expect(box.width * box.height, `${what} has a size`).toBeGreaterThan(0);
  expect(box.x, `${what} left edge`).toBeGreaterThanOrEqual(area.x - 0.5);
  expect(box.y, `${what} top edge`).toBeGreaterThanOrEqual(area.y - 0.5);
  expect(box.x + box.width, `${what} right edge`).toBeLessThanOrEqual(area.x + area.width + 0.5);
  expect(box.y + box.height, `${what} bottom edge`).toBeLessThanOrEqual(area.y + area.height + 0.5);
}
const screenArea: Box = { x: 0, y: 0, ...VIEWPORT };
/** A fixed overlay fully inside the viewport; `centred` also checks the translate(-50%, -50%) centring and the CSS width. */
async function expectFixedOverlay(element: Locator, what: string, centred?: { width: number }) {
  await expect(element).toBeVisible();
  expect(await element.evaluate(node => getComputedStyle(node).position), `${what} computed position`).toBe('fixed');
  const box = await boxOf(element);
  expectInside(box, screenArea, what);
  if (!centred) return;
  expect(Math.abs(box.width - centred.width), `${what} width ${box.width}`).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width / 2 - VIEWPORT.width / 2), `${what} horizontal centre`).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - VIEWPORT.height / 2), `${what} vertical centre`).toBeLessThanOrEqual(2);
}

test('conference: the World page next-action cards sit inside the screen; the lineup picker opens centred on screen', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = conferenceFixture();
  await importSave(page, fixture.save, 26);
  await openScreen(page, 'world');
  const screen = page.locator('#screen-world'), host = page.locator('#screen-host');
  const cards = screen.locator('.next-cards');
  await expect(cards).toBeVisible();
  const hostBox = await boxOf(host), screenBox = await boxOf(screen);
  expectInside(screenBox, screenArea, 'the World screen');
  expectInside(screenBox, hostBox, 'the World screen in the screen host');
  const card = cards.locator('.next-card');
  expect(await card.count()).toBeGreaterThan(0);
  for (let index = 0; index < await card.count(); index++) {
    await expect(card.nth(index)).toBeVisible();
    const box = await boxOf(card.nth(index));
    expect(box.x, `next card ${index} left edge`).toBeGreaterThanOrEqual(screenBox.x);
    expect(box.x + box.width, `next card ${index} right edge`).toBeLessThanOrEqual(screenBox.x + screenBox.width);
  }
  // The first row is on screen without scrolling.
  expectInside(await boxOf(card.first()), screenBox, 'the first next card');
  await page.screenshot({ path: `${dir}/prod-world-next-cards.png` });

  const league = page.locator('details[data-system="s27-championship"]');
  await league.locator('summary').first().click();
  await league.locator('[data-lineup="championship:"]').click();
  const picker = page.locator('#lineup-picker');
  await expectFixedOverlay(picker, 'the lineup picker', { width: Math.min(920, VIEWPORT.width * 0.96) });
  await expect(picker.locator('.lp-row')).toHaveCount(6);
  await expect(picker.locator('#lineup-confirm')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${dir}/prod-lineup-picker.png` });
  expect(errors).toEqual([]);
});

test('sanctuary guardian: the challenge card opens centred on screen; its replay viewer opens inside the viewport', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = guardianFixture();
  await importSave(page, fixture.save, 24);
  await openScreen(page, 'world');
  const sanctuaries = page.locator('details[data-system="s24-sanctuaries"]');
  await sanctuaries.locator('summary').click();
  await sanctuaries.getByRole('button', { name: '挑战守卫' }).first().click();
  const card = page.locator('#challenge-card');
  await expectFixedOverlay(card, 'the challenge card', { width: 500 });
  await expect(card.locator('#challenge-card-confirm')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${dir}/prod-challenge-card.png` });

  await card.locator('#challenge-card-confirm').click();
  await expect(card.locator('#challenge-card-outcome')).toBeVisible({ timeout: 60_000 });
  await card.locator('#challenge-card-watch').click();
  const viewer = page.locator('#battle-viewer');
  await expectFixedOverlay(viewer, 'the battle viewer');
  await expect(viewer.locator('#bv-skip')).toBeInViewport({ ratio: 1 });
  await viewer.locator('#bv-skip').click();
  await expect(viewer.locator('#bv-caption')).toContainText(/胜利！|落败/);
  await expectFixedOverlay(viewer, 'the battle viewer at the result');
  await page.screenshot({ path: `${dir}/prod-battle-viewer.png` });
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  expect(errors).toEqual([]);
});
