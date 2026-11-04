import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { networkFixture } from './fixtures/city-network.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'network.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

test('v17: a city with a trade route lists it under 城市网络, and the logistics tab offers an escort choice', async ({ page }) => {
  const fixture = networkFixture(), route = fixture.state.expansion!.cityNetwork!.routes.find(item => item.ownerId === 0)!;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, fixture.save);
  await page.locator('#city-select').selectOption(String(route.toCityId));
  const network = page.locator('#city-network');
  await expect(network).toContainText(`商路：来自城市 ${route.fromCityId}`);
  await expect(network).toContainText('食物 +2');
  await page.locator('[data-production-kind="logistics"]').click();
  await expect(page.locator('#escort-species option').first()).toBeAttached();
  await expect(page.locator('.production-section .production-help')).toContainText('随行宝可梦的属性决定新城的开局特长');
  await page.screenshot({ path: `${reports}/city-network-1280.png` });
  expect(errors).toEqual([]);
});

test('v17: a trader card lists every own destination with what it still needs', async ({ page }) => {
  const fixture = networkFixture();
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.traderId));
  const card = page.locator('.trader-card');
  await expect(card).toBeVisible();
  const own = Object.values(fixture.state.cities).filter(city => city.ownerId === 0).length;
  await expect(card.locator('[data-trade-route]')).toHaveCount(own - 1);
  await expect(card).toContainText('开通商路');
});
