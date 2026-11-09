import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CIV_GLOSSARY, CIV_GLOSSARY_IDS } from '../../src/content/civ-glossary.ts';
import { glossaryFixture } from './fixtures/civ-glossary.ts';
import { closeScreen, openScreen } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

test('the handbook has a 给《文明》玩家 glossary and the systems overview names the Civ VI system', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/guide.html');
  await page.locator('#guide-nav a[data-nav="civ6"]').click();
  const section = page.locator('#civ6');
  await expect(section.locator('h2')).toContainText('给《文明》玩家');
  await expect(section.locator('tbody tr')).toHaveCount(CIV_GLOSSARY_IDS.length);
  await expect(section.locator('tbody tr', { hasText: '联盟规章' }).first()).toContainText('市政');
  await expect(section.locator('tbody tr', { hasText: '幻影' }).first()).toContainText('伟人');
  await expect(section.locator('tbody tr', { hasText: '霸主' }).first()).toContainText('城邦');
  await expect(page.locator('#systems .civ-term', { hasText: '市政 / 政策卡' })).toHaveCount(1);
  await expect(page.locator('#systems .civ-term', { hasText: '区域' })).toHaveCount(1);
  // The 详见 links go to the chapter that explains the system.
  await section.locator('tbody tr', { hasText: '道具球' }).locator('a').click();
  await expect(page).toHaveURL(/#opening$/);
  await page.locator('#guide-nav a[data-nav="civ6"]').click();
  await section.screenshot({ path: `${reports}/civ-glossary-guide.png` });
  // Searching the Civ VI name finds the chapter.
  await page.locator('#guide-search').fill('城邦');
  await expect(section).toBeVisible();
  expect(errors).toEqual([]);
});

async function tilePoint(page: Page, index: number) {
  return page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    const x = rect.x + screen.x, y = rect.y + screen.y;
    return { x, y, open: document.elementFromPoint(x, y)?.id === 'map' };
  }, index);
}

/** Hovers a chip with the real mouse and returns the hover card. */
async function hoverHint(page: Page, chip: ReturnType<Page['locator']>) {
  await chip.scrollIntoViewIfNeeded();
  await chip.hover();
  const card = page.locator('#civ-hint-card');
  await expect(card).toBeVisible();
  return card;
}

test('in game, hovering a 文明 6 chip or a nest on the map shows the Civ VI analogue', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = glossaryFixture();
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'civ6.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();

  // Map hover: the one-line tooltip over a nest names the barbarian outpost.
  await page.locator('#fit').click();
  let point = await tilePoint(page, fixture.nestTiles[0]);
  if (!point.open) {
    // Drag the map (real input) until the nest is in the open middle of the map.
    const box = (await page.locator('#map').boundingBox())!, centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + (centre.x - point.x) / 2, centre.y + (centre.y - point.y) / 2, { steps: 8 });
    await page.mouse.move(centre.x + centre.x - point.x, centre.y + centre.y - point.y, { steps: 8 });
    await page.mouse.up();
    point = await tilePoint(page, fixture.nestTiles[0]);
  }
  expect(point.open, 'the nest is on an uncovered part of the map').toBe(true);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#map-tooltip')).toBeVisible();
  await expect(page.locator('#map-tooltip')).toContainText(`巢穴 · 威胁（文明 6：${CIV_GLOSSARY.nest.civ}）`);
  await page.screenshot({ path: `${reports}/civ-glossary-map-hover.png` });
  await page.mouse.move(5, 5);

  // Civics screen: the chips next to 联盟规章 and 联盟体制 open a hover card.
  await openScreen(page, 'policy');
  let card = await hoverHint(page, page.locator('#policy-panel [data-civ-hint="charter"]'));
  await expect(card).toContainText('联盟规章 ≈ 《文明 6》的市政');
  await expect(card).toContainText(CIV_GLOSSARY.charter.note);
  await page.screenshot({ path: `${reports}/civ-glossary-policy-hover.png` });
  card = await hoverHint(page, page.locator('#policy-panel [data-civ-hint="government"]'));
  await expect(card).toContainText('《文明 6》的政体');
  // The card goes away with the pointer and never covers the screen once you move on.
  await page.mouse.move(5, 5);
  await expect(page.locator('#civ-hint-card')).toBeHidden();

  // Research screen: 图鉴发现 ≈ eureka.
  await openScreen(page, 'research');
  card = await hoverHint(page, page.locator('#research-panel [data-civ-hint="discovery"]'));
  await expect(card).toContainText('《文明 6》的尤里卡');

  // World screen: overlords ≈ city-states, phantoms ≈ great people (summaries keep working as toggles).
  await openScreen(page, 'world');
  const overlords = page.locator('#expansion-panel details[data-system="s19-overlords"]');
  card = await hoverHint(page, overlords.locator('[data-civ-hint="overlord"]'));
  await expect(card).toContainText('霸主 ≈ 《文明 6》的城邦');
  card = await hoverHint(page, page.locator('#expansion-panel [data-civ-hint="phantom"]'));
  await expect(card).toContainText('幻影 ≈ 《文明 6》的伟人');
  await page.screenshot({ path: `${reports}/civ-glossary-world-hover.png` });
  await closeScreen(page);
  await expect(page.locator('#civ-hint-card')).toBeHidden();

  // End the turn (Shift+click skips the reminders); after the AI turns the era screen still explains 世代.
  const round = fixture.state.round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState().round; }), { timeout: 60_000 }).toBeGreaterThan(round);
  await openScreen(page, 'era');
  card = await hoverHint(page, page.locator('#era-panel [data-civ-hint="era"]'));
  await expect(card).toContainText('世代 ≈ 《文明 6》的时代');
  // Keyboard users get the same card on focus.
  await page.mouse.move(5, 5);
  await page.locator('#era-panel [data-civ-hint="era"]').focus();
  await expect(page.locator('#civ-hint-card')).toBeVisible();
  await closeScreen(page);
  expect(errors).toEqual([]);
});
