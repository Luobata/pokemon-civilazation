import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createGame } from '../../src/core/game.ts';
import { canEnter } from '../../src/core/movement.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameState } from '../../src/core/model.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { deserializeSave } from '../../src/app/save.ts';
import { GameSession } from '../../src/app/session.ts';
import { openScreen, closeScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
}
async function clickHex(page: Page, hex: Hex) {
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath), { toScreen, hexToWorld } = await import(cameraPath);
    const p = toScreen(hexToWorld(hex), camera), rect = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: p.x + rect.x, y: p.y + rect.y };
  }, hex);
  await page.mouse.click(point.x, point.y);
}
// Test planning uses the deterministic map to find a short route. All actual
// movement, round and founding commands below go through browser controls.
function foundingRoute(initial: GameState, unitId: number): Hex[] {
  const unit = initial.units[unitId];
  if (!isMapUnit(unit)) throw new Error('Founding fixture must start on map');
  const origin = hexToIndex(unit.position, initial.map)!;
  const occupied = new Set(Object.values(initial.units).flatMap(u => u.id !== unitId && isMapUnit(u) ? [hexToIndex(u.position, initial.map)] : []));
  const routes = new Map<number, Hex[]>([[origin, []]]), pending = [origin];
  while (pending.length) {
    const index = pending.shift()!, route = routes.get(index)!, position = indexToHex(index, initial.map);
    if (Object.values(initial.cities).every(c => hexDistance(c.position, position) >= 4)) return route;
    for (const next of neighbors(position)) {
      const id = hexToIndex(next, initial.map);
      if (id !== null && !routes.has(id) && !occupied.has(id) && canEnter(unit, initial.map.tiles[id])
        && !Object.values(initial.cities).some(c => c.ownerId !== unit.ownerId && hexToIndex(c.position, initial.map) === id)) {
        routes.set(id, [...route, next]); pending.push(id);
      }
    }
  }
  throw new Error('Fixture has no reachable founding site');
}

