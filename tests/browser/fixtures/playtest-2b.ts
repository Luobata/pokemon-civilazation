// Second playtest (2026-11b) batches A and B: saves of real v26 AI games (every seat, seat 0 included, is played by the shipped AI;
// nothing is patched, so the saves replay exactly). Each fixture stops at the first seat-0 decision that shows the moment.
import { contentFor, contentForView } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { viewContestEntryBlocker } from '../../../src/core/contest-seasons.ts';
import { leaderTeamFor } from '../../../src/core/gym-circuit.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import { isEmbarked } from '../../../src/core/terrain.ts';
import { previewAttack } from '../../../src/core/preview.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type Playtest2Fixture = { state: GameState; save: string; id: number };

function play(options: Options, pick: (view: PlayerView) => number | undefined, until: number): Playtest2Fixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
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
    if (!result.ok) throw new Error(`playtest-2b fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, Playtest2Fixture> = {};
function first(key: string, games: Options[], pick: (view: PlayerView) => number | undefined, until = 100): Playtest2Fixture {
  if (cache[key]) return cache[key];
  for (const game of games) { const found = play(game, pick, until); if (found) return cache[key] = found; }
  throw new Error(`No game reached the ${key} moment`);
}
const GAMES: Options[] = [{ seed: 2, personality: 'aggressive' }, { seed: 3, personality: 'expansion' }, { seed: 4, personality: 'conservative' }];
const ready = (view: PlayerView) => view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1);
const wild = (view: PlayerView) => view.units.filter(unit => unit.kind === 'pokemon' && unit.ownerId === null && !view.expansion?.rivals?.sightings.some(item => item.unitId === unit.id));

/** U-e / N3 / N4: a 1-Pokémon gym (the leader sends one), an own ready Pokémon on it and another ready one within 2 tiles off the gym (id = the one on it). */
export const oneGymFixture = () => first('one-gym', GAMES, view => {
  const circuit = view.expansion?.gymCircuit;
  if (!circuit) return undefined;
  const won = circuit.badges[view.playerId] ?? [];
  if (leaderTeamFor(won.length, contentForView(view)).members !== 1) return undefined;
  for (const gym of circuit.gyms) {
    if (won.includes(gym.id) || (circuit.readyAt[gym.id] ?? 0) > view.round) continue;
    const near = ready(view).filter(unit => hexDistance(unit.position, gym.position, view.map) <= 2);
    const onSite = near.find(unit => hexDistance(unit.position, gym.position, view.map) === 0);
    if (onSite && near.length >= 2) return onSite.id;
  }
  return undefined;
});
/** N9: an own ready Pokémon with a wild Pokémon in sight beyond its range (2–4 tiles) and none it can attack now (id = that Pokémon). */
export const outOfRangeFixture = () => first('out-of-range', GAMES, view => ready(view).find(unit => {
  const range = contentForView(view).species[(unit as { speciesId: string }).speciesId as never]?.range ?? 1;
  const targets = wild(view).filter(other => previewAttack(view, unit.id, { kind: 'unit', id: other.id }).ok);
  return !targets.length && wild(view).some(other => { const distance = hexDistance(unit.position, other.position, view.map); return distance > range && distance <= 4; });
})?.id, 40);
/** N10: an own ready Pokémon that can attack an adjacent wild Pokémon (id = the attacker). */
export const attackFixture = () => first('attack', GAMES, view => ready(view).find(unit =>
  wild(view).some(other => hexDistance(unit.position, other.position, view.map) === 1 && previewAttack(view, unit.id, { kind: 'unit', id: other.id }).ok))?.id, 40);
/** N8: an own ready Pokémon on water while the player could capture (domestication, a ball in stock) (id = that Pokémon). */
export const embarkedFixture = () => first('embarked', GAMES, view => {
  const player = view.economy.player, content = contentForView(view);
  if (!player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall < 1) return undefined;
  return ready(view).find(unit => isEmbarked(unit, view.map, content))?.id;
});
/** N7: a contest season is open (category announced), seat 0 has not entered and no own Pokémon is eligible right now (id = the season's round). */
export const seasonNoHallFixture = () => first('season-no-hall', [{ seed: 1, personality: 'aggressive' }, ...GAMES], view => {
  const seasons = view.expansion?.contestSeasons, content = contentForView(view);
  if (!seasons?.category || seasons.nextRound === null || seasons.ownEntry || view.round > seasons.nextRound) return undefined;
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  return own.every(unit => viewContestEntryBlocker(view, unit.id, content) !== null) ? seasons.nextRound : undefined;
});
