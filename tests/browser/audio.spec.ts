import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Headless Chromium would otherwise keep the AudioContext suspended until a real gesture.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

const MODULE = '/src/browser/audio/index.ts';

async function openBlankApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => { if (`${error.stack ?? ''}${error.message}`.includes('/audio/')) errors.push(error.message); });
  // A bare same-origin page: no Vite HMR client, so edits elsewhere in the repo cannot reload it mid-test.
  await page.route('**/audio-blank.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body></body></html>',
  }));
  await page.goto('/audio-blank.html');
  return errors;
}

test('every sound effect and music mood plays on a running context without errors', async ({ page }) => {
  const errors = await openBlankApp(page);
  await page.evaluate(() => localStorage.removeItem('pokeciv-audio'));
  const result = await page.evaluate(async (path) => {
    const mod = await import(path);
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const { audio, SOUND_IDS, MUSIC_MOODS } = mod;
    const locked = audio.diagnostics().state;
    audio.play('click'); // before unlock: silently ignored
    audio.unlock();
    for (let i = 0; i < 40 && audio.diagnostics().state !== 'running'; i++) await wait(25);
    const state = audio.diagnostics().state;
    for (const id of SOUND_IDS) audio.play(id);
    const afterAll = audio.diagnostics().sfxPlayed;
    audio.play('click');
    audio.play('click'); // within the per-id cooldown
    const afterBurst = audio.diagnostics().sfxPlayed;
    const notes: Record<string, number> = {};
    for (const mood of MUSIC_MOODS) {
      const before = audio.diagnostics().musicNotes;
      audio.setMood(mood);
      await wait(700);
      notes[mood] = audio.diagnostics().musicNotes - before;
    }
    const crossfading = audio.diagnostics().players;
    audio.setMood(null);
    await wait(2400);
    const stopped = audio.diagnostics();
    return { locked, state, ids: SOUND_IDS.length, afterAll, afterBurst, notes, crossfading, stopped, settings: audio.settings() };
  }, MODULE);

  expect(result.locked).toBe('locked');
  expect(result.state).toBe('running');
  expect(result.ids).toBe(38); // depth-v26 §4.2 added the evolution fanfare
  expect(result.afterAll).toBe(38);
  expect(result.afterBurst).toBe(38);
  for (const mood of ['peace', 'war', 'menu']) expect(result.notes[mood]).toBeGreaterThan(0);
  expect(result.crossfading).toBeGreaterThan(1);
  expect(result.stopped.players).toBe(0);
  expect(result.stopped.mood).toBeNull();
  expect(result.settings).toEqual({ music: 0.35, sfx: 0.7, muted: false });
  expect(errors).toEqual([]);
});

test('settings persist across reload, the menu block drives them, and mute zeroes the master gain', async ({ page }) => {
  const errors = await openBlankApp(page);
  await page.evaluate(() => localStorage.removeItem('pokeciv-audio'));
  await page.evaluate(async (path) => {
    const { audio, audioSettingsMarkup, bindAudioSettings } = await import(path);
    audio.setSettings({ music: 0.5, sfx: 0.2 });
    const host = document.createElement('div');
    host.id = 'audio-host';
    host.innerHTML = audioSettingsMarkup();
    document.body.prepend(host);
    bindAudioSettings(host);
  }, MODULE);
  await expect(page.locator('#audio-host')).toContainText('音乐');
  await expect(page.locator('#audio-host')).toContainText('音效');
  await expect(page.locator('#audio-music')).toHaveValue('50');
  await expect(page.locator('#audio-sfx')).toHaveValue('20');
  await page.locator('#audio-muted').check();
  await page.locator('#audio-music').fill('80');

  const live = await page.evaluate(async (path) => {
    const { audio } = await import(path);
    audio.unlock();
    audio.setMood('war');
    audio.play('wonder');
    await new Promise(resolve => setTimeout(resolve, 400));
    const diagnostics = audio.diagnostics();
    audio.setMood(null);
    return { settings: audio.settings(), diagnostics };
  }, MODULE);
  expect(live.settings).toEqual({ music: 0.8, sfx: 0.2, muted: true });
  expect(live.diagnostics.state).toBe('running');
  expect(live.diagnostics.master).toBe(0);
  expect(live.diagnostics.sfxPlayed).toBe(0); // muted effects create no voices
  expect(live.diagnostics.musicNotes).toBe(0); // muted music advances silently without creating voices

  await page.reload();
  const reloaded = await page.evaluate(async (path) => {
    const { audio } = await import(path);
    const stored = JSON.parse(localStorage.getItem('pokeciv-audio') ?? 'null');
    audio.unlock();
    const muted = audio.diagnostics().master;
    audio.setSettings({ muted: false });
    audio.setMood('peace'); // live AudioParam readings only refresh while the graph renders
    await new Promise(resolve => setTimeout(resolve, 500));
    const unmuted = audio.diagnostics();
    audio.setMood(null);
    return { stored, settings: audio.settings(), muted, unmuted };
  }, MODULE);
  expect(reloaded.stored).toEqual({ music: 0.8, sfx: 0.2, muted: true });
  expect(reloaded.muted).toBe(0);
  expect(reloaded.settings).toEqual({ music: 0.8, sfx: 0.2, muted: false });
  expect(reloaded.unmuted.master).toBe(1);
  expect(reloaded.unmuted.liveMaster).toBeCloseTo(1, 3);
  expect(reloaded.unmuted.musicNotes).toBeGreaterThan(0);
  expect(reloaded.unmuted.sfx).toBeCloseTo(0.2, 3);
  expect(errors).toEqual([]);
});
