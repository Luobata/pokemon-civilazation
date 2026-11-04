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
  await expect(page.locator('[data-government-card="researchSociety"]')).toContainText('领袖偏好');
  await expect(page.locator('[data-charter-card="gymCode"] .charter-government')).toContainText('道馆联盟');
  await page.screenshot({ path: `${reports}/governments-1280.png` });
  await page.locator('[data-government="researchSociety"]').click();
  await expect.poll(async () => (await policies(page)).government).toBe('researchSociety');
  await expect(page.locator('[data-government-card="researchSociety"]')).toHaveClass(/active/);
  await expect(page.locator('[data-government="ranchCommons"]')).toContainText('60 金');
  await expect(page.locator('.slot-board')).toContainText('经济');
  await openScreen(page, 'log');
  await expect(page.locator('#activity-list')).toContainText('采用体制「研究会」');
});
