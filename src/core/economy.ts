import { doctrineEffects } from './leader-doctrines.ts';
import { consumeCivilizationProduction } from './civilization-systems.ts';
import { createMapUnit, registerSpecies } from './unit.ts';
import { isMapUnit } from './model.ts';
import { EXPANSION_CONTENT, CONTENT, unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexToIndex, neighbors } from './hex.ts';
import { canEnter } from './movement.ts';
import { assignNewWorkers, cityYield, cleanWork, growthThreshold, productionCost, releaseWorker } from './city.ts';
import type { CityState, EconomyEvent, GameState, PendingDeployment } from './model.ts';

function deploy(state: GameState, city: CityState, pending: PendingDeployment, content: Content, events: EconomyEvent[]): boolean {
  if (city.ownerId === null) return false;
  const identity: UnitIdentity = pending.item.kind === 'pokemon'
    ? { kind: 'pokemon', speciesId: pending.item.defId } : { kind: 'logistics', role: 'settler' };
  const occupied = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)]
    .map(entity => hexToIndex(entity.position, state.map)));
  const position = neighbors(city.position).filter(hex => {
    const index = hexToIndex(hex, state.map);
    return index !== null && !occupied.has(index) && canEnter(identity, state.map.tiles[index], content);
  }).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
  if (!position) return false;
  const id = state.nextEntityId++;
  const xp = city.buildingIds.reduce((total, building) => total + content.buildings[building].trainedXp, 0)
    + doctrineEffects(state.players[city.ownerId], state.setup.eraProgression, identity, content).trainedXpBonus;
  state.units[id] = createMapUnit(identity, id, city.ownerId, position, content, xp);
  registerSpecies(state.players[city.ownerId], state.units[id]);
  events.push({ type: 'UnitTrained', playerId: city.ownerId, cityId: city.id, orderId: pending.sourceOrderId,
    unit: JSON.parse(JSON.stringify(state.units[id])) });
  return true;
}
// Only the implemented M2 stages. The snapshot fixes their shared input (D30).
export function resolveEconomy(state: GameState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): EconomyEvent[] {
  const events: EconomyEvent[] = [];
  const allCities = Object.values(state.cities).filter((city): city is CityState & { ownerId: number } => city.ownerId !== null).sort((a, b) => a.id - b.id);
  for (const city of allCities) cleanWork(state, city, content);
  const cities = allCities.filter(city => city.capturedAtRound !== state.round);
  const output = new Map(cities.map(city => [city.id, cityYield(state, city, content)]));
  // 1: food, with at most one population change per city.
  for (const city of cities) {
    const foodBefore = city.food, populationBefore = city.population;
    city.food += output.get(city.id)!.food - 2 * city.population;
    if (city.food < 0) {
      city.food = 0;
      if (city.population > 1) { city.population--; releaseWorker(state, city, content); cleanWork(state, city, content); }
    } else if (city.food >= growthThreshold(city)) {
      city.food -= growthThreshold(city); city.population++;
      assignNewWorkers(state, city, 1, content);
    }
    events.push({ type: 'CityFoodSettled', playerId: city.ownerId, cityId: city.id, foodBefore, foodAfter: city.food,
      populationBefore, populationAfter: city.population });
  }
  // 2: retry old waiting records before producing at most one new order per city.
  for (const city of cities) {
    city.pendingDeployments.sort((a, b) => a.enteredAtRound - b.enteredAtRound || a.sourceOrderId - b.sourceOrderId);
    city.pendingDeployments = city.pendingDeployments.filter(pending => !deploy(state, city, pending, content, events));
    const order = city.queue[0];
    if (!order) continue;
    consumeCivilizationProduction(state, city.id);
    order.progress += output.get(city.id)!.production;
    const cost = productionCost(order.item, content);
    if (order.progress < cost) continue;
    if (order.item.kind === 'logistics') state.players[city.ownerId].lastSettlerProducedRound = state.round;
    const overflow = order.progress - cost;
    city.queue.shift();
    if (city.queue[0]) city.queue[0].progress += overflow;
    if (order.item.kind === 'building') {
      city.buildingIds.push(order.item.defId); city.buildingIds.sort(); city.hp += content.balance.city.buildingHp;
      events.push({ type: 'BuildingCompleted', playerId: city.ownerId, cityId: city.id, orderId: order.id,
        definitionId: order.item.defId, cost, overflow });
    } else {
      const pending = { enteredAtRound: state.round, sourceOrderId: order.id, item: { ...order.item } };
      if (!deploy(state, city, pending, content, events)) {
        city.pendingDeployments.push(pending);
        events.push({ type: 'ProductionWaiting', playerId: city.ownerId, cityId: city.id,
          enteredAtRound: pending.enteredAtRound, sourceOrderId: order.id, definitionId: order.item.defId });
      }
    }
  }
  // 3: newly deployed units already pay upkeep; waiting orders are not units.
  for (const player of Object.values(state.players).filter(player => !player.eliminated).sort((a, b) => a.id - b.id)) {
    const goldBefore = player.gold;
    const income = cities.filter(city => city.ownerId === player.id).reduce((sum, city) => sum + output.get(city.id)!.gold, 0);
    const units = Object.values(state.units).filter(unit => unit.ownerId === player.id)
      .sort((a, b) => unitDefinition(b, content).upkeep - unitDefinition(a, content).upkeep || b.id - a.id);
    const upkeep = units.reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
    let refundedUpkeep = 0;
    player.gold += income - upkeep;
    for (const unit of units) {
      if (player.gold >= 0) break;
      const cost = unitDefinition(unit, content).upkeep;
      if (!cost) continue;
      delete state.units[unit.id]; player.gold += cost; refundedUpkeep += cost;
      events.push({ type: 'UnitRemoved', playerId: player.id, unitId: unit.id, reason: 'deficitDisbanded' });
    }
    events.push({ type: 'GoldSettled', playerId: player.id, income, upkeep, refundedUpkeep, goldBefore, goldAfter: player.gold });
  }
  // 4: research reserve carries forward; one selected topic can complete per round.
  for (const player of Object.values(state.players).filter(player => !player.eliminated).sort((a, b) => a.id - b.id)) {
    const science = cities.filter(city => city.ownerId === player.id).reduce((sum, city) => sum + output.get(city.id)!.research, 0);
    const research = player.research, techId = research.techId;
    if (techId === null) research.reserve += science;
    else {
      const progress = research.progressByTech[techId] + research.reserve + science;
      const cost = content.techs[techId].cost;
      research.progressByTech[techId] = Math.min(progress, cost); research.reserve = Math.max(0, progress - cost);
      if (progress >= cost) {
        research.unlockedIds.push(techId); research.unlockedIds.sort(); research.techId = null;
        events.push({ type: 'TechCompleted', playerId: player.id, techId });
      }
    }
    events.push({ type: 'ResearchProgressed', playerId: player.id, techId,
      progress: techId === null ? 0 : research.progressByTech[techId], reserve: research.reserve });
  }
  return events;
}
