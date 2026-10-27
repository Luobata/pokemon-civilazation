import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { planNext } from '../src/ai/plan.ts';
import type { Command, GameState } from '../src/core/model.ts';
import { matchSetup } from './matches.ts';
import type { Match } from './matches.ts';
import { collectTelemetry, createTelemetry } from './telemetry.ts';
import { classifyRejection } from './rejections.ts';

export function simulateMatch(match: Match, roundLimit: 100 | 200 | 300 = 100) {
  const setup = matchSetup(match, roundLimit);
  let state: GameState;
  try { state = createGame(setup); } catch (error) {
    return { ...match, winners: [], kind: null, round: 0, aborted: false, defect: true, legacyAborted: true, invalid: [], exception: String(error), commandCount: 0,
      commandLimitReached: false, setup, starters: [], outcome: null, commands: [],
      telemetry: createTelemetry({ players: Object.fromEntries(setup.players.map(player => [player.id, player])), schemaVersion: 4, rulesVersion: 'm4-v1' }) };
  }
  const telemetry = createTelemetry(state), commands: Command[] = [];
  const invalid: { round: number; seq: number; reason: string; command: Command; category: 'fog' | 'defect' }[] = [];
  const starters = Object.values(state.players).map(player => ({ id: player.id, personality: player.personality, starterId: player.starterId,
    headquarters: { ...state.cities[player.headquartersCityId].position } }));
  let exception: string | null = null;
  try {
    // This diagnostic guard does not alter game rules or silently replace a seed.
    while (!state.outcome && state.commandSeq < 100_000) {
      const command = planNext(observe(state, state.activePlayerId));
      const result = step(state, command);
      if (result.ok) {
        collectTelemetry(telemetry, state, result.state, command, result.events); commands.push(command); state = result.state;
      } else {
        invalid.push({ round: state.round, seq: state.commandSeq, reason: result.reason, command, category: classifyRejection(state, command, result.reason) });
        const view = observe(state, state.activePlayerId);
        const end: Command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
        const ended = step(state, end);
        if (!ended.ok) break;
        collectTelemetry(telemetry, state, ended.state, end, ended.events); commands.push(end); state = ended.state;
      }
    }
  } catch (error) { exception = String(error); }
  return { ...match, winners: state.outcome?.winners ?? [], kind: state.outcome?.kind ?? null, round: state.round,
    aborted: !state.outcome && state.commandSeq >= 100_000,
    defect: exception !== null || (!state.outcome && state.commandSeq < 100_000) || invalid.some(item => item.category === 'defect'),
    legacyAborted: !state.outcome || invalid.length > 0 || exception !== null, invalid, exception, commandCount: state.commandSeq,
    commandLimitReached: !state.outcome && state.commandSeq >= 100_000, setup, starters,
    outcome: state.outcome, telemetry, commands };
}
export type MatchResult = ReturnType<typeof simulateMatch>;
export function simulate(seed: number, roundLimit: 100 | 200 | 300 = 100) {
  const result = simulateMatch({ id: `smoke-${seed}`, seed, mode: 'smoke', leg: 0, personalities: ['expansion', 'aggressive', 'conservative'] }, roundLimit);
  return { seed, winners: result.winners, kind: result.kind, round: result.round, aborted: result.aborted, defect: result.defect, invalid: result.invalid,
    commands: result.commandCount, exception: result.exception };
}
export function parseSeedCount(args: string[]): number {
  if (args.length === 0) return 10;
  if (args.length !== 2 || args[0] !== '--seeds' || !/^\d+$/.test(args[1]) || Number(args[1]) < 1 || Number(args[1]) > 10_000) throw new Error('Usage: npm run sim -- --seeds <1..10000>');
  return Number(args[1]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = parseSeedCount(process.argv.slice(2));
  for (let seed = 1; seed <= count; seed++) {
    try {
      const result = simulate(seed); console.log(JSON.stringify(result));
      if (result.aborted || result.defect) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ seed, winners: [], kind: null, round: null, aborted: true, exception: String(error) })); process.exitCode = 1;
    }
  }
}
