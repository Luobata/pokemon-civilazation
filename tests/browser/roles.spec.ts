import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROLE_POKEMON } from '../../src/content/roles.ts';
import { builderFixture } from './fixtures/roles.ts';
import type { GameState } from '../../src/core/model.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'roles.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

test('the starting settler is drawn and described as 肯泰罗', async ({ page }) => {
  await page.goto('/?seed=12345');
  const game = await state(page);
  const settler = Object.values(game.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  await page.locator('#unit-select').selectOption(String(settler.id));
  await expect(page.locator('.settler-card strong').first()).toHaveText(`开拓队 · ${ROLE_POKEMON.settler.species}`);
  await expect(page.locator('.settler-card .unit-portrait img')).toHaveAttribute('src', ROLE_POKEMON.settler.sprite);
});

test('v18: a 工匠 (搬运小匠) builds an improvement in one action and spends a charge', async ({ page }) => {
  const fixture = builderFixture(), before = fixture.state.units[fixture.builderId].charges!;
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.builderId));
  const card = page.locator('.builder-card');
  await expect(card.locator('strong').first()).toHaveText(`工匠 · ${ROLE_POKEMON.builder.species}`);
  await expect(card).toContainText(`剩余 ${before} 次`);
  await page.screenshot({ path: `${reports}/roles-builder-1280.png` });
  const button = card.locator('[data-improve]').first(), tile = Number((await button.getAttribute('data-improve'))!.split(':')[0]);
  await button.click();
  await expect.poll(async () => (await state(page)).expansion!.improvements!.tiles[tile]?.builtBy).toBe(0);
  const after = (await state(page)).units[fixture.builderId];
  expect(after ? after.charges : 0).toBe(before - 1);
});

test('the handbook lists the three role Pokémon with their sprites', async ({ page }) => {
  await page.goto('/guide.html#roles');
  const table = page.locator('#roles table');
  for (const role of Object.values(ROLE_POKEMON)) await expect(table).toContainText(role.species);
  for (const image of await table.locator('img').all()) await expect.poll(() => image.evaluate(img => { (img as HTMLImageElement).loading = 'eager'; return (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0; })).toBe(true);
});
