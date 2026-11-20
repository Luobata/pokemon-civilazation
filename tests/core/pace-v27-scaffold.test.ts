import { expect, test } from 'vitest';
import { DEPTH_CONTENT, PACE_CONTENT, STOCK_CONTENTS, contentFor, contentForView, depthContentFor, isStockContent } from '../../src/content/units.ts';
import { PACE27_TUNING, PACE_FLAGS } from '../../src/content/pace-v27.ts';
import { LATEST_GAMEPLAY_VERSION, isGameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { step } from '../../src/core/step.ts';
import type { GameSetup } from '../../src/core/model.ts';
import { parsePatch } from '../../tools/patch.ts';

const setup = (gameplayVersion: 26 | 27): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });
const FLAGS = Object.keys(PACE_FLAGS) as (keyof typeof PACE_FLAGS)[];

test('v27 envelope: schema 22, rules pace-v27, the v26 content plus the seven pace flags; the default stays v26', () => {
  expect(gameVersions({ gameplayVersion: 27 })).toEqual({ schemaVersion: 22, rulesVersion: 'pace-v27' });
  expect(isGameplayVersion(27)).toBe(true);
  expect(LATEST_GAMEPLAY_VERSION).toBe(26);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 27 })).toBe(PACE_CONTENT);
  expect(PACE_CONTENT.version).toBe('pace-v27');
  expect(STOCK_CONTENTS).toContain(PACE_CONTENT);
  expect(FLAGS).toHaveLength(7);
  for (const flag of FLAGS) {
    expect(PACE_CONTENT[flag]).toBe(true);
    expect(DEPTH_CONTENT[flag]).toBeUndefined();
  }
  // Every v26 flag stays on in v27.
  for (const flag of ['teamBattles', 'raids', 'contestSeasons', 'goldSinks', 'stacking', 'openingGift'] as const) expect(PACE_CONTENT[flag]).toBe(true);
  expect(PACE_CONTENT.pace27).toEqual(PACE27_TUNING);
  expect(PACE_CONTENT.pace27).not.toBe(PACE27_TUNING);
  expect(PACE_CONTENT.depth26).toEqual(DEPTH_CONTENT.depth26);
  expect(PACE_CONTENT.depth26).not.toBe(DEPTH_CONTENT.depth26);
  expect(PACE_CONTENT.world24).not.toBe(DEPTH_CONTENT.world24);
  expect(DEPTH_CONTENT.pace27).toBeUndefined();
});

test('a v27 game uses its v26 regional Pokédex with the pace overlay; the view derives the same content object', () => {
  const v26 = depthContentFor(setup(26)), content = contentFor(setup(27));
  expect(content).not.toBe(v26);
  expect(content.regionalDex).toEqual(v26.regionalDex);
  expect(content.roster).toBe(v26.roster);
  expect(contentFor(setup(27))).toBe(content);
  expect(isStockContent(content)).toBe(true);
  const state = createGame(setup(27));
  expect(state.schemaVersion).toBe(22);
  expect(state.rulesVersion).toBe('pace-v27');
  expect(state.contentVersion).toBe('pace-v27');
  expect(contentForView(observe(state, 0, content))).toBe(content);
});

test('scaffolding: RaidDynamax is a known command, refused in v26 and in v27 while no Max raid is open', () => {
  for (const version of [26, 27] as const) {
    const state = createGame(setup(version));
    const unitId = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!.id;
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'RaidDynamax', unitId } } as Parameters<typeof step>[1]);
    expect(result.ok).toBe(false);
  }
});

test('the pace27 knobs patch the v27 content only, one block per lane', () => {
  const v26 = contentFor(setup(26)), v27 = contentFor(setup(27));
  expect(() => parsePatch({ pace27: { opening: { faithWinSharePercent: 65 } } }, v26)).toThrow('patch.pace27: unknown field');
  const tuned = parsePatch({ pace27: { opening: { faithWinSharePercent: 75 }, economy: { projectCost: { festival: 80 } }, events: { circuitGold: { 1: 20 } }, trainers: { stageWeights: { 2: 14 } } } }, v27).content;
  expect(tuned.pace27!.opening.faithWinSharePercent).toBe(75);
  expect(tuned.pace27!.economy.projectCost.festival).toBe(80);
  expect(tuned.pace27!.events.circuitGold).toEqual([30, 20]);
  expect(tuned.pace27!.trainers.stageWeights).toEqual([8, 10, 14]);
  expect(v27.pace27!.opening.faithWinSharePercent).toBe(65);
  expect(() => parsePatch({ pace27: { opening: { aiSiteRadius: 4 } } }, v27)).toThrow('patch.pace27.opening.aiSiteRadius');
});
