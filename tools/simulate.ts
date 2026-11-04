import { isGameplayVersion } from '../src/content/eras.ts';
import type { GameplayVersion } from '../src/content/eras.ts';
import { CONTENT, EXPANSION_CONTENT } from '../src/content/units.ts';
import { AI_THRESHOLDS } from '../src/ai/thresholds.ts';
import { RULE_QUERIES } from '../src/ai/query.ts';
import type { SimulationOptions } from './patch.ts';
import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { rememberCityRejection } from '../src/ai/memory.ts';
import type { RejectedCitySite } from '../src/ai/memory.ts';
import { planNext } from '../src/ai/plan.ts';
import type { Command, GameState } from '../src/core/model.ts';
import { matchSetup } from './matches.ts';
import type { Match } from './matches.ts';
import { collectTelemetry, createTelemetry } from './telemetry.ts';
import { classifyRejection } from './rejections.ts';

export function simulateMatch(match: Match, roundLimit: 100 | 200 | 300 = 100, options?: SimulationOptions, gameplayVersion?: GameplayVersion) {
  const content = options?.content ?? (gameplayVersion ? EXPANSION_CONTENT : CONTENT), ai = options?.ai ?? AI_THRESHOLDS;
  const query = { ...RULE_QUERIES, content, ai }, memory: RejectedCitySite[] = [];
  const setup = { ...matchSetup(match, roundLimit), ...(gameplayVersion ? { expansionVersion: 1 as const, eraProgression: 'simple-v1' as const, gameplayVersion } : {}) };
  let state: GameState;
  try { state = createGame(setup, content); } catch (error) {
    return { ...match, winners: [], kind: null, round: 0, aborted: false, defect: true, legacyAborted: true, invalid: [], exception: String(error), commandCount: 0,
      commandLimitReached: false, setup, starters: [], outcome: null, commands: [],
      telemetry: createTelemetry({ players: Object.fromEntries(setup.players.map(player => [player.id, player])), schemaVersion: 4, rulesVersion: 'm5-v1' }, content) };
  }
  const telemetry = createTelemetry(state, content), commands: Command[] = [];
  const invalid: { round: number; seq: number; reason: string; command: Command; category: 'fog' | 'defect' }[] = [];
  const starters = Object.values(state.players).map(player => ({ id: player.id, personality: player.personality, starterId: player.starterId,
    headquarters: { ...state.cities[player.headquartersCityId].position } }));
  let exception: string | null = null;
  try {
    // This diagnostic guard does not alter game rules or silently replace a seed.
    while (!state.outcome && state.commandSeq < 100_000) {
      const view = observe(state, state.activePlayerId, content);
      const command = planNext(view, query, memory);
      const result = step(state, command, content);
      if (result.ok) {
        collectTelemetry(telemetry, state, result.state, command, result.events, content); commands.push(command); state = result.state;
      } else {
        invalid.push({ round: state.round, seq: state.commandSeq, reason: result.reason, command, category: classifyRejection(state, command, result.reason, content) });
        rememberCityRejection(memory, view, command, result.reason);
        const end: Command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
        const ended = step(state, end, content);
        if (!ended.ok) break;
        collectTelemetry(telemetry, state, ended.state, end, ended.events, content); commands.push(end); state = ended.state;
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
export function simulate(seed: number, roundLimit: 100 | 200 | 300 = 100, gameplayVersion?: GameplayVersion) {
  const result = simulateMatch({ id: `smoke-${seed}`, seed, mode: 'smoke', leg: 0, personalities: ['expansion', 'aggressive', 'conservative'] }, roundLimit, undefined, gameplayVersion);
  return { seed, winners: result.winners, kind: result.kind, round: result.round, aborted: result.aborted, defect: result.defect, invalid: result.invalid,
    commands: result.commandCount, exception: result.exception };
}
export function parseSeedCount(args: string[]): number {
  if (args.length === 0) return 10;
  if (args.length !== 2 || args[0] !== '--seeds' || !/^\d+$/.test(args[1]) || Number(args[1]) < 1 || Number(args[1]) > 10_000) throw new Error('Usage: npm run sim -- --seeds <1..10000>');
  return Number(args[1]);
}
export function parseSimulationArgs(args: string[]): { seeds: number; gameplayVersion?: GameplayVersion } {
  const remaining: string[] = [];
  let gameplayVersion: GameplayVersion | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--gameplay') { remaining.push(args[index]); continue; }
    const value = Number(args[++index]);
    if (gameplayVersion !== undefined || !isGameplayVersion(value)) throw new Error('Expected --gameplay 1..12');
    gameplayVersion = value;
  }
  return { seeds: parseSeedCount(remaining), ...(gameplayVersion ? { gameplayVersion } : {}) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { seeds: count, gameplayVersion } = parseSimulationArgs(process.argv.slice(2));
  for (let seed = 1; seed <= count; seed++) {
    try {
      const result = simulate(seed, 100, gameplayVersion); console.log(JSON.stringify(result));
      if (result.aborted || result.defect) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ seed, winners: [], kind: null, round: null, aborted: true, exception: String(error) })); process.exitCode = 1;
    }
  }
}
