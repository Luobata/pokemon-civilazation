// Playtest 2026-11 batch B (docs/design/playtest-2026-11/report.md): research and turn flow, checked with real input
// (menu, clicks, hotkeys, Shift+click end turn) on new games or on saves of real AI games (fixtures/playtest-ab.ts).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { openScreen, closeScreen, startNewGame } from './ui.ts';
import { captureFixture, contestFixture, leagueEveFixture } from './fixtures/playtest-ab.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'playtest.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
}
/** Shift+click end turn and wait for the next round; a wonder story card is closed first, as a player would. */
async function endTurn(page: Page) {
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  const round = (await view(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBeGreaterThan(round);
}
async function tileIndexOf(page: Page, unitId: number): Promise<number> {
  return page.evaluate(async unitId => {
    const mainPath = '/src/browser/main.ts', hexPath = '/src/core/hex.ts';
    const { session } = await import(mainPath), { hexToIndex } = await import(hexPath);
    const view = session.getView(), unit = view.units.find((item: { id: number }) => item.id === unitId);
    return hexToIndex(unit.position, view.map);
  }, unitId);
}
async function clickTile(page: Page, index: number) {
  const point = await page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
  await page.mouse.click(point.x, point.y);
}

test('U1: one research flow — clicking an available node starts it, the select and button follow, the button says why it is off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=7&gameplay=24');
  await openScreen(page, 'research');
  const picker = page.locator('#research-topic'), button = page.locator('#set-research');
  // Nothing chosen yet: an available topic is preselected, so the button is never a no-op.
  const first = await picker.inputValue();
  expect(first).not.toBe('');
  await expect(button).toBeEnabled();
  await expect(button).toContainText('研究「');
  // Clicking an available node starts it; the select, button and node agree.
  const nodes = await page.locator('.tech-node.available').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.treeNode!));
  const target = nodes.find(id => id !== first)!;
  await expect(page.locator(`[data-tree-node="${target}"]`)).toHaveAttribute('aria-label', /点击开始研究/);
  await page.locator(`[data-tree-node="${target}"]`).click();
  await expect.poll(async () => (await view(page)).economy.player.research.techId).toBe(target);
  await expect(page.locator(`[data-tree-node="${target}"]`)).toHaveClass(/active/);
  await expect(picker).toHaveValue(target);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('正在研究');
  await expect(button).toHaveAttribute('title', /正在研究「.+」/);
  // Picking another topic in the select previews it in the tree and the button commits it.
  await picker.selectOption(first);
  await expect(page.locator(`[data-tree-node="${first}"]`)).toHaveClass(/selected/);
  await expect(page.locator('#tech-detail')).toContainText('研究此项');
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(async () => (await view(page)).economy.player.research.techId).toBe(first);
  await expect(picker).toHaveValue(first);
  // A locked node only previews (no research change).
  await page.locator('.tech-node.locked').first().click();
  await expect.poll(async () => (await view(page)).economy.player.research.techId).toBe(first);
  await page.screenshot({ path: `${reports}/playtest-u1-research-flow.png` });
  expect(errors).toEqual([]);
});

test('U5: a capture that cannot happen says why — not adjacent, not wild (real AI save)', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = captureFixture();
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  await clickTile(page, await tileIndexOf(page, fixture.id));
  await expect(page.locator('#capture-unit')).toBeEnabled();
  await page.locator('#map').focus();
  await page.keyboard.press('q');
  const notice = page.locator('#action-notice');
  await expect(notice).toContainText(/没有相邻的野生宝可梦：最近的一只相距 \d 格/);
  // Clicking the far wild Pokémon names the distance.
  type Spot = { tile: number; distance: number };
  const { wild, rival } = await page.evaluate(async unitId => {
    const mainPath = '/src/browser/main.ts', hexPath = '/src/core/hex.ts';
    const { session } = await import(mainPath), { hexDistance, hexToIndex } = await import(hexPath);
    type Unit = { id: number; kind: string; ownerId: number | null; position: { q: number; r: number } };
    const view = session.getView(), unit = view.units.find((item: Unit) => item.id === unitId);
    const rivals = new Set((view.expansion?.rivals?.sightings ?? []).map((item: { unitId: number }) => item.unitId));
    const spot = (target: Unit | undefined) => target && { tile: hexToIndex(target.position, view.map), distance: hexDistance(unit.position, target.position, view.map) };
    const near = (units: Unit[]) => units.sort((a, b) => hexDistance(unit.position, a.position, view.map) - hexDistance(unit.position, b.position, view.map))[0];
    const wildOnes = view.units.filter((item: Unit) => item.kind === 'pokemon' && item.ownerId === null);
    return { wild: spot(near(wildOnes.filter((item: Unit) => !rivals.has(item.id)))), rival: spot(near(wildOnes.filter((item: Unit) => rivals.has(item.id)))) ?? null };
  }, fixture.id) as { wild: Spot; rival: Spot | null };
  await clickTile(page, wild.tile);
  await expect(notice).toContainText(`无法捕捉：目标不相邻（相距 ${wild.distance} 格）`);
  // A rival trainer's Pokémon is never a capture target.
  if (rival) { await clickTile(page, rival.tile); await expect(notice).toContainText('无法捕捉：劲敌的宝可梦不能捕捉'); }
  // An own unit is not a capture target either.
  await clickTile(page, await tileIndexOf(page, fixture.id));
  await expect(notice).toContainText('无法捕捉：');
  await page.screenshot({ path: `${reports}/playtest-u5-capture-reason.png` });
});

