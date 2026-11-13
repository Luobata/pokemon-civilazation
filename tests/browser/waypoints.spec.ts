// v26 §7.1 go-to orders and §7.3 suggested city sites (presentation only), in real games: the AI plays every other seat with its
// real planner, the player uses real input (action bar, hotkeys, right-click, pins) and ends turns with Shift+click.
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { isCitySite } from '../../src/ai/query.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameState, PlayerView } from '../../src/core/model.ts';
import { planGoTo } from '../../src/browser/waypoints.ts';

const SHOTS = 'test-results/screenshots/waypoints';
mkdirSync(SHOTS, { recursive: true });

const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
const debugView = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getDebugView(); });
const playerView = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });

/** Screen point of a tile (the copy nearest the view centre on a wrapping map). */
async function tilePoint(page: Page, hex: Hex) {
  return page.evaluate(async hex => {
    const main = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(main), { tileToScreen } = await import(cameraPath);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!, rect = canvas.getBoundingClientRect();
    const p = tileToScreen(hex, camera, session.getView().map, canvas.clientWidth);
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, hex);
}
/** Ends the turn with Shift+click (skipping the to-do flow) and waits for the next round of the player. */
async function endTurn(page: Page) {
  const round = (await playerView(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await playerView(page)).round).toBeGreaterThan(round);
  await expect(page.locator('#end-turn')).toBeEnabled();
}
async function start(page: Page) {
  await page.goto('/?seed=12345&size=24x16');
  await page.locator('#animate').uncheck();
  await expect(page.locator('#end-turn')).toBeEnabled();
}
async function selectUnit(page: Page, id: number) {
  await page.locator('#unit-select').selectOption(String(id));
  await page.locator('#map').focus();
  await expect(page.locator('#unit-action-bar')).toBeVisible();
}

test('a settler ordered 6+ tiles away walks there over several turns, then founds the city', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  const view = await playerView(page), debug = await debugView(page);
  const settler = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  // A site the authority will accept on arrival (test-side knowledge), planned by the client from the player's own view.
  const target = debug.map.tiles.map((biome, index) => ({ biome, hex: indexToHex(index, debug.map) }))
    .filter(tile => tile.biome !== null && tile.biome !== 'ocean' && hexDistance(tile.hex, settler.position, debug.map) >= 6
      && hexDistance(tile.hex, settler.position, debug.map) <= 8 && isCitySite(debug, tile.hex) && planGoTo(view, settler.id, tile.hex))
    .sort((a, b) => hexDistance(a.hex, settler.position, debug.map) - hexDistance(b.hex, settler.position, debug.map))[0]!.hex;
  await selectUnit(page, settler.id);
  const bar = page.locator('#unit-action-bar');
  await expect(bar.locator('#goto-unit kbd')).toHaveText('W');
  await expect(bar.locator('#goto-unit img.px-icon')).toHaveCount(1);
  // The whole map in view, then W and a click on the far tile: a dashed route with turn numbers.
  await page.keyboard.press('f');
  await page.keyboard.press('w');
  await expect(page.locator('#action-notice')).toContainText('前往模式');
  await expect(bar.locator('#goto-unit')).toHaveAttribute('aria-pressed', 'true');
  const point = await tilePoint(page, target);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#map-tooltip')).toContainText('前往：约');
  await page.screenshot({ path: `${SHOTS}/01-goto-preview.png` });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#action-notice')).toContainText('已设路标');
  await expect(bar.locator('#cancel-goto-unit')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-goto-route.png` });
  const log = (await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.exportLog(); })).commands.length;

  let turns = 0;
  for (; turns < 15 && !(await page.locator('#action-notice').textContent())?.includes('已到达路标'); turns++) {
    // A unit on a go-to order is not waiting for orders: no settler reminder for it.
    if (turns === 1) await expect(page.locator('#turn-reminders')).not.toContainText('开拓队：去建新城');
    await endTurn(page);
    const notice = await page.locator('#action-notice').textContent() ?? '';
    // A hostile sighting stops the order (Civilization-style); the player looks and sends the settler on again.
    if (notice.includes('路标已取消') && !notice.includes('已到达')) {
      await selectUnit(page, settler.id);
      const again = await tilePoint(page, target);
      await page.mouse.click(again.x, again.y, { button: 'right' });
      await expect(page.locator('#action-notice')).toContainText('已设路标');
    }
  }
  expect(turns).toBeGreaterThan(1);
  await expect(page.locator('#action-notice')).toContainText('已到达路标');
  const arrivedAt = (await state(page)).units[settler.id];
  expect(arrivedAt?.position ? hexDistance(arrivedAt.position, target, debug.map) : -1).toBe(0);
  // Every step was an ordinary Move command; the arrived settler is selected and 建城 asks for attention (no pulse: reduced motion).
  const human = (await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.exportLog(); })).commands.slice(log).filter((command: { actorId: number }) => command.actorId === 0);
  expect(new Set(human.map((command: { action: { type: string } }) => command.action.type))).toEqual(new Set(['Move', 'EndTurn']));
  // Arriving spends the settler's moves: next turn it is selected with 建城 highlighted (it never founds by itself).
  const found = bar.locator('#found-city');
  if (await found.isDisabled()) await endTurn(page);
  await expect(page.locator('#action-notice')).toContainText('点「建城」');
  await expect(found).toBeEnabled();
  await expect(found).toHaveClass(/attention/);
  expect(await found.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.screenshot({ path: `${SHOTS}/03-arrived.png` });
  const cities = (await playerView(page)).economy.cities.length;
  await page.locator('#map').focus();
  await page.keyboard.press('b');
  await expect.poll(async () => (await playerView(page)).economy.cities.length).toBe(cities + 1);
  await page.screenshot({ path: `${SHOTS}/04-founded.png` });
});

test('a go-to order stops when a hostile comes into sight next to the unit', async ({ page }) => {
  await start(page);
  const view = await playerView(page), debug = await debugView(page);
  const pokemon = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  // A wild Pokémon the player cannot see yet; the order heads for it, so it comes into sight on the way.
  const wild = debug.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon' && !view.units.some(seen => seen.id === unit.id))
    .map(unit => ({ unit, distance: hexDistance(unit.position, pokemon.position, debug.map) })).filter(item => item.distance >= 5 && item.distance <= 9 && planGoTo(view, pokemon.id, item.unit.position))
    .sort((a, b) => a.distance - b.distance || a.unit.id - b.unit.id)[0]!.unit;
  await selectUnit(page, pokemon.id);
  await page.keyboard.press('f');
  const point = await tilePoint(page, wild.position);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  // The order is set and its first step taken at once; that step may already bring the wild Pokémon into sight.
  await expect(page.locator('#action-notice')).toContainText(/已设路标|附近出现敌对单位/);
  let stopped = '';
  for (let turn = 0; turn < 10 && !stopped; turn++) {
    const notice = await page.locator('#action-notice').textContent() ?? '';
    if (notice.includes('路标已取消')) { stopped = notice; break; }
    await endTurn(page);
  }
  if (!stopped) stopped = await page.locator('#action-notice').textContent() ?? '';
  expect(stopped).toContain('附近出现敌对单位，路标已取消');
  // The unit is back among the units waiting for orders; its bar offers 前往 again, without 停止.
  await selectUnit(page, pokemon.id);
  await expect(page.locator('#cancel-goto-unit')).toHaveCount(0);
  const now = await playerView(page);
  expect(now.units.some(unit => unit.ownerId === null && hexDistance(unit.position, now.units.find(own => own.id === pokemon.id)!.position, now.map) <= 2)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/05-enemy-stop.png` });
});

