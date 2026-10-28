import type { AiPersonality, Command, MapUnit, PlayerView, ProductionItem } from '../core/model.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import { workRadius } from '../core/city.ts';
import { unitDefinition } from '../content/units.ts';
import type { BallId, BuildingId, TechId } from '../content/economy.ts';
import { knownCities, RULE_QUERIES } from './query.ts';
import type { RuleQueries } from './query.ts';

import { AI_THRESHOLDS } from './thresholds.ts';
import type { AiThresholds } from './thresholds.ts';

type Goal = 'diplomacy' | 'found' | 'economy' | 'capture' | 'military' | 'research' | 'explore' | 'end';
type Candidate = { action: Command['action']; goal: Goal; benefit: number; ownId: number; targetId: number };
const PRIORITIES: Record<AiPersonality, Goal[]> = {
  expansion: ['diplomacy', 'found', 'economy', 'capture', 'military', 'research', 'explore', 'end'],
  aggressive: ['diplomacy', 'military', 'capture', 'found', 'research', 'economy', 'explore', 'end'],
  conservative: ['diplomacy', 'research', 'economy', 'military', 'capture', 'found', 'explore', 'end'],
};
export const CANDIDATE_BUDGET = 256; // 32 representatives for each of eight goals, never a time budget.
export function knownCombatCount(view: PlayerView, ownerId: number): number {
  const known = new Map(Object.entries(view.knowledge.lastKnownUnits).map(([id, unit]) => [Number(id), unit]));
  for (const unit of view.units) known.set(unit.id, { ...unit, lastSeenRound: view.round });
  return [...known.values()].filter(unit => unit.ownerId === ownerId && unit.kind === 'pokemon').length;
}
export function canCaptureByPersonality(view: PlayerView, target: MapUnit, query: RuleQueries = RULE_QUERIES): boolean {
  if (target.kind !== 'pokemon' || target.ownerId !== null) return false;
  if (view.economy.player.personality === 'expansion') return target.hp * 100 < query.content.species[target.speciesId].maxHp * (query.ai ?? AI_THRESHOLDS).expansionCaptureHpPercent;
  if (view.economy.player.personality === 'conservative') {
    const tile = hexToIndex(target.position, view.map);
    return tile !== null && (view.territoryOwnerIds[tile]?.includes(view.playerId) ?? false);
  }
  return true;
}
export function canProduceSettler(view: PlayerView, ai: AiThresholds = AI_THRESHOLDS): boolean {
  const player = view.economy.player, cities = view.economy.cities;
  const queued = cities.some(city => [...city.queue, ...city.pendingDeployments].some(order => order.item.kind === 'logistics'));
  if (queued || view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'logistics')) return false;
  if (player.personality === 'aggressive') return cities.length >= ai.aggressiveSettlerCities;
  if (player.personality === 'conservative') return !view.diplomacy.some(pair => (pair.a === view.playerId || pair.b === view.playerId) && pair.status === 'war')
    && view.round - player.lastSettlerProducedRound >= ai.conservativeSettlerInterval;
  return true;
}
export function canSiege(view: PlayerView, ownerId: number | null, ai: AiThresholds = AI_THRESHOLDS): boolean {
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
  if (view.economy.player.personality === 'expansion') return false;
  if (view.economy.player.personality === 'aggressive') return own >= ai.aggressiveSiegeUnits;
  if (ownerId === null) return false;
  const pair = view.diplomacy.find(pair => pair.status === 'war' && pair.declaredBy === ownerId && (pair.a === view.playerId || pair.b === view.playerId));
  return !!pair && own * 1000 >= ai.conservativeStrength * knownCombatCount(view, ownerId);
}
export function planNext(view: PlayerView, query: RuleQueries = RULE_QUERIES): Command {
  const actorId = view.playerId, player = view.economy.player, content = query.content, ai = query.ai ?? AI_THRESHOLDS;
  const result = (action: Command['action']): Command => ({ actorId, expectedSeq: view.commandSeq, action });
  if (view.outcome || view.activePlayerId !== actorId || player.eliminated) return result({ type: 'EndTurn' });
  const units = view.units.filter(unit => unit.ownerId === actorId).sort((a, b) => a.id - b.id);
  const combat = units.filter(unit => unit.kind === 'pokemon');
  const cities = [...view.economy.cities].sort((a, b) => a.id - b.id), known = knownCities(view);
  const candidates = new Map<Goal, Candidate[]>();
  const stable = (a: Candidate, b: Candidate) => (a.action.type < b.action.type ? -1 : a.action.type > b.action.type ? 1 : 0)
    || a.ownId - b.ownId || a.targetId - b.targetId;
  function add(action: Command['action'], goal: Goal, benefit = 0, ownId = 0, targetId = 0) {
    const group = candidates.get(goal) ?? [];
    if (group.length >= CANDIDATE_BUDGET / 8) return;
    group.push({ action, goal, benefit, ownId, targetId });
    group.sort((a, b) => b.benefit - a.benefit || stable(a, b));
    candidates.set(goal, group);
  }
  for (const pair of view.diplomacy) {
    if (pair.a !== actorId && pair.b !== actorId) continue;
    const enemy = pair.a === actorId ? pair.b : pair.a;
    if (view.civilizations.find(civ => civ.id === enemy)?.eliminated) continue;
    const lost = pair.citiesLostSinceWar[actorId] ?? 0;
    if (pair.proposal?.recipientId === actorId) add({ type: 'RespondPeace', targetPlayerId: enemy, accept: player.personality === 'conservative' || lost >= ai.peaceCitiesLost }, 'diplomacy', 1000, actorId, enemy);
    else if (pair.status === 'war' && !pair.proposal && view.round - pair.changedAtRound >= 5
      && (pair.rejectedAtRound[actorId] === undefined || view.round - pair.rejectedAtRound[actorId] >= 5)
      && (lost >= ai.peaceCitiesLost || player.personality === 'conservative')) add({ type: 'MakePeace', targetPlayerId: enemy }, 'diplomacy', 100, actorId, enemy);
    else if (pair.status === 'peace' && view.round >= pair.cooldownUntilRound && player.personality === 'aggressive'
      && combat.length * 1000 >= knownCombatCount(view, enemy) * ai.aggressiveWarStrength
      && known.some(city => city.ownerId === enemy && units.some(unit => hexDistance(unit.position, city.position) <= ai.aggressiveBorderDistance))) {
      add({ type: 'DeclareWar', targetPlayerId: enemy }, 'diplomacy', 10, actorId, enemy);
    }
  }
  if (player.research.techId === null) for (const [i, techId] of (Object.keys(content.techs) as TechId[]).entries()) {
    if (query.research(player, techId, content)) add({ type: 'SetResearch', techId }, 'research', 100 - content.techs[techId].cost, 0, i);
  }
  const income = cities.reduce((sum, city) => sum + city.yields.gold, 0);
  const upkeep = [...units, ...view.recoveringUnits].reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
  for (const city of cities) {
    const work = [...new Set([...city.lockedTileIds, ...city.availableTileIds])].slice(0, city.population).sort((a, b) => a - b);
    if (work.length > city.workedTileIds.length) add({ type: 'AssignWork', cityId: city.id, workedTileIds: work, lockedTileIds: [...city.lockedTileIds] }, 'economy', 500, city.id);
    if (city.queue.length || city.pendingDeployments.length) continue;
    const queue = (item: ProductionItem, goal: Goal, benefit: number, targetId = 0) => add({ type: 'SetProductionQueue', cityId: city.id, orders: [{ item }] }, goal, benefit, city.id, targetId);
    if (canProduceSettler(view, ai)) queue({ kind: 'logistics', defId: 'settler' }, 'found', 50);
    for (const [i, id] of (Object.keys(content.buildings) as BuildingId[]).entries()) {
      const building = content.buildings[id];
      if (building.cost === null || city.buildingIds.includes(id) || (building.requiredTech && !player.research.unlockedIds.includes(building.requiredTech))) continue;
      const y = building.yields;
      queue({ kind: 'building', defId: id }, 'economy', (y.food + y.production * 2 + y.gold * 2 + y.research * 2) * 100 - building.cost, i);
    }
    if (combat.length < Math.max(4, cities.length * 2) && (income > upkeep || player.gold >= 80)) {
      for (const [i, id] of [...player.registeredSpeciesIds].sort().entries()) {
        const species = content.species[id];
        if (species.role === 'fast' && !player.research.unlockedIds.includes('riding')) continue;
        queue({ kind: 'pokemon', defId: id }, 'military', species.attack + species.defense - species.trainCost, i);
      }
    }
  }
  const wild = view.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon');
  if (cities.length && wild.some(target => canCaptureByPersonality(view, target, query) && combat.some(unit => hexDistance(unit.position, target.position) <= 2))
    && player.ballInventory.pokeBall + player.ballInventory.greatBall === 0 && player.research.unlockedIds.includes('domestication') && player.gold >= content.balls.pokeBall.goldCost) {
    add({ type: 'BuyBall', cityId: cities[0].id, ballId: 'pokeBall', quantity: 1 }, 'capture', 20, cities[0].id);
  }
  const visible = new Set(view.visibleTileIds), explored = new Set(view.knowledge.exploredTileIds);
  for (const unit of units.filter(unit => unit.actionLeft)) {
    if (unit.kind === 'logistics') {
      if (query.citySite(view, unit.position)) add({ type: 'FoundCity', unitId: unit.id }, 'found', 1000, unit.id);
    } else {
      const evolution = content.species[unit.speciesId].evolution;
      if (evolution && unit.xp >= evolution.xp && player.gold >= evolution.gold && (!evolution.requiresTraining || player.research.unlockedIds.includes('training'))) add({ type: 'Evolve', unitId: unit.id, intoSpeciesId: evolution.speciesId }, 'military', 200, unit.id);
      for (const target of view.units.filter(target => target.ownerId !== actorId).sort((a, b) => a.id - b.id)) {
        if (canCaptureByPersonality(view, target, query)) for (const ballId of ['pokeBall', 'greatBall'] as BallId[]) {
          const preview = query.capture(view, unit.id, target.id, ballId, content);
          if (preview.ok) add({ type: 'Capture', unitId: unit.id, targetUnitId: target.id, ballId }, 'capture', preview.probability
            + (player.personality === 'aggressive' && cities.some(city => hexDistance(city.position, target.position) <= ai.aggressiveCaptureRadius) ? 100 : 0), unit.id, target.id);
        }
        const preview = query.attack(view, unit.id, { kind: 'unit', id: target.id }, content);
        if (preview.ok && preview.damage.min > 0 && (target.ownerId === null || player.personality !== 'conservative' || canSiege(view, target.ownerId, ai)
          || cities.some(city => hexDistance(city.position, target.position) <= workRadius(city)))) add({ type: 'Attack', unitId: unit.id, target: { kind: 'unit', id: target.id } },
          // Wild-target weakening competes with capture; it is neither military training nor civilization defense.
          target.ownerId === null && player.personality !== 'expansion' ? 'capture' : 'military',
          preview.damage.min - preview.counter.damage + (target.ownerId !== null ? 200 : 0), unit.id, target.id);
      }
      for (const city of view.cities) if (city.ownerId !== actorId && canSiege(view, city.ownerId, ai)) {
        const preview = query.attack(view, unit.id, { kind: 'city', id: city.id }, content);
        if (preview.ok) add({ type: 'Attack', unitId: unit.id, target: { kind: 'city', id: city.id } }, 'military', 300 + preview.damage.min - preview.counter.damage, unit.id, city.id);
      }
    }
    const paths = query.paths(view, unit.id, content);
    const sites = unit.kind === 'logistics' ? view.map.tiles.flatMap((_, index) => query.citySite(view, indexToHex(index, view.map)) ? [indexToHex(index, view.map)] : []) : [];
    const enemyHqs = known.filter(city => city.ownerId !== null && city.ownerId !== actorId && city.headquartersOf === city.ownerId && canSiege(view, city.ownerId, ai)
      && view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === actorId && pair.b === city.ownerId) || (pair.b === actorId && pair.a === city.ownerId))));
    const targetHq = enemyHqs.sort((a, b) => hexDistance(unit.position, a.position) - hexDistance(unit.position, b.position) || a.id - b.id)[0];
    for (const [indexText, path] of Object.entries(paths)) {
      // A visible route cannot hit a hidden first-step blocker and be rejected.
      if (!path.every(position => visible.has(hexToIndex(position, view.map)!))) continue;
      const index = Number(indexText), to = indexToHex(index, view.map), action = { type: 'Move' as const, unitId: unit.id, to };
      if (unit.kind === 'logistics' && sites.length) {
        const before = Math.min(...sites.map(site => hexDistance(unit.position, site))), after = Math.min(...sites.map(site => hexDistance(to, site)));
        if (after < before) add(action, 'found', 100 - after, unit.id, index);
      } else if (targetHq && hexDistance(to, targetHq.position) < hexDistance(unit.position, targetHq.position)) {
        add(action, 'military', 100 - hexDistance(to, targetHq.position), unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of view.units.filter(target => target.ownerId !== null && target.ownerId !== actorId)) {
        const war = view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === actorId && pair.b === target.ownerId) || (pair.b === actorId && pair.a === target.ownerId)));
        const defensive = cities.some(city => hexDistance(city.position, target.position) <= workRadius(city));
        if (war && (player.personality !== 'conservative' || defensive || canSiege(view, target.ownerId, ai))
          && hexDistance(to, target.position) < hexDistance(unit.position, target.position)) add(action, 'military', 150 - hexDistance(to, target.position), unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of wild) {
        if (!canCaptureByPersonality(view, target, query) || !player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall + player.ballInventory.greatBall === 0) continue;
        const distance = hexDistance(to, target.position);
        if (distance < hexDistance(unit.position, target.position)) add(action, 'capture', 10 - distance
          + (player.personality === 'aggressive' && cities.some(city => hexDistance(city.position, target.position) <= ai.aggressiveCaptureRadius) ? 100 : 0), unit.id, index);
      }
      const radius = unitDefinition(unit, content).vision + (view.map.tiles[index] === 'mountain' ? 1 : 0);
      const gain = view.map.tiles.reduce((sum, _, tile) => sum + (!explored.has(tile) && hexDistance(to, indexToHex(tile, view.map)) <= radius ? 1 : 0), 0);
      if (gain > 0) add(action, 'explore', gain, unit.id, index);
    }
  }
  add({ type: 'EndTurn' }, 'end');
  const priority = PRIORITIES[player.personality];
  const selected = [...candidates.values()].flat().sort((a, b) => priority.indexOf(a.goal) - priority.indexOf(b.goal)
    // Buying the missing ball is preparation and costs no unit action; do it before weakening the target.
    || (a.goal === 'capture' && b.goal === 'capture' ? Number(b.action.type === 'BuyBall') - Number(a.action.type === 'BuyBall') : 0)
    || b.benefit - a.benefit || stable(a, b))[0];
  return result(selected.action);
}
