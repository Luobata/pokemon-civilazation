// Civilization expansion coordinator: offerings/phantoms, sanctuaries, championship, and deep alliances.
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { CivilizationContent, PhantomCategory } from '../content/civilization-systems.ts';
import { applyRelationAction, planRelationAction, resolveRelationRound, validateRelationAction } from './alliances.ts';
import { applyChampionshipAction, championshipNpcEntrants, resolveChampionshipRound, seasonNpcEntrants, validateChampionshipAction } from './championship.ts';
import {
  PHANTOM_IDS, RELATION_ACTIONS, atPeaceWithAll, baseRelation, checkCivilizationVictory, civilization,
  emptyRelation, grantChampionshipTitle, guardianCombatant, guardianFighter, relationKey,
  sanctuaryView, simulateBattle, sortedPlayerIds, stableSeed, tabletClaimed, unitBattlePower,
} from './civilization-model.ts';
import type {
  CivilizationAction, CivilizationHost, CivilizationPlanningPolicy, CivilizationPlayerState,
  CivilizationState, CivilizationView,
} from './civilization-model.ts';
import { clonePlain } from './clone.ts';
import { hexToIndex } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import type { EventPayload, GameState } from './model.ts';
import { applyOfferingOrPhantom, consumeCivilizationProduction, planOfferingOrPhantom, validateOfferingOrPhantom } from './offerings-phantoms.ts';
import { applySanctuaryAction, planSanctuaryAction, selectSanctuarySites, validateSanctuaryAction } from './sanctuaries.ts';

export {
  stableSeed, guardianFighter, guardianCombatant, simulateBattle,
  checkCivilizationVictory, grantChampionshipTitle, consumeCivilizationProduction,
  championshipNpcEntrants, seasonNpcEntrants,
};
export type {
  CivilizationPlayerState, SanctuarySite, BattleCombatant, BattleStrike, BattleRound, BattleTrace,
  ChampionshipEntrant, ChampionshipMatch, ChampionshipSeason, CivilizationRelation, CivilizationVictory,
  CivilizationState, CivilizationAction, CivilizationEvent, CivilizationPlanningCity, CivilizationPlanningUnit,
  CivilizationPlanningState, CivilizationSanctuaryView, CivilizationRelationView, CivilizationPlanningPolicy,
  ChampionshipNpc, CivilizationView,
} from './civilization-model.ts';

export function initializeCivilization(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): CivilizationState {
  if (state.expansion?.civilization) return state.expansion.civilization;
  const created: CivilizationState = {
    version: 1,
    initializedRound: state.round,
    sanctuaries: selectSanctuarySites(state, content),
    players: Object.fromEntries(sortedPlayerIds(state).map(playerId => [playerId, {
      offeringPoints: 0, lifetimeOfferings: 0, offeredThisRoundByCity: {}, nextPhantomCost: content.phantoms.firstSummonCost,
      summonedPhantomIds: [], activePhantoms: [], hallOfFame: [], phantomNameLedger: {},
    }])),
    tabletOwners: {},
    pendingProductionByCity: {},
    championship: {
      nextSeason: 1,
      nextRound: state.round + content.championship.firstSeasonRound - 1,
      intervalRounds: content.championship.intervalRounds,
      registrations: {}, history: [], titlesByPlayer: {}, victory: null,
    },
    relations: Object.fromEntries(state.diplomacy.map(pair => [relationKey(pair.a, pair.b), emptyRelation(state.round)])),
    victory: null,
  };
  if (state.expansion) state.expansion.civilization = created;
  else state.expansion = { version: 1, civilization: created } as NonNullable<GameState['expansion']>;
  return created;
}

