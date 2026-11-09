import { classTrainingBlocker, stateBadges } from './unit-classes.ts';
import { foundCityOnResource, usesBuilders } from './improvements.ts';
import { applyEscortBonus } from './city-network.ts';
import { CITY_NETWORK_RULES } from '../content/city-network.ts';
import { legendWonderBlocker } from './legends.ts';
import { districtBlocker, districtInput, releaseDistrictWorkers } from './districts.ts';
import { visibleTiles } from './vision.ts';
import { ballPrice, playerPolicyEffects } from './policies.ts';
import { trainableSpeciesIds } from './role-tactics.ts';
import { isMapUnit } from './model.ts';
import { CONTENT, contentFor, techOf } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { assignNewWorkers, cleanWork, createCity, workCandidates } from './city.ts';
import type { EconomyAction, EconomyEvent, GameState, PlayerState, StepResult } from './model.ts';

type Rejection = Extract<StepResult, { ok: false }>['reason'];
export function canResearch(player: PlayerState, techId: TechId, content: Content = CONTENT): boolean {
  if (!Object.hasOwn(content.techs, techId) || player.research.unlockedIds.includes(techId)) return false;
  // v22 tree: every listed prerequisite must be complete. Older contents: any tech of the previous tier.
  if (content.techTree) return (techOf(content, techId).requires ?? []).every(id => player.research.unlockedIds.includes(id));
  const tier = techOf(content, techId).tier;
  return tier === 1 || player.research.unlockedIds.some(id => techOf(content, id).tier === tier - 1);
}
export function validateEconomyAction(state: GameState, actor: number, action: EconomyAction, content: Content = contentFor(state.setup)): Rejection | null {
  const player = state.players[actor];
  if (action.type === 'FoundCity') {
    const unit = state.units[action.unitId];
    if (!unit || unit.ownerId !== actor || unit.kind !== 'logistics' || unit.role !== 'settler' || !isMapUnit(unit)) return 'unit-unavailable';
    if (!unit.actionLeft) return 'no-action';
    if (state.map.tiles[hexToIndex(unit.position, state.map)!] === 'ocean'
      || Object.values(state.cities).some(city => hexDistance(city.position, unit.position, state.map) < 4)) return 'invalid-city-site';
    return null;
  }
  if (action.type === 'SetResearch') return canResearch(player, action.techId, content) ? null : 'research-unavailable';
  const city = state.cities[action.cityId];
  if (!city || city.ownerId !== actor) return 'city-unavailable';
  if (action.type === 'BuyBall') {
    if (!Object.hasOwn(content.balls, action.ballId) || !Number.isSafeInteger(action.quantity) || action.quantity < 1) return 'purchase-unavailable';
    const ball = content.balls[action.ballId], cost = ballPrice(ball.goldCost, playerPolicyEffects(state, actor).ballDiscount) * action.quantity;
    return player.research.unlockedIds.includes('domestication') && player.research.unlockedIds.includes(ball.requiredTech)
      && Number.isSafeInteger(cost) && player.gold >= cost
      && Number.isSafeInteger(player.ballInventory[action.ballId] + action.quantity) ? null : 'purchase-unavailable';
  }
  if (action.type === 'AssignWork') {
    const valid = new Set(workCandidates(state, city, content));
    return action.workedTileIds.length <= city.population
      && new Set(action.workedTileIds).size === action.workedTileIds.length
      && new Set(action.lockedTileIds).size === action.lockedTileIds.length
      && action.workedTileIds.every(id => valid.has(id))
      && action.lockedTileIds.every(id => action.workedTileIds.includes(id)) ? null : 'invalid-work';
  }
  if (action.orders.length > 5) return 'invalid-production';
  const used = new Set<number>(), buildings = new Set(city.buildingIds);
  for (const [index, order] of action.orders.entries()) {
    const item = order.item;
    if (order.orderId !== undefined) {
      const previous = city.queue.find(entry => entry.id === order.orderId);
      if (!previous || used.has(order.orderId) || previous.item.kind !== item.kind || previous.item.defId !== item.defId
        || (previous.item.kind === 'district' && item.kind === 'district' && previous.item.tileIndex !== item.tileIndex)) return 'invalid-production';
      used.add(order.orderId);
    }
    if (item.kind === 'district') {
      if (!state.expansion?.districts) return 'invalid-production';
      if (order.orderId === undefined) {
        const queue = action.orders.flatMap((other, otherIndex) => otherIndex === index ? [] : [{ id: other.orderId ?? -otherIndex - 1, progress: 0, item: other.item }]);
        const reason = districtBlocker(districtInput(state, actor, visibleTiles(state, actor, content), { cityId: city.id, queue }), city.id, item.defId, item.tileIndex);
        if (reason) return reason === 'contested-territory' ? reason : 'invalid-production';
      }
    } else if (item.kind === 'legend') {
      if (!state.expansion?.legends || action.orders.filter(other => other.item.kind === 'legend' && other.item.defId === item.defId).length > 1) return 'invalid-production';
      if (order.orderId === undefined && legendWonderBlocker(state, city, item.defId) !== null) return 'invalid-production';
    } else if (item.kind === 'building') {
      const def = content.buildings[item.defId];
      if (!Object.hasOwn(content.buildings, item.defId) || def.cost === null || buildings.has(item.defId)
        || (def.requiredTech && !player.research.unlockedIds.includes(def.requiredTech))) return 'invalid-production';
      buildings.add(item.defId);
    } else if (item.kind === 'pokemon') {
      if (!trainableSpeciesIds(player, state.setup.gameplayVersion, content, state.setup.eraProgression).includes(item.defId) || !Object.hasOwn(content.units, item.defId)) return 'invalid-production';
      if (content.species[item.defId].role === 'fast' && !player.research.unlockedIds.includes('riding')) return 'invalid-production';
      if (order.orderId === undefined && classTrainingBlocker(state, player, state.setup.eraProgression, stateBadges(state, actor), item.defId, content)) return 'invalid-production';
    } else if (item.kind !== 'logistics' || (item.defId !== 'settler' && item.defId !== 'trader' && item.defId !== 'builder')) return 'invalid-production';
    // v23: a builder may take an escort (registered species); its type becomes the builder's crew specialty.
    else if (item.defId === 'builder' ? !usesBuilders(state) || (item.escortId !== undefined && (!content.builderCrews || !player.registeredSpeciesIds.includes(item.escortId))) : false) return 'invalid-production';
    else if (!state.expansion?.cityNetwork ? item.defId !== 'settler' || item.escortId !== undefined
      : (item.escortId !== undefined && !player.registeredSpeciesIds.includes(item.escortId))
        || (item.defId === 'trader' && !city.buildingIds.includes(CITY_NETWORK_RULES.trader.building))) return 'invalid-production';
  }
  return null;
}
export function applyEconomyAction(state: GameState, actor: number, action: EconomyAction, content: Content = contentFor(state.setup)): EconomyEvent[] {
  const player = state.players[actor];
  if (action.type === 'FoundCity') {
    const unit = state.units[action.unitId], id = state.nextEntityId++;
    if (!isMapUnit(unit)) throw new Error('Expected deployed settler');
    const city = createCity(id, actor, unit.position, false, content); state.cities[id] = city; delete state.units[unit.id];
    for (const existing of Object.values(state.cities)) cleanWork(state, existing, content);
    assignNewWorkers(state, city, city.population, content);
    return [{ type: 'CityFounded', playerId: actor, cityId: id, unitId: unit.id, position: { ...city.position } },
      ...applyEscortBonus(state, actor, city, unit.kind === 'logistics' ? unit.escortId : undefined, content) as EconomyEvent[],
      ...foundCityOnResource(state, actor, city.position) as EconomyEvent[]];
  }
  if (action.type === 'SetResearch') {
    player.research.techId = action.techId;
    return [{ type: 'ResearchSelected', playerId: actor, techId: action.techId }];
  }
  const city = state.cities[action.cityId];
  if (action.type === 'SetProductionQueue') {
    city.queue = action.orders.map(order => order.orderId === undefined
      ? { id: state.nextEntityId++, progress: 0, item: { ...order.item } }
      : city.queue.find(existing => existing.id === order.orderId)!);
    releaseDistrictWorkers(state, city.id);
    return [{ type: 'ProductionQueueChanged', playerId: actor, cityId: city.id, orders: JSON.parse(JSON.stringify(city.queue)) }];
  }
  if (action.type === 'AssignWork') {
    city.workedTileIds = [...action.workedTileIds].sort((a, b) => a - b);
    city.lockedTileIds = [...action.lockedTileIds].sort((a, b) => a - b);
    return [{ type: 'WorkAssigned', playerId: actor, cityId: city.id, workedTileIds: [...city.workedTileIds], lockedTileIds: [...city.lockedTileIds] }];
  }
  const goldBefore = player.gold, inventoryBefore = player.ballInventory[action.ballId];
  player.gold -= ballPrice(content.balls[action.ballId].goldCost, playerPolicyEffects(state, actor).ballDiscount) * action.quantity;
  player.ballInventory[action.ballId] += action.quantity;
  return [{ type: 'BallsPurchased', playerId: actor, cityId: city.id, ballId: action.ballId, quantity: action.quantity,
    goldBefore, goldAfter: player.gold, inventoryBefore, inventoryAfter: player.ballInventory[action.ballId] }];
}
