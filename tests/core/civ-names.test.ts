// Second playtest F3: notifications name other civilizations after their leader ("渡的烟墨联盟") instead of "文明 2".
import { expect, test } from 'vitest';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import type { Diplomacy, GameSetup } from '../../src/core/model.ts';
import { toastFor } from '../../src/browser/notifications.ts';
import { civName, civOrYou, LEADER_CIV_NAMES } from '../../src/browser/civ-names.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';

const setup = (leaders: boolean): GameSetup => ({ seed: 32, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', ...(leaders ? { leaderId: 'oak' as const } : {}) },
    { id: 1, controller: 'ai', personality: 'aggressive', ...(leaders ? { leaderId: 'lance' as const } : {}) }] });

test('every leader heads a named civilization', () => {
  for (const id of LEADER_IDS) expect(LEADER_CIV_NAMES[id]).toMatch(/\S/);
  expect(new Set(Object.values(LEADER_CIV_NAMES)).size).toBe(LEADER_IDS.length);
});

test('toasts use the leader and civilization name; seats without a leader keep 文明 N', () => {
  const view = observe(createGame(setup(true)), 0);
  expect(civName(view, 1)).toBe('渡的烟墨联盟');
  expect(civOrYou(view, 0)).toBe('你');
  const relation: Diplomacy = { a: 0, b: 1, status: 'peace', changedAtRound: view.round, declaredBy: null, cooldownUntilRound: 0,
    rejectedAtRound: {}, citiesLostSinceWar: {}, proposal: { proposerId: 1, recipientId: 0 } };
  const peace = toastFor({ type: 'DiplomacyChanged', relation }, view)!;
  expect(peace.title).toBe('渡的烟墨联盟提议停战');
  const war = toastFor({ type: 'DiplomacyChanged', relation: { ...relation, status: 'war', proposal: null, declaredBy: 1 } }, view)!;
  expect(war.title).toBe('渡的烟墨联盟向你宣战！');
  expect(toastFor({ type: 'CivilizationEliminated', eliminatedPlayerId: 1 }, view)!.title).toBe('渡的烟墨联盟出局');
  const legacy = observe(createGame(setup(false)), 0);
  expect(civName(legacy, 1)).toBe('文明 2');
});
