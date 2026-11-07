import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { diplomacySave, incomingPeaceSave, neutralSave, outcomeSave, visibleAiSave } from './fixtures/diplomacy.ts';
import { reachableFixture, verifyImportedReplay } from './fixtures/reachable.ts';
import { replay } from '../../src/app/session.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import type { GameState, PlayerView } from '../../src/core/model.ts';
import type { Hex } from '../../src/core/hex.ts';
import { openScreen, closeScreen, startNewGame } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
async function importFixture(page: Page, text: string) {
  await page.goto('/?seed=12345');
  await page.locator('#import-save').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await verifyImportedReplay(page, text);
}
async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => { const mainPath = '/src/browser/main.ts'; return (await import(mainPath)).developerAdapter.getState(); });
}
async function clickHex(page: Page, hex: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath);
    const { hexToWorld, toScreen } = await import(cameraPath);
    const p = toScreen(hexToWorld(hex), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, hex);
  await page.mouse.click(point.x, point.y);
}

test('war confirmation, peace proposal and AI response update public diplomacy', async ({ page }) => {
  await importFixture(page, diplomacySave());
  await page.locator('#animate').uncheck();
  await openScreen(page, 'diplomacy');
  await page.locator('[data-war="1"]').click();
  await expect(page.locator('#war-confirm')).toBeVisible();
  expect((await state(page)).diplomacy[0].status).toBe('peace');
  await page.locator('#confirm-war').click();
  expect((await state(page)).diplomacy[0].status).toBe('war');
  await closeScreen(page);
  for (let round = 0; round < 5; round++) {
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#end-turn')).toBeEnabled();
  }
  await openScreen(page, 'diplomacy');
  await page.locator('[data-peace="1"]').click();
  await expect(page.locator('#diplomacy')).toContainText('等待对方回应');
  await page.screenshot({ path: `${reports}/m4ui-diplomacy.png`, fullPage: true });
  await closeScreen(page);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#diplomacy')).toContainText('和平');
  const peaceful = await state(page), cooldown = peaceful.diplomacy[0].cooldownUntilRound - peaceful.round;
  await expect(page.locator('#diplomacy')).toContainText(`冷却剩余 ${cooldown} 轮`);
  expect(peaceful.diplomacy[0]).toMatchObject({ status: 'peace', proposal: null });
});