export function isCivilizationAction(value: unknown): value is CivilizationAction {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const action = value as Record<string, unknown>;
  const type = action.type;
  if (type === 'MakeOffering') return typeof action.cityId === 'number' && (action.resource === 'food' || action.resource === 'gold');
  if (type === 'SummonPhantom') return PHANTOM_IDS.includes(action.category as PhantomCategory);
  if (type === 'ActivatePhantom') {
    return PHANTOM_IDS.includes(action.phantomId as PhantomCategory)
      && (action.cityId === undefined || typeof action.cityId === 'number')
      && (action.techId === undefined || typeof action.techId === 'string')
      && (action.unitIds === undefined || (Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number')));
  }
  if (type === 'EstablishSanctuary') return typeof action.siteId === 'string' && typeof action.unitId === 'number';
  if (type === 'ChallengeGuardian') return typeof action.siteId === 'string'
    && Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number');
  if (type === 'RegisterChampionshipTeam') return Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number');
  if (RELATION_ACTIONS.includes(type as (typeof RELATION_ACTIONS)[number])) {
    return typeof action.targetPlayerId === 'number'
      && (action.accept === undefined || typeof action.accept === 'boolean');
  }
  return false;
}

export function validateCivilizationAction(state: CivilizationHost, actorId: number, action: CivilizationAction, content: CivilizationContent = CIVILIZATION_CONTENT): string | null {
  const civilizationState = civilization(state);
  if (!civilizationState) return 'civilization-uninitialized';
  if (state.outcome || civilizationState.victory) return 'game-ended';
  const player = state.players[actorId];
  if (!player || player.eliminated) return 'player-unavailable';
  const expansionPlayer = civilizationState.players[actorId];
  if (!expansionPlayer) return 'player-unavailable';
  if (action.type === 'MakeOffering' || action.type === 'SummonPhantom' || action.type === 'ActivatePhantom') {
    return validateOfferingOrPhantom(state, actorId, action, content);
  }
  if (action.type === 'EstablishSanctuary' || action.type === 'ChallengeGuardian') {
    return validateSanctuaryAction(state, actorId, action, content);
  }
  if (action.type === 'RegisterChampionshipTeam') return validateChampionshipAction(state, actorId, action, content);
  return validateRelationAction(state, actorId, action, content);
}

export function applyCivilizationAction(state: CivilizationHost, actorId: number, action: CivilizationAction, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const reason = validateCivilizationAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const events: EventPayload[] = [];
  if (action.type === 'MakeOffering' || action.type === 'SummonPhantom' || action.type === 'ActivatePhantom') {
    events.push(...applyOfferingOrPhantom(state, actorId, action, content));
  } else if (action.type === 'EstablishSanctuary' || action.type === 'ChallengeGuardian') {
    events.push(...applySanctuaryAction(state, actorId, action, content));
  } else if (action.type === 'RegisterChampionshipTeam') {
    events.push(...applyChampionshipAction(state, actorId, action, content));
  } else {
    events.push(...applyRelationAction(state, actorId, action, content));
  }
  events.push(...checkCivilizationVictory(state, content));
  return events;
}

export function resolveCivilizationRound(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const civilizationState = civilization(state);
  if (!civilizationState || civilizationState.victory || state.outcome) return [];
  const events: EventPayload[] = [];
  for (const city of Object.values(state.cities).sort((a, b) => a.id - b.id)) {
    const amount = consumeCivilizationProduction(state, city.id);
    if (amount && city.ownerId !== null) events.push({ type: 'CivilizationProductionConsumed', playerId: city.ownerId, cityId: city.id, amount });
  }
  for (const player of Object.values(civilizationState.players)) player.offeredThisRoundByCity = {};
  resolveRelationRound(state, content, events);
  resolveChampionshipRound(state, content, events);
  events.push(...checkCivilizationVictory(state, content));
  return events;
}

export function observeCivilization(state: CivilizationHost, playerId: number, visibleTileIds: Set<number>, content: CivilizationContent = CIVILIZATION_CONTENT): CivilizationView {
  const civilizationState = civilization(state);
  if (!civilizationState) throw new Error('civilization-uninitialized');
  const clone = clonePlain;
  const visible = (position: Hex) => visibleTileIds.has(hexToIndex(position, state.map)!);
  const defaultPlayer: CivilizationPlayerState = {
    offeringPoints: 0, lifetimeOfferings: 0, offeredThisRoundByCity: {}, nextPhantomCost: content.phantoms.firstSummonCost,
    summonedPhantomIds: [], activePhantoms: [], hallOfFame: [], phantomNameLedger: {},
  };
  const ownedUnits = Object.values(state.units).filter(unit => unit.ownerId === playerId).sort((a, b) => a.id - b.id);
  const visibleSanctuaries = civilizationState.sanctuaries.filter(site => visible(site.position));
  return {
    version: 1,
    playerId,
    round: state.round,
    victory: clone(civilizationState.victory),
    sanctuaries: clone(visibleSanctuaries.map(site => ({ ...sanctuaryView(site),
      ...(site.challengeRoundByPlayer[playerId] !== undefined ? { lastChallengeRound: site.challengeRoundByPlayer[playerId] } : {}) }))),
    tabletOwners: clone(Object.fromEntries(visibleSanctuaries
      .filter(site => tabletClaimed(civilizationState, site.tabletId))
      .map(site => [site.tabletId, civilizationState.tabletOwners[site.tabletId]]))),
    player: clone(civilizationState.players[playerId] ?? defaultPlayer),
    championship: {
      nextSeason: civilizationState.championship.nextSeason,
      nextRound: civilizationState.championship.nextRound,
      intervalRounds: civilizationState.championship.intervalRounds,
      registration: clone(civilizationState.championship.registrations[playerId] ?? null),
      history: [...civilizationState.championship.history],
      titlesByPlayer: clone(civilizationState.championship.titlesByPlayer),
      victory: clone(civilizationState.championship.victory),
      registrationCount: Object.keys(civilizationState.championship.registrations).length,
      ...(civilizationState.championship.nextRound - state.round <= 5 ? { lineup: clone(seasonNpcEntrants(state, content,
        Object.keys(civilizationState.championship.registrations).map(Number).sort((a, b) => a - b)).npcs) } : {}),
    },
    relations: Object.entries(civilizationState.relations)
      .filter(([key]) => key.split(':').map(Number).includes(playerId))
      .map(([key, relation]) => {
        const otherId = key.split(':').map(Number).find(id => id !== playerId)!;
        return {
          ...clone(relation),
          targetPlayerId: otherId,
          atPeace: baseRelation(state, playerId, otherId)?.status === 'peace',
          targetEliminated: state.players[otherId]?.eliminated ?? true,
        };
      }).sort((a, b) => a.targetPlayerId - b.targetPlayerId),
    planning: {
      playerId,
      gold: state.players[playerId]?.gold ?? 0,
      activeResearchTechId: state.players[playerId]?.research.techId ?? null,
      atPeaceWithAll: atPeaceWithAll(state, playerId),
      canOffer: civilizationState.sanctuaries.some(site => site.ownerId === playerId),
      cities: Object.values(state.cities).filter(city => city.ownerId === playerId).sort((a, b) => a.id - b.id)
        .map(city => ({ id: city.id, food: city.food, hasProduction: city.queue.length > 0 })),
      units: ownedUnits.filter(unit => unit.kind === 'pokemon').map(unit => ({
        id: unit.id,
        speciesId: unit.speciesId,
        position: unit.location === 'map' ? clone(unit.position) : null,
        actionLeft: unit.actionLeft,
        power: unitBattlePower(unit, content),
      })),
    },
  };
}

export function planCivilizationAction(view: CivilizationView, content: CivilizationContent = CIVILIZATION_CONTENT,
  policy?: CivilizationPlanningPolicy, map: MapShape = { width: 0 }): CivilizationAction | null {
  void map;
  // Guardian challenges and conference registration are planned with lineups (src/ai/battle-plan.ts).
  return planSanctuaryAction(view, content)
    ?? planOfferingOrPhantom(view, content)
    ?? planRelationAction(view, content, policy);
}
