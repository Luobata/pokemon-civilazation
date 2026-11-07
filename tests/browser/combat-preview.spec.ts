import { mkdirSync, copyFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { strengthFixture } from './fixtures/strength.ts';
import { combatFixture } from './fixtures/combat.ts';
import { verifyImportedReplay } from './fixtures/reachable.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'combat-preview.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function clickUnit(page: Page, unitId: number) {
  const point = await page.evaluate(async id => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath);
    const unit = session.getView().units.find((item: { id: number }) => item.id === id);
    const screen = toScreen(hexToWorld(unit.position), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, unitId);
  await page.mouse.click(point.x, point.y);
}
type Preview = { ok: boolean; damage: { min: number; max: number }; counter: { trigger: string; damage: number };
  strength?: { gap: number; immune: boolean; logistics: boolean; factors: { side: string; label: string; value: number }[] } };
async function preview(page: Page, unitId: number, targetId: number): Promise<Preview> {
  return page.evaluate(async ({ unitId, targetId }) => {
    const mainPath = '/src/browser/main.ts', previewPath = '/src/core/preview.ts';
    const { session } = await import(mainPath), { previewAttack } = await import(previewPath);
    return previewAttack(session.getView(), unitId, { kind: 'unit', id: targetId });
  }, { unitId, targetId });
}
async function targetHp(page: Page, id: number): Promise<number | null> {
  return page.evaluate(async id => {
    const mainPath = '/src/browser/main.ts';
    const unit = (await import(mainPath)).developerAdapter.getState().units[id];
    return unit && 'hp' in unit ? unit.hp : null;
  }, id);
}
async function expectInsideMap(page: Page) {
  const card = (await page.locator('#combat-card').boundingBox())!, map = (await page.locator('#map').boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(map.x);
  expect(card.y).toBeGreaterThanOrEqual(map.y);
  expect(card.x + card.width).toBeLessThanOrEqual(map.x + map.width + 1);
  expect(card.y + card.height).toBeLessThanOrEqual(map.y + map.height + 1);
  const turn = await page.locator('.turn-block').boundingBox();
  if (turn) expect(card.x + card.width <= turn.x || card.y + card.height <= turn.y || card.x >= turn.x + turn.width || card.y >= turn.y + turn.height).toBe(true);
}

test('P0-4: the floating combat card shows strength, bonuses and HP after the hit; a second click attacks', async ({ page }) => {
  const fixture = strengthFixture(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await page.locator('#fit').click();
  await page.locator('#attack-unit').click();
  const card = page.locator('#combat-card');
  await expect(card).toBeHidden();
  await clickUnit(page, fixture.targetId);
  await expect(card).toBeVisible();
  await expectInsideMap(page);

  const expected = await preview(page, fixture.unitId, fixture.targetId);
  expect(expected.ok).toBe(true);
  expect(expected.strength).toBeDefined();
  const damage = card.locator('#combat-card-damage');
  await expect(damage).toHaveAttribute('data-min', String(expected.damage.min));
  await expect(damage).toHaveAttribute('data-max', String(expected.damage.max));
  await expect(damage).toContainText(`${expected.damage.min}–${expected.damage.max}`);
  // Every labelled factor of the preview appears on its side of the card.
  for (const side of ['attack', 'defense'] as const) {
    const factors = expected.strength!.factors.filter(factor => factor.side === side);
    const items = card.locator(`[data-side="${side}"] .cp-factors li`);
    await expect(items).toHaveCount(factors.length);
    for (const [index, factor] of factors.entries()) await expect(items.nth(index)).toContainText(factor.label);
  }
  if (!expected.strength!.immune && !expected.strength!.logistics) {
    const gap = expected.strength!.gap;
    await expect(card.locator('#combat-card-gap')).toHaveText(`${gap > 0 ? '+' : gap < 0 ? '−' : '±'}${Math.abs(gap)}`);
  }
  const hpBefore = (await targetHp(page, fixture.targetId))!;
  const target = card.locator('#combat-card-target');
  await expect(target).toHaveAttribute('data-hp-after-min', String(Math.max(0, hpBefore - expected.damage.max)));
  await expect(target).toHaveAttribute('data-hp-after-max', String(Math.max(0, hpBefore - expected.damage.min)));
  if (expected.counter.trigger === 'never') await expect(card.locator('#combat-card-counter')).toContainText('无反击');
  else await expect(card.locator('#combat-card-counter [data-counter]')).toHaveAttribute('data-counter', String(expected.counter.damage));
  await expect(card.locator('#combat-card-attack')).toBeEnabled();
  // The drawer keeps its older preview for compatibility.
  await expect(page.locator('#battle-preview')).toContainText(`预计伤害 ${expected.damage.min}–${expected.damage.max}`);
  await page.screenshot({ path: `${reports}/combat-preview.png` });
  mkdirSync('/tmp/ui-p0', { recursive: true });
  copyFileSync(`${reports}/combat-preview.png`, '/tmp/ui-p0/combat-preview.png');

  // Esc cancels the target (the card closes) but stays in attack mode.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('#attack-unit')).toHaveClass(/selected/);
  // Choose the target again, then click it a second time: that is the attack.
  await clickUnit(page, fixture.targetId);
  await expect(card).toBeVisible();
  await clickUnit(page, fixture.targetId);
  await expect(page.locator('#action-notice')).toContainText('攻击结算');
  await expect(card).toBeHidden();
  const hpAfter = await targetHp(page, fixture.targetId);
  expect(hpAfter === null || hpAfter < hpBefore).toBe(true);
  // Exactly the command the drawer's 确认攻击 button sends.
  const commands = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts';
    return (await import(mainPath)).developerAdapter.exportLog().commands as { action: unknown }[];
  });
  expect(commands.at(-1)!.action).toEqual({ type: 'Attack', unitId: fixture.unitId, target: { kind: 'unit', id: fixture.targetId } });
  expect(errors).toEqual([]);
});

test('P0-4: the card button attacks too; pre-v20 games show only the damage range and counter', async ({ page }) => {
  const fixture = combatFixture('attack');
  const action = fixture.action;
  if (action?.type !== 'Attack' || action.target.kind !== 'unit') throw new Error('Expected a unit attack');
  await importSave(page, fixture.save);
  await verifyImportedReplay(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(action.unitId));
  await page.locator('#fit').click();
  await page.locator('#attack-unit').click();
  await clickUnit(page, action.target.id);
  const card = page.locator('#combat-card');
  await expect(card).toBeVisible();
  await expectInsideMap(page);
  const expected = await preview(page, action.unitId, action.target.id);
  await expect(card.locator('#combat-card-damage')).toHaveAttribute('data-max', String(expected.damage.max));
  if (!expected.strength) {
    await expect(card.locator('.cp-factors')).toHaveCount(0);
    await expect(card.locator('.cp-centre')).toContainText(`${expected.damage.min}–${expected.damage.max}`);
  }
  await expect(card.locator('#combat-card-counter')).toContainText(expected.counter.trigger === 'never' ? '无反击' : `−${expected.counter.damage}`);
  // Clicking elsewhere on the map (here: off the board, which also clears the selection) cancels.
  const map = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(map.x + 4, map.y + 200);
  await expect(card).toBeHidden();
  await page.locator('#unit-select').selectOption(String(action.unitId));
  await page.locator('#attack-unit').click();
  await clickUnit(page, action.target.id);
  await card.locator('#combat-card-attack').click();
  await expect(page.locator('#action-notice')).toContainText('攻击结算');
});
