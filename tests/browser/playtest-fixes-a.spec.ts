// Playtest 2026-11 batch A (docs/design/playtest-2026-11/report.md): presentation fixes, checked with real input
// (menu, clicks, Shift+click end turn) on new games or on saves of real AI games (tests/browser/fixtures/playtest-ab.ts).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerView } from '../../src/core/model.ts';
import { openScreen, closeScreen, startNewGame } from './ui.ts';
import { builderFixture, leagueFixture, stoneFixture } from './fixtures/playtest-ab.ts';

const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'playtest.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
}
async function clickTile(page: Page, index: number) {
  const point = await page.evaluate(async index => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts', hexPath = '/src/core/hex.ts';
    const { session, camera } = await import(mainPath), { hexToWorld, toScreen } = await import(cameraPath), { indexToHex } = await import(hexPath);
    const screen = toScreen(hexToWorld(indexToHex(index, session.getView().map)), camera), rect = document.querySelector('#map')!.getBoundingClientRect();
    return { x: rect.x + screen.x, y: rect.y + screen.y };
  }, index);
  await page.mouse.click(point.x, point.y);
}
const endTurn = (page: Page) => page.locator('#end-turn').click({ modifiers: ['Shift'] });
async function newGame(page: Page, roundLimit: '100' | '200') {
  await openScreen(page, 'menu');
  await page.locator('#round-limit').selectOption(roundLimit);
  await startNewGame(page);
  await closeScreen(page);
}

test('B4 + B6: the conference card names the titles the victory needs; the starter reads as 拥有, not 捕捉', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/?seed=7&gameplay=24');
  for (const [limit, titles] of [['200', 3], ['100', 2]] as const) {
    await newGame(page, limit);
    await openScreen(page, 'world');
    const league = page.locator('details[data-system="s27-championship"]');
    await league.locator('summary').first().click();
    await expect(league).toContainText(`获得 ${titles} 届冠军即胜利`);
    await expect(league).toContainText(`当前冠军数 0/${titles}`);
    await expect(league).not.toContainText('两届');
    await openScreen(page, 'victory');
    await expect(page.locator('[data-victory="championship"]')).toContainText(`0/${titles}`);
  }
  // B6: the dex strip and counts show the starter as owned; the stored record is untouched (still documented).
  await openScreen(page, 'world');
  const dex = page.locator('details[data-system="s22-pokedex"]');
  await dex.locator('summary').first().click();
  await expect(dex.locator('.dex-entry img[alt*="拥有"]')).toHaveCount(1);
  await expect(dex.locator('.dex-entry img[alt*="已捕捉"]')).toHaveCount(0);
  await expect(dex.locator('[aria-label="捕捉 0"]')).toHaveCount(1);
  await expect(dex.locator('[aria-label="拥有（初始伙伴，非捕捉） 1"]')).toHaveCount(1);
  const record = (await view(page)).expansion!.world.player!.pokedex.bulbasaur;
  expect(record.captured).toBe(true);
  await openScreen(page, 'victory');
  await expect(page.locator('[data-victory="pokedex"]')).toContainText('捕捉 0 · 拥有 1');
  expect(errors).toEqual([]);
});

test('B5: the ≈rounds of a technology count the research reserve', async ({ page }) => {
  await page.goto('/?seed=7&gameplay=24');
  await page.locator('#animate').uncheck();
  // No topic chosen: three rounds of science go into the reserve.
  for (let turn = 0; turn < 3; turn++) { const round = (await view(page)).round; await endTurn(page); await expect.poll(async () => (await view(page)).round).toBe(round + 1); }
  const state = await view(page);
  const research = state.economy.player.research, perRound = state.economy.cities.reduce((sum, city) => sum + city.yields.research, 0);
  expect(research.techId).toBeNull();
  expect(research.reserve).toBeGreaterThan(0);
  await openScreen(page, 'research');
  const costs = await page.evaluate(async () => { const path = '/src/browser/main.ts', units = '/src/content/units.ts';
    const { session } = await import(path), { contentForView } = await import(units);
    return Object.fromEntries(Object.entries(contentForView(session.getView()).techs as Record<string, { cost: number }>).map(([id, tech]) => [id, tech.cost])); });
  const available = await page.locator('.tech-node.available').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.treeNode!));
  let differs = 0;
  for (const id of available) {
    const left = costs[id]! - research.progressByTech[id as keyof typeof research.progressByTech];
    const expected = Math.max(1, Math.ceil(Math.max(0, left - research.reserve) / Math.max(1, perRound)));
    if (expected !== Math.max(1, Math.ceil(left / Math.max(1, perRound)))) differs++;
    await expect(page.locator(`[data-tree-node="${id}"] .node-rounds`)).toHaveAttribute('aria-label', `约轮数 ≈${expected}`);
  }
  expect(differs, 'the reserve shortens at least one estimate').toBeGreaterThan(0);
});

