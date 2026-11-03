import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createGame } from '../../src/core/game.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { openScreen, closeScreen, openDevDrawer, startNewGame } from './ui.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', snapshotPath = '/src/core/snapshot.ts';
    const { developerAdapter } = await import(mainPath);
    const { canonicalSerialize, stateDigest } = await import(snapshotPath);
    return { state: canonicalSerialize(developerAdapter.getState()), digest: stateDigest(developerAdapter.getState()), log: developerAdapter.exportLog() };
  });
}
async function movePoints(page: Page) {
  return page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', movementPath = '/src/core/movement.ts';
    const { session, camera } = await import(mainPath);
    const { hexToWorld, toScreen } = await import(cameraPath);
    const { reachablePaths } = await import(movementPath);
    const view = session.getView();
    const unit = view.units.find((unit: { ownerId: number; kind: string }) => unit.ownerId === 0 && unit.kind === 'pokemon');
    const routes = Object.values(reachablePaths(view, unit.id)) as { q: number; r: number }[][];
    const route = routes.sort((a, b) => b.length - a.length)[0];
    const rect = document.querySelector('canvas')!.getBoundingClientRect();
    const point = (hex: { q: number; r: number }) => {
      const p = toScreen(hexToWorld(hex), camera); return { x: rect.x + p.x, y: rect.y + p.y };
    };
    return { unitId: unit.id, from: point(unit.position), to: point(route.at(-1)!), destination: route.at(-1)! };
  });
}
async function clickMove(page: Page) {
  const points = await movePoints(page);
  await page.mouse.click(points.from.x, points.from.y);
  await expect(page.locator('#selection')).toContainText('行动点 1');
  await page.mouse.click(points.to.x, points.to.y);
  return points;
}

for (const seed of [12345, 0]) {
  test(`seed ${seed}: browser initialization and command replay equal Node`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/?seed=${seed}`);
    await expect(page.getByRole('status')).toContainText(`种子 ${seed}`);
    await page.locator('#map-legend summary').click();
    await expect(page.getByRole('list', { name: '群系图例' }).locator('li')).toHaveCount(7);
    await page.locator('#map-legend summary').click();
    const initial = await snapshot(page);
    expect(initial.state).toBe(canonicalSerialize(createGame(initial.log.setup)));
    await page.locator('#animate').uncheck();
    const points = await clickMove(page);
    await expect(page.locator('#selection')).toContainText('行动点 0');
    await expect(page.locator('#end-turn')).toBeEnabled();
    const moved = await snapshot(page);
    const movedState = JSON.parse(moved.state);
    expect(movedState.units[points.unitId].position).toEqual(points.destination);
    expect(movedState.commandSeq).toBe(1);
    await page.locator('#end-turn').click();
    await expect(page.getByRole('status')).toContainText('第 2 轮 · 当前文明 1');
    await expect(page.locator('#selection')).toContainText('行动点 1');
    const final = await snapshot(page), commandCount = final.log.commands.length;
    expect(commandCount).toBeGreaterThan(1);
    expect(final.state).toBe(canonicalSerialize(replay(final.log)));
    expect(final.digest).toBe(stateDigest(replay(final.log, commandCount, replay(final.log, 2))));
    await openDevDrawer(page);
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as CommandLog;
    expect(exported).toEqual(final.log); expect(stateDigest(replay(exported))).toBe(final.digest);
    await openDevDrawer(page);
    await page.locator('#sequence').fill('1'); await page.locator('#replay').click();
    expect((await snapshot(page)).state).toBe(canonicalSerialize(replay(exported, 1)));
    await openDevDrawer(page);
    await page.locator('#sequence').fill(String(commandCount)); await page.locator('#replay').click();
    expect((await snapshot(page)).digest).toBe(final.digest);
    if (seed === 12345) {
      await openDevDrawer(page);
      const current = await movePoints(page);
      await closeScreen(page);
      await page.mouse.click(current.from.x, current.from.y);
      await page.screenshot({ path: `${reports}/ui2-map.png`, fullPage: true });
      await startNewGame(page);
      const visibility = await page.evaluate(async () => {
        const mainPath = '/src/browser/main.ts'; const { session, developerAdapter } = await import(mainPath);
        return { view: session.getView(), debug: developerAdapter.getDebugView() };
      });
      expect(visibility.view.map.tiles).toContain(null);
      expect(visibility.view.units.every((unit: { ownerId: number }) => unit.ownerId === 0)).toBe(true);
      expect(visibility.debug.units).toHaveLength(20);
      expect(visibility.debug.units.filter((unit: { ownerId: number | null }) => unit.ownerId === null)).toHaveLength(12);
      await page.screenshot({ path: `${reports}/ui2-fog.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test('playing interpolation, skipping, and disabling animation preserve the same authoritative state', async ({ page }) => {
  const states: string[] = [];
  for (const mode of ['play', 'skip', 'disabled']) {
    await page.goto('/?seed=12345');
    if (mode === 'disabled') await page.locator('#animate').uncheck();
    await clickMove(page);
    if (mode !== 'disabled') {
      await expect(page.locator('#skip')).toBeEnabled();
      await expect(page.locator('#end-turn')).toBeDisabled();
      if (mode === 'skip') await page.locator('#skip').click();
    }
    const authoritative = (await snapshot(page)).digest;
    await expect(page.locator('#end-turn')).toBeEnabled();
    expect((await snapshot(page)).digest).toBe(authoritative);
    await page.locator('#end-turn').click();
    await expect(page.getByRole('status')).toContainText('第 2 轮');
    states.push((await snapshot(page)).state);
  }
  expect(new Set(states).size).toBe(1);
});

test('camera pan/zoom changes hit coordinates while DPR is capped and game state stays fixed', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3 });
  const page = await context.newPage(); await page.goto('/');
  const before = await snapshot(page);
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 - 20, { steps: 3 }); await page.mouse.up();
  await page.mouse.wheel(0, -150);
  await expect.poll(async () => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width / canvas.clientWidth)).toBe(2);
  expect((await snapshot(page)).digest).toBe(before.digest);
  await page.locator('#animate').uncheck(); await clickMove(page);
  await expect(page.locator('#selection')).toContainText('行动点 0');
  await context.close();
});

