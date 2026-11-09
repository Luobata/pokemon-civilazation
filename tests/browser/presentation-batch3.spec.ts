import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { endingFixture, foundFixture, formFixture, nightFixture, wonderFixture } from './fixtures/big-events.ts';
import { aiCaptureFixture } from './fixtures/combat-presentation.ts';
import { verifyImportedReplay } from './fixtures/reachable.ts';
import type { Hex } from '../../src/core/hex.ts';

// Presentation batch 3 (docs/design/review-2026-11/3-audio-visual.md V8–V11, A3, A5): real v23 AI games (full era
// progression) and a real v22 city capture, real input (end turn with Shift+click), audio through spies on the audio API.
// Effect screenshots go to the combat screenshot folder of the test output, never into docs/.
const shots = `${process.env.E2E_SCREENSHOT_DIR ?? 'test-results/screenshots'}/combat`;
mkdirSync(shots, { recursive: true });
test.use({ deviceScaleFactor: 2, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

type FrameEffect = { kind: string; color?: string; label?: string; form?: string; progress: number };
type Frame = { effects: FrameEffect[]; poses: { id: number; scale?: number }[]; night?: number; weather?: { key: string; alpha: number }[] };
type Sample = { camera: string; skipDisabled: boolean; frame: Frame; nightRects: number };
type Exposed = { __main: { developerAdapter: { getPresentation(): { frame: Frame } } } };

async function importSave(page: Page, save: string) {
  await page.goto('/?seed=1');
  await page.locator('#import-save').setInputFiles({ name: 'batch3.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#action-notice')).toContainText('读档完成');
  await verifyImportedReplay(page, save);
}
const idle = (page: Page) => expect(page.locator('#skip')).toBeDisabled({ timeout: 30_000 });
async function endTurn(page: Page) {
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#end-turn')).toBeEnabled({ timeout: 60_000 });
  await idle(page);
}
async function screenOf(page: Page, hex: Hex) {
  return page.evaluate(async hex => {
    const mainPath = '/src/browser/main.ts', cameraPath = '/src/browser/camera.ts';
    const { camera, session } = await import(mainPath), { HEX_RADIUS, mapSpan, tileToScreen } = await import(cameraPath);
    const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
    return { ...tileToScreen(hex, camera, session.getView().map, canvas.clientWidth), radius: HEX_RADIUS * camera.zoom, width: canvas.clientWidth, height: canvas.clientHeight,
      span: mapSpan(session.getView().map) * camera.zoom };
  }, hex);
}
/** Real drag that brings `hex` to the middle of the map (after `zoom` presses of "+"), optionally offset by `dx` CSS px. */
async function focusOn(page: Page, hex: Hex, zoom = 0, dx = 0) {
  await page.locator('#map').focus();
  for (let i = 0; i < zoom; i++) await page.keyboard.press('+');
  const p = await screenOf(page, hex), box = (await page.locator('#map').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (box.width / 2 - p.x) + dx, y + (box.height / 2 - p.y), { steps: 12 });
  await page.mouse.up();
}
const cameraNow = (page: Page) => page.evaluate(async () => { const path = '/src/browser/main.ts'; return JSON.stringify((await import(path)).camera); });
/** Records the camera, the skip button, the frame summary and the night-overlay draws on every animation frame. */
async function sampleFrames(page: Page, count: number) {
  await page.evaluate(async count => {
    const path = '/src/browser/main.ts', main = await import(path), frames: unknown[] = [];
    const log = window as unknown as { __frames: unknown[]; __nightRects?: number };
    log.__frames = frames;
    const loop = () => {
      frames.push({ camera: JSON.stringify(main.camera), skipDisabled: document.querySelector<HTMLButtonElement>('#skip')!.disabled,
        frame: main.developerAdapter.getPresentation().frame, nightRects: log.__nightRects ?? 0 });
      if (frames.length < count) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, count);
  return async () => page.evaluate(() => (window as unknown as { __frames: Sample[] }).__frames);
}
/** Counts night-overlay fills on the map per frame (reset by the frame's clearRect). */
async function spyNight(page: Page) {
  await page.addInitScript(() => {
    const log = window as unknown as { __nightRects: number };
    log.__nightRects = 0;
    const proto = CanvasRenderingContext2D.prototype, clear = proto.clearRect, rect = proto.fillRect;
    proto.clearRect = function (this: CanvasRenderingContext2D, ...args: [number, number, number, number]) {
      if (this.canvas.id === 'map') log.__nightRects = 0;
      return clear.apply(this, args);
    };
    proto.fillRect = function (this: CanvasRenderingContext2D, ...args: [number, number, number, number]) {
      // The night overlay colour #0A143066, as the canvas reports it back.
      if (this.canvas.id === 'map' && ['#0a143066', 'rgba(10, 20, 48, 0.4)'].includes(String(this.fillStyle).toLowerCase())) log.__nightRects++;
      return rect.apply(this, args);
    };
  });
}
/** Spies on `audio.play`, `audio.setMood` and `audio.setIntensity` (same module instance the game uses). */
async function spyAudio(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/browser/audio/index.ts', { audio } = await import(path);
    const log = window as unknown as { __audio: { play: string[]; mood: (string | null)[]; intensity: number[] } };
    log.__audio = { play: [], mood: [], intensity: [] };
    const play = audio.play.bind(audio), setMood = audio.setMood.bind(audio), setIntensity = audio.setIntensity.bind(audio);
    audio.play = (id: string) => { log.__audio.play.push(id); play(id); };
    audio.setMood = (mood: string | null) => { log.__audio.mood.push(mood); setMood(mood); };
    audio.setIntensity = (level: number) => { log.__audio.intensity.push(level); setIntensity(level); };
  });
}
const audioLog = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { play: string[]; mood: (string | null)[]; intensity: number[] } }).__audio);
const diagnostics = (page: Page) => page.evaluate(async () => { const path = '/src/browser/audio/index.ts'; return (await import(path)).audio.diagnostics(); });
const presented = (page: Page) => page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).developerAdapter.getPresentation().events as { type: string; animated: boolean }[]; });

