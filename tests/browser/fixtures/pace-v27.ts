// Gameplay v27 opening lane (docs/design/pace-v27.md §2, §3): saves of real v27 AI games (every seat, seat 0 included, is played by the
// shipped AI; nothing is patched, so the saves replay exactly). Each fixture stops at a seat-0 decision that shows the moment.
import { contentFor } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import type { Hex } from '../../../src/core/hex.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { isExhausted } from '../../../src/core/wild-encounters.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { AiPersonality, Command, GameEvent, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

type Options = { seed: number; personality: AiPersonality };
const setupFor = ({ seed, personality }: Options): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type PaceFixture = { state: GameState; save: string; unitId: number; targetId: number; target: Hex };
type Moment = (view: PlayerView, state: GameState) => { unitId: number; targetId: number; target: Hex } | undefined;

/** One AI command (an illegal one becomes EndTurn, as in the balance runner). */
function advance(state: GameState, memory: RejectedCitySite[], forced?: Command['action']): { state: GameState; command: Command; events: readonly GameEvent[] } {
  const content = contentFor(state.setup), view = observe(state, state.activePlayerId, content);
  let command: Command = forced ? { actorId: view.playerId, expectedSeq: view.commandSeq, action: forced } : planNext(view, { ...RULE_QUERIES, content }, memory);
  let result = step(state, command, content);
  if (!result.ok) {
    rememberCityRejection(memory, view, command, result.reason);
    command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
    result = step(state, command, content);
  }
  if (!result.ok) throw new Error(`pace fixture rejected ${command.action.type}: ${result.reason}`);
  return { state: result.state, command, events: result.events };
}
function play(options: Options, moment: Moment, until: number, confirm?: (state: GameState, memory: readonly RejectedCitySite[]) => boolean): PaceFixture | null {
  const setup = setupFor(options), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < until) {
    if (state.activePlayerId === 0) {
      const found = moment(observe(state, 0, content), state);
      if (found && (!confirm || confirm(state, memory))) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), ...found };
      }
    }
    const next = advance(state, memory);
    state = next.state; commands.push(next.command);
  }
  return null;
}
const cache: Record<string, PaceFixture> = {};
const GAMES: Options[] = [2, 3, 4, 5, 6, 7, 8, 9].flatMap(seed => (['expansion', 'aggressive', 'conservative'] as const).map(personality => ({ seed, personality })));
function first(key: string, moment: Moment, until: number, confirm?: (state: GameState, memory: readonly RejectedCitySite[]) => boolean): PaceFixture {
  if (cache[key]) return cache[key];
  for (const game of GAMES) { const found = play(game, moment, until, confirm); if (found) return cache[key] = found; }
  throw new Error(`No game reached the ${key} moment`);
}

/** Seat 0 has domestication, a Poké Ball and its first ball unused, and a ready Pokémon next to an exhausted wild one (target = it). */
export const exhaustedFixture = () => first('exhausted', view => {
  const player = view.economy.player;
  if (!player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall < 1 || view.expansion?.wildEncounters?.firstBallUsed !== false) return undefined;
  for (const target of view.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon' && isExhausted(unit, view.round))) {
    const own = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft === 1 && hexDistance(unit.position, target.position, view.map) === 1);
    if (own) return { unitId: own.id, targetId: target.id, target: { ...target.position } };
  }
  return undefined;
}, 60);

/**
 * At the start of a seat-0 turn an own civilian stands next to a striking wild Pokémon, and when seat 0 ends the turn at once (Shift+click)
 * the round's wild phase startles that civilian (checked by playing the AI seats ahead from a copy).
 */
export const startledFixture = () => first('startled', (view, state) => {
  if (state.commandSeq === 0) return undefined;
  const civilian = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && view.units.some(wild => wild.ownerId === null && wild.kind === 'pokemon'
    && !isExhausted(wild, view.round) && hexDistance(wild.position, unit.position, view.map) === 1));
  if (!civilian) return undefined;
  const wild = view.units.find(unit => unit.ownerId === null && unit.kind === 'pokemon' && hexDistance(unit.position, civilian.position, view.map) === 1)!;
  return { unitId: civilian.id, targetId: wild.id, target: { ...civilian.position } };
}, 40, (state, memory) => {
  let copy = state, ended = false;
  const round = state.round;
  const local = [...memory];
  while (!copy.outcome && copy.round === round) {
    const next = advance(copy, local, !ended && copy.activePlayerId === 0 ? { type: 'EndTurn' } : undefined);
    ended ||= copy.activePlayerId === 0;
    if (next.events.some(event => event.payload.type === 'CivilianFled' && event.payload.playerId === 0)) return true;
    copy = next.state;
  }
  return false;
});
