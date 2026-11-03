import { readFileSync } from 'node:fs';
import { replay } from '../../../src/app/session.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { Command } from '../../../src/core/model.ts';
import { stateDigest } from '../../../src/core/snapshot.ts';

export type RecordedFixture = { log: CommandLog; digest: string; round: number; action?: Command['action']; unitId?: number; cityId?: number };
const recordings = JSON.parse(readFileSync(new URL('./reachable.json', import.meta.url), 'utf8')) as Record<string, RecordedFixture>;

/** No snapshots are patched: every fixture state is reconstructed from its full command log. */
export function reachableFixture(name: string) {
  const recording = recordings[name];
  if (!recording) throw new Error(`Missing reachable fixture: ${name}`);
  const log = structuredClone(recording.log), state = replay(log);
  if (stateDigest(state) !== recording.digest) throw new Error(`Fixture changed; regenerate and review ${name}`);
  return { ...recording, log, state, save: serializeSave(state, log) };
}
export const reachableFixtureNames = Object.keys(recordings);

/** Compare full canonical states, not only diagnostic hashes, in both JS runtimes. */
export async function verifyImportedReplay(page: import('@playwright/test').Page, text: string) {
  const { expect } = await import('@playwright/test');
  const { canonicalSerialize } = await import('../../../src/core/snapshot.ts');
  const saved = JSON.parse(text) as import('../../../src/app/save.ts').SaveFile;
  const expected = canonicalSerialize(replay(saved.log));
  expect(canonicalSerialize(saved.state)).toBe(expected);
  const browser = await page.evaluate(async log => {
    const sessionPath = '/src/app/session.ts', snapshotPath = '/src/core/snapshot.ts', mainPath = '/src/browser/main.ts';
    const { replay } = await import(sessionPath), { canonicalSerialize } = await import(snapshotPath);
    const { developerAdapter } = await import(mainPath);
    return { replay: canonicalSerialize(replay(log)), loaded: canonicalSerialize(developerAdapter.getState()) };
  }, saved.log);
  expect(browser.replay).toBe(expected);
  expect(browser.loaded).toBe(expected);
}
