// Second playtest, batch E (docs/design/playtest-2026-11b/report.md O1, N6, F3), with real input on a new v26 game:
// progress stages are 世代 and golden/dark ages 时代; other civilizations are named after their leader.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { LEADERS } from '../../src/content/leaders.ts';
import { LEADER_CIV_NAMES } from '../../src/browser/civ-names.ts';
import { closeScreen, openScreen } from './ui.ts';

const shots = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/fixes-2`;
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });

test('O1 / F3: 世代 and 时代 on the era screen, leader-named civilizations in diplomacy, the World page and the war dialog', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seed=11');
  await page.locator('#animate').uncheck();
  // The launcher entry and the era screen use 世代 for progress, 时代 for the golden / dark age.
  await expect(page.locator('[data-open-screen="era"]')).toContainText('世代');
  await openScreen(page, 'era');
  const era = page.locator('#era-panel');
  await expect(page.locator('#screen-title-era')).toHaveText('世代与世代能力');
  await expect(era).toContainText('世代进程');
  await expect(era).toContainText('初代');
  for (const old of ['时代进程', '黄金世代', '普通世代', '世代分', '世代荣誉']) await expect(era).not.toContainText(old);
  await page.screenshot({ path: `${shots}/e-era-panel.png` });
  await closeScreen(page);

  // End a turn the way a player does, then read the names the view gives the other seats.
  const round = (await view(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBeGreaterThan(round);
  const current = await view(page);
  const others = current.civilizations.filter(civ => civ.id !== current.playerId && !civ.eliminated);
  expect(others.length).toBeGreaterThan(0);
  const names = others.map(civ => `${LEADERS[civ.leaderId!].name}的${LEADER_CIV_NAMES[civ.leaderId!]}`);

  await openScreen(page, 'diplomacy');
  const list = page.locator('#diplomacy .diplomacy-list');
  for (const name of names) await expect(list).toContainText(name);
  // Each name has a seat-colour flag with an accessible name.
  await expect(list.locator('.diplomacy-name img.civ-flag').first()).toHaveAttribute('alt', new RegExp(`${names[0]}（文明 \\d）`));
  await page.screenshot({ path: `${shots}/e-diplomacy.png` });
  // The war confirmation names the civilization too (cancelled: no rule is exercised here).
  await page.locator(`[data-war="${others[0].id}"]`).click();
  await expect(page.locator('#war-target')).toHaveText(names[0]);
  await page.locator('#cancel-war').click();
  await closeScreen(page);

  // The World page's gym circuit lists the other civilizations by leader, with their flag.
  await openScreen(page, 'world');
  const circuit = page.locator('details[data-system="s-gym-circuit"]');
  if (await circuit.getAttribute('open') === null) await circuit.locator('summary').first().click();
  await expect(circuit.locator('.world-stats')).toContainText(LEADERS[others[0].leaderId!].name);
  await expect(circuit.locator('.world-stats')).not.toContainText('文明 2');
  await circuit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/e-world.png` });
  await closeScreen(page);

  // The victory page's conquest row names them as well (the flags' accessible names).
  await openScreen(page, 'victory');
  await expect(page.locator(`#screen-victory img[alt^="${names[0]}"]`).first()).toBeVisible();
  await closeScreen(page);
  expect(errors).toEqual([]);
});
