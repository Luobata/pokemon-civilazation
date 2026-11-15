// Playtest 2026-11b batches C and D (docs/design/playtest-2026-11b/report.md): the rival's foggy arrival (N2) and the duel conditions
// (O2), tile coordinates (U-f), the research queue, the conference reminder (O3), gold sinks where they are legal (U-c) and an idle
// city's quick fill. Real input on saves of real v26 games; turns end with Shift+click.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import type { TechId } from '../../src/content/economy.ts';
import { contentFor } from '../../src/content/units.ts';
import { hexToIndex, offsetToHex } from '../../src/core/hex.ts';
import { closeScreen, openScreen } from './ui.ts';
import { RIVAL_ARRIVAL, RIVAL_SETUP, rivalEveSave } from './fixtures/playtest-2b.ts';
import { conferenceFixture } from './fixtures/depth-v26.ts';

const dir = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/fixes-2-cd`;
test.use({ viewport: { width: 1280, height: 900 } });
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=26');
  await page.locator('#import-save').setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(save) });
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
  const at = (await view(page)).round;
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await view(page)).round, { timeout: 180_000 }).toBeGreaterThan(at);
}
/** Every icon image in `root` that is not decorative has an accessible name. */
async function expectNamedIcons(root: ReturnType<Page['locator']>) {
  const unnamed = await root.locator('img.px-icon:not([aria-hidden="true"])').evaluateAll(images => images.filter(image => !image.getAttribute('alt')).length);
  expect(unnamed).toBe(0);
}

test('N2 / O2 / U-f: a foggy rival arrival keeps its mark, says 已到达, the card locates it and the duel button explains and goes there', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, rivalEveSave());
  const warned = hexToIndex(offsetToHex(RIVAL_ARRIVAL), { width: RIVAL_SETUP.width, height: RIVAL_SETUP.height })!;
  expect((await view(page)).expansion!.rivals!.pending?.tileIndex).toBe(warned);
  await endTurn(page);
  const arrived = await view(page), rivals = arrived.expansion!.rivals!;
  expect(rivals.activeUnitIds.length).toBeGreaterThan(0);
  expect(rivals.sightings).toEqual([]);
  // The 已到达 notice stays on the rail (it points at the warned tile, so it is not dropped as a vanished unit).
  const notice = page.locator('#toast-host [data-toast-open][aria-label*="已到达"]');
  await expect(notice).toHaveCount(1);
  // The World card: 已到达, the warned tile, the duel's conditions in the hover card, a named locate button.
  await openScreen(page, 'world');
  const card = page.locator('[data-card="rival"]');
  await expect(card).toContainText('已到达');
  await expect(card).toHaveAttribute('data-tip', /对决条件/);
  await card.hover();
  await page.screenshot({ path: `${dir}/n2-world-rival-card.png` });
  await expect(card.locator(`[data-locate-tile="${warned}"]`)).toHaveAttribute('aria-label', /定位：/);
  await card.locator(`[data-locate-tile="${warned}"]`).click();
  await expect(page.locator('#screen-host')).toBeHidden();
  // The inspector: the arrival in fog and the coordinates as the player reads them.
  const tile = page.locator('#tile-info');
  await expect(tile).toContainText('已到达');
  await expect(tile.locator('.tile-coords')).toHaveText(`(${RIVAL_ARRIVAL.col}, ${RIVAL_ARRIVAL.row})`);
  await expect(tile.locator('.tile-coords')).toHaveAttribute('aria-label', `坐标：第 ${RIVAL_ARRIVAL.col} 列，第 ${RIVAL_ARRIVAL.row} 行`);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${dir}/n2-arrival-mark.png` });
  // The duel button of an own Pokémon: enabled, it says why the duel is blocked and sets a go-to order toward the warned tile.
  const starter = arrived.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  await page.locator('#unit-select').selectOption(String(starter.id));
  const duel = page.locator('#duel-unit');
  await expect(duel).toBeEnabled();
  await expect(duel).toHaveAttribute('aria-label', /劲敌不全在视野里/);
  await duel.hover();
  const tip = page.locator('#duel-unit-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('✗ 这次登场的');
  await expect(tip).toContainText('每轮只能对决一次');
  // The hover card stays clear of the notification rail and the objective card.
  const tipBox = (await tip.boundingBox())!, railBox = await page.locator('#toast-host').boundingBox();
  if (railBox && railBox.width) expect(tipBox.x + tipBox.width <= railBox.x || tipBox.x >= railBox.x + railBox.width || tipBox.y + tipBox.height <= railBox.y).toBe(true);
  await page.screenshot({ path: `${dir}/o2-duel-button-hover.png` });
  // The order is set and the first leg walked at once (it may stop right away when the move reveals a hostile, as go-to orders do).
  const seq = (await view(page)).commandSeq;
  await duel.click();
  await expect(page.locator('#action-notice')).toContainText('路标');
  await expect.poll(async () => (await view(page)).commandSeq).toBeGreaterThan(seq);
  expect(errors).toEqual([]);
});

