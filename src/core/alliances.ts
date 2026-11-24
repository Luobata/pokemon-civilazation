// Deep diplomacy: alliances, trade pacts, betrayal, trust, and round-end trade settlements.
import type { CivilizationContent } from '../content/civilization-systems.ts';
import { RELATION_ACTIONS, baseRelation, civilization, civilizationRelation } from './civilization-model.ts';
import type { CivilizationAction, CivilizationEvent, CivilizationHost, CivilizationPlanningPolicy, CivilizationRelationView, CivilizationView } from './civilization-model.ts';
import type { EventPayload } from './model.ts';

type RelationAction = Extract<CivilizationAction, { type: (typeof RELATION_ACTIONS)[number] }>;

export function validateRelationAction(state: CivilizationHost, actorId: number, action: RelationAction, content: CivilizationContent): string | null {
  const targetId = action.targetPlayerId;
  if (targetId === actorId || !state.players[targetId] || state.players[targetId].eliminated) return 'player-unavailable';
  const pair = baseRelation(state, actorId, targetId);
  const relation = civilizationRelation(state, actorId, targetId);
  if (!pair || !relation || pair.status !== 'peace') return 'peace-required';
  if (action.type === 'ProposeAlliance') {
    return !relation.allianceProposal && relation.allianceSinceRound === null
      && state.round >= relation.betrayalCooldownUntilRound
      && state.round > (relation.allianceLastProposalRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds
      && state.round > (relation.allianceLastRejectedRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds ? null : 'proposal-unavailable';
  }
  if (action.type === 'RespondAlliance') {
    return relation.allianceProposal?.proposerId === targetId && action.accept !== undefined && typeof action.accept === 'boolean' ? null : 'proposal-unavailable';
  }
  if (action.type === 'DissolveAlliance' || action.type === 'BetrayAlliance') {
    if (relation.allianceSinceRound === null) return 'alliance-inactive';
    if (action.type === 'BetrayAlliance' && state.players[actorId].gold < content.diplomacy.betrayalGoldCost) return 'insufficient-gold';
    return null;
  }
  if (action.type === 'ProposeTrade') {
    return !relation.tradeProposal && relation.tradeSinceRound === null
      && state.round > (relation.tradeLastProposalRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds
      && state.round > (relation.tradeLastRejectedRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds ? null : 'proposal-unavailable';
  }
  return relation.tradeProposal?.proposerId === targetId && action.accept !== undefined && typeof action.accept === 'boolean' ? null : 'proposal-unavailable';
}

export function applyRelationAction(state: CivilizationHost, actorId: number, action: RelationAction, content: CivilizationContent): CivilizationEvent[] {
  const targetId = action.targetPlayerId;
  const relation = civilizationRelation(state, actorId, targetId)!;
  const playerIds: [number, number] = [Math.min(actorId, targetId), Math.max(actorId, targetId)];
  if (action.type === 'ProposeAlliance') {
    relation.allianceProposal = { proposerId: actorId, proposedRound: state.round };
    relation.allianceLastProposalRound = state.round;
    return [{ type: 'AllianceChanged', public: false, playerIds, status: 'proposed', proposerId: actorId }];
  }
  if (action.type === 'RespondAlliance') {
    if (action.accept) {
      relation.allianceSinceRound = state.round;
      relation.allianceProposal = null;
      return [{ type: 'AllianceChanged', public: true, playerIds, status: 'active', proposerId: targetId }];
    }
    relation.allianceLastRejectedRound = state.round;
    relation.allianceProposal = null;
    return [{ type: 'AllianceChanged', public: false, playerIds, status: 'dissolved', proposerId: targetId }];
  }
  if (action.type === 'DissolveAlliance') {
    relation.allianceSinceRound = null;
    return [{ type: 'AllianceChanged', public: true, playerIds, status: 'dissolved', proposerId: actorId }];
  }
  if (action.type === 'BetrayAlliance') {
    state.players[actorId].gold -= content.diplomacy.betrayalGoldCost;
    relation.allianceSinceRound = null;
    relation.tradeSinceRound = null;
    relation.allianceProposal = null;
    relation.tradeProposal = null;
    relation.trust = content.diplomacy.betrayalTrust;
    relation.betrayalCooldownUntilRound = state.round + content.diplomacy.betrayalCooldownRounds;
    if (!relation.betrayedBy.includes(actorId)) relation.betrayedBy.push(actorId);
    return [{ type: 'AllianceChanged', public: true, playerIds, status: 'betrayed', proposerId: actorId }];
  }
  if (action.type === 'ProposeTrade') {
    relation.tradeProposal = { proposerId: actorId, proposedRound: state.round };
    relation.tradeLastProposalRound = state.round;
    return [{ type: 'TradeChanged', public: false, playerIds, status: 'proposed', proposerId: actorId }];
  }
  if (action.type === 'RespondTrade') {
    if (action.accept) {
      relation.tradeSinceRound = state.round;
      relation.tradeProposal = null;
      return [{ type: 'TradeChanged', public: true, playerIds, status: 'active', proposerId: targetId }];
    }
    relation.tradeLastRejectedRound = state.round;
    relation.tradeProposal = null;
    return [{ type: 'TradeChanged', public: false, playerIds, status: 'ended', proposerId: targetId }];
  }
  return [];
}

export function resolveRelationRound(state: CivilizationHost, content: CivilizationContent, events: EventPayload[]): void {
  const civilizationState = civilization(state)!;
  for (const [key, relation] of Object.entries(civilizationState.relations)) {
    const [a, b] = key.split(':').map(Number);
    const publicIds: [number, number] = [a, b];
    if (baseRelation(state, a, b)?.status === 'war') {
      if (relation.allianceSinceRound !== null || relation.allianceProposal || relation.tradeSinceRound !== null || relation.tradeProposal) {
        const publicChange = relation.allianceSinceRound !== null || relation.tradeSinceRound !== null;
        relation.allianceSinceRound = null; relation.allianceProposal = null;
        relation.tradeSinceRound = null; relation.tradeProposal = null;
        events.push({ type: 'AllianceChanged', public: publicChange, playerIds: publicIds, status: 'dissolved' });
      }
      continue;
    }
    if (relation.allianceProposal && state.round - relation.allianceProposal.proposedRound >= content.diplomacy.proposalExpiryRounds) {
      relation.allianceLastProposalRound = relation.allianceProposal.proposedRound;
      relation.allianceProposal = null;
      events.push({ type: 'AllianceChanged', public: false, playerIds: publicIds, status: 'dissolved' });
    }
    if (relation.tradeProposal && state.round - relation.tradeProposal.proposedRound >= content.diplomacy.proposalExpiryRounds) {
      relation.tradeLastProposalRound = relation.tradeProposal.proposedRound;
      relation.tradeProposal = null;
      events.push({ type: 'TradeChanged', public: false, playerIds: publicIds, status: 'expired' });
    }
    if (relation.tradeSinceRound !== null && state.round - relation.tradeSinceRound >= content.diplomacy.tradeIntervalRounds
      && (state.round - relation.tradeSinceRound) % content.diplomacy.tradeIntervalRounds === 0) {
      const tradeA = content.diplomacy.tradeIncome * (state.players[a].leaderId === 'jasmine' ? 2 : 1);
      const tradeB = content.diplomacy.tradeIncome * (state.players[b].leaderId === 'jasmine' ? 2 : 1);
      state.players[a].gold += tradeA;
      state.players[b].gold += tradeB;
      relation.trust = Math.min(content.diplomacy.maximumTrust, relation.trust + content.diplomacy.trustStep);
      events.push({ type: 'TradeSettled', playerId: a, targetPlayerId: b, gold: tradeA, trust: relation.trust });
      events.push({ type: 'TradeSettled', playerId: b, targetPlayerId: a, gold: tradeB, trust: relation.trust });
    }
  }
}

export function planRelationAction(view: CivilizationView, content: CivilizationContent, policy?: CivilizationPlanningPolicy): CivilizationAction | null {
  const relationEligible = (relation: CivilizationRelationView) => relation.atPeace && !relation.targetEliminated;
  const proposalRoundAvailable = (round: number | null) =>
    view.round > (round === null ? -Infinity : round + content.diplomacy.rejectionCooldownRounds);
  const activeAlliances = view.relations.filter(relation => !relation.targetEliminated && relation.allianceSinceRound !== null);
  if (policy && policy.maximumAllies === 0 && view.relations.filter(relation => !relation.targetEliminated).length === 1) {
    const lastAlliance = activeAlliances[0];
    if (lastAlliance) return { type: 'DissolveAlliance', targetPlayerId: lastAlliance.targetPlayerId };
  }
  const allianceResponse = view.relations.find(relation => relationEligible(relation)
    && relation.allianceProposal?.proposerId === relation.targetPlayerId);
  if (allianceResponse) {
    const policyRejects = policy !== undefined
      && (activeAlliances.length >= policy.maximumAllies
        || policy.blockedAllianceTargetPlayerIds.includes(allianceResponse.targetPlayerId));
    return { type: 'RespondAlliance', targetPlayerId: allianceResponse.targetPlayerId, accept: !policyRejects };
  }
  const tradeResponse = view.relations.find(relation => relationEligible(relation)
    && relation.tradeProposal?.proposerId === relation.targetPlayerId);
  if (tradeResponse) return { type: 'RespondTrade', targetPlayerId: tradeResponse.targetPlayerId, accept: true };

  const allianceTarget = view.relations.find(relation => relationEligible(relation)
    && relation.allianceSinceRound === null
    && relation.allianceProposal === null
    && proposalRoundAvailable(relation.allianceLastProposalRound)
    && proposalRoundAvailable(relation.allianceLastRejectedRound)
    && view.round >= relation.betrayalCooldownUntilRound
    && relation.trust >= 0
    && (policy === undefined
      || (activeAlliances.length < policy.maximumAllies
        && !policy.blockedAllianceTargetPlayerIds.includes(relation.targetPlayerId))));
  if (allianceTarget) return { type: 'ProposeAlliance', targetPlayerId: allianceTarget.targetPlayerId };
  const tradeTarget = view.relations.find(relation => relationEligible(relation)
    && relation.tradeSinceRound === null
    && relation.tradeProposal === null
    && proposalRoundAvailable(relation.tradeLastProposalRound)
    && proposalRoundAvailable(relation.tradeLastRejectedRound)
    && relation.trust >= -10);
  if (tradeTarget) return { type: 'ProposeTrade', targetPlayerId: tradeTarget.targetPlayerId };
  return null;
}
