import { applyExpansionAction, recordExpansion, resolveExpansionRound, validateExpansionAction } from './expansion.ts';
import { isExpansionAction } from './expansion-commands.ts';
import { applyDiplomacyAction, expirePeaceProposals, validateDiplomacyAction } from './diplomacy.ts';
import { finishGame } from './victory.ts';
import { applyCombatAction, validateCombatAction } from './combat.ts';
import { resolveRecovery } from './recovery.ts';
import { resolveWild } from './wild.ts';
import { isMapUnit } from './model.ts';
import { applyEconomyAction, validateEconomyAction } from './economy-commands.ts';
import { resolveEconomy } from './economy.ts';
import { EXPANSION_CONTENT, CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { hexToIndex } from './hex.ts';
import { canEnter, reachablePaths } from './movement.ts';
import { observe, refreshKnowledge, visibleTiles } from './vision.ts';
import type { Command, EventPayload, GameState, StepResult } from './model.ts';

export function step(state: GameState, command: Command, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): StepResult {
  if (state.outcome) return { ok: false, reason: 'game-ended' };
  if (command.actorId !== state.activePlayerId) return { ok: false, reason: 'not-your-turn' };
  if (command.expectedSeq !== state.commandSeq) return { ok: false, reason: 'stale-command' };
  const action = command.action;
  const events: EventPayload[] = [];
  let path: { q: number; r: number }[] | undefined;
  if (action.type === 'Move') {
    const unit = state.units[action.unitId];
    // Same response for absent units and other owners: no existence oracle.
    if (!unit || unit.ownerId !== command.actorId || !isMapUnit(unit)) return { ok: false, reason: 'unit-unavailable' };
    if (!unit.actionLeft) return { ok: false, reason: 'no-action' };
    const target = hexToIndex(action.to, state.map);
    const planned = target === null ? undefined : reachablePaths(observe(state, command.actorId, content), unit.id, content)[target];
    if (!planned) return { ok: false, reason: 'unreachable' };
    path = [planned[0]];
    for (const position of planned.slice(1)) {
      const index = hexToIndex(position, state.map)!;
      if (!canEnter(unit, state.map.tiles[index], content)
        || Object.values(state.units).filter(isMapUnit).some(other => other.id !== unit.id && hexToIndex(other.position, state.map) === index)
        || Object.values(state.cities).some(city => city.ownerId !== unit.ownerId && hexToIndex(city.position, state.map) === index)) break;
      path.push(position);
    }
    if (path.length === 1) return { ok: false, reason: 'unreachable' };
  } else if (action.type === 'Attack' || action.type === 'Capture' || action.type === 'Evolve') {
    const reason = validateCombatAction(state, command.actorId, action, content);
    if (reason) return { ok: false, reason };
  } else if (action.type === 'DeclareWar' || action.type === 'MakePeace' || action.type === 'RespondPeace') {
    if (action.type === 'DeclareWar' && state.expansion) {
      const key = [command.actorId, action.targetPlayerId].sort((a, b) => a - b).join(':');
      if (state.expansion.civilization.relations[key]?.allianceSinceRound !== null && state.expansion.civilization.relations[key]?.allianceSinceRound !== undefined) return { ok: false, reason: 'diplomacy-unavailable' };
    }
    const reason = validateDiplomacyAction(state, command.actorId, action);
    if (reason) return { ok: false, reason };
  } else if (isExpansionAction(action)) {
    if (!validateExpansionAction(state, command.actorId, action, content)) return { ok: false, reason: 'invalid-command' };
  } else if (action.type !== 'EndTurn') {
    if (!['FoundCity', 'SetProductionQueue', 'AssignWork', 'SetResearch', 'BuyBall'].includes(action.type)) return { ok: false, reason: 'invalid-command' };
    const reason = validateEconomyAction(state, command.actorId, action, content);
    if (reason) return { ok: false, reason };
  }

  // Validate first, execute on a copy, publish only the complete transaction.
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  let knowledgeRefreshed = false;
  if (action.type === 'Move' && path) {
    const moving = next.units[action.unitId];
    if (!isMapUnit(moving)) throw new Error('Expected deployed unit');
    moving.position = { ...path[path.length - 1] };
    next.units[action.unitId].actionLeft = 0;
    events.push({ type: 'Moved', unitId: action.unitId, path });
  } else if (action.type === 'EndTurn') {
    events.push(...expirePeaceProposals(next, command.actorId));
    const nextIndex = (state.turnOrder.indexOf(state.activePlayerId) + 1) % state.turnOrder.length;
    next.activePlayerId = state.turnOrder[nextIndex];
    if (nextIndex === 0) {
      events.push(...resolveEconomy(next, content));
      events.push(...resolveRecovery(next, content));
      events.push(...resolveWild(next, content));
      events.push(...resolveExpansionRound(next, content));
      events.push({ type: 'RoundEnded', round: state.round });
      refreshKnowledge(next, content); // Stage 7 precedes the round-limit score.
      knowledgeRefreshed = true;
      events.push(...recordExpansion(state, next, command, events, content));
      if (!next.outcome && next.round >= (next.setup.roundLimit ?? 100)) events.push(...finishGame(next, 'score', undefined, content));
      else if (!next.outcome) next.round++;
      for (const unit of Object.values(next.units)) unit.actionLeft = !next.outcome && isMapUnit(unit) ? 1 : 0;
    }
    if (!next.outcome) events.push({ type: 'TurnChanged', activePlayerId: next.activePlayerId, round: next.round });
  }
  if (action.type === 'Attack' || action.type === 'Capture' || action.type === 'Evolve') events.push(...applyCombatAction(next, command.actorId, action, content));
  else if (action.type === 'DeclareWar' || action.type === 'MakePeace' || action.type === 'RespondPeace') events.push(...applyDiplomacyAction(next, command.actorId, action));
  else if (isExpansionAction(action)) events.push(...applyExpansionAction(next, command.actorId, action, content));
  else if (action.type !== 'Move' && action.type !== 'EndTurn') events.push(...applyEconomyAction(next, command.actorId, action, content));
  next.commandSeq++;
  // Removal observed before the transaction must clear memory even when losing
  // that unit also removes the observer's last vision source (D19).
  const removed = Object.values(state.units).filter(isMapUnit).filter(unit => !next.units[unit.id] || !isMapUnit(next.units[unit.id]));
  if (removed.length) for (const playerId of state.turnOrder) {
    const visibleBefore = visibleTiles(state, playerId, content);
    for (const unit of removed) if (unit.ownerId === playerId || visibleBefore.has(hexToIndex(unit.position, state.map)!)) {
      delete next.knowledge[playerId].lastKnownUnits[unit.id];
    }
  }
  if (!knowledgeRefreshed) refreshKnowledge(next, content);
  if (action.type !== 'EndTurn' || !knowledgeRefreshed) events.push(...recordExpansion(state, next, command, events, content));
  return { ok: true, state: next, events: events.map((payload, index) => ({ seq: next.commandSeq, index, payload })) };
}
