import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createGame } from '../../src/core/game.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', snapshotPath = '/src/core/snapshot.ts';
    const { session } = await import(mainPath);
    const { canonicalSerialize, stateDigest } = await import(snapshotPath);
    return { state: canonicalSerialize(session.getState()), digest: stateDigest(session.getState()), log: session.exportLog() };
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
    await expect(page.getByRole('list', { name: '群系图例' }).locator('li')).toHaveCount(7);
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
    await expect(page.getByRole('status')).toContainText('第 2 轮 · 当前文明 1 · 命令 5');
    await expect(page.locator('#selection')).toContainText('行动点 1');
    const final = await snapshot(page);
    expect(final.state).toBe(canonicalSerialize(replay(final.log)));
    expect(final.digest).toBe(stateDigest(replay(final.log, 5, replay(final.log, 2))));
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as CommandLog;
    expect(exported).toEqual(final.log); expect(stateDigest(replay(exported))).toBe(final.digest);
    await page.locator('#sequence').fill('1'); await page.locator('#replay').click();
    expect((await snapshot(page)).state).toBe(canonicalSerialize(replay(exported, 1)));
    await page.locator('#sequence').fill('5'); await page.locator('#replay').click();
    expect((await snapshot(page)).digest).toBe(final.digest);
    if (seed === 12345) {
      const current = await movePoints(page);
      await page.mouse.click(current.from.x, current.from.y);
      await page.screenshot({ path: '/Users/bytedance/.local/state/gsb-local/pokemon-civilazation/reports/m1-play.png', fullPage: true });
      await page.locator('#new-game').click();
      const visibility = await page.evaluate(async () => {
        const mainPath = '/src/browser/main.ts'; const { session } = await import(mainPath);
        return { view: session.getView(), debug: session.getDebugView() };
      });
      expect(visibility.view.map.tiles).toContain(null);
      expect(visibility.view.units.every((unit: { ownerId: number }) => unit.ownerId === 0)).toBe(true);
      expect(visibility.debug.units).toHaveLength(8);
      await page.screenshot({ path: '/Users/bytedance/.local/state/gsb-local/pokemon-civilazation/reports/m1-fog.png', fullPage: true });
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
    const authoritative = (await snapshot(page)).digest;
    if (mode !== 'disabled') {
      await expect(page.locator('#skip')).toBeEnabled();
      await expect(page.locator('#end-turn')).toBeDisabled();
      if (mode === 'skip') await page.locator('#skip').click();
    }
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
  await page.locator('#god').check(); expect((await snapshot(page)).digest).toBe(before.digest);
  await page.locator('#god').uncheck(); expect((await snapshot(page)).digest).toBe(before.digest);
  await page.locator('#starter').selectOption('squirtle'); await page.locator('#new-game').click();
  const fresh = await snapshot(page); expect(fresh.log.commands).toHaveLength(0);
  expect(fresh.log.setup.players[0]).toMatchObject({ starterId: 'squirtle' });
  expect(fresh.state).toBe(canonicalSerialize(createGame(fresh.log.setup)));
});

test('invalid seeds show an explanation instead of a blank map', async ({ page }) => {
  await page.goto('/?seed=invalid');
  await expect(page.getByRole('status')).toContainText('无法生成地图');
  await expect(page.locator('canvas')).toBeHidden();
});
