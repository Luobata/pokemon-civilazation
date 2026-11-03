import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { AI_THRESHOLDS } from '../../src/ai/thresholds.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { indexToHex } from '../../src/core/hex.ts';
import { productionCost } from '../../src/core/city.ts';
import { serializeSave } from '../../src/app/save.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import type { Hex } from '../../src/core/hex.ts';
import { openDevDrawer } from './ui.ts';

type MagnemiteFixture = { state: GameState; commands: Command[]; save: string; unitId: number; destination: Hex };

function player0MagnemiteReady(state: GameState): boolean {
  return state.activePlayerId === 0 && !state.outcome && Object.values(state.units).some(unit =>
    unit.ownerId === 0 && unit.location === 'map' && unit.kind === 'pokemon'
    && unit.speciesId === 'magnemite' && unit.actionLeft === 1);
}

function legalMagnemiteFixture(): MagnemiteFixture {
  const setup: GameSetup = {
    seed: 7, width: 24, height: 16, roundLimit: 100, expansionVersion: 1,
    players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'ai', personality: 'conservative', leaderId: 'lance' },
      { id: 2, controller: 'ai', personality: 'conservative', leaderId: 'jenny' },
      { id: 3, controller: 'ai', personality: 'conservative', leaderId: 'joy' },
    ],
  };
  let state = createGame(setup, EXPANSION_CONTENT);
  const commands: Command[] = [];
  const rejectedCities: RejectedCitySite[] = [];

  for (let attempt = 0; attempt < 20_000 && !player0MagnemiteReady(state); attempt++) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT, ai: AI_THRESHOLDS }, rejectedCities);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(rejectedCities, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(`Unable to advance magnemite fixture: ${result.reason}`);
    state = result.state;
    commands.push(command);
  }

  const unit = Object.values(state.units).find(unit =>
    unit.ownerId === 0 && unit.location === 'map' && unit.kind === 'pokemon'
    && unit.speciesId === 'magnemite' && unit.actionLeft === 1);
  if (!unit || state.activePlayerId !== 0) throw new Error('Seed-7 conservative game did not produce a ready player-0 magnemite.');
  const view = observe(state, 0, EXPANSION_CONTENT);
  const destinationIndex = Number(Object.keys(reachablePaths(view, unit.id, EXPANSION_CONTENT))[0]);
  if (!Number.isSafeInteger(destinationIndex)) throw new Error('Magnemite has no legal destination.');
  return {
    state, commands, unitId: unit.id, destination: indexToHex(destinationIndex, state.map),
    save: serializeSave(state, {
      version: 1, schemaVersion: 4, rulesVersion: 'm5-v1', contentVersion: state.contentVersion,
      setup, commands: structuredClone(commands), aiRejectedCitySites: structuredClone(rejectedCities),
    }),
  };
}

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const path = '/src/browser/main.ts';
    return (await import(path)).developerAdapter.getState() as GameState;
  });
}

async function clickHex(page: Page, position: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(mainPath);
    const { hexToWorld, toScreen } = await import(cameraPath);
    const rect = document.querySelector('#map')!.getBoundingClientRect();
    const point = toScreen(hexToWorld(hex), camera);
    return { x: rect.x + point.x, y: rect.y + point.y };
  }, position);
  await page.mouse.click(point.x, point.y);
}

test('expansion-only content works through selection, movement, production and audit UI', async ({ page, context }) => {
  test.setTimeout(120_000);
  const fixture = legalMagnemiteFixture();
  const definition = EXPANSION_CONTENT.units.magnemite;
  const item = { kind: 'pokemon' as const, defId: 'magnemite' as const };
  const cost = productionCost(item, EXPANSION_CONTENT);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await page.locator('#animate').uncheck();
  await page.locator('#import-save').setInputFiles({ name: 'expansion-magnemite.json', mimeType: 'application/json', buffer: Buffer.from(fixture.save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  const imported = await state(page);
  expect(imported.contentVersion).toBe(EXPANSION_CONTENT.version);
  expect(imported.players[0].registeredSpeciesIds).toContain('magnemite');

  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await expect(page.locator('#unit-panel')).toContainText(definition.name);
  await page.locator('#move-unit').click();
  await expect(page.locator('#action-notice')).toContainText('移动模式');
  await clickHex(page, fixture.destination);
  await expect.poll(async () => {
    const current = await state(page);
    return current.units[fixture.unitId]?.location === 'map' ? current.units[fixture.unitId].position : null;
  }).toEqual(fixture.destination);

  await page.locator('#city-select').selectOption(String(imported.players[0].headquartersCityId));
  await page.locator('[data-production-kind="pokemon"]').click();
  await page.locator('#production-item').selectOption({ label: `${definition.name} (${cost})` });
  const preview = page.locator('#production-preview');
  await expect(preview).toContainText(`需要 ${cost} 生产`);
  const previewText = await preview.innerText();
  expect(previewText).not.toMatch(/undefined|NaN/);
  await page.locator('#add-production').click();
  await expect(page.locator('#production-queue').filter({ hasText: definition.name }).last()).toContainText(`0/${cost}`);

  await openDevDrawer(page);
  const popup = context.waitForEvent('page');
  await openDevDrawer(page);
  await page.locator('#open-audit').click();
  const audit = await popup;
  await audit.waitForLoadState();
  await audit.locator('#system-nav a[href="?system=s12-movement"]').click();
  await expect(audit.locator('#system-title')).toHaveText('单位与移动');
  await expect(audit.locator('#system-data')).toContainText(`"unitId": ${fixture.unitId}`);
  await audit.locator('#ai-step').click();
  await expect(audit.locator('#debug-result')).toContainText('已在副本执行');
  const auditText = await audit.locator('#system-data').innerText();
  expect(auditText).not.toMatch(/undefined|NaN/);
  expect(errors).toEqual([]);
});
