import { BATTLE_CONTENT } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { previewAttack } from '../../../src/core/preview.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState } from '../../../src/core/model.ts';

// A real v20 game (the AI plays both seats; nothing is patched, so the save replays exactly).
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 20,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] });
export type StrengthFixture = { state: GameState; save: string; seed: number; unitId: number; targetId: number };

/** Stops on player 0's turn when one of its Pokémon has a valid attack on a Pokémon. */
function search(seed: number): StrengthFixture | null {
  let state = createGame(setupFor(seed), BATTLE_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 60) {
    const view = observe(state, state.activePlayerId, BATTLE_CONTENT);
    if (state.activePlayerId === 0) for (const unit of view.units.filter(item => item.ownerId === 0 && item.kind === 'pokemon' && item.actionLeft)) {
      const target = view.units.find(other => other.ownerId !== 0 && other.kind === 'pokemon' && previewAttack(view, unit.id, { kind: 'unit', id: other.id }).ok);
      if (target) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), seed, unitId: unit.id, targetId: target.id };
      }
    }
    let command = planNext(view, { ...RULE_QUERIES, content: BATTLE_CONTENT }, memory);
    let result = step(state, command, BATTLE_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, BATTLE_CONTENT);
    }
    if (!result.ok) throw new Error(`Strength fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
let cached: StrengthFixture | undefined;
export function strengthFixture(): StrengthFixture {
  if (cached) return cached;
  for (let seed = 1; seed <= 40; seed++) { const found = search(seed); if (found) return cached = found; }
  throw new Error('No seed reached an attack for player 0');
}
