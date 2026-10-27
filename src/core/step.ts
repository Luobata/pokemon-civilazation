import { CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { hexToIndex } from './hex.ts';
import { canEnter, reachablePaths } from './movement.ts';
import { observe, refreshKnowledge } from './vision.ts';
import type { Command, EventPayload, GameState, StepResult } from './model.ts';

export function step(state: GameState, command: Command, content: Content = CONTENT): StepResult {
  if (command.actorId !== state.activePlayerId) return { ok: false, reason: 'not-your-turn' };
  if (command.expectedSeq !== state.commandSeq) return { ok: false, reason: 'stale-command' };
  const action = command.action;
  const events: EventPayload[] = [];
  let path: { q: number; r: number }[] | undefined;
  if (action.type === 'Move') {
    const unit = state.units[action.unitId];
    // Same response for absent units and other owners: no existence oracle.
    if (!unit || unit.ownerId !== command.actorId) return { ok: false, reason: 'unit-unavailable' };
    if (!unit.actionLeft) return { ok: false, reason: 'no-action' };
    const target = hexToIndex(action.to, state.map);
    const planned = target === null ? undefined : reachablePaths(observe(state, command.actorId, content), unit.id, content)[target];
    if (!planned) return { ok: false, reason: 'unreachable' };
    path = [planned[0]];
    for (const position of planned.slice(1)) {
      const index = hexToIndex(position, state.map)!;
      if (!canEnter(unit, state.map.tiles[index], content)
        || Object.values(state.units).some(other => other.id !== unit.id && hexToIndex(other.position, state.map) === index)
        || Object.values(state.cities).some(city => city.ownerId !== unit.ownerId && hexToIndex(city.position, state.map) === index)) break;
      path.push(position);
    }
    if (path.length === 1) return { ok: false, reason: 'unreachable' };
  } else if (action.type !== 'EndTurn') return { ok: false, reason: 'invalid-command' };

  // Validate first, execute on a copy, publish only the complete transaction.
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  if (action.type === 'Move' && path) {
    next.units[action.unitId].position = { ...path[path.length - 1] };
    next.units[action.unitId].actionLeft = 0;
    events.push({ type: 'Moved', unitId: action.unitId, path });
  } else {
    const nextIndex = (state.turnOrder.indexOf(state.activePlayerId) + 1) % state.turnOrder.length;
    next.activePlayerId = state.turnOrder[nextIndex];
    if (nextIndex === 0) {
      events.push({ type: 'RoundEnded', round: state.round });
      next.round++;
      for (const unit of Object.values(next.units)) unit.actionLeft = 1;
    }
    events.push({ type: 'TurnChanged', activePlayerId: next.activePlayerId, round: next.round });
  }
  next.commandSeq++;
  refreshKnowledge(next, content);
  return { ok: true, state: next, events: events.map((payload, index) => ({ seq: next.commandSeq, index, payload })) };
}
