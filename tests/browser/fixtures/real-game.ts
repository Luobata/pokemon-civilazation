import { CONTENT, EXPANSION_CONTENT } from '../../../src/content/units.ts';
import type { LeaderId } from '../../../src/content/leaders.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { isMapUnit } from '../../../src/core/model.ts';
import type { AiPersonality, Command, GameSetup, GameState } from '../../../src/core/model.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';

export type RealGameOptions = {
  seed: number;
  width: 24 | 30 | 40;
  height: 16 | 20 | 26;
  personalities: AiPersonality[];
  roundLimit?: 100 | 200 | 300;
  leaderIds?: LeaderId[];
  expansionVersion?: 1;
};

export type RealGame = {
  setup: GameSetup;
  commands: Command[];
  finalState: GameState;
  maxState: GameState;
  maxCommands: Command[];
  maxUnits: number;
  invalid: number;
  milestones: Record<string, number>;
};

export function generateRealGame(options: RealGameOptions): RealGame {
  const setup: GameSetup = {
    seed: options.seed, width: options.width, height: options.height, roundLimit: options.roundLimit ?? 100,
    ...(options.expansionVersion ? { expansionVersion: options.expansionVersion } : {}),
    players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', ...(options.leaderIds?.[0] ? { leaderId: options.leaderIds[0] } : {}) },
      ...options.personalities.slice(1).map((personality, index) => ({ id: index + 1, controller: 'ai' as const, personality,
        ...(options.leaderIds?.[index + 1] ? { leaderId: options.leaderIds[index + 1] } : {}) })),
    ],
  };
  const content = setup.expansionVersion ? EXPANSION_CONTENT : CONTENT;
  let state = createGame(setup, content);
  let maxState = state;
  let maxCommands: Command[] = [];
  let maxUnits = 0;
  let invalid = 0;
  const commands: Command[] = [];
  const memory: RejectedCitySite[] = [];
  const milestones: Record<string, number> = {};
  const first = (name: string) => { if (milestones[name] === undefined) milestones[name] = commands.length - 1; };
  while (!state.outcome && state.commandSeq < 100_000) {
    const view = observe(state, state.activePlayerId, content);
    const command = planNext(view, { ...RULE_QUERIES, content }, memory);
    const result = step(state, command, content);
    let accepted = result;
    let acceptedCommand = command;
    if (!result.ok) {
      invalid++;
      rememberCityRejection(memory, view, command, result.reason);
      acceptedCommand = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      accepted = step(state, acceptedCommand, content);
    }
    if (!accepted.ok) throw new Error(`Unable to advance real-game fixture: ${accepted.reason}`);
    state = accepted.state;
    commands.push(acceptedCommand);
    const action = commands.at(-1)!.action;
    if (action.type === 'FoundCity') first('city');
    if (action.type === 'Attack') first('battle');
    if (action.type === 'Capture') first('capture');
    if (action.type === 'DeclareWar') first('war');
    if (action.type === 'MakePeace') first('peace');
    const units = Object.values(state.units).filter(isMapUnit).length;
    if (units > maxUnits) {
      maxUnits = units;
      maxState = state;
      maxCommands = [...commands];
    }
  }
  if (state.outcome) milestones.outcome = commands.length - 1;
  return { setup, commands, finalState: state, maxState, maxCommands, maxUnits, invalid, milestones };
}

export function realGameLog(game: RealGame, commands = game.commands): CommandLog {
  return { version: 1, schemaVersion: 4, rulesVersion: 'm5-v1', contentVersion: game.finalState.contentVersion,
    setup: game.setup, commands: structuredClone(commands) };
}

export function realGameSave(game: RealGame, peak = false): string {
  return peak
    ? serializeSave(game.maxState, realGameLog(game, game.maxCommands))
    : serializeSave(game.finalState, realGameLog(game));
}
