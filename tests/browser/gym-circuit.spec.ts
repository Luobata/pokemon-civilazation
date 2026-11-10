import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gymFixture } from './fixtures/world-v24.ts';
import { GYM_LEADERS } from '../../src/content/gym-circuit.ts';
import { gymAt } from '../../src/core/gym-circuit.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameState, MapUnit } from '../../src/core/model.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'v24.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

test('v24: a Pokémon on a gym opens the challenge card from the bar (G), confirms, and the badge box counts the badge', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = gymFixture(), unit = fixture.state.units[fixture.id] as MapUnit;
  const gym = gymAt(fixture.state.expansion!.gymCircuit, hexToIndex(unit.position, fixture.state.map)!)!;
  const before = fixture.state.expansion!.gymCircuit!.badges[0].length;
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.id));
  const button = page.locator('#unit-action-bar #gym-unit');
  await expect(button).toBeEnabled();
  await expect(page.locator('#gym-unit-tip')).toContainText(GYM_LEADERS[gym.leader].name);
  await page.locator('#map').focus();
  await page.keyboard.press('g');
  const card = page.locator('#gym-card');
  await expect(card).toBeVisible();
  await expect(card.locator('#gym-card-leader')).not.toBeEmpty();
  await expect(card.locator('#gym-card-team')).not.toBeEmpty();
  await page.screenshot({ path: `${reports}/gym-circuit-card.png` });
  // Esc closes the card without a command; the real click confirms.
  const seq = (await state(page)).commandSeq;
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  expect((await state(page)).commandSeq).toBe(seq);
  await button.click();
  await expect(card).toBeVisible();
  await card.locator('#gym-card-challenge').click();
  await expect.poll(async () => (await state(page)).expansion!.gymCircuit!.challengedAt[0]?.[gym.id]).toBe(fixture.state.round);
  const after = await state(page), won = after.expansion!.gymCircuit!.badges[0].length;
  expect(won === before + 1 || won === before).toBe(true);
  await expect(page.locator('#badge-box .badge-slot.won')).toHaveCount(won);
  await page.screenshot({ path: `${reports}/gym-circuit-badges.png` });
  expect(errors).toEqual([]);
});
