import { expect, test } from '@playwright/test';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
test.use({ viewport: { width: 1280, height: 720 } });

test('v22 research screen: a connected tree, locked reasons, research from a node, wheel and keys reach the last column', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=7&gameplay=22');
  await page.locator('[data-open-screen="research"]').first().click();
  const tree = page.locator('.tech-tree-v22');
  await expect(tree).toBeVisible();
  await expect(page.locator('[data-tree-node]')).toHaveCount(30);
  // One connector per prerequisite, drawn once the screen has layout.
  const edges = await page.evaluate(async () => {
    const path = '/src/content/tech-tree.ts';
    const { TREE_TECHS } = await import(path);
    return Object.values(TREE_TECHS as Record<string, { requires: string[] }>).reduce((sum, tech) => sum + tech.requires.length, 0);
  });
  expect(edges).toBeGreaterThan(30);
  await expect(page.locator('.tech-links path')).toHaveCount(edges);
  expect(await page.locator('.tech-links path').first().getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+ C/);
  await expect(page.locator('.tech-node.available')).toHaveCount(4);
  await expect(page.locator('.tech-node.locked')).toHaveCount(26);

  // A locked node explains which prerequisites are missing, and hovering highlights its chain.
  await page.locator('[data-tree-node="training"]').click();
  const detail = page.locator('#tech-detail');
  await expect(detail).toContainText('特训法');
  await expect(detail.locator('#tech-locked-reason')).toContainText('伤药调配');
  await expect(detail.locator('#tech-locked-reason')).toContainText('属性研究');
  await expect(detail.locator('[data-tech]')).toHaveCount(0);
  await expect(page.locator('[data-tree-node="medicine"]')).toHaveClass(/chain/);
  await expect(page.locator('[data-tree-node="fieldObservation"]')).toHaveClass(/chain/);
  await expect(page.locator('[data-tree-node="berryCultivation"]')).toHaveClass(/chain/);
  await expect(page.locator('[data-tree-node="riding"]')).not.toHaveClass(/chain/);
  expect(await page.locator('.tech-links path.chain').count()).toBeGreaterThanOrEqual(4);
  await page.locator('[data-tree-node="seafaring"]').hover();
  await expect(page.locator('[data-tree-node="medicine"]')).not.toHaveClass(/chain/);

  // Choosing a researchable node starts research.
  await page.locator('[data-tree-node="stoneCraft"]').click();
  await expect(detail).toContainText('解锁');
  await detail.getByRole('button', { name: '研究此项' }).click();
  await expect(page.locator('#research-status')).toContainText('碎石工艺');
  await expect(page.locator('[data-tree-node="stoneCraft"]')).toHaveClass(/active/);

  // Real wheel input over the tree pans sideways until the last column is in view and clickable.
  const scroller = page.locator('.tech-tree-scroll');
  const box = (await scroller.boundingBox())!;
  expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
  const last = page.locator('[data-tree-node="championLeague"]');
  const reachable = () => last.evaluate(node => {
    const rect = node.getBoundingClientRect(), scroll = node.closest('.tech-tree-scroll')!.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.right <= scroll.right + 1 && rect.left >= scroll.left - 1 && hit !== null && node.contains(hit);
  });
  expect(await reachable()).toBe(true);
  await page.locator('[data-tree-node="dragonLore"]').click();
  await page.locator('#screen-research .screen-body').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `${reports}/tech-tree.png` });
  await last.click();
  await expect(detail).toContainText('冠军联盟');

  // Keyboard: Home / End on the focused tree.
  await scroller.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('End');
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
  expect(await reachable()).toBe(true);
  // The buttons under the tree pan too (mouse users without a wheel).
  await page.locator('[data-tree-pan="first"]').click();
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBe(0);
  await page.locator('[data-tree-pan="last"]').click();
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft + element.clientWidth >= element.scrollWidth - 2)).toBe(true);
  expect(errors).toEqual([]);
});

test('older games keep the three-tier research page', async ({ page }) => {
  await page.goto('/?seed=7&gameplay=21');
  await page.locator('[data-open-screen="research"]').first().click();
  await expect(page.locator('.tech-tree .tech-tier')).toHaveCount(3);
  await expect(page.locator('.tech-tree-v22')).toHaveCount(0);
  await expect(page.locator('[data-tech-card]')).toHaveCount(12);
});
