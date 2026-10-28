import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateRealGame } from './fixtures/real-game.ts';

const screenshots = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const acceptance = process.env.M6_UI_REPORT_DIR ?? screenshots;

test('complete small-map game with milestone screenshots and identical command replay', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(screenshots, { recursive: true });
  await mkdir(acceptance, { recursive: true });
  const game = generateRealGame({ seed: 1, width: 24, height: 16, personalities: ['conservative', 'aggressive'] });
  expect(game.finalState.outcome?.kind).toBe('score');
  expect(game.invalid).toBe(0);
  for (const milestone of ['city', 'battle', 'capture', 'war', 'peace', 'outcome']) expect(game.milestones[milestone]).not.toBeUndefined();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seed=1');
  await page.locator('#starter').selectOption('bulbasaur');
  await page.locator('#map-size').selectOption('24x16');
  await page.locator('#ai-count').selectOption('1');
  await page.locator('#ai-personality').selectOption('aggressive');
  await page.locator('#new-game').click();
  await page.locator('#animate').uncheck();

  const taken = new Set<string>();
  const visualChecks: unknown[] = [];
  async function capture(name: string) {
    if (taken.has(name)) return;
    taken.add(name);
    await page.locator('#fit').click();
    await page.screenshot({ path: `${screenshots}/m6ui-${name}.png`, fullPage: true });
    await page.screenshot({ path: `${acceptance}/m6ui-${name}.png`, fullPage: true });
    visualChecks.push(await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      outcomeOpen: document.querySelector<HTMLDialogElement>('#gameover-dialog')!.open,
      endTurnDisabled: document.querySelector<HTMLButtonElement>('#end-turn')!.disabled,
      newGameDisabled: document.querySelector<HTMLButtonElement>('#new-game')!.disabled,
    })));
  }

  await capture('opening');
  for (const [index, command] of game.commands.entries()) {
    if (command.actorId !== 0) continue;
    const result = await page.evaluate(async action => {
      const mainPath = '/src/browser/main.ts';
      const { session, developerAdapter } = await import(mainPath);
      return { result: session.issue(action), log: developerAdapter.exportLog() };
    }, command.action);
    expect(result.result).toEqual({ ok: true });
    expect(result.log.commands).toEqual(game.commands.slice(0, result.log.commands.length));
    for (const [name, milestone] of Object.entries(game.milestones)) {
      if (milestone >= index && milestone < result.log.commands.length) await capture(name);
    }
    if (game.milestones.outcome !== undefined && game.milestones.outcome < result.log.commands.length) await capture('outcome');
  }
  await capture('outcome');
  await expect(page.locator('#gameover-dialog')).toBeVisible();
  await expect(page.locator('#outcome-ranking')).toContainText('2×80');
  await expect(page.locator('#end-turn')).toBeDisabled();
  await expect(page.locator('#new-game')).toBeEnabled();
  await expect(page.locator('#activity-list')).toContainText('攻击了');
  await expect(page.locator('#activity-list')).not.toContainText('文明 27');
  await expect(page.locator('#activity-list')).not.toContainText('文明 32');
  const finalLog = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts'; return (await import(mainPath)).developerAdapter.exportLog();
  });
  expect(finalLog.commands).toEqual(game.commands);
  expect(errors).toEqual([]);
  await writeFile(process.env.M6_UI_OUTPUT ?? '/tmp/m6-ui-results.json', JSON.stringify({
    seed: game.setup.seed, commands: game.commands.length, round: game.finalState.round,
    outcome: game.finalState.outcome, milestones: game.milestones,
    screenshots: [...taken].map(name => `${acceptance}/m6ui-${name}.png`), visualChecks,
  }, null, 2));
});
