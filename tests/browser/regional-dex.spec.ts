import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openScreen, startNewGame } from './ui.ts';
import { contentFor } from '../../src/content/units.ts';
import type { GameState } from '../../src/core/model.ts';

// v25 regional Pokédex (docs/design/roster-v25.md §2.8): new-game summary, the class × stage Pokédex page with silhouettes, recruit rows.
const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });

test('v25: the new-game summary, the regional Pokédex page and the recruit rows show the same public list', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=31&gameplay=25&size=24x16');
  await openScreen(page, 'menu');
  const summary = page.locator('#regional-dex-summary');
  await expect(summary).toBeVisible();
  await expect(summary.locator('.dex-summary-line')).toHaveAttribute('aria-label', /^地区图鉴：\d+ 种 · 水面 \d+ 线 · 飞行 \d+ 种$/);
  // Icons first, each with an accessible name.
  for (const icon of await summary.locator('img').all()) expect((await icon.getAttribute('alt')) || (await icon.getAttribute('aria-hidden'))).toBeTruthy();
  await summary.locator('details > summary').click();
  const listed = await summary.locator('.dex-strip img').count();
  await page.screenshot({ path: `${reports}/regional-dex-new-game.png` });

  await startNewGame(page);
  const game = await state(page), content = contentFor(game.setup);
  expect(game.rulesVersion).toBe('roster-v25');
  expect(listed).toBe(content.regionalDex!.size);

  await openScreen(page, 'world');
  const card = page.locator('#expansion-panel details[data-system="s22-pokedex"]');
  await card.locator('> summary').click();
  const grid = card.locator('#regional-dex');
  await expect(grid).toBeVisible();
  await expect(card.locator('#regional-dex-stats')).toContainText(String(game.expansion!.world.victory.targetDocumentedSpecies));
  await expect(grid.locator('.dex-entry')).toHaveCount(content.regionalDex!.size);
  // Not seen yet → silhouette, still named, with how to get it in the hover card.
  const silhouette = grid.locator('.dex-entry.dex-silhouette').first();
  await expect(silhouette).toHaveAttribute('title', /未见过 · (野外|招募|巢穴|进化自|仅通过对战记录)/);
  await expect(silhouette.locator('img')).toHaveAttribute('alt', /未见过/);
  // The starter is seen from the start.
  const starter = grid.locator(`.dex-entry[data-species="${game.players[0].starterId}"]`);
  await expect(starter).not.toHaveClass(/dex-silhouette/);
  // Playtest B6: the starter reads as owned (拥有), not caught, in the regional grid too; the record stays captured.
  await expect(starter).toHaveAttribute('title', /拥有（初始伙伴）/);
  await expect(starter.locator('img').first()).not.toHaveAttribute('alt', /已捕捉/);
  expect(game.expansion!.world.players[0].pokedex[game.players[0].starterId]!.captured).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${reports}/regional-dex-pokedex.png` });

  // Research tree: the recruit rows name the regional species and its slot (or the empty slot).
  await openScreen(page, 'research');
  const regionalRows = page.locator('#screen-research').locator('[title*="本地区"], [aria-label*="本地区"], li:has-text("本地区")');
  await expect.poll(() => regionalRows.count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('v24 keeps the old Pokédex strip and shows no regional summary', async ({ page }) => {
  await page.goto('/?seed=31&gameplay=24&size=24x16');
  await openScreen(page, 'menu');
  await expect(page.locator('#regional-dex-summary')).toBeHidden();
  await startNewGame(page);
  await openScreen(page, 'world');
  const card = page.locator('#expansion-panel details[data-system="s22-pokedex"]');
  await card.locator('> summary').click();
  await expect(card.locator('#regional-dex')).toHaveCount(0);
  await expect(card.locator('.dex-strip')).toBeVisible();
});
