import { createGame } from '../../../src/core/game.ts';
import { step } from '../../../src/core/step.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { GameState, MapUnit } from '../../../src/core/model.ts';

function fixtureState(wildHp: number): GameState {
  const state = createGame({ seed: 12345, width: 24, height: 16,
    players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }, { id: 3, controller: 'ai' }] });
  const attacker = state.units[9] as MapUnit, wild = state.units[13] as MapUnit, recovering = state.units[14] as MapUnit;
  attacker.position = { q: 2, r: 12 };
  attacker.xp = 250;
  wild.position = { q: 3, r: 12 };
  wild.hp = wildHp;
  state.units[14] = { ...recovering, ownerId: 0, location: 'recovering', position: null, cityId: 1, roundsLeft: 3, hp: 1, actionLeft: 0 };
  state.players[0].gold = 500;
  state.players[0].research.unlockedIds = ['domestication', 'ballCraft', 'fieldObservation', 'training'];
  state.players[0].ballInventory = { pokeBall: 5, greatBall: 5 };
  state.diplomacy = state.diplomacy.map(pair => pair.a === 0 && pair.b === 1 ? { ...pair, status: 'war' } : pair);
  return state;
}

function save(state: GameState): string {
  const log: CommandLog = { version: 1, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, setup: state.setup, commands: [] };
  return serializeSave(state, log);
}

export function combatSave(wildHp = 20, ensureCaptureSuccess = false): string {
  const state = fixtureState(wildHp);
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = structuredClone(state);
    const result = step(candidate, { actorId: 0, expectedSeq: 0, action: { type: 'Capture', unitId: 9, targetUnitId: 13, ballId: 'pokeBall' } });
    const captured = result.ok ? result.events.find(event => event.payload.type === 'Captured') : undefined;
    if (captured?.payload.type === 'Captured' && captured.payload.success === ensureCaptureSuccess) return save(state);
    state.rng = result.ok ? result.state.rng : candidate.rng;
  }
  throw new Error('Unable to find capture fixture');
}
