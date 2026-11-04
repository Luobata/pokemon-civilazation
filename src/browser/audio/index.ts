// Procedural game audio: original chiptune music and sound effects synthesised with the
// Web Audio API. Nothing is downloaded. The AudioContext is created lazily by unlock(),
// which the game calls from its first pointer/key gesture.
//
// Graph: voices -> player gain (crossfade) -> music bus -> warmth filter -> duck -> master
//        sfx voices -> sfx bus -> master;  master -> compressor -> destination

import { MENU_SONG } from './music-menu.ts';
import { PEACE_SONG } from './music-peace.ts';
import { WAR_SONG } from './music-war.ts';
import { SongPlayer } from './sequencer.ts';
import {
  loadSettings, normalizeSettings, saveSettings, settingsMarkup, syncSettingsControls, type AudioSettings,
} from './settings.ts';
import { SOUND_EFFECTS, type SoundId } from './sfx.ts';
import { compileSong, type CompiledSong } from './song.ts';
import { WaveBank, type SynthOut } from './synth.ts';

export type { SoundId } from './sfx.ts';
export type { AudioSettings } from './settings.ts';
export type MusicMood = 'peace' | 'war' | 'menu';

export const SOUND_IDS = Object.keys(SOUND_EFFECTS) as SoundId[];
export const MUSIC_MOODS: readonly MusicMood[] = ['peace', 'war', 'menu'];

const SONGS: Record<MusicMood, CompiledSong> = {
  peace: compileSong(PEACE_SONG),
  war: compileSong(WAR_SONG),
  menu: compileSong(MENU_SONG),
};

const TICK_MS = 25;
const LOOKAHEAD = 0.1;
const CROSSFADE = 2;
const SFX_COOLDOWN = 0.06;
/** Bus headroom: slider value 1.0 maps to these gains. */
const MUSIC_LEVEL = 0.8;
const SFX_LEVEL = 1;

export interface AudioDiagnostics {
  state: AudioContextState | 'locked' | 'unsupported';
  mood: MusicMood | null;
  players: number;
  musicNotes: number;
  sfxPlayed: number;
  /** Target gains currently applied (after any short ramp completes). */
  master: number;
  music: number;
  sfx: number;
  /** Raw AudioParam reading; Chrome only refreshes it while the node is rendering audio. */
  liveMaster: number;
}

type ContextConstructor = typeof AudioContext;

