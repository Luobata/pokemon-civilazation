import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { knockoutTaskFixture } from './fixtures/research-tasks.ts';
import { verifyImportedReplay } from './fixtures/reachable.ts';
import { openScreen } from './ui.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import { RESEARCH_TASK_RULES_V24 } from '../../src/content/research-tasks.ts';
import { tasksDone } from '../../src/core/research-tasks.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameState } from '../../src/core/model.ts';

// v24 D (docs/design/world-v24.md §5): a real v24 AI game, real input. Seat 0's attack finishes "knock out 2" on a wild species.
const reports = process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots';
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
async function clickHex(page: Page, hex: Hex) {
  const p = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(mainPath), { tileToScreen } = await import(cameraPath);
    return tileToScreen(hex, camera, session.getView().map, document.querySelector<HTMLCanvasElement>('#map')!.clientWidth);
  }, hex);
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

test('v24 research tasks: the unit panel card follows the target, a knockout completes the task with one rail notice, the Pokédex lists the card', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const fixture = knockoutTaskFixture(), name = WORLD24_CONTENT.species[fixture.speciesId].name;
  // The knockout completes one more task on a card a real AI game built; the reward is the one for that count (notes at 2, capture at 4).
  const R = RESEARCH_TASK_RULES_V24, before = tasksDone(fixture.state.expansion!.researchTasks![0]![fixture.speciesId]!.tasks), after = before + 1;
  const reward = after === R.notesAt ? { hint: '调查笔记', toast: `调查笔记：科研 +${R.notesResearch}`, research: R.notesResearch }
    : after === R.captureAt ? { hint: `捕捉率 +${R.captureBonus}`, toast: `捕捉率 +${R.captureBonus}`, research: 0 } : null;
  await page.goto('/?seed=1&gameplay=24');
  await page.locator('#import-save').setInputFiles({ name: 'v24.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await verifyImportedReplay(page, fixture.save);
  await page.locator('#animate').uncheck();

  // Own unit selected: the card shows its own species, collapsed.
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  const card = page.locator('#unit-panel #research-card');
  const own = (fixture.state.units[fixture.unitId] as { speciesId: string }).speciesId;
  await expect(card).toHaveAttribute('data-species', own);
  await expect(card).not.toHaveAttribute('open', '');
  // Aiming at the wild Pokémon switches the card to its species: seen, 1 of 2 knockouts, one more knockout pays the next reward.
  await page.locator('#attack-unit').click();
  await clickHex(page, fixture.targetPosition);
  await expect(card).toHaveAttribute('data-species', fixture.speciesId);
  await expect(card).toContainText(`图鉴调查 · ${name}`);
  await expect(card.locator('[data-task="seen"]')).toHaveClass(/done/);
  await expect(card.locator('[data-task="knockouts"]')).toContainText(`击倒 1/${RESEARCH_TASK_RULES_V24.knockoutsNeeded} 只`);
  if (reward) await expect(card.locator('.research-next')).toContainText(`再击倒 1 只得${reward.hint}`);
  const reserve = (await state(page)).players[0].research.reserve;

  // Confirm with a second click on the target.
  await clickHex(page, fixture.targetPosition);
  await expect.poll(async () => (await state(page)).expansion!.researchTasks![0]![fixture.speciesId]!.knockouts).toBe(RESEARCH_TASK_RULES_V24.knockoutsNeeded);
  expect((await state(page)).players[0].research.reserve).toBe(reserve + (reward?.research ?? 0));
  const notice = page.locator('#toast-host .toast', { hasText: `图鉴调查：${name}` });
  await expect(notice).toHaveCount(1);
  if (reward) await expect(notice).toContainText(reward.toast);
  await page.screenshot({ path: `${reports}/research-tasks-notice.png` });

  // The Pokédex card in the world screen lists the species with its pips done.
  await openScreen(page, 'world');
  await page.locator('#expansion-panel details[data-system="s22-pokedex"] > summary').click();
  const book = page.locator('#research-book');
  await expect(book).toContainText('图鉴调查卡');
  await book.locator('summary').click();
  const row = book.locator(`li[data-species="${fixture.speciesId}"]`);
  await expect(row).toContainText(name);
  await expect(row.locator('.research-pips i.done')).toHaveCount(after);
  await page.screenshot({ path: `${reports}/research-tasks-book.png` });
  await page.locator('.screen:not([hidden]) .screen-close').click();

  // End the turn (Shift+click skips the idle-unit prompt); the AI seats play and control returns without errors.
  const round = (await state(page)).round;
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect.poll(async () => { const game = await state(page); return game.activePlayerId === 0 && game.round > round; }, { timeout: 120_000 }).toBe(true);
  await expect(page.locator('#end-turn')).toBeEnabled({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
