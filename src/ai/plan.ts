import { candyGold, classTrainingBlocker, viewBadges } from '../core/unit-classes.ts';
import { usesBuilders } from '../core/improvements.ts';
import { pickBuilderEscort, pickEscort, traderPlan, wantsTrader } from './network-plan.ts';
import { viewPillage } from '../core/pillage.ts';
import { itemBallTargets, legendTraceTargets, planLegendWonder } from './legend-plan.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import { classTrainingBonus, rosterEvolution, typeCounterBonus } from './roster-plan.ts';
import { districtCandidates } from './district-plan.ts';
import { planCivilizationAction } from '../core/civilization-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { planWorldAction } from '../core/world-systems.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { planLeaderAction } from '../core/leader-systems.ts';
import type { Command, MapUnit, PlayerView, ProductionItem } from '../core/model.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import { workRadius } from '../core/city.ts';
import { CONTENT, unitDefinition, contentForView, techOf } from '../content/units.ts';
import type { BallId, BuildingId, TechId } from '../content/economy.ts';
import { knownCities, RULE_QUERIES } from './query.ts';
import type { RuleQueries } from './query.ts';

import { rejectedCitySite } from './memory.ts';
import type { RejectedCitySite } from './memory.ts';
import { AI_THRESHOLDS } from './thresholds.ts';
import type { AiThresholds } from './thresholds.ts';

import { seekUnknownHeadquarters } from './targets.ts';
import { AI_STRATEGIES } from './strategies.ts';
import { campaignPlan, eraCivilizationPolicy, hasEraProgression } from './war-plan.ts';
import { captureRoleBonus, leaderResearchBonus, recruitResearchBonus, roleTrainingBonus, treeResearchBenefit } from './role-plan.ts';
import { trainableSpeciesIds } from '../core/role-tactics.ts';
import { designatedWorkers, improvementSuggestions, wantsBuilder } from './improvement-plan.ts';
import { usesTactics } from '../core/tactics.ts';
import { planPolicyAction } from './policy-plan.ts';
import { planEssenceAction, siteEssenceBonus } from './essence-plan.ts';
import { planEraAbilityAction } from './era-ability-plan.ts';
import { planPromotionAction } from './promotion-plan.ts';
import { planBondAction, threatenedCityIds } from './bond-plan.ts';
import { planRareBerryAction, siteRareBerryBonus } from './rare-berry-plan.ts';
import { planContestAction } from './contest-plan.ts';
import { planFaithAction } from './faith-plan.ts';
import { planDedicationAction } from './dedication-plan.ts';
import { gymMoveTargets, planGymAction } from './gym-plan.ts';
import { ownRivalHunters, rivalAttackBonus, rivalResponseTeam, rivalThreatenedCityIds, rivalTrainingBonus } from './rival-plan.ts';
import { viewIsRivalUnit } from '../core/rivals.ts';
import { planGoldSinkAction } from './gold-sink-plan.ts';
import { contestMoveTargets, planContestSeasonAction } from './contest-season-plan.ts';
import { legendRaceSwitch } from './legend-race-plan.ts';
import { escortedSettler, stackEscorts } from './escort-plan.ts';
import { planRivalDuel } from './rival-duel-plan.ts';
import { raidAttackBonus, raidMoveTargets } from './raid-plan.ts';
import { researchCaptureScore } from './research-plan.ts';
import { embarkResearchBonus, isBoarding, moverOf, nearestTravel, safeToBoard, travelCloser, travelDistance, walkerTravel } from './travel.ts';
import { canEnterTile, waterAccess } from '../core/movement.ts';
import { wanderersFor } from '../content/roster.ts';
import { featureVision, isEmbarked } from '../core/terrain.ts';
import type { Goal } from './strategies.ts';
type Candidate = { action: Command['action']; goal: Goal; benefit: number; ownId: number; targetId: number };
export const CANDIDATE_BUDGET = 256; // 32 representatives for each of eight goals, never a time budget.
export function knownCombatCount(view: PlayerView, ownerId: number): number {
  const known = new Map(Object.entries(view.knowledge.lastKnownUnits).map(([id, unit]) => [Number(id), unit]));
  for (const unit of view.units) known.set(unit.id, { ...unit, lastSeenRound: view.round });
  return [...known.values()].filter(unit => unit.ownerId === ownerId && unit.kind === 'pokemon').length;
}
export function canCaptureByPersonality(view: PlayerView, target: MapUnit, query: RuleQueries = RULE_QUERIES): boolean {
  if (target.kind !== 'pokemon' || target.ownerId !== null || viewIsRivalUnit(view, target.id)) return false;
  const strategy = AI_STRATEGIES[view.economy.player.personality], ai = query.ai ?? AI_THRESHOLDS;
  const content = query.content === CONTENT ? contentForView(view) : query.content;
  if (strategy.captureHpPercent !== null && target.hp * 100 >= content.species[target.speciesId].maxHp * ai[strategy.captureHpPercent]) return false;
  if (strategy.captureTerritoryOnly !== null && ai[strategy.captureTerritoryOnly]) {
    const tile = hexToIndex(target.position, view.map);
    return tile !== null && (view.territoryOwnerIds[tile]?.includes(view.playerId) ?? false);
  }
  return true;
}
/**
 * Whether a city may queue a settler now. Normally one settler at a time (queued, pending or on the map). `openingSites` (v24 AI only):
 * the number of known city sites; during the opening (fewer than 3 cities) settlers overlap — cities + settlers stay under 3 and every
 * settler has a known site of its own — so the third city's settler is built while the second one is still walking.
 */
