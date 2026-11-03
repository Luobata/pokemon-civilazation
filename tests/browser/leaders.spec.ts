import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameSession, replay } from '../../src/app/session.ts';
import { LEADERS, LEADER_IDS } from '../../src/content/leaders.ts';
import type { GameState } from '../../src/core/model.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { outcomeSave } from './fixtures/diplomacy.ts';
import { openScreen, closeScreen, startNewGame } from './ui.ts';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}
async function importSave(page: Page, text: string) {
  await page.locator('#import-save').setInputFiles({ name: 'leaders.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
}

test('every leader applies only to a new game and pairs independently with the starter', async ({ page }) => {
  await page.goto('/');
  await page.locator('#animate').uncheck();
  await expect(page.locator('input[name="leader"]')).toHaveCount(LEADER_IDS.length);
  await openScreen(page, 'menu');
  await page.locator('#starter').selectOption('charmander');
  for (const leaderId of LEADER_IDS) {
    const before = await state(page);
    await openScreen(page, 'menu');
    await page.locator(`input[name="leader"][value="${leaderId}"]`).check();
    expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(before));
    await expect(page.locator('#leader-panel')).toContainText(LEADERS[before.players[0].leaderId!].name);
    await startNewGame(page);
    const after = await state(page);
    expect(after.players[0]).toMatchObject({ starterId: 'charmander', leaderId });
    const seated = after.setup.players.map(player => player.leaderId);
    expect(seated[0]).toBe(leaderId);
    expect(seated.every(id => id !== undefined && LEADER_IDS.includes(id))).toBe(true);
    expect(new Set(Object.values(after.players).map(player => player.leaderId)).size).toBe(4);
    await expect(page.locator('#leader-panel')).toContainText(LEADERS[leaderId].ability);
    await expect(page.locator('#leader-panel')).toContainText(LEADERS[leaderId].description);
    await expect(page.locator('#leader-panel')).toContainText('小火龙');
    for (const other of seated.slice(1)) await expect(page.locator('#diplomacy')).toContainText(LEADERS[other!].name);
    const image = page.locator(`#leader-panel img[src$="/${leaderId}.svg"]`);
    await openScreen(page, 'leader');
    await expect(image).toBeVisible();
    await closeScreen(page);
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
});

test('leader research is reflected in the UI and leader identity survives save/load and replay', async ({ page }) => {
  await page.goto('/');
  await page.locator('#animate').uncheck();
  await expect(page.locator('#hud-research')).toContainText('2');
  await openScreen(page, 'research');
  await page.locator('#research-topic').selectOption('domestication');
  await openScreen(page, 'research');
  await page.locator('#set-research').click();
  await closeScreen(page);
  await page.locator('#end-turn').click();
  expect((await state(page)).players[0].research.progressByTech.domestication).toBe(2);
  await openScreen(page, 'menu');
  await page.locator('#save-game').click();
  const saved = await state(page);
  const log = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.exportLog(); });
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(saved));
  await openScreen(page, 'menu');
  await page.locator('input[name="leader"][value="joy"]').check();
  await startNewGame(page);
  await expect(page.locator('#leader-panel')).toContainText('乔伊小姐');
  await openScreen(page, 'menu');
  await page.locator('#load-game').click();
  expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(saved));
  await expect(page.locator('#leader-panel')).toContainText('大木博士');
  await expect(page.locator('#leader-panel')).toContainText('图鉴研究');
});

test('legacy save keeps its state and original starter rules until a new leader game is started', async ({ page }) => {
  const legacy = new GameSession({ seed: 12345, width: 24, height: 16,
    players: [{ id: 0, controller: 'human', starterId: 'squirtle' }, { id: 1, controller: 'ai' }] });
  await page.goto('/');
  await importSave(page, legacy.save());
  await expect(page.locator('#leader-panel')).toContainText('氏族领袖');
  await expect(page.locator('#leader-panel')).toContainText('杰尼龟');
  const loaded = await state(page);
  expect(loaded.players[0]).not.toHaveProperty('leaderId');
  expect(canonicalSerialize(loaded)).toBe(canonicalSerialize(legacy.getState()));
  await openScreen(page, 'menu');
  await page.locator('input[name="leader"][value="jenny"]').check();
  expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(loaded));
  await expect(page.locator('#leader-panel')).toContainText('氏族领袖');
});

test('a finished game allows choosing a different leader and starter for the next game', async ({ page }) => {
  await page.goto('/');
  await importSave(page, outcomeSave('score'));
  await page.locator('#gameover-close').click();
  await openScreen(page, 'menu');
  await page.locator('input[name="leader"][value="lance"]').check();
  await openScreen(page, 'menu');
  await page.locator('#starter').selectOption('squirtle');
  await startNewGame(page);
  const started = await state(page);
  expect(started.players[0]).toMatchObject({ leaderId: 'lance', starterId: 'squirtle' });
  expect(started.outcome).toBeNull();
  await expect(page.locator('#end-turn')).toBeEnabled();
});

for (const width of [390, 768, 1280]) test(`leader cards and skill descriptions fit ${width}px without overflow`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openScreen(page, 'leader');
  await page.locator('#choose-leader').click();
  const choices = page.locator('input[name="leader"]');
  await expect(choices).toHaveCount(LEADER_IDS.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const leaderId of LEADER_IDS) {
    const radio = page.locator(`input[name="leader"][value="${leaderId}"]`);
    await expect(radio).toBeEnabled();
    // Players click the card; the radio itself is a 1px visually hidden input.
    await page.locator(`label.leader-choice:has(input[value="${leaderId}"])`).click();
    await expect(radio).toBeChecked();
  }
  await page.screenshot({ path: `test-results/screenshots/leaders-${width}.png`, fullPage: false });
});
