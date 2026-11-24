import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { deserializeSave, serializeSave } from '../../src/app/save.ts';
import { LATEST_GAMEPLAY_VERSION, isGameplayVersion } from '../../src/content/eras.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { validateRoomCreateRequest } from '../../src/network/contract.ts';
import { parseLeaderBalanceArgs } from '../../tools/leader-balance.ts';

const setup = { seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, multiplayer: true as const, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'human' as const, starterId: 'bulbasaur' as const },
  ] };

test('v27 is the single gameplay baseline across setup, room and CLI', () => {
  expect(LATEST_GAMEPLAY_VERSION).toBe(27);
  expect(isGameplayVersion(27)).toBe(true);
  expect(isGameplayVersion(26)).toBe(false);
  expect(isGameplayVersion(28)).toBe(false);
  expect(validateRoomCreateRequest({ seed: 31 })?.gameplayVersion).toBe(27);
  expect(validateRoomCreateRequest({ seed: 31, gameplayVersion: 27 })?.gameplayVersion).toBe(27);
  expect(validateRoomCreateRequest({ seed: 31, gameplayVersion: 10 })).toBeNull();
  expect(parseLeaderBalanceArgs(['--expansion', 'true', '--eras', 'simple']).config.gameplayVersion).toBe(27);
});

test('v27 save and replay preserve state, envelope and event determinism', () => {
  const session = new GameSession({ ...setup, gameplayVersion: 27 });
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  const log = session.exportLog(), state = session.getState();
  expect(state.schemaVersion).toBe(22);
  expect(state.rulesVersion).toBe('pace-v27');
  expect(state.expansion?.districts).toBeDefined();
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
  expect(canonicalSerialize(deserializeSave(serializeSave(state, log)).state)).toBe(canonicalSerialize(state));
  const first = createGame(log.setup), command = log.commands[0];
  expect(step(first, command)).toEqual(step(createGame(log.setup), command));
  expect(() => replay({ ...log, schemaVersion: 21 as unknown as 22 })).toThrow();
  expect(() => deserializeSave(serializeSave(state, { ...log, rulesVersion: 'depth-v26' as unknown as 'pace-v27' }))).toThrow();
});

test('a real v27 research/build command log replays a completed district and survives save loading', async () => {
  const { districtSites } = await import('../../src/core/districts.ts');
  const { observe } = await import('../../src/core/vision.ts');
  let state = createGame({ ...setup, gameplayVersion: 27 });
  const log = { version: 1 as const, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, setup: state.setup, commands: [] as import('../../src/core/model.ts').Command[] };
  const issue = (action: import('../../src/core/model.ts').Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command);
    if (!result.ok) throw new Error(result.reason);
    log.commands.push(command); state = result.state;
    return result.events;
  };
  issue({ type: 'AssignWork', cityId: 1, workedTileIds: [], lockedTileIds: [] });
  issue({ type: 'SetResearch', techId: 'berryCultivation' });
  while (!state.players[0].research.unlockedIds.includes('berryCultivation') || state.activePlayerId !== 0) issue({ type: 'EndTurn' });
  const site = districtSites(observe(state, 0), 1, 'gardenDistrict').find(site => site.reason === null)!;
  expect(site).toBeDefined();
  issue({ type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: site.tileIndex } }] });
  let completed = false;
  while (!completed && !state.outcome) completed = issue({ type: 'EndTurn' }).some(event => event.payload.type === 'DistrictCompleted');
  expect(completed).toBe(true);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
  expect(canonicalSerialize(deserializeSave(serializeSave(state, log)).state)).toBe(canonicalSerialize(state));
});