test('starter selection restarts the game and god view only changes presentation', async ({ page }) => {
  await page.goto('/'); const before = await snapshot(page);
  await openDevDrawer(page);
  await openDevDrawer(page);
  await page.locator('#god').check(); expect((await snapshot(page)).digest).toBe(before.digest);
  await openDevDrawer(page);
  await page.locator('#god').uncheck(); expect((await snapshot(page)).digest).toBe(before.digest);
  await openScreen(page, 'menu');
  await page.locator('#starter').selectOption('squirtle'); await startNewGame(page);
  const fresh = await snapshot(page); expect(fresh.log.commands).toHaveLength(0);
  expect(fresh.log.setup.players[0]).toMatchObject({ starterId: 'squirtle' });
  expect(fresh.state).toBe(canonicalSerialize(createGame(fresh.log.setup)));
});

test('invalid seeds show an explanation instead of a blank map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seed=invalid');
  await expect(page.getByRole('status')).toContainText('无法生成地图');
  await expect(page.locator('canvas')).toBeHidden();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('keyboard cursor selects and moves a unit through the existing command path', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  const fixture = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', movementPath = '/src/core/movement.ts';
    const { session } = await import(mainPath), { reachablePaths } = await import(movementPath);
    const view = session.getView(), unit = view.units.find((unit: { ownerId: number; kind: string }) => unit.ownerId === 0 && unit.kind === 'pokemon');
    const paths = Object.values(reachablePaths(view, unit.id)) as { q: number; r: number }[][];
    const directions = [{ q: 1, r: 0, key: 'ArrowRight' }, { q: -1, r: 0, key: 'ArrowLeft' }, { q: 0, r: 1, key: 'ArrowDown' }, { q: 0, r: -1, key: 'ArrowUp' }];
    for (const path of paths) if (path.length === 2) {
      const delta = { q: path[1].q - path[0].q, r: path[1].r - path[0].r };
      const direction = directions.find(item => item.q === delta.q && item.r === delta.r);
      if (direction) return { unitId: unit.id, destination: path[1], key: direction.key };
    }
    throw new Error('No cardinal movement fixture');
  });
  await page.locator('#map').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection')).toContainText('行动点 1');
  await page.keyboard.press(fixture.key);
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection')).toContainText('行动点 0');
  const moved = JSON.parse((await snapshot(page)).state);
  expect(moved.units[fixture.unitId].position).toEqual(fixture.destination);
});

test('normal fog never issues hidden faction badge draw calls', async ({ page }) => {
  await page.addInitScript(() => {
    const texts: string[] = [];
    Object.assign(window, { __drawnTexts: texts });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
      texts.push(String(text));
      return original.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto('/?seed=12345');
  await page.locator('#fit').click();
  const drawnTexts = () => page.evaluate(() => (window as unknown as { __drawnTexts: string[] }).__drawnTexts);
  const normal = await drawnTexts();
  expect(normal).not.toContain('2');
  expect(normal).not.toContain('3');
  expect(normal).not.toContain('4');
  await openDevDrawer(page);
  await openDevDrawer(page);
  await page.locator('#god').check();
  await expect.poll(async () => (await drawnTexts()).includes('2')).toBe(true);
});
