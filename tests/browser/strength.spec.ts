import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strengthFixture } from './fixtures/strength.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'strength.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function clickUnit(page: Page, unitId: number) {
  const point = await page.evaluate(async id => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath);
    const unit = session.getView().units.find((item: { id: number }) => item.id === id);
    const screen = toScreen(hexToWorld(unit.position), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, unitId);
  await page.mouse.click(point.x, point.y);
}

test('v20: the attack preview compares combat strength and lists every bonus', async ({ page }) => {
  const fixture = strengthFixture(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await page.locator('#fit').click();
  await page.locator('#attack-unit').click();
  await clickUnit(page, fixture.targetId);
  const breakdown = page.locator('#strength-breakdown');
  await expect(breakdown).toBeVisible();
  await expect(breakdown.locator('.strength-side')).toHaveCount(2);
  await expect(breakdown).toContainText('战斗力');
  await expect(breakdown.locator('.strength-gap')).toContainText(/差 |属性无效/);
  await expect(page.locator('.unit-vitals')).toContainText('/100');
  await page.screenshot({ path: `${reports}/strength-preview-1280.png` });
  expect(errors).toEqual([]);
});
