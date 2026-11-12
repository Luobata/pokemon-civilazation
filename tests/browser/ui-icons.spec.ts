import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { midGameFixture } from './fixtures/ui-icons.ts';
import { openScreen } from './ui.ts';

// Icon-first panels (docs/design/ui-icons/README.md): screenshots of each redesigned panel at 1280×900 from a real v24
// mid-game, and the accessibility contract — every icon-only element carries its text as an accessible name.
const dir = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/ui-icons`;
const phase = process.env.UI_ICONS_PHASE ?? 'after';
test.use({ viewport: { width: 1280, height: 900 } });

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${phase}-${name}.png` });
}
/** Icons are either decorative (aria-hidden, beside text that says the same) or named (alt / aria-label). */
async function expectNamedIcons(page: Page) {
  const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('img.px-icon, img.px-art, [role="img"]')]
    .filter(element => element.closest('[hidden]') === null)
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !(element.getAttribute('alt') || element.getAttribute('aria-label') || '').trim())
    .map(element => element.outerHTML.slice(0, 120)));
  expect(unnamed).toEqual([]);
}

test('icon-first panels: research tree, civics, city, era, world, unit and rail read as pictures with named icons', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = midGameFixture();
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'mid.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
  if (phase !== 'before') {
    // Contact sheet of the whole kit (docs/design/ui-icons/kit.png), rendered in a throwaway page.
    const sheet = await page.context().newPage();
    await sheet.goto('/buildings/README.md');
    await sheet.evaluate(async () => {
      const path = '/src/browser/ui-icons.ts';
      const kit = await import(path);
      document.body.innerHTML = `<style>body{margin:0;padding:10px;background:#16282C;color:#C9D6CF;font:10px sans-serif;display:flex;flex-wrap:wrap;gap:4px}
        figure{margin:0;width:96px;text-align:center}figcaption{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}img{image-rendering:pixelated}</style>`
        + kit.UI_ICON_NAMES.map((name: string) => `<figure><img src="${kit.iconUrl(name)}" width="40" height="40" alt=""> <img src="${kit.iconUrl(name)}" width="20" height="20" alt=""><figcaption>${name}</figcaption></figure>`).join('');
    });
    await sheet.setViewportSize({ width: 1280, height: 900 });
    await sheet.screenshot({ path: `${dir}/kit.png`, fullPage: true });
    await sheet.close();
  }
  await shot(page, 'map-rail');

  const unitId = Object.values(fixture.state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!.id;
  await page.locator('#unit-select').selectOption(String(unitId));
  await shot(page, 'unit-panel');
  if (phase !== 'before') {
    // Stat tiles are icons over numbers; their labels stay as (hidden) text, and type badges are named.
    await expect(page.locator('#unit-panel .unit-details .icon-tile')).toHaveCount(5);
    await expect(page.locator('#unit-panel .unit-details')).toContainText('射程');
    await expect(page.locator('#unit-panel .unit-types').getByRole('img', { name: /属性$/ }).first()).toBeVisible();
    // Rail entries draw a pixel icon; the button keeps the notification text as its name.
    const rail = page.locator('#toast-host .toast-icon');
    if (await rail.count()) await expect(rail.first()).toHaveAttribute('aria-label', /.+/);
  }

  await page.locator('#city-select').selectOption(String(fixture.state.players[0].headquartersCityId));
  await expect(page.locator('#production-list [data-production-option]').first()).toBeVisible();
  await shot(page, 'city-production');
  await page.locator('[data-production-kind="pokemon"]').click();
  await expect(page.locator('#production-list [data-production-option^="pokemon:"]').first()).toBeVisible();
  await shot(page, 'city-training');
  if (phase !== 'before') {
    // Cost and stats are icon + number; the row keeps the cost number as text.
    const row = page.locator('#production-list [data-production-option^="pokemon:"]').first();
    await expect(row.getByRole('img', { name: /攻击 \d+/ })).toHaveCount(1);
    await expect(row.getByRole('img', { name: /^防御 \d+/ })).toHaveCount(1);
    await expect(row.locator('.production-option-cost b')).toHaveText(/^\d+$/);
  }

  await openScreen(page, 'research');
  await page.locator('[data-tree-node="electricity"]').click();
  await page.locator('[data-tree-node="aviation"]').hover();
  if (phase !== 'before') await expect(page.locator('#ui-tip-card')).toBeVisible();
  await shot(page, 'research-tree');
  if (phase !== 'before') {
    // Each node: a subject icon, icon-only unlock chips named by their sentence, cost and rounds as icon stats.
    const node = page.locator('[data-tree-node="electricity"]');
    await expect(node.locator('.node-icon > img')).toHaveCount(1);
    await expect(node.getByRole('img', { name: /招募.*皮卡丘/ })).toHaveCount(1);
    await expect(node.getByRole('img', { name: /设施区/ })).toHaveCount(1);
    await expect(page.locator('[data-tree-node="seafaring"]').getByRole('img', { name: /秘传「冲浪」/ })).toHaveCount(1);
    await expect(node.locator('.node-cost')).toHaveAttribute('aria-label', /科研 100/);
    await expect(page.locator('#ui-tip-card')).toBeVisible();
    await expect(page.locator('#ui-tip-card')).toContainText('飞行训练');
    await expect(page.locator('#ui-tip-card')).toContainText('秘传「飞翔」');
    // Keyboard focus opens the same card.
    await page.locator('[data-tree-node="stoneCraft"]').focus();
    await expect(page.locator('#ui-tip-card')).toContainText('碎石工艺');
    await page.locator('[data-tree-node="aviation"]').hover();
    await expectNamedIcons(page);
  }

  await openScreen(page, 'policy');
  await shot(page, 'civics');
  await openScreen(page, 'era');
  await shot(page, 'era');

  await openScreen(page, 'world');
  for (const id of ['s-gym-circuit', 's22-pokedex', 's18-nests', 's19-overlords']) {
    const card = page.locator(`#expansion-panel details[data-system="${id}"]`);
    if (await card.count() && await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
  }
  await page.locator('#expansion-panel details[data-system="s-gym-circuit"]').scrollIntoViewIfNeeded();
  await shot(page, 'world');
  const book = page.locator('#research-book');
  if (await book.count()) await book.locator('summary').click();
  await page.locator('#expansion-panel details[data-system="s22-pokedex"]').scrollIntoViewIfNeeded();
  await shot(page, 'world-pokedex');
  if (phase !== 'before') {
    // Badge slots are named medals; observed species are named sprites.
    await expect(page.locator('#badge-box').getByRole('img', { name: /^空徽章槽|属性徽章/ })).toHaveCount(8);
    await expect(page.locator('.dex-strip img').first()).toHaveAttribute('alt', /已(观察|对战|捕捉)/);
    await expectNamedIcons(page);
  }

  // One turn later the notification rail has entries (Shift+click skips the reminders).
  await page.locator('.screen:not([hidden]) .screen-close').click();
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#toast-host .toast-icon').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('#toast-host .toast-icon').first().hover();
  await shot(page, 'rail');
  if (phase !== 'before') await expect(page.locator('#toast-host .toast-icon').first()).toHaveAttribute('aria-label', /.+/);
  expect(errors).toEqual([]);
});