test('B2: the to-do bar does not call a builder or trader a settler (real AI save)', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = builderFixture();
  await importSave(page, fixture.save);
  const chips = page.locator('#turn-reminders');
  await expect(chips.locator('button').first()).toBeVisible();
  await expect(chips).not.toContainText('开拓队：去建新城');
  await expect(chips).not.toContainText('开拓队有危险');
  await page.screenshot({ path: `${reports}/playtest-b2-todo.png` });
});

test('B3: a Pokémon that only evolves with a stone names the stone, not "no form" (real AI save)', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = stoneFixture();
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  await clickTile(page, fixture.id);
  const evolve = page.locator('#evolve-unit');
  await expect(evolve).toBeVisible();
  await expect(evolve).toHaveAttribute('data-reason', /^需要.+之石 \+ EXP \d+/);
  await evolve.hover();
  await expect(page.locator('#evolve-unit-tip')).toContainText('之石');
  await expect(page.locator('#evolve-unit-tip')).not.toContainText('没有可进化的形态');
  await page.screenshot({ path: `${reports}/playtest-b3-stone.png` });
});

test('B1: countdowns 5 rounds and 1 round before the league, then a toast, a 动态 entry and the result card (real AI save)', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = leagueFixture();
  const next = fixture.state.expansion!.civilization!.championship.nextRound;
  await importSave(page, fixture.save);
  // Register the team with the world page's button (seat 0 is at peace with six Pokémon on the map).
  await openScreen(page, 'world');
  const card = page.locator('details[data-system="s27-championship"]');
  await card.locator('summary').click();
  await card.getByRole('button', { name: '报名当前六只宝可梦' }).click();
  await expect(card).toContainText('已报名');
  await closeScreen(page);
  const rail = page.locator('#toast-host');
  const reached = async (round: number) => { while ((await view(page)).round < round) { const at = (await view(page)).round; await endTurn(page); await expect.poll(async () => (await view(page)).round, { timeout: 120_000 }).toBeGreaterThan(at); } };
  await reached(next - 5);
  await expect(rail.locator('[data-toast]', { hasText: '5 轮后开幕' })).toHaveCount(1);
  await reached(next - 1);
  await expect(rail.locator('[data-toast]', { hasText: '下一轮开幕' })).toHaveCount(1);
  await expect(rail.locator('[data-toast]', { hasText: '轮后开幕' })).toHaveCount(0); // the newer countdown replaced the older one
  await expect(rail.locator('[data-toast]', { hasText: '下一轮开幕' })).toContainText('已报名');
  await reached(next + 1);
  const result = rail.locator('[data-toast]', { hasText: '联盟大会' }).filter({ hasNotText: '开幕' });
  await expect(result).toHaveCount(1);
  const season = (await view(page)).expansion!.civilization!.championship.history.at(-1)!;
  // The toast opens the result card on the 动态 screen.
  await result.locator('.toast-icon').click();
  await expect(page.locator('#screen-log')).toBeVisible();
  const resultCard = page.locator('#league-result-card');
  await expect(resultCard).toBeVisible();
  await expect(resultCard).toHaveAttribute('data-season', String(season.season));
  await expect(resultCard.locator('.league-match')).toHaveCount(5);
  await expect(resultCard.locator('.league-team.mine').first()).toBeVisible();
  await expect(resultCard.locator('#league-own')).toContainText('你的队伍');
  await expect(resultCard.locator('.league-damage li')).toHaveCount(6);
  // Per-Pokémon damage equals the battle traces of the event.
  const mine = season.entrants.find(entrant => entrant.playerId === 0)!;
  const dealt = mine.roster.map(combatant => season.matches.flatMap(match => match.battle.rounds.flatMap(round => round.strikes))
    .filter(strike => strike.attackerId === combatant.id).reduce((sum, strike) => sum + strike.damage, 0));
  for (const [index, amount] of dealt.entries()) await expect(resultCard.locator('.league-damage li').nth(index).locator('[aria-label^="造成伤害"]')).toHaveAttribute('aria-label', `造成伤害 ${amount}`);
  // Every icon in the card has an accessible name or is decorative next to text that names it.
  expect(await resultCard.locator('img:not([alt])').count()).toBe(0);
  await expect(page.locator('#activity-list')).toContainText(`第 ${season.season} 届联盟大会`);
  await resultCard.screenshot({ path: `${reports}/playtest-b1-league-result.png` });
  await page.screenshot({ path: `${reports}/playtest-b1-league-screen.png` });
  expect(errors).toEqual([]);
});