/** Crop (map-canvas CSS px) around `hex`; exposes the game module for per-frame polling. */
async function prepareShot(page: Page, hex: Hex) {
  await page.evaluate(async () => { const path = '/src/browser/main.ts'; (window as unknown as { __main: unknown }).__main = await import(path); });
  const p = await screenOf(page, hex);
  return { x: Math.max(0, Math.min(p.width - 520, p.x - 260)), y: Math.max(0, Math.min(p.height - 360, p.y - 220)), width: 520, height: 360 };
}
type Moment = { effect: string; progress: number } | { night: number };
/** Waits for a moment of the animation and copies the map crop in that same frame to `<shots>/<name>.png`. */
async function captureMoment(page: Page, moment: Moment, clip: Awaited<ReturnType<typeof prepareShot>>, name: string) {
  await page.waitForFunction(({ moment, clip }) => {
    const frame = (window as unknown as Exposed).__main.developerAdapter.getPresentation().frame;
    const now = 'effect' in moment ? frame.effects.some(effect => effect.kind === moment.effect && effect.progress >= moment.progress)
      : frame.night !== undefined && frame.night >= moment.night;
    if (!now) return false;
    const map = document.querySelector<HTMLCanvasElement>('#map')!, ratio = map.width / map.clientWidth, crop = document.createElement('canvas');
    crop.width = Math.round(clip.width * ratio); crop.height = Math.round(clip.height * ratio);
    crop.getContext('2d')!.drawImage(map, clip.x * ratio, clip.y * ratio, clip.width * ratio, clip.height * ratio, 0, 0, crop.width, crop.height);
    (window as unknown as { __shot: string }).__shot = crop.toDataURL('image/png');
    return true;
  }, { moment, clip }, { polling: 'raf', timeout: 60_000 });
  const data = await page.evaluate(() => (window as unknown as { __shot: string }).__shot);
  writeFileSync(`${shots}/${name}.png`, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
}

test('V8: founding a city pulses on its tile in the owner colour; the pulse does not hold the event queue', async ({ page }) => {
  const fixture = foundFixture();
  await importSave(page, fixture.save);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await focusOn(page, fixture.position, 6);
  const clip = await prepareShot(page, fixture.position);
  const frames = await sampleFrames(page, 60);
  await page.locator('#found-city').click();
  await captureMoment(page, { effect: 'pulse', progress: .3 }, clip, 'v8-city-founded');
  await idle(page);
  const sampled = await frames();
  const pulsing = sampled.filter(sample => sample.frame.effects.some(effect => effect.kind === 'pulse' && effect.label === '建城'));
  expect(pulsing.length).toBeGreaterThan(0);
  expect(pulsing.flatMap(sample => sample.frame.effects).find(effect => effect.label === '建城')!.color!.toLowerCase()).toBe('#3ba68a');
  // Non-blocking: the panels come back (skip disabled, controls enabled) while the pulse is still playing.
  expect(pulsing.some(sample => sample.skipDisabled)).toBe(true);
  expect((await presented(page)).filter(event => event.type === 'CityFounded').at(-1)!.animated).toBe(true);
  // The camera never moves for a pulse.
  expect(new Set(sampled.map(sample => sample.camera)).size).toBe(1);
});

test('V9: an era form plays its own effect on the unit with the form-change cue; the four forms side by side', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = formFixture();
  await importSave(page, fixture.save);
  await spyAudio(page);
  await page.locator('#unit-select').selectOption(String(fixture.unitId));
  await focusOn(page, fixture.position, 6);
  const clip = await prepareShot(page, fixture.position);
  const frames = await sampleFrames(page, 70);
  await page.locator(`button[data-era-action*='"${fixture.action}"']`).click();
  const form = { MegaEvolve: 'mega', Dynamax: 'dynamax', PrimeZMove: 'zMove', Terastallize: 'tera' }[fixture.action];
  await captureMoment(page, { effect: 'form', progress: .35 }, clip, `v9-form-${form}-live`);
  await idle(page);
  const sampled = await frames();
  const effects = sampled.flatMap(sample => sample.frame.effects).filter(effect => effect.kind === 'form');
  expect(effects.length).toBeGreaterThan(0);
  expect(effects.every(effect => effect.form === form)).toBe(true);
  if (form === 'dynamax') expect(Math.max(...sampled.flatMap(sample => sample.frame.poses).map(pose => pose.scale ?? 1))).toBeGreaterThan(1.3);
  expect((await presented(page)).filter(event => event.type === 'EraAbilityUsed').at(-1)!.animated).toBe(true);
  expect((await audioLog(page)).play).toContain('formChange');
  // The whole form change stays under a second of frames.
  expect(sampled.filter(sample => sample.frame.effects.some(effect => effect.kind === 'form')).length).toBeLessThanOrEqual(Math.ceil(.9 * 60) + 6);

  // Reference shots: the real renderer drawing each form on this unit at 35 % (the review's method), on a second canvas.
  const gallery = await page.evaluate(async ({ unitId, clip }) => {
    const mainPath = '/src/browser/main.ts', renderPath = '/src/browser/render/index.ts', animPath = '/src/browser/render/animation.ts', tracksPath = '/src/browser/event-tracks.ts';
    const { camera, session } = await import(mainPath), { createMapRenderer } = await import(renderPath);
    const { formTrack, FORM_MS } = await import(animPath), { FORM_COLORS } = await import(tracksPath);
    const map = document.querySelector<HTMLCanvasElement>('#map')!, canvas = document.createElement('canvas');
    canvas.style.cssText = `position:fixed;left:0;top:0;width:${map.clientWidth}px;height:${map.clientHeight}px;visibility:hidden`;
    document.body.append(canvas);
    const renderer = createMapRenderer(canvas), view = session.getView(), unit = view.units.find((item: { id: number }) => item.id === unitId);
    const shots: Record<string, string> = {};
    for (const form of ['mega', 'dynamax', 'tera', 'zMove']) {
      const frame = { poses: [], effects: [] };
      formTrack(`gallery:${form}`, unit, form, form === 'tera' ? '#6FA5EE' : FORM_COLORS[form]).sample(FORM_MS * .35, { unitPosition: () => unit.position }, frame);
      renderer.render({ view, camera, animation: frame, selected: null });
      const ratio = canvas.width / canvas.clientWidth, crop = document.createElement('canvas');
      crop.width = Math.round(clip.width * ratio); crop.height = Math.round(clip.height * ratio);
      crop.getContext('2d')!.drawImage(canvas, clip.x * ratio, clip.y * ratio, clip.width * ratio, clip.height * ratio, 0, 0, crop.width, crop.height);
      shots[form] = crop.toDataURL('image/png');
    }
    canvas.remove();
    return shots;
  }, { unitId: fixture.unitId, clip });
  for (const [form, data] of Object.entries(gallery)) writeFileSync(`${shots}/v9-form-${form}.png`, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
});

test('V10: an own wonder off screen — the camera glides to the city, the gold pillar rises with the horn, then the card; closing it restores the view', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = wonderFixture();
  await importSave(page, fixture.save);
  await spyAudio(page);
  // Half a map away from the wonder's city (real drag): the city is off screen.
  const span = (await screenOf(page, fixture.city)).span;
  await focusOn(page, fixture.city, 4, -Math.min(span / 2, 900));
  const city = await screenOf(page, fixture.city);
  expect(city.x < -city.radius || city.x > city.width + city.radius || city.y < -city.radius || city.y > city.height + city.radius, 'the city starts off screen').toBe(true);
  const home = await cameraNow(page);
  await page.evaluate(async () => { const path = '/src/browser/main.ts'; (window as unknown as { __main: unknown }).__main = await import(path); });
  const frames = await sampleFrames(page, 3600);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  // The shot is taken at the city once the camera has arrived (crop centred on the screen middle).
  const box = (await page.locator('#map').boundingBox())!;
  await captureMoment(page, { effect: 'pillar', progress: .3 }, { x: box.width / 2 - 260, y: box.height / 2 - 240, width: 520, height: 360 }, 'v10-wonder-pillar');
  await expect(page.locator('#legend-arrival-root .legend-arrival')).toBeVisible({ timeout: 60_000 });
  const sampled = await frames();
  const firstPillar = sampled.findIndex(sample => sample.frame.effects.some(effect => effect.kind === 'pillar'));
  expect(firstPillar).toBeGreaterThan(0);
  // The camera moved before the pillar and held still while it played.
  const cameras = sampled.map(sample => sample.camera);
  expect(cameras.slice(0, firstPillar).some(camera => camera !== home)).toBe(true);
  const lastPillar = sampled.length - 1 - [...sampled].reverse().findIndex(sample => sample.frame.effects.some(effect => effect.kind === 'pillar'));
  expect(new Set(cameras.slice(firstPillar, lastPillar + 1)).size).toBe(1);
  const there = await screenOf(page, fixture.city);
  expect(Math.abs(there.x - there.width / 2)).toBeLessThan(4);
  expect(Math.abs(there.y - there.height / 2)).toBeLessThan(4);
  // The pan is quick (400 ms) and the pillar under a second.
  expect(sampled.filter(sample => sample.frame.effects.some(effect => effect.kind === 'pillar')).length).toBeLessThanOrEqual(Math.ceil(.8 * 60) + 6);
  // One horn, with the pillar; the card comes after the pillar.
  expect((await audioLog(page)).play.filter(id => id === 'wonder').length).toBe(1);
  // Closing the card puts the player's view back.
  await page.locator('#legend-arrival-close').click();
  await expect.poll(() => cameraNow(page)).toBe(home);

  // Reduced motion: no camera move; the pillar (city off screen) is skipped, the card and the horn remain.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importSave(page, fixture.save);
  await spyAudio(page);
  await focusOn(page, fixture.city, 4, -Math.min(span / 2, 900));
  const still = await cameraNow(page);
  const calmFrames = await sampleFrames(page, 600);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#legend-arrival-root .legend-arrival')).toBeVisible({ timeout: 60_000 });
  expect(new Set((await calmFrames()).map(sample => sample.camera))).toEqual(new Set([still]));
  expect((await audioLog(page)).play).toContain('wonder');
});

