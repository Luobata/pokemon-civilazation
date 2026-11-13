import { expect, test } from 'vitest';
import { REGIONAL_CONTENT, STOCK_CONTENTS, WORLD24_CONTENT, contentFor } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { gameVersions } from '../../src/core/versions.ts';

const setup = (gameplayVersion: 24 | 25, extra: { dexSeed?: number } = {}) => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, ...extra, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const, starterId: 'charmander' as const },
  ] });

test('v25 envelope: schema 20, rules roster-v25, its own content built on v24', () => {
  expect(gameVersions({ gameplayVersion: 25 })).toEqual({ schemaVersion: 20, rulesVersion: 'roster-v25' });
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 25 })).toBe(REGIONAL_CONTENT);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 24 })).toBe(WORLD24_CONTENT);
  expect(REGIONAL_CONTENT.version).toBe('roster-v25');
  // v25 tunes the later rival visits (fix 4): stronger offsets and longer stays; the rest of the v24 tuning is unchanged.
  expect({ ...REGIONAL_CONTENT.world24, rivalStrengthOffsets: undefined, rivalStayRounds: undefined }).toEqual({ ...WORLD24_CONTENT.world24, rivalStrengthOffsets: undefined });
  expect(REGIONAL_CONTENT.world24!.rivalStrengthOffsets).toEqual([-10, -12, -13]);
  expect(REGIONAL_CONTENT.world24!.rivalStayRounds).toEqual([6, 7, 9]);
  expect(REGIONAL_CONTENT.world24).not.toBe(WORLD24_CONTENT.world24);
  expect(STOCK_CONTENTS).toContain(REGIONAL_CONTENT);
  expect(WORLD24_CONTENT.regionalDex).toBeUndefined();
});

test('v25 games start; dexSeed is a v25-only non-negative integer', () => {
  const state = createGame(setup(25, { dexSeed: 7 }));
  expect(state.rulesVersion).toBe('roster-v25');
  expect(state.contentVersion).toBe('roster-v25');
  expect(() => createGame(setup(24, { dexSeed: 7 }))).toThrow(/dexSeed/);
  expect(() => createGame(setup(25, { dexSeed: -1 }))).toThrow(/dexSeed/);
  expect(() => createGame(setup(25, { dexSeed: 1.5 }))).toThrow(/dexSeed/);
});
