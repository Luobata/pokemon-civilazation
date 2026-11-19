// Gameplay v27 ⑥ (docs/design/pace-v27.md §7.4): the league trainers on screen, on the save of a real v27 AI game (every seat played by
// the shipped AI, tests/browser/fixtures/league-v27.ts): the original portraits in the conference bracket and the result card, the
// league roster on the world page with the nemesis, the profile hover card (theme types, signature sprite, record), the lineup picker's
// opponent column; then registration and the turn ended with Shift+click until the season is played.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { closeScreen, openScreen } from './ui.ts';
import { leagueFixture } from './fixtures/league-v27.ts';
import { leagueNemesis } from '../../src/core/league-roster.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=27');
  await page.locator('#import-save').setInputFiles({ name: 'league.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  await page.locator('#animate').uncheck();
}
async function endTurn(page: Page) {
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
}

test('league trainers: roster, nemesis, profile card, lineup picker, bracket portraits; register and play the season (real AI save)', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = leagueFixture();
  await importSave(page, fixture.save);
  const card = page.locator('#trainer-card');

  // World page: the roster strip (8 portraits; trainers met so far in colour) and the announced trainers, the nemesis first.
  await openScreen(page, 'world');
  const league = page.locator('details[data-system="s27-championship"]');
  await league.locator('summary').first().click();
  const strip = league.locator('.league-roster-strip li');
  await expect(strip).toHaveCount(8);
  await expect(strip.locator('img[src^="/trainers/"]')).toHaveCount(8);
  expect(await league.locator('.league-roster-strip li.met').count()).toBeGreaterThan(0);
  if (fixture.nemesis) {
    await expect(league.locator('#league-world')).toContainText('宿敌');
    await expect(league.locator('.league-roster-strip li.nemesis')).toHaveCount(1);
  }
  // Hovering a chip opens the profile card: title, both type badges, the signature sprite with its star, the record.
  await strip.locator('.trainer-chip').first().hover();
  await expect(card).toBeVisible();
  await expect(card.locator('.tc-types .type-badge')).toHaveCount(2);
  await expect(card.locator('.tc-ace img[src^="/sprites/"]')).toHaveCount(1);
  await expect(card.locator('.tc-record')).toContainText('出场');
  await page.screenshot({ path: `${reports}/pace-v27-league-roster.png` });
  // Keyboard focus opens it too; Escape closes it.
  await strip.locator('.trainer-chip').nth(1).focus();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('#screen-world'), 'Escape closes only the card').toBeVisible();

  // The lineup picker: the opponent column shows the trainer (portrait, title, theme types) and its signature with a star.
  await league.locator('[data-lineup="championship:"]').click();
  const picker = page.locator('#lineup-picker');
  await expect(picker).toBeVisible();
  await expect(picker.locator('#lineup-trainer img[src^="/trainers/"]')).toHaveCount(1);
  await expect(picker.locator('.lp-foes li.ace')).toHaveCount(1);
  const tabs = picker.locator('[data-opponent]');
  expect(await tabs.locator('img[src^="/trainers/"]').count()).toBe(await tabs.count());
  if (fixture.nemesis && await picker.locator('.lp-tabs button.nemesis').count()) await expect(picker.locator('.lp-tabs button.nemesis')).toHaveAttribute('aria-selected', 'true');
  const first = await picker.locator('#lineup-trainer b').textContent();
  if (await tabs.count() > 1) {
    const other = picker.locator('[data-opponent][aria-selected="false"]').first();
    await other.click();
    await expect(picker.locator('#lineup-trainer b')).not.toHaveText(first ?? '');
  }
  await picker.locator('#lineup-trainer .trainer-chip').hover();
  await expect(card).toBeVisible();
  await page.screenshot({ path: `${reports}/pace-v27-lineup-trainer.png` });
  await picker.locator('#lineup-confirm').click();
  await expect.poll(async () => (await view(page)).expansion!.civilization.championship.registration?.unitIds.length ?? 0).toBe(6);
  await closeScreen(page);

  // Shift+click ends the turn until the season is played; the result card's bracket shows the trainers' portraits and the roster.
  const seasons = (await view(page)).expansion!.civilization.championship.history.length;
  for (let turn = 0; turn < 8 && (await view(page)).expansion!.civilization.championship.history.length === seasons; turn++) {
    const round = (await view(page)).round;
    await endTurn(page);
    await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBeGreaterThan(round);
  }
  const latest = (await view(page)).expansion!.civilization.championship.history;
  expect(latest.length).toBe(seasons + 1);
  expect(latest.at(-1)!.entrants.some(entrant => entrant.playerId === 0)).toBe(true);
  await openScreen(page, 'log');
  const result = page.locator('#league-result-card');
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute('data-season', String(latest.at(-1)!.season));
  expect(await result.locator('.lb-flag.trainer img[src^="/trainers/"]').count()).toBeGreaterThan(0);
  await expect(result.locator('#league-trainers .league-roster-strip li')).toHaveCount(8);
  // A trainer who beat seat 0 this season makes it (or keeps it) seat 0's nemesis: named in the roster heading and marked in the strip.
  if (leagueNemesis(latest, 0)) {
    await expect(result.locator('#league-trainers h4')).toContainText('宿敌');
    await expect(result.locator('#league-trainers li.nemesis')).toHaveCount(1);
  }
  await result.locator('.lb-flag.trainer .trainer-chip').first().hover();
  await expect(card).toBeVisible();
  await expect(card.locator('.tc-name')).not.toBeEmpty();
  await page.screenshot({ path: `${reports}/pace-v27-league-bracket.png` });
  expect(errors).toEqual([]);
});
