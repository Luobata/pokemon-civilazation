// depth-v26 §2.5 / §4 / §6.2 (presentation only): battle replays, type-matchup grids, the conference bracket, the
// evolution-conditions panel and the evolution moment — real input on saves of real AI games (Shift+click end turn).
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { GameState, PlayerView } from '../../src/core/model.ts';
import { gymFixture } from './fixtures/world-v24.ts';
import { leagueEveFixture } from './fixtures/playtest-ab.ts';
import { rosterFixture } from './fixtures/roster.ts';
import { evolveFixture, foreignEvolutionFixture, guardianFixture } from './fixtures/battle-evo.ts';
import { leaderTeam, gymAt } from '../../src/core/gym-circuit.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { contentFor } from '../../src/content/units.ts';
import { openScreen } from './ui.ts';

const dir = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/battle-evo`;
test.use({ viewport: { width: 1280, height: 900 } });
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
const view = (page: Page): Promise<PlayerView> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView(); });
async function importSave(page: Page, save: string, animate = false) {
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成', { timeout: 120_000 });
  if (!animate) await page.locator('#animate').uncheck();
}
/** Spies on `audio.play` (the module instance the game uses). */
async function spyAudio(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/browser/audio/index.ts';
    const { audio } = await import(path);
    const calls: string[] = [];
    (window as unknown as { __sounds: string[] }).__sounds = calls;
    const play = audio.play.bind(audio);
    audio.play = (id: string) => { calls.push(id); play(id); };
  });
}
const sounds = (page: Page) => page.evaluate(() => [...(window as unknown as { __sounds: string[] }).__sounds]);
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** The viewer keeps off the action bar, the notification rail, the objective card and the combat cards. */
async function expectClearOfHud(page: Page, element: Locator) {
  const box = (await element.boundingBox())!;
  for (const selector of ['#unit-action-bar', '#toast-host', '#opening-goals', '#combat-card']) {
    const other = page.locator(selector);
    if (!await other.isVisible()) continue;
    const rect = await other.boundingBox();
    if (rect && rect.width && rect.height) expect(overlaps(box, rect), `${selector} is covered`).toBe(false);
  }
}
/** Every icon and sprite is named or explicitly decorative. */
async function expectNamedIcons(scope: Locator) {
  const unnamed = await scope.evaluate(root => [...root.querySelectorAll<HTMLElement>('img.px-icon, img.px-art, [role="img"]')]
    .filter(element => element.getAttribute('aria-hidden') !== 'true' && !(element.getAttribute('alt') || element.getAttribute('aria-label') || '').trim())
    .map(element => element.outerHTML.slice(0, 120)));
  expect(unnamed).toEqual([]);
}
async function endTurn(page: Page) {
  const story = page.locator('#legend-arrival-close');
  while (await story.isVisible()) { await story.click(); await page.waitForTimeout(100); }
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
}

test('gym: the challenge card shows the matchup grid; the result opens a replay that plays, steps, speeds up and skips to the result', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = gymFixture(), unit = fixture.state.units[fixture.id]!;
  if (unit.location !== 'map') throw new Error('expected a unit on the map');
  const gym = gymAt(fixture.state.expansion!.gymCircuit, hexToIndex(unit.position, fixture.state.map)!)!;
  const leader = leaderTeam(gym, fixture.state.expansion!.gymCircuit!.badges[0]!.length, fixture.state.setup.seed, contentFor(fixture.state.setup));
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.id));
  await page.locator('#map').focus();
  await page.keyboard.press('g');
  const card = page.locator('#gym-card');
  await expect(card).toBeVisible();
  const grid = card.locator('#gym-matchup');
  await expect(grid).toBeVisible();
  const team = await card.locator('.cp-attack .cp-who').count();
  await expect(grid.locator('td.mu-cell')).toHaveCount(team * leader.length);
  await expect(card.locator('#gym-card-leader-team img')).toHaveCount(leader.length);
  await expect(grid.locator('td.mu-cell').first()).toHaveAttribute('aria-label', /你的攻击 ×[\d.]+ .+；对手的攻击 ×[\d.]+/);
  await expectNamedIcons(card);
  await page.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: `${dir}/gym-card-matchup.png` });

  await spyAudio(page);
  await card.locator('#gym-card-challenge').click();
  await expect.poll(async () => (await state(page)).expansion!.gymCircuit!.challengedAt[0]?.[gym.id]).toBe(fixture.state.round);
  const toast = page.locator('#toast-host [data-toast]', { hasText: '馆主' }).first();
  await expect(toast.locator('.toast-action')).toHaveText('观看对战');
  await toast.locator('.toast-icon').click();
  const viewer = page.locator('#battle-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-mode', 'animated');
  await expect(viewer).toHaveAttribute('data-playing', 'true');
  await expectClearOfHud(page, viewer);
  const strikes = (await state(page)).expansion!.gymCircuit!.challengedAt[0] ? await viewer.locator('.bv-step').count() : 0;
  expect(strikes).toBeGreaterThan(0);
  await expectNamedIcons(viewer);
  // It plays by itself: the send-out, then the first strike (a sound per hit).
  await expect.poll(async () => Number(await viewer.getAttribute('data-beat')), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(420);
  await viewer.screenshot({ path: `${dir}/replay-gym-strike.png` });
  await expect.poll(async () => (await sounds(page)).some(id => id.startsWith('attack')), { timeout: 20_000 }).toBe(true);
  // Speed ×2, then step by hand (pauses), then skip to the result.
  await viewer.locator('#bv-speed').click();
  await expect(viewer).toHaveAttribute('data-speed', '2');
  await viewer.locator('#bv-next').click();
  await expect(viewer).toHaveAttribute('data-playing', 'false');
  const paused = Number(await viewer.getAttribute('data-beat'));
  if (paused <= strikes) {
    await viewer.locator('#bv-next').click();
    await expect(viewer).toHaveAttribute('data-beat', String(paused + 1));
  }
  expect(await viewer.locator('.bv-steps .current').count()).toBeLessThanOrEqual(1);
  await viewer.locator('#bv-skip').click();
  await expect(viewer.locator('#bv-caption')).toContainText(/胜利！|落败/);
  await page.waitForTimeout(400);
  await viewer.screenshot({ path: `${dir}/replay-gym-result.png` });
  await page.screenshot({ path: `${dir}/replay-gym-screen.png` });
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('gym replay under reduced motion: a still stage and the step list', async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = gymFixture();
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.id));
  await page.locator('#map').focus();
  await page.keyboard.press('g');
  await page.locator('#gym-card-challenge').click();
  await page.locator('#toast-host [data-toast]', { hasText: '馆主' }).first().locator('.toast-icon').click();
  const viewer = page.locator('#battle-viewer');
  await expect(viewer).toHaveAttribute('data-mode', 'still');
  await expect(viewer.locator('#bv-play')).toBeHidden();
  await expect(viewer.locator('#bv-caption')).toContainText(/胜利！|落败/);
  // Stepping shows each strike's result without motion.
  await viewer.locator('.bv-step button').first().click();
  await expect(viewer.locator('#bv-caption')).toContainText('伤害');
  await viewer.screenshot({ path: `${dir}/replay-gym-still.png` });
});

test('sanctuary guardian: the world panel opens the preview card with the matchup grid; the card then offers the replay', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = guardianFixture();
  await importSave(page, fixture.save);
  await openScreen(page, 'world');
  const card = page.locator('details[data-system="s24-sanctuaries"]');
  await card.locator('summary').click();
  const seq = (await state(page)).commandSeq;
  await card.getByRole('button', { name: '挑战守卫' }).first().click();
  const preview = page.locator('#challenge-card');
  await expect(preview).toBeVisible();
  expect((await state(page)).commandSeq).toBe(seq);
  await expect(preview.locator('#challenge-matchup td.mu-cell').first()).toBeVisible();
  await expectNamedIcons(preview);
  await preview.screenshot({ path: `${dir}/guardian-card-matchup.png` });
  await preview.locator('#challenge-card-confirm').click();
  await expect.poll(async () => (await state(page)).commandSeq).toBeGreaterThan(seq);
  await expect(preview.locator('#challenge-card-outcome')).toBeVisible();
  await preview.locator('#challenge-card-watch').click();
  const viewer = page.locator('#battle-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-kind', 'guardian');
  await expect.poll(async () => Number(await viewer.getAttribute('data-beat')), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(450);
  await viewer.screenshot({ path: `${dir}/replay-guardian.png` });
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(preview).toBeVisible(); // Esc closes the replay first, then the card
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  expect(errors).toEqual([]);
});

test('league: after a real season the result card shows the sprite bracket; any match opens its replay', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = leagueEveFixture();
  await importSave(page, fixture.save);
  const season = fixture.id;
  // The season is played at the end of round N: end turns (Shift+click) until its result is in.
  for (let guard = 0; guard < 4 && !(await view(page)).expansion!.civilization!.championship.history.length; guard++) {
    const at = (await view(page)).round;
    await endTurn(page);
    await expect.poll(async () => (await view(page)).round, { timeout: 180_000 }).toBeGreaterThan(at);
  }
  expect((await view(page)).expansion!.civilization!.championship.history.length).toBeGreaterThan(0);
  expect((await view(page)).round).toBeGreaterThan(season);
  await openScreen(page, 'log');
  const result = page.locator('#league-result-card');
  await expect(result).toBeVisible();
  const bracket = result.locator('.lb');
  await expect(bracket.locator('.league-match')).toHaveCount(5);
  await expect(bracket.locator('.lb-slot img.px-art')).toHaveCount(10);
  await expect(bracket.locator('.lb-lines path.champ')).not.toHaveCount(0);
  await expect(bracket.locator('.lb-champion')).toBeVisible();
  await expectNamedIcons(result);
  await page.evaluate(() => document.fonts.ready);
  await bracket.screenshot({ path: `${dir}/league-bracket.png` });
  await result.screenshot({ path: `${dir}/league-card.png` });
  const replay = bracket.locator('[data-league-replay="final"]');
  await expect(replay).toBeEnabled();
  await replay.click();
  const viewer = page.locator('#battle-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-kind', 'league');
  await expect.poll(async () => Number(await viewer.getAttribute('data-beat')), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(380);
  await viewer.screenshot({ path: `${dir}/replay-league-final.png` });
  await viewer.locator('#bv-skip').click();
  await page.waitForTimeout(400);
  await viewer.screenshot({ path: `${dir}/replay-league-result.png` });
  await page.screenshot({ path: `${dir}/replay-league-screen.png` });
  expect(errors).toEqual([]);
});

test('evolution panel: an Eevee shows every branch with its conditions as icons (met / unmet), the bar keeps the main branch', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = rosterFixture('eevee');
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'roster.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await page.locator('#animate').uncheck();
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const panel = page.locator('#evolution-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.evo-card')).toHaveCount(5);
  await expect(panel.locator('#evolution-branches [data-evolve]')).toHaveCount(4);
  // Day / night, terrain and era conditions are icons whose names say the rule and whether it holds.
  await expect(panel.locator('[data-check="time"]')).toHaveCount(2);
  await expect(panel.locator('[data-check="terrain"]')).toHaveCount(2);
  await expect(panel.locator('[data-check="xp"]').first()).toHaveAttribute('aria-label', /经验 \d+\/250.*：未满足/);
  await expect(panel.locator('.evo-check.met[data-check="time"], .evo-check.unmet[data-check="time"]')).toHaveCount(2);
  await expect(panel.locator('.evo-line .evo-form.current')).toHaveCount(1);
  await expectNamedIcons(panel);
  await page.evaluate(() => document.fonts.ready);
  await panel.screenshot({ path: `${dir}/evolution-panel-eevee.png` });
  await page.screenshot({ path: `${dir}/evolution-panel-eevee-screen.png` });
});

test('evolution moment: flash, alternating silhouettes speeding up, the reveal with sparkles and the fanfare; reduced motion swaps at once', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = evolveFixture();
  await importSave(page, fixture.save, true);
  await page.locator('#unit-select').selectOption(String(fixture.id));
  const panel = page.locator('#evolution-panel');
  await expect(panel.locator('.evo-card.ready')).not.toHaveCount(0);
  await panel.screenshot({ path: `${dir}/evolution-panel-ready.png` });
  await spyAudio(page);
  await page.locator('#map').focus();
  await page.keyboard.press('e');
  const frames: { form?: string; white?: number }[] = [];
  const started = Date.now();
  let shot = false;
  while (Date.now() - started < 4000) {
    const frame = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().frame; });
    const pose = frame.poses.find((item: { evolution?: string }) => item.evolution);
    if (pose) frames.push({ form: pose.evolution, white: pose.white });
    if (pose && pose.white === 1 && !shot) { shot = true; await page.locator('#map').screenshot({ path: `${dir}/evolution-silhouette.png` }); }
    if (!pose && frames.length) break;
    await page.waitForTimeout(40);
  }
  const forms = frames.map(item => item.form).filter((form, index, all) => index === 0 || form !== all[index - 1]);
  expect(forms.length, JSON.stringify(forms)).toBeGreaterThanOrEqual(4);
  expect(forms[0]).toBe('from');
  expect(forms.at(-1)).toBe('to');
  expect(frames.some(item => item.white === 1)).toBe(true);
  await expect.poll(async () => sounds(page)).toContain('evolveFanfare');
  expect((await sounds(page)).indexOf('evolve')).toBeLessThan((await sounds(page)).indexOf('evolveFanfare'));
  await expect(page.locator('#action-notice')).toContainText('恭喜！');
  expect(errors).toEqual([]);
});

test('evolution under reduced motion: the new form at once with a short glow (no pose), the fanfare still plays', async ({ page }) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = evolveFixture();
  await importSave(page, fixture.save, true);
  await page.locator('#unit-select').selectOption(String(fixture.id));
  await spyAudio(page);
  await page.locator('#map').focus();
  await page.keyboard.press('e');
  const seen = await page.evaluate(async () => {
    const path = '/src/browser/main.ts', { developerAdapter } = await import(path), kinds = new Set<string>(); let posed = false;
    for (let i = 0; i < 30; i++) {
      const frame = developerAdapter.getPresentation().frame;
      for (const effect of frame.effects) kinds.add(effect.kind);
      if (frame.poses.some((pose: { evolution?: string }) => pose.evolution)) posed = true;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    return { kinds: [...kinds], posed };
  });
  expect(seen.posed).toBe(false);
  expect(seen.kinds).toContain('evolution');
  await expect.poll(async () => sounds(page)).toContain('evolveFanfare');
});

test('another player\'s evolution on a visible unit plays after the AI turn (V7: only on screen)', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = foreignEvolutionFixture();
  await importSave(page, fixture.save, true);
  await page.locator('#fit').click();
  await endTurn(page);
  await expect.poll(async () => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().events
    .filter((event: { type: string }) => event.type === 'ForeignEvolution').length; }), { timeout: 120_000 }).toBeGreaterThan(0);
  const events = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().events; });
  const foreign = events.filter((event: { type: string }) => event.type === 'ForeignEvolution');
  expect(foreign.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
