import { expect, test } from 'vitest';
import { GAME_CONTENT, STOCK_CONTENTS, contentFor, contentForView, regionalDexDraw, isStockContent } from '../../src/content/units.ts';
import { PACE27_TUNING } from '../../src/content/pace-v27.ts';
import { DEPTH26_TUNING } from '../../src/content/depth-v26.ts';
import { LATEST_GAMEPLAY_VERSION, isGameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { step } from '../../src/core/step.ts';
import type { GameSetup } from '../../src/core/model.ts';
import { parsePatch } from '../../tools/patch.ts';

const setup = (extra: { dexSeed?: number } = {}): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion: 27, ...extra, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });

test('v27 envelope: schema 22, rules pace-v27, single stock baseline GAME_CONTENT', () => {
  expect(gameVersions({ gameplayVersion: 27 })).toEqual({ schemaVersion: 22, rulesVersion: 'pace-v27' });
  expect(isGameplayVersion(27)).toBe(true);
  expect(isGameplayVersion(26)).toBe(false);
  expect(LATEST_GAMEPLAY_VERSION).toBe(27);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 27 })).toBe(GAME_CONTENT);
  expect(GAME_CONTENT.version).toBe('pace-v27');
  expect(STOCK_CONTENTS).toEqual([GAME_CONTENT]);
  expect(GAME_CONTENT.pace27).toEqual(PACE27_TUNING);
  expect(GAME_CONTENT.pace27).not.toBe(PACE27_TUNING);
  expect(GAME_CONTENT.depth26).toEqual(DEPTH26_TUNING);
  expect(GAME_CONTENT.depth26).not.toBe(DEPTH26_TUNING);
});

test('a v27 game uses its regional Pokédex draw and validates dexSeed; the view derives the same content object', () => {
  const content = contentFor(setup());
  expect(content.regionalDex!.speciesIds).toEqual(regionalDexDraw({ ...setup(), eraProgression: 'simple-v1' }).speciesIds);
  expect(contentFor(setup())).toBe(content);
  expect(isStockContent(content)).toBe(true);
  const state = createGame(setup({ dexSeed: 7 }));
  expect(state.schemaVersion).toBe(22);
  expect(state.rulesVersion).toBe('pace-v27');
  expect(state.contentVersion).toBe('pace-v27');
  expect(state.map.features).toBeDefined();
  expect(contentForView(observe(state, 0, contentFor(state.setup)))).toBe(contentFor(state.setup));
  expect(() => createGame(setup({ dexSeed: -1 }))).toThrow(/dexSeed/);
  expect(() => createGame(setup({ dexSeed: 1.5 }))).toThrow(/dexSeed/);
});

test('RaidDynamax and unready late-game commands are refused cleanly', () => {
  const state = createGame(setup());
  const unitId = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!.id;
  for (const action of [
    { type: 'RaidDynamax' as const, unitId },
    { type: 'RushProduction' as const, cityId: 1 },
    { type: 'EnterContest' as const, unitId },
    { type: 'ChallengeRival' as const, unitIds: [unitId], stake: 'spar' as const },
  ]) {
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action });
    expect(result.ok).toBe(false);
  }
});

test('the pace27 knobs patch v27 content cleanly without mutating the baseline', () => {
  const base = contentFor(setup());
  const tuned = parsePatch({ pace27: { opening: { faithWinSharePercent: 75 }, economy: { projectCost: { festival: 80 } }, events: { circuitGold: { 1: 20 } }, trainers: { stageWeights: { 2: 14 } } } }, base).content;
  expect(tuned.pace27!.opening.faithWinSharePercent).toBe(75);
  expect(tuned.pace27!.economy.projectCost.festival).toBe(80);
  expect(tuned.pace27!.events.circuitGold).toEqual([30, 20]);
  expect(tuned.pace27!.trainers.stageWeights).toEqual([8, 10, 14]);
  expect(base.pace27!.opening.faithWinSharePercent).toBe(65);
  expect(() => parsePatch({ pace27: { opening: { aiSiteRadius: 4 } } }, base)).toThrow('patch.pace27.opening.aiSiteRadius');
});
