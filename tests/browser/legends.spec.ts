import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LEGEND_WONDERS } from '../../src/content/legend-wonders.ts';
import type { LegendWonderId } from '../../src/content/legend-wonders.ts';
import { LEGEND_STORIES } from '../../src/content/legend-stories.ts';
import { legendFixture } from './fixtures/legends.ts';
import { openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'legends.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
const ownWonder = (fixture: ReturnType<typeof legendFixture>) => (Object.entries(fixture.state.expansion!.legends!.wonders) as [LegendWonderId, { cityId: number; builderId: number }][])
  .find(([, wonder]) => fixture.state.cities[wonder.cityId].ownerId === 0)!;

test('v15: the 传说 screen shows built wonders, rivals’ wonders, clues and the unlocked story chapters', async ({ page }) => {
  const fixture = legendFixture(), [mine, record] = ownWonder(fixture);
  await importSave(page, fixture.save);
  await openScreen(page, 'legends');
  const card = page.locator(`.legend-card[data-legend="${mine}"]`);
  await expect(card).toHaveClass(/mine/);
  await expect(card.locator('.legend-status')).toContainText(`你的城市 ${record.cityId}`);
  await card.locator('summary').click();
  await expect(card.locator('.legend-story h4')).toHaveText(['第一章 · 线索', '第二章 · 筑殿', '终章 · 降临']);
  await expect(card.locator('.legend-story')).toContainText(LEGEND_STORIES[mine].complete.slice(0, 12));
  for (const [id, wonder] of Object.entries(fixture.state.expansion!.legends!.wonders) as [LegendWonderId, { cityId: number }][]) {
    if (fixture.state.cities[wonder.cityId].ownerId !== 0) await expect(page.locator(`.legend-card[data-legend="${id}"]`)).toHaveClass(/theirs/);
  }
  // Simple eras list the 21 legends of generations 1–3 only.
  await expect(page.locator('.legend-card')).toHaveCount(Object.values(LEGEND_WONDERS).filter(legend => legend.generation <= 3).length);
  await page.screenshot({ path: `${reports}/legends-screen-1280.png` });
});

test('v15: the production tab offers 传说奇观 with each clue’s status, without page errors', async ({ page }) => {
  const fixture = legendFixture(), [, record] = ownWonder(fixture), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, fixture.save);
  await page.locator('#city-select').selectOption(String(record.cityId));
  const tab = page.locator('[data-production-kind="legend"]');
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator('.production-section .production-help')).toContainText('传说奇观全世界只有一座');
  const clues = fixture.state.expansion!.legends!.clues[0].filter(id => !fixture.state.expansion!.legends!.wonders[id]);
  if (clues.length) await expect(page.locator('.legend-production li')).toHaveCount(clues.length);
  else await expect(page.locator('.empty-note')).toContainText('还没有任何传说的线索');
  expect(errors).toEqual([]);
});

test('v15: the completion card tells the closing chapter with the legend’s sprite and quote', async ({ page }) => {
  await page.goto('/?seed=1');
  await page.evaluate(async () => { const path = '/src/browser/main.ts'; (await import(path)).showLegendArrival('articuno'); });
  const card = page.locator('.legend-arrival-card');
  await expect(card).toBeVisible(); // the card must show with no screen open
  await expect(card.locator('h2')).toHaveText('急冻鸟 · 冰封神殿');
  await expect(card.locator('.legend-arrival-text')).toHaveText(LEGEND_STORIES.articuno.complete);
  await expect(card.locator('blockquote')).toHaveText(LEGEND_STORIES.articuno.quote);
  await expect.poll(() => card.locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: `${reports}/legends-arrival-1280.png` });
  await card.locator('#legend-arrival-close').click();
  await expect(card).toHaveCount(0);
});
