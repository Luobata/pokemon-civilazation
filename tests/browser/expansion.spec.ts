import { expect, test } from '@playwright/test';
import { createNodeServer } from '../../server/server.ts';
import { HEX_RADIUS, hexToWorld } from '../../src/browser/camera.ts';
import { indexToHex } from '../../src/core/hex.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import type { AddressInfo } from 'node:net';
import { openScreen } from './ui.ts';

test('new games expose real leader abilities, cooldowns and all expansion systems', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seed=77');
  await page.locator('#animate').uncheck();
  await openScreen(page, 'world');
  const leaders = page.locator('#expansion-panel details[data-system="leaders-active"]');
  await leaders.locator('summary').click();
  await leaders.getByRole('button', { name: '研究突破', exact: true }).click();
  await expect(page.locator('#hud-gold')).toContainText('30');
  await expect(leaders).toContainText('第 9 轮');
  await expect(leaders.getByRole('button', { name: '研究突破', exact: true })).toBeDisabled();
  expect(await page.locator('#expansion-panel details').count()).toBeGreaterThanOrEqual(9);
  await expect(page.locator('#expansion-panel details[data-system="s38-rare-berries"]')).toHaveCount(1);
  const faith = page.locator('#expansion-panel details[data-system="s40-faith"]');
  await faith.locator('summary').click();
  await expect(faith).toContainText('尚无信仰');
  await expect(faith.locator('#found-faith')).toBeDisabled();
  const tenets = faith.locator('[data-tenet]');
  await tenets.nth(0).check();
  await tenets.nth(1).check();
  await expect(tenets.nth(2)).toBeDisabled();
  await tenets.nth(1).uncheck();
  await expect(tenets.nth(2)).toBeEnabled();
  expect(await faith.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await openScreen(page, 'menu');
  await page.locator('#save-game').click();
  await openScreen(page, 'menu');
  await page.locator('#load-game').click();
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  expect(errors).toEqual([]);
});

test('editor validates modified content and executes commands in its isolated engine', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor.html');
  const content = await page.locator('#content-editor').inputValue();
  const draft = JSON.parse(content); draft.balls.pokeBall.goldCost += 1;
  await page.locator('#content-editor').fill(JSON.stringify(draft));
  await page.locator('#validate-content').click();
  await expect(page.locator('#editor-notice')).toContainText('校验通过');
  await page.locator('#run-turn').click();
  await expect(page.locator('#simulation-result')).toContainText('序列 1');
  draft.species.bulbasaur.attack = 9999;
  await page.locator('#content-editor').fill(JSON.stringify(draft));
  await page.locator('#validate-content').click();
  await expect(page.locator('#editor-notice')).toHaveAttribute('data-state', 'error');
  expect(errors).toEqual([]);
});

test('two browser clients join authenticated seats, advance turns and reconnect', async ({ browser }) => {
  const server = createNodeServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext();
  try {
    const owner = await context.newPage(), guest = await context.newPage();
    await owner.goto('/multiplayer.html');
    await owner.locator('#api-base-url').fill(api);
    await owner.locator('#create-room').click();
    await expect(owner.locator('#invite-list a')).toHaveCount(2);
    const urls = await owner.locator('#invite-list a').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
    await owner.goto(urls[0]); await guest.goto(urls[1]);
    await expect(owner.locator('#connection-status')).toContainText('文明 1');
    await expect(guest.locator('#connection-status')).toContainText('文明 2');
    for (const panel of ['#unit-panel', '#economy', '#research-panel', '#diplomacy', '#expansion-panel']) {
      await expect(owner.locator(panel)).toBeVisible();
    }
    await owner.locator('#refresh').click();
    await expect(owner.locator('#invite-list')).toContainText('座位 2');
    await expect(owner.locator('#owner-token')).not.toHaveValue('');

    // Exercise the normal player path: panel button, highlighted reachable tiles,
    // and a real map click translated through the same camera projection.
    const ownerHash = new URL(owner.url()).hash.slice(1);
    const ownerParams = new URLSearchParams(ownerHash);
    const room = ownerParams.get('room')!, seatToken = ownerParams.get('token')!;
    const projected = await (await fetch(`${api}/api/rooms/${room}/state`, { headers: { authorization: `Bearer ${seatToken}` } })).json();
    const mover = projected.view.units.find((unit: { ownerId: number; actionLeft: number }) => unit.ownerId === projected.view.playerId && unit.actionLeft > 0);
    const destinationIndex = Number(Object.keys(reachablePaths(projected.view, mover.id))[0]);
    const destination = indexToHex(destinationIndex, projected.view.map);
    await owner.locator('#move-unit').click();
    await expect(owner.locator('#map-notice')).toContainText('移动模式');
    await owner.locator('#map').scrollIntoViewIfNeeded();
    const mapBox = await owner.locator('#map').boundingBox();
    const mapWidth = Math.sqrt(3) * HEX_RADIUS * (projected.view.map.width + 0.5);
    const mapHeight = HEX_RADIUS * (1.5 * (projected.view.map.height - 1) + 2);
    const zoom = Math.min((mapBox!.width - 36) / mapWidth, (mapBox!.height - 36) / mapHeight);
    const world = hexToWorld(destination);
    await owner.mouse.click(
      mapBox!.x + (mapBox!.width - mapWidth * zoom) / 2 + Math.sqrt(3) * HEX_RADIUS * zoom / 2 + world.x * zoom,
      mapBox!.y + (mapBox!.height - mapHeight * zoom) / 2 + HEX_RADIUS * zoom + world.y * zoom,
    );
    await expect(owner.locator('#network-notice')).toContainText('命令已接受');
    const moved = await (await fetch(`${api}/api/rooms/${room}/state`, { headers: { authorization: `Bearer ${seatToken}` } })).json();
    expect(moved.view.units.find((unit: { id: number }) => unit.id === mover.id).position).toEqual(destination);
    await owner.locator('#end-turn').click();
    await guest.locator('#refresh').click();
    await expect(guest.locator('#hud')).toContainText('当前文明 2');
    await guest.locator('#end-turn').click();
    await owner.reload();
    await expect(owner.locator('#connection-status')).toContainText('文明 1');
    await expect(owner.locator('#hud')).toContainText('第 2 轮');
    await expect(owner.locator('#export-room')).toBeEnabled();
    const download = owner.waitForEvent('download');
    await owner.locator('#export-room').click();
    await expect((await download).suggestedFilename()).toBe('pokemon-multiplayer-save.json');
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
