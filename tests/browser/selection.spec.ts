import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { GameState } from '../../src/core/model.ts';
import type { Hex } from '../../src/core/hex.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { replay } from '../../src/app/session.ts';
import { SPECIES } from '../../src/content/species.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { pokemonSpritePath } from '../../src/browser/sprites.ts';
import { openScreen, closeScreen } from './ui.ts';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState();
  });
}
async function clickHex(page: Page, position: Hex) {
  await page.locator('#map').scrollIntoViewIfNeeded();
  const point = await page.evaluate(async hex => {
    const main = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera } = await import(main), { hexToWorld, toScreen } = await import(cameraPath);
    const rect = document.querySelector('#map')!.getBoundingClientRect();
    const p = toScreen(hexToWorld(hex), camera);
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, position);
  await page.mouse.click(point.x, point.y);
}

test('unit and city selection expose only the actions of the selected object', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  const initial = await state(page);
  const settler = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  const pokemon = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  const city = initial.cities[initial.players[0].headquartersCityId];
  await page.locator('#unit-select').selectOption(String(settler.id));
  await expect(page.locator('#economy')).toBeHidden();
  await expect(page.locator('#found-city')).toBeDisabled();
  await expect(page.locator('#founding-status')).toContainText('至少需要 4 格');
  await expect(page.locator('#attack-unit')).toHaveCount(0);
  await expect(page.locator('#city-select')).toHaveValue('');
  await openScreen(page, 'research');
  await expect(page.locator('#research-panel')).toBeVisible();
  await closeScreen(page);
  await page.locator('#unit-select').selectOption(String(pokemon.id));
  await expect(page.locator('#attack-unit')).toBeEnabled();
  await expect(page.locator('#capture-unit')).toBeDisabled();
  await expect(page.locator('#evolve-unit')).toBeDisabled();
  await expect(page.locator('#found-city')).toHaveCount(0);
  await expect(page.locator('#unit-panel .unit-portrait img')).toHaveAttribute('src', pokemonSpritePath('bulbasaur'));
  await expect.poll(() => page.locator('#unit-panel .unit-portrait img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(64);
  await page.screenshot({ path: 'test-results/screenshots/context-pokemon.png', fullPage: false });
  // Selecting a city must not accidentally move the selected unit into it.
  await clickHex(page, city.position);
  await expect(page.locator('#unit-panel')).toBeEmpty();
  await expect(page.locator('#city-select')).toHaveValue(String(city.id));
  await expect(page.locator('#unit-select')).toHaveValue('');
  await expect(page.locator('#production-list')).toBeVisible();
  expect(canonicalSerialize(await state(page))).toBe(canonicalSerialize(initial));
  await page.locator('#clear-selection').click();
  await expect(page.locator('#economy')).toBeHidden();
  await expect(page.locator('#selection-empty')).toBeVisible();
  await openScreen(page, 'research');
  await expect(page.locator('#research-panel')).toBeVisible();
});

test('city production trains a new settler with a replayable command history', async ({ page }) => {
  await page.goto('/?seed=12345');
  await page.locator('#animate').uncheck();
  const before = await state(page);
  await page.locator('[data-production-kind="logistics"]').click();
  // v18: the logistics tab offers 开拓队 and 工匠; pick the settler.
  await expect(page.locator('#production-list [data-production-option]')).toHaveText([/^开拓队/, /^工匠/]);
  await page.locator('[data-production-option="logistics:settler"]').click();
  await expect(page.locator('#production-queue')).toContainText('开拓队');
  let trained: GameState['units'][number] | undefined;
  for (let turn = 0; turn < 20 && !trained; turn++) {
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    trained = Object.values((await state(page)).units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'settler' && !before.units[unit.id]);
  }
  expect(trained).toBeDefined();
  await page.locator('#unit-select').selectOption(String(trained!.id));
  await expect(page.locator('#unit-panel')).toContainText('开拓队');
  await expect(page.locator('#found-city')).toBeDisabled();
  const log = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.exportLog(); });
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(await state(page)));
});

