import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });

/** The element is fully inside the drawer's visible box and the viewport, with the drawer not scrolled. */
async function expectInFirstScreen(page: Page, element: Locator): Promise<void> {
  const drawer = await page.locator('#context-drawer').boundingBox(), box = await element.boundingBox(), viewport = page.viewportSize()!;
  expect(drawer).not.toBeNull(); expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(drawer!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(Math.min(drawer!.y + drawer!.height, viewport.height));
}

test('P0-1/P0-2: the capital shows its queue and a clickable production list in the drawer\'s first screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  const initial = await state(page), cityId = initial.players[0].headquartersCityId;
  await page.locator('#city-select').selectOption(String(cityId));
  await expect(page.locator('#city-summary')).toContainText(`城市 ${cityId}`);
  await expect(page.locator('#city-growth-turns')).toBeVisible();
  // Secondary panels moved to 详情; the city network is there but not on the first screen.
  await expect(page.locator('[data-city-section="details"]')).toBeVisible();
  await expect(page.locator('#city-network')).toBeHidden();

  const list = page.locator('#production-list');
  const firstRow = list.locator('[data-production-option]').first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator('img.production-icon')).toHaveAttribute('src', /^\/buildings\//);
  await expect(firstRow).toContainText(/≈\d+ 轮/);
  expect(await page.locator('#context-drawer').evaluate(element => element.scrollTop)).toBe(0);
  await expectInFirstScreen(page, page.locator('.production-current'));
  await expectInFirstScreen(page, page.locator('.production-tabs'));
  await expectInFirstScreen(page, firstRow);

  // Clicking rows queues them (the same SetProductionQueue command as before); each queued item shows its rounds.
  const optionId = await firstRow.getAttribute('data-production-option');
  await firstRow.click();
  await expect.poll(async () => (await state(page)).cities[cityId].queue.map(order => `${order.item.kind}:${order.item.kind === 'district' ? '' : order.item.defId}`)).toEqual([optionId]);
  await page.locator('[data-production-kind="logistics"]').click();
  await page.locator('[data-production-option="logistics:settler"]').click();
  await page.locator('[data-production-kind="pokemon"]').click();
  await page.locator('#production-list [data-production-option^="pokemon:"]').first().click();
  await expect(page.locator('#production-queue li')).toHaveCount(3);
  const etas = await page.locator('#production-queue .queue-eta').allTextContents();
  const rounds = etas.map(text => Number(/≈(\d+) 轮/.exec(text)?.[1]));
  expect(rounds.every(Number.isFinite)).toBe(true);
  expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  expect(rounds[2]).toBeGreaterThan(rounds[0]);
  await expect(page.locator('#production-queue li').first()).toHaveClass(/is-current/);

  // With three items queued, the list still starts on the first screen.
  await page.locator('[data-production-kind="building"]').click();
  await expectInFirstScreen(page, page.locator('.production-current'));
  await expectInFirstScreen(page, page.locator('#production-list [data-production-option]').first());
  await page.screenshot({ path: `${reports}/city-panel.png` });

  // Reorder and cancel still work from the queue rows.
  await page.locator('[data-down="0"]').click();
  await expect.poll(async () => (await state(page)).cities[cityId].queue[1].item).toEqual({ kind: 'building', defId: optionId!.split(':')[1] });
  await page.locator('[data-remove="2"]').click();
  await expect(page.locator('#production-queue li')).toHaveCount(2);

  // 详情 holds the buildings, city network and growth details.
  await page.locator('[data-city-section="details"]').click();
  await expect(page.locator('#city-network')).toBeVisible();
  await expect(page.locator('#city-growth')).toBeVisible();
  await expect(page.locator('[data-building="headquarters"]')).toBeVisible();
  await expect(page.locator('#production-list')).toBeHidden();
  expect(errors).toEqual([]);
});

test('P0-2: a full queue disables the rows', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  await page.locator('[data-production-kind="pokemon"]').click();
  const row = page.locator('#production-list [data-production-option^="pokemon:"]').first();
  for (let i = 0; i < 5; i++) await row.click();
  await expect(page.locator('#production-queue li')).toHaveCount(5);
  await expect(row).toBeDisabled();
  await expect(page.locator('.production-section')).toContainText('队列已满');
});
