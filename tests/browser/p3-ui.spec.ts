import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { combatFixture } from './fixtures/combat.ts';
import type { CombatScenario } from './fixtures/combat.ts';
import { generateRealGame, realGameLog } from './fixtures/real-game.ts';
import { replay } from '../../src/app/session.ts';
import { serializeSave } from '../../src/app/save.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Hex } from '../../src/core/hex.ts';
import { openScreen, closeScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const widths = [1280, 768, 390] as const;
let dangerSave: string | undefined;

function exposedSettlerSave() {
  if (dangerSave) return dangerSave;
  const game = generateRealGame({ seed: 1, width: 24, height: 16, personalities: ['conservative', 'aggressive'] });
  const log = realGameLog(game, game.commands.slice(0, 12));
  dangerSave = serializeSave(replay(log), log);
  return dangerSave;
}

async function importSave(page: Page, save: string) {
  await page.goto('/?seed=12345');
  await page.locator('#import-save').setInputFiles({ name: 'p3-ui.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}

async function clickHex(page: Page, hex: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath);
    const { hexToWorld, toScreen } = await import(cameraPath);
    const screen = toScreen(hexToWorld(hex), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, hex);
  await page.mouse.click(point.x, point.y);
}

async function importCombat(page: Page, scenario: CombatScenario) {
  const fixture = combatFixture(scenario);
  await importSave(page, fixture.save);
  const unitId = fixture.action && 'unitId' in fixture.action ? fixture.action.unitId : fixture.unitId!;
  const unit = fixture.state.units[unitId];
  if (!isMapUnit(unit)) throw new Error('Expected a deployed actor');
  await page.locator('#fit').click();
  await page.locator('#unit-select').selectOption(String(unitId));
  await expect(page.locator('#selection')).toContainText('行动点 1');
  return { ...fixture, unitId };
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function screenshot(page: Page, name: string) {
  await expectNoOverflow(page);
  await page.screenshot({ path: `${reports}/${name}.png`, fullPage: true });
}

for (const width of widths) {
  test(`p3 UI acceptance at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?seed=12345');
    await page.locator('#animate').uncheck();
    await expect(page.locator('#victory-panel [data-victory]')).toHaveCount(6);
    await openScreen(page, 'victory');
    await expect(page.locator('[data-open-screen="victory"]')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#victory-panel summary').click();
    await screenshot(page, `p3-ui-overview-${width}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#screen-host')).toBeHidden();
    await expect(page.locator('[data-open-screen="victory"]')).toHaveAttribute('aria-expanded', 'false');

    if (width < 861) {
      // Narrow screens scroll the page; the end-turn button stays pinned in view.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('#end-turn')).toBeInViewport();
      await screenshot(page, `p3-ui-float-${width}`);
      await page.locator('#end-turn').click();
      await expect(page.locator('#map-info')).toContainText('第 2 轮 · 当前文明 1');
    }

    const danger = exposedSettlerSave();
    await importSave(page, danger);
    const dangerButton = page.locator('[data-reminder^="unit:"]');
    await expect(dangerButton).toHaveText('开拓队有危险');
    await dangerButton.click();
    await expect(page.locator('#action-notice')).toContainText('让宝可梦护送，或先撤回城市');
    await expect(page.locator('#selection')).toContainText('开拓队');
    await screenshot(page, `p3-ui-danger-${width}`);

    const attack = await importCombat(page, 'attack');
    if (attack.action?.type !== 'Attack' || attack.action.target.kind !== 'unit') throw new Error('Expected unit attack');
    const attackTarget = attack.state.units[attack.action.target.id];
    if (!isMapUnit(attackTarget)) throw new Error('Expected a deployed attack target');
    await page.locator('#attack-unit').click();
    await expect(page.locator('#action-notice')).toContainText(/[1-9]\d* 个可攻击目标（红色虚线）/);
    await clickHex(page, attackTarget.position);
    await expect(page.locator('#battle-preview')).toContainText('预计伤害');
    await screenshot(page, `p3-ui-attack-${width}`);
    await page.locator('#confirm-action').click();
    await expect(page.locator('#action-notice')).toContainText('攻击结算');
    await page.locator('#end-turn').click();
    await expect(page.locator('#map-info')).toContainText(`第 ${attack.state.round + 1} 轮 · 当前文明 1`);
    await openScreen(page, 'log');
    await page.locator('#activity-panel').scrollIntoViewIfNeeded();
    expect(await page.locator('#activity-list .activity-round').count()).toBeGreaterThan(0);
    await openScreen(page, 'log');
    await page.locator('#activity-important').check();
    await expect(page.locator('#activity-list .routine')).toHaveCount(0);
    await expect(page.locator('#activity-list .important')).not.toHaveCount(0);
    await screenshot(page, `p3-ui-activity-${width}`);

    const capture = await importCombat(page, 'capture-success');
    if (capture.action?.type !== 'Capture') throw new Error('Expected capture');
    const captureTarget = capture.state.units[capture.action.targetUnitId];
    if (!isMapUnit(captureTarget)) throw new Error('Expected a deployed capture target');
    await closeScreen(page);
    await page.locator('#capture-unit').click();
    await expect(page.locator('#action-notice')).toContainText('捕捉模式：选择相邻的野生宝可梦，再确认捕捉');
    await clickHex(page, captureTarget.position);
    await expect(page.locator('#capture-preview')).toContainText('捕捉成功率');
    await screenshot(page, `p3-ui-capture-${width}`);
    await page.locator('#confirm-action').click();
    await expect(page.locator('#action-notice')).toContainText('捕捉成功');
    expect(errors).toEqual([]);
  });
}

test('capture targets follow the selected ball inventory', async ({ page }) => {
  const fixture = combatFixture('capture-success');
  if (fixture.action?.type !== 'Capture') throw new Error('Expected capture');
  const save = JSON.parse(fixture.save);
  save.state.players[0].ballInventory.pokeBall = 0;
  save.state.players[0].ballInventory.greatBall = 1;
  save.state.players[0].research.unlockedIds.push('ballCraft');
  await importSave(page, JSON.stringify(save));
  const actor = fixture.state.units[fixture.action.unitId], target = fixture.state.units[fixture.action.targetUnitId];
  if (!isMapUnit(actor) || !isMapUnit(target)) throw new Error('Expected deployed capture units');
  await page.locator('#fit').click();
  await page.locator('#unit-select').selectOption(String(actor.id));
  await page.locator('#capture-unit').click();
  await expect(page.locator('#capture-ball')).toHaveValue('pokeBall');
  await screenshot(page, 'p3-ui-capture-ball-filter-after');
  await expect(page.locator('#action-notice')).toContainText('没有可捕捉目标；检查相邻目标、当前球种的库存与科技');
  await clickHex(page, target.position);
  await expect(page.locator('#capture-preview')).toContainText('选择野生宝可梦查看成功率');
  await expect(page.locator('#action-notice')).toContainText('该目标不适用；请选择高亮目标');
  await expect(page.locator('#confirm-action')).toBeDisabled();
  await page.locator('#capture-ball').selectOption('greatBall');
  await expect(page.locator('#action-notice')).toContainText('捕捉模式：选择相邻的野生宝可梦，再确认捕捉');
  await clickHex(page, target.position);
  await expect(page.locator('#capture-preview')).toContainText('捕捉成功率');
  await expect(page.locator('#confirm-action')).toBeEnabled();
});

test('attack clicks reject peaceful and out-of-range targets', async ({ page }) => {
  const fixture = await importCombat(page, 'attack');
  await page.locator('#attack-unit').click();
  for (const reason of ['at-peace', 'out-of-range']) {
    const candidate = await page.evaluate(async ({ reason, unitId }) => {
      const mainPath = '/src/browser/main.ts', previewPath = '/src/core/preview.ts', helperPath = '/src/browser/action-targets.ts';
      const { session } = await import(mainPath), { previewAttack } = await import(previewPath), { actionTargets } = await import(helperPath);
      const view = session.getView();
      const target = view.units.find((unit: { id: number; position: Hex }) => {
        const preview = previewAttack(view, unitId, { kind: 'unit', id: unit.id });
        return !preview.ok && preview.reason === reason;
      });
      return target ? { id: target.id, position: target.position, eligible: actionTargets(view, unitId, 'attack', 'pokeBall').some((item: { id: number }) => item.id === target.id) } : null;
    }, { reason, unitId: fixture.unitId });
    expect(candidate, `missing ${reason} fixture`).not.toBeNull();
    expect(candidate!.eligible).toBe(false);
    await clickHex(page, candidate!.position);
    await expect(page.locator('#action-notice')).toContainText('该目标不适用；请选择高亮目标');
    await expect(page.locator('#battle-preview')).toContainText('选择红色虚线目标查看伤害、反击与击坠');
    await expect(page.locator('#confirm-action')).toBeDisabled();
  }
});

test('faith progress requires a converted city for every living rival', async ({ page }) => {
  await page.goto('/?seed=12345');
  const result = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', panelPath = '/src/browser/victory-panel.ts';
    const { session } = await import(mainPath), { renderVictoryPanel } = await import(panelPath);
    const view = session.getView(), faith = view.expansion!.faith!;
    faith.faiths = [{ founderId: view.playerId, legend: 'hooh', tenets: [], foundedRound: 1, followers: 6 }];
    faith.totalCities = 6;
    faith.cityFaith = { [view.economy.player.headquartersCityId]: view.playerId };
    renderVictoryPanel(view);
    const panel = () => document.querySelector('#victory-panel [data-victory="faith"]')!;
    const blocked = { now: panel().querySelector('.victory-bar')!.getAttribute('aria-valuenow'), text: panel().textContent };
    for (const rival of view.civilizations.filter((civ: { id: number; eliminated: boolean }) => civ.id !== view.playerId && !civ.eliminated)) {
      const cityId = 100 + rival.id;
      view.knowledge.lastKnownCities[cityId] = { ownerId: rival.id, position: { q: 0, r: 0 }, lastSeenRound: 1 };
      faith.cityFaith[cityId] = view.playerId;
    }
    renderVictoryPanel(view);
    return { blocked, unblocked: { now: panel().querySelector('.victory-bar')!.getAttribute('aria-valuenow'), text: panel().textContent } };
  });
  expect(result.blocked.now).toBe('99');
  expect(result.blocked.text).toContain('仍有 3 个对手未皈依');
  expect(result.unblocked.now).toBe('100');
  expect(result.unblocked.text).not.toContain('未皈依');
});