test('research queue: Shift+click queues a locked tech with its prerequisites, numbered on the tree; the next one starts at the start of a turn', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await importSave(page, rivalEveSave());
  const content = contentFor(RIVAL_SETUP), techs = Object.keys(content.techs) as TechId[];
  const cheapest = techs.filter(id => !(content.techs[id]!.requires ?? []).length).sort((a, b) => content.techs[a]!.cost - content.techs[b]!.cost)[0];
  const locked = techs.find(id => (content.techs[id]!.requires ?? []).length === 1 && content.techs[id]!.requires![0] === cheapest)!;
  expect((await view(page)).economy.player.research.techId).toBeNull();
  await openScreen(page, 'research');
  await page.locator(`[data-tree-node="${locked}"]`).click({ modifiers: ['Shift'] });
  // Nothing was being researched: the first queued tech starts at once; the rest wait with numbered badges.
  await expect.poll(async () => (await view(page)).economy.player.research.techId).toBe(cheapest);
  await expect(page.locator(`[data-tree-node="${locked}"] .node-queue-badge`)).toHaveText('1');
  await expect(page.locator(`[data-tree-node="${locked}"]`)).toHaveAttribute('aria-label', /研究队列第 1 项/);
  await expect(page.locator('.research-queue .queue-chip')).toHaveCount(1);
  await expectNamedIcons(page.locator('.research-queue'));
  await page.locator('#research-panel').screenshot({ path: `${dir}/research-queue.png` });
  await closeScreen(page);
  for (let guard = 0; guard < 10 && (await view(page)).economy.player.research.techId !== locked; guard++) await endTurn(page);
  const after = await view(page);
  expect(after.economy.player.research.unlockedIds).toContain(cheapest);
  expect(after.economy.player.research.techId).toBe(locked);
  await expect(page.locator('#toast-host [data-toast-open][aria-label*="研究队列：开始研究"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('O3, U-c, idle cities: the conference registration routes the end-turn button once; training / TMs where legal; quick fill', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = conferenceFixture();
  await importSave(page, fixture.save);
  // O3: the to-do chip, and a plain click on the end-turn button opens the registration (once a round).
  await expect(page.locator('[data-reminder="conference"]')).toBeVisible();
  const button = page.locator('#end-turn');
  for (let guard = 0; guard < 4 && await button.getAttribute('data-state') !== 'conference'; guard++) {
    // Earlier to-dos (a dedication, research, a charter) come first: handle them the quick way, then the conference.
    const state = await button.getAttribute('data-state');
    if (state === 'research') { await button.click(); await page.locator('.tech-node.available').first().click(); await closeScreen(page); }
    else if (state === 'charter' || state === 'dedication') { await button.click(); await closeScreen(page); break; }
  }
  if (await button.getAttribute('data-state') === 'conference') {
    await expect(button).toHaveText('报名联盟大会 ›');
    await page.screenshot({ path: `${dir}/o3-end-turn-conference.png` });
    await button.click();
    await expect(page.locator('#lineup-picker')).toBeVisible();
    await page.screenshot({ path: `${dir}/o3-conference-picker.png` });
    await page.keyboard.press('Escape');
    await expect(button).not.toHaveAttribute('data-state', 'conference');
  } else await page.locator('[data-reminder="conference"]').click();
  await page.keyboard.press('Escape');
  // U-c: 物资采购 (from the top-bar ball stock) lists the gold sinks; the unit panel of a Pokémon in or beside a city offers training and TMs.
  await page.locator('#hud-balls').click();
  const supplies = page.locator('.city-supply-sinks');
  await expect(supplies).toBeVisible();
  await expectNamedIcons(supplies);
  await page.locator('#economy').screenshot({ path: `${dir}/uc-city-supplies.png` });
  const current = await view(page), own = current.units.filter(unit => unit.ownerId === 0 && unit.kind === 'pokemon');
  await clickTile(page, hexToIndex(own[0].position, current.map)!);
  if (current.economy.cities.some(city => hexToIndex(city.position, current.map) === hexToIndex(own[0].position, current.map))) await clickTile(page, hexToIndex(own[0].position, current.map)!);
  const sinks = page.locator('.unit-gold-sinks');
  await expect(sinks).toBeVisible();
  await expect(sinks.locator('button[aria-label^="特训"]')).toHaveCount(1);
  await sinks.scrollIntoViewIfNeeded();
  await sinks.screenshot({ path: `${dir}/uc-unit-training.png` });
  // The World card for spare gold names training, TMs and balls too.
  await openScreen(page, 'world');
  const gold = page.locator('[data-card="goldSink"]');
  if (await gold.count()) { await expect(gold).toHaveAttribute('data-tip', /特训/); await gold.screenshot({ path: `${dir}/uc-gold-card.png` }); }
  await closeScreen(page);
  // An idle city: empty its queue in the city panel, then the quick-fill suggestion queues an item.
  const city = current.economy.cities[0];
  await clickTile(page, hexToIndex(city.position, current.map)!);
  await page.locator('#economy [data-city-section="production"]').click();
  for (let guard = 0; guard < 6 && await page.locator('#production-queue [data-remove]').count(); guard++) await page.locator('#production-queue [data-remove]').first().click();
  await expect(page.locator('[data-reminder="city"]')).toHaveAttribute('title', /城市面板里有一键/);
  const fill = page.locator('.quick-fill-btn').first();
  await expect(fill).toBeVisible();
  await page.locator('#economy').screenshot({ path: `${dir}/idle-city-quick-fill.png` });
  await fill.click();
  await expect.poll(async () => (await view(page)).economy.cities.find(item => item.id === city.id)!.queue.length).toBe(1);
  expect(errors).toEqual([]);
});
