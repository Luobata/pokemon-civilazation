import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeScreen, openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const endTurn = (page: Page) => page.locator('#end-turn');

test('P0-5: the end-turn button leads through pending items and only then reads 下一回合', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  // A new game: research comes first; the click opens the research screen instead of ending the turn.
  await expect(endTurn(page)).toHaveText('选择研究 ›');
  await expect(endTurn(page)).toHaveAttribute('data-state', 'research');
  await expect(page.locator('#turn-hint')).toBeVisible();
  // Reminder chips stay readable (≥ 12px).
  expect(await page.evaluate(() => Math.min(...[...document.querySelectorAll('#turn-reminders button')].map(button => parseFloat(getComputedStyle(button).fontSize))))).toBeGreaterThanOrEqual(12);
  await endTurn(page).click();
  await expect(page.locator('#screen-research')).toBeVisible();
  await page.locator('#research-panel [data-tech]').first().click();
  await closeScreen(page);

  await expect(endTurn(page)).toHaveText('选择规章 ›');
  await endTurn(page).click();
  await expect(page.locator('#screen-policy')).toBeVisible();
  await page.locator('[data-charter="gymCode"]').click();
  await closeScreen(page);

  await expect(endTurn(page)).toHaveText(/^城市 \d+ 需要生产 ›$/);
  await endTurn(page).click();
  await page.locator('[data-production-option]:not([disabled])').first().click();

  // Units: each click selects the next unit still waiting for orders; reviewed units stop counting.
  await expect(endTurn(page)).toHaveText(/^单位需要命令（\d+）›$/);
  const waiting = Number((await endTurn(page).innerText()).match(/（(\d+)）/)![1]);
  for (let index = 0; index < waiting; index++) {
    await endTurn(page).click();
    await expect(page.locator('#selection')).toContainText('行动点');
  }
  await expect(endTurn(page)).toHaveText('第 1 轮 · 下一回合 ›');
  await expect(page.locator('#turn-hint')).toBeHidden();
  // The ‹ › buttons still cycle through every idle unit.
  await page.locator('[data-cycle-unit="next"]').click();
  await expect(page.locator('#selection')).toContainText('行动点');

  await endTurn(page).click();
  await expect(page.locator('#round-display')).toHaveText(/^2\b/);
  // Shift+click forces the end of the turn even with pending items.
  await expect(endTurn(page)).not.toHaveAttribute('data-state', 'ready');
  await endTurn(page).click({ modifiers: ['Shift'] });
  await expect(page.locator('#round-display')).toHaveText(/^3\b/);
});

test('P0-6: actionable notifications stay on the rail past 10 s and leave when dismissed', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  await openScreen(page, 'research');
  await page.locator('#research-panel [data-tech]').first().click();
  await closeScreen(page);
  const research = page.locator('#toast-host .toast', { hasText: '研究完成' });
  for (let turn = 0; turn < 20 && !(await research.count()); turn++) {
    await endTurn(page).click({ modifiers: ['Shift'] });
    await expect(endTurn(page)).toBeEnabled();
  }
  await expect(research).toHaveClass(/is-persistent/);
  const objective = page.locator('#toast-host .toast', { hasText: '目标达成：第一项研究' });
  await expect(objective).toHaveClass(/is-persistent/);

  // The rail sits at the left edge of the right drawer, below the top bar, clear of the opening goals.
  const rail = (await page.locator('#toast-host').boundingBox())!, drawer = (await page.locator('#context-drawer').boundingBox())!;
  const topbar = (await page.locator('.topbar').boundingBox())!;
  expect(rail.x + rail.width).toBeLessThanOrEqual(drawer.x);
  expect(rail.x + rail.width).toBeGreaterThan(drawer.x - 30);
  expect(rail.y).toBeGreaterThanOrEqual(topbar.y + topbar.height);
  await expect(research.locator('.toast-icon')).toHaveCSS('width', '40px');

  await page.mouse.move(5, 400);
  await page.waitForTimeout(10_500);
  await expect(research).toBeVisible();
  await expect(objective).toBeVisible();
  await research.hover();
  await expect(research.locator('.toast-card')).toBeVisible();
  await expect(research.locator('.toast-action')).toHaveText('选择研究');
  await page.screenshot({ path: `${reports}/turn-and-rail.png` });

  // × dismisses; right-click on an icon dismisses too.
  await research.locator('.toast-close').click();
  await expect(research).toHaveCount(0);
  await objective.locator('.toast-icon').click({ button: 'right' });
  await expect(objective).toHaveCount(0);
});

test('debug info (#map-info, developer drawer) shows only with ?dev=1', async ({ page }) => {
  await page.goto('/?seed=12345');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#map-info')).toBeHidden();
  await openScreen(page, 'menu');
  await expect(page.locator('#dev-drawer')).toBeHidden();

  await page.goto('/?seed=12345&dev=1');
  await expect(page.locator('#map-info')).toBeVisible();
  await expect(page.locator('#map-info')).toContainText('种子 12345');
  await openScreen(page, 'menu');
  await expect(page.locator('#dev-drawer')).toBeVisible();
});
