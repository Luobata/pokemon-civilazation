import { CONTENT, unitDefinition } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { scorePlayer } from '../src/core/victory.ts';
import type { Command, GameEvent, GameState, KnockdownRecord, Score } from '../src/core/model.ts';

export type SeatActivity = { commands: Record<string, number>; citiesFounded: number; settlersProduced: number;
  attacks: number; cityAttacks: number; captureAttempts: number; captureSuccesses: number; evolves: number;
  idleUnitRounds: number; availableUnitRounds: number; peakCities: number; peakCombatUnits: number };
export type RoundSnapshot = { round: number; players: { id: number; eliminated: boolean; score: Score; gold: number;
  cities: number; population: number; combatUnits: number; recovering: number; upkeep: number; techs: number }[] };
export function roundSnapshot(state: GameState, round: number, content: Content = CONTENT): RoundSnapshot {
  return { round, players: Object.values(state.players).map(player => {
    const units = Object.values(state.units).filter(unit => unit.ownerId === player.id), score = scorePlayer(state, player.id, content);
    return { id: player.id, eliminated: player.eliminated, score, gold: player.gold, cities: score.cities, population: score.population,
      combatUnits: units.filter(unit => unit.location === 'map' && unit.kind === 'pokemon').length,
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
      captureAttempts: 0, captureSuccesses: 0, evolves: 0, idleUnitRounds: 0, availableUnitRounds: 0, peakCities: 1, peakCombatUnits: 1 }])) as Record<number, SeatActivity>,
    settlerOrders: [] as number[], rounds: [] as RoundSnapshot[], round30Leader: null as number | null, reachedRound30End: false,
    knockdowns: [] as (KnockdownRecord & { round: number; seq: number })[],
    captureEvents: [] as { round: number; playerId: number; probability: number; success: boolean }[],
    versions: { schema: state.schemaVersion, rules: state.rulesVersion, content: content.version },
  };
}
export type Telemetry = ReturnType<typeof createTelemetry>;
export function collectTelemetry(data: Telemetry, before: GameState, after: GameState, command: Command, events: GameEvent[], content: Content = CONTENT): void {
  const actor = data.activity[command.actorId], action = command.action;
  actor.commands[action.type] = (actor.commands[action.type] ?? 0) + 1;
  if (action.type === 'Attack') { actor.attacks++; if (action.target.kind === 'city') actor.cityAttacks++; }
  if (action.type === 'EndTurn') {
    const units = Object.values(before.units).filter(unit => unit.ownerId === command.actorId && unit.location === 'map');
    actor.availableUnitRounds += units.length; actor.idleUnitRounds += units.filter(unit => unit.actionLeft > 0).length;
  }
  for (const { payload } of events) {
    if (payload.type === 'BattleResolved') data.knockdowns.push(...(payload.knockdowns ?? []).map(record => ({ ...record, round: before.round, seq: after.commandSeq })));
    if (payload.type === 'CityFounded') data.activity[payload.playerId].citiesFounded++;
    if (payload.type === 'Captured') {
      const seat = data.activity[payload.playerId]; seat.captureAttempts++; if (payload.success) seat.captureSuccesses++;
      data.captureEvents.push({ round: before.round, playerId: payload.playerId, probability: payload.probability, success: payload.success });
    }
    if (payload.type === 'Evolved') data.activity[payload.playerId].evolves++;
    const settlerOrder = payload.type === 'UnitTrained' && payload.unit.kind === 'logistics' ? payload.orderId
      : payload.type === 'ProductionWaiting' && payload.definitionId === 'settler' ? payload.sourceOrderId : null;
    if (settlerOrder !== null && !data.settlerOrders.includes(settlerOrder) && 'playerId' in payload) {
      data.settlerOrders.push(settlerOrder); data.activity[payload.playerId].settlersProduced++;
    }
    if (payload.type === 'RoundEnded') {
      const snapshot = roundSnapshot(after, payload.round, content); data.rounds.push(snapshot);
      for (const player of snapshot.players) {
        const seat = data.activity[player.id]; seat.peakCities = Math.max(seat.peakCities, player.cities); seat.peakCombatUnits = Math.max(seat.peakCombatUnits, player.combatUnits);
      }
      if (payload.round === 30) { data.reachedRound30End = true; data.round30Leader = uniqueScoreLeader(snapshot); }
    }
  }
}