export function canProduceSettler(view: PlayerView, ai: AiThresholds = AI_THRESHOLDS, opening = false, openingSites: number | null = null): boolean {
  const player = view.economy.player, cities = view.economy.cities;
  const queuedCount = cities.reduce((sum, city) => sum + [...city.queue, ...city.pendingDeployments].filter(order => order.item.kind === 'logistics' && order.item.defId === 'settler').length, 0);
  const fieldCount = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.role === 'settler').length;
  if (openingSites !== null && opening && cities.length < 3 && queuedCount + fieldCount > 0) return cities.length + queuedCount + fieldCount < 3 && openingSites > queuedCount + fieldCount;
  if (queuedCount || fieldCount) return false;
  const strategy = AI_STRATEGIES[player.personality];
  // v21 opening: every personality expands to 3 cities first.
  if (opening && cities.length < 3) return true;
  if (strategy.settlerMinCities !== null && cities.length < ai[strategy.settlerMinCities]) return false;
  if (strategy.settlerPeaceOnly && view.diplomacy.some(pair => (pair.a === view.playerId || pair.b === view.playerId) && pair.status === 'war')) return false;
  return strategy.settlerInterval === null || view.round - player.lastSettlerProducedRound >= ai[strategy.settlerInterval];
}
export function canSiege(view: PlayerView, ownerId: number | null, ai: AiThresholds = AI_THRESHOLDS): boolean {
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
  const siege = AI_STRATEGIES[view.economy.player.personality].siege;
  if (siege.kind === 'minimum') return own >= ai[siege.units];
  if (ownerId === null) return false;
  if (siege.kind === 'border') return ai[siege.enabled]
    && view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === view.playerId && pair.b === ownerId) || (pair.b === view.playerId && pair.a === ownerId)))
    && own * 1000 >= ai[siege.strength] * knownCombatCount(view, ownerId)
    && knownCities(view).some(city => city.ownerId === ownerId && view.units.some(unit => unit.ownerId === view.playerId
      && hexDistance(unit.position, city.position, view.map) <= ai[siege.distance]));
  const pair = view.diplomacy.find(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId)
    && (pair.declaredBy === ownerId || (ai[siege.allowOffensiveWar] && (pair.a === ownerId || pair.b === ownerId))));
  return !!pair && own * 1000 >= ai[siege.strength] * knownCombatCount(view, ownerId);
}
// Shared observation-only eligibility for known HQ pursuit and the optional search fallback.
export function siegeObjectives(view: PlayerView, ai: AiThresholds = AI_THRESHOLDS) {
  const strategy = AI_STRATEGIES[view.economy.player.personality];
  const enemies = view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a);
  const hqs = knownCities(view).filter(city => city.ownerId !== null && enemies.includes(city.ownerId)
    && city.headquartersOf === city.ownerId && canSiege(view, city.ownerId, ai));
  const searching = !hqs.length && strategy.seekUnknownHq !== null && ai[strategy.seekUnknownHq]
    && (strategy.siege.kind === 'minimum' ? canSiege(view, null, ai) : enemies.some(enemy => canSiege(view, enemy, ai)));
  return { hqs, searching };
}
export function planNext(view: PlayerView, query: RuleQueries = RULE_QUERIES, memory: readonly RejectedCitySite[] = []): Command {
  const actorId = view.playerId, player = view.economy.player, content = query.content === CONTENT ? contentForView(view) : query.content, ai = query.ai ?? AI_THRESHOLDS;
  const strategy = AI_STRATEGIES[player.personality], declaration = strategy.declareWar;
  const citySite = (position: MapUnit['position']) => !rejectedCitySite(memory, view, position) && query.citySite(view, position);
  const result = (action: Command['action']): Command => ({ actorId, expectedSeq: view.commandSeq, action });
  if (view.outcome || view.activePlayerId !== actorId || player.eliminated) return result({ type: 'EndTurn' });
  // v22: a pending era dedication is chosen before anything else (never left open at the end of the turn).
  const dedicationAction = planDedicationAction(view);
  if (dedicationAction) return result(dedicationAction);
  const promotionAction = planPromotionAction(view, content);
  if (promotionAction) return result(promotionAction);
  const policyAction = planPolicyAction(view);
  if (policyAction) return result(policyAction);
  const essenceAction = planEssenceAction(view, content);
  if (essenceAction) return result(essenceAction);
  const eraAction = planEraAbilityAction(view, content);
  if (eraAction) return result(eraAction);
  const bondAction = planBondAction(view);
  if (bondAction) return result(bondAction);
  const berryAction = planRareBerryAction(view);
  if (berryAction) return result(berryAction);
  const contestAction = planContestAction(view);
  if (contestAction) return result(contestAction);
  // v26 D: contest seasons and gold sinks (null before v26).
  const seasonAction = planContestSeasonAction(view, content);
  if (seasonAction) return result(seasonAction);
  const goldSinkAction = planGoldSinkAction(view, content);
  if (goldSinkAction) return result(goldSinkAction);
  const raceAction = legendRaceSwitch(view);
  if (raceAction) return result(raceAction);
  const faithAction = planFaithAction(view);
  if (faithAction) return result(faithAction);
  // v24 C: a rival's warned / attacked cities count as threatened too.
  // Rivals never strike logistics units or take a city, so their threat only moves garrisons and pauses wonders;
  // the training-ground rush and the builder pause stay for bond threats (else the opening settler waits).
  const bondThreatened = new Set(threatenedCityIds(view));
  const threatened = new Set([...bondThreatened, ...rivalThreatenedCityIds(view)]);
  const leaderAction = planLeaderAction(view, content);
  if (leaderAction) return result(leaderAction);
  const worldAction = planWorldAction(view, { base: content, world: WORLD_DEFINITIONS });
  if (worldAction) return result(worldAction);
  const civilizationAction = view.expansion
    ? planCivilizationAction(view.expansion.civilization, { ...CIVILIZATION_CONTENT, world: content }, eraCivilizationPolicy(view), view.map)
    : null;
  if (civilizationAction) return result(civilizationAction);
  // v26 P3: a rival duel (null before v26).
  const duelAction = planRivalDuel(view, content);
  if (duelAction) return result(duelAction);
  // v24 B: gym circuit and Elite Four challenges (null before v24).
  const gymAction = planGymAction(view, content);
  if (gymAction) return result(gymAction);
  const units = view.units.filter(unit => unit.ownerId === actorId).sort((a, b) => a.id - b.id);
  const combat = units.filter(unit => unit.kind === 'pokemon');
  const cities = [...view.economy.cities].sort((a, b) => a.id - b.id), known = knownCities(view);
  // Send a small team using only currently visible sanctuary information.
  const sanctuary = view.expansion?.civilization.sanctuaries
    .filter(site => site.ownerId === null || (site.ownerId === actorId && !site.guardianDefeated))
    .sort((a, b) => Number(a.ownerId !== null) - Number(b.ownerId !== null)
      || Math.min(...combat.map(unit => hexDistance(unit.position, a.position, view.map)))
        - Math.min(...combat.map(unit => hexDistance(unit.position, b.position, view.map))) || a.id.localeCompare(b.id))[0];
  const sanctuaryTeam = sanctuary ? [...combat].sort((a, b) => hexDistance(a.position, sanctuary.position, view.map)
    - hexDistance(b.position, sanctuary.position, view.map) || a.id - b.id).slice(0, 3).map(unit => unit.id) : [];
  const eraCampaign = campaignPlan(view), campaignActive = eraCampaign !== null;
  const objectives = siegeObjectives(view, ai), preparingSiege = objectives.hqs.length > 0 || objectives.searching || campaignActive;
  const captureRadius = strategy.capturePriorityRadius === null ? null : ai[strategy.capturePriorityRadius];
  const captureBonus = (target: MapUnit) => captureRadius !== null
    && cities.some(city => hexDistance(city.position, target.position, view.map) <= captureRadius) ? strategy.capturePriorityBonus : 0;
  const siegeCaptureBonus = (target: MapUnit) => preparingSiege && strategy.siegeCaptureBonus !== null
    && target.kind === 'pokemon' && content.species[target.speciesId].role === 'siege' && captureRadius !== null
    && cities.some(city => hexDistance(city.position, target.position, view.map) <= captureRadius) ? ai[strategy.siegeCaptureBonus] : 0;
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
    const relationCampaign = eraCampaign?.target.ownerId === enemy ? eraCampaign : null;
    if (pair.proposal?.recipientId === actorId) add({ type: 'RespondPeace', targetPlayerId: enemy, accept: relationCampaign === null && (strategy.peaceCitiesLost === null || lost >= ai[strategy.peaceCitiesLost]) }, 'diplomacy', 1000, actorId, enemy);
    else if (pair.status === 'war' && !pair.proposal && view.round - pair.changedAtRound >= 5
      && (pair.rejectedAtRound[actorId] === undefined || view.round - pair.rejectedAtRound[actorId] >= 5)
      && relationCampaign === null
      && (strategy.peaceCitiesLost === null || lost >= ai[strategy.peaceCitiesLost])) add({ type: 'MakePeace', targetPlayerId: enemy }, 'diplomacy', 100, actorId, enemy);
    else if (pair.status === 'peace' && !view.expansion?.civilization.relations.some(relation => relation.targetPlayerId === enemy && relation.allianceSinceRound !== null) && view.round >= pair.cooldownUntilRound && declaration !== null && (declaration.enabled === null || ai[declaration.enabled])
      && combat.length * 1000 >= knownCombatCount(view, enemy) * ai[declaration.strength]
      && known.some(city => city.ownerId === enemy && units.some(unit => hexDistance(unit.position, city.position, view.map) <= ai[declaration.borderDistance]))) {
      add({ type: 'DeclareWar', targetPlayerId: enemy }, 'diplomacy', 10, actorId, enemy);
    } else if (pair.status === 'peace' && !view.expansion?.civilization.relations.some(relation => relation.targetPlayerId === enemy && relation.allianceSinceRound !== null)
      && hasEraProgression(view) && declaration === null && player.personality === 'expansion'
      && view.round >= pair.cooldownUntilRound
      && combat.length * 1000 >= ai.expansionSiegeStrength * knownCombatCount(view, enemy)
      && known.some(city => city.ownerId === enemy && units.some(unit => hexDistance(unit.position, city.position, view.map) <= ai.expansionBorderDistance))) {
      add({ type: 'DeclareWar', targetPlayerId: enemy }, 'diplomacy', 10, actorId, enemy);
    }
  }
  if (player.research.techId === null) for (const [i, techId] of (Object.keys(content.techs) as TechId[]).entries()) {
    const unlocksLeaderUnit = view.expansion && player.leaderId && techId === 'training' && view.expansion.leaders.recruited === 0;
    if (query.research(player, techId, content)) add({ type: 'SetResearch', techId }, 'research', unlocksLeaderUnit ? 1000
      : content.techTree ? treeResearchBenefit(view, techId, content) + embarkResearchBonus(view, techId, content, citySite) + recruitResearchBonus(view, techId, content) : 100 - techOf(content, techId).cost + leaderResearchBonus(view, techId), 0, i);
  }
  // Known city sites (computed once per plan; settlers and the v24 overseas checks share the list).
  let siteCache: MapUnit['position'][] | null = null;
  const allSites = () => siteCache ??= view.map.tiles.flatMap((_, index) => citySite(indexToHex(index, view.map)) ? [indexToHex(index, view.map)] : []);
  // v24 AI (expansion): during the opening the settler is the city's first choice, whatever the personality's goal order — it is queued
  // under the personality's first goal after diplomacy, in the most productive idle city, while a known site waits for it (not in a city
  // under a bond threat). Before v24 the settler keeps the 'found' goal everywhere.
  const v24Ai = Boolean(content.terrain && view.map.features);
  const openingRush = v24Ai && Boolean(content.opening) && cities.length < 3;
  const openingSites = openingRush ? allSites().length : null;
  const settlerCity = openingRush && openingSites ? cities.filter(city => !city.queue.length && !city.pendingDeployments.length && !bondThreatened.has(city.id))
    .sort((a, b) => b.yields.production - a.yields.production || a.id - b.id)[0]?.id ?? null : null;
  // v15: one legendary wonder at a time, in the most productive eligible city that is not threatened.
  const { cityId: wonderCity, legendId: wonder } = planLegendWonder(view, threatened);
  const income = cities.reduce((sum, city) => sum + city.yields.gold, 0);
  const upkeep = [...units, ...view.recoveringUnits].reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
  for (const city of cities) {
    const work = [...new Set([...city.lockedTileIds, ...city.availableTileIds])].slice(0, city.population).sort((a, b) => a - b);
    if (work.length > city.workedTileIds.length) add({ type: 'AssignWork', cityId: city.id, workedTileIds: work, lockedTileIds: [...city.lockedTileIds] }, 'economy', 500, city.id);
    if (city.queue.length || city.pendingDeployments.length) continue;
    const queue = (item: ProductionItem, goal: Goal, benefit: number, targetId = 0) => add({ type: 'SetProductionQueue', cityId: city.id, orders: [{ item }] }, goal, benefit, city.id, targetId);
    // v24 AI: no legendary wonder or district (long builds) before the third city, so a settler never waits behind one.
    if (wonderCity === city.id && wonder && !openingRush) queue({ kind: 'legend', defId: wonder }, 'economy', 260, LEGEND_WONDERS[wonder].dex);
    const district = openingRush ? undefined : districtCandidates(view, city.id, content)[0];
    if (district) queue({ kind: 'district', defId: district.kind, tileIndex: district.tileIndex }, 'economy', district.score, district.tileIndex);
    if (canProduceSettler(view, ai, Boolean(content.opening), openingSites)) { const escortId = pickEscort(view, content); queue({ kind: 'logistics', defId: 'settler', ...(escortId ? { escortId } : {}) }, settlerCity === city.id ? strategy.priorities.find(goal => goal !== 'diplomacy')! : 'found', content.opening && cities.length < 3 ? 900 : 50); }
    // The first 工匠 early (improvements compound); later ones only after the army is fed.
    if (wantsBuilder(view) && !bondThreatened.has(city.id)) { const escortId = pickBuilderEscort(view, city.id, content); queue({ kind: 'logistics', defId: 'builder', ...(escortId ? { escortId } : {}) }, 'economy', units.some(unit => unit.kind === 'logistics' && unit.role === 'builder') ? 70 : 400); }
    if (wantsTrader(view, city.id)) { const escortId = pickEscort(view, content); queue({ kind: 'logistics', defId: 'trader', ...(escortId ? { escortId } : {}) }, 'economy', 140); }
    for (const [i, id] of (Object.keys(content.buildings) as BuildingId[]).entries()) {
      const building = content.buildings[id];
      if (building.cost === null || city.buildingIds.includes(id) || (building.requiredTech && !player.research.unlockedIds.includes(building.requiredTech))) continue;
      const y = building.yields;
      queue({ kind: 'building', defId: id }, 'economy', (y.food + y.production * 2 + y.gold * 2 + y.research * 2) * 100 - building.cost
        + (id === 'trainingGround' && bondThreatened.has(city.id) ? 1000 : 0), i);
    }
    if (combat.length < Math.max(4, cities.length * 2) && (income > upkeep || player.gold >= 80)) {
      const badges = viewBadges(view);
      for (const [i, id] of trainableSpeciesIds(player, view.gameplayVersion, content, view.eraProgression).entries()) {
        const species = content.species[id];
        if (species.role === 'fast' && !player.research.unlockedIds.includes('riding')) continue;
        if (classTrainingBlocker(view, player, view.eraProgression, badges, id, content)) continue;
        // v24 AI: never a species with no tile next to the city it could be placed on (a water species inland would block the queue forever).
        if (v24Ai && !neighbors(city.position, view.map).some(hex => { const tile = hexToIndex(hex, view.map); return tile !== null && canEnterTile({ kind: 'pokemon', speciesId: id }, view.map, tile, content); })) continue;
        queue({ kind: 'pokemon', defId: id }, 'military', species.attack + species.defense - species.trainCost
          + (preparingSiege && species.role === 'siege' && strategy.siegeTrainingBonus !== null ? ai[strategy.siegeTrainingBonus] : 0)
          + roleTrainingBonus(view, id, content, preparingSiege) + typeCounterBonus(view, id, content) + classTrainingBonus(view, id, content) + rivalTrainingBonus(view, id, content), i);
      }
    }
  }
  const wild = view.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon');
  if (cities.length && wild.some(target => canCaptureByPersonality(view, target, query) && combat.some(unit => hexDistance(unit.position, target.position, view.map) <= 2))
    && player.ballInventory.pokeBall + player.ballInventory.greatBall === 0 && player.research.unlockedIds.includes('domestication') && player.gold >= content.balls.pokeBall.goldCost) {
    add({ type: 'BuyBall', cityId: cities[0].id, ballId: 'pokeBall', quantity: 1 }, 'capture', 20, cities[0].id);
  }
  const visible = new Set(view.visibleTileIds), explored = new Set(view.knowledge.exploredTileIds);
  // v24: the polar sea rows hold nothing to find; exploring them only strands units on the ice.
  const polarRow = (tile: number) => view.map.features !== undefined && (Math.floor(tile / view.map.width) < 2 || Math.floor(tile / view.map.width) >= view.map.height - 2);
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === actorId || pair.b === actorId));
  const workers = designatedWorkers(view, content, atWar || campaignActive || preparingSiege);
  const traceTargets = legendTraceTargets(view, content), ballTargets = itemBallTargets(view), gymTargets = gymMoveTargets(view, content), rivalHunters = ownRivalHunters(view);
  // v26 D: raid dens (empty before v26).
  const raidTargets = raidMoveTargets(view), contestTargets = contestMoveTargets(view, content);
  // v24 integration fix (crowded continent): with no known site reachable over land from the capital and water access, Pokémon may board
  // to explore and stay out instead of heading home; a settler whose sites all lie across water gets the nearest Pokémon as its escort.
  const seaPlans = Boolean(content.embark && view.map.features) && waterAccess(player, content) >= 1 && cities.length > 0;
  const landSettler = { kind: 'logistics', role: 'settler' } as const;
  const crowded = seaPlans && walkerTravel(view, landSettler, cities[0].position, allSites(), content) === Infinity;
  const escortTargets = new Map<number, MapUnit['position']>();
  if (seaPlans) for (const settler of units.filter(unit => unit.kind === 'logistics' && unit.role === 'settler')) {
    const overseas = isEmbarked(settler, view.map, content)
      || (allSites().length > 0 && walkerTravel(view, settler, settler.position, allSites(), content) === Infinity && nearestTravel(view, settler, settler.position, allSites()) < Infinity);
    if (!overseas) continue;
    const escort = units.filter(unit => unit.kind === 'pokemon' && !escortTargets.has(unit.id))
      .sort((a, b) => hexDistance(a.position, settler.position, view.map) - hexDistance(b.position, settler.position, view.map) || a.id - b.id)[0];
    if (escort) escortTargets.set(escort.id, settler.position);
  }
  // v24 AI: a wild Pokémon that does not wander strikes any unit next to it at the end of the round (settlers and builders are knocked out
  // at once), and enemies at war move first (within 3); logistics units never step into that reach unless they found a city there, and step out.
  const warEnemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === actorId || pair.b === actorId)).map(pair => pair.a === actorId ? pair.b : pair.a));
  const wanderers = wanderersFor(content);
  const strikers = v24Ai ? view.units.filter(other => other.kind === 'pokemon' && (other.ownerId === null ? !wanderers.includes(other.speciesId) && !viewIsRivalUnit(view, other.id) : warEnemies.has(other.ownerId))) : [];
  const exposed = (position: MapUnit['position']) => strikers.some(other => hexDistance(other.position, position, view.map) <= (other.ownerId === null ? 1 : 3));
  // v24 AI (rival chasing): a response team — favourable matchups only, at most half of the Pokémon, none from another front (an enemy
  // at war within 3), escorts and the sanctuary team stay — goes after the own rival's Pokémon, under the personality's first of
  // economy / military so capture, garrison and gym moves do not pull it away. Empty before v24.
  const rivalGoal = strategy.priorities.find(goal => goal === 'economy' || goal === 'military')!;
  const rivalTeam = rivalResponseTeam(view, content, unit => escortTargets.has(unit.id) || sanctuaryTeam.includes(unit.id)
    || view.units.some(other => other.ownerId !== null && warEnemies.has(other.ownerId) && hexDistance(other.position, unit.position, view.map) <= 3)
    || known.some(city => city.ownerId !== null && warEnemies.has(city.ownerId) && hexDistance(city.position, unit.position, view.map) <= 3));
  // v24 AI (sea safety): a land unit on the water cannot strike back, so it never steps onto a water tile next to a striking wild Pokémon,
  // within 2 of its own rival's Pokémon or within 3 of an enemy at war (landing is always allowed), and leaves such a tile when on one.
  // v26 C2: settler escorts sharing the settler's tile (empty before v26).
  const stackEscort = stackEscorts(view, content, unit => escortTargets.has(unit.id) || sanctuaryTeam.includes(unit.id) || rivalTeam.has(unit.id));
  const wildBeside = (position: MapUnit['position']) => strikers.filter(other => other.ownerId === null && hexDistance(other.position, position, view.map) <= 1).length;
  const escortedStep = (settlerId: number, position: MapUnit['position']) => escortedSettler(stackEscort, view, settlerId) && wildBeside(position) <= 1
    && !strikers.some(other => other.ownerId !== null && hexDistance(other.position, position, view.map) <= 3);
  const ownRivals = v24Ai ? view.units.filter(other => view.expansion?.rivals?.sightings.some(sighting => sighting.unitId === other.id && sighting.targetPlayerId === actorId)) : [];
  const seaThreat = (position: MapUnit['position']) => exposed(position) || ownRivals.some(other => hexDistance(other.position, position, view.map) <= 2);
  for (const unit of units.filter(unit => unit.actionLeft)) {
    // v26 C2: an escort on its settler's tile waits until the settler has moved, then follows it.
    const escort = stackEscort.get(unit.id);
    if (escort?.joined && escort.settlerReady) continue;
    const trader = traderPlan(view, unit);
    if (trader.action) add(trader.action, 'economy', 900, unit.id);
    if (unit.kind === 'logistics' && unit.role !== 'settler') { /* traders and builders: handled by their own plans */ } else if (unit.kind === 'logistics') {
      if (citySite(unit.position)) add({ type: 'FoundCity', unitId: unit.id }, 'found', 1000, unit.id);
    } else {
      const evolution = content.roster ? rosterEvolution(view, unit, content) : content.species[unit.speciesId].evolution;
      const needsStone = view.expansion && !content.roster && WORLD_DEFINITIONS.stoneEvolutions.some(path => path.fromSpeciesId === unit.speciesId);
      // v19 Rare Candy when rich: the candy price (computed before leader discounts) is an upper bound of the real cost.
      const candy = evolution && unit.xp < evolution.xp ? candyGold(view, player, view.eraProgression, content.species[unit.speciesId].stage, evolution.gold) : null;
      if (evolution && !needsStone && (unit.xp >= evolution.xp ? player.gold >= evolution.gold : candy !== null && player.gold >= candy + 60) && (!evolution.requiresTraining || player.research.unlockedIds.includes('training'))) add({ type: 'Evolve', unitId: unit.id, intoSpeciesId: evolution.speciesId }, 'military', 200, unit.id);
      for (const target of view.units.filter(target => target.ownerId !== actorId).sort((a, b) => a.id - b.id)) {
        if (canCaptureByPersonality(view, target, query)) for (const ballId of ['pokeBall', 'greatBall'] as BallId[]) {
          const preview = query.capture(view, unit.id, target.id, ballId, content);
          if (preview.ok) add({ type: 'Capture', unitId: unit.id, targetUnitId: target.id, ballId }, 'capture', preview.probability
            + captureBonus(target) + siegeCaptureBonus(target) + (target.kind === 'pokemon' ? captureRoleBonus(view, target.speciesId, content) : 0) + researchCaptureScore(view, target), unit.id, target.id);
        }
        // v24 C: the own rival's Pokémon are worth +50 (a reward); another civilization's rival is left alone.
        const rival = rivalAttackBonus(view, target);
        const preview = query.attack(view, unit.id, { kind: 'unit', id: target.id }, content);
        if (rival !== null && preview.ok && preview.damage.min > 0 && (target.ownerId === null || !strategy.defendTerritoryOnly || canSiege(view, target.ownerId, ai)
          || cities.some(city => hexDistance(city.position, target.position, view.map) <= workRadius(city)))) add({ type: 'Attack', unitId: unit.id, target: { kind: 'unit', id: target.id } },
          // Wild-target weakening competes with capture; it is neither military training nor civilization defense.
          target.ownerId === null && !rival ? strategy.wildAttackGoal : 'military',
          preview.damage.min - preview.counter.damage + (target.ownerId !== null ? 200 : 0) + (rival ?? 0) + raidAttackBonus(view, target), unit.id, target.id);
        if (rival && rivalTeam.has(unit.id) && preview.ok && preview.damage.min > 0) add({ type: 'Attack', unitId: unit.id, target: { kind: 'unit', id: target.id } }, rivalGoal,
          400 + preview.damage.min - preview.counter.damage, unit.id, target.id);
      }
      // v23: pillage an enemy improvement the unit already stands on (attacks score higher and win).
      const pillage = viewPillage(view, unit.id);
      if (pillage) add({ type: 'PillageImprovement', unitId: unit.id }, 'military', 180 + Math.floor(pillage.reward.amount / 5), unit.id, pillage.tileIndex);
      for (const city of view.cities) if (city.ownerId !== actorId && canSiege(view, city.ownerId, ai)) {
        const preview = query.attack(view, unit.id, { kind: 'city', id: city.id }, content);
        if (preview.ok) add({ type: 'Attack', unitId: unit.id, target: { kind: 'city', id: city.id } }, 'military', 300 + preview.damage.min - preview.counter.damage + (eraCampaign?.target.id === city.id ? 200 : 0), unit.id, city.id);
      }
    }
    const paths = query.paths(view, unit.id, content);
    const lands = v24Ai && moverOf(view, unit, content).kind === 'land', atSeaThreat = lands && isEmbarked(unit, view.map, content) && seaThreat(unit.position);
    if (workers.has(unit.id)) for (const suggestion of improvementSuggestions(view, unit, content, paths)) add(suggestion.action, 'economy', suggestion.benefit, unit.id);
    const sites = unit.kind === 'logistics' && unit.role === 'settler' ? allSites() : [];
    // v24: a settler with a site reachable over land walks there (it never waits at the shore for a sea route it may not take).
    const settlerLand = seaPlans && sites.length > 0 && walkerTravel(view, unit, unit.position, sites, content) < Infinity;
    const siteTravel = (from: MapUnit['position']) => settlerLand ? walkerTravel(view, unit, from, sites, content) : nearestTravel(view, unit, from, sites);
    // v24 A2: progress is measured on the unit's travel field (water, peaks, hills); before v24 it is the straight hex distance.
    const far = (from: MapUnit['position'], target: MapUnit['position']) => travelDistance(view, unit, from, target);
    const targetHq = eraCampaign?.target ?? [...objectives.hqs].sort((a, b) => far(unit.position, a.position) - far(unit.position, b.position) || a.id - b.id)[0];
    const seek = unit.kind === 'pokemon' && objectives.searching ? seekUnknownHeadquarters(view, unit, paths) : null;
    // v24 A2: a unit left on the water with nothing better to do heads back to the nearest own city (lowest goal, so any real target wins).
    const homes = isEmbarked(unit, view.map, content) && !crowded && !escortTargets.has(unit.id) ? cities.map(city => city.position) : [], homeBefore = homes.length ? nearestTravel(view, unit, unit.position, homes) : Infinity;
    for (const [indexText, path] of Object.entries(paths)) {
      // A visible route cannot hit a hidden first-step blocker and be rejected.
      if (!path.every(position => visible.has(hexToIndex(position, view.map)!))) continue;
      const index = Number(indexText), to = indexToHex(index, view.map), action = { type: 'Move' as const, unitId: unit.id, to };
      // v24 A2: board only when it is safe (no sea threat nearby, escorted), and never just to look around.
      const boarding = isBoarding(view, unit, to, content);
      if (boarding && !safeToBoard(view, unit, to, content)) continue;
      if (unit.kind === 'logistics' && strikers.length && exposed(to) && !(unit.role === 'settler' && (citySite(to) || escortedStep(unit.id, to)))) continue;
      if (escort) {
        const before = hexDistance(unit.position, escort.position, view.map), after = hexDistance(to, escort.position, view.map);
        if (after === 0) add(action, 'found', 95, unit.id, index);
        else if (after < before) add(action, 'found', 50 - after, unit.id, index);
        continue;
      }
      if (lands && view.map.tiles[index] === 'ocean' && seaThreat(to)) continue;
      if (atSeaThreat) add(action, rivalGoal, 200, unit.id, index);
      if (unit.kind === 'logistics' && strikers.length && exposed(unit.position)) add(action, unit.role === 'settler' ? 'found' : 'economy', 200, unit.id, index);
      if (trader.destination && far(to, trader.destination) < far(unit.position, trader.destination)) add(action, 'economy', 110 - far(to, trader.destination), unit.id, index);
      if (unit.kind === 'logistics' && sites.length) {
        const before = siteTravel(unit.position), after = siteTravel(to);
        const ring = view.map.tiles.filter((_, tile) => hexDistance(indexToHex(tile, view.map), to, view.map) <= 2);
        const ringTiles = new Set(view.map.tiles.flatMap((_, tile) => hexDistance(indexToHex(tile, view.map), to, view.map) <= 2 ? [tile] : []));
        if (after < before) add(action, 'found', 100 - after + (citySite(to) ? siteEssenceBonus(view, content, ring) + siteRareBerryBonus(view, ringTiles) : 0), unit.id, index);
      } else if ((unit.kind === 'pokemon' || !usesBuilders(view)) && targetHq && far(to, targetHq.position) < far(unit.position, targetHq.position)) {
        add(action, 'military', 100 - far(to, targetHq.position), unit.id, index);
      }
      const trace = traceTargets.get(unit.id);
      if (trace && far(to, trace) < far(unit.position, trace)) add(action, 'explore', 120 - far(to, trace), unit.id, index);
      const ball = ballTargets.get(unit.id);
      if (ball && far(to, ball) < far(unit.position, ball)) add(action, 'explore', 125 - far(to, ball), unit.id, index);
      const gym = gymTargets.get(unit.id);
      if (gym && travelCloser(view, unit, to, gym)) add(action, 'military', 90 - travelDistance(view, unit, to, gym), unit.id, index);
      const hall = contestTargets.get(unit.id);
      if (hall && travelCloser(view, unit, to, hall)) add(action, 'economy', 95 - travelDistance(view, unit, to, hall), unit.id, index);
      const raid = raidTargets.get(unit.id);
      if (raid && travelCloser(view, unit, to, raid)) add(action, 'military', 80 - travelDistance(view, unit, to, raid), unit.id, index);
      if (seek && far(to, seek) < far(unit.position, seek)) {
        add(action, 'military', 100 - far(to, seek), unit.id, index);
      }
      if (unit.kind === 'pokemon' && threatened.size && !atWar) {
        const city = view.economy.cities.filter(item => threatened.has(item.id)).sort((a, b) => far(unit.position, a.position) - far(unit.position, b.position) || a.id - b.id)[0];
        const garrisoned = city && view.units.some(other => other.ownerId === actorId && other.id !== unit.id && hexDistance(other.position, city.position, view.map) <= 1);
        if (city && !garrisoned && far(to, city.position) < far(unit.position, city.position)) add(action, 'economy', 90 - far(to, city.position), unit.id, index);
      }
      if (sanctuary && sanctuaryTeam.includes(unit.id)) {
        const before = far(unit.position, sanctuary.position), after = far(to, sanctuary.position);
        const holdsSite = combat.some(other => other.id !== unit.id && hexDistance(other.position, sanctuary.position, view.map) === 0);
        if (after < before && (!holdsSite || before > 2)) add(action, 'military', 90 - after, unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of view.units.filter(target => target.ownerId !== null && target.ownerId !== actorId)) {
        const war = view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === actorId && pair.b === target.ownerId) || (pair.b === actorId && pair.a === target.ownerId)));
        const defensive = cities.some(city => hexDistance(city.position, target.position, view.map) <= workRadius(city));
        if (war && (!strategy.defendTerritoryOnly || defensive || canSiege(view, target.ownerId, ai))
          && far(to, target.position) < far(unit.position, target.position)) add(action, 'military', 150 - far(to, target.position)
            + (usesTactics(view) && hexDistance(to, target.position, view.map) === 1 ? 5 * units.filter(own => own.id !== unit.id && hexDistance(own.position, target.position, view.map) === 1).length : 0), unit.id, index);
      }
      // v24: escort a settler bound across water (stay next to it; it boards once an escort is within 2).
      const escorted = escortTargets.get(unit.id);
      if (escorted && hexDistance(unit.position, escorted, view.map) > 1 && hexDistance(to, escorted, view.map) < hexDistance(unit.position, escorted, view.map)) {
        add(action, 'found', 60 - hexDistance(to, escorted, view.map), unit.id, index);
      }
      const chase = rivalTeam.get(unit.id);
      if (chase && travelCloser(view, unit, to, chase.position)) add(action, rivalGoal, 150 - travelDistance(view, unit, to, chase.position), unit.id, index);
      // v24 C: close in on the own rival's Pokémon near own cities (they only hunt this civilization).
      if (unit.kind === 'pokemon') for (const hunter of rivalHunters) {
        if (travelCloser(view, unit, to, hunter.position)) add(action, 'military', 140 - travelDistance(view, unit, to, hunter.position), unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of wild) {
        if (!canCaptureByPersonality(view, target, query) || !player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall + player.ballInventory.greatBall === 0) continue;
        const distance = far(to, target.position);
        if (distance < far(unit.position, target.position)) add(action, 'capture', 10 - distance
          + captureBonus(target) + siegeCaptureBonus(target) + (target.kind === 'pokemon' ? captureRoleBonus(view, target.speciesId, content) : 0), unit.id, index);
      }
      const radius = unitDefinition(unit, content).vision + (view.map.tiles[index] === 'mountain' ? 1 : 0) + featureVision(view.map, index);
      const gain = view.map.tiles.reduce((sum, _, tile) => sum + (!explored.has(tile) && !polarRow(tile) && hexDistance(to, indexToHex(tile, view.map), view.map) <= radius ? 1 : 0), 0);
      if (gain > 0 && (!boarding || crowded)) add(action, 'explore', gain, unit.id, index);
      if (homes.length) { const home = nearestTravel(view, unit, to, homes); if (home < homeBefore) add(action, 'explore', 60 - home, unit.id, index); }
    }
  }
  add({ type: 'EndTurn' }, 'end');
  const priority = strategy.priorities;
  const selected = [...candidates.values()].flat().sort((a, b) => priority.indexOf(a.goal) - priority.indexOf(b.goal)
    // Buying the missing ball is preparation and costs no unit action; do it before weakening the target.
    || (a.goal === 'capture' && b.goal === 'capture' ? Number(b.action.type === 'BuyBall') - Number(a.action.type === 'BuyBall') : 0)
    || b.benefit - a.benefit || stable(a, b))[0];
  return result(selected.action);
}
