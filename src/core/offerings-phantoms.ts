// Shrine offerings, phantom summoning, phantom activation, and pending production consumption.
import type { CivilizationContent, PhantomCategory } from '../content/civilization-systems.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { contentFor, techOf } from '../content/units.ts';
import { civilization, isPokemon, ownedCity } from './civilization-model.ts';
import type { CivilizationAction, CivilizationEvent, CivilizationHost, CivilizationPlayerState, CivilizationView } from './civilization-model.ts';
import type { EventPayload } from './model.ts';

type OfferingOrPhantomAction = Extract<CivilizationAction, { type: 'MakeOffering' | 'SummonPhantom' | 'ActivatePhantom' }>;

export function phantomCost(player: CivilizationPlayerState, content: CivilizationContent): number {
  return content.phantoms.firstSummonCost + content.phantoms.summonCostStep * player.summonedPhantomIds.length;
}

function choosePhantomName(state: CivilizationHost, playerId: number, category: PhantomCategory, content: CivilizationContent): string {
  const definition = content.phantoms.definitions.find(candidate => candidate.id === category)!;
  const used = new Set(Object.values(state.expansion?.civilization?.players ?? {}).flatMap(player => Object.entries(player.phantomNameLedger))
    .filter(([id]) => id === category).map(([, name]) => name));
  const available = definition.names.filter(name => !used.has(name));
  const pool = available.length ? available : definition.names;
  const offset = stableSeed(state.setup.seed, playerId, category, 'name') % pool.length;
  return pool[offset]!;
}

function validatePhantomActivation(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'ActivatePhantom' }>, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const player = civilizationState.players[actorId];
  if (!player?.activePhantoms.includes(action.phantomId)) return 'phantom-unavailable';
  if (action.phantomId === 'scientist') return state.players[actorId].research.techId === null ? 'research-unselected' : null;
  if (action.phantomId === 'engineer' || action.phantomId === 'artist') {
    if (action.cityId === undefined) return 'city-required';
    return ownedCity(state, actorId, action.cityId) ? null : 'city-unavailable';
  }
  if (action.phantomId === 'general') {
    const ids = action.unitIds ?? [];
    if (ids.length < 1 || ids.length > content.phantoms.maximumGeneralUnits) return 'invalid-team';
    if (new Set(ids).size !== ids.length) return 'invalid-team';
    return ids.every(id => isPokemon(state.units[id]) && state.units[id]!.ownerId === actorId) ? null : 'unit-unavailable';
  }
  return null;
}

export function validateOfferingOrPhantom(state: CivilizationHost, actorId: number, action: OfferingOrPhantomAction, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const player = state.players[actorId];
  const expansionPlayer = civilizationState.players[actorId];
  if (action.type === 'MakeOffering') {
    const city = ownedCity(state, actorId, action.cityId);
    if (!city) return 'city-unavailable';
    // Gameplay v9: a type gym or contest hall in this city also acts as a shrine for offerings.
    const shrine = state.expansion?.essences?.gyms[action.cityId] !== undefined
      || state.expansion?.contests?.[actorId]?.halls.includes(action.cityId);
    if (!shrine && !civilizationState.sanctuaries.some(site => site.ownerId === actorId)) return 'sanctuary-not-owned';
    if (expansionPlayer.offeredThisRoundByCity[action.cityId]) return 'offering-already-made';
    if (action.resource === 'food') return city.food >= content.offering.foodCost ? null : 'insufficient-food';
    return player.gold >= content.offering.goldCost ? null : 'insufficient-gold';
  }
  if (action.type === 'SummonPhantom') {
    if (!content.phantoms.definitions.some(definition => definition.id === action.category)) return 'phantom-unavailable';
    if (expansionPlayer.summonedPhantomIds.includes(action.category) || expansionPlayer.hallOfFame.includes(action.category)) return 'phantom-already-summoned';
    return expansionPlayer.offeringPoints >= phantomCost(expansionPlayer, content) ? null : 'insufficient-offering';
  }
  return validatePhantomActivation(state, actorId, action, content);
}

function activateResearchPhantom(state: CivilizationHost, actorId: number, phantomId: string, content: CivilizationContent): CivilizationEvent[] {
  const player = state.players[actorId];
  const techId = player.research.techId!;
  const progress = player.research.progressByTech[techId] + player.research.reserve + content.phantoms.researchBonus;
  // v22: the tree's own costs (the civilization pack's `world` table only knows the 12 older techs).
  const cost = techOf(player.research.tree ? contentFor(state.setup) : content.world, techId).cost;
  player.research.progressByTech[techId] = Math.min(progress, cost);
  const events: CivilizationEvent[] = [{ type: 'PhantomActivated', playerId: actorId, phantomId, name: state.expansion!.civilization.players[actorId].phantomNameLedger[phantomId] ?? phantomId, techId, amount: content.phantoms.researchBonus }];
  if (progress >= cost) {
    if (!player.research.unlockedIds.includes(techId)) player.research.unlockedIds.push(techId);
    player.research.unlockedIds.sort();
    player.research.reserve = progress - cost;
    player.research.techId = null;
    events.push({ type: 'PhantomResearchCompleted', playerId: actorId, phantomId, techId });
  } else player.research.reserve = 0;
  return events;
}

