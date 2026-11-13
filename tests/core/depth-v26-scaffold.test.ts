import { expect, test } from 'vitest';
import { DEPTH_CONTENT, REGIONAL_CONTENT, STOCK_CONTENTS, contentFor, contentForView, depthDexDraw, isStockContent, regionalContentFor } from '../../src/content/units.ts';
import { DEPTH26_TUNING, DEPTH_FLAGS } from '../../src/content/depth-v26.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { step } from '../../src/core/step.ts';
import type { GameSetup } from '../../src/core/model.ts';

const setup = (gameplayVersion: 25 | 26): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });
const FLAGS = Object.keys(DEPTH_FLAGS) as (keyof typeof DEPTH_FLAGS)[];

test('v26 envelope: schema 21, rules depth-v26, the v25 regional content plus the depth flags', () => {
  expect(gameVersions({ gameplayVersion: 26 })).toEqual({ schemaVersion: 21, rulesVersion: 'depth-v26' });
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 26 })).toBe(DEPTH_CONTENT);
  expect(DEPTH_CONTENT.version).toBe('depth-v26');
  expect(STOCK_CONTENTS).toContain(DEPTH_CONTENT);
  for (const flag of FLAGS) {
    expect(DEPTH_CONTENT[flag]).toBe(true);
    expect(REGIONAL_CONTENT[flag]).toBeUndefined();
  }
  expect(DEPTH_CONTENT.depth26).toEqual(DEPTH26_TUNING);
  expect(DEPTH_CONTENT.depth26).not.toBe(DEPTH26_TUNING);
  expect(DEPTH_CONTENT.world24).not.toBe(REGIONAL_CONTENT.world24);
  expect(REGIONAL_CONTENT.depth26).toBeUndefined();
});

test('a v26 game uses the v26 regional Pokédex draw (roster-v26); the view derives the same content object', () => {
  const v25 = regionalContentFor(setup(25)), content = contentFor(setup(26));
  expect(content).not.toBe(v25);
  expect(content.regionalDex!.speciesIds).toEqual(depthDexDraw({ ...setup(26), eraProgression: 'simple-v1' }).speciesIds);
  expect(content.roster).not.toBe(v25.roster);
  expect(contentFor(setup(26))).toBe(content);
  expect(isStockContent(content)).toBe(true);
  const state = createGame(setup(26));
  expect(state.rulesVersion).toBe('depth-v26');
  expect(state.contentVersion).toBe('depth-v26');
  expect(contentForView(observe(state, 0, content))).toBe(content);
});

test('scaffolding: the stubbed v26 commands are refused, and v25 refuses them too', () => {
  for (const version of [25, 26] as const) {
    const state = createGame(setup(version));
    for (const action of [{ type: 'RushProduction', cityId: 1 }, { type: 'EnterContest', unitId: 1 }, { type: 'ChallengeRival', unitIds: [1], stake: 'spar' }] as const) {
      const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action } as Parameters<typeof step>[1]);
      expect(result.ok).toBe(false);
    }
  }
});
