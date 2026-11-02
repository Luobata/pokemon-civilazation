import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';

async function state(page: import('@playwright/test').Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}
async function selectStarter(page: import('@playwright/test').Page) {
  const select = page.locator('#selection-panel select').nth(1);
  const labels = await select.locator('option').allInnerTexts();
  await select.selectOption({ index: labels.findIndex(label => label.includes('妙蛙种子')) });
}

test('new games use gameplay v2: tile improvements, discoveries and field tactics are playable', async ({ page }) => {
  await page.goto('/');
  expect((await state(page)).setup).toMatchObject({ eraProgression: 'simple-v1', gameplayVersion: 5 });
  await selectStarter(page);
  await expect(page.locator('#zoc-note')).toContainText('夹击');
  const farm = page.locator('[data-improve$=":berryFarm"]').first();
  await expect(farm).toContainText('树果田');
  await expect(farm).toContainText('+2');
  const tile = Number((await farm.getAttribute('data-improve'))!.split(':')[0]);
  await farm.click();
  await expect(page.locator('#improvement-box')).toContainText('本回合行动点已用完');
  expect((await state(page)).expansion!.improvements!.projects[tile]).toMatchObject({ kind: 'berryFarm', progress: 2, playerId: 0 });
  await page.locator('#end-turn').click();
  await expect(page.locator('#round-display')).toContainText('2');
  await selectStarter(page);
  await page.locator(`[data-improve="${tile}:berryFarm"]`).click();
  expect((await state(page)).expansion!.improvements!.tiles[tile]).toMatchObject({ kind: 'berryFarm', builtBy: 0 });
  await expect(page.locator('#activity-list')).toContainText('建成树果田');
  await expect(page.locator('#activity-list')).toContainText('图鉴发现「树果丰收」');
  await page.locator('#discoveries summary').click();
  await expect(page.locator('#discoveries')).toContainText('图鉴发现 1/12');
  await expect(page.locator('#research-topic')).toContainText('树果培育 8/20 ★');
});

test('gameplay v3: charters, policy cards and end-turn reminders work in the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#turn-reminders')).toContainText('选择研究');
  await expect(page.locator('#turn-reminders')).toContainText('选择规章');
  await page.locator('[data-reminder="unit"]').click();
  await expect(page.locator('#selection')).toContainText('行动点 1');
  await page.locator('[data-charter="gymCode"]').click();
  await expect(page.locator('#policy-panel')).toContainText('正在制定「道馆守则」');
  await expect(page.locator('#turn-reminders')).not.toContainText('选择规章');
  for (let turn = 0; turn < 40 && !(await state(page)).expansion!.policies![0].adopted.includes('gymCode'); turn++) {
    await page.locator('#end-turn').click();
    await expect(page.locator('#end-turn')).toBeEnabled();
  }
  await expect(page.locator('#activity-list')).toContainText('确立规章「道馆守则」');
  await expect(page.locator('#policy-cards')).toBeVisible();
  if (!(await page.locator('#policy-cards').evaluate(element => (element as HTMLDetailsElement).open))) await page.locator('#policy-cards summary').click();
  await page.locator('[data-policy="researchGrant"]').check();
  await expect(page.locator('[data-policy="harvestFestival"]')).toBeDisabled();
  await page.locator('[data-policy="gymChallenge"]').check();
  await expect(page.locator('#apply-policies')).toBeEnabled();
  await page.locator('#apply-policies').click();
  expect((await state(page)).expansion!.policies![0].slotted).toEqual(['gymChallenge', 'researchGrant']);
  await expect(page.locator('#policy-cards')).toContainText('更换需 30 金币');
  await expect(page.locator('#activity-list')).toContainText('方针更新');
});

test('gameplay v5: era ability panel lists generation unlocks and the unit panel explains locked abilities', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#era-panel .era-abilities')).toContainText('金银 · 昼夜与亲密度');
  await expect(page.locator('#era-panel .era-abilities')).toContainText('宝石 · 天气');
  await expect(page.locator('#era-panel .era-abilities')).not.toContainText('Mega');
  await page.locator('#era-progression').selectOption('full-v1');
  await page.locator('#new-game').click();
  await expect(page.locator('#era-panel .era-abilities')).toContainText('朱紫 · 太晶化');
  await page.locator('[data-reminder="unit"]').click();
  await page.locator('[data-reminder="unit"]').click();
  await expect(page.locator('#era-ability-box')).toContainText('进入金银时代后解锁昼夜');
});
