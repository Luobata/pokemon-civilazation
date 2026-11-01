import { CONTENT, unitDefinition } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { scorePlayer } from '../src/core/victory.ts';
import { eraState } from '../src/content/eras.ts';
import type { Command, GameEvent, GameState, KnockdownRecord, Score } from '../src/core/model.ts';

const EXPANSION_ACTION_TYPES = new Set<Command['action']['type']>([
  'UseLeaderAbility', 'RecruitLeaderUnit', 'BuildLeaderBuilding',
  'ClearNest', 'OfferToOverlord', 'HarvestResource', 'UseEvolutionStone',
  'MakeOffering', 'SummonPhantom', 'ActivatePhantom', 'EstablishSanctuary', 'ChallengeGuardian',
  'RegisterChampionshipTeam', 'ProposeAlliance', 'RespondAlliance', 'DissolveAlliance',
  'ProposeTrade', 'RespondTrade', 'BetrayAlliance',
]);

export type CombatRole = Content['species'][string]['role'];
export type ProgressionBand = 'early' | 'middle' | 'late';
export const COMBAT_ROLES: readonly CombatRole[] = ['ranged', 'melee', 'scout', 'fast', 'siege', 'naval', 'air'] as const;
export const PROGRESSION_BANDS: readonly ProgressionBand[] = ['early', 'middle', 'late'] as const;
const MAX_CITY_EVENT_LOG = 2_000;

export function progressionBand(techCount: number): ProgressionBand {
  if (techCount <= 3) return 'early';
  if (techCount <= 6) return 'middle';
  return 'late';
}
export function emptyRoleCounts(): Record<CombatRole, number> {
  return Object.fromEntries(COMBAT_ROLES.map(role => [role, 0])) as Record<CombatRole, number>;
}
export function emptyBandCounts(): Record<ProgressionBand, number> {
  return Object.fromEntries(PROGRESSION_BANDS.map(band => [band, 0])) as Record<ProgressionBand, number>;
}
export function emptyRoleByBandCounts(): Record<ProgressionBand, Record<CombatRole, number>> {
  return Object.fromEntries(PROGRESSION_BANDS.map(band => [band, emptyRoleCounts()])) as Record<ProgressionBand, Record<CombatRole, number>>;
}
function maxRoleCounts(target: Record<CombatRole, number>, values: Record<CombatRole, number>): void {
  for (const role of COMBAT_ROLES) target[role] = Math.max(target[role], values[role]);
}
function relationFor(relations: GameState['diplomacy'], a: number, b: number) {
  return relations.find(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b));
}
function firstRound(current: number | null, round: number): number {
  return current === null ? round : Math.min(current, round);
}
export type CityAttackEvent = {
  round: number;
  seq: number;
  attackerId: number;
  defenderId: number;
  cityId: number;
  wasHeadquarters: boolean;
  captured: boolean;
  newOwnerId: number | null;
  damage: number;
  counterDamage: number;
  attackerRole: CombatRole | null;
  attackerSpeciesId: string | null;
  attackerTechCount: number;
  attackerHasSiegeCraft: boolean;
  progressionBand: ProgressionBand;
};
export type WarEpisode = {
  a: number;
  b: number;
  declaredBy: number | null;
  startRound: number;
  endRound: number | null;
  status: 'war' | 'peace' | 'eliminated' | 'active-at-end';
  rounds: number | null;
};

export type SeatActivity = { commands: Record<string, number>; citiesFounded: number; settlersProduced: number;
  attacks: number; cityAttacks: number; captureAttempts: number; captureSuccesses: number; evolves: number;
  activeAbilities: number; recruitedLeaderUnits: number; leaderBuildings: number; expansionActions: number;
  idleUnitRounds: number; availableUnitRounds: number; peakCities: number; peakCombatUnits: number;
  resolvedCityAttacks: number; cityAttackDamage: number; cityAttackCounterDamage: number; cityCaptures: number; cityLosses: number;
  hqAttacks: number; hqCaptures: number; firstCityAttackRound: number | null; firstHQAttackRound: number | null;
  siegeCraftRound: number | null; warDeclarations: number; peaceAgreements: number; warRounds: number;
  cityAttacksByRole: Record<CombatRole, number>; cityCapturesByRole: Record<CombatRole, number>;
  cityAttacksByProgressionBand: Record<ProgressionBand, number>; cityCapturesByProgressionBand: Record<ProgressionBand, number>;
  cityAttacksByRoleAndProgressionBand: Record<ProgressionBand, Record<CombatRole, number>>;
  combatUnitsByRole: Record<CombatRole, number>; peakCombatUnitsByRole: Record<CombatRole, number>; eraArrivalRounds: Record<number, number> };
