import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import type { ScreenId } from './ui.ts';
import { closeScreen, openScreen } from './ui.ts';

const SCREENS: ScreenId[] = ['victory', 'research', 'policy', 'era', 'leader', 'diplomacy', 'world', 'log', 'menu'];
async function state(page: import('@playwright/test').Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}

test('the map fills the window and every launcher entry opens its own screen', async ({ page }) => {
  await page.goto('/?seed=12345');
  const map = (await page.locator('#map').boundingBox())!;
  expect(map.width).toBeGreaterThan(1280 * .6);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await expect(page.locator('#screen-host')).toBeHidden();
  for (const id of SCREENS) {
    await page.locator(`[data-open-screen="${id}"]`).click();
    await expect(page.locator(`#screen-${id}`)).toBeVisible();
    await expect(page.locator('.screen:not([hidden])')).toHaveCount(1);
    await expect(page.locator(`[data-open-screen="${id}"]`)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen-host')).toBeHidden();
  }
  await openScreen(page, 'era');
  await page.locator('#screen-era .screen-close').click();
  await expect(page.locator('#screen-host')).toBeHidden();
  await openScreen(page, 'leader');
  await page.locator('.screen-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#screen-host')).toBeHidden();
});

test('research tree cards start research and show each discovery', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.keyboard.press('r');
  await expect(page.locator('#screen-research')).toBeVisible();
  await expect(page.locator('#research-topic')).toBeFocused();
  await expect(page.locator('[data-tech-card]')).toHaveCount(12);
  await expect(page.locator('[data-tech-card="ballCraft"]')).toHaveClass(/locked/);
  await expect(page.locator('[data-tech-card="domestication"] .tech-eureka')).toContainText('初次交手');
  await page.locator('[data-tech="domestication"]').click();
  expect((await state(page)).players[0].research.techId).toBe('domestication');
  await expect(page.locator('[data-tech-card="domestication"]')).toHaveClass(/active/);
  await expect(page.locator('#research-status')).toContainText('驯化');
  await closeScreen(page);
  await expect(page.locator('#turn-reminders')).not.toContainText('选择研究');
});

test('the yield layer toggles from the toolbar and the Y key without changing game state', async ({ page }) => {
  await page.goto('/?seed=12345');
  const before = JSON.stringify(await state(page));
  await expect(page.locator('#show-yields')).toBeChecked();
  await page.locator('#map').focus();
  await page.keyboard.press('y');
  await expect(page.locator('#show-yields')).not.toBeChecked();
  await page.locator('#show-yields').check();
  expect(JSON.stringify(await state(page))).toBe(before);
});

for (const width of [1440, 1100, 900, 390]) test(`top bar stats and launcher never overlap or clip at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/?seed=12345');
  const layout = await page.evaluate(() => {
    const stats = document.querySelector<HTMLElement>('.hud-stats')!, launcher = document.querySelector<HTMLElement>('#launcher')!.getBoundingClientRect();
    const box = stats.getBoundingClientRect();
    return { clipped: stats.scrollWidth - stats.clientWidth, overflowX: document.documentElement.scrollWidth - innerWidth,
      overlap: launcher.top < box.bottom && launcher.left < box.right && launcher.right > box.left };
  });
  expect(layout).toEqual({ clipped: 0, overflowX: 0, overlap: false });
});

test('charters are a tree: requirement lines, locked reasons, and the first charter can be targeted', async ({ page }) => {
  await page.goto('/?seed=12345');
  await openScreen(page, 'policy');
  await expect(page.locator('[data-charter-card]')).toHaveCount(6);
  // One line per requirement in content/policies.ts (7 in total).
  await expect(page.locator('.charter-links path')).toHaveCount(7);
  await expect(page.locator('[data-charter-card="eliteFour"]')).toHaveClass(/locked/);
  await expect(page.locator('[data-charter-card="eliteFour"] .charter-state').first()).toContainText('需要');
  await expect(page.locator('.slot-board')).toHaveCount(0);
  await expect(page.locator('.policy-card.locked').first()).toContainText('解锁');
  await page.locator('[data-charter="gymCode"]').click();
  await expect(page.locator('[data-charter-card="gymCode"]')).toHaveClass(/active/);
  await expect(page.locator('.policy-status')).toContainText('正在制定「道馆守则」');
});
