import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROSTER_CONTENT } from '../../src/content/units.ts';
import { rosterFixture } from './fixtures/roster.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'roster.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

test('v14: an Eevee lists all five evolution directions, each with what it still needs', async ({ page }) => {
  const fixture = rosterFixture('eevee');
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const main = page.locator('#evolve-unit'), branches = page.locator('#evolution-branches [data-evolve]');
  // The main direction is the action bar's 进化 button; its full label is the accessible name (and hover card title).
  await expect(main).toHaveAttribute('aria-label', /^进化→(太阳伊布|月亮伊布|叶伊布|冰伊布|仙子伊布)$/);
  await expect(branches).toHaveCount(4);
  const targets = [await main.getAttribute('aria-label'), ...await branches.allTextContents()].map(text => text!.replace(/^进化→/, '').replace(/（.*$/, ''));
  expect(new Set(targets)).toEqual(new Set(['太阳伊布', '月亮伊布', '叶伊布', '冰伊布', '仙子伊布']));
  // Not enough EXP yet (250 needed): nothing can evolve, and the panel says so.
  const unit = fixture.state.units[fixture.unitId];
  expect(unit.xp).toBeLessThan(250);
  await expect(main).toBeDisabled();
  for (const button of await branches.all()) await expect(button).toBeDisabled();
  await page.screenshot({ path: `${reports}/roster-eevee-1280.png` });
});

test('v14: a later-generation Pokémon uses its own sprite set and keeps its aspect ratio', async ({ page }) => {
  const fixture = rosterFixture('late-generation');
  const unit = fixture.state.units[fixture.unitId];
  if (unit.kind !== 'pokemon') throw new Error('expected a Pokémon');
  const dex = ROSTER_CONTENT.species[unit.speciesId].dex!;
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const portrait = page.locator('.unit-portrait img');
  await expect(portrait).toHaveAttribute('src', new RegExp(`/sprites/gen[6-9]/${dex}\\.png$`));
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await portrait.evaluate(image => getComputedStyle(image).objectFit)).toBe('contain');
  await page.screenshot({ path: `${reports}/roster-late-generation-1280.png` });
});
