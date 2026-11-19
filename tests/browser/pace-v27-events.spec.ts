// pace-v27 events lane (docs/design/pace-v27.md §6.4, §8.4): from real v27 games (the AI plays every seat) loaded through the menu —
// ⑦ entering a contest season from a city without a contest hall by clicking the card's 参赛 button; ⑤ ending the turn (Shift+click)
// into an open Max raid: the raid card's shields and reward preview, the World page's raid section (shield pips, ledger, Dynamax
// button), and the boss's Max look on the map (aura pixels, 1.5×, shield pips) in normal and reduced motion. Icons carry names.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { circuitFixture, raidFixture } from './fixtures/pace-v27-events.ts';
import { closeScreen, openScreen } from './ui.ts';

const shots = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'pace.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 180_000 });
}
async function expectNamed(page: Page, root: string) {
  const unnamed = await page.evaluate(root => [...document.querySelectorAll<HTMLElement>(`${root} img.px-icon, ${root} img.px-art, ${root} [role="img"], ${root} button`)]
    .filter(element => element.closest('[hidden]') === null && element.closest('[aria-hidden="true"]') === null)
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !(element.getAttribute('alt') || element.getAttribute('aria-label') || element.textContent || '').trim())
    .map(element => element.outerHTML.slice(0, 120)), root);
  expect(unnamed).toEqual([]);
}
/** The live state through the dev adapter (state.expansion etc.). */
const liveState = (page: Page) => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });

test('v27 contest circuit: enter the season from a city without a contest hall (the card\'s 参赛 button)', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = circuitFixture();
  test.skip(!fixture, 'no seed reached an announced season without a hall');
  await importSave(page, fixture!.save);
  await page.locator('#animate').uncheck();
  await openScreen(page, 'world');
  const card = page.locator('#expansion-panel .next-card[data-card="season"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-tip', /不需要大赛馆/);
  await expect(card).toHaveAttribute('data-tip', /奖品：第 1 名 .+属性招式学习器/);
  const enter = card.locator('button', { hasText: '参赛' });
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.screenshot({ path: `${shots}/pace-v27-contest-card.png` });
  if (await enter.isEnabled()) {
    await enter.click();
    await expect.poll(async () => Boolean((await liveState(page)).expansion.contestSeasons.entries[0])).toBe(true);
    await expect(page.locator('#expansion-panel .next-card[data-card="season"]')).toContainText('已参赛');
  } else {
    // No Pokémon stands in or next to a city right now: the card says why (playtest N7), never "no contest hall".
    await expect(card).toHaveAttribute('data-tip', /附近城市里没有可出场的宝可梦/);
  }
  await expectNamed(page, '#expansion-panel .next-cards');
  await closeScreen(page);
  expect(errors).toEqual([]);
});

for (const motion of ['full', 'reduced'] as const) test(`v27 Max raid (${motion} motion): Shift+click into the open den, the raid card, the World section and the boss's Max look`, async ({ page }) => {
  test.setTimeout(2_400_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (motion === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = raidFixture();
  test.skip(!fixture, 'no seed reached an explored Max raid den');
  await importSave(page, fixture!.save);
  await page.locator('#animate').uncheck();
  // Real input: end the turn with Shift+click (the AI seats play), the den opens at the round end.
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => { const state = await liveState(page); return state.activePlayerId === 0 && Boolean(state.expansion.raids.active); }, { timeout: 600_000 }).toBe(true);
  const state = await liveState(page), boss = state.expansion.raids.active;
  expect(boss.max.shields).toBe(boss.max.shieldMax);
  await openScreen(page, 'world');
  const card = page.locator('#expansion-panel .next-card[data-card="raid"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText(`护盾 ${boss.max.shields}/${boss.max.shieldMax}`);
  await expect(card).toHaveAttribute('data-tip', /奖励预览/);
  await expect(card).toHaveAttribute('data-tip', /捕捉/);
  const section = page.locator('#expansion-panel section.max-raid');
  await expect(section).toBeVisible();
  await expect(section.locator('.max-shields')).toHaveAttribute('aria-label', `极巨护盾 ${boss.max.shields}/${boss.max.shieldMax}`);
  await expect(section.locator('.max-shields img')).toHaveCount(boss.max.shieldMax);
  await expect(section.locator('.raid-rewards li')).toHaveCount(3);
  await expect(section.locator('button', { hasText: '极巨化（团体战，免费）' })).toBeVisible();
  await expectNamed(page, '#expansion-panel section.max-raid');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/pace-v27-raid-world${motion === 'reduced' ? '-reduced' : ''}.png` });
  // Locate the den: the camera centres the boss; its aura is drawn in red-pink around the canvas centre.
  await card.locator('[data-locate-tile]').click();
  await expect(page.locator('#screen-host')).toBeHidden();
  // The inspector names the boss and its shields (not the wild "catch it with a ball" hint).
  await expect(page.locator('#tile-info')).toContainText('极巨团体战首领');
  await expect(page.locator('#tile-info')).toContainText(`极巨护盾 ${boss.max.shields}/${boss.max.shieldMax}`);
  await page.waitForTimeout(400);
  const scene = await page.evaluate(async (bossId: number) => {
    const main = '/src/browser/main.ts', vision = '/src/core/vision.ts', scenePath = '/src/browser/render/scene.ts';
    const state = (await import(main)).developerAdapter.getState(), view = (await import(vision)).observe(state, 0);
    return (await import(scenePath)).buildScene({ view }).units.find((item: { unit: { id: number } }) => item.unit.id === bossId)?.max ?? null;
  }, boss.unitId);
  expect(scene).toEqual({ shields: boss.max.shields, shieldMax: boss.max.shieldMax, phase: 1 });
  const pinkAtCentre = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, context = canvas.getContext('2d')!;
    const { width, height } = canvas, data = context.getImageData(Math.round(width / 2 - width * .06), Math.round(height / 2 - height * .08), Math.round(width * .12), Math.round(height * .16)).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 170 && data[index + 1] < 120 && data[index + 2] > 70 && data[index + 2] < 190) count++;
    return count;
  });
  expect(await pinkAtCentre()).toBeGreaterThan(20);
  await page.screenshot({ path: `${shots}/pace-v27-raid-map${motion === 'reduced' ? '-reduced' : ''}.png` });
  if (motion === 'full') {
    // The aura and shield pips in the other map modes: 2.5D (the same unit pass on lifted tiles) and the painted theme (on the medallion).
    const settle = async () => { await openScreen(page, 'world'); await card.locator('[data-locate-tile]').click(); await expect(page.locator('#screen-host')).toBeHidden(); await page.waitForTimeout(400); };
    const pick = (selector: string) => page.evaluate(selector => { const input = document.querySelector<HTMLInputElement>(selector)!; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }, selector);
    await pick('#render-settings input[value="25d"]');
    expect(await page.evaluate(async () => (await import('/src/browser/main.ts' as string)).developerAdapter.renderMode())).toBe('25d');
    await settle();
    expect(await pinkAtCentre()).toBeGreaterThan(20);
    await page.screenshot({ path: `${shots}/pace-v27-raid-map-25d.png` });
    await pick('#theme-settings input[value="painted"]');
    expect(await page.evaluate(async () => (await import('/src/browser/main.ts' as string)).developerAdapter.renderMode())).toBe('painted');
    await settle();
    expect(await pinkAtCentre()).toBeGreaterThan(20);
    await page.screenshot({ path: `${shots}/pace-v27-raid-map-painted.png` });
    await pick('#theme-settings input[value="pixel"]');
    await pick('#render-settings input[value="flat"]');
  }
  expect(errors).toEqual([]);
});
