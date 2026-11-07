import { expect, test } from '@playwright/test';
import { dedicationFixture } from './fixtures/dedications.ts';
import { DEDICATION_IDS, DEDICATIONS } from '../../src/content/dedications.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

test('v22: entering an era, the end-turn button asks for a dedication, the era screen shows the cards, and picking confirms', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = dedicationFixture(), honor = fixture.state.expansion!.eraHonors!.players[0];
  await page.goto('/?seed=1&gameplay=22');
  await page.locator('#import-save').setInputFiles({ name: 'dedication.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');

  const endTurn = page.locator('#end-turn');
  await expect(endTurn).toHaveText('选择时代献礼 ›');
  await expect(endTurn).toHaveAttribute('data-state', 'dedication');
  await expect(page.locator('[data-reminder="#era-panel"]')).toHaveText('选择时代献礼');
  await endTurn.click();
  await expect(page.locator('#screen-era')).toBeVisible();

  const section = page.locator('.dedications.pending');
  await expect(section).toBeVisible();
  await expect(section.locator('button.dedication-card')).toHaveCount(DEDICATION_IDS.length);
  await expect(section.locator('.dedication-head')).toContainText(honor.age === 'golden' ? '黄金世代' : '本世代按它的承诺额外得世代分');
  const confirm = section.locator('#confirm-dedication');
  await expect(confirm).toBeDisabled();
  // One card to pick: a click on another card moves the mark.
  await section.locator('[data-dedication="ballMaster"]').click();
  await expect(section.locator('[data-dedication="ballMaster"]')).toHaveAttribute('aria-pressed', 'true');
  await section.locator('[data-dedication="professorNotes"]').click();
  await expect(section.locator('[data-dedication="ballMaster"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(section.locator('[data-dedication="professorNotes"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(section.locator('.dedication-actions')).toContainText('已选 1 / 1');
  await expect(confirm).toBeEnabled();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${reports}/dedications.png` });
  await confirm.click();

  const chosen = page.locator('.dedications:not(.pending)');
  await expect(chosen).toContainText('本世代献礼');
  await expect(chosen.locator('[data-dedication="professorNotes"]')).toContainText(DEDICATIONS.professorNotes.name);
  await expect(chosen).toContainText(honor.age === 'golden' ? '黄金效果生效中' : '承诺进度 +0 世代分');
  await expect(page.locator('[data-reminder="#era-panel"]')).toHaveCount(0);
  await expect(endTurn).not.toHaveText('选择时代献礼 ›');
  await chosen.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${reports}/dedications-chosen.png` });
  expect(errors).toEqual([]);
});
