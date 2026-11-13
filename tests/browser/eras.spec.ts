import { expect, test } from '@playwright/test';
import { GameSession } from '../../src/app/session.ts';
import type { Command, GameState } from '../../src/core/model.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import type { TechId } from '../../src/content/economy.ts';
import { createNodeServer } from '../../server/server.ts';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openScreen, startNewGame } from './ui.ts';

async function state(page: import('@playwright/test').Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}

function researchedSave(mode: EraProgression, count: number): string {
  const session = new GameSession({ seed: 12345, width: 24, height: 16, expansionVersion: 1, eraProgression: mode,
    multiplayer: true, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] });
  const issue = (action: Command['action']) => {
    const current = session.getState();
    const result = session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action });
    if (!result.ok) throw new Error(result.reason);
  };
  issue({ type: 'SetProductionQueue', cityId: session.getView().economy.player.headquartersCityId,
    orders: [{ item: { kind: 'building', defId: 'observatory' } }] });
  const techs: TechId[] = ['domestication', 'berryCultivation', 'stoneCraft', 'ballCraft', 'typeResearch', 'riding', 'fieldObservation'];
  for (const techId of techs.slice(0, count)) {
    issue({ type: 'SetResearch', techId });
    while (!session.getState().players[0].research.unlockedIds.includes(techId)) {
      issue({ type: 'EndTurn' }); issue({ type: 'EndTurn' });
      if (session.getState().outcome) throw new Error('Era fixture reached round limit');
    }
  }
  return session.save();
}

test('new games default to three eras; full mode keeps the selected round limit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#era-progression')).toHaveValue('simple-v1');
  expect((await state(page)).setup).toMatchObject({ eraProgression: 'simple-v1', roundLimit: 200 });
  await expect(page.locator('#era-panel')).toContainText('还需 7 项科技');
  await expect(page.locator('#era-panel')).toContainText('侦察');
  await openScreen(page, 'menu');
  await page.locator('#era-progression').selectOption('full-v1');
  expect((await state(page)).setup.eraProgression).toBe('simple-v1');
  await startNewGame(page);
  expect((await state(page)).setup).toMatchObject({ eraProgression: 'full-v1', roundLimit: 200 });
  await expect(page.locator('#era-panel')).toContainText('完整时代');
  await expect(page.locator('#era-panel')).toContainText('还需 2 项科技');
});

test('multiplayer submits selected eras and leaders and restores its panel after refresh', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'pokemon-browser-eras-'));
  const server = createNodeServer({ persistenceDirectory: directory });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('/multiplayer.html');
    await page.locator('#api-base-url').fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await page.locator('#room-era-mode').selectOption('full-v1');
    await page.locator('[data-seat-leader="0"]').selectOption('joy');
    await page.locator('[data-seat-leader="1"]').selectOption('lance');
    await page.locator('#create-room').click();
    await expect(page.locator('#invite-list a')).toHaveCount(2);
    const invite = await page.locator('#invite-list a').first().getAttribute('href');
    await page.locator('#room-url').fill(invite!);
    await page.locator('#join-room').click();
    await expect(page.locator('#era-panel')).toContainText('完整时代');
    await expect(page.locator('#era-panel')).toContainText('乔伊小姐');
    await page.locator('#save-room').click();
    await expect(page.locator('#network-notice')).toContainText('已保存');
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#connection-status')).toContainText('等待文明 2');
    await expect(page.locator('#end-turn')).toBeDisabled();
    await page.locator('#load-room').click();
    await expect(page.locator('#network-notice')).toContainText('已读取');
    await expect(page.locator('#connection-status')).toContainText('轮到你行动');
    await expect(page.locator('#end-turn')).toBeEnabled();
    await page.reload();
    await expect(page.locator('#era-panel')).toContainText('完整时代');
    await expect(page.locator('#era-panel')).toContainText('乔伊小姐');
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

for (const count of [3, 7]) test(`legal research history restores compact era ${count}`, async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-save').setInputFiles({ name: 'era.json', mimeType: 'application/json', buffer: Buffer.from(researchedSave('simple-v1', count)) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await expect(page.locator('#era-panel')).toContainText(count === 3 ? '金银时代' : '宝石时代');
  expect((await state(page)).players[0].research.unlockedIds).toHaveLength(count);
});

test('legacy expansion save keeps its original rules and hides the era panel', async ({ page }) => {
  const old = new GameSession({ seed: 12345, width: 24, height: 16, expansionVersion: 1,
    players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai' }] });
  await page.goto('/');
  await page.locator('#import-save').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(old.save()) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  expect((await state(page)).setup).not.toHaveProperty('eraProgression');
  await expect(page.locator('#era-panel')).toBeEmpty();
  await expect(page.locator('#hud-research')).toContainText('1');
});

for (const width of [390, 768]) test(`era panel and multiplayer leader settings fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.locator('#era-panel')).toContainText('初代');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/multiplayer.html');
  await expect(page.locator('#room-era-mode')).toHaveValue('simple-v1');
  await page.locator('#room-seats').selectOption('4');
  await expect(page.locator('[data-seat-leader]')).toHaveCount(4);
  await page.locator('[data-seat-leader="0"]').selectOption('joy');
  await page.locator('#room-seats').selectOption('2');
  await expect(page.locator('[data-seat-leader="0"]')).toHaveValue('joy');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
