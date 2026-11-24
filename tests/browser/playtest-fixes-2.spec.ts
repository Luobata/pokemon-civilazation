// Second playtest (docs/design/playtest-2026-11b/report.md) batches A and B, with real input (clicks, hotkeys, Shift+click end turn) on
// saves of real v26 AI games (tests/browser/fixtures/playtest-2b.ts, depth-v26.ts) and a new v26 game. Presentation only.
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { contentForView } from '../../src/content/units.ts';
import { planGoTo } from '../../src/browser/waypoints.ts';
import { openScreen } from './ui.ts';
import { attackFixture, embarkedFixture, oneGymFixture, outOfRangeFixture, seasonNoHallFixture } from './fixtures/playtest-2b.ts';
import { duelFixture } from './fixtures/depth-v26.ts';

const SHOTS = 'test-results/screenshots/fixes-2';
mkdirSync(SHOTS, { recursive: true });
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=26');
  await page.locator('#import-save').setInputFiles({ name: 'fixes-2.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
}
async function tilePoint(page: Page, hex: Hex) {
  return page.evaluate(async hex => {
    const main = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(main), { tileToScreen } = await import(cameraPath);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, rect = canvas.getBoundingClientRect();
    const p = tileToScreen(hex, camera, session.getView().map, canvas.clientWidth);
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, hex);
}
async function clickHex(page: Page, hex: Hex) { const point = await tilePoint(page, hex); await page.mouse.click(point.x, point.y); }
/** Selects an own unit from the unit list (as the waypoint tests do), keeping the map focused for the hotkeys. */
async function selectUnit(page: Page, id: number) {
  await page.locator('#unit-select').selectOption(String(id));
  await page.locator('#map').focus();
  await expect(page.locator('#unit-action-bar')).toBeVisible();
}
async function endTurn(page: Page) {
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  const round = (await view(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBeGreaterThan(round);
}
const errorsOf = (page: Page) => { const errors: string[] = []; page.on('pageerror', error => errors.push(String(error))); return errors; };

test('A/B gym: a 1-Pokémon gym offers only the Pokémon on the gym, the picker explains the estimate, the toast gives the relay result, the battle log keeps the replay', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = errorsOf(page);
  const fixture = oneGymFixture();
  await importSave(page, fixture.save);
  await selectUnit(page, fixture.id);
  await page.locator('#gym-unit').click();
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  // U-e: one entrant, only the Pokémon on the gym; the note says why the others are not offered.
  await expect(picker.locator('.lp-row')).toHaveCount(1);
  await expect(picker.locator('.lp-row')).toHaveAttribute('data-unit', String(fixture.id));
  await expect(picker.locator('#lineup-site-note')).toContainText('站在道馆格上');
  await expect(picker.locator('.lp-candidate')).toHaveCount(0);
  // N3: removing the entrant gives the v26 rule (as many as the leader), not v24's "1–3".
  await picker.locator('[data-remove]').click();
  await expect(picker.locator('#lineup-blocker')).toContainText('1 只');
  await expect(picker.locator('#lineup-blocker')).not.toContainText('1–3');
  await expect(picker.locator('.lp-candidate')).toHaveCount(1);
  await picker.locator('.lp-candidate').click();
  // U-b: attack / defence / speed chips with accessible names, a reason for the estimate, a reason for the suggested order.
  await expect(picker.locator('.lp-row .lp-stat').first()).toHaveAttribute('aria-label', /^攻击 \d+$/);
  await expect(picker.locator('.lp-foes .lp-stat[aria-label^="防御"]').first()).toBeVisible();
  await expect(picker.locator('#lineup-why')).toContainText(/对手攻 \d+ (>|≤)|你防 \d+ ≥ 对手攻/);
  await expect(picker.locator('#lineup-why')).toContainText(/属性(有利|不利|持平)/);
  await picker.locator('#lineup-suggest').click();
  await expect(picker.locator('#lineup-suggest-why')).toContainText('建议理由');
  await page.screenshot({ path: `${SHOTS}/b-lineup-gym-reasons.png` });
  const estimate = Number((await picker.locator('#lineup-estimate').textContent())!.replace('%', ''));
  await picker.locator('#lineup-confirm').click();
  await expect(picker).toBeHidden();
  // N4: the result toast gives the relay result and the estimate, not the power totals.
  const toast = page.locator('#toast-host [data-toast]', { hasText: '馆主' }).first();
  await expect(toast).toContainText(/（你剩 \d+\/1 只，馆主剩 \d+\/1 只，\d+ 回合）/);
  await expect(toast).toContainText(`赛前估计胜率 ${estimate}%`);
  await expect(toast).not.toContainText('队伍战力');
  await page.screenshot({ path: `${SHOTS}/a-gym-result-toast.png` });
  // Replay: key turns on top, the step list collapsed until opened.
  await toast.locator('.toast-icon').click();
  const viewer = page.locator('#battle-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('#bv-keys li').first()).toBeVisible();
  await expect(viewer.locator('#bv-steps-box')).not.toHaveAttribute('open', '');
  await viewer.locator('#bv-skip').click();
  await page.screenshot({ path: `${SHOTS}/b-replay-key-turns.png` });
  await viewer.locator('#bv-steps-box summary').click();
  await expect(viewer.locator('.bv-step').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  // U-a: the unit panel links to the battle log, filtered to this Pokémon; the replay opens from the log.
  await selectUnit(page, fixture.id);
  const entry = page.locator('#unit-battle-log');
  await expect(entry).toHaveAttribute('aria-label', /战斗记录：1 场/);
  await entry.click();
  await expect(page.locator('#screen-log')).toBeVisible();
  const log = page.locator('#battle-log');
  await expect(log).toContainText('只看');
  await expect(log.locator('.battle-log-row')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/b-battle-log-unit.png` });
  await log.locator('#battle-log-all').click();
  await expect(log).not.toContainText('只看');
  await log.locator('[data-battle-replay]').first().click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#screen-log .screen-close').click();
  await endTurn(page);
  // The log keeps the replay across turns (the session store).
  await openScreen(page, 'log');
  await expect(page.locator('#battle-log .battle-log-row').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/b-battle-log.png` });
  expect(errors).toEqual([]);
});

test('A N9 / N10: an attack refused out of range says why; a battle notice names attacker and target', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = errorsOf(page);
  const far = outOfRangeFixture();
  await importSave(page, far.save);
  let current = await view(page);
  const unit = current.units.find(item => item.id === far.id)!, range = contentForView(current).species[(unit as { speciesId: string }).speciesId as never].range;
  const wild = current.units.filter(item => item.ownerId === null && item.kind === 'pokemon')
    .map(item => ({ item, distance: hexDistance(item.position, unit.position, current.map) })).filter(entry => entry.distance > range && entry.distance <= 4)
    .sort((a, b) => a.distance - b.distance)[0]!;
  await selectUnit(page, far.id);
  await page.keyboard.press('a');
  await clickHex(page, wild.item.position);
  await expect(page.locator('#action-notice')).toContainText(`无法攻击：超出射程：相距 ${wild.distance} 格`);
  await page.screenshot({ path: `${SHOTS}/a-attack-out-of-range.png` });

  const near = attackFixture();
  await importSave(page, near.save);
  current = await view(page);
  const attacker = current.units.find(item => item.id === near.id)!;
  const target = current.units.find(item => item.ownerId === null && item.kind === 'pokemon' && hexDistance(item.position, attacker.position, current.map) === 1)!;
  await selectUnit(page, near.id);
  await page.keyboard.press('a');
  await clickHex(page, target.position);
  await clickHex(page, target.position);
  await expect(page.locator('#action-notice')).toContainText(/^你的.+ 攻击 野生 .+：造成 \d+ 伤害/);
  await page.screenshot({ path: `${SHOTS}/a-battle-notice.png` });
  expect(errors).toEqual([]);
});

test('A N8: on water the capture button is unavailable in advance and Q says why', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = errorsOf(page);
  const fixture = embarkedFixture();
  await importSave(page, fixture.save);
  await selectUnit(page, fixture.id);
  await expect(page.locator('#capture-unit')).toBeDisabled();
  await expect(page.locator('#capture-unit')).toHaveAttribute('data-reason', '在水上不能捕捉，先上岸。');
  await page.keyboard.press('q');
  await expect(page.locator('#action-notice')).toContainText('在水上不能捕捉');
  await page.screenshot({ path: `${SHOTS}/a-capture-on-water.png` });
  await endTurn(page);
  expect(errors).toEqual([]);
});

test('A N7: an open contest season with no eligible entrant says why it cannot be entered and is not ranked as urgent', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = errorsOf(page);
  const fixture = seasonNoHallFixture();
  await importSave(page, fixture.save);
  await openScreen(page, 'world');
  const card = page.locator('.next-card[data-card="season"]');
  await expect(card).toContainText('不能参赛：没有合适的宝可梦');
  await expect(card).not.toHaveClass(/urgent|ready/);
  await expect(card.locator('button', { hasText: '参赛' })).toBeDisabled();
  await expect(card.locator('button', { hasText: '参赛' })).toHaveAttribute('title', /附近城市里没有可出场的宝可梦/);
  await expect(page.locator('.next-card').first()).not.toHaveAttribute('data-card', 'season');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/a-season-no-hall.png` });
  expect(errors).toEqual([]);
});

test('A N5: the go-to arrival estimate is the same in the notice, the unit bar and the unit line (new v26 game)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = errorsOf(page);
  await page.goto('/?seed=12345&size=24x16&gameplay=26');
  await page.locator('#animate').uncheck();
  await expect(page.locator('#end-turn')).toBeEnabled();
  const start = await view(page), settler = start.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  const target = start.map.tiles.map((biome, index) => ({ biome, hex: indexToHex(index, start.map) }))
    .filter(tile => tile.biome !== 'ocean' && hexDistance(tile.hex, settler.position, start.map) >= 5 && hexDistance(tile.hex, settler.position, start.map) <= 7 && planGoTo(start, settler.id, tile.hex))
    .sort((a, b) => hexDistance(a.hex, settler.position, start.map) - hexDistance(b.hex, settler.position, start.map))[0]!.hex;
  await page.locator('#unit-select').selectOption(String(settler.id));
  await page.locator('#map').focus();
  await page.keyboard.press('f');
  await page.keyboard.press('w');
  await clickHex(page, target);
  const notice = (await page.locator('#action-notice').textContent())!;
  const eta = /已设路标：(第 \d+ 轮到达（还要 \d+ 轮）|本轮到达)/.exec(notice)?.[1];
  expect(eta, notice).toBeTruthy();
  await expect(page.locator('#goto-unit')).toHaveAttribute('aria-label', `前往 · 路标${eta}`);
  await page.screenshot({ path: `${SHOTS}/a-goto-estimate.png` });
  // After the turn the estimate counts down from the same arrival round.
  const round = /第 (\d+) 轮到达/.exec(eta!)?.[1];
  await endTurn(page);
  if (round && await page.locator('#goto-unit').count() && await page.locator('#cancel-goto-unit').count()) {
    await page.locator('#unit-select').selectOption(String(settler.id));
    await expect(page.locator('#goto-unit')).toHaveAttribute('aria-label', new RegExp(`第 ${round} 轮到达|本轮到达|第 \\d+ 轮到达`));
  }
  expect(errors).toEqual([]);
});

test('B U-d / BA5: the duel starts on the friendly stake; a serious duel at a low estimate is warned about', async ({ page }) => {
  test.setTimeout(480_000);
  const errors = errorsOf(page);
  const fixture = duelFixture();
  await importSave(page, fixture.save);
  await selectUnit(page, fixture.id);
  await page.keyboard.press('d');
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-stake="spar"]')).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('#lineup-stake-note')).toContainText('切磋');
  await expect(picker.locator('#lineup-stake-warning')).toHaveCount(0);
  // Down to one Pokémon the estimate drops; 真剑 then warns below 20%.
  while (await picker.locator('.lp-row').count() > 1) await picker.locator('[data-remove]').last().click();
  await picker.locator('[data-stake="serious"]').click();
  const estimate = Number((await picker.locator('#lineup-estimate').textContent())!.replace('%', ''));
  if (estimate < 20) await expect(picker.locator('#lineup-stake-warning')).toContainText(`估计胜率只有 ${estimate}%`);
  else await expect(picker.locator('#lineup-stake-warning')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/b-duel-stake-warning.png` });
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  expect(errors).toEqual([]);
});
