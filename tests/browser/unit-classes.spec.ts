import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import { CLASS_NAMES } from '../../src/content/unit-classes.ts';
import { openScreen } from './ui.ts';

const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });

test('v19: the unit panel names the class, its counters and affinity; training is grouped by class; research shows HMs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=12345');
  const game = await state(page);
  expect(game.setup.gameplayVersion).toBeGreaterThanOrEqual(19);
  const starter = Object.values(game.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  await page.locator('#unit-select').selectOption(String(starter.id));
  await expect(page.locator('#class-note')).toContainText('兵种「远程」');
  await expect(page.locator('#class-note')).toContainText('克制飞行、水面');
  await page.locator('#city-select').selectOption(String(game.players[0].headquartersCityId));
  await page.locator('[data-production-kind="pokemon"]').click();
  await expect(page.locator('#production-item option').first()).toContainText(`【${CLASS_NAMES.ranged}】`);
  await openScreen(page, 'research');
  await expect(page.locator('[data-tech-card="meteorology"]')).toContainText('学会秘传「飞翔」');
  expect(errors).toEqual([]);
});

test('the handbook explains classes with a generated class table', async ({ page }) => {
  await page.goto('/guide.html#classes');
  const table = page.locator('#classes table');
  for (const name of Object.values(CLASS_NAMES)) await expect(table).toContainText(name);
  await expect(table).toContainText('秘传「飞翔」');
  await expect(page.locator('#classes')).toContainText('属性管“克谁”，兵种管“怎么打”');
});
