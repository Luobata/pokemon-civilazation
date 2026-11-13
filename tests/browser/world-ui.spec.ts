// depth-v26 §6 (presentation only): the world page opens on next-action cards with locate buttons and the conference
// bracket; the victory page shows a pixel banner, a route map and hover-card denominators per path. A real v24 game
// (the AI plays every seat, nothing patched) loaded through the menu; input is real clicks, hovers and Shift+click end turn.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { lateWorldFixture } from './fixtures/world-v24.ts';
import { closeScreen, openScreen } from './ui.ts';
import { observe } from '../../src/core/vision.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';

const shots = process.env.E2E_SCREENSHOT_DIR ? `${process.env.E2E_SCREENSHOT_DIR}/world-ui` : 'test-results/screenshots/world-ui';
const phase = process.env.WORLD_UI_PHASE ?? 'after';
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function expectNamedIcons(page: Page, root: string) {
  const unnamed = await page.evaluate(root => [...document.querySelectorAll<HTMLElement>(`${root} img.px-icon, ${root} img.px-art, ${root} [role="img"], ${root} button`)]
    .filter(element => element.closest('[hidden]') === null && element.closest('[aria-hidden="true"]') === null)
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !(element.getAttribute('alt') || element.getAttribute('aria-label') || element.textContent || '').trim())
    .map(element => element.outerHTML.slice(0, 120)), root);
  expect(unnamed).toEqual([]);
}
async function hoverTip(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  const card = page.locator('#ui-tip-card');
  await expect(card).toBeVisible();
  return card;
}
/** Camera state and the screen centre in world space, plus where the tile's nearest copy is drawn. */
const cameraAt = (page: Page, tile: number) => page.evaluate(async tile => {
  const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
  const { session, camera } = await import(mainPath), { hexToWorld, mapSpan, tileToScreen, toWorld } = await import(cameraPath), { indexToHex } = await import(hexPath);
  const canvas = document.querySelector<HTMLCanvasElement>('#map')!, map = session.getView().map;
  return { centre: toWorld({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, camera), size: { width: canvas.clientWidth, height: canvas.clientHeight },
    tileScreen: tileToScreen(indexToHex(tile, map), camera, map, canvas.clientWidth), tileWorld: hexToWorld(indexToHex(tile, map)), span: mapSpan(map), wrap: Boolean(map.wrap) };
}, tile);

test('world page: next-action cards from the own view only, locate centres the camera (nearest wrapped copy), bracket and hover cards', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = lateWorldFixture();
  await importSave(page, fixture.save);
  await openScreen(page, 'world');
  const panel = page.locator('#expansion-panel'), cards = panel.locator('.next-card');
  await expect(panel.locator('details').first()).toBeVisible();
  await page.screenshot({ path: `${shots}/${phase}-world.png` });
  if (phase === 'before') return;
  await expect(cards.first()).toBeVisible();
  await page.locator('.conference-bracket').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/${phase}-bracket.png` });

  // The cards come first; the old sections stay below them, under 规则与详情.
  const order = await panel.evaluate(root => [...root.children].map(element => element.className || element.tagName));
  expect(order[0]).toBe('next-cards');
  await expect(panel.locator('details[data-system="s-gym-circuit"]')).toHaveCount(1);
  await expect(panel.locator('details[data-system="s27-championship"]')).toContainText('四天王最多算 1 个');

  // Fog: every card target is a tile seat 0 knows, and none of the hidden sites leaks into a card.
  const view = observe(fixture.state, 0), known = new Set([...view.visibleTileIds, ...view.knowledge.exploredTileIds]), visible = new Set(view.visibleTileIds);
  const targets = await panel.locator('.next-card [data-locate-tile]').evaluateAll(buttons => buttons.map(button => ({
    card: button.closest<HTMLElement>('.next-card')!.dataset.card!, tile: Number((button as HTMLElement).dataset.locateTile) })));
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) expect(known.has(target.tile), `${target.card} → ${target.tile}`).toBe(true);
  for (const target of targets.filter(item => ['nest', 'capture', 'sanctuary'].includes(item.card))) expect(visible.has(target.tile), target.card).toBe(true);
  const expansion = fixture.state.expansion!;
  const hidden = new Set([
    ...expansion.gymCircuit!.gyms.filter(gym => !known.has(gym.tileIndex)).map(gym => gym.tileIndex),
    ...Object.values(expansion.world.nests).filter(nest => !visible.has(nest.tileIndex)).map(nest => nest.tileIndex),
    ...expansion.civilization.sanctuaries.map(site => hexToIndex(site.position, fixture.state.map)!).filter(tile => !visible.has(tile)),
    ...Object.values(fixture.state.units).filter(isMapUnit).filter(unit => unit.ownerId === null).map(unit => hexToIndex(unit.position, fixture.state.map)!).filter(tile => !visible.has(tile)),
    ...Object.values(expansion.legends?.sites ?? {}).filter(tile => tile !== undefined && !known.has(tile)) as number[],
  ]);
  expect(hidden.size, 'the fixture has sites the player cannot see').toBeGreaterThan(0);
  for (const target of targets) expect(hidden.has(target.tile), `${target.card} points at a hidden site`).toBe(false);

  // Icons carry their text; a card's hover card holds the details.
  await expectNamedIcons(page, '#expansion-panel .next-cards');
  await expectNamedIcons(page, '#expansion-panel .conference-bracket');
  const gymCard = panel.locator('.next-card[data-card="gym"]');
  await expect(gymCard).toHaveCount(1);
  let tip = await hoverTip(page, gymCard.locator('.next-text'));
  await expect(tip).toContainText('你的下一位馆主');
  await page.screenshot({ path: `${shots}/${phase}-world-hover.png` });

  // Bracket: five matches, the champion, the title denominator in a hover card.
  const bracket = page.locator('.conference-bracket');
  await expect(bracket.locator('.bracket-match')).toHaveCount(5);
  await expect(bracket.locator('.bracket-slot.won')).toHaveCount(5);
  tip = await hoverTip(page, bracket.locator('.title-count'));
  await expect(tip).toContainText('四天王最多算 1 个');

  // Civ-term hints still work on the page.
  await panel.locator('[data-civ-hint="overlord"]').hover();
  await expect(page.locator('#civ-hint-card')).toContainText('《文明 6》的城邦');

  // Locate: shift the camera by whole map copies first (the wrapped map looks the same), then click 定位 on the gym card.
  const gymTile = Number(await gymCard.locator('[data-locate-tile]').getAttribute('data-locate-tile'));
  await page.evaluate(async () => { const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { session, camera } = await import(mainPath), { mapSpan } = await import(cameraPath);
    camera.x -= 2 * mapSpan(session.getView().map) * camera.zoom; });
  const before = await cameraAt(page, gymTile);
  await gymCard.locator('[data-locate-tile]').click();
  await expect(page.locator('#screen-host')).toBeHidden();
  const after = await cameraAt(page, gymTile);
  expect(Math.abs(after.tileScreen.x - after.size.width / 2)).toBeLessThan(2);
  expect(Math.abs(after.tileScreen.y - after.size.height / 2)).toBeLessThan(2);
  expect(after.wrap).toBe(true);
  // The nearest copy: the camera moved less than half a map width (it did not jump back to copy 0).
  expect(Math.abs(after.centre.x - before.centre.x)).toBeLessThanOrEqual(after.span / 2 + 1);
  await expect(page.locator('#tile-info [data-entity="gym"]')).toBeVisible();
  await page.screenshot({ path: `${shots}/${phase}-located.png` });

  // A card with an own unit selects it (evolution) or the locate of any other card works the same.
  await openScreen(page, 'world');
  const other = panel.locator('.next-card:not([data-card="gym"]) [data-locate-tile]').first();
  const otherTile = Number(await other.getAttribute('data-locate-tile'));
  await other.click();
  const located = await cameraAt(page, otherTile);
  expect(Math.abs(located.tileScreen.x - located.size.width / 2)).toBeLessThan(2);

  // One real turn later (Shift+click ends it), the cards refresh from the new view.
  const round = fixture.state.round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState().round; }), { timeout: 90_000 }).toBeGreaterThan(round);
  await openScreen(page, 'world');
  await expect(cards.first()).toBeVisible();
  const next = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts';
    const { session } = await import(mainPath), view = session.getView();
    const known = new Set([...view.visibleTileIds, ...view.knowledge.exploredTileIds]);
    return [...document.querySelectorAll<HTMLElement>('#expansion-panel [data-locate-tile]')].every(button => known.has(Number(button.dataset.locateTile)));
  });
  expect(next).toBe(true);
  await closeScreen(page);
  expect(errors).toEqual([]);
});

test('victory page: a pixel banner, a route map and denominators in hover cards per path', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = lateWorldFixture();
  await importSave(page, fixture.save);
  await openScreen(page, 'victory');
  const panel = page.locator('#victory-panel');
  await expect(panel.locator('[data-victory]')).toHaveCount(6);
  await page.screenshot({ path: `${shots}/${phase}-victory.png` });
  if (phase === 'before') return;
  await expect(panel.locator('[data-victory] .banner-art')).toHaveCount(6);
  for (const id of ['conquest', 'pokedex', 'origin', 'championship', 'faith']) await expect(panel.locator(`[data-victory="${id}"] .route-node`).first()).toBeVisible();
  await expect(panel.locator('[data-victory="contest"] .route-track')).toBeVisible();
  // Championship route: 8 badge slots, the Elite Four, then the titles this game needs.
  const championship = panel.locator('[data-victory="championship"]');
  await expect(championship.locator('.route-node')).toHaveCount(8 + 1 + 2);
  const tip = await hoverTip(page, championship.locator('.victory-count'));
  await expect(tip).toContainText('四天王最多算 1 个');
  await page.screenshot({ path: `${shots}/${phase}-victory-hover.png` });
  await expect(await hoverTip(page, panel.locator('[data-victory="pokedex"] .victory-count'))).toContainText('分母');
  await expectNamedIcons(page, '#victory-panel');
  await panel.locator('[data-victory="championship"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/${phase}-victory-routes.png` });
  await panel.locator('.victory-score').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/${phase}-victory-end.png` });
  // Contact sheet of the seven banners at 4× (for docs/design/ui-icons/README.md).
  await page.evaluate(async () => {
    const path = '/src/browser/victory-banners.ts', { BANNER_IDS, bannerUrl } = await import(path);
    const sheet = document.createElement('div');
    sheet.id = 'banner-sheet';
    sheet.style.cssText = 'position:fixed;top:0;left:0;z-index:99;display:grid;grid-template-columns:repeat(2,480px);gap:12px;align-content:start;padding:16px;background:#0E1A20;color:#F3E7C9;font:12px sans-serif';
    sheet.innerHTML = BANNER_IDS.map((id: string) => `<figure style="margin:0"><img src="${bannerUrl(id)}" width="480" height="96" style="image-rendering:pixelated" alt=""><figcaption>${id}</figcaption></figure>`).join('');
    document.body.append(sheet);
  });
  await page.locator('#banner-sheet').screenshot({ path: `${shots}/${phase}-banners.png` });
  await page.evaluate(() => document.querySelector('#banner-sheet')!.remove());
  // A next-step chip locates like the world cards.
  const chip = panel.locator('.route-step [data-locate-tile]').first();
  await chip.click();
  await expect(page.locator('#screen-host')).toBeHidden();
  expect(errors).toEqual([]);
});