export function applyOfferingOrPhantom(state: CivilizationHost, actorId: number, action: OfferingOrPhantomAction, content: CivilizationContent): EventPayload[] {
  const civilizationState = civilization(state)!;
  const player = civilizationState.players[actorId];
  const events: EventPayload[] = [];
  if (action.type === 'MakeOffering') {
    const city = state.cities[action.cityId]!;
    if (action.resource === 'food') city.food -= content.offering.foodCost;
    else state.players[actorId].gold -= content.offering.goldCost;
    player.offeringPoints += content.offering.points;
    player.lifetimeOfferings += content.offering.points;
    player.offeredThisRoundByCity[action.cityId] = action.resource;
    events.push({ type: 'OfferingMade', playerId: actorId, cityId: action.cityId, resource: action.resource, points: content.offering.points });
  } else if (action.type === 'SummonPhantom') {
    const cost = phantomCost(player, content);
    const phantomName = choosePhantomName(state, actorId, action.category, content);
    player.offeringPoints -= cost;
    player.nextPhantomCost = phantomCost({ ...player, summonedPhantomIds: [...player.summonedPhantomIds, action.category] }, content);
    player.summonedPhantomIds.push(action.category);
    player.phantomNameLedger[action.category] = phantomName;
    player.activePhantoms.push(action.category);
    events.push({ type: 'PhantomSummoned', playerId: actorId, phantomId: action.category, name: phantomName, cost, offeringPointsAfter: player.offeringPoints });
  } else {
    if (action.phantomId === 'scientist') events.push(...activateResearchPhantom(state, actorId, action.phantomId, content));
    else if (action.phantomId === 'engineer') {
      const previous = civilizationState.pendingProductionByCity[action.cityId!];
      civilizationState.pendingProductionByCity[action.cityId!] = { playerId: actorId,
        amount: (previous?.playerId === actorId ? previous.amount : 0) + content.phantoms.productionBonus };
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, cityId: action.cityId, amount: content.phantoms.productionBonus });
    } else if (action.phantomId === 'merchant') {
      state.players[actorId].gold += content.phantoms.goldBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, amount: content.phantoms.goldBonus });
    } else if (action.phantomId === 'general') {
      for (const unitId of action.unitIds ?? []) state.units[unitId]!.xp += content.phantoms.experienceBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, unitIds: action.unitIds, amount: content.phantoms.experienceBonus });
    } else {
      state.cities[action.cityId!]!.food += content.phantoms.foodBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, cityId: action.cityId, amount: content.phantoms.foodBonus });
    }
    player.activePhantoms = player.activePhantoms.filter(id => id !== action.phantomId);
    player.hallOfFame.push(action.phantomId);
    player.hallOfFame.sort();
  }
  return events;
}

export function consumeCivilizationProduction(state: CivilizationHost, cityId: number): number {
  const civilizationState = civilization(state);
  if (!civilizationState) return 0;
  const pending = civilizationState.pendingProductionByCity[cityId];
  if (!pending) return 0;
  const city = state.cities[cityId];
  if (!city || city.ownerId !== pending.playerId || state.players[pending.playerId]?.eliminated) {
    delete civilizationState.pendingProductionByCity[cityId];
    return 0;
  }
  if (city.capturedAtRound === state.round) return 0;
  const order = city.queue[0];
  if (!order) return 0;
  order.progress += pending.amount;
  delete civilizationState.pendingProductionByCity[cityId];
  return pending.amount;
}

export function planOfferingOrPhantom(view: CivilizationView, content: CivilizationContent): CivilizationAction | null {
  const own = view.planning;
  const summoned = new Set([...view.player.summonedPhantomIds, ...view.player.hallOfFame]);
  const allPhantomsSummoned = content.phantoms.definitions.every(definition => summoned.has(definition.id));
  const offeringCity = own.cities.find(city => city.food >= content.offering.foodCost
      && view.player.offeredThisRoundByCity[city.id] === undefined)
    ?? own.cities.find(city => own.gold >= content.offering.goldCost + 100
      && view.player.offeredThisRoundByCity[city.id] === undefined);
  if (own.canOffer && !allPhantomsSummoned && offeringCity) {
    return {
      type: 'MakeOffering',
      cityId: offeringCity.id,
      resource: offeringCity.food >= content.offering.foodCost ? 'food' : 'gold',
    };
  }
  const category = content.phantoms.definitions.map(definition => definition.id).find(id => !summoned.has(id));
  if (category && view.player.offeringPoints >= content.phantoms.firstSummonCost
    + content.phantoms.summonCostStep * view.player.summonedPhantomIds.length) return { type: 'SummonPhantom', category };
  const active = view.player.activePhantoms[0];
  if (active === 'scientist' && own.activeResearchTechId !== null) return { type: 'ActivatePhantom', phantomId: active };
  if (active === 'engineer') {
    const city = own.cities.find(candidate => candidate.hasProduction);
    if (city) return { type: 'ActivatePhantom', phantomId: active, cityId: city.id };
  }
  if (active === 'merchant') return { type: 'ActivatePhantom', phantomId: active };
  if (active === 'general') {
    const units = own.units.slice(0, content.phantoms.maximumGeneralUnits);
    if (units.length) return { type: 'ActivatePhantom', phantomId: active, unitIds: units.map(unit => unit.id) };
  }
  if (active === 'artist') {
    const city = own.cities[0];
    if (city) return { type: 'ActivatePhantom', phantomId: active, cityId: city.id };
  }
  return null;
}
