import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { escortedBuilderFixture, pillageFixture } from './fixtures/improvements-v23.ts';
import { CREW_SPECIALTIES, IMPROVEMENTS, crewSpecialtyFor } from '../../src/content/improvements.ts';
import { IMPROVEMENT_CONTENT } from '../../src/content/units.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameState } from '../../src/core/model.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=23');
  await page.locator('#import-save').setInputFiles({ name: 'v23.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

test('v23: a builder trained with an escort shows its crew specialty and a repair action in the bar', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = escortedBuilderFixture(), builder = fixture.state.units[fixture.unitId] as { escortId: string };
  const crew = CREW_SPECIALTIES[crewSpecialtyFor(IMPROVEMENT_CONTENT.species[builder.escortId].typeId)];
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await expect(page.locator('#crew-note')).toContainText(`特长「${crew.name}」`);
  await expect(page.locator('#unit-action-bar #repair-unit')).toBeVisible();
  await expect(page.locator('#unit-action-bar #repair-unit')).toBeDisabled();
  await page.screenshot({ path: `${reports}/improvements-v23-builder.png` });
  expect(errors).toEqual([]);
});

test('v23: at war, a Pokémon on an enemy improvement pillages it with the bar (P); the tile reads as damaged', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = pillageFixture(), unit = fixture.state.units[fixture.unitId] as { position: { q: number; r: number } };
  const tileIndex = hexToIndex(unit.position, fixture.state.map)!, kind = fixture.state.expansion!.improvements!.tiles[tileIndex].kind;
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const button = page.locator('#unit-action-bar #pillage-unit');
  await expect(button).toBeEnabled();
  await expect(page.locator('#pillage-unit-tip')).toContainText(`掠夺${IMPROVEMENTS[kind].name}`);
  await page.screenshot({ path: `${reports}/improvements-v23-pillage.png` });
  await page.locator('#map').focus();
  await page.keyboard.press('p');
  await expect.poll(async () => (await state(page)).expansion!.improvements!.tiles[tileIndex].damaged).toBe(true);
  await page.screenshot({ path: `${reports}/improvements-v23-damaged.png` });
  expect(errors).toEqual([]);
});
