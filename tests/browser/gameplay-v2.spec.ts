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
  expect((await state(page)).setup).toMatchObject({ eraProgression: 'simple-v1', gameplayVersion: 2 });
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
