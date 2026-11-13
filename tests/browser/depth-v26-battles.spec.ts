// Gameplay v26 P1 (docs/design/depth-v26.md §2.3, §2.5): the lineup picker with real input (clicks, the unit bar, [ ] keys, Shift+click end
// turn) on saves of real v26 AI games (tests/browser/fixtures/depth-v26.ts).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { closeScreen, openScreen } from './ui.ts';
import { conferenceFixture, duelFixture, gymFixture } from './fixtures/depth-v26.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=26');
  await page.locator('#import-save').setInputFiles({ name: 'depth.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
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
async function endTurn(page: Page) {
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
}

test('gym lineup picker: equal size, matchup grid, estimate, suggested lineup, challenge with the chosen Pokémon (real AI save)', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = gymFixture(), unit = fixture.state.units[fixture.id]! as { position: { q: number; r: number } };
  await importSave(page, fixture.save);
  await clickTile(page, hexToIndex(unit.position, fixture.state.map)!);
  await expect(page.locator('#gym-unit')).toBeVisible();
  await page.locator('#gym-unit').click();
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  const before = await view(page), circuit = before.expansion!.gymCircuit!, held = circuit.badges[0]?.length ?? 0;
  const gymId = circuit.gyms.find(gym => gym.position.q === unit.position.q && gym.position.r === unit.position.r)!.id;
  const size = [1, 1, 2, 2, 2, 3, 3, 3][Math.min(7, held)];
  await expect(picker.locator('.lp-row')).toHaveCount(size);
  await expect(picker.locator('#lineup-grid tbody tr')).toHaveCount(size);
  await expect(picker.locator('#lineup-estimate')).toHaveText(/^\d+%$/);
  // Remove one pick (the challenge is refused: equal size), add one from the pool, move it up with [.
  await picker.locator('[data-remove]').last().click();
  await expect(picker.locator('.lp-row')).toHaveCount(size - 1);
  await expect(picker.locator('#lineup-confirm')).toBeDisabled();
  await expect(picker.locator('#lineup-blocker')).toContainText(`正好带 ${size} 只`);
  await picker.locator('[data-add]').first().click();
  await expect(picker.locator('.lp-row')).toHaveCount(size);
  if (size > 1) {
    const last = picker.locator('.lp-row').last(), id = await last.getAttribute('data-unit');
    await last.focus();
    await page.keyboard.press('[');
    await expect(picker.locator('.lp-row').nth(size - 2)).toHaveAttribute('data-unit', id!);
  }
  await picker.locator('#lineup-suggest').click();
  await expect(picker.locator('#lineup-estimate')).toHaveText(/^\d+%$/);
  const chosen = await picker.locator('.lp-row').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.unit)));
  await page.screenshot({ path: `${reports}/depth-v26-lineup-gym.png` });
  await picker.locator('#lineup-confirm').click();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await view(page)).expansion!.gymCircuit!.readyAt[gymId] ?? null).toBe(before.round + 3);
  const after = await view(page);
  expect(chosen.every(id => after.units.find(item => item.id === id)?.actionLeft === 0)).toBe(true);
  const round = after.round;
  await endTurn(page);
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBe(round + 1);
  expect(errors).toEqual([]);
});

test('conference lineup picker: six Pokémon, the announced NPC teams, register and re-order with the keyboard (real AI save)', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = conferenceFixture();
  await importSave(page, fixture.save);
  await openScreen(page, 'world');
  const league = page.locator('details[data-system="s27-championship"]');
  await league.locator('summary').first().click();
  await expect(league).toContainText('本届公布的联盟训练家');
  await league.locator('[data-lineup="championship:"]').click();
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.lp-row')).toHaveCount(6);
  await expect(picker.locator('#lineup-grid tbody tr')).toHaveCount(6);
  const tabs = picker.locator('[data-opponent]');
  if (await tabs.count() > 1) { await tabs.nth(1).click(); await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true'); }
  await page.screenshot({ path: `${reports}/depth-v26-lineup-conference.png` });
  const order = await picker.locator('.lp-row').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.unit)));
  await picker.locator('#lineup-confirm').click();
  await expect.poll(async () => (await view(page)).expansion!.civilization.championship.registration?.unitIds ?? null).toEqual(order);
  // Re-registering changes the order: move the first Pokémon down one place with ].
  await league.locator('[data-lineup="championship:"]').click();
  await expect(picker).toBeVisible();
  await picker.locator('.lp-row').first().focus();
  await page.keyboard.press(']');
  await expect(picker.locator('.lp-row').nth(1)).toHaveAttribute('data-unit', String(order[0]));
  await picker.locator('#lineup-confirm').click();
  await expect.poll(async () => (await view(page)).expansion!.civilization.championship.registration?.unitIds ?? null).toEqual([order[1], order[0], ...order.slice(2)]);
  await closeScreen(page);
  const round = (await view(page)).round;
  await endTurn(page);
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBe(round + 1);
  expect(errors).toEqual([]);
});

test('rival duel: the unit bar opens the picker with the stake row; a friendly duel is fought with the chosen Pokémon (real AI save)', async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = duelFixture(), unit = fixture.state.units[fixture.id]! as { position: { q: number; r: number } };
  await importSave(page, fixture.save);
  await clickTile(page, hexToIndex(unit.position, fixture.state.map)!);
  await expect(page.locator('#duel-unit')).toBeEnabled();
  await page.keyboard.press('d');
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  const rivals = (await view(page)).expansion!.rivals!;
  await expect(picker.locator('.lp-row')).toHaveCount(rivals.activeUnitIds.length);
  await expect(picker.locator('#lineup-stake-note')).toContainText('真剑');
  await picker.locator('[data-stake="spar"]').click();
  await expect(picker.locator('[data-stake="spar"]')).toHaveAttribute('aria-checked', 'true');
  await expect(picker.locator('#lineup-stake-note')).toContainText('切磋');
  await expect(picker.locator('#lineup-estimate')).toHaveText(/^\d+%$/);
  await page.screenshot({ path: `${reports}/depth-v26-duel.png` });
  const chosen = await picker.locator('.lp-row').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.unit)));
  await picker.locator('#lineup-confirm').click();
  await expect.poll(async () => (await view(page)).expansion!.rivals!.duels?.spar ?? 0).toBe((rivals.duels?.spar ?? 0) + 1);
  const after = await view(page);
  expect(chosen.every(id => after.units.find(item => item.id === id)?.actionLeft === 0)).toBe(true);
  const round = after.round;
  await endTurn(page);
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBe(round + 1);
  expect(errors).toEqual([]);
});
