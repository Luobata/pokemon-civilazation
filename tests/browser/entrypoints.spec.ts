import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const route of ['/index.html', '/audit.html', '/editor.html', '/multiplayer.html']) {
  test(`${route} initializes and clears startup guidance`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route);
    await expect(page.locator('#startup-notice')).toBeHidden();
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('Times');
    expect(errors).toEqual([]);
  });

  test(`${route} keeps styles and useful guidance if its module fails`, async ({ page }) => {
    await page.route('**/src/browser/*.ts', route => route.abort());
    await page.goto(route);
    await expect(page.locator('#startup-notice')).toBeVisible();
    await expect(page.locator('#startup-notice')).toContainText('直接预览 HTML 文件无法运行游戏');
    await expect(page.locator('#startup-notice a')).toHaveAttribute('href', `http://127.0.0.1:5173/${route === '/index.html' ? '' : route.slice(1)}`);
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('Times');
  });
}

test('opening multiplayer source as a file retains styling and a working-server link', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('multiplayer.html')).href);
  await expect(page.locator('#startup-notice')).toBeVisible();
  await expect(page.locator('.multiplayer-shell')).toHaveCSS('display', 'grid');
  await expect(page.locator('#startup-notice a')).toHaveAttribute('href', 'http://127.0.0.1:5173/multiplayer.html');
  await expect(page.locator('#action-type option')).toHaveCount(0);
});

test('unreachable multiplayer API explains how to recover', async ({ page }) => {
  await page.route('http://127.0.0.1:8787/api/rooms', route => route.abort('connectionrefused'));
  await page.goto('/multiplayer.html');
  await expect(page.locator('#startup-notice')).toBeHidden();
  await page.locator('#create-room').click();
  await expect(page.locator('#network-notice')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#network-notice')).toContainText('联机服务');
  await expect(page.locator('#network-notice')).toContainText('地址');
  await expect(page.locator('#connection-status')).toHaveText('未连接');
  await expect(page.locator('#invite-list a')).toHaveCount(0);
});


test('editor button styling survives shared CSS loading last in production', async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.locator('#startup-notice')).toBeHidden();
  await page.evaluate(() => {
    const shared = document.querySelector<HTMLLinkElement>('link[href$="/src/styles.css"]')!;
    document.head.append(shared);
  });
  const button = page.locator('#load-baseline');
  await expect(button).toHaveCSS('background-color', 'rgb(24, 48, 49)');
  await expect(button).toHaveCSS('border-radius', '8px');
  await expect(button).toHaveCSS('padding', '7px 11px');
});
