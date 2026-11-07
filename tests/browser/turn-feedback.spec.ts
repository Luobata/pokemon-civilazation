import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import { hexDistance } from '../../src/core/hex.ts';
import { openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });

test('v16: the starting settler stands beside the capital and a reminder leads to it', async ({ page }) => {
  await page.goto('/?seed=12345');
  const game = await state(page), capital = game.cities[game.players[0].headquartersCityId];
  const settler = Object.values(game.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  expect(hexDistance(capital.position, settler.position!)).toBe(1);
  const reminder = page.locator(`[data-reminder="unit:${settler.id}"]`);
  await expect(reminder).toHaveText('开拓队：去建新城');
  await reminder.click();
  await expect(page.locator('.settler-card')).toBeVisible();
  await expect(page.locator('#action-notice')).toContainText('至少 4 格');
});

test('finished research raises a notification that opens the research screen', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  await openScreen(page, 'research');
  await page.locator('#research-panel [data-tech]').first().click();
  await page.keyboard.press('Escape');
  // The notification rail keeps one round icon per notification; hovering opens its card.
  const toast = page.locator('.toast-research', { hasText: '研究完成' });
  for (let turn = 0; turn < 20 && !(await toast.count()); turn++) {
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#end-turn')).toBeEnabled();
  }
  await expect(toast).toContainText('研究完成');
  await expect(toast).toHaveCSS('opacity', '1');
  await toast.hover();
  await page.screenshot({ path: `${reports}/toast-research-1280.png` });
  await toast.locator('.toast-action').click();
  await expect(page.locator('#screen-research')).toBeVisible();
});
