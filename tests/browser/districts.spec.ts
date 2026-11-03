import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { districtUiFixture, foreignConstructionFixture, v9SaveFixture } from './fixtures/districts-ui.ts';
import type { Hex } from '../../src/core/hex.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'district-ui.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

async function clickHex(page: Page, hex: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath);
    const screen = toScreen(hexToWorld(hex), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, hex);
  await page.mouse.click(point.x, point.y);
}

async function selectGarden(page: Page, tileIndex: number) {
  const hex = await page.evaluate(async tileIndex => {
    const mainPath = '/src/browser/main.ts', hexPath = '/src/core/hex.ts';
    const { session } = await import(mainPath), { indexToHex } = await import(hexPath);
    return indexToHex(tileIndex, session.getView().map);
  }, tileIndex);
  await page.locator('[data-production-kind="district"]').click();
  await page.locator('[data-district-kind="gardenDistrict"]').click();
  await clickHex(page, hex);
  await expect(page.locator('#district-preview')).toBeVisible();
  await expect.poll(() => page.locator('#district-preview').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.top < window.innerHeight && rect.bottom > 0;
  })).toBe(true);
}

for (const width of [1280, 768, 390] as const) {
  test(`district placement and completed panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const ready = districtUiFixture('ready');
    await importSave(page, ready.save);
    await selectGarden(page, ready.tileIndex);
    await expect(page.locator('#district-preview')).toContainText('当前已知合计');
    await expect(page.locator('#district-preview')).toContainText('部分相邻格未知');
    await expect(page.locator('#district-preview')).toContainText('城市 1 将释放该格工作与锁定');
    await expect(page.locator('.district-incomplete')).toHaveCSS('font-size', '10px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${reports}/p3-v10-ui-selection-${width}.png`, fullPage: true });
    await page.screenshot({ path: `${reports}/p3-v10-ui2-incomplete-${width}.png`, fullPage: true });

    if (width === 390) {
      await page.locator('#map').focus();
      await page.keyboard.press('Enter');
    } else await page.locator('#confirm-district').click();
    await expect(page.locator('#production-queue')).toContainText('花园');
    await expect(page.locator('#city-districts .district-project')).toHaveCount(1);

    if (width === 1280) {
      await page.locator('[data-remove="0"]').click();
      await expect(page.locator('#production-queue')).toBeEmpty();
      await expect(page.locator('#city-districts .district-project')).toHaveCount(0);
      await selectGarden(page, ready.tileIndex);
      await expect(page.locator('#district-preview .district-reason')).toHaveCount(0);
      await page.locator('#confirm-district').click();
      await expect(page.locator('#production-queue')).toContainText('花园');
    }

    const built = districtUiFixture('built');
    await importSave(page, built.save);
    await expect(page.locator('#city-districts')).toContainText('设施区 1/2');
    await expect(page.locator('#city-districts')).toContainText('花园');
    await page.locator('#city-districts summary').click();
    await expect(page.locator('#city-districts')).toContainText('当前已知合计');
    await page.locator('#fit').click();
    await page.screenshot({ path: `${reports}/p3-v10-ui-built-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('district invalid tile explains the reason without a confirmation command', async ({ page }) => {
  const fixture = districtUiFixture('ready');
  await importSave(page, fixture.save);
  await page.locator('[data-production-kind="district"]').click();
  await page.locator('[data-district-kind="gardenDistrict"]').click();
  await clickHex(page, fixture.state.cities[fixture.cityId].position);
  await expect(page.locator('#district-preview .district-reason')).toContainText('城市中心格不能建造设施区');
  await expect(page.locator('#confirm-district')).toHaveCount(0);
});

test('new games default to v10 districts; a loaded v9 save has no district entry or city section', async ({ page }) => {
  await page.goto('/?seed=1');
  await expect(page.locator('[data-production-kind="district"]')).toHaveCount(1);
  await importSave(page, v9SaveFixture().save);
  await expect(page.locator('[data-production-kind="district"]')).toHaveCount(0);
  await expect(page.locator('#city-districts')).toHaveCount(0);
});

test('foreign construction is selectable, blocks ordering, and disappears after retreat', async ({ page }) => {
  await page.addInitScript(() => {
    const texts: string[] = [];
    Object.assign(window, { __districtTexts: texts });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      texts.push(String(text));
      return original.call(this, text, x, y, maxWidth);
    };
  });
  const visible = foreignConstructionFixture();
  await importSave(page, visible.save);
  await page.locator('#fit').click();
  const texts = () => page.evaluate(() => (window as unknown as { __districtTexts: string[] }).__districtTexts);
  await expect.poll(async () => (await texts()).includes('施')).toBe(true);
  await clickHex(page, await tilePosition(page, visible.tileIndex));
  await expect(page.locator('#action-notice')).toHaveText('文明 2 · 施工中');
  await page.screenshot({ path: `${reports}/p3-v10-ui2-construction-1280.png`, fullPage: true });

  await selectGarden(page, visible.tileIndex);
  await expect(page.locator('#district-preview .district-reason')).toBeVisible();
  await expect(page.locator('#confirm-district')).toHaveCount(0);

  const hidden = foreignConstructionFixture(true);
  await importSave(page, hidden.save);
  await page.locator('#fit').click();
  await expect.poll(async () => (await texts()).length).toBeGreaterThan(0);
  expect((await texts()).includes('施')).toBe(false);
});

test('harbor coast reason mentions explored land', async ({ page }) => {
  const fixture = districtUiFixture('harbor');
  await importSave(page, fixture.save);
  await page.locator('[data-production-kind="district"]').click();
  await page.locator('[data-district-kind="harborDistrict"]').click();
  await clickHex(page, await tilePosition(page, fixture.tileIndex));
  await expect(page.locator('#district-preview .district-reason')).toContainText('港口需要相邻一块已探索的陆地');
  await expect(page.locator('#confirm-district')).toHaveCount(0);
});

async function tilePosition(page: Page, tileIndex: number): Promise<Hex> {
  return page.evaluate(async tileIndex => {
    const mainPath = '/src/browser/main.ts', hexPath = '/src/core/hex.ts';
    const { session } = await import(mainPath), { indexToHex } = await import(hexPath);
    return indexToHex(tileIndex, session.getView().map);
  }, tileIndex);
}
