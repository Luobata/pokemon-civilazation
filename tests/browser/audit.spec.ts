import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AUDIT_SYSTEMS } from '../../src/audit/catalog.ts';
import { AuditSandbox } from '../../src/audit/sandbox.ts';
import { replay } from '../../src/app/session.ts';
import type { GameState } from '../../src/core/model.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { openScreen, openDevDrawer } from './ui.ts';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => { const path = '/src/browser/audit.ts'; return (await import(path)).auditAdapter.getState(); });
}
const research = () => AUDIT_SYSTEMS.find(system => system.actionTypes.includes('SetResearch'))!;

test('every system has its own URL, explanation and truthful implementation state', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/audit.html');
  await expect(page.locator('#system-nav a')).toHaveCount(AUDIT_SYSTEMS.length);
  for (const system of AUDIT_SYSTEMS) {
    await page.locator(`#system-nav a[href="?system=${system.id}"]`).click();
    await expect(page.locator('#system-title')).toHaveText(system.name);
    await expect(page).toHaveURL(new RegExp(`system=${system.id}$`));
    await expect(page.locator('#system-rules li')).toHaveCount(system.rules.length);
    await expect(page.locator('#debug-controls')).toBeVisible({ visible: system.status !== 'planned' });
  }
  expect(errors).toEqual([]);
  await page.locator('#system-search').fill('不存在的系统名字');
  await expect(page.locator('#system-nav')).toHaveText('没有匹配的系统');
});

test('opening from the game copies the live session, and sandbox commands never alter the game or stored save', async ({ page, context }) => {
  await page.goto('/'); await page.locator('#animate').uncheck();
  await page.locator('#end-turn').click();
  await openScreen(page, 'menu');
  await page.locator('#save-game').click();
  const gameBefore = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.save(); });
  const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));
  await openDevDrawer(page);
  const popup = context.waitForEvent('page'); await page.locator('#open-audit').click();
  const audit = await popup; await audit.waitForLoadState();
  await expect(audit.locator('#snapshot-source')).toHaveText('游戏当前对局的副本');
  expect(canonicalSerialize(await state(audit))).toBe(canonicalSerialize(JSON.parse(gameBefore).state));
  await audit.locator(`#system-nav a[href="?system=${research().id}"]`).click();
  await audit.locator('#advance-turn').click();
  expect((await state(audit)).commandSeq).toBe(JSON.parse(gameBefore).state.commandSeq + 1);
  expect(await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.save(); })).toBe(gameBefore);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storageBefore);
  await audit.locator('#sandbox-undo').click();
  expect(canonicalSerialize(await state(audit))).toBe(canonicalSerialize(JSON.parse(gameBefore).state));
});

test('condition checks, commands, rejection handling, undo, reset and export use the real engine', async ({ page }) => {
  await page.goto(`/audit.html?system=${research().id}`);
  const before = await state(page);
  await page.locator('#debug-command').selectOption('SetResearch');
  await page.locator('[name="techId"]').selectOption('domestication');
  await page.locator('#preview-command').click();
  await expect(page.locator('#debug-result')).toContainText('条件通过（未执行）');
  expect(await state(page)).toEqual(before);
  await page.locator('#execute-command').click();
  await expect(page.locator('#debug-result')).toContainText('已在副本执行');
  expect((await state(page)).players[0].research.techId).toBe('domestication');
  await page.locator('#debug-controls details summary').click();
  await page.locator('#command-json').fill('{"type":"FoundCity","unitId":-1}');
  await page.locator('#execute-json').click();
  await expect(page.locator('#debug-result')).toContainText('引擎拒绝');
  const accepted = await state(page);
  await page.locator('#command-json').fill('{"type":"Move"}');
  await page.locator('#execute-json').click();
  expect(await state(page)).toEqual(accepted);
  const download = page.waitForEvent('download'); await page.locator('#export-sandbox').click();
  const file = await download; const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const sandbox = new AuditSandbox(await readFile(path!, 'utf8'));
  expect(canonicalSerialize(replay(sandbox.getLog()))).toBe(canonicalSerialize(sandbox.getState()));
  await page.locator('#sandbox-reset').click(); expect(await state(page)).toEqual(before);
});

test('invalid imports preserve the active sandbox and valid imports switch the independent baseline', async ({ page }) => {
  await page.goto('/audit.html'); const before = await state(page);
  await page.locator('#audit-import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('#audit-notice')).toContainText('导入失败'); expect(await state(page)).toEqual(before);
  const source = new AuditSandbox(); source.execute({ type: 'EndTurn' });
  await page.locator('#audit-import').setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(source.save()) });
  await expect(page.locator('#snapshot-source')).toHaveText('导入：good.json');
  expect(await state(page)).toEqual(source.getState());
  await page.locator('#sandbox-reset').click(); expect(await state(page)).toEqual(source.getState());
});

for (const width of [390, 768, 1280]) test(`audit console fits ${width}px and supports direct system navigation`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/audit.html?system=${research().id}`);
  await expect(page.locator('#system-title')).toHaveText(research().name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/audit-${width}.png`, fullPage: true });
});
