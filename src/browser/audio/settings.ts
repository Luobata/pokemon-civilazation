// Persisted audio preferences and the small settings block for the game menu.

export interface AudioSettings {
  music: number;
  sfx: number;
  muted: boolean;
}

export const STORAGE_KEY = 'pokeciv-audio';
export const DEFAULT_SETTINGS: Readonly<AudioSettings> = { music: 0.35, sfx: 0.7, muted: false };

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export function normalizeSettings(raw: Partial<AudioSettings> | null | undefined, base: AudioSettings = DEFAULT_SETTINGS): AudioSettings {
  return {
    music: clamp01(raw?.music, base.music),
    sfx: clamp01(raw?.sfx, base.sfx),
    muted: typeof raw?.muted === 'boolean' ? raw.muted : base.muted,
  };
}

export function loadSettings(): AudioSettings {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizeSettings(stored ? JSON.parse(stored) as Partial<AudioSettings> : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode, quota); preferences then last for the session only.
  }
}

export function settingsMarkup(settings: AudioSettings): string {
  const pct = (value: number) => Math.round(value * 100);
  return `<fieldset class="audio-settings" data-audio-settings>
  <legend>声音</legend>
  <label class="audio-mute"><input id="audio-muted" data-audio="muted" type="checkbox"${settings.muted ? ' checked' : ''} />静音</label>
  <label class="audio-range">音乐 <input id="audio-music" data-audio="music" type="range" min="0" max="100" step="5" value="${pct(settings.music)}" /><output data-audio-value="music">${pct(settings.music)}</output></label>
  <label class="audio-range">音效 <input id="audio-sfx" data-audio="sfx" type="range" min="0" max="100" step="5" value="${pct(settings.sfx)}" /><output data-audio-value="sfx">${pct(settings.sfx)}</output></label>
</fieldset>`;
}

export function syncSettingsControls(root: ParentNode, settings: AudioSettings): void {
  for (const key of ['music', 'sfx'] as const) {
    const input = root.querySelector<HTMLInputElement>(`input[data-audio="${key}"]`);
    const value = String(Math.round(settings[key] * 100));
    if (input && input.value !== value) input.value = value;
    const output = root.querySelector<HTMLOutputElement>(`output[data-audio-value="${key}"]`);
    if (output) output.textContent = value;
  }
  const mute = root.querySelector<HTMLInputElement>('input[data-audio="muted"]');
  if (mute) mute.checked = settings.muted;
}
