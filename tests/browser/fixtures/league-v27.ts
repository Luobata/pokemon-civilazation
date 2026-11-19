// Gameplay v27 ⑥: saves of real v27 AI games (every seat, seat 0 included, is played by the shipped AI; nothing is patched, so the saves
// replay exactly). The fixture stops at the first seat-0 turn after at least one conference season, with the next season's trainers
// announced, seat 0 unregistered, at peace and with six Pokémon — so the result card, the roster and the lineup picker are all on screen —
// and only when the game (played on by the AI from there) is still running after that next season, so the test can play it.
import { contentFor } from '../../../src/content/units.ts';
import type { Content } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { leagueNemesis } from '../../../src/core/league-roster.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type LeagueFixture = { state: GameState; save: string; nemesis: boolean };

const ready = (view: PlayerView, nemesis: boolean): boolean => {
  const league = view.expansion?.civilization?.championship;
  if (!league || !league.history.length || league.registration || league.nextRound - view.round > 5 || !league.lineup?.length) return false;
  if (nemesis && !leagueNemesis(league.history, view.playerId)) return false;
  const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  return peaceful && view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length >= 6;
};
/** One AI command for the active seat (a rejected command becomes EndTurn, as in the balance tools). */
function advance(state: GameState, content: Content, memory: RejectedCitySite[]): { state: GameState; command: Command } {
  const view = observe(state, state.activePlayerId, content);
  let command = planNext(view, { ...RULE_QUERIES, content }, memory);
  let result = step(state, command, content);
  if (!result.ok) {
    rememberCityRejection(memory, view, command, result.reason);
    command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
    result = step(state, command, content);
  }
  if (!result.ok) throw new Error(`league fixture rejected ${command.action.type}: ${result.reason}`);
  return { state: result.state, command };
}
/** The game is still running two rounds after the next season (played on by the AI from a copy). */
function seasonPlayable(state: GameState, content: Content): boolean {
  const seasons = state.expansion!.civilization.championship.history.length, until = state.expansion!.civilization.championship.nextRound + 2;
  let copy = structuredClone(state);
  const memory: RejectedCitySite[] = [];
  while (!copy.outcome && copy.round <= until) copy = advance(copy, content, memory).state;
  return !copy.outcome && copy.expansion!.civilization.championship.history.length > seasons;
}
function play(options: Options, nemesis: boolean, until = 90): LeagueFixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let checkedSeason = 0;
  while (!state.outcome && state.round < until) {
    const view = observe(state, state.activePlayerId, content), season = state.expansion!.civilization.championship.nextSeason;
    if (state.activePlayerId === 0 && season !== checkedSeason && ready(view, nemesis)) {
      checkedSeason = season;
      if (seasonPlayable(state, content)) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), nemesis: Boolean(leagueNemesis(view.expansion!.civilization.championship.history, 0)) };
      }
    }
    const next = advance(state, content, memory);
    state = next.state; commands.push(next.command);
  }
  return null;
}
/** Games tried in order; the first that reaches the moment is used (seed 4: round 55, before the second season; seat 0 has no nemesis yet,
 *  the test checks the nemesis marks whenever the played season gives it one). */
const GAMES: Options[] = [{ seed: 4, personality: 'expansion' }, { seed: 1, personality: 'expansion' }, { seed: 5, personality: 'conservative' }, { seed: 6, personality: 'expansion' }];
let cached: LeagueFixture | null = null;
export function leagueFixture(): LeagueFixture {
  if (cached) return cached;
  for (const game of GAMES) {
    const found = play(game, false);
    if (found) return cached = found;
  }
  throw new Error('No v27 game reached the league moment');
}
