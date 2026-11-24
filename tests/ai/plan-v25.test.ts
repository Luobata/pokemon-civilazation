import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { captureRoleBonus, classGapCaptureBonus, recruitResearchBonus, roleCaptureBonus } from '../../src/ai/role-plan.ts';
import type { GameSetup } from '../../src/core/model.ts';

const setup = (): GameSetup => ({ seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'ai', personality: 'expansion', leaderId: 'misty' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'brock' }] });

test('capture bonus: +25 for a class with a learned HM but nothing trainable; capped at 50 with the role bonus', () => {
  const state = createGame(setup()), content = contentFor(state.setup), player = state.players[0];
  player.research.unlockedIds.push('aviation');
  const view = observe(state, 0, content), air = 'golbat' as SpeciesId;
  expect(classGapCaptureBonus(view, air, content)).toBe(25);
  expect(classGapCaptureBonus(view, 'machop', content)).toBe(0);
  expect(captureRoleBonus(view, 'geodude', content)).toBe(Math.min(50, roleCaptureBonus(view, 'geodude', content)));
  player.registeredSpeciesIds.push('golbat');
  expect(classGapCaptureBonus(observe(state, 0, content), air, content)).toBe(0);
});

test('research bonus: a regional recruit that fills a class gap is worth +20; an empty slot adds nothing', () => {
  const state = createGame(setup()), content = contentFor(state.setup), view = observe(state, 0, content);
  const slots = content.roster!.recruitSlots!;
  const seafaring = slots.find(item => item.slot === 'seafaring')!;
  expect(seafaring.speciesId).not.toBeNull();
  expect(recruitResearchBonus(view, 'seafaring', content)).toBeGreaterThanOrEqual(20);
  const empty = slots.find(item => item.speciesId === null);
  if (empty) expect(recruitResearchBonus(view, empty.slot as never, content)).toBe(0);
});