test('suggested city sites: up to three pins with reasons, no unexplored tiles (site and its first ring), one click sets the go-to', async ({ page }) => {
  await start(page);
  const view = await playerView(page), settler = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  // Walk out of the capital's ring (a go-to order, re-sent if a sighting stops it) until the settler has seen a second site.
  const far = view.map.tiles.map((_, index) => indexToHex(index, view.map)).filter(hex => hexDistance(hex, settler.position, view.map) === 7)
    .find(hex => planGoTo(view, settler.id, hex))!;
  for (let round = 0; round < 8; round++) {
    await selectUnit(page, settler.id);
    if (await page.locator('#site-pins .site-pin').count() >= 2) break;
    if (!await page.locator('#cancel-goto-unit').count()) {
      await page.keyboard.press('f');
      const point = await tilePoint(page, far);
      await page.mouse.click(point.x, point.y, { button: 'right' });
    }
    await endTurn(page);
  }
  await selectUnit(page, settler.id);
  // Stop here (unless a hostile sighting already stopped the order).
  if (await page.locator('#cancel-goto-unit').count()) await page.locator('#cancel-goto-unit').click();
  const pins = page.locator('#site-pins .site-pin:not([hidden])');
  await expect.poll(() => pins.count()).toBeGreaterThan(0);
  expect(await pins.count()).toBeLessThanOrEqual(3);
  const tiles = await page.locator('#site-pins .site-pin').evaluateAll(items => items.map(item => Number((item as HTMLElement).dataset.tile)));
  const seen = await playerView(page);
  for (const tile of tiles) {
    const site = indexToHex(tile, seen.map);
    for (const index of seen.map.tiles.keys()) if (hexDistance(indexToHex(index, seen.map), site, seen.map) <= 1) expect(seen.map.tiles[index], `tile ${index} of site ${tile}`).not.toBeNull();
    expect(seen.map.tiles[tile]).not.toBe('ocean');
  }
  // The hover card names the reasons with icons; it stays under the HUD (action bar, rail, objective card).
  const first = page.locator('#site-pins .site-pin-button').first();
  await first.hover();
  const card = page.locator('#site-pins .site-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.icon-stat')).not.toHaveCount(0);
  await expect(card.locator('[aria-label^="预计回合"]')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/06-site-pins.png` });
  for (const selector of ['#unit-action-bar', '.turn-block']) {
    const box = (await page.locator(selector).boundingBox())!;
    const hit = await page.evaluate(({ x, y, selector }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)), { x: box.x + box.width / 2, y: box.y + box.height / 2, selector });
    expect(hit, `${selector} stays on top of the pins`).toBe(true);
  }
  // A pin away from the settler sets the go-to (a pin on its own tile says to found the city there instead).
  const here = (await playerView(page)).units.find(unit => unit.id === settler.id)!.position;
  const away = tiles.findIndex(tile => hexDistance(indexToHex(tile, seen.map), here, seen.map) > 0);
  expect(away).toBeGreaterThanOrEqual(0);
  await page.locator('#site-pins .site-pin-button').nth(away).click();
  await expect(page.locator('#action-notice')).toContainText('已设路标（推荐城址）');
  await expect(page.locator('#cancel-goto-unit')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-site-goto.png` });
});
