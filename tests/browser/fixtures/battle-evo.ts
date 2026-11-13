// depth-v26 presentation batch (battle replays, evolution): saves of real v24 AI games (the shipped AI plays every seat,
// seat 0 included; nothing is patched, so the saves replay exactly). Each fixture stops at the first seat-0 turn start
// that shows the moment.
import { contentFor } from '../../../src/content/units.ts';
import type { Content } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { validateCombatAction } from '../../../src/core/combat.ts';
import { createGame } from '../../../src/core/game.ts';
import { evolutionOptions } from '../../../src/core/roster.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type BattleEvoFixture = { state: GameState; save: string; id: number };

/** One AI command for the active seat (a refused one becomes EndTurn, as the shipped client does). */
function advance(state: GameState, content: Content, memory: RejectedCitySite[]): GameState {
  const view = observe(state, state.activePlayerId, content);
  let command = planNext(view, { ...RULE_QUERIES, content }, memory);
  let result = step(state, command, content);
  if (!result.ok) {
    rememberCityRejection(memory, view, command, result.reason);
    command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
    result = step(state, command, content);
  }
  if (!result.ok) throw new Error(`battle-evo fixture rejected ${command.action.type}: ${result.reason}`);
  return result.state;
}
function play(options: Options, pick: (state: GameState, view: PlayerView, content: Content) => number | undefined): BattleEvoFixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let round = 0;
  while (!state.outcome && state.round < 100) {
    if (state.activePlayerId === 0 && state.round !== round) {
      round = state.round;
      const id = pick(state, observe(state, 0, content), content);
      if (id !== undefined) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), id };
      }
    }
    const before = state.commandSeq;
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok || result.state.commandSeq === before) throw new Error(`battle-evo fixture rejected ${command.action.type}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, BattleEvoFixture> = {};
function first(key: string, games: Options[], pick: (state: GameState, view: PlayerView, content: Content) => number | undefined): BattleEvoFixture {
  if (cache[key]) return cache[key];
  for (const game of games) { const found = play(game, pick); if (found) return cache[key] = found; }
  throw new Error(`No game reached the ${key} moment`);
}
const GAMES: Options[] = [{ seed: 1, personality: 'aggressive' }, { seed: 2, personality: 'aggressive' }, { seed: 3, personality: 'aggressive' }];

/** Seat 0 owns a sanctuary whose guardian stands, with a ready Pokémon on it (id = that Pokémon). */
export const guardianFixture = () => first('guardian', GAMES, (_state, view) => {
  const site = view.expansion?.civilization?.sanctuaries.find(item => item.ownerId === 0 && !item.guardianDefeated);
  return site ? view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft && hexDistance(unit.position, site.position, view.map) === 0)?.id : undefined;
});
/** Seat 0 has a Pokémon the authority lets evolve now (id = that Pokémon). */
export const evolveFixture = () => first('evolve', GAMES, (state, view, content) => view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft
  && evolutionOptions(content, unit.speciesId).some(option => validateCombatAction(state, 0, { type: 'Evolve', unitId: unit.id, intoSpeciesId: option.speciesId }, content) === null))?.id);
/**
 * Seat 0 ends its turn at once (as Shift+click does) and, before its next turn, an AI Pokémon it sees before and after
 * evolves (id = that unit). The probe replays the same deterministic AI the browser runs.
 */
export const foreignEvolutionFixture = () => first('foreign-evolution', GAMES, (state, view, content) => {
  const ended = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'EndTurn' } }, content);
  if (!ended.ok) return undefined;
  let probe = ended.state;
  const memory: RejectedCitySite[] = [];
  for (let guard = 0; !probe.outcome && probe.activePlayerId !== 0 && guard < 400; guard++) probe = advance(probe, content, memory);
  const after = observe(probe, 0, content);
  return after.units.find(unit => unit.kind === 'pokemon' && unit.ownerId !== null && unit.ownerId !== 0
    && view.units.some(old => old.id === unit.id && old.kind === 'pokemon' && old.speciesId !== unit.speciesId))?.id;
});
