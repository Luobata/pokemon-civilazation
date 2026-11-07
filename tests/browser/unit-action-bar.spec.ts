import { copyFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import { builderFixture } from './fixtures/roles.ts';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState();
  });
}

test('P0-3: the unit action bar sits at the bottom-right of the map with hotkeys and reasons', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  const initial = await state(page);
  const pokemon = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  const settler = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  const bar = page.locator('#unit-action-bar');
  await expect(bar).toBeHidden();
  await page.locator('#unit-select').selectOption(String(pokemon.id));
  await page.locator('#map').focus();

  // Visible in the first viewport, on the map and outside the drawer; the drawer keeps details only.
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!, drawer = (await page.locator('#context-drawer').boundingBox())!, viewport = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x + box.width).toBeLessThanOrEqual(drawer.x);
  expect(box.x + box.width).toBeGreaterThan(drawer.x - 120);
  for (const id of ['#move-unit', '#attack-unit', '#capture-unit', '#evolve-unit', '#skip-unit']) await expect(bar.locator(id)).toBeVisible();
  await expect(page.locator('#unit-panel .unit-actions')).toHaveCount(0);
  await expect(page.locator('#unit-panel .unit-details')).toContainText('射程');
  await expect(page.locator('#unit-panel .unit-details')).toContainText('视野');
  await expect(bar.locator('#attack-unit kbd')).toHaveText('A');

  // A disabled button explains itself in its title and in the hover card.
  const capture = bar.locator('#capture-unit');
  await expect(capture).toBeDisabled();
  expect(await capture.getAttribute('title')).toMatch(/驯化/);
  await capture.hover();
  await expect(page.locator('#capture-unit-tip')).toBeVisible();
  await expect(page.locator('#capture-unit-tip .unit-action-reason')).not.toBeEmpty();
  await page.screenshot({ path: 'test-results/screenshots/unit-action-bar.png' });
  mkdirSync('/tmp/ui-p0', { recursive: true });
  copyFileSync('test-results/screenshots/unit-action-bar.png', '/tmp/ui-p0/unit-action-bar.png');
  // Its hotkey does nothing but says why.
  await page.keyboard.press('q');
  await expect(page.locator('#action-notice')).toContainText('不可用');

  // Clicking and the hotkey enter the same mode.
  await bar.locator('#attack-unit').click();
  await expect(page.locator('#action-notice')).toContainText('攻击模式');
  await expect(bar.locator('#attack-unit')).toHaveAttribute('aria-pressed', 'true');
  await bar.locator('#attack-unit').click();
  await expect(page.locator('#action-notice')).not.toContainText('攻击模式');
  await page.keyboard.press('a');
  await expect(page.locator('#action-notice')).toContainText('攻击模式');
  await expect(bar.locator('#attack-unit')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('m');
  await expect(page.locator('#action-notice')).toContainText('移动模式');
  await expect(bar.locator('#move-unit')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.locator('#attack-unit')).not.toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('m');
  await expect(bar.locator('#move-unit')).not.toHaveAttribute('aria-pressed', 'true');

  // Hotkeys stay quiet while typing.
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing-probe'; document.body.append(input); });
  await page.locator('#typing-probe').focus();
  await page.keyboard.press('m');
  await expect(bar.locator('#move-unit')).not.toHaveAttribute('aria-pressed', 'true');

  // Space skips to the next unit waiting for orders (here the settler, whose bar offers 建城 B).
  await page.locator('#map').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#unit-select')).toHaveValue(String(settler.id));
  await expect(bar.locator('#found-city')).toBeVisible();
  await expect(bar.locator('#attack-unit')).toHaveCount(0);
  expect(await bar.locator('#found-city').getAttribute('title')).toMatch(/至少需要 4 格/);
});

test('P0-3: 改良 (I) builds through the bar with the same ImproveTile command as the drawer', async ({ page }) => {
  const fixture = builderFixture(), before = fixture.state.units[fixture.builderId].charges!;
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'roles.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
  await page.locator('#unit-select').selectOption(String(fixture.builderId));
  await page.locator('#map').focus();
  const bar = page.locator('#unit-action-bar'), improve = bar.locator('#improve-unit');
  await expect(improve).toBeEnabled();
  await expect(bar.locator('#attack-unit')).toHaveCount(0);
  const options = await page.locator('.builder-card [data-improve]').count();
  await page.keyboard.press('i');
  if (options > 1) {
    const option = bar.locator('[data-action="improve-option"]').first();
    await expect(option).toBeVisible();
    await option.click();
  }
  await expect.poll(async () => (await state(page)).units[fixture.builderId]?.charges ?? 0).toBe(before - 1);
});
