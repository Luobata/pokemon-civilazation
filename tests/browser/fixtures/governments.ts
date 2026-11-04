import { EXPANSION_CONTENT } from '../../../src/content/units.ts';
import { createGame } from '../../../src/core/game.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup } from '../../../src/core/model.ts';

/** A v11 game where player 1 has just adopted 道馆守则 (first government free), built from real commands. */
export function governmentFixture() {
  const setup: GameSetup = { seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, multiplayer: true,
    eraProgression: 'simple-v1', gameplayVersion: 11, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'squirtle', leaderId: 'lance' }] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const log: CommandLog = { version: 1, ...gameVersions(setup), contentVersion: state.contentVersion, setup, commands: [] };
  const issue = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) throw new Error(`Government fixture rejected ${action.type}: ${result.reason}`);
    state = result.state; log.commands.push(command);
  };
  issue({ type: 'SetCharter', charterId: 'gymCode' });
  for (let guard = 0; guard < 60 && !state.expansion!.policies![0].adopted.includes('gymCode'); guard++) {
    const round = state.round; do issue({ type: 'EndTurn' }); while (state.round === round);
  }
  if (!state.expansion!.policies![0].adopted.includes('gymCode')) throw new Error('gymCode not adopted in fixture');
  return { state, log, save: serializeSave(state, log) };
}
