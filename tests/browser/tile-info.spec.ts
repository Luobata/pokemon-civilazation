import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { reachableFixture } from './fixtures/reachable.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'tile.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
/** First visible tile whose description has an entity of `kind` with one of `tones`. */
async function findTile(page: Page, kind: string, tones: string[]): Promise<number | null> {
  return page.evaluate(async ({ kind, tones }) => {
    const mainPath = '/src/browser/main.ts', infoPath = '/src/browser/tile-info.ts';
    const { session } = await import(mainPath), { describeTile } = await import(infoPath);
    const view = session.getView();
    return view.visibleTileIds.find((index: number) => describeTile(view, index).entities
      .some((entity: { kind: string; tone: string }) => entity.kind === kind && tones.includes(entity.tone))) ?? null;
  }, { kind, tones });
}
async function tilePoint(page: Page, index: number) {
  return page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
}
async function clickTile(page: Page, index: number) {
  const point = await tilePoint(page, index);
  await page.mouse.click(point.x, point.y);
}

for (const [fixture, kind, tones, expected] of [
  ['attack', 'unit', ['wild'], '野生'],
  ['visible-ai', 'unit', ['peace', 'enemy'], '文明 '],
  ['neutral', 'city', ['neutral'], '中立营地'],
] as const) test(`clicking a ${kind} (${tones.join('/')}) opens the tile inspector`, async ({ page }) => {
  await importSave(page, reachableFixture(fixture).save);
  await page.locator('#fit').click();
  const index = await findTile(page, kind, [...tones]);
  expect(index, `${fixture} fixture shows a ${kind}`).not.toBeNull();
  const before = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState().commandSeq; });
  await clickTile(page, index!);
  const panel = page.locator('#tile-info');
  await expect(panel).toBeVisible();
  await expect(panel.locator(`[data-entity="${kind}"]`).first()).toContainText(expected);
  await expect(panel.locator('.tile-hint').first()).not.toBeEmpty();
  await expect(page.locator('#selection')).toContainText('查看');
  // Inspecting never issues a command.
  expect(await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState().commandSeq; })).toBe(before);
  await page.screenshot({ path: `${reports}/tile-info-${fixture}.png` });
  await page.locator('#clear-selection').click();
  await expect(panel).toBeHidden();
});

test('plain terrain shows yields and the hover tooltip names the tile', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#fit').click();
  const index = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', infoPath = '/src/browser/tile-info.ts';
    const { session } = await import(mainPath), { describeTile } = await import(infoPath);
    const view = session.getView();
    return view.visibleTileIds.find((i: number) => { const info = describeTile(view, i); return !info.entities.length && info.yields; });
  });
  const point = await tilePoint(page, index);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#map-tooltip')).toBeVisible();
  await expect(page.locator('#map-tooltip')).not.toBeEmpty();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#tile-info .tile-yields')).toContainText('食物');
  await expect(page.locator('#tile-info')).toContainText('移动消耗');
  await page.mouse.move(5, 5);
  await expect(page.locator('#map-tooltip')).toBeHidden();
});
