import type { Diplomacy, DiplomacyAction, DiplomacyEvent, GameState } from './model.ts';

export function relationFor(relations: readonly Diplomacy[], a: number, b: number): Diplomacy | undefined {
  return relations.find(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b));
}
export function validateDiplomacyAction(state: GameState, actor: number, action: DiplomacyAction): 'diplomacy-unavailable' | null {
  const pair = relationFor(state.diplomacy, actor, action.targetPlayerId);
  if (!pair || state.players[action.targetPlayerId]?.eliminated) return 'diplomacy-unavailable';
  const valid = action.type === 'DeclareWar' ? pair.status === 'peace' && state.round >= pair.cooldownUntilRound
    : action.type === 'MakePeace' ? pair.status === 'war' && state.round - pair.changedAtRound >= 5 && pair.proposal === null
      && (pair.rejectedAtRound[actor] === undefined || state.round - pair.rejectedAtRound[actor] >= 5)
      : pair.proposal?.recipientId === actor && pair.proposal.proposerId === action.targetPlayerId && typeof action.accept === 'boolean';
  return valid ? null : 'diplomacy-unavailable';
}
const changed = (relation: Diplomacy): DiplomacyEvent => ({ type: 'DiplomacyChanged', relation: JSON.parse(JSON.stringify(relation)) });
function respond(state: GameState, pair: Diplomacy, accept: boolean): void {
  if (accept) {
    pair.status = 'peace'; pair.changedAtRound = state.round;
    pair.cooldownUntilRound = state.round + ([pair.a, pair.b].some(id => state.players[id].research.unlockedIds.includes('leagueRules')) ? 5 : 10);
  } else pair.rejectedAtRound[pair.proposal!.proposerId] = state.round;
  pair.proposal = null;
}
export function applyDiplomacyAction(state: GameState, actor: number, action: DiplomacyAction): DiplomacyEvent[] {
  const pair = relationFor(state.diplomacy, actor, action.targetPlayerId)!;
  if (action.type === 'DeclareWar') {
    pair.status = 'war'; pair.changedAtRound = state.round; pair.declaredBy = actor;
    pair.citiesLostSinceWar = {}; pair.rejectedAtRound = {}; pair.proposal = null;
  } else if (action.type === 'MakePeace') pair.proposal = { proposerId: actor, recipientId: action.targetPlayerId };
  else respond(state, pair, action.accept);
  return [changed(pair)];
}
export function expirePeaceProposals(state: GameState, actor: number): DiplomacyEvent[] {
  return state.diplomacy.filter(pair => pair.proposal?.recipientId === actor).map(pair => {
    respond(state, pair, false); return changed(pair);
  });
}