test('V11: the first night fades in over about a second, drawn as one overlay per frame; reduced motion switches at once', async ({ page }) => {
  const fixture = nightFixture();
  await spyNight(page);
  await importSave(page, fixture.save);
  await page.locator('#fit').click();
  const clip = await prepareShot(page, { q: 12, r: 8 });
  const frames = await sampleFrames(page, 150);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await captureMoment(page, { night: .45 }, clip, 'v11-night-fade');
  await idle(page);
  await page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length >= 150, undefined, { timeout: 30_000 });
  const sampled = await frames();
  const levels = sampled.map(sample => sample.frame.night).filter((level): level is number => level !== undefined);
  expect(levels.filter(level => level > .05 && level < .95).length).toBeGreaterThan(3);
  expect(levels).toEqual([...levels].sort((a, b) => a - b));
  // One night overlay per frame at most (never one per wrapped map copy).
  expect(Math.max(...sampled.map(sample => sample.nightRects))).toBe(1);
  expect(await page.evaluate(async () => { const path = '/src/browser/main.ts'; return (await import(path)).session.getView().expansion.eraAbilities.night; })).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importSave(page, fixture.save);
  const calm = await sampleFrames(page, 90);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await idle(page);
  expect((await calm()).every(sample => sample.frame.night === undefined)).toBe(true);
});

