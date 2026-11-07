import { expect, test } from '@playwright/test';
import { closeScreen } from './ui.ts';

// Findings from the 2026-11-07 interaction review (real mouse / keyboard play).

test('Esc backs out of a unit action even when focus is on the action bar, then clears the selection', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.locator('#unit-select').selectOption({ index: 1 });
  const move = page.locator('#unit-action-bar [data-action="move"]');
  await move.click();
  await expect(move).toHaveClass(/selected/);
  await move.focus();
  await page.keyboard.press('Escape');
  await expect(move).not.toHaveClass(/selected/);
  await expect(page.locator('#unit-select')).not.toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#unit-select')).toHaveValue('');
});

test('the world screen names stones and berries instead of printing ids or JSON', async ({ page }) => {
  await page.goto('/?seed=7');
  await page.locator('[data-open-screen="world"]').click();
  await page.locator('#screen-world details').evaluateAll(sections => { for (const section of sections) (section as HTMLDetailsElement).open = true; });
  const text = await page.locator('#screen-world').innerText();
  expect(text).not.toMatch(/fireStone|waterStone|leafStone|thunderStone|moonStone|\{"/);
  expect(text).toContain('进化石：');
  await closeScreen(page);
});

test('the opening objectives card collapses to one line and expands again', async ({ page }) => {
  await page.goto('/?seed=7');
  const card = page.locator('#opening-goals'), toggle = card.locator('.goals-toggle');
  await expect(card.locator('li')).toHaveCount(3);
  const open = (await card.boundingBox())!;
  await toggle.click();
  await expect(card.locator('li')).toHaveCount(0);
  const closed = (await card.boundingBox())!;
  expect(closed.height).toBeLessThan(open.height / 2);
  await toggle.click();
  await expect(card.locator('li')).toHaveCount(3);
});