export type RoundSnapshot = { round: number; players: { id: number; eliminated: boolean; score: Score; gold: number;
  cities: number; population: number; combatUnits: number; combatUnitsByRole: Record<CombatRole, number>;
  eraIndex: number | null; eraId: string | null;
  recovering: number; upkeep: number; techs: number }[] };
export function roundSnapshot(state: GameState, round: number, content: Content = CONTENT): RoundSnapshot {
  return { round, players: Object.values(state.players).map(player => {
    const units = Object.values(state.units).filter(unit => unit.ownerId === player.id), score = scorePlayer(state, player.id, content);
    const combatUnitsByRole = emptyRoleCounts();
    for (const unit of units) {
      if (unit.location !== 'map' || unit.kind !== 'pokemon') continue;
      combatUnitsByRole[content.species[unit.speciesId].role]++;
    }
    const era = eraState(player, state.setup.eraProgression);
    return { id: player.id, eliminated: player.eliminated, score, gold: player.gold, cities: score.cities, population: score.population,
      combatUnits: units.filter(unit => unit.location === 'map' && unit.kind === 'pokemon').length, combatUnitsByRole,
      eraIndex: era?.index ?? null, eraId: era?.current.id ?? null,
      recovering: units.filter(unit => unit.location === 'recovering').length,
      upkeep: units.reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0), techs: score.techs };
  }) };
}
export function uniqueScoreLeader(snapshot: RoundSnapshot): number | null {
  const scores = snapshot.players.map(player => player.score);
  const highest = Math.max(...scores.map(score => score.total));
  const leaders = scores.filter(score => score.total === highest);
  return leaders.length === 1 ? leaders[0].playerId : null;
}
export function createTelemetry(state: { players: object; schemaVersion: GameState['schemaVersion']; rulesVersion: GameState['rulesVersion'] }, content: Content = CONTENT) {
  return {
    activity: Object.fromEntries(Object.keys(state.players).map(id => [Number(id), { commands: {}, citiesFounded: 0, settlersProduced: 0, attacks: 0, cityAttacks: 0,
      captureAttempts: 0, captureSuccesses: 0, evolves: 0, activeAbilities: 0, recruitedLeaderUnits: 0, leaderBuildings: 0, expansionActions: 0, idleUnitRounds: 0, availableUnitRounds: 0, peakCities: 1, peakCombatUnits: 1,
      resolvedCityAttacks: 0, cityAttackDamage: 0, cityAttackCounterDamage: 0, cityCaptures: 0, cityLosses: 0, hqAttacks: 0, hqCaptures: 0,
      firstCityAttackRound: null, firstHQAttackRound: null, siegeCraftRound: null, warDeclarations: 0, peaceAgreements: 0, warRounds: 0,
      cityAttacksByRole: emptyRoleCounts(), cityCapturesByRole: emptyRoleCounts(), cityAttacksByProgressionBand: emptyBandCounts(), cityCapturesByProgressionBand: emptyBandCounts(),
      cityAttacksByRoleAndProgressionBand: emptyRoleByBandCounts(), combatUnitsByRole: emptyRoleCounts(), peakCombatUnitsByRole: emptyRoleCounts(), eraArrivalRounds: {} }])) as Record<number, SeatActivity>,
    settlerOrders: [] as number[], rounds: [] as RoundSnapshot[], round30Leader: null as number | null, reachedRound30End: false,
    knockdowns: [] as (KnockdownRecord & { round: number; seq: number })[],
    captureEvents: [] as { round: number; playerId: number; probability: number; success: boolean }[],
    cityEvents: [] as CityAttackEvent[],
    cityEventLogTruncated: false,
    warEpisodes: [] as WarEpisode[],
    eliminations: [] as { round: number; seq: number; playerId: number }[],
    activeWarsAtEnd: null as number | null,
    finalizedRound: null as number | null,
    versions: { schema: state.schemaVersion, rules: state.rulesVersion, content: content.version },
  };
}
export type Telemetry = ReturnType<typeof createTelemetry>;
function recordEraArrival(arrivals: Record<number, number>, index: number, round: number): void {
  if (arrivals[index] === undefined) arrivals[index] = round;
}
function recordEraTransitions(data: Telemetry, before: GameState, after: GameState): void {
  for (const [id, player] of Object.entries(before.players)) {
    const seat = data.activity[Number(id)];
    if (!seat) continue;
    const initial = eraState(player, before.setup.eraProgression);
    if (initial !== null && Object.keys(seat.eraArrivalRounds).length === 0) {
      recordEraArrival(seat.eraArrivalRounds, initial.index, before.round);
    }
  }

  for (const [id, player] of Object.entries(after.players)) {
    const seat = data.activity[Number(id)];
    if (!seat) continue;
    const beforePlayer = before.players[Number(id)];
    if (!beforePlayer) continue;
    const beforeEra = eraState(beforePlayer, before.setup.eraProgression);
    const afterEra = eraState(player, after.setup.eraProgression);
    if (beforeEra === null || afterEra === null || afterEra.index <= beforeEra.index) continue;
    for (let index = beforeEra.index + 1; index <= afterEra.index; index += 1) {
      recordEraArrival(seat.eraArrivalRounds, index, before.round);
    }
  }
}
export function collectTelemetry(data: Telemetry, before: GameState, after: GameState, command: Command, events: GameEvent[], content: Content = CONTENT): void {
  recordEraTransitions(data, before, after);
  const actor = data.activity[command.actorId], action = command.action;
  actor.commands[action.type] = (actor.commands[action.type] ?? 0) + 1;
  if (action.type === 'Attack') { actor.attacks++; if (action.target.kind === 'city') actor.cityAttacks++; }
  if (EXPANSION_ACTION_TYPES.has(action.type)) actor.expansionActions++;
  if (action.type === 'EndTurn') {
    const units = Object.values(before.units).filter(unit => unit.ownerId === command.actorId && unit.location === 'map');
    actor.availableUnitRounds += units.length; actor.idleUnitRounds += units.filter(unit => unit.actionLeft > 0).length;
  }
  for (const { payload } of events) {
    if (payload.type === 'BattleResolved') {
      data.knockdowns.push(...(payload.knockdowns ?? []).map(record => ({ ...record, round: before.round, seq: after.commandSeq })));
      if (payload.target.kind === 'city') {
        const attacker = before.units[payload.attackerId] ?? after.units[payload.attackerId];
        const attackerOwner = attacker && attacker.location === 'map' ? attacker.ownerId : null;
        const cityBefore = before.cities[payload.target.id], defender = cityBefore?.ownerId ?? null;
        const attackerUnit = attacker?.kind === 'pokemon' ? attacker : null;
        const role = attackerUnit ? content.species[attackerUnit.speciesId].role : null;
        const techCount = attackerOwner === null ? 0 : before.players[attackerOwner].research.unlockedIds.length;
        const band = progressionBand(techCount);
        const wasHeadquarters = defender !== null && before.players[defender].headquartersCityId === payload.target.id;
        const event: CityAttackEvent = {
          round: before.round, seq: after.commandSeq, attackerId: attackerOwner ?? -1, defenderId: defender ?? -1,
          cityId: payload.target.id, wasHeadquarters, captured: payload.capturedCity,
          newOwnerId: payload.capturedCity ? attackerOwner : cityBefore?.ownerId ?? null,
          damage: payload.damage, counterDamage: payload.counterDamage, attackerRole: role,
          attackerSpeciesId: attackerUnit?.speciesId ?? null, attackerTechCount: techCount,
          attackerHasSiegeCraft: attackerOwner !== null && before.players[attackerOwner].research.unlockedIds.includes('siegeCraft'), progressionBand: band,
        };
        if (data.cityEvents.length < MAX_CITY_EVENT_LOG) data.cityEvents.push(event);
        else data.cityEventLogTruncated = true;
        if (attackerOwner !== null) {
          const seat = data.activity[attackerOwner];
          seat.resolvedCityAttacks++; seat.cityAttackDamage += payload.damage; seat.cityAttackCounterDamage += payload.counterDamage;
          seat.firstCityAttackRound = firstRound(seat.firstCityAttackRound, before.round);
          if (wasHeadquarters) { seat.hqAttacks++; seat.firstHQAttackRound = firstRound(seat.firstHQAttackRound, before.round); }
          if (role) { seat.cityAttacksByRole[role]++; seat.cityAttacksByRoleAndProgressionBand[band][role]++; }
          seat.cityAttacksByProgressionBand[band]++;
          if (payload.capturedCity) {
            seat.cityCaptures++;
            if (wasHeadquarters) seat.hqCaptures++;
            if (role) seat.cityCapturesByRole[role]++;
            seat.cityCapturesByProgressionBand[band]++;
          }
        }
        if (payload.capturedCity && defender !== null) data.activity[defender].cityLosses++;
      }
    }
    if (payload.type === 'TechCompleted') {
      const seat = data.activity[payload.playerId];
      if (payload.techId === 'siegeCraft') seat.siegeCraftRound ??= before.round;
    }
    if (payload.type === 'DiplomacyChanged') {
      const previous = relationFor(before.diplomacy, payload.relation.a, payload.relation.b);
      if (previous?.status === 'peace' && payload.relation.status === 'war') {
        const episode: WarEpisode = { a: payload.relation.a, b: payload.relation.b, declaredBy: payload.relation.declaredBy,
          startRound: payload.relation.changedAtRound, endRound: null, status: 'war', rounds: null };
        data.warEpisodes.push(episode);
        if (payload.relation.declaredBy !== null) data.activity[payload.relation.declaredBy].warDeclarations++;
      } else if (previous?.status === 'war' && payload.relation.status === 'peace') {
        const episode = [...data.warEpisodes].reverse().find(item => item.a === payload.relation.a && item.b === payload.relation.b && item.endRound === null);
        if (episode) {
          episode.endRound = payload.relation.changedAtRound; episode.status = 'peace';
          episode.rounds = Math.max(0, episode.endRound - episode.startRound);
        }
        data.activity[payload.relation.a].peaceAgreements++;
        data.activity[payload.relation.b].peaceAgreements++;
      }
    }
    if (payload.type === 'CivilizationEliminated') {
      data.eliminations.push({ round: before.round, seq: after.commandSeq, playerId: payload.eliminatedPlayerId });
      for (const episode of data.warEpisodes) {
        if (episode.endRound !== null || (episode.a !== payload.eliminatedPlayerId && episode.b !== payload.eliminatedPlayerId)) continue;
        episode.endRound = before.round; episode.status = 'eliminated';
        episode.rounds = Math.max(0, episode.endRound - episode.startRound);
      }
    }
    if (payload.type === 'CityFounded') data.activity[payload.playerId].citiesFounded++;
    if (payload.type === 'Captured') {
      const seat = data.activity[payload.playerId]; seat.captureAttempts++; if (payload.success) seat.captureSuccesses++;
      data.captureEvents.push({ round: before.round, playerId: payload.playerId, probability: payload.probability, success: payload.success });
    }
    if (payload.type === 'Evolved') data.activity[payload.playerId].evolves++;
    if (payload.type === 'LeaderAbilityUsed') data.activity[payload.playerId].activeAbilities++;
    if (payload.type === 'LeaderUnitRecruited') data.activity[payload.playerId].recruitedLeaderUnits++;
    if (payload.type === 'LeaderBuildingBuilt') data.activity[payload.playerId].leaderBuildings++;
    const settlerOrder = payload.type === 'UnitTrained' && payload.unit.kind === 'logistics' ? payload.orderId
      : payload.type === 'ProductionWaiting' && payload.definitionId === 'settler' ? payload.sourceOrderId : null;
    if (settlerOrder !== null && !data.settlerOrders.includes(settlerOrder) && 'playerId' in payload && payload.playerId !== null) {
      data.settlerOrders.push(settlerOrder); data.activity[payload.playerId].settlersProduced++;
    }
    if (payload.type === 'RoundEnded') {
      const snapshot = roundSnapshot(after, payload.round, content); data.rounds.push(snapshot);
      for (const player of snapshot.players) {
        const seat = data.activity[player.id]; seat.peakCities = Math.max(seat.peakCities, player.cities); seat.peakCombatUnits = Math.max(seat.peakCombatUnits, player.combatUnits);
        seat.combatUnitsByRole = player.combatUnitsByRole;
        maxRoleCounts(seat.peakCombatUnitsByRole, player.combatUnitsByRole);
        if (player.eliminated) continue;
        for (const pair of after.diplomacy) {
          if (pair.status !== 'war' || after.players[pair.a]?.eliminated || after.players[pair.b]?.eliminated) continue;
          if (pair.a !== player.id && pair.b !== player.id) continue;
          seat.warRounds++;
          break;
        }
      }
      for (const player of snapshot.players) {
        if (player.eraIndex === null) continue;
        const arrivals = data.activity[player.id].eraArrivalRounds;
        if (arrivals[player.eraIndex] === undefined) arrivals[player.eraIndex] = payload.round;
      }
      if (payload.round === 30) { data.reachedRound30End = true; data.round30Leader = uniqueScoreLeader(snapshot); }
    }
  }
}
export function finalizeTelemetry(data: Telemetry, state: GameState, content: Content = CONTENT): void {
  if (data.finalizedRound !== null) return;
  data.finalizedRound = state.round;
  for (const [id, player] of Object.entries(state.players)) {
    const seat = data.activity[Number(id)];
    if (!seat) continue;
    const finalRoles = emptyRoleCounts();
    for (const unit of Object.values(state.units)) {
      if (unit.ownerId !== player.id || unit.location !== 'map' || unit.kind !== 'pokemon') continue;
      finalRoles[content.species[unit.speciesId].role]++;
    }
    seat.combatUnitsByRole = finalRoles;
    maxRoleCounts(seat.peakCombatUnitsByRole, finalRoles);
  }
  const active = data.warEpisodes.filter(episode => episode.endRound === null);
  for (const episode of active) {
    episode.endRound = state.round; episode.status = 'active-at-end'; episode.rounds = Math.max(0, state.round - episode.startRound);
  }
  data.activeWarsAtEnd = active.length;
}