test('found city, finish production, save/load JSON and continue identically in browser and Node', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?seed=12345'); await page.locator('#animate').uncheck();
  const initial = await state(page), settler = Object.values(initial.units).find(u => u.ownerId === 0 && u.kind === 'logistics')!;
  const route = foundingRoute(createGame(initial.setup), settler.id);
  // v16: the settler starts beside the capital, so the route is shorter than when it started on the capital.
  expect(route.length).toBeGreaterThanOrEqual(2);
  for (const destination of route) {
    const current = (await state(page)).units[settler.id];
    if (!isMapUnit(current)) throw new Error('Settler must remain on map before founding');
    await clickHex(page, current.position);
    await clickHex(page, destination);
    await expect.poll(async () => { const unit = (await state(page)).units[settler.id]; return isMapUnit(unit) ? unit.position : null; }).toEqual(destination);
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#selection')).toContainText('行动点 1');
  }
  await page.locator('#found-city').click();
  const founded = await state(page), newCity = Object.values(founded.cities).filter(c => c.ownerId === 0).at(-1)!;
  expect(founded.units[settler.id]).toBeUndefined(); expect(newCity.population).toBe(1);
  await expect(page.locator('#city-summary')).toContainText(`城市 ${newCity.id}`);
  await page.locator('#production-item').selectOption({ label: '友好商店 (40)' }); await page.locator('#add-production').click();
  await expect(page.locator('#production-queue')).toContainText('友好商店0/40');
  let completed = false;
  for (let i = 0; i < 40; i++) {
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#end-turn')).toBeEnabled();
    if ((await state(page)).cities[newCity.id].buildingIds.includes('meetingHall')) { completed = true; break; }
  }
  expect(completed).toBe(true); await expect(page.locator('#production-queue li')).toHaveCount(0);
  // Work can deliberately remain empty, and selecting research consumes reserve only at the next round end.
  await page.locator('[data-city-section="citizens"]').click();
  const checkedWork = page.locator('#economy [data-work]:checked');
  while (await checkedWork.count()) {
    const id = await checkedWork.first().getAttribute('data-work');
    await page.locator(`[data-work="${id}"]`).uncheck();
  }
  await openScreen(page, 'research');
  await page.locator('#research-topic').selectOption('domestication'); await page.locator('#set-research').click();
  await openScreen(page, 'menu');
  await page.locator('#save-game').click(); const saved = await state(page);
  await openScreen(page, 'menu');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-save').click();
  const download = await downloadPromise, text = await readFile((await download.path())!, 'utf8');
  expect(canonicalSerialize(deserializeSave(text).state)).toBe(canonicalSerialize(saved));
  const node = new GameSession(saved.setup); node.load(text);
  await closeScreen(page);
  for (let i = 0; i < 3; i++) { await page.locator('#end-turn').click({ modifiers: ['Shift'] }); node.issue({ type: 'EndTurn' }); }
  const uninterrupted = await state(page); expect(stateDigest(node.getState())).toBe(stateDigest(uninterrupted));
  await openScreen(page, 'menu');
  await page.locator('#load-game').click(); expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(saved));
  await closeScreen(page);
  for (let i = 0; i < 3; i++) await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(uninterrupted));
  await page.locator('#import-save').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect.poll(async () => stateDigest(await state(page))).toBe(stateDigest(saved));
  await page.locator('#city-select').selectOption(String(newCity.id));
  await page.locator('#city-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${reports}/ui2-city.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('work locking, queue reorder/cancel, purchases and version refusal use UI', async ({ page }) => {
  await page.goto('/'); await page.locator('#animate').uncheck();
  const cityId = (await state(page)).cities[1].id;
  await page.locator('[data-city-section="citizens"]').click();
  const first = page.locator('#economy [data-work]:checked').first(); const tileId = await first.getAttribute('data-work');
  await page.locator(`[data-lock="${tileId}"]`).check(); expect((await state(page)).cities[cityId].lockedTileIds).toContain(Number(tileId));
  await page.locator(`[data-work="${tileId}"]`).uncheck(); expect((await state(page)).cities[cityId].lockedTileIds).not.toContain(Number(tileId));
  await page.locator('[data-city-section="production"]').click();
  await page.locator('[data-production-kind="logistics"]').click();
  await page.locator('#production-item').selectOption({ label: '开拓队 (24)' }); await page.locator('#add-production').click();
  await page.locator('[data-production-kind="pokemon"]').click();
  await page.locator('#production-item').selectOption({ label: '【远程】妙蛙种子 (19)' }); await page.locator('#add-production').click();
  await page.locator('[data-up="1"]').click(); await expect(page.locator('#production-queue li').first()).toContainText('妙蛙种子');
  await page.locator('[data-remove="1"]').click(); await expect(page.locator('#production-queue li')).toHaveCount(1);
  await openScreen(page, 'research');
  await page.locator('#research-topic').selectOption('domestication'); await page.locator('#set-research').click();
  await closeScreen(page);
  for (let i = 0; i < 20 && !(await state(page)).players[0].research.unlockedIds.includes('domestication'); i++) await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  expect((await state(page)).players[0].research.unlockedIds).toContain('domestication');
  const goldBefore = (await state(page)).players[0].gold;
  await page.locator('[data-city-section="supplies"]').click();
  await page.locator('#buy-ball').click(); expect((await state(page)).players[0].gold).toBe(goldBefore - 20);
  expect((await state(page)).players[0].ballInventory.pokeBall).toBe(1);
  const before = await state(page);
  const badSave = await page.evaluate(async () => { const path = '/src/browser/main.ts'; const save = JSON.parse((await import(path)).developerAdapter.save()); save.rulesVersion = 'm1-v1'; return JSON.stringify(save); });
  await page.locator('#import-save').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(badSave) });
  await expect(page.locator('#debug')).toContainText('版本不匹配'); expect(stateDigest(await state(page))).toBe(stateDigest(before));
});
