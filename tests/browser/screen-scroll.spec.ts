import { expect, test } from '@playwright/test';

// User report: the research screen did not scroll, so the bottom tech could not be chosen. `.screen-body` rows were
// squeezed to the window and `.subpanel { overflow: hidden }` clipped the rest. Use real wheel input: scrollIntoView
// would also scroll an overflow:hidden box and hide the bug.
test.use({ viewport: { width: 1280, height: 720 } });

test('every launcher screen scrolls with the wheel until its last control can be clicked', async ({ page }) => {
  await page.goto('/?seed=7');
  const screens = await page.locator('[data-open-screen]').evaluateAll(buttons => [...new Set(buttons.map(button => (button as HTMLElement).dataset.openScreen!))]);
  expect(screens).toContain('research');
  for (const id of screens) {
    await page.locator(`[data-open-screen="${id}"]`).first().click();
    const body = page.locator(`#screen-${id} .screen-body`);
    await expect(body).toBeVisible();
    const box = (await body.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 12; step++) await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(screenId => {
      const items = [...document.querySelectorAll<HTMLElement>(`#screen-${screenId} :is(button, select, input, a, summary)`)].filter(item => item.checkVisibility({ contentVisibilityAuto: true }) && !item.closest('details:not([open]) > :not(summary)'));
      const last = items.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
      if (!last) return 'none';
      const rect = last.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + Math.min(8, rect.width / 2), rect.top + rect.height / 2);
      return rect.bottom <= innerHeight + 1 && hit !== null && (hit === last || last.contains(hit) || hit.contains(last)) ? 'reachable' : `${last.textContent?.trim().slice(0, 12)} bottom ${Math.round(rect.bottom)}`;
    }, id), { message: `screen ${id}` }).toMatch(/reachable|none/);
    await page.keyboard.press('Escape');
    await expect(body).toBeHidden();
  }
});
