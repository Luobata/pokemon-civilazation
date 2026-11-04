import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Screens opened from the top-bar launcher (see src/browser/screens.ts). */
export type ScreenId = 'victory' | 'research' | 'policy' | 'era' | 'legends' | 'leader' | 'diplomacy' | 'world' | 'log' | 'menu';

/** Opens a launcher screen like a player would; a different open screen is closed first. */
export async function openScreen(page: Page, id: ScreenId): Promise<void> {
  const target = page.locator(`#screen-${id}`);
  if (await target.isVisible()) return;
  await closeScreen(page);
  await page.locator(`[data-open-screen="${id}"]`).click();
  await expect(target).toBeVisible();
}

/** Returns to the map. */
export async function closeScreen(page: Page): Promise<void> {
  const open = page.locator('.screen:not([hidden]) .screen-close');
  if (await open.count()) { await open.click(); await expect(page.locator('#screen-host')).toBeHidden(); }
}

/** Opens the game menu's developer drawer (god view, replay, debug output). */
export async function openDevDrawer(page: Page): Promise<void> {
  await openScreen(page, 'menu');
  const drawer = page.locator('#dev-drawer');
  if (await drawer.getAttribute('open') === null) await drawer.locator('summary').click();
}

/** Starts a new game from the menu with the current setup controls. */
export async function startNewGame(page: Page): Promise<void> {
  await openScreen(page, 'menu');
  await page.locator('#new-game').click();
}
