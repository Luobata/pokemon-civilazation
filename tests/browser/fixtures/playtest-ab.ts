// Playtest 2026-11 batches A and B: saves of real v24 AI games (every seat, seat 0 included, is played by the shipped AI;
// nothing is patched, so the saves replay exactly). Each fixture stops at the first seat-0 turn that shows the moment.
import { contentFor, contentForView } from '../../../src/content/units.ts';
import { stoneEvolutionsFor } from '../../../src/content/roster.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { evolutionOptions } from '../../../src/core/roster.ts';
import { hexDistance, hexToIndex } from '../../../src/core/hex.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type PlaytestFixture = { state: GameState; save: string; id: number };

function play(options: Options, pick: (view: PlayerView) => number | undefined): PlaytestFixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let round = 0;
  while (!state.outcome && state.round < 100) {
    const view = observe(state, state.activePlayerId, content);
    // Checked once per round, at the start of seat 0's turn (before its AI has moved).
    if (state.activePlayerId === 0 && state.round !== round) {
      round = state.round;
      const id = pick(view);
      if (id !== undefined) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), id };
      }
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`playtest fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, PlaytestFixture> = {};
function first(key: string, games: Options[], pick: (view: PlayerView) => number | undefined): PlaytestFixture {
  if (cache[key]) return cache[key];
  for (const game of games) { const found = play(game, pick); if (found) return cache[key] = found; }
  throw new Error(`No game reached the ${key} moment`);
}
const own = (view: PlayerView) => view.units.filter(unit => unit.ownerId === view.playerId);
const inCity = (view: PlayerView, position: { q: number; r: number }) => view.cities.some(city => hexDistance(city.position, position, view.map) === 0);

/** B2: seat 0 has an idle builder or trader and no settler (id = that unit). */
export const builderFixture = () => first('builder', [{ seed: 1, personality: 'aggressive' }, { seed: 3, personality: 'aggressive' }], view => {
  const civilians = own(view).filter(unit => unit.kind === 'logistics');
  if (civilians.some(unit => unit.kind === 'logistics' && unit.role !== 'builder' && unit.role !== 'trader')) return undefined;
  return civilians.find(unit => unit.actionLeft)?.id;
});
/** B3: seat 0 has a Pokémon outside a city whose only evolution is a stone path (id = its tile). */
export const stoneFixture = () => first('stone', [{ seed: 1, personality: 'aggressive' }, { seed: 3, personality: 'aggressive' }], view => {
  const content = contentForView(view);
  const unit = own(view).find(item => item.kind === 'pokemon' && !inCity(view, item.position)
    && stoneEvolutionsFor(content).some(path => path.fromSpeciesId === item.speciesId)
    && !evolutionOptions(content, item.speciesId).some(option => !stoneEvolutionsFor(content).some(path => path.intoSpeciesId === option.speciesId)));
  return unit ? hexToIndex(unit.position, view.map)! : undefined;
});
/**
 * B1: six rounds before a league season, seat 0 is at peace with everyone, has six Pokémon on the map and has not
 * registered yet (id = the season's round). The test registers with the world page's button.
 */
export const leagueFixture = () => first('league', LEAGUE_GAMES, view => {
  const league = view.expansion?.civilization?.championship;
  if (!league || league.registration || league.nextRound - view.round !== 6) return undefined;
  const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  return peaceful && own(view).filter(unit => unit.kind === 'pokemon').length >= 6 ? league.nextRound : undefined;
});
const LEAGUE_GAMES: Options[] = [{ seed: 2, personality: 'aggressive' }];
