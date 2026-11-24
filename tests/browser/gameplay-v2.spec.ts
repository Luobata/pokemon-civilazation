import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import { openScreen, closeScreen, startNewGame } from './ui.ts';

async function state(page: import('@playwright/test').Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}

test('charters, policy cards and end-turn reminders work in the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#turn-reminders')).toContainText('选择研究');
  await expect(page.locator('#turn-reminders')).toContainText('选择规章');
  await page.locator('[data-reminder="unit"]').click();
  await expect(page.locator('#selection')).toContainText('行动点 1');
  await openScreen(page, 'policy');
  await page.locator('[data-charter="gymCode"]').click();
  await expect(page.locator('#policy-panel')).toContainText('正在制定「道馆守则」');
  await expect(page.locator('#turn-reminders')).not.toContainText('选择规章');
  for (let turn = 0; turn < 40 && !(await state(page)).expansion!.policies![0].adopted.includes('gymCode'); turn++) {
    await closeScreen(page);
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#end-turn')).toBeEnabled();
  }
  await expect(page.locator('#activity-list')).toContainText('确立规章「道馆守则」');
  await openScreen(page, 'policy');
  await expect(page.locator('#policy-cards')).toBeVisible();
  if (!(await page.locator('#policy-cards').evaluate(element => (element as HTMLDetailsElement).open))) await page.locator('#policy-cards summary').click();
  await openScreen(page, 'policy');
  await page.locator('[data-policy="researchGrant"]').check();
  await expect(page.locator('[data-policy="harvestFestival"]')).toBeDisabled();
  await openScreen(page, 'policy');
  await page.locator('[data-policy="gymChallenge"]').check();
  await expect(page.locator('#apply-policies')).toBeEnabled();
  await openScreen(page, 'policy');
  await page.locator('#apply-policies').click();
  expect((await state(page)).expansion!.policies![0].slotted).toEqual(['gymChallenge', 'researchGrant']);
  await expect(page.locator('#policy-cards')).toContainText('更换需 30 金币');
  await expect(page.locator('#activity-list')).toContainText('方针更新');
});

test('era ability panel lists generation unlocks and the unit panel explains locked abilities', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#era-panel .era-abilities')).toContainText('金银 · 昼夜与亲密度');
  await expect(page.locator('#era-panel .era-abilities')).toContainText('宝石 · 天气');
  await expect(page.locator('#era-panel .era-abilities')).not.toContainText('Mega');
  await openScreen(page, 'menu');
  await page.locator('#era-progression').selectOption('full-v1');
  await startNewGame(page);
  await expect(page.locator('#era-panel .era-abilities')).toContainText('朱紫 · 太晶化');
  await page.locator('[data-reminder="unit"]').click();
  await page.locator('[data-reminder="unit"]').click();
  await expect(page.locator('#era-ability-box')).toContainText('进入金银世代后解锁昼夜');
});
