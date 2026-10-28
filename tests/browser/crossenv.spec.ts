import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { GameSession, replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { serializeSave } from '../../src/app/save.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

async function snapshot(page: Page): Promise<{ state: GameState; log: CommandLog }> {
  return page.evaluate(async () => {
    const path = '/src/browser/main.ts';
    const { developerAdapter } = await import(path);
    return { state: developerAdapter.getState(), log: developerAdapter.exportLog() };
  });
}
function finishInNode(setup: GameSetup) {
  const session = new GameSession(setup);
  for (let turn = 0; turn < 100 && !session.getView().outcome; turn++) {
    expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
    session.skipAnimations();
  }
  expect(session.getView().outcome).not.toBeNull();
  expect(session.aiInvalidCommands).toEqual([]);
  return session;
}
function summary(state: GameState) {
  return { digest: stateDigest(state), seed: state.setup.seed, round: state.round, commandSeq: state.commandSeq,
    outcome: state.outcome, schema: state.schemaVersion, rules: state.rulesVersion, content: state.contentVersion };
}

test('complete Node game with three AI replays identically in Chromium', async ({ page }, testInfo) => {
  const node = finishInNode({ seed: 2, width: 24, height: 16, roundLimit: 100, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur' },
    { id: 1, controller: 'ai', personality: 'expansion' },
    { id: 2, controller: 'ai', personality: 'aggressive' },
    { id: 3, controller: 'ai', personality: 'conservative' },
  ] });
  const log = node.exportLog(), expected = node.getState();
  expect(new Set(log.commands.map(command => command.actorId)).size).toBe(4);
  // Import the full command log in the existing save envelope at its genuine initial state.
  // The browser then executes every command through its normal replay control.
  const initial = replay(log, 0), imported = serializeSave(initial, log);
  await page.goto('/?seed=2');
  await page.locator('#animate').uncheck();
  await page.locator('#import-save').setInputFiles({ name: 'complete-node-log.json', mimeType: 'application/json', buffer: Buffer.from(imported) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  expect(canonicalSerialize((await snapshot(page)).state)).toBe(canonicalSerialize(initial));
  await page.locator('#dev-drawer > summary').click();
  await page.locator('#sequence').fill(String(log.commands.length));
  await page.locator('#replay').click();
  await expect(page.locator('#gameover-dialog')).toBeVisible();
  const browser = await snapshot(page);
  expect(browser.log).toEqual(log);
  expect(summary(browser.state)).toEqual(summary(expected));
  expect(canonicalSerialize(browser.state)).toBe(canonicalSerialize(expected));
  await testInfo.attach('crossenv-result', { body: JSON.stringify({ node: summary(expected), chromium: summary(browser.state), fullStateEqual: true }, null, 2), contentType: 'application/json' });
  await testInfo.attach('node-command-log', { body: JSON.stringify(log), contentType: 'application/json' });
});

test('full browser game survives midgame save/load and reaches the same visible ending', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/?seed=10');
  await page.locator('#animate').uncheck();
  await page.locator('#ai-count').selectOption('1');
  await page.locator('#ai-personality').selectOption('aggressive');
  await page.locator('#round-limit').selectOption('100');
  await page.locator('#starter').selectOption('bulbasaur');
  await page.locator('#new-game').click();
  const initial = (await snapshot(page)).state;
  expect(initial.setup).toMatchObject({ seed: 10, width: 24, height: 16, roundLimit: 100 });
  expect(initial.setup.players).toHaveLength(2);
  const finish = async () => {
    for (let turn = 0; turn < 100 && !(await snapshot(page)).state.outcome; turn++) {
      await page.locator('#end-turn').click();
    }
    await expect(page.locator('#gameover-dialog')).toBeVisible();
    await expect(page.locator('#outcome-title')).toHaveText('失败出局');
    await expect(page.locator('#outcome-ranking tr')).toHaveCount(2);
    await expect(page.locator('#end-turn')).toBeDisabled();
    const result = await snapshot(page);
    expect(result.state.outcome).toMatchObject({ kind: 'playerDefeat', round: 27 });
    return result;
  };
  const direct = await finish();
  await page.locator('#gameover-close').click();
  await page.locator('#new-game').click();
  expect(canonicalSerialize((await snapshot(page)).state)).toBe(canonicalSerialize(initial));
  for (let turn = 0; turn < 4; turn++) await page.locator('#end-turn').click();
  const checkpoint = await snapshot(page);
  expect(checkpoint.state.round).toBe(5);
  expect(checkpoint.state.outcome).toBeNull();
  await page.locator('#save-game').click();
  await expect(page.locator('#action-notice')).toContainText('已保存');
  await page.locator('#end-turn').click();
  expect((await snapshot(page)).state.commandSeq).toBeGreaterThan(checkpoint.state.commandSeq);
  await page.locator('#load-game').click();
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  expect(await snapshot(page)).toEqual(checkpoint);
  const resumed = await finish();
  expect(resumed.log).toEqual(direct.log);
  expect(summary(resumed.state)).toEqual(summary(direct.state));
  expect(canonicalSerialize(resumed.state)).toBe(canonicalSerialize(direct.state));
  await testInfo.attach('full-game-save-load', { body: JSON.stringify({ checkpoint: summary(checkpoint.state),
    uninterrupted: summary(direct.state), resumed: summary(resumed.state), fullStateAndLogEqual: true }, null, 2), contentType: 'application/json' });
});
