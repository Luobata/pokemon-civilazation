import { createGame } from '../../../src/core/game.ts';
import { serializeSave } from '../../../src/app/save.ts';
import { finishGame } from '../../../src/core/victory.ts';
import { isMapUnit } from '../../../src/core/model.ts';
import { hexToIndex, neighbors } from '../../../src/core/hex.ts';
import { canEnter } from '../../../src/core/movement.ts';
import type { GameOutcome, GameState } from '../../../src/core/model.ts';
import type { CommandLog } from '../../../src/app/session.ts';

function fixtureState(): GameState {
  const state = createGame({ seed: 12345, width: 24, height: 16, roundLimit: 100,
    players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai', personality: 'conservative' }] });
  state.round = 6;
  return state;
}

function save(state: GameState): string {
  const log: CommandLog = { version: 1, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, setup: state.setup, commands: [] };
  return serializeSave(state, log);
}

export function diplomacySave(): string {
  return save(fixtureState());
}

export function incomingPeaceSave(): string {
  const state = fixtureState();
  state.diplomacy[0] = { ...state.diplomacy[0], status: 'war', changedAtRound: 1,
    proposal: { proposerId: 1, recipientId: 0 } };
  return save(state);
}

export function outcomeSave(kind: GameOutcome['kind'] = 'score'): string {
  const state = fixtureState();
  finishGame(state, kind, kind === 'score' ? undefined : kind === 'playerDefeat' ? [] : [0]);
  return save(state);
}

export function neutralSave(): string {
  const state = fixtureState();
  state.cities[1].ownerId = null;
  state.cities[1].hp = 57;
  const occupied = new Set(Object.values(state.units).filter(isMapUnit).map(unit => `${unit.position.q},${unit.position.r}`));
  for (const unit of Object.values(state.units).filter(unit => unit.ownerId === 0 && isMapUnit(unit))) {
    if (!isMapUnit(unit)) continue;
    occupied.delete(`${unit.position.q},${unit.position.r}`);
    const position = neighbors(state.cities[1].position).find(hex => {
      const index = hexToIndex(hex, state.map);
      return index !== null && !occupied.has(`${hex.q},${hex.r}`) && canEnter(unit, state.map.tiles[index]);
    });
    if (!position) throw new Error('Missing neutral camp fixture tile');
    unit.position = position; occupied.add(`${position.q},${position.r}`);
  }
  return save(state);
}

export function visibleAiSave(): string {
  const state = fixtureState();
  const human = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && isMapUnit(unit));
  const ai = Object.values(state.units).find(unit => unit.ownerId === 1 && unit.kind === 'pokemon' && isMapUnit(unit));
  if (!human || !ai || !isMapUnit(human) || !isMapUnit(ai)) throw new Error('Missing visible AI fixture units');
  const occupied = new Set(Object.values(state.units).filter(isMapUnit).map(unit => `${unit.position.q},${unit.position.r}`));
  const position = neighbors(human.position).find(hex => {
    const index = hexToIndex(hex, state.map);
    return index !== null && !occupied.has(`${hex.q},${hex.r}`) && canEnter(ai, state.map.tiles[index]);
  });
  if (!position) throw new Error('Missing visible AI fixture tile');
  ai.position = position;
  return save(state);
}
