import { expect, test } from '@playwright/test';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';

test('v21: new games show the opening objectives card and visible item balls; v20 games do not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  // Seed 10: an item ball is already in sight on round 1 (deterministic world).
  await page.goto('/?seed=10');
  const goals = page.locator('#opening-goals');
  await expect(goals).toBeVisible();
  await expect(goals).toContainText('开局目标 0/8');
  await expect(goals.locator('li')).toHaveCount(3);
  await expect(goals).toContainText('第一项研究');

  // Click the first item ball the player has seen: the tile panel explains it.
  const point = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const view = session.getView(), ball = view.expansion?.opening?.itemBalls[0];
    if (!ball) return null;
    const screen = toScreen(hexToWorld(indexToHex(ball.tileIndex, view.map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  });
  expect(point).not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await expect(page.locator('#tile-info')).toContainText('道具球');
  await page.screenshot({ path: `${reports}/opening-v21.png` });

  await page.goto('/?seed=10&gameplay=20');
  await expect(page.locator('#map')).toBeVisible();
  await expect(goals).toBeHidden();
  expect(errors).toEqual([]);
});
