// Gameplay v26: saves of real v26 AI games (every seat, seat 0 included, is played by the shipped AI; nothing is patched, so the saves
// replay exactly). Each fixture stops at the first seat-0 turn that shows the moment.
import { contentFor } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { leaderTeamFor } from '../../../src/core/gym-circuit.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 26,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type DepthFixture = { state: GameState; save: string; id: number };

function play(options: Options, pick: (view: PlayerView) => number | undefined, until = 100): DepthFixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  // Checked at every seat-0 decision (before its AI acts), so a moment inside a turn (a Pokémon arriving on a gym) is caught.
  while (!state.outcome && state.round < until) {
    const view = observe(state, state.activePlayerId, content);
    if (state.activePlayerId === 0) {
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
    if (!result.ok) throw new Error(`depth fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, DepthFixture> = {};
function first(key: string, games: Options[], pick: (view: PlayerView) => number | undefined, until = 100): DepthFixture {
  if (cache[key]) return cache[key];
  for (const game of games) { const found = play(game, pick, until); if (found) return cache[key] = found; }
  throw new Error(`No game reached the ${key} moment`);
}
const ownReady = (view: PlayerView) => view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1);
const GAMES: Options[] = [{ seed: 2, personality: 'aggressive' }, { seed: 3, personality: 'expansion' }, { seed: 4, personality: 'conservative' }];

/** Seat 0 has a Pokémon with its action on a gym it has not won, off cooldown, with at least two ready Pokémon in reach (id = that unit). */
export const gymFixture = () => first('gym', GAMES, view => {
  const circuit = view.expansion?.gymCircuit;
  if (!circuit) return undefined;
  const won = circuit.badges[view.playerId] ?? [], size = leaderTeamFor(won.length, contentFor({ expansionVersion: 1, gameplayVersion: 26 })).members;
  for (const gym of circuit.gyms) {
    if (won.includes(gym.id) || (circuit.readyAt[gym.id] ?? 0) > view.round) continue;
    const near = ownReady(view).filter(unit => hexDistance(unit.position, gym.position, view.map) <= 2);
    const onSite = near.find(unit => hexDistance(unit.position, gym.position, view.map) === 0);
    if (onSite && near.length >= Math.max(2, size)) return onSite.id;
  }
  return undefined;
});
/** Five or fewer rounds before a conference, at peace, six Pokémon, not registered (id = the season's round). */
const conferencePick = (view: PlayerView) => {
  const league = view.expansion?.civilization?.championship;
  if (!league || league.registration || league.nextRound - view.round > 5 || !league.lineup?.length) return undefined;
  const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  return peaceful && view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length >= 6 ? league.nextRound : undefined;
};
export const conferenceFixture = () => first('conference', CONFERENCE_GAMES, conferencePick, 62);
/** The first game (of seeds 1–2, conservative and expansion) whose seat 0 is ready for an early season (round 60), so the save stays short. */
const CONFERENCE_GAMES: Options[] = [{ seed: 1, personality: 'expansion' }];
