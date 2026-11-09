import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { aiBattleFixture, aiCaptureFixture, attackFixture } from './fixtures/combat-presentation.ts';
import type { AttackFixture } from './fixtures/combat-presentation.ts';
import { verifyImportedReplay } from './fixtures/reachable.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameState } from '../../src/core/model.ts';

// Combat presentation (docs/design/handoff-combat-presentation.md): real v22 games on the wrapping map, real input.
const shots = 'docs/design/review-2026-11/shots-combat';
mkdirSync(shots, { recursive: true });

type CanvasCall = { op: string; text?: string; x: number; y: number; w?: number; h?: number; lineWidth?: number; strokeStyle?: string; fillStyle?: string };
/** Records text and rect draws on the map canvas; the rect list is reset at the start of every map frame. */
async function spyCanvas(page: Page) {
  await page.addInitScript(() => {
    const log = window as unknown as { __text: CanvasCall[]; __rects: CanvasCall[] };
    log.__text = []; log.__rects = [];
    const proto = CanvasRenderingContext2D.prototype;
    for (const op of ['strokeText', 'fillText'] as const) {
      const original = proto[op];
      proto[op] = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
        if (this.canvas.id === 'map' && /−/.test(text)) log.__text.push({ op, text, x, y, lineWidth: this.lineWidth, strokeStyle: String(this.strokeStyle), fillStyle: String(this.fillStyle) });
        return maxWidth === undefined ? original.call(this, text, x, y) : original.call(this, text, x, y, maxWidth);
      };
    }
    const clear = proto.clearRect, rect = proto.fillRect;
    proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      if (this.canvas.id === 'map') log.__rects = [];
      return clear.call(this, x, y, w, h);
    };
    proto.fillRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      if (this.canvas.id === 'map') log.__rects.push({ op: 'fillRect', x, y, w, h, fillStyle: String(this.fillStyle) });
      return rect.call(this, x, y, w, h);
    };
  });
}
/** Spies on `audio.play` (same module instance the game uses). */
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
async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'combat-presentation.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await verifyImportedReplay(page, save);
}
const state = (page: Page): Promise<GameState> => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getState(); });
/** Screen position (CSS px inside the map canvas) of the visible copy of a tile, and the hex radius. */
async function screenOf(page: Page, hex: Hex) {
  return page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(mainPath), { HEX_RADIUS, tileToScreen } = await import(cameraPath);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    return { ...tileToScreen(hex, camera, session.getView().map, canvas.clientWidth), radius: HEX_RADIUS * camera.zoom, width: canvas.clientWidth, height: canvas.clientHeight };
  }, hex);
}
async function clickHex(page: Page, hex: Hex) {
  const p = await screenOf(page, hex), box = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
/** Real drag that brings `hex` to the middle of the map, after `zoom` presses of "+". */
async function focusOn(page: Page, hex: Hex, zoom = 0) {
  await page.locator('#map').focus();
  for (let i = 0; i < zoom; i++) await page.keyboard.press('+');
  const p = await screenOf(page, hex), box = (await page.locator('#map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (box.width / 2 - p.x), y + (box.height / 2 - p.y), { steps: 10 });
  await page.mouse.up();
}
const idle = (page: Page) => expect(page.locator('#skip')).toBeDisabled();
/** Selects the fixture's attacker (the camera centres on it) and chooses the target: the floating combat card opens. */
async function aim(page: Page, fixture: AttackFixture) {
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await page.locator('#attack-unit').click();
  await clickHex(page, fixture.targetPosition);
  await expect(page.locator('#combat-card')).toBeVisible();
}
/** Aims, then confirms with a second click on the target (real input). */
async function attack(page: Page, fixture: AttackFixture) {
  await aim(page, fixture);
  await clickHex(page, fixture.targetPosition);
}
type FrameSample = { base: string; fog: string; shake: { x: number; y: number }; camera: string };
/** Records the renderer's stats and the camera on every animation frame, `count` frames. */
async function sampleFrames(page: Page, count: number) {
  await page.evaluate(async count => {
    const path = '/src/browser/main.ts';
    const main = await import(path);
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const loop = () => {
      const render = main.developerAdapter.getPresentation().render;
      if (render) frames.push({ ...render, camera: JSON.stringify(main.camera) });
      if (frames.length < count) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, count);
  return async () => page.evaluate(() => (window as unknown as { __frames: FrameSample[] }).__frames);
}
/** Waits two animation frames (the cache is rebuilt on the first still frame). */
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));

test('V1: damage numbers are outlined and pop on the target; the counter-attack number sits on the attacker', async ({ page }) => {
  const fixture = attackFixture('counter');
  await spyCanvas(page);
  await importSave(page, fixture.save);
  await focusOn(page, fixture.targetPosition, 9);
  const before = await state(page);
  await aim(page, fixture);
  // The camera holds still while the battle plays; it moves on to the next unit afterwards.
  const target = await screenOf(page, fixture.targetPosition), attacker = await screenOf(page, fixture.attacker);
  const clip = await clipAround(page, fixture.targetPosition);
  await clickHex(page, fixture.targetPosition);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${shots}/v1-counter-number.png`, clip });
  await idle(page);
  const after = await state(page);
  const unitHp = (game: GameState, id: number) => { const unit = game.units[id]; return unit && 'hp' in unit ? unit.hp : 0; };
  const damage = unitHp(before, fixture.target.id) - unitHp(after, fixture.target.id), counter = unitHp(before, fixture.unitId) - unitHp(after, fixture.unitId);
  expect(damage).toBeGreaterThan(0);
  expect(counter).toBeGreaterThan(0);
  const calls = await page.evaluate(() => (window as unknown as { __text: CanvasCall[] }).__text);
  const strokes = (text: string) => calls.filter(call => call.op === 'strokeText' && call.text === text);
  const hit = strokes(`−${damage}`), back = strokes(`反击 −${counter}`);
  expect(hit.length).toBeGreaterThan(0);
  expect(back.length).toBeGreaterThan(0);
  // Outline: a dark stroke at least 2.5 px wide, under a light fill of the same text.
  for (const call of [...hit, ...back]) { expect(call.lineWidth).toBeGreaterThanOrEqual(2.5); expect(call.strokeStyle!.toLowerCase()).toBe('#10191b'); }
  expect(calls.some(call => call.op === 'fillText' && call.text === `−${damage}`)).toBe(true);
  // The hit is drawn above the target, the counter above the attacker (not on the target tile any more).
  expect(hit.some(call => Math.abs(call.x - target.x) < 1 && call.y < target.y)).toBe(true);
  expect(back.some(call => Math.abs(call.x - attacker.x) < 1 && call.y < attacker.y)).toBe(true);
  expect(back.some(call => Math.abs(call.x - target.x) < 1 && Math.abs(call.y - target.y) < target.radius)).toBe(false);
  // It floats: later draws of the hit sit higher than the first.
  expect(Math.min(...hit.map(call => call.y))).toBeLessThan(hit[0].y - 2);
});

test('V2: damaged visible units carry an HP bar on the map, full-health units none', async ({ page }) => {
  const fixture = attackFixture('counter');
  await spyCanvas(page);
  await importSave(page, fixture.save);
  await attack(page, fixture);
  await idle(page);
  // Back to the fight (the camera moved on to the next unit), so the last frame shows both combatants.
  await focusOn(page, fixture.targetPosition, 7);
  await settle(page);
  const after = await state(page);
  const scene = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', scenePath = '/src/browser/render/scene.ts';
    const { session } = await import(mainPath), { buildScene } = await import(scenePath);
    const view = session.getView();
    return { units: buildScene({ view }).units.map((item: { unit: { id: number }; hp?: { current: number; max: number } }) => ({ id: item.unit.id, hp: item.hp })),
      visible: view.units.map((unit: { id: number }) => unit.id) as number[] } as { units: { id: number; hp?: { current: number; max: number } }[]; visible: number[] };
  });
  // Bars come from the PlayerView only: every scene unit is a visible unit.
  expect(scene.units.map(item => item.id).sort()).toEqual([...scene.visible].sort());
  for (const id of [fixture.unitId, fixture.target.id]) {
    const unit = after.units[id];
    if (!unit || unit.location !== 'map') continue;
    expect(scene.units.find(item => item.id === id)?.hp?.current).toBe(unit.hp);
  }
  // Last frame's rects: a bar is a dark 3 px track with an HP-coloured fill starting at the same corner.
  const rects = await page.evaluate(() => (window as unknown as { __rects: CanvasCall[] }).__rects);
  const tracks = rects.filter(rect => rect.h === 3 && rect.fillStyle === '#3a2a28');
  const barUnder = (p: { x: number; y: number; radius: number }) => tracks.find(track => Math.abs(track.x + track.w! / 2 - p.x) < 2 && track.y > p.y && track.y < p.y + p.radius * 1.3);
  for (const id of [fixture.unitId, fixture.target.id]) {
    const unit = after.units[id];
    if (!unit || unit.location !== 'map') continue;
    const p = await screenOf(page, unit.position), track = barUnder(p);
    expect(track, `HP bar under unit ${id}`).toBeDefined();
    const fill = rects.find(rect => rect.x === track!.x && rect.y === track!.y && ['#72c99e', '#e07a6d'].includes(rect.fillStyle!));
    expect(fill!.w! / track!.w!).toBeCloseTo(unit.hp / scene.units.find(item => item.id === id)!.hp!.max, 1);
  }
  const healthy = scene.units.filter(item => !item.hp).map(item => after.units[item.id]).filter(unit => unit?.location === 'map');
  for (const unit of healthy.slice(0, 6)) {
    const p = await screenOf(page, unit.position!);
    if (p.x < 0 || p.x > p.width || p.y < 0 || p.y > p.height) continue;
    expect(barUnder(p), `no bar under healthy unit ${unit.id}`).toBeUndefined();
  }
  await page.screenshot({ path: `${shots}/v2-hp-bars.png`, clip: await clipAround(page, fixture.targetPosition) });
});

test('V4: a hit shakes the whole frame without moving the camera, and the layer caches keep hitting', async ({ page }) => {
  const fixture = attackFixture('counter');
  await importSave(page, fixture.save);
  await aim(page, fixture);
  await settle(page);
  const frames = await sampleFrames(page, 70);
  await clickHex(page, fixture.targetPosition);
  await idle(page);
  const sampled = await frames();
  const shaking = sampled.filter(frame => frame.shake.x || frame.shake.y);
  expect(shaking.length).toBeGreaterThan(2);
  expect(Math.max(...shaking.map(frame => Math.hypot(frame.shake.x, frame.shake.y)))).toBeLessThanOrEqual(6 * 2 * 1.5); // device px (DPR ≤ 2)
  // The camera never moves during the battle (it moves on to the next unit only afterwards), and both cached layers
  // are reused in every shaking frame.
  const lastShake = sampled.length - 1 - [...sampled].reverse().findIndex(frame => frame.shake.x || frame.shake.y);
  expect(new Set(sampled.slice(0, lastShake + 1).map(frame => frame.camera)).size).toBe(1);
  expect(shaking.every(frame => frame.base === 'hit' && frame.fog !== 'direct' && frame.fog !== 'miss')).toBe(true);
  expect(sampled.at(-1)!.shake).toEqual({ x: 0, y: 0 });

  // prefers-reduced-motion: the battle still plays its numbers, but nothing shakes.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = attackFixture('ranged');
  await importSave(page, still.save);
  await aim(page, still);
  const calmFrames = await sampleFrames(page, 50);
  await clickHex(page, still.targetPosition);
  await idle(page);
  const calm = await calmFrames();
  expect(calm.length).toBeGreaterThan(10);
  expect(calm.every(frame => !frame.shake.x && !frame.shake.y)).toBe(true);
  const events = await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().events as { type: string; animated: boolean }[]; });
  expect(events.filter(event => event.type === 'BattleResolved').at(-1)!.animated).toBe(true);
});

test('V7: AI battles outside the viewport take no playing time; on screen they still animate', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = aiBattleFixture();
  const endTurn = async () => {
    await page.locator('#end-turn').click({ modifiers: ['Shift'] });
    await expect(page.locator('#end-turn')).toBeEnabled({ timeout: 30_000 });
    await idle(page);
    return page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().events as { type: string; animated: boolean }[]; });
  };
  // Off screen: zoom in and pan half a map away from the first battle.
  await importSave(page, fixture.save);
  await focusOn(page, fixture.battles[0][1], 6);
  const box = (await page.locator('#map').boundingBox())!;
  const span = await page.evaluate(async () => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(mainPath), { mapSpan } = await import(cameraPath);
    return mapSpan(session.getView().map) * camera.zoom;
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - span / 2, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  for (const positions of fixture.battles) for (const hex of positions) {
    const p = await screenOf(page, hex);
    expect(p.x < -p.radius || p.x > p.width + p.radius || p.y < -p.radius || p.y > p.height + p.radius, 'battle tiles are off screen').toBe(true);
  }
  const started = Date.now();
  const offscreen = (await endTurn()).filter(event => event.type === 'BattleResolved');
  const elapsed = Date.now() - started;
  expect(offscreen.length).toBe(fixture.battles.length);
  expect(offscreen.every(event => !event.animated)).toBe(true);
  // The battles are still reported (activity log), they just do not block the queue.
  await page.locator('[data-open-screen="log"]').click();
  await expect(page.locator('#screen-log')).toContainText('攻击了');
  await page.locator('#screen-log .screen-close').click();

  // On screen (whole map fitted): the same AI battles animate.
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  const onscreen = (await endTurn()).filter(event => event.type === 'BattleResolved');
  expect(onscreen.length).toBe(fixture.battles.length);
  expect(onscreen.some(event => event.animated)).toBe(true);
  test.info().annotations.push({ type: 'v7', description: `off-screen end turn ${elapsed} ms for ${fixture.battles.length} AI battles` });
});

test('A1: end turn and losing a city play their cues through audio.play; the other new cues and promotions only for the viewer', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = aiCaptureFixture();
  expect(fixture.previousOwner).toBe(0);
  await importSave(page, fixture.save);
  await spyAudio(page);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#end-turn')).toBeEnabled({ timeout: 30_000 });
  await idle(page);
  expect((await state(page)).cities[fixture.cityId].ownerId).toBe(fixture.ownerId);
  const played = await sounds(page);
  expect(played[0]).toBe('endTurn');
  expect(played).toContain('cityLost');
  expect(played).not.toContain('cityCaptured');
  // The mapping for events this fixture does not reach, through the same function the game uses.
  const mapped = await page.evaluate(async () => {
    const path = '/src/browser/main.ts';
    const { session, soundsFor } = await import(path);
    const view = session.getView(), me = view.playerId, other = view.civilizations.find((civ: { id: number }) => civ.id !== me).id;
    const of = (payload: unknown) => soundsFor(payload, view);
    return {
      ownPromotion: of({ type: 'UnitPromoted', playerId: me, unitId: 1, trait: 'assault', rank: 1 }),
      foreignPromotion: of({ type: 'UnitPromoted', playerId: other, unitId: 1, trait: 'assault', rank: 1 }),
      era: of({ type: 'EraAgeBegan', playerId: me, eraIndex: 1, age: 'golden', previousScore: 1, previousRounds: 1 }),
      win: of({ type: 'GameEnded', outcome: { kind: 'score', winners: [me], ranking: [], round: 1 } }),
      lose: of({ type: 'GameEnded', outcome: { kind: 'score', winners: [other], ranking: [], round: 1 } }),
      weather: of({ type: 'WeatherSummoned', playerId: me, public: true, weather: 'rain', center: { q: 0, r: 0 }, untilRound: 3 }),
      form: of({ type: 'EraAbilityUsed', playerId: me, public: true, ability: 'mega', unitId: 1 }),
      route: of({ type: 'TradeRouteEstablished', playerId: me, fromCityId: 1, toCityId: 2 }),
      lost: of({ type: 'LegendWonderLost', playerId: me, legendId: 'x', cityId: 1, refund: 1 }),
      spawn: of({ type: 'WildSpawned', unitId: 1, position: { q: 0, r: 0 } }),
    };
  });
  expect(mapped).toEqual({ ownPromotion: ['promotion'], foreignPromotion: [], era: ['eraChange'], win: ['victory'], lose: ['defeat'],
    weather: ['weather'], form: ['formChange'], route: ['tradeRoute'], lost: ['legendLost'], spawn: ['alarm'] });
});

/** A 520×360 crop of the page around a tile (for screenshots). */
async function clipAround(page: Page, hex: Hex) {
  const p = await screenOf(page, hex), box = (await page.locator('#map').boundingBox())!;
  const x = Math.max(box.x, Math.min(box.x + box.width - 520, box.x + p.x - 260)), y = Math.max(box.y, Math.min(box.y + box.height - 360, box.y + p.y - 200));
  return { x, y, width: 520, height: 360 };
}
