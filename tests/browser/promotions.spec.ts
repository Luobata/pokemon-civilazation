import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PROMOTION_TRAITS, PROMOTION_TRAIT_IDS } from '../../src/content/promotions.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameState } from '../../src/core/model.ts';
import { freshPromotionFixture, promotionFixture } from './fixtures/promotions.ts';
import { openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'promotions.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
const liveState = (page: Page): Promise<GameState> => page.evaluate(async () => {
  const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState();
});
async function clickTile(page: Page, index: number) {
  const point = await page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
  await page.mouse.click(point.x, point.y);
}

test('v13: a Pokémon with enough merit picks 猛攻 from the unit panel without spending its action', async ({ page }) => {
  const fixture = promotionFixture(), record = fixture.state.expansion!.promotions!.units[fixture.unitId];
  expect(record.merit).toBeGreaterThanOrEqual(6);
  expect(record.traits).toEqual([]);
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const box = page.locator('#promotion-box');
  await expect(box).toBeVisible();
  await expect(box).toHaveClass(/ready/);
  await expect(box).toContainText(`战功 ${record.merit}`);
  await expect(box.locator('.promotion-ready')).toContainText('不消耗行动');
  await expect(box.locator('[data-promote]')).toHaveCount(PROMOTION_TRAIT_IDS.length);
  for (const trait of PROMOTION_TRAIT_IDS) await expect(box.locator(`[data-promote="${trait}"]`)).toContainText(PROMOTION_TRAITS[trait].name);
  await expect(box.locator('.promotion-trait')).toHaveCount(0);
  await page.screenshot({ path: `${reports}/promotions-1280.png` });

  const before = await liveState(page), actionLeft = before.units[fixture.unitId].actionLeft;
  expect(actionLeft).toBeGreaterThan(0);
  await box.locator('[data-promote="assault"]').click();
  await expect.poll(async () => (await liveState(page)).commandSeq).toBe(before.commandSeq + 1);
  const after = await liveState(page);
  expect(after.expansion!.promotions!.units[fixture.unitId].traits).toEqual(['assault']);
  expect(after.units[fixture.unitId].actionLeft).toBe(actionLeft);
  await expect(page.locator('#promotion-box .promotion-trait')).toHaveText(['猛攻']);
  await expect(page.locator('#promotion-box [data-promote]')).toHaveCount(0);
  await expect(page.locator('#promotion-box')).not.toHaveClass(/ready/);
  await expect(page.locator('#unit-panel .unit-ap')).toHaveText(`行动点 ${actionLeft}`);
  await expect(page.locator('#move-unit')).toBeEnabled();
  await openScreen(page, 'log');
  await expect(page.locator('#activity-list')).toContainText('获得特性「猛攻」（第 1 次）');
});

test('v13: the tile inspector lists the traits of a visible enemy unit at war', async ({ page }) => {
  const fixture = promotionFixture(), enemy = fixture.state.units[fixture.enemyId];
  const record = fixture.state.expansion!.promotions!.units[fixture.enemyId];
  const names = record.traits.map(trait => PROMOTION_TRAITS[trait].name);
  expect(names.length).toBeGreaterThan(0);
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  if (!('position' in enemy) || !enemy.position) throw new Error('enemy is not on the map');
  await clickTile(page, hexToIndex(enemy.position, fixture.state.map)!);
  const entity = page.locator('#tile-info [data-entity="unit"]').filter({ hasText: '特性：' });
  await expect(entity).toHaveCount(1);
  // Traits are public; a rival's merit (how close it is to the next promotion) is not.
  await expect(entity).toContainText(`特性：${names.join('、')}`);
  await expect(entity).not.toContainText('战功');
  await expect(entity).toContainText('交战中');
});

test('v13: a Pokémon without merit explains how merit is earned and offers no choice', async ({ page }) => {
  const fixture = freshPromotionFixture();
  const pokemon = Object.values(fixture.state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(pokemon.id));
  const box = page.locator('#promotion-box');
  await expect(box).toBeVisible();
  await expect(box).not.toHaveClass(/ready/);
  await expect(box).toContainText('晋升 · 战功 0 / 6');
  await expect(box.locator('.unit-note')).toContainText('战功来自战斗');
  await expect(box.locator('.unit-note')).toContainText('6 / 14 / 24');
  await expect(box.locator('[data-promote]')).toHaveCount(0);
  await expect(box.locator('.promotion-trait')).toHaveCount(0);
});

test('v13: the promotion choice fits a 390px viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const fixture = promotionFixture();
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const box = page.locator('#promotion-box');
  await expect(box.locator('[data-promote]')).toHaveCount(PROMOTION_TRAIT_IDS.length);
  // The panel is re-rendered once after selection, so act on the element inside the page instead of holding a handle.
  await box.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => box.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const rect = (await box.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  for (const button of await box.locator('[data-promote]').all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(rect.x + rect.width + 1);
  }
  await page.screenshot({ path: `${reports}/promotions-390.png`, fullPage: true });
});
