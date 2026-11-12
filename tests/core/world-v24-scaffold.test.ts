import { expect, test } from 'vitest';
import { IMPROVEMENT_CONTENT, WORLD24_CONTENT, contentFor } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';

const flags = ['terrain', 'embark', 'landmarks', 'gymCircuit', 'rivals', 'researchTasks'] as const;
const setup = (gameplayVersion: 23 | 24) => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const, starterId: 'charmander' as const },
  ] });

test('v24 envelope: schema 19, its own content with six flags; v23 has none of them', () => {
  expect(gameVersions({ gameplayVersion: 24 })).toEqual({ schemaVersion: 19, rulesVersion: 'world-v24' });
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 24 })).toBe(WORLD24_CONTENT);
  expect(WORLD24_CONTENT.version).toBe('world-v24');
  expect(flags.map(flag => WORLD24_CONTENT[flag])).toEqual(flags.map(() => true));
  expect(flags.map(flag => IMPROVEMENT_CONTENT[flag])).toEqual(flags.map(() => undefined));
});

test('v24 scaffolding: the v24 map comes from its own generator (A1); v23 maps carry no features', () => {
  const v23 = createGame(setup(23)), v24 = createGame(setup(24));
  expect(v24.map.features).toBeDefined();
  expect(v23.map.features).toBeUndefined();
  expect(observe(v23, 0).map.features).toBeUndefined();
  expect(observe(v24, 0).map.features!.hills.every(tile => observe(v24, 0).knowledge.exploredTileIds.includes(tile))).toBe(true);
  const challenge = { actorId: 0, expectedSeq: 0, action: { type: 'ChallengeGym' as const, gymId: 1, unitIds: [1] } };
  expect(step(v24, challenge)).toEqual({ ok: false, reason: 'invalid-command' });
  expect(step(v23, challenge)).toEqual({ ok: false, reason: 'invalid-command' });
});
