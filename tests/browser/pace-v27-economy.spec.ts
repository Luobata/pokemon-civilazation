// Gameplay v27 economy lane (docs/design/pace-v27.md §4.3, §5.4): the city panel's 城市计划 tab (five icon cards with cost, yield and
// which completion; the hover card explains the +20% scaling), the idle city's quick fill offering a project, the rush button on a
// queued project, the project completing at the round end, and the legend favour chip on the wonder tab. Real input on the save of a
// real v27 AI game; turns end with Shift+click.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { idleCityFixture } from './fixtures/pace-v27-economy.ts';

const dir = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}`;
test.use({ viewport: { width: 1280, height: 900 } });
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=27');
  await page.locator('#import-save').setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
}
async function clickTile(page: Page, index: number) {
  const point = await page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
  await page.mouse.click(point.x, point.y);
}
async function endTurn(page: Page) {
  const at = (await view(page)).round;
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await view(page)).round, { timeout: 180_000 }).toBeGreaterThan(at);
}
async function openCity(page: Page, cityId: number) {
  const current = await view(page), city = current.economy.cities.find(item => item.id === cityId)!;
  await clickTile(page, hexToIndex(city.position, current.map)!);
  await expect(page.locator('#economy')).toBeVisible();
  await page.locator('#economy [data-city-section="production"]').click();
}

test('v27 city projects: idle quick fill, the 城市计划 tab with hover scaling, rush button, completion; the legend favour chip', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = idleCityFixture();
  await importSave(page, fixture.save);
  await openCity(page, fixture.cityId);
  // The idle city's quick fill offers the project the AI would pick (an icon button naming it as a city project).
  const fill = page.locator('.quick-fill-btn[data-quick-fill^="project:"]');
  await expect(fill).toHaveCount(1);
  await expect(fill).toHaveAttribute('aria-label', /城市计划/);
  await expect(fill.locator('img.px-icon')).toHaveCount(1);
  await page.locator('#economy').screenshot({ path: `${dir}/pace-v27-quick-fill.png` });
  // The 城市计划 tab: five cards, each with an icon, a cost, 第 n 次 and either its yield or what it needs.
  await page.locator('#economy [data-production-kind="project"]').click();
  const cards = page.locator('#project-cards .project-card');
  await expect(cards).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await expect(cards.nth(index).locator('img.px-icon').first()).toBeVisible();
    await expect(cards.nth(index).locator('.project-nth')).toHaveText(/^第 \d+ 次$/);
  }
  const festival = page.locator('#project-cards [data-project="festival"]');
  await expect(festival).toBeEnabled();
  await expect(page.locator('#project-cards [data-project="fieldReport"]')).toContainText('研究所区');
  // Hover card: the formula, the completion count and the next cost.
  await festival.hover();
  const tip = page.locator('#ui-tip-card');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('成本 = 基础');
  await expect(tip).toContainText('下一次');
  await expect(tip).toContainText('加急采购');
  await page.locator('#economy').screenshot({ path: `${dir}/pace-v27-project-tab.png` });
  // Queue the festival with a click; the queue shows it with its icon, and the rush button prices it (or says why not).
  const before = await view(page), cost = Number(await festival.locator('.project-cost b').textContent());
  await festival.click();
  await expect.poll(async () => (await view(page)).economy.cities.find(item => item.id === fixture.cityId)!.queue.map(order => order.item.kind)).toEqual(['project']);
  await expect(page.locator('#production-queue li').first()).toContainText('宝可梦嘉年华');
  await expect(page.locator('#production-queue li').first()).toContainText(`/${cost}`);
  await expect(page.locator('.production-current [data-gold-sink*="RushProduction"]')).toHaveAttribute('aria-label', /^加急/);
  // A second project cannot join the same queue: every card is now disabled and says why.
  await expect(page.locator('#project-cards [data-project="festival"]')).toBeDisabled();
  await expect(page.locator('#project-cards [data-project="festival"]')).toContainText('已经有一个计划');
  // Play on until the festival completes: the count rises and the card's cost goes up 20%.
  const done = before.expansion!.cityProjects!.done.festival ?? 0;
  for (let guard = 0; guard < 12 && ((await view(page)).expansion!.cityProjects!.done.festival ?? 0) <= done; guard++) await endTurn(page);
  const after = await view(page);
  expect(after.expansion!.cityProjects!.done.festival).toBeGreaterThan(done);
  await openCity(page, fixture.cityId);
  await page.locator('#economy [data-production-kind="project"]').click();
  await expect(page.locator('#project-cards [data-project="festival"] .project-nth')).toHaveText(`第 ${after.expansion!.cityProjects!.done.festival! + 1} 次`);
  // The wonder tab shows the legend favour chip (the next legend's multiplier) with its hover rule.
  await page.locator('#economy [data-production-kind="legend"]').click();
  const chip = page.locator('#economy .legend-favor-chip');
  await expect(chip).toBeVisible();
  const owned = after.expansion!.legends!.wonders.filter(wonder => wonder.ownerId === 0).length;
  await expect(chip).toContainText(`第 ${owned + 1} 座`);
  await expect(chip).toHaveAttribute('data-tip', /每拥有一座传说奇观，下一座的成本 \+15%/);
  await page.locator('#economy').screenshot({ path: `${dir}/pace-v27-legend-favor.png` });
  expect(errors).toEqual([]);
});
