import { contentFor } from '../../../src/content/units.ts';
import { createGame } from '../../../src/core/game.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { TechId } from '../../../src/content/economy.ts';
import type { Command, GameSetup } from '../../../src/core/model.ts';

/**
 * A v22 hot-seat game where player 0 has just researched into the second era and must choose a dedication.
 * Built from real commands only: player 0 always researches the first tech the rules accept (whatever the tech
 * tree is), both players end their turns, until player 0's era changes.
 */
export function dedicationFixture() {
  const setup: GameSetup = { seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, multiplayer: true,
    eraProgression: 'simple-v1', gameplayVersion: 22, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'squirtle', leaderId: 'lance' }] };
  const content = contentFor(setup);
  let state = createGame(setup, content);
  const log: CommandLog = { version: 1, ...gameVersions(setup), contentVersion: state.contentVersion, setup, commands: [] };
  const attempt = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command, content);
    if (result.ok) { state = result.state; log.commands.push(command); }
    return result.ok;
  };
  const issue = (action: Command['action']) => { if (!attempt(action)) throw new Error(`Dedication fixture rejected ${action.type}`); };
  const honor = () => state.expansion!.eraHonors!.players[0];
  for (let guard = 0; guard < 150 && honor().history.length === 0; guard++) {
    if (state.activePlayerId === 0 && state.players[0].research.techId === null) (Object.keys(content.techs) as TechId[]).some(techId => attempt({ type: 'SetResearch', techId }));
    issue({ type: 'EndTurn' });
  }
  while (state.activePlayerId !== 0) issue({ type: 'EndTurn' });
  if (!honor().dedication?.pending) throw new Error('fixture did not reach an era change with a pending dedication');
  return { state, log, save: serializeSave(state, log) };
}
