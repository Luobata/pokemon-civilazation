import { expect, test } from '@playwright/test';
import { eraHonorFixture } from './fixtures/era-honors.ts';
import { openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

test('v12: the era screen shows the current age, this era’s score against both lines, and history', async ({ page }) => {
  const fixture = eraHonorFixture(), record = fixture.state.expansion!.eraHonors!.players[0];
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'era.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await openScreen(page, 'era');
  const section = page.locator('.era-honor');
  await expect(section).toHaveClass(new RegExp(`age-${record.age}`));
  await expect(section).toContainText('本世代得分');
  await expect(section).toContainText('黄金线 0.8');
  await expect(section).toContainText('黑暗线 0.45');
  await section.locator('summary', { hasText: '以往世代' }).click();
  await expect(section.locator('.era-honor-history li')).toHaveCount(1);
  await page.screenshot({ path: `${reports}/era-honors-1280.png` });
});
