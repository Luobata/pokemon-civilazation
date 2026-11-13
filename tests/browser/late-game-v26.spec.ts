// depth-v26 lane 2 (late game): the contest-season next-action card (the raid card is covered in tests/core/late-game-v26.test.ts),
// the city panel's rush button and the training / TM section, from real v26 games (the AI plays every seat) loaded through the menu. Icons and buttons carry accessible names.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seasonFixture } from './fixtures/late-game-v26.ts';
import { closeScreen, openScreen } from './ui.ts';

const shots = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function expectNamed(page: Page, root: string) {
  const unnamed = await page.evaluate(root => [...document.querySelectorAll<HTMLElement>(`${root} img.px-icon, ${root} img.px-art, ${root} [role="img"], ${root} button`)]
    .filter(element => element.closest('[hidden]') === null && element.closest('[aria-hidden="true"]') === null)
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !(element.getAttribute('alt') || element.getAttribute('aria-label') || element.textContent || '').trim())
    .map(element => element.outerHTML.slice(0, 120)), root);
  expect(unnamed).toEqual([]);
}

test('v26 contest season: the world card, the training / TM section and the city rush button', async ({ page }) => {
  // The fixture plays a real 4-seat v26 game to round 40+ first (minutes under load).
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = seasonFixture();
  test.skip(!fixture, 'no seed reached an announced contest season with a hall');
  await importSave(page, fixture!.save);
  await openScreen(page, 'world');
  const card = page.locator('#expansion-panel .next-card[data-card="season"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', /华丽大赛季 第 \d+ 届/);
  await expect(card.locator('img.px-icon').first()).toHaveAttribute('alt', /华丽大赛季/);
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await expect(page.locator('#ui-tip-card')).toContainText('得分 = 20 × 匹配属性');
  await page.screenshot({ path: `${shots}/depth-v26-season-card.png` });
  const section = page.locator('#expansion-panel details[data-system="s-gold-sinks"]');
  await section.locator('summary').click();
  await expect(section.locator('button', { hasText: '特训' }).first()).toBeVisible();
  await expectNamed(page, '#expansion-panel');
  await closeScreen(page);

  const cityId = fixture!.state.players[0].headquartersCityId;
  await page.locator('#city-select').selectOption(String(cityId));
  const rush = page.locator('#economy .gold-sink-btn').first();
  await expect(rush).toBeVisible();
  await expect(rush).toHaveAttribute('aria-label', /^加急/);
  await expectNamed(page, '#economy .gold-sinks');
  await page.screenshot({ path: `${shots}/depth-v26-rush.png` });
  expect(errors).toEqual([]);
});