function ramp(param: AudioParam, value: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private unsupported = false;
  private master!: GainNode;
  private musicBus!: GainNode;
  private duckNode!: GainNode;
  private sfxBus!: GainNode;
  private musicOut!: SynthOut;
  private sfxOut!: SynthOut;
  private players: SongPlayer[] = [];
  private mood: MusicMood | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastPlayed = new Map<SoundId, number>();
  private readonly listeners = new Set<(settings: AudioSettings) => void>();
  private current: AudioSettings = loadSettings();
  private retiredNotes = 0;
  private sfxPlayed = 0;
  private suspendedByVisibility = false;
  private readonly levels = { master: 0, music: 0, sfx: 0 };

  unlock(): void {
    if (this.unsupported) return;
    if (!this.ctx) {
      const Ctor: ContextConstructor | undefined = globalThis.AudioContext
        ?? (globalThis as unknown as { webkitAudioContext?: ContextConstructor }).webkitAudioContext;
      if (!Ctor) { this.unsupported = true; return; }
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        this.unsupported = true;
        return;
      }
      this.buildGraph(this.ctx);
      document.addEventListener('visibilitychange', this.onVisibility);
      if (this.mood) this.startPlayer(this.mood);
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume().catch(() => undefined);
  }

  play(id: SoundId): void {
    const ctx = this.ctx;
    const effect = SOUND_EFFECTS[id];
    if (!ctx || !effect || this.current.muted || this.current.sfx <= 0 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < SFX_COOLDOWN) return;
    this.lastPlayed.set(id, now);
    effect.play(this.sfxOut, now + 0.01);
    this.sfxPlayed++;
    if (effect.duck) this.duck(effect.duck);
  }

  setMood(mood: MusicMood | null): void {
    if (mood !== null && !SONGS[mood]) return;
    if (mood === this.mood) return;
    this.mood = mood;
    if (!this.ctx) return; // remembered; starts on unlock()
    const now = this.ctx.currentTime;
    for (const player of this.players) {
      if (player.stopAt === null) {
        ramp(player.gain.gain, 0, now, CROSSFADE);
        player.stopAt = now + CROSSFADE + 0.1;
      }
    }
    if (mood) this.startPlayer(mood);
  }

  settings(): AudioSettings {
    return { ...this.current };
  }

  setSettings(next: Partial<AudioSettings>): void {
    this.current = normalizeSettings(next, this.current);
    saveSettings(this.current);
    this.applyLevels(0.05);
    for (const listener of this.listeners) listener(this.settings());
  }

  subscribe(listener: (settings: AudioSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  diagnostics(): AudioDiagnostics {
    const ctx = this.ctx;
    return {
      state: ctx ? ctx.state : this.unsupported ? 'unsupported' : 'locked',
      mood: this.mood,
      players: this.players.length,
      musicNotes: this.retiredNotes + this.players.reduce((sum, player) => sum + player.notes, 0),
      sfxPlayed: this.sfxPlayed,
      ...this.levels,
      liveMaster: ctx ? this.master.gain.value : 0,
    };
  }

  private buildGraph(ctx: AudioContext): void {
    const bank = new WaveBank(ctx);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(compressor);
    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.master);
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 4200;
    warmth.Q.value = 0.5;
    warmth.connect(this.duckNode);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(warmth);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicOut = { ctx, bank, dest: this.musicBus };
    this.sfxOut = { ctx, bank, dest: this.sfxBus };
    this.applyLevels(0);
  }

  private applyLevels(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const { music, sfx, muted } = this.current;
    const set = (param: AudioParam, value: number) => {
      if (seconds > 0) ramp(param, value, now, seconds);
      else { param.cancelScheduledValues(now); param.value = value; }
    };
    this.levels.master = muted ? 0 : 1;
    this.levels.music = music * MUSIC_LEVEL;
    this.levels.sfx = sfx * SFX_LEVEL;
    set(this.master.gain, this.levels.master);
    set(this.musicBus.gain, this.levels.music);
    set(this.sfxBus.gain, this.levels.sfx);
  }

  private startPlayer(mood: MusicMood): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Re-entering a mood that is still fading out: bring it back instead of restarting.
    const fading = this.players.find(player => player.mood === mood && player.stopAt !== null);
    if (fading) {
      fading.stopAt = null;
      ramp(fading.gain.gain, 1, now, CROSSFADE);
    } else {
      const player = new SongPlayer(SONGS[mood], this.musicOut, mood, now + 0.05);
      ramp(player.gain.gain, 1, now, CROSSFADE);
      this.players.push(player);
      while (this.players.length > 3) this.retire(0);
    }
    if (this.timer === null) this.timer = setInterval(this.tick, TICK_MS);
    this.tick();
  }

  private retire(index: number): void {
    const [player] = this.players.splice(index, 1);
    this.retiredNotes += player.notes;
    player.dispose();
  }

  private readonly tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const silent = this.current.muted || this.current.music <= 0;
    for (let i = this.players.length - 1; i >= 0; i--) {
      const player = this.players[i];
      if (player.stopAt !== null && now >= player.stopAt) this.retire(i);
      else player.scheduleUntil(now + LOOKAHEAD, now, silent || ctx.state !== 'running');
    }
    if (this.players.length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  private duck(seconds: number): void {
    const now = this.ctx!.currentTime;
    const gain = this.duckNode.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0.35, now + 0.08);
    gain.setValueAtTime(0.35, now + seconds);
    gain.linearRampToValueAtTime(1, now + seconds + 0.8);
  }

  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden && ctx.state === 'running') {
      this.suspendedByVisibility = true;
      void ctx.suspend().catch(() => undefined);
    } else if (!document.hidden && this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      void ctx.resume().catch(() => undefined);
    }
  };
}

const engine = new AudioEngine();

export const audio = {
  /** Create or resume the AudioContext; call from a user gesture. Safe to call repeatedly. */
  unlock: (): void => engine.unlock(),
  /** Fire-and-forget sound effect, rate-limited per id. No-op before unlock() or while muted. */
  play: (id: SoundId): void => engine.play(id),
  /** Crossfade (~2s) to a music loop; null fades the music out. Remembered until unlock(). */
  setMood: (mood: MusicMood | null): void => engine.setMood(mood),
  settings: (): AudioSettings => engine.settings(),
  /** Merge, clamp, apply and persist (localStorage 'pokeciv-audio'). */
  setSettings: (next: Partial<AudioSettings>): void => engine.setSettings(next),
  /** Listen for settings changes; returns an unsubscribe function. */
  subscribe: (listener: (settings: AudioSettings) => void): (() => void) => engine.subscribe(listener),
  /** Read-only state for tests and the developer drawer. */
  diagnostics: (): AudioDiagnostics => engine.diagnostics(),
};

/** Markup for the menu screen: mute toggle plus 音乐 / 音效 sliders. Pair with bindAudioSettings. */
export function audioSettingsMarkup(): string {
  return settingsMarkup(engine.settings());
}

/** Wires every audio control inside `root`; keeps them in sync with changes made elsewhere. */
export function bindAudioSettings(root: HTMLElement): void {
  syncSettingsControls(root, engine.settings());
  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement | null;
    const key = input?.dataset.audio;
    if (!input || !key) return;
    audio.unlock();
    if (key === 'muted') audio.setSettings({ muted: input.checked });
    else if (key === 'music' || key === 'sfx') audio.setSettings({ [key]: Number(input.value) / 100 });
  });
  // Preview the effect volume once the slider is released.
  root.addEventListener('change', event => {
    const input = event.target as HTMLInputElement | null;
    if (input?.dataset.audio === 'sfx' || (input?.dataset.audio === 'muted' && !input.checked)) audio.play('select');
  });
  const unsubscribe = engine.subscribe(settings => {
    if (!root.isConnected) { unsubscribe(); return; }
    syncSettingsControls(root, settings);
  });
}
