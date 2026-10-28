import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { combatSave } from './fixtures/combat.ts';
import type { GameState } from '../../src/core/model.ts';
import type { Hex } from '../../src/core/hex.ts';
import { CONTENT, unitDefinition } from '../../src/content/units.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts';
    return (await import(mainPath)).developerAdapter.getState();
  });
}
async function clickHex(page: Page, hex: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath);
    const p = toScreen(hexToWorld(hex), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, hex);
  await page.mouse.click(point.x, point.y);
}
async function importFixture(page: Page, wildHp = 20, ensureCaptureSuccess = false) {
  await page.goto('/?seed=12345');
  await page.locator('#import-save').setInputFiles({ name: 'combat.json', mimeType: 'application/json', buffer: Buffer.from(combatSave(wildHp, ensureCaptureSuccess)) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await clickHex(page, { q: 2, r: 12 });
  await expect(page.locator('#selection')).toContainText('行动点 1');
}

test('attack a wild unit with a real preview and visible damage resolution', async ({ page }) => {
  await importFixture(page);
  await page.locator('#attack-unit').click();
  await clickHex(page, { q: 3, r: 12 });
  await expect(page.locator('#battle-preview')).toContainText('预计伤害');
  await expect(page.locator('#battle-preview')).toContainText('反击');
  await expect(page.locator('#battle-preview')).toContainText('击坠');
  await page.screenshot({ path: `${reports}/m3ui-attack.png`, fullPage: true });
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('攻击结算');
  const resolved = await state(page);
  expect(resolved.units[9].actionLeft).toBe(0);
  expect(resolved.units[13].hp).toBeLessThan(20);
});

test('capture a low-health wild pokemon with probability and success feedback', async ({ page }) => {
  await importFixture(page, 1, true);
  await page.locator('#capture-unit').click();
  await clickHex(page, { q: 3, r: 12 });
  await expect(page.locator('#capture-preview')).toContainText('捕捉成功率');
  await page.screenshot({ path: `${reports}/m3ui-capture.png`, fullPage: true });
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('捕捉成功');
  expect((await state(page)).units[13].ownerId).toBe(0);
});

test('failed capture leaves the wild pokemon unowned and enraged', async ({ page }) => {
  await importFixture(page, 1, false);
  await page.locator('#capture-unit').click();
  await clickHex(page, { q: 3, r: 12 });
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('捕捉失败');
  expect((await state(page)).units[13]).toMatchObject({ ownerId: null, enraged: true });
});

test('evolve an eligible unit and show the resulting species and reset XP', async ({ page }) => {
  await importFixture(page);
  await page.locator('#evolve-unit').click();
  await expect(page.locator('#action-notice')).toContainText('进化完成：妙蛙草');
  const evolved = await state(page);
  expect(evolved.units[9]).toMatchObject({ speciesId: 'ivysaur', xp: 0 });
  await page.screenshot({ path: `${reports}/m3ui-evolve.png`, fullPage: true });
});

test('unit card stays outside the map and recovering units appear in the city panel', async ({ page }) => {
  await importFixture(page);
  const map = (await page.locator('.map-card').boundingBox())!;
  const card = (await page.locator('#unit-panel').boundingBox())!;
  expect(card.y).toBeGreaterThanOrEqual(map.y + map.height);
  await expect(page.locator('#recovering-units')).toContainText('剩余 3 轮');
  await expect(page.locator('#recovering-units')).toContainText('喵喵');
  const current = await state(page);
  const upkeep = Object.values(current.units).filter(unit => unit.ownerId === 0)
    .reduce((sum, unit) => sum + unitDefinition(unit, CONTENT).upkeep, 0);
  await expect(page.locator('#hud-upkeep')).toContainText(`−${upkeep}`);
  await page.screenshot({ path: `${reports}/m3ui-map.png`, fullPage: true });
});

test('battle activity uses civilization and species labels without revealing unknown combatants', async ({ page }) => {
  await importFixture(page);
  const labels = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts';
    const { battleActivityText, session } = await import(mainPath);
    const view = session.getView();
    const base = { type: 'BattleResolved' as const, attackerId: 9, target: { kind: 'unit' as const, id: 13 },
      positions: [{ q: 2, r: 12 }, { q: 3, r: 12 }], damage: 7, counterDamage: 3,
      capturedCity: false, knockedDownUnitIds: [] };
    return {
      visible: battleActivityText(base, view),
      unknownAttacker: battleActivityText({ ...base, attackerId: 999 }, view),
      unknownTarget: battleActivityText({ ...base, target: { kind: 'unit', id: 999 } }, view),
    };
  });
  expect(labels.visible).toBe('文明 1 的 妙蛙种子 攻击了 野生 凯西：7 伤害，反击 3');
  expect(labels.unknownAttacker).toBe('未知单位 攻击了 野生 凯西：7 伤害，反击 3');
  expect(labels.unknownTarget).toBe('文明 1 的 妙蛙种子 攻击了 未知单位：7 伤害，反击 3');
  expect(labels.unknownAttacker).not.toContain('妙蛙种子');
  expect(labels.unknownTarget).not.toContain('凯西');
});