test('incoming peace is modal, cannot be escaped and blocks ending the turn', async ({ page }) => {
  await importFixture(page, incomingPeaceSave());
  await expect(page.locator('#peace-response')).toBeVisible();
  await expect(page.locator('#end-turn')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#peace-response')).toBeVisible();
  await page.screenshot({ path: `${reports}/m4ui-peace-response.png`, fullPage: true });
  await page.locator('#reject-peace').click();
  await expect(page.locator('#peace-response')).toBeHidden();
  await expect(page.locator('#end-turn')).toBeEnabled();
  expect((await state(page)).diplomacy[0]).toMatchObject({ status: 'war', proposal: null });
});

test('pending peace guards every state transition until a response', async ({ page }) => {
  await page.goto('/');
  await openScreen(page, 'menu');
  await page.locator('#save-game').click();
  await importFixture(page, incomingPeaceSave());
  await expect(page.locator('#peace-response')).toBeVisible();
  for (const id of ['new-game', 'load-game', 'import-save', 'replay', 'resume']) await expect(page.locator(`#${id}`)).toBeDisabled();
  const before = await state(page);
  await page.evaluate(() => {
    for (const id of ['new-game', 'load-game', 'replay', 'resume']) document.querySelector(`#${id}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const blocked = await state(page);
  expect(canonicalSerialize(blocked)).toBe(canonicalSerialize(before));
  expect(blocked.diplomacy[0].proposal).toEqual({ proposerId: 1, recipientId: 0 });
  await expect(page.locator('#action-notice')).toContainText('再切换对局');
  await page.locator('#reject-peace').click();
  await expect(page.locator('#new-game')).toBeEnabled();
  await startNewGame(page);
  await expect(page.locator('#round-display')).toContainText('1 ');
  expect((await state(page)).diplomacy[0].proposal).toBeNull();
});

for (const [kind, title] of [['score', '轮上限计分'], ['conquest', '征服胜利'], ['playerDefeat', '失败出局']] as const) {
  test(`${kind} outcome shows ranking and switches commands to read-only`, async ({ page }) => {
    await importFixture(page, outcomeSave(kind));
    await expect(page.locator('#gameover-dialog')).toBeVisible();
    await expect(page.locator('#outcome-title')).toHaveText(title);
    await expect(page.locator('#outcome-ranking tr')).toHaveCount(2);
    await expect(page.locator('#outcome-ranking')).toContainText('×80');
    const outcomeState = await state(page);
    if (kind === 'conquest') expect(outcomeState.players).toMatchObject({ 0: { eliminated: false }, 1: { eliminated: true } });
    if (kind === 'playerDefeat') {
      expect(outcomeState.players[0].eliminated).toBe(true);
      expect(outcomeState.outcome?.winners).toEqual([]);
    }
    if (kind === 'score') {
      await expect(page.locator('#outcome-summary')).toContainText('文明 1、文明 2');
      expect((await state(page)).outcome?.winners).toEqual([0, 1]);
    }
    await expect(page.locator('#end-turn')).toBeDisabled();
    await expect(page.locator('#save-game')).toBeDisabled();
    await expect(page.locator('#new-game')).toBeEnabled();
    if (kind === 'score') await page.screenshot({ path: `${reports}/m4ui-gameover.png`, fullPage: true });
    await page.locator('#gameover-close').click();
    await expect(page.locator('#gameover-dialog')).toBeHidden();
    await expect(page.locator('#end-turn')).toBeDisabled();
    await startNewGame(page);
    await expect(page.locator('#end-turn')).toBeEnabled();
    expect((await state(page)).outcome).toBeNull();
  });
}

test('neutral camp has a visible map marker and read-only information panel', async ({ page }) => {
  await importFixture(page, neutralSave());
  const cityId = reachableFixture('neutral').cityId!;
  const city = (await state(page)).cities[cityId];
  expect(city.ownerId).toBeNull();
  await page.locator('#fit').click();
  await clickHex(page, city.position);
  await expect(page.locator('#neutral-city')).toContainText(`中立营地 ${cityId}`);
  await expect(page.locator('#neutral-city')).toContainText(`HP ${city.hp}`);
  await page.screenshot({ path: `${reports}/m4ui-neutral.png`, fullPage: true });
});

test('new game applies round limit, AI count and personality', async ({ page }) => {
  await page.goto('/');
  await openScreen(page, 'menu');
  await page.locator('#round-limit').selectOption('300');
  await openScreen(page, 'menu');
  await page.locator('#ai-count').selectOption('1');
  await openScreen(page, 'menu');
  await page.locator('#ai-personality').selectOption('aggressive');
  await startNewGame(page);
  await expect(page.locator('#round-display')).toContainText('/ 300');
  const current = await state(page);
  expect(current.setup.roundLimit).toBe(300);
  expect(current.setup.players).toHaveLength(2);
  expect(current.setup.players[1]).toMatchObject({ controller: 'ai', personality: 'aggressive' });
});

test('visible AI movement uses projected events and a real AI turn replays identically', async ({ page }) => {
  await importFixture(page, visibleAiSave());
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#activity-list')).toContainText('文明 2单位移动');
  await page.screenshot({ path: `${reports}/m4ui-ai-turn.png`, fullPage: true });
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#end-turn')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts';
    const { developerAdapter } = await import(mainPath);
    return { log: developerAdapter.exportLog(), state: developerAdapter.getState() };
  });
  expect(result.log.commands.length).toBeGreaterThan(1);
  expect(canonicalSerialize(result.state)).toBe(canonicalSerialize(replay(result.log)));
  expect(stateDigest(result.state)).toBe(stateDigest(replay(result.log)));
});

test('unobserved territory never emits faction boundary strokes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fit').click();
  const counts = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', renderPath = '/src/browser/render/index.ts';
    const { session, camera } = await import(mainPath);
    const { createMapRenderer } = await import(renderPath);
    const strokes: string[] = [];
    const factionColor = getComputedStyle(document.documentElement).getPropertyValue('--civ-1').trim().toLowerCase();
    const original = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function () {
      if (this.lineWidth === 2 && String(this.strokeStyle).toLowerCase() === factionColor) strokes.push(String(this.strokeStyle));
      return Reflect.apply(original, this, []);
    };
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    const view = session.getView();
    const bare: PlayerView = { ...view, units: [], cities: [], map: { ...view.map, tiles: view.map.tiles.map(() => null) },
      visibleTileIds: [], territoryOwnerIds: view.territoryOwnerIds.map(() => null) };
    const renderer = createMapRenderer(canvas);
    renderer.render({ view: bare, camera });
    const unseen = strokes.length;
    bare.territoryOwnerIds[0] = [0];
    renderer.render({ view: bare, camera });
    CanvasRenderingContext2D.prototype.stroke = original;
    return { unseen, observed: strokes.length - unseen };
  });
  expect(counts.unseen).toBe(0);
  // One observed tile draws its six edges once per visible map copy (v22 wraps east-west and draws the copies).
  expect(counts.observed).toBeGreaterThan(0);
  expect(counts.observed % 6).toBe(0);
});

test('research and help shortcuts work without stealing input focus', async ({ page }) => {
  await page.goto('/');
  await page.locator('#map').focus();
  await page.keyboard.press('t');
  await openScreen(page, 'research');
  await expect(page.locator('#research-topic')).toBeFocused();
  await page.keyboard.press('?');
  await expect(page.locator('#keyboard-help')).not.toHaveAttribute('open', '');
  await closeScreen(page);
  await page.locator('#map').focus();
  await page.keyboard.press('?');
  await expect(page.locator('#keyboard-help')).toHaveAttribute('open', '');
});
