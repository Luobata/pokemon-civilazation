import { candyGold, classTrainingBlocker, viewBadges } from '../core/unit-classes.ts';
import { usesBuilders } from '../core/improvements.ts';
import { pickEscort, traderPlan, wantsTrader } from './network-plan.ts';
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
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
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
import { leaderResearchBonus, roleCaptureBonus, roleTrainingBonus, treeResearchBenefit } from './role-plan.ts';
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
import type { Goal } from './strategies.ts';
type Candidate = { action: Command['action']; goal: Goal; benefit: number; ownId: number; targetId: number };
export const CANDIDATE_BUDGET = 256; // 32 representatives for each of eight goals, never a time budget.
export function knownCombatCount(view: PlayerView, ownerId: number): number {
  const known = new Map(Object.entries(view.knowledge.lastKnownUnits).map(([id, unit]) => [Number(id), unit]));
  for (const unit of view.units) known.set(unit.id, { ...unit, lastSeenRound: view.round });
  return [...known.values()].filter(unit => unit.ownerId === ownerId && unit.kind === 'pokemon').length;
}
export function canCaptureByPersonality(view: PlayerView, target: MapUnit, query: RuleQueries = RULE_QUERIES): boolean {
  if (target.kind !== 'pokemon' || target.ownerId !== null) return false;
  const strategy = AI_STRATEGIES[view.economy.player.personality], ai = query.ai ?? AI_THRESHOLDS;
  const content = query.content === CONTENT ? contentForView(view) : query.content;
  if (strategy.captureHpPercent !== null && target.hp * 100 >= content.species[target.speciesId].maxHp * ai[strategy.captureHpPercent]) return false;
  if (strategy.captureTerritoryOnly !== null && ai[strategy.captureTerritoryOnly]) {
    const tile = hexToIndex(target.position, view.map);
    return tile !== null && (view.territoryOwnerIds[tile]?.includes(view.playerId) ?? false);
  }
  return true;
}
export function canProduceSettler(view: PlayerView, ai: AiThresholds = AI_THRESHOLDS, opening = false): boolean {
  const player = view.economy.player, cities = view.economy.cities;
  const queued = cities.some(city => [...city.queue, ...city.pendingDeployments].some(order => order.item.kind === 'logistics' && order.item.defId === 'settler'));
  if (queued || view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.role === 'settler')) return false;
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
  const faithAction = planFaithAction(view);
  if (faithAction) return result(faithAction);
  const threatened = new Set(threatenedCityIds(view));
  const leaderAction = planLeaderAction(view, content);
  if (leaderAction) return result(leaderAction);
  const worldAction = planWorldAction(view, { base: content, world: WORLD_DEFINITIONS });
  if (worldAction) return result(worldAction);
  const civilizationAction = view.expansion
    ? planCivilizationAction(view.expansion.civilization, { ...CIVILIZATION_CONTENT, world: content }, eraCivilizationPolicy(view), view.map)
    : null;
  if (civilizationAction) return result(civilizationAction);
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
      : content.techTree ? treeResearchBenefit(view, techId, content) : 100 - techOf(content, techId).cost + leaderResearchBonus(view, techId), 0, i);
  }
  // v15: one legendary wonder at a time, in the most productive eligible city that is not threatened.
  const { cityId: wonderCity, legendId: wonder } = planLegendWonder(view, threatened);
  const income = cities.reduce((sum, city) => sum + city.yields.gold, 0);
  const upkeep = [...units, ...view.recoveringUnits].reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
  for (const city of cities) {
    const work = [...new Set([...city.lockedTileIds, ...city.availableTileIds])].slice(0, city.population).sort((a, b) => a - b);
    if (work.length > city.workedTileIds.length) add({ type: 'AssignWork', cityId: city.id, workedTileIds: work, lockedTileIds: [...city.lockedTileIds] }, 'economy', 500, city.id);
    if (city.queue.length || city.pendingDeployments.length) continue;
    const queue = (item: ProductionItem, goal: Goal, benefit: number, targetId = 0) => add({ type: 'SetProductionQueue', cityId: city.id, orders: [{ item }] }, goal, benefit, city.id, targetId);
    if (wonderCity === city.id && wonder) queue({ kind: 'legend', defId: wonder }, 'economy', 260, LEGEND_WONDERS[wonder].dex);
    const district = districtCandidates(view, city.id, content)[0];
    if (district) queue({ kind: 'district', defId: district.kind, tileIndex: district.tileIndex }, 'economy', district.score, district.tileIndex);
    if (canProduceSettler(view, ai, Boolean(content.opening))) { const escortId = pickEscort(view, content); queue({ kind: 'logistics', defId: 'settler', ...(escortId ? { escortId } : {}) }, 'found', content.opening && cities.length < 3 ? 900 : 50); }
    // The first 工匠 early (improvements compound); later ones only after the army is fed.
    if (wantsBuilder(view) && !threatened.has(city.id)) queue({ kind: 'logistics', defId: 'builder' }, 'economy', units.some(unit => unit.kind === 'logistics' && unit.role === 'builder') ? 70 : 400);
    if (wantsTrader(view, city.id)) { const escortId = pickEscort(view, content); queue({ kind: 'logistics', defId: 'trader', ...(escortId ? { escortId } : {}) }, 'economy', 140); }
    for (const [i, id] of (Object.keys(content.buildings) as BuildingId[]).entries()) {
      const building = content.buildings[id];
      if (building.cost === null || city.buildingIds.includes(id) || (building.requiredTech && !player.research.unlockedIds.includes(building.requiredTech))) continue;
      const y = building.yields;
      queue({ kind: 'building', defId: id }, 'economy', (y.food + y.production * 2 + y.gold * 2 + y.research * 2) * 100 - building.cost
        + (id === 'trainingGround' && threatened.has(city.id) ? 1000 : 0), i);
    }
    if (combat.length < Math.max(4, cities.length * 2) && (income > upkeep || player.gold >= 80)) {
      const badges = viewBadges(view);
      for (const [i, id] of trainableSpeciesIds(player, view.gameplayVersion, content, view.eraProgression).entries()) {
        const species = content.species[id];
        if (species.role === 'fast' && !player.research.unlockedIds.includes('riding')) continue;
        if (classTrainingBlocker(view, player, view.eraProgression, badges, id, content)) continue;
        queue({ kind: 'pokemon', defId: id }, 'military', species.attack + species.defense - species.trainCost
          + (preparingSiege && species.role === 'siege' && strategy.siegeTrainingBonus !== null ? ai[strategy.siegeTrainingBonus] : 0)
          + roleTrainingBonus(view, id, content, preparingSiege) + typeCounterBonus(view, id, content) + classTrainingBonus(view, id, content), i);
      }
    }
  }
  const wild = view.units.filter(unit => unit.ownerId === null && unit.kind === 'pokemon');
  if (cities.length && wild.some(target => canCaptureByPersonality(view, target, query) && combat.some(unit => hexDistance(unit.position, target.position, view.map) <= 2))
    && player.ballInventory.pokeBall + player.ballInventory.greatBall === 0 && player.research.unlockedIds.includes('domestication') && player.gold >= content.balls.pokeBall.goldCost) {
    add({ type: 'BuyBall', cityId: cities[0].id, ballId: 'pokeBall', quantity: 1 }, 'capture', 20, cities[0].id);
  }
  const visible = new Set(view.visibleTileIds), explored = new Set(view.knowledge.exploredTileIds);
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === actorId || pair.b === actorId));
  const workers = designatedWorkers(view, content, atWar || campaignActive || preparingSiege);
  const traceTargets = legendTraceTargets(view, content), ballTargets = itemBallTargets(view);
  for (const unit of units.filter(unit => unit.actionLeft)) {
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
            + captureBonus(target) + siegeCaptureBonus(target) + (target.kind === 'pokemon' ? roleCaptureBonus(view, target.speciesId, content) : 0), unit.id, target.id);
        }
        const preview = query.attack(view, unit.id, { kind: 'unit', id: target.id }, content);
        if (preview.ok && preview.damage.min > 0 && (target.ownerId === null || !strategy.defendTerritoryOnly || canSiege(view, target.ownerId, ai)
          || cities.some(city => hexDistance(city.position, target.position, view.map) <= workRadius(city)))) add({ type: 'Attack', unitId: unit.id, target: { kind: 'unit', id: target.id } },
          // Wild-target weakening competes with capture; it is neither military training nor civilization defense.
          target.ownerId === null ? strategy.wildAttackGoal : 'military',
          preview.damage.min - preview.counter.damage + (target.ownerId !== null ? 200 : 0), unit.id, target.id);
      }
      for (const city of view.cities) if (city.ownerId !== actorId && canSiege(view, city.ownerId, ai)) {
        const preview = query.attack(view, unit.id, { kind: 'city', id: city.id }, content);
        if (preview.ok) add({ type: 'Attack', unitId: unit.id, target: { kind: 'city', id: city.id } }, 'military', 300 + preview.damage.min - preview.counter.damage + (eraCampaign?.target.id === city.id ? 200 : 0), unit.id, city.id);
      }
    }
    const paths = query.paths(view, unit.id, content);
    if (workers.has(unit.id)) for (const suggestion of improvementSuggestions(view, unit, content, paths)) add(suggestion.action, 'economy', suggestion.benefit, unit.id);
    const sites = unit.kind === 'logistics' && unit.role === 'settler' ? view.map.tiles.flatMap((_, index) => citySite(indexToHex(index, view.map)) ? [indexToHex(index, view.map)] : []) : [];
    const targetHq = eraCampaign?.target ?? [...objectives.hqs].sort((a, b) => hexDistance(unit.position, a.position, view.map) - hexDistance(unit.position, b.position, view.map) || a.id - b.id)[0];
    const seek = unit.kind === 'pokemon' && objectives.searching ? seekUnknownHeadquarters(view, unit, paths) : null;
    for (const [indexText, path] of Object.entries(paths)) {
      // A visible route cannot hit a hidden first-step blocker and be rejected.
      if (!path.every(position => visible.has(hexToIndex(position, view.map)!))) continue;
      const index = Number(indexText), to = indexToHex(index, view.map), action = { type: 'Move' as const, unitId: unit.id, to };
      if (trader.destination && hexDistance(to, trader.destination, view.map) < hexDistance(unit.position, trader.destination, view.map)) add(action, 'economy', 110 - hexDistance(to, trader.destination, view.map), unit.id, index);
      if (unit.kind === 'logistics' && sites.length) {
        const before = Math.min(...sites.map(site => hexDistance(unit.position, site, view.map))), after = Math.min(...sites.map(site => hexDistance(to, site, view.map)));
        const ring = view.map.tiles.filter((_, tile) => hexDistance(indexToHex(tile, view.map), to, view.map) <= 2);
        const ringTiles = new Set(view.map.tiles.flatMap((_, tile) => hexDistance(indexToHex(tile, view.map), to, view.map) <= 2 ? [tile] : []));
        if (after < before) add(action, 'found', 100 - after + (citySite(to) ? siteEssenceBonus(view, content, ring) + siteRareBerryBonus(view, ringTiles) : 0), unit.id, index);
      } else if ((unit.kind === 'pokemon' || !usesBuilders(view)) && targetHq && hexDistance(to, targetHq.position, view.map) < hexDistance(unit.position, targetHq.position, view.map)) {
        add(action, 'military', 100 - hexDistance(to, targetHq.position, view.map), unit.id, index);
      }
      const trace = traceTargets.get(unit.id);
      if (trace && hexDistance(to, trace, view.map) < hexDistance(unit.position, trace, view.map)) add(action, 'explore', 120 - hexDistance(to, trace, view.map), unit.id, index);
      const ball = ballTargets.get(unit.id);
      if (ball && hexDistance(to, ball, view.map) < hexDistance(unit.position, ball, view.map)) add(action, 'explore', 125 - hexDistance(to, ball, view.map), unit.id, index);
      if (seek && hexDistance(to, seek, view.map) < hexDistance(unit.position, seek, view.map)) {
        add(action, 'military', 100 - hexDistance(to, seek, view.map), unit.id, index);
      }
      if (unit.kind === 'pokemon' && threatened.size && !atWar) {
        const city = view.economy.cities.filter(item => threatened.has(item.id)).sort((a, b) => hexDistance(unit.position, a.position, view.map) - hexDistance(unit.position, b.position, view.map) || a.id - b.id)[0];
        const garrisoned = city && view.units.some(other => other.ownerId === actorId && other.id !== unit.id && hexDistance(other.position, city.position, view.map) <= 1);
        if (city && !garrisoned && hexDistance(to, city.position, view.map) < hexDistance(unit.position, city.position, view.map)) add(action, 'economy', 90 - hexDistance(to, city.position, view.map), unit.id, index);
      }
      if (sanctuary && sanctuaryTeam.includes(unit.id)) {
        const before = hexDistance(unit.position, sanctuary.position, view.map), after = hexDistance(to, sanctuary.position, view.map);
        const holdsSite = combat.some(other => other.id !== unit.id && hexDistance(other.position, sanctuary.position, view.map) === 0);
        if (after < before && (!holdsSite || before > 2)) add(action, 'military', 90 - after, unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of view.units.filter(target => target.ownerId !== null && target.ownerId !== actorId)) {
        const war = view.diplomacy.some(pair => pair.status === 'war' && ((pair.a === actorId && pair.b === target.ownerId) || (pair.b === actorId && pair.a === target.ownerId)));
        const defensive = cities.some(city => hexDistance(city.position, target.position, view.map) <= workRadius(city));
        if (war && (!strategy.defendTerritoryOnly || defensive || canSiege(view, target.ownerId, ai))
          && hexDistance(to, target.position, view.map) < hexDistance(unit.position, target.position, view.map)) add(action, 'military', 150 - hexDistance(to, target.position, view.map)
            + (usesTactics(view) && hexDistance(to, target.position, view.map) === 1 ? 5 * units.filter(own => own.id !== unit.id && hexDistance(own.position, target.position, view.map) === 1).length : 0), unit.id, index);
      }
      if (unit.kind === 'pokemon') for (const target of wild) {
        if (!canCaptureByPersonality(view, target, query) || !player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall + player.ballInventory.greatBall === 0) continue;
        const distance = hexDistance(to, target.position, view.map);
        if (distance < hexDistance(unit.position, target.position, view.map)) add(action, 'capture', 10 - distance
          + captureBonus(target) + siegeCaptureBonus(target) + (target.kind === 'pokemon' ? roleCaptureBonus(view, target.speciesId, content) : 0), unit.id, index);
      }
      const radius = unitDefinition(unit, content).vision + (view.map.tiles[index] === 'mountain' ? 1 : 0);
      const gain = view.map.tiles.reduce((sum, _, tile) => sum + (!explored.has(tile) && hexDistance(to, indexToHex(tile, view.map), view.map) <= radius ? 1 : 0), 0);
      if (gain > 0) add(action, 'explore', gain, unit.id, index);
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