test('a completed training ground opens unit production in its own city', async ({ page }) => {
  await page.goto('/?seed=12345&gameplay=21');
  await page.locator('#animate').uncheck();
  const initial = await state(page), cityId = initial.players[0].headquartersCityId;
  const trainingGround = page.locator('[data-production-option="building:trainingGround"]');
  await expect(trainingGround).toContainText('宝可梦中心');
  await expect(trainingGround.locator('.production-option-cost b')).toHaveText('60');
  await expect(trainingGround.locator('img.production-icon')).toHaveAttribute('src', '/buildings/trainingGround.svg');
  await trainingGround.click();
  for (let turn = 0; turn < 35 && !(await state(page)).cities[cityId].buildingIds.includes('trainingGround'); turn++) await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  // P0-1: the building strip lives in the city's 详情 tab.
  await page.locator('[data-city-section="details"]').click();
  await expect(page.locator('[data-building="trainingGround"]')).toBeVisible();
  await expect(page.locator('[data-building="trainingGround"] img')).toHaveAttribute('src', '/buildings/trainingGround.svg');
  await page.locator('[data-building="trainingGround"]').click();
  await expect(page.locator('[data-production-kind="pokemon"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.building-detail-head img')).toHaveAttribute('src', '/buildings/trainingGround.svg');
  await expect(page.locator('#building-detail')).toContainText('经验 +20');
  await expect(page.locator('[data-production-option="pokemon:bulbasaur"] img.production-icon')).toHaveAttribute('src', pokemonSpritePath('bulbasaur'));
  await page.screenshot({ path: 'test-results/screenshots/context-training-ground.png', fullPage: false });
  await page.locator('[data-production-option="pokemon:bulbasaur"]').click();
  const queued = await state(page);
  expect(queued.cities[cityId].queue[0].item).toEqual({ kind: 'pokemon', defId: 'bulbasaur' });
  const log = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.exportLog(); });
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(queued));
});

test('explicit movement can enter a friendly city and its occupant can be selected again', async ({ page }) => {
  await page.goto('/?seed=12345'); await page.locator('#animate').uncheck();
  const initial = await state(page), city = initial.cities[initial.players[0].headquartersCityId];
  const unit = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  // The initial settler occupies the city tile. Move it out through a legal UI command first.
  const departure = await page.evaluate(async () => {
    const main = '/src/browser/main.ts', movement = '/src/core/movement.ts', hexPath = '/src/core/hex.ts';
    const { session } = await import(main), { reachablePaths } = await import(movement), { indexToHex } = await import(hexPath);
    const view = session.getView(), settler = view.units.find((unit: { ownerId: number; kind: string }) => unit.ownerId === 0 && unit.kind === 'logistics');
    const destination = Object.keys(reachablePaths(view, settler.id))[0];
    if (destination === undefined) throw new Error('No legal settler departure');
    return { id: settler.id, position: indexToHex(Number(destination), view.map) };
  });
  await page.locator('#unit-select').selectOption(String(departure.id));
  await clickHex(page, departure.position);
  await page.locator('#unit-select').selectOption(String(unit.id));
  await page.locator('#move-unit').click();
  await clickHex(page, city.position);
  expect((await state(page)).units[unit.id].position).toEqual(city.position);
  await clickHex(page, city.position);
  await expect(page.locator('#city-select')).toHaveValue(String(city.id));
  await clickHex(page, city.position);
  await expect(page.locator('#unit-select')).toHaveValue(String(unit.id));
  await expect(page.locator('#economy')).toBeHidden();
});

test('all current species have locally served generation-three sprites', async ({ request }) => {
  for (const speciesId of Object.keys(SPECIES) as SpeciesId[]) {
    const response = await request.get(pokemonSpritePath(speciesId));
    expect(response.ok(), speciesId).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    expect((await response.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
});

for (const width of [390, 768, 1280]) test(`selected unit controls fit a ${width}px viewport`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/?seed=12345');
  const initial = await state(page);
  const unit = Object.values(initial.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  await page.locator('#unit-select').selectOption(String(unit.id));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const map = (await page.locator('#map').boundingBox())!, panel = (await page.locator('#unit-panel').boundingBox())!;
  if (width <= 980) expect(panel.y).toBeGreaterThanOrEqual(map.y + map.height);
  else expect(panel.x).toBeGreaterThanOrEqual(map.x + map.width);
});
