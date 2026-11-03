import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { combatFixture } from './fixtures/combat.ts';
import type { CombatScenario } from './fixtures/combat.ts';
import { verifyImportedReplay } from './fixtures/reachable.ts';
import { isMapUnit } from '../../src/core/model.ts';
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
async function importFixture(page: Page, scenario: CombatScenario = 'attack') {
  const fixture = combatFixture(scenario);
  await page.goto('/?seed=12345');
  await page.locator('#import-save').setInputFiles({ name: 'combat.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await verifyImportedReplay(page, fixture.save);
  const unitId = fixture.action && 'unitId' in fixture.action ? fixture.action.unitId : fixture.unitId!;
  const unit = fixture.state.units[unitId];
  if (!isMapUnit(unit)) throw new Error('Expected a deployed fixture actor');
  await page.locator('#fit').click();
  await clickHex(page, unit.position);
  await expect(page.locator('#selection')).toContainText('行动点 1');
  return { ...fixture, unitId };
}

test('attack a wild unit with a real preview and visible damage resolution', async ({ page }) => {
  const fixture = await importFixture(page);
  const action = fixture.action;
  if (action?.type !== 'Attack' || action.target.kind !== 'unit') throw new Error('Expected wild attack');
  const target = fixture.state.units[action.target.id];
  if (!isMapUnit(target)) throw new Error('Expected deployed target');
  await page.locator('#attack-unit').click();
  await clickHex(page, target.position);
  await expect(page.locator('#battle-preview')).toContainText('预计伤害');
  await expect(page.locator('#battle-preview')).toContainText('反击');
  await expect(page.locator('#battle-preview')).toContainText('击坠');
  await page.screenshot({ path: `${reports}/m3ui-attack.png`, fullPage: true });
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('攻击结算');
  const resolved = await state(page);
  expect(resolved.units[fixture.unitId].actionLeft).toBe(0);
  expect(resolved.units[target.id].hp).toBeLessThan(target.hp);
});

test('capture a low-health wild pokemon with probability and success feedback', async ({ page }) => {
  const fixture = await importFixture(page, 'capture-success');
  const action = fixture.action;
  if (action?.type !== 'Capture') throw new Error('Expected capture');
  const target = fixture.state.units[action.targetUnitId];
  if (!isMapUnit(target)) throw new Error('Expected deployed target');
  await page.locator('#capture-unit').click();
  await clickHex(page, target.position);
  await expect(page.locator('#capture-preview')).toContainText('捕捉成功率');
  await page.screenshot({ path: `${reports}/m3ui-capture.png`, fullPage: true });
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('捕捉成功');
  expect((await state(page)).units[target.id].ownerId).toBe(0);
});

test('failed capture leaves the wild pokemon unowned and enraged', async ({ page }) => {
  const fixture = await importFixture(page, 'capture-failure');
  const action = fixture.action;
  if (action?.type !== 'Capture') throw new Error('Expected capture');
  const target = fixture.state.units[action.targetUnitId];
  if (!isMapUnit(target)) throw new Error('Expected deployed target');
  await page.locator('#capture-unit').click();
  await clickHex(page, target.position);
  await page.locator('#confirm-action').click();
  await expect(page.locator('#action-notice')).toContainText('捕捉失败');
  expect((await state(page)).units[target.id]).toMatchObject({ ownerId: null, enraged: true });
});

test('evolve an eligible unit and show the resulting species and reset XP', async ({ page }) => {
  const fixture = await importFixture(page, 'evolve');
  const action = fixture.action;
  if (action?.type !== 'Evolve') throw new Error('Expected evolution');
  await page.locator('#evolve-unit').click();
  await expect(page.locator('#action-notice')).toContainText(`进化完成：${CONTENT.species[action.intoSpeciesId].name}`);
  const evolved = await state(page);
  expect(evolved.units[fixture.unitId]).toMatchObject({ speciesId: action.intoSpeciesId, xp: 0 });
  await page.screenshot({ path: `${reports}/m3ui-evolve.png`, fullPage: true });
});

test('unit card stays outside the map and recovering units appear in the city panel', async ({ page }) => {
  const fixture = await importFixture(page, 'recovering');
  const recovering = Object.values(fixture.state.units).find(unit => unit.ownerId === 0 && unit.location === 'recovering' && unit.cityId === fixture.cityId)!;
  if (recovering.location !== 'recovering') throw new Error('Expected recovering unit');
  const map = (await page.locator('.map-card').boundingBox())!;
  const card = (await page.locator('#unit-panel').boundingBox())!;
  expect(card.x >= map.x + map.width || card.y >= map.y + map.height).toBe(true);
  await expect(page.locator('#economy')).toBeHidden();
  await page.locator('#city-select').selectOption(String(fixture.cityId));
  await expect(page.locator('#unit-panel')).toBeEmpty();
  await expect(page.locator('#recovering-units')).toContainText(`剩余 ${recovering.roundsLeft} 轮`);
  await expect(page.locator('#recovering-units')).toContainText(unitDefinition(recovering, CONTENT).name);
  const current = await state(page);
  const upkeep = Object.values(current.units).filter(unit => unit.ownerId === 0)
    .reduce((sum, unit) => sum + unitDefinition(unit, CONTENT).upkeep, 0);
  await expect(page.locator('#hud-upkeep')).toContainText(`−${upkeep}`);
  await page.screenshot({ path: `${reports}/m3ui-map.png`, fullPage: true });
});

test('battle activity uses civilization and species labels without revealing unknown combatants', async ({ page }) => {
  const fixture = await importFixture(page);
  const action = fixture.action;
  if (action?.type !== 'Attack' || action.target.kind !== 'unit') throw new Error('Expected wild attack');
  const actor = fixture.state.units[action.unitId], target = fixture.state.units[action.target.id];
  if (!isMapUnit(actor) || !isMapUnit(target)) throw new Error('Expected deployed combatants');
  const actorName = unitDefinition(actor, CONTENT).name, targetName = unitDefinition(target, CONTENT).name;
  const labels = await page.evaluate(async ({ actor, target }) => {
    const mainPath = '/src/browser/main.ts';
    const { battleActivityText, session } = await import(mainPath);
    const view = session.getView();
    const base = { type: 'BattleResolved' as const, attackerId: actor.id, target: { kind: 'unit' as const, id: target.id },
      positions: [actor.position, target.position], damage: 7, counterDamage: 3,
      capturedCity: false, knockedDownUnitIds: [] };
    return {
      visible: battleActivityText(base, view),
      unknownAttacker: battleActivityText({ ...base, attackerId: 999 }, view, new Map()),
      unknownTarget: battleActivityText({ ...base, target: { kind: 'unit', id: 999 } }, view, new Map()),
      lostSettler: battleActivityText({ ...base, attackerId: target.id, target: { kind: 'unit', id: 999 } }, view, new Map([[999, '文明 1 的 开拓队']])),
    };
  }, { actor, target });
  expect(labels.visible).toBe(`文明 1 的 ${actorName} 攻击了 野生 ${targetName}：7 伤害，反击 3`);
  expect(labels.unknownAttacker).toBe(`未知单位 攻击了 野生 ${targetName}：7 伤害，反击 3`);
  expect(labels.unknownTarget).toBe(`文明 1 的 ${actorName} 攻击了 未知单位：7 伤害，反击 3`);
  expect(labels.lostSettler).toBe(`野生 ${targetName} 攻击了 文明 1 的 开拓队：7 伤害，反击 3（己方单位被击败）`);
  expect(labels.unknownAttacker).not.toContain(actorName);
  expect(labels.unknownTarget).not.toContain(targetName);
});
