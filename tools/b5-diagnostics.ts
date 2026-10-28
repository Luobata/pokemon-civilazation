/** B5 replay diagnostics. Reads each MatchResult with its manifest patch; never reruns the planner. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { step } from '../src/core/step.ts';
import { observe } from '../src/core/vision.ts';
import { hexDistance } from '../src/core/hex.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import { unitDefinition } from '../src/content/units.ts';
import { knownCombatCount, siegeObjectives } from '../src/ai/plan.ts';
import { knownCities, RULE_QUERIES } from '../src/ai/query.ts';
import { seekUnknownHeadquarters } from '../src/ai/targets.ts';
import { parsePatch } from './patch.ts';
import { distribution } from './balance-diagnostics.ts';
import { PERSONALITIES } from './matches.ts';
import type { GameState } from '../src/core/model.ts';
import type { MatchResult } from './simulate.ts';

type War = 'offensive' | 'defensive' | 'neutral';
type Category = 'siege-tech' | 'siege-no-tech' | 'other-tech' | 'other-no-tech';
const categories: Category[] = ['siege-tech', 'siege-no-tech', 'other-tech', 'other-no-tech'];
function seatRows(game: MatchResult, state: GameState) {
  return Object.values(state.players).map(player => ({
      game: game.id, mode: game.mode, playerId: player.id, personality: player.personality,
      eligibleDeclarationPairs: 0, enabledDeclarationPairs: 0, declarations: [] as { round: number; seq: number; target: number }[],
      firstCombat3: game.telemetry.rounds.find(round => round.players.some(p => p.id === player.id && p.combatUnits >= 3))?.round ?? null,
      firstCombat4: game.telemetry.rounds.find(round => round.players.some(p => p.id === player.id && p.combatUnits >= 4))?.round ?? null,
      firstCityAttack: null as number | null, firstEnemyCapture: null as number | null,
      wars: Object.fromEntries((['offensive', 'defensive', 'neutral'] as War[]).map(kind => [kind, {
        started: 0, firstWar: null as number | null, attacks: 0, captures: 0, hqs: 0, firstAttack: null as number | null, firstHq: null as number | null,
      }])),
      hqs: [] as { round: number; seq: number; cityId: number; previousOwner: number; war: War }[],
      postHqCityAttacks: 0, postHqEnemyHqAttacks: 0, postHqTurns: 0, postHqNoKnownTargetTurns: 0,
      repeatedCaptures: 0, recaptureAttacks: 0, attacksPerCapture: [] as number[],
      finalCities: 0, finalTechs: 0, finalUpkeep: 0, finalPopulation: 0, finalScore: 0,
      searchDecisions: 0, searchMoves: 0, firstSearchMove: null as number | null, firstSearchSeq: null as number | null,
      firstKnownHq: null as number | null, firstKnownHqAfterDeclaration: null as number | null,
      firstCityAttackAfterDeclaration: null as number | null, firstHqAttack: null as number | null, hqAttacks: 0,
      siege2000: 0, siege1500: 0, knownHq2000: 0, knownHq1500: 0, siege1500Only: 0,
      declarationDistance1: 0, declarationDistance5: 0, peaceSettlers: 0,
      siegeRegistered: [] as string[], siegeTrained: 0, siegeTrainingOrders: 0,
      siegeCaptureAttempts: 0, siegeCaptureSuccesses: 0, siegeUnitAttacks: 0, siegeCityAttacks: 0,
      siegeTechCityAttacks: 0, hasSiegeTech: false, registeredAndTech: false,
      firstRegistration: null as number | null, firstTraining: null as number | null,
      firstSiegeUnitAttack: null as number | null, firstSiegeCityAttack: null as number | null,
      firstSiegeTechCityAttack: null as number | null,
      settlersProduced: game.telemetry.activity[player.id].settlersProduced,
      wonConquest: game.kind === 'conquest' && game.winners.includes(player.id),
    }));
}
export function diagnoseB5(directory: string) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const { content, ai } = parsePatch(manifest.patch ?? {});
  const allSeats: ReturnType<typeof seatRows> = [], captures = [], games = [];
  const attacksByCategory = Object.fromEntries(categories.map(category => [category, { damage: [] as number[], segmentAttacks: [] as number[] }]));
  let replayedCommands = 0;
  for (const name of readdirSync(resolve(directory, 'games')).filter(name => name.endsWith('.json')).sort()) {
    const game = JSON.parse(readFileSync(resolve(directory, 'games', name), 'utf8')) as MatchResult;
    if (game.defect || game.aborted || !game.outcome) throw new Error('Diagnostics require completed, defect-free games: ' + name);
    let state = createGame(game.setup, content);
    const rows = seatRows(game, state);
    const completedOrders = new Set<number>();
    const attackRuns = new Map<string, Category[]>(), captureCounts = new Map<number, number>();
    const ownershipHistory = new Map(Object.values(state.cities).map(city => [city.id, new Set(city.ownerId === null ? [] : [city.ownerId])]));
    for (const command of game.commands) {
      const row = rows.find(row => row.playerId === command.actorId)!;
      if (row.personality === 'conservative' || (row.hqs.length && command.action.type === 'EndTurn')) {
        const view = observe(state, command.actorId, content), cities = knownCities(view);
        if (row.personality === 'conservative') {
          const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
          for (const pair of view.diplomacy) {
            if (pair.status !== 'peace' || view.round < pair.cooldownUntilRound || (pair.a !== view.playerId && pair.b !== view.playerId)) continue;
            const enemy = pair.a === view.playerId ? pair.b : pair.a;
            if (view.civilizations.find(civ => civ.id === enemy)?.eliminated) continue;
            if (own * 1000 >= knownCombatCount(view, enemy) * ai.conservativeDeclareStrength
              && cities.some(city => city.ownerId === enemy && view.units.some(unit => unit.ownerId === view.playerId
                && hexDistance(unit.position, city.position) <= ai.conservativeBorderDistance))) {
              row.eligibleDeclarationPairs++;
              if (ai.conservativeMayDeclareWar) row.enabledDeclarationPairs++;
            }
          }
        }
        if (row.hqs.length && command.action.type === 'EndTurn') {
          row.postHqTurns++;
          const target = cities.some(city => city.ownerId !== null && city.ownerId !== view.playerId && city.headquartersOf === city.ownerId
            && view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === view.playerId && pair.b === city.ownerId) || (pair.b === view.playerId && pair.a === city.ownerId))));
          if (!target) row.postHqNoKnownTargetTurns++;
        }
      }
      if (command.action.type === 'DeclareWar') {
        const targetPlayerId = command.action.targetPlayerId;
        row.declarations.push({ round: state.round, seq: state.commandSeq, target: targetPlayerId });
        row.wars.offensive.started++; row.wars.offensive.firstWar ??= state.round;
        const recipient = rows.find(seat => seat.playerId === targetPlayerId)!;
        recipient.wars.defensive.started++; recipient.wars.defensive.firstWar ??= state.round;
      }
      const view = observe(state, command.actorId, content), objectives = siegeObjectives(view, ai);
      const warEnemies = view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
        .map(pair => pair.a === view.playerId ? pair.b : pair.a);
      const knownHqs = knownCities(view).filter(city => city.ownerId !== null && warEnemies.includes(city.ownerId) && city.headquartersOf === city.ownerId);
      if (knownHqs.length) {
        row.firstKnownHq ??= state.round;
        if (row.declarations.length && row.declarations[0].seq < state.commandSeq) row.firstKnownHqAfterDeclaration ??= state.round;
      }
      if (objectives.searching) {
        row.searchDecisions++;
        if (command.action.type === 'Move') {
          const unitId = command.action.unitId, unit = view.units.find(unit => unit.id === unitId);
          if (unit?.kind === 'pokemon') {
            const target = seekUnknownHeadquarters(view, unit, RULE_QUERIES.paths(view, unit.id, content));
            if (target && hexDistance(command.action.to, target) < hexDistance(unit.position, target)) {
              row.searchMoves++; row.firstSearchMove ??= state.round; row.firstSearchSeq ??= state.commandSeq;
            }
          }
        }
      }
      if (row.personality === 'conservative') {
        const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
        const enough = (enemy: number, threshold: number) => own * 1000 >= knownCombatCount(view, enemy) * threshold;
        const exposure2000 = warEnemies.some(enemy => enough(enemy, 2000)), exposure1500 = warEnemies.some(enemy => enough(enemy, 1500));
        if (exposure2000) row.siege2000++;
        if (exposure1500) row.siege1500++;
        if (exposure1500 && !exposure2000) row.siege1500Only++;
        if (knownHqs.some(city => enough(city.ownerId!, 2000))) row.knownHq2000++;
        if (knownHqs.some(city => enough(city.ownerId!, 1500))) row.knownHq1500++;
        for (const distance of [1, 5]) {
          const eligible = view.diplomacy.some(pair => {
            if (pair.status !== 'peace' || view.round < pair.cooldownUntilRound || (pair.a !== view.playerId && pair.b !== view.playerId)) return false;
            const enemy = pair.a === view.playerId ? pair.b : pair.a;
            return !view.civilizations.find(civ => civ.id === enemy)?.eliminated && enough(enemy, 2000)
              && knownCities(view).some(city => city.ownerId === enemy && view.units.some(unit => unit.ownerId === view.playerId
                && hexDistance(unit.position, city.position) <= distance));
          });
          if (eligible) { if (distance === 1) row.declarationDistance1++; else row.declarationDistance5++; }
        }
      }
      if (command.action.type === 'SetProductionQueue') row.siegeTrainingOrders += command.action.orders.filter(order => !order.orderId
        && order.item.kind === 'pokemon' && content.species[order.item.defId].role === 'siege').length;
      const next = step(state, command, content);
      if (!next.ok) throw new Error(game.id + '/' + state.commandSeq + ': ' + next.reason);
      for (const { payload } of next.events) {
        if (payload.type === 'Captured') {
          const target = state.units[payload.targetUnitId];
          if (target?.kind === 'pokemon' && content.species[target.speciesId].role === 'siege') {
            const seat = rows.find(seat => seat.playerId === payload.playerId)!;
            seat.siegeCaptureAttempts++; if (payload.success) seat.siegeCaptureSuccesses++;
          }
        }
        const production = payload.type === 'UnitTrained' ? { order: payload.orderId, player: payload.playerId,
          species: payload.unit.kind === 'pokemon' ? payload.unit.speciesId : null, settler: payload.unit.kind === 'logistics' }
          : payload.type === 'ProductionWaiting' ? { order: payload.sourceOrderId, player: payload.playerId,
            species: payload.definitionId, settler: payload.definitionId === 'settler' } : null;
        if (production && !completedOrders.has(production.order)) {
          completedOrders.add(production.order);
          const seat = rows.find(seat => seat.playerId === production.player)!;
          if (Object.entries(content.species).some(([id, species]) => id === production.species && species.role === 'siege')) {
            seat.siegeTrained++; seat.firstTraining ??= state.round;
          }
          if (production.settler && !state.diplomacy.some(pair => pair.status === 'war' && (pair.a === seat.playerId || pair.b === seat.playerId))) seat.peaceSettlers++;
        }
        if (payload.type === 'BattleResolved') {
          const attacker = state.units[payload.attackerId];
          if (command.action.type === 'Attack' && attacker?.kind === 'pokemon' && attacker.ownerId === row.playerId
            && content.species[attacker.speciesId].role === 'siege') {
            if (payload.target.kind === 'unit') { row.siegeUnitAttacks++; row.firstSiegeUnitAttack ??= state.round; }
            else {
              row.siegeCityAttacks++; row.firstSiegeCityAttack ??= state.round;
              if (state.players[row.playerId].research.unlockedIds.includes('siegeCraft')) {
                row.siegeTechCityAttacks++; row.firstSiegeTechCityAttack ??= state.round;
              }
            }
          }
        }
        if (payload.type !== 'BattleResolved' || payload.target.kind !== 'city') continue;
        const city = state.cities[payload.target.id], owner = city.ownerId;
        const pair = state.diplomacy.find(pair => (pair.a === row.playerId && pair.b === owner) || (pair.b === row.playerId && pair.a === owner));
        const war: War = owner === null ? 'neutral' : pair?.declaredBy === row.playerId ? 'offensive' : 'defensive';
        const headquarters = owner !== null && state.players[owner].headquartersCityId === city.id;
        if (headquarters) { row.hqAttacks++; row.firstHqAttack ??= state.round; }
        if (row.declarations.length) row.firstCityAttackAfterDeclaration ??= state.round;
        const actor = state.units[payload.attackerId];
        if (actor.kind !== 'pokemon') throw new Error('City attacker must be a Pokemon');
        const role = content.species[actor.speciesId].role === 'siege' ? 'siege' : 'other';
        const technology = state.players[row.playerId].research.unlockedIds.includes('siegeCraft');
        const category = (role + (technology ? '-tech' : '-no-tech')) as Category;
        const key = row.playerId + ':' + city.id, segment = attackRuns.get(key) ?? [];
        segment.push(category); attackRuns.set(key, segment);
        attacksByCategory[category].damage.push(payload.damage);
        row.firstCityAttack ??= state.round;
        row.wars[war].attacks++; row.wars[war].firstAttack ??= state.round;
        if (row.hqs.length) {
          row.postHqCityAttacks++;
          if (headquarters) row.postHqEnemyHqAttacks++;
        }
        if (ownershipHistory.get(city.id)?.has(row.playerId)) row.recaptureAttacks++;
        if (payload.capturedCity) {
          row.wars[war].captures++; row.attacksPerCapture.push(segment.length);
          for (const cat of categories) {
            const n = segment.filter(value => value === cat).length;
            if (n) attacksByCategory[cat].segmentAttacks.push(n);
          }
          if (owner !== null) row.firstEnemyCapture ??= state.round;
          const previousCaptures = captureCounts.get(city.id) ?? 0;
          if (previousCaptures) row.repeatedCaptures++;
          captureCounts.set(city.id, previousCaptures + 1);
          captures.push({ game: game.id, mode: game.mode, playerId: row.playerId, personality: row.personality,
            round: state.round, seq: state.commandSeq, cityId: city.id, previousOwner: owner, headquarters, war,
            repeated: previousCaptures > 0, attacks: segment.length });
          if (headquarters) {
            row.hqs.push({ round: state.round, seq: state.commandSeq, cityId: city.id, previousOwner: owner!, war });
            row.wars[war].hqs++; row.wars[war].firstHq ??= state.round;
          }
        }
      }
      for (const city of Object.values(next.state.cities)) {
        const owners = ownershipHistory.get(city.id) ?? new Set<number>();
        if (city.ownerId !== null) owners.add(city.ownerId);
        ownershipHistory.set(city.id, owners);
        if (state.cities[city.id] && state.cities[city.id].ownerId !== city.ownerId) for (const seat of rows) attackRuns.delete(seat.playerId + ':' + city.id);
      }
      for (const seat of rows) {
        const player = next.state.players[seat.playerId];
        for (const id of player.registeredSpeciesIds) if (content.species[id].role === 'siege' && !seat.siegeRegistered.includes(id)) {
          seat.siegeRegistered.push(id); seat.firstRegistration ??= state.round;
        }
        seat.hasSiegeTech ||= player.research.unlockedIds.includes('siegeCraft');
        seat.registeredAndTech ||= seat.hasSiegeTech && seat.siegeRegistered.length > 0;
      }
      state = next.state; replayedCommands++;
    }
    if (canonicalSerialize(state.outcome) !== canonicalSerialize(game.outcome)) throw new Error('Outcome mismatch: ' + game.id);
    for (const row of rows) {
      const score = state.outcome!.ranking.find(score => score.playerId === row.playerId)!;
      row.finalCities = score.cities; row.finalTechs = score.techs; row.finalPopulation = score.population; row.finalScore = score.total;
      row.finalUpkeep = Object.values(state.units).filter(unit => unit.ownerId === row.playerId).reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
    }
    allSeats.push(...rows);
    games.push({ id: game.id, mode: game.mode, kind: game.kind, round: game.round, personalities: game.personalities, winners: game.winners });
  }
  const groups = ['all', '1v1', '1v3'].map(mode => ({ mode, personalities: PERSONALITIES.map(personality => {
    const seats = allSeats.filter(seat => seat.personality === personality && (mode === 'all' || seat.mode === mode));
    const captors = seats.filter(seat => seat.hqs.length), postTurns = captors.filter(seat => seat.postHqTurns);
    const sum = (key: 'eligibleDeclarationPairs' | 'enabledDeclarationPairs' | 'postHqCityAttacks' | 'postHqEnemyHqAttacks' | 'repeatedCaptures' | 'recaptureAttacks' | 'settlersProduced') => seats.reduce((n, seat) => n + seat[key], 0);
    return { personality, seats: seats.length, eligibleDeclarationPairs: sum('eligibleDeclarationPairs'), enabledDeclarationPairs: sum('enabledDeclarationPairs'),
      declarations: seats.reduce((n, seat) => n + seat.declarations.length, 0),
      firstDeclaration: distribution(seats.flatMap(seat => seat.declarations.length ? [seat.declarations[0].round] : [])),
      firstCombat3: distribution(seats.flatMap(seat => seat.firstCombat3 === null ? [] : [seat.firstCombat3])),
      firstCombat4: distribution(seats.flatMap(seat => seat.firstCombat4 === null ? [] : [seat.firstCombat4])),
      firstCityAttack: distribution(seats.flatMap(seat => seat.firstCityAttack === null ? [] : [seat.firstCityAttack])),
      firstEnemyCapture: distribution(seats.flatMap(seat => seat.firstEnemyCapture === null ? [] : [seat.firstEnemyCapture])),
      firstHq: distribution(captors.map(seat => seat.hqs[0].round)),
      hqCounts: [1, 2, 3].map(n => captors.filter(seat => seat.hqs.length >= n).length),
      hqGaps: [1, 2].map(n => distribution(captors.flatMap(seat => seat.hqs.length > n ? [seat.hqs[n].round - seat.hqs[n - 1].round] : []))),
      conquestCaptors: captors.filter(seat => seat.wonConquest).length,
      noSubsequentHqAttack: captors.filter(seat => !seat.postHqEnemyHqAttacks).length,
      noSubsequentHqAttackNonConquest: captors.filter(seat => !seat.postHqEnemyHqAttacks && !seat.wonConquest).length,
      postTurnObservedSeats: postTurns.length,
      neverKnownFollowupHq: postTurns.filter(seat => seat.postHqNoKnownTargetTurns === seat.postHqTurns).length,
      everNoKnownFollowupHq: postTurns.filter(seat => seat.postHqNoKnownTargetTurns > 0).length,
      postHqCityAttacks: sum('postHqCityAttacks'), postHqEnemyHqAttacks: sum('postHqEnemyHqAttacks'),
      repeatedCaptures: sum('repeatedCaptures'), recaptureAttacks: sum('recaptureAttacks'),
      attacksPerCapture: distribution(seats.flatMap(seat => seat.attacksPerCapture)),
      cities: distribution(seats.map(seat => seat.finalCities)), techs: distribution(seats.map(seat => seat.finalTechs)),
      upkeep: distribution(seats.map(seat => seat.finalUpkeep)), settlersProduced: sum('settlersProduced'),
      wars: Object.fromEntries((['offensive', 'defensive', 'neutral'] as War[]).map(war => [war, {
        started: seats.reduce((n, seat) => n + seat.wars[war].started, 0),
        firstWar: distribution(seats.flatMap(seat => seat.wars[war].firstWar === null ? [] : [seat.wars[war].firstWar!])),
        attacks: seats.reduce((n, seat) => n + seat.wars[war].attacks, 0),
        captures: seats.reduce((n, seat) => n + seat.wars[war].captures, 0), hqs: seats.reduce((n, seat) => n + seat.wars[war].hqs, 0),
        firstAttack: distribution(seats.flatMap(seat => seat.wars[war].firstAttack === null ? [] : [seat.wars[war].firstAttack!])),
        firstHq: distribution(seats.flatMap(seat => seat.wars[war].firstHq === null ? [] : [seat.wars[war].firstHq!])),
      }])) };
  }) }));
  return { source: resolve(directory), patch: manifest.patch ?? null, games, replayedCommands, seats: allSeats, captures, groups,
    cityAttackCategories: Object.fromEntries(categories.map(category => [category, {
      damage: distribution(attacksByCategory[category].damage), segmentAttacks: distribution(attacksByCategory[category].segmentAttacks),
    }])) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node tools/b5-diagnostics.ts <run-directory> <output.json>');
  const data = diagnoseB5(process.argv[2]);
  writeFileSync(process.argv[3], JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ games: data.games.length, replayedCommands: data.replayedCommands }));
}