test('A3: an AI attack on our city raises the war music to its top layer; the layers ramp on the playing song', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = aiCaptureFixture();
  await importSave(page, fixture.save);
  await spyAudio(page);
  await endTurn(page);
  const log = await audioLog(page);
  expect(log.mood.at(-1)).toBe('war');
  // One of our cities was attacked (and taken): intensity 3, held through our turn.
  const live = await diagnostics(page);
  expect(live.state).toBe('running');
  expect(live.mood).toBe('war');
  expect(live.intensity).toBe(3);
  const layers = await page.evaluate(async () => { const path = '/src/browser/audio/index.ts'; return (await import(path)).MUSIC_LAYERS.war[3]; });
  expect(live.layers).toEqual(layers);
  // A quiet turn cycle afterwards steps the music down by one layer, not straight to silence.
  await endTurn(page);
  const after = await audioLog(page);
  const next = after.intensity.slice(log.intensity.length);
  if (next.length) expect(Math.min(...next)).toBeGreaterThanOrEqual(1);
});

test('A5: the map-table theme plays from the first gesture through the opening round and on the menu; the game ends on the defeat or victory theme', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=1');
  await expect(page.locator('#end-turn')).toBeEnabled();
  // Nothing plays before the first gesture.
  const locked = await diagnostics(page);
  expect(locked.state).toBe('locked');
  expect(locked.players).toBe(0);
  await spyAudio(page);
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await diagnostics(page)).mood).toBe('menu');
  expect((await diagnostics(page)).players).toBeGreaterThan(0);
  await page.locator('[data-open-screen="menu"]').click();
  expect((await diagnostics(page)).mood).toBe('menu');
  await page.locator('#screen-menu .screen-close').click();
  await endTurn(page);
  await expect.poll(async () => (await diagnostics(page)).mood).toBe('peace');
  // Opening the menu (new game, leader choice) brings the theme back; closing it returns to the game's music.
  await page.locator('[data-open-screen="menu"]').click();
  await expect.poll(async () => (await diagnostics(page)).mood).toBe('menu');
  await page.locator('#screen-menu .screen-close').click();
  await expect.poll(async () => (await diagnostics(page)).mood).toBe('peace');

  const fixture = endingFixture();
  await importSave(page, fixture.save);
  await spyAudio(page);
  await page.locator('#end-turn').click({ modifiers: ['Shift'] });
  await expect(page.locator('#end-turn')).toContainText('对局已结束', { timeout: 60_000 });
  await idle(page);
  const theme = fixture.won ? 'victory' : 'defeat';
  await expect.poll(async () => (await diagnostics(page)).mood).toBe(theme);
  const log = await audioLog(page);
  expect(log.mood).toContain(theme);
  // The theme starts with the presented end of the game, after the final battle's sounds.
  expect(log.play.lastIndexOf('hit')).toBeLessThan(log.play.indexOf(theme));
  expect(log.play).toContain(theme);
});
