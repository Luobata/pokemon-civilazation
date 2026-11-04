import { EXPANSION_CONTENT } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState } from '../../../src/core/model.ts';

// The v13 rules are pinned explicitly so the fixture keeps working when the default version moves on.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 13,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'lance' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'giovanni' }] });
const logFor = (state: GameState, commands: Command[]): CommandLog =>
  ({ version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands });

export type PromotionFixture = { state: GameState; log: CommandLog; save: string; unitId: number; enemyId: number; seed: number };

/**
 * A real v13 game (the AI plays both sides; no snapshot is patched). It stops on player 0's turn right
 * before the AI would choose a first promotion for a deployed Pokémon that still has its action point,
 * while player 0 is at war with player 1 and sees a promoted unit of player 1.
 */
function search(seed: number): PromotionFixture | null {
  let state = createGame(setupFor(seed), EXPANSION_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 90) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, memory);
    if (state.activePlayerId === 0 && command.action.type === 'PromoteUnit') {
      const unitId = command.action.unitId, unit = view.units.find(item => item.id === unitId);
      const record = state.expansion!.promotions!.units[unitId];
      const war = state.diplomacy.some(relation => [relation.a, relation.b].sort().join() === '0,1' && relation.status === 'war');
      const enemy = view.units.find(item => item.ownerId === 1 && item.kind === 'pokemon' && (view.expansion!.promotions!.units[item.id]?.traits.length ?? 0) > 0);
      if (unit && unit.actionLeft > 0 && record.traits.length === 0 && war && enemy)
        return { state, log: logFor(state, commands), save: serializeSave(state, logFor(state, commands)), unitId, enemyId: enemy.id, seed };
    }
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(`Promotion fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}

let cached: PromotionFixture | undefined;
/** Candidate seeds in order; the first one that reaches the scenario is used. */
export function promotionFixture(): PromotionFixture {
  if (cached) return cached;
  for (const seed of [40, 26, 39]) {
    const found = search(seed);
    if (found) return cached = found;
  }
  throw new Error('No candidate seed reached a pending first promotion next to a promoted enemy at war');
}

/** A fresh v13 game: nobody has fought yet, so no unit has merit. */
export function freshPromotionFixture() {
  const state = createGame(setupFor(1), EXPANSION_CONTENT), log = logFor(state, []);
  return { state, log, save: serializeSave(state, log) };
}
