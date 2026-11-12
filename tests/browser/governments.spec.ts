import { expect, test } from '@playwright/test';
import { governmentFixture } from './fixtures/governments.ts';
import { openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const policies = (page: import('@playwright/test').Page) => page.evaluate(async () => {
  const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState().expansion.policies[0];
});

test('v11: adopt the first government for free from the civics screen, then changing costs gold', async ({ page }) => {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'gov.json', mimeType: 'application/json', buffer: Buffer.from(governmentFixture().save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await openScreen(page, 'policy');
  await expect(page.locator('[data-government-card]')).toHaveCount(6);
  await expect(page.locator('[data-government-card="championCouncil"]')).toHaveClass(/locked/);
  // Icon-first cards: the leader preference and the unlocked governments are named icons.
  await expect(page.locator('[data-government-card="researchSociety"]').getByRole('img', { name: /领袖偏好/ })).toHaveCount(1);
  await expect(page.locator('[data-charter-card="gymCode"] .charter-government').getByRole('img', { name: /道馆联盟/ })).toHaveCount(1);
  await page.screenshot({ path: `${reports}/governments-1280.png` });
  await page.locator('[data-government="researchSociety"]').click();
  await expect.poll(async () => (await policies(page)).government).toBe('researchSociety');
  await expect(page.locator('[data-government-card="researchSociety"]')).toHaveClass(/active/);
  await expect(page.locator('[data-government="ranchCommons"]')).toContainText('60 金');
  await expect(page.locator('.slot-board').getByRole('img', { name: /经济/ })).not.toHaveCount(0);
  await openScreen(page, 'log');
  await expect(page.locator('#activity-list')).toContainText('采用体制「研究会」');
});