test('U6: the ball stock stays in the top bar and on the capture button, and opens the city purchase tab', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = captureFixture();
  await importSave(page, fixture.save);
  const stock = (await view(page)).economy.player.ballInventory;
  const top = page.locator('#hud-balls');
  await expect(top).toBeVisible();
  await expect(top).toHaveAttribute('aria-label', new RegExp(`^精灵球 ${stock.pokeBall}`));
  await expect(top.locator(`[aria-label="精灵球 ${stock.pokeBall}"]`)).toHaveCount(1);
  // On the unit bar: the capture button carries the count.
  await page.locator('#fit').click();
  await clickTile(page, await tileIndexOf(page, fixture.id));
  await expect(page.locator('#capture-unit .unit-action-count')).toHaveText(String(stock.pokeBall + stock.greatBall));
  await page.screenshot({ path: `${reports}/playtest-u6-ball-stock.png` });
  // The top-bar button goes to the capital's 物资采购 tab.
  await top.click();
  await expect(page.locator('#economy [data-city-section="supplies"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ball-kind')).toBeVisible();
  await page.screenshot({ path: `${reports}/playtest-u6-ball-shop.png` });
  // The stock is visible over the map whatever is selected (and during the AI turns).
  await page.keyboard.press('Escape');
  await expect(top).toBeVisible();
});

test('U8: a strategic event (league result) is drawn apart from routine pings and sits on top (real AI save)', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = leagueEveFixture();
  await importSave(page, fixture.save);
  // The season is played at the end of its round: two end turns from its eve.
  while ((await view(page)).round <= fixture.id) await endTurn(page);
  const rail = page.locator('#toast-host');
  const league = rail.locator('.toast.is-strategic', { hasText: '联盟大会' });
  await expect(league).toHaveCount(1);
  await expect(league).toHaveAttribute('role', 'alert');
  await expect(league.locator('.toast-kicker')).toHaveText('大事');
  await expect(league.locator('.toast-icon')).toHaveAttribute('aria-label', /^大事：/);
  // Strategic items come first in the rail, routine ones after.
  const order = await rail.locator('.toast').evaluateAll(items => items.map(item => item.classList.contains('is-strategic')));
  expect(order.indexOf(false) === -1 || order.lastIndexOf(true) < order.indexOf(false)).toBe(true);
  // The icon is larger than a routine one.
  const size = await league.locator('.toast-icon').boundingBox();
  expect(size!.width).toBeGreaterThan(44);
  await page.screenshot({ path: `${reports}/playtest-u8-strategic.png` });
});

test('U9: the victory page explains each target on hover; the era wording is 时代', async ({ page }) => {
  await page.goto('/?seed=7&gameplay=24');
  await openScreen(page, 'menu');
  await page.locator('#round-limit').selectOption('200');
  await startNewGame(page);
  await openScreen(page, 'victory');
  const target = page.locator('[data-victory-why="championship"]');
  await expect(target).toHaveText('0/3');
  await target.hover();
  await expect(page.locator('#ui-tip-card')).toBeVisible();
  await expect(page.locator('#ui-tip-card')).toContainText('200 轮对局的冠军头衔目标');
  await expect(target).toHaveAttribute('aria-label', /目标 3：/);
  await target.focus();
  await expect(page.locator('#ui-tip-card')).toContainText('每多 100 轮 +1');
  await openScreen(page, 'era');
  await expect(page.locator('#era-panel')).not.toContainText('完整世代');
  await closeScreen(page);
});

test('U7: the contest button shows the cooldown left, then reopens (real AI save)', async ({ page }) => {
  test.setTimeout(400_000);
  const fixture = contestFixture();
  await importSave(page, fixture.save);
  const card = async () => {
    await openScreen(page, 'world');
    const details = page.locator('details[data-system="s39-contests"]');
    if (await details.getAttribute('open') === null) await details.locator('summary').first().click();
    return details.locator('#contest-show');
  };
  const left = fixture.id - (await view(page)).round;
  let show = await card();
  await expect(show.getByRole('button')).toHaveText(`举办华丽大赛 · 冷却 ${left} 轮`);
  await expect(show.getByRole('button')).toBeDisabled();
  await expect(show.getByRole('button')).toHaveAttribute('title', `冷却中：还剩 ${left} 轮，第 ${fixture.id} 轮可再举办。`);
  await expect(show.locator('.contest-reason')).toContainText(`还剩 ${left} 轮`);
  await page.screenshot({ path: `${reports}/playtest-u7-contest-cooldown.png` });
  await closeScreen(page);
  while ((await view(page)).round < fixture.id) await endTurn(page);
  show = await card();
  await expect(show.getByRole('button')).not.toContainText('冷却');
  const gold = (await view(page)).economy.player.gold;
  if (gold >= 30) await expect(show.getByRole('button')).toBeEnabled();
  else await expect(show.getByRole('button')).toHaveAttribute('title', /金币不足/);
});
