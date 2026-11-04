import { expect, test } from '@playwright/test';
import { LEADERS, LEADER_IDS } from '../../src/content/leaders.ts';
import { contentFor } from '../../src/content/units.ts';
import { LATEST_GAMEPLAY_VERSION } from '../../src/content/eras.ts';

test('the game links to the handbook and every leader and species is listed from live content', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/');
  await expect(page.locator('a[href="/guide.html"]').first()).toBeAttached();
  await expect(page.locator('#leader-setup-note a[href="/guide.html#leaders"]')).toBeAttached();

  await page.goto('/guide.html');
  await expect(page.locator('#startup-notice')).toBeHidden();
  await expect(page.locator('.leader-card')).toHaveCount(LEADER_IDS.length);
  for (const id of LEADER_IDS) await expect(page.locator('.leader-card h3', { hasText: LEADERS[id].name })).toHaveCount(1);
  const species = Object.values(contentFor({ expansionVersion: 1, gameplayVersion: LATEST_GAMEPLAY_VERSION }).species);
  await expect(page.locator('#pokemon table').first().locator('tbody tr')).toHaveCount(species.length);
  await expect(page.locator('#guide-nav a')).toHaveCount(await page.locator('.guide-section').count());
  const broken = await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(images.map(image => image.decode().catch(() => undefined)));
    return images.filter(image => image.naturalWidth === 0).map(image => image.src);
  });
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
});

test('handbook search narrows sections and navigation', async ({ page }) => {
  await page.goto('/guide.html');
  await page.locator('#guide-search').fill('乔伊小姐');
  await expect(page.locator('#leaders')).toBeVisible();
  await expect(page.locator('#map')).toBeHidden();
  await expect(page.locator('#guide-nav a[data-nav="map"]')).toBeHidden();
  await page.locator('#guide-search').fill('不存在的关键词xyz');
  await expect(page.locator('.no-results')).toBeVisible();
  await page.locator('#guide-search').fill('');
  await expect(page.locator('#map')).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`handbook page does not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/guide.html');
    await expect(page.locator('.leader-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
