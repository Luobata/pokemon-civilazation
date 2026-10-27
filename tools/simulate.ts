import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { planNext } from '../src/ai/plan.ts';
import type { AiPersonality, GameSetup } from '../src/core/model.ts';

export function simulate(seed: number, roundLimit: 100 | 200 | 300 = 100) {
  const personalities: AiPersonality[] = ['expansion', 'aggressive', 'conservative'];
  const setup: GameSetup = { seed, width: 24, height: 16, roundLimit,
    players: personalities.map((personality, id) => ({ id, controller: 'ai', personality })) };
  let state = createGame(setup);
  const invalid: { round: number; reason: string; action: string }[] = [];
  // Guards a defective non-terminating planner; never substitutes another seed.
  while (!state.outcome && state.commandSeq < 100_000) {
    const command = planNext(observe(state, state.activePlayerId));
    const result = step(state, command);
    if (result.ok) state = result.state;
    else {
      invalid.push({ round: state.round, reason: result.reason, action: command.action.type });
      const view = observe(state, state.activePlayerId);
      const ended = step(state, { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } });
      if (!ended.ok) break;
      state = ended.state;
    }
  }
  return { seed, winners: state.outcome?.winners ?? [], kind: state.outcome?.kind ?? null, round: state.round,
    aborted: !state.outcome || invalid.length > 0, invalid, commands: state.commandSeq };
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
      if (result.aborted) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ seed, winners: [], kind: null, round: null, aborted: true, exception: String(error) })); process.exitCode = 1;
    }
  }
}
