import { wallBonus } from './opening.ts';
import { cityCounterBreakdown, cityFactors, cityStrengthBreakdown, strengthDamage, strikeFactors, unitStrengthBreakdown } from './strength.ts';
import { affinityPermille, candyGold, classCityMultiplier, classCounterPermille, classStrikeMultiplier } from './unit-classes.ts';
import { stoneEvolutionsFor } from '../content/roster.ts';
import { evolutionBlocker, evolutionOptions, playerGeneration, tileBiome } from './roster.ts';
import { eliminateCivilization } from './victory.ts';
import { leaderAttackMultiplier, leaderCaptureBonus, evolutionGold, mistyWaterMultiplier } from './leader-systems.ts';
import { leaderEffects } from '../content/leaders.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { relationFor } from './diplomacy.ts';
import { unitDamage, cityDamage, cityCounterDamage } from './combat-query.ts';
import { contentFor } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CombatAction, CombatEvent, CombatTarget, GameState, MapUnit, StepResult, KnockdownRecord, KnockdownCombatant } from './model.ts';
import { assignNewWorkers, cityCounterAttack, cleanWork } from './city.ts';
import { cityAssaultMultiplier } from './role-tactics.ts';
import { flankBonus } from './tactics.ts';
import { playerPolicyEffects } from './policies.ts';
import { clearGym, homeDefenseMultiplier, usesEssences } from './essences.ts';
import { zealotMultiplier } from './faith-legends.ts';
import { combatContext, consumeZMove, eraAttackMultiplier, eraDefenseMultiplier, teraTypes } from './era-abilities.ts';
import { captureProbability, dualEffectiveness, effectiveness } from './combat-math.ts';
import { randomBelow } from './rng.ts';
import { promotionCityMultiplier, promotionStrikeMultiplier, scalePermille } from './promotions.ts';
import { registerSpecies } from './unit.ts';
import { visibleTiles } from './vision.ts';
import { researchCaptureBonus } from './research-tasks.ts';
import { cityCounterTerrain, cityStrikeTerrain, isEmbarked, unitStrikeTerrain } from './terrain.ts';
import { isRivalUnit, rivalSpirit } from './rivals.ts';

type Rejection = Extract<StepResult, { ok: false }>['reason'];
const hasTech = (state: GameState, owner: number | null, tech: TechId) => owner !== null && state.players[owner].research.unlockedIds.includes(tech);
export function atWar(state: GameState, a: number, b: number): boolean {
  return state.diplomacy.some(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b) && pair.status === 'war');
}
export function validateCombatAction(state: GameState, actor: number, action: CombatAction, content: Content = contentFor(state.setup)): Rejection | null {
  const unit = state.units[action.unitId];
  if (!unit || unit.ownerId !== actor || !isMapUnit(unit) || unit.kind !== 'pokemon') return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  const definition = content.species[unit.speciesId], player = state.players[actor];
  if (action.type === 'Evolve') {
    if (state.expansion && stoneEvolutionsFor(content).some(path => path.fromSpeciesId === unit.speciesId && path.intoSpeciesId === action.intoSpeciesId)) return 'evolution-unavailable';
    if (state.expansion && !content.roster && WORLD_DEFINITIONS.stoneEvolutions.some(path => path.fromSpeciesId === unit.speciesId)) return 'evolution-unavailable';
    const evolution = evolutionOptions(content, unit.speciesId).find(option => option.speciesId === action.intoSpeciesId);
    if (evolution && evolutionBlocker(content, evolution, { generation: playerGeneration(player, state.setup.eraProgression), round: state.round, biome: tileBiome(state, unit.position) })) return 'evolution-unavailable';
    // v19 Rare Candy: a stage-1 Pokémon short of XP may evolve for extra gold from generation 2.
    const candy = evolution && unit.xp < evolution.xp ? candyGold(state, player, state.setup.eraProgression, definition.stage, evolutionGold(player, evolution.gold)) : null;
    return evolution && (unit.xp >= evolution.xp ? player.gold >= evolutionGold(player, evolution.gold) : candy !== null && player.gold >= candy)
      && (!evolution.requiresTraining || hasTech(state, actor, 'training')) ? null : 'evolution-unavailable';
  }
  const target = action.type === 'Capture' ? state.units[action.targetUnitId]
    : action.target.kind === 'unit' ? state.units[action.target.id] : state.cities[action.target.id];
  const unavailable = action.type === 'Capture' ? 'capture-unavailable' : 'attack-unavailable';
  // v24 A2: a land unit carried on water cannot attack or capture.
  if (isEmbarked(unit, state.map, content)) return unavailable;
  if (!target || ('location' in target && !isMapUnit(target)) || !target.position
    || !visibleTiles(state, actor, content).has(hexToIndex(target.position, state.map)!)) return unavailable;
  const distance = hexDistance(unit.position, target.position, state.map);
  if (action.type === 'Capture') {
    // v24 C: a rival trainer's Pokémon cannot be caught.
    if ('kind' in target && isRivalUnit(state, target.id)) return 'capture-rival';
    return 'kind' in target && target.kind === 'pokemon' && target.ownerId === null && distance === 1
      && hasTech(state, actor, 'domestication') && Object.hasOwn(content.balls, action.ballId)
      && hasTech(state, actor, content.balls[action.ballId].requiredTech) && player.ballInventory[action.ballId] > 0 ? null : unavailable;
  }
  if (target.ownerId === actor || (target.ownerId !== null && !atWar(state, actor, target.ownerId))) return unavailable;
  if (distance < 1 || distance > definition.range || ('kind' in target && target.kind === 'logistics' && distance !== 1)) return unavailable;
  return null;
}
function experience(state: GameState, unit: MapUnit, base: number): void {
  // D33: sum this strike's XP, multiply both bonuses, floor once.
  const starter = unit.ownerId !== null && state.players[unit.ownerId].starterId === 'charmander' ? 1150 : 1000;
  const training = hasTech(state, unit.ownerId, 'training') ? 1250 : 1000;
  unit.xp += Math.floor(base * starter * training / 1_000_000);
}
function knockedDown(state: GameState, unit: MapUnit, sourceOwner: number | null, wildPhase: boolean, events: CombatEvent[]): void {
  if (sourceOwner !== null) state.players[sourceOwner].knockdownCount++;
  if (unit.ownerId === null || unit.kind === 'logistics') { delete state.units[unit.id]; return; }
  const city = Object.values(state.cities).filter(city => city.ownerId === unit.ownerId)
    .sort((a, b) => hexDistance(unit.position, a.position, state.map) - hexDistance(unit.position, b.position, state.map) || a.id - b.id)[0];
  if (!city) throw new Error('Surviving civilization must own a city.');
  const roundsLeft = Math.max(1, (wildPhase ? 2 : 3) - leaderEffects(state.players[unit.ownerId].leaderId).recoveryReduction);
  state.units[unit.id] = { ...unit, location: 'recovering', position: null, cityId: city.id, roundsLeft, hp: 1, actionLeft: 0 };
  events.push({ type: 'UnitRecovering', playerId: unit.ownerId, unitId: unit.id, cityId: city.id, roundsLeft });
}
function combatant(unit: MapUnit, content: Content): KnockdownCombatant {
  return { id: unit.id, ownerId: unit.ownerId, kind: unit.kind, typeId: unit.kind === 'pokemon' ? content.species[unit.speciesId].typeId : null };
}
function unitStrike(state: GameState, attacker: MapUnit, defender: MapUnit, counter: boolean,
  wildPhase: boolean, content: Content, events: CombatEvent[], knockdowns: KnockdownRecord[]): number {
  if (attacker.kind !== 'pokemon') return 0;
  const d = defender.kind === 'pokemon' ? content.species[defender.speciesId] : null;
  const roll = counter ? 100 : 85 + randomBelow(state.rng, 16);
  const era = combatContext(state);
  const fromBiome = state.map.tiles[hexToIndex(attacker.position, state.map)!], toBiome = state.map.tiles[hexToIndex(defender.position, state.map)!];
  // v20: combat strength — the same labelled factors the preview shows.
  const hit = content.combat === 'strength' ? strengthDamage(unitStrengthBreakdown(attacker, defender, fromBiome, toBiome, hasTech(state, attacker.ownerId, 'typeResearch'), content,
    strikeFactors({ leader: counter ? 1000 : leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(attacker.ownerId === null ? undefined : state.players[attacker.ownerId].leaderId).activeAttackMultiplier),
      enraged: attacker.enraged, flank: counter ? 0 : flankBonus(state.setup, attacker, defender, Object.values(state.units).filter(isMapUnit), state.map),
      misty: mistyWaterMultiplier(state, attacker.ownerId, attacker, content), home: homeDefenseMultiplier(usesEssences(state), defender, toBiome, content),
      eraAttack: eraAttackMultiplier(era, attacker, content, false, counter), eraDefense: eraDefenseMultiplier(era, defender),
      zealot: counter ? 1000 : zealotMultiplier(state, attacker.ownerId, attacker.position),
      assault: promotionStrikeMultiplier(state, attacker.id, -1, counter), bulwark: promotionStrikeMultiplier(state, -1, defender.id, counter),
      classCounter: classCounterPermille(state, attacker, defender, content), affinity: affinityPermille(state, attacker, content) }),
    teraTypes(era, defender.id), unitStrikeTerrain(state.map, attacker, defender, counter, content), { attacker: rivalSpirit(state, attacker.id), defender: rivalSpirit(state, defender.id) }), roll, counter, defender.hp) : unitDamage(attacker, defender, state.map.tiles[hexToIndex(attacker.position, state.map)!],
    state.map.tiles[hexToIndex(defender.position, state.map)!], hasTech(state, attacker.ownerId, 'typeResearch'), roll, counter, content,
    leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(attacker.ownerId === null ? undefined : state.players[attacker.ownerId].leaderId).activeAttackMultiplier), Boolean(state.expansion),
    counter ? 0 : flankBonus(state.setup, attacker, defender, Object.values(state.units).filter(isMapUnit), state.map),
    scalePermille(scalePermille(mistyWaterMultiplier(state, attacker.ownerId, attacker, content)
      * homeDefenseMultiplier(usesEssences(state), defender, state.map.tiles[hexToIndex(defender.position, state.map)!], content) / 1000
      * eraAttackMultiplier(era, attacker, content, false, counter) / 1000 * eraDefenseMultiplier(era, defender) / 1000
      * (counter ? 1000 : zealotMultiplier(state, attacker.ownerId, attacker.position)) / 1000,
      promotionStrikeMultiplier(state, attacker.id, defender.id, counter)), classStrikeMultiplier(state, attacker, defender, content)),
    teraTypes(era, defender.id));
  if (!counter) consumeZMove(state, attacker.id);
  attacker.enraged = false;
  defender.hp = Math.max(0, defender.hp - hit);
  experience(state, attacker, (hit > 0 ? 10 : 0) + (defender.hp === 0 && d ? 40 * d.stage : 0));
  if (defender.hp === 0) {
    knockdowns.push({ source: combatant(attacker, content), target: combatant(defender, content), counter,
      effectiveness: d ? (state.expansion ? dualEffectiveness(content.species[attacker.speciesId].typeId, teraTypes(era, defender.id) ?? [d.typeId, ...(d.secondaryTypeId ? [d.secondaryTypeId] : [])], hasTech(state, attacker.ownerId, 'typeResearch')) : effectiveness(content.species[attacker.speciesId].typeId, d.typeId, d.immunities, hasTech(state, attacker.ownerId, 'typeResearch'))) : 100 });
    knockedDown(state, defender, attacker.ownerId, wildPhase, events);
  }
  return hit;
}
// Executes one validated battle, also used by neutral guards at stage 6.
export function resolveAttack(state: GameState, unitId: number, target: CombatTarget, content: Content = contentFor(state.setup), wildPhase = false): CombatEvent[] {
  const attacker = state.units[unitId];
  if (!isMapUnit(attacker) || attacker.kind !== 'pokemon') throw new Error('Expected deployed attacker');
  const defender = target.kind === 'unit' ? state.units[target.id] : state.cities[target.id];
  if (!defender.position) throw new Error('Expected deployed target');
  const positions = [{ ...attacker.position }, { ...defender.position }], events: CombatEvent[] = [];
  const knockdowns: KnockdownRecord[] = [];
  attacker.actionLeft = 0;
  let hit: number;
  let counterDamage = 0, capturedCity = false;
  if (target.kind === 'unit') {
    const defendingUnit = state.units[target.id] as MapUnit;
    hit = unitStrike(state, attacker, defendingUnit, false, wildPhase, content, events, knockdowns);
    if (state.units[defendingUnit.id] && isMapUnit(state.units[defendingUnit.id]) && defendingUnit.kind === 'pokemon'
      && hexDistance(attacker.position, defendingUnit.position, state.map) <= content.species[defendingUnit.speciesId].range) {
      counterDamage = unitStrike(state, defendingUnit, attacker, true, wildPhase, content, events, knockdowns);
    }
  } else {
    const city = state.cities[target.id];
    const fromBiome = state.map.tiles[hexToIndex(attacker.position, state.map)!], cityBiome = state.map.tiles[hexToIndex(city.position, state.map)!];
    const owner = attacker.ownerId === null ? undefined : state.players[attacker.ownerId];
    if (content.combat === 'strength') hit = strengthDamage(cityStrengthBreakdown(attacker, fromBiome, cityBiome, content, cityFactors({
      assault: cityAssaultMultiplier(owner, state.setup.eraProgression, state.setup.gameplayVersion, attacker, content, hexDistance(attacker.position, city.position, state.map), hasTech(state, attacker.ownerId, 'siegeCraft'))
        ?? (content.species[attacker.speciesId].role === 'siege' && hasTech(state, attacker.ownerId, 'siegeCraft') ? content.balance.effects.siegeMultiplier : 1000),
      leader: leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(owner?.leaderId).activeAttackMultiplier), eraAttack: eraAttackMultiplier(combatContext(state), attacker, content, true, false),
      enraged: attacker.enraged, breacher: promotionCityMultiplier(state, attacker.id), affinity: affinityPermille(state, attacker, content) }), content.opening ? wallBonus(state.round, city.ownerId !== null && state.players[city.ownerId].headquartersCityId === city.id) : 0,
      cityStrikeTerrain(state.map, attacker, city.position, content)), 85 + randomBelow(state.rng, 16), false, city.hp);
    else hit = cityDamage(attacker, state.map.tiles[hexToIndex(attacker.position, state.map)!],
      state.map.tiles[hexToIndex(city.position, state.map)!], hasTech(state, attacker.ownerId, 'siegeCraft'), 85 + randomBelow(state.rng, 16), content,
      Math.floor(scalePermille(scalePermille(leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(attacker.ownerId === null ? undefined : state.players[attacker.ownerId].leaderId).activeAttackMultiplier)
        * eraAttackMultiplier(combatContext(state), attacker, content, true, false) / 1000, promotionCityMultiplier(state, attacker.id)), classCityMultiplier(state, attacker, content))),
      cityAssaultMultiplier(attacker.ownerId === null ? undefined : state.players[attacker.ownerId], state.setup.eraProgression, state.setup.gameplayVersion, attacker, content,
        hexDistance(attacker.position, city.position, state.map), hasTech(state, attacker.ownerId, 'siegeCraft')));
    attacker.enraged = false;
    consumeZMove(state, attacker.id);
    city.hp = Math.max(0, city.hp - hit); experience(state, attacker, hit > 0 ? 10 : 0);
    if (city.hp === 0) {
      capturedCity = true;
      const previousOwner = city.ownerId;
      const headquarters = previousOwner !== null && state.players[previousOwner].headquartersCityId === city.id;
      if (!headquarters) for (const unit of Object.values(state.units)) if (unit.location === 'recovering' && unit.cityId === city.id) delete state.units[unit.id];
      if (state.expansion?.districts) city.queue = city.queue.filter(order => order.item.kind !== 'district' && order.item.kind !== 'legend');
      city.ownerId = attacker.ownerId!; city.hp = content.balance.city.capturedHp; city.capturedAtRound = state.round;
      if (state.expansion) delete state.expansion.civilization.pendingProductionByCity[city.id];
      clearGym(state, city.id);
      city.workedTileIds = []; city.lockedTileIds = [];
      for (const other of Object.values(state.cities)) cleanWork(state, other, content);
      assignNewWorkers(state, city, city.population, content);
      if (previousOwner !== null) {
        const pair = relationFor(state.diplomacy, attacker.ownerId!, previousOwner);
        if (pair?.status === 'war') pair.citiesLostSinceWar[previousOwner] = (pair.citiesLostSinceWar[previousOwner] ?? 0) + 1;
        if (headquarters) events.push(...eliminateCivilization(state, previousOwner, content));
      }
    } else if (city.ownerId !== null && hexDistance(attacker.position, city.position, state.map) <= 2) {
      const attack = cityCounterAttack(state.players[city.ownerId], content);
      counterDamage = content.combat === 'strength'
        ? strengthDamage(cityCounterBreakdown(attack, attacker, state.map.tiles[hexToIndex(city.position, state.map)!], state.map.tiles[hexToIndex(attacker.position, state.map)!], content,
          cityCounterTerrain(state.map, city.position, attacker, content)), 100, true, attacker.hp)
        : cityCounterDamage(attack, attacker, state.map.tiles[hexToIndex(city.position, state.map)!],
        state.map.tiles[hexToIndex(attacker.position, state.map)!], content);
      attacker.hp = Math.max(0, attacker.hp - counterDamage);
      if (attacker.hp === 0) {
        knockdowns.push({ source: { id: city.id, ownerId: city.ownerId, kind: 'city', typeId: null }, target: combatant(attacker, content), effectiveness: 100, counter: true });
        knockedDown(state, attacker, city.ownerId, wildPhase, events);
      }
    }
  }
  const knockedDownUnitIds = [unitId, ...(target.kind === 'unit' ? [target.id] : [])]
    .filter(id => !state.units[id] || !isMapUnit(state.units[id]));
  events.unshift({ type: 'BattleResolved', attackerId: unitId, target: { ...target }, positions, damage: hit, counterDamage, capturedCity, knockedDownUnitIds, knockdowns });
  return events;
}
export function applyCombatAction(state: GameState, actor: number, action: CombatAction, content: Content = contentFor(state.setup)): CombatEvent[] {
  if (action.type === 'Attack') return resolveAttack(state, action.unitId, action.target, content);
  const unit = state.units[action.unitId];
  if (!isMapUnit(unit) || unit.kind !== 'pokemon') throw new Error('Expected deployed pokemon');
  unit.actionLeft = 0;
  const player = state.players[actor];
  if (action.type === 'Evolve') {
    const before = content.species[unit.speciesId], after = content.species[action.intoSpeciesId];
    const option = evolutionOptions(content, unit.speciesId).find(item => item.speciesId === action.intoSpeciesId)!;
    player.gold -= unit.xp < option.xp ? candyGold(state, player, state.setup.eraProgression, before.stage, evolutionGold(player, option.gold))! : evolutionGold(player, option.gold);
    unit.hp = Math.max(1, Math.floor(unit.hp * after.maxHp / before.maxHp));
    unit.speciesId = action.intoSpeciesId; unit.xp = 0; registerSpecies(player, unit);
    return [{ type: 'Evolved', playerId: actor, unitId: unit.id, speciesId: unit.speciesId }];
  }
  const target = state.units[action.targetUnitId];
  if (target.kind !== 'pokemon') throw new Error('Expected wild pokemon');
  const definition = content.species[target.speciesId];
  const probability = Math.min(100, captureProbability(definition.maxHp, target.hp, action.ballId === 'greatBall' ? 1500 : 1000,
    hasTech(state, actor, 'fieldObservation'), definition.rare) + playerPolicyEffects(state, actor).captureBonus
    + leaderCaptureBonus(state, actor) + researchCaptureBonus(state, actor, target.speciesId));
  player.ballInventory[action.ballId]--;
  const success = randomBelow(state.rng, 100) < probability;
  if (success) { target.ownerId = actor; target.actionLeft = 0; target.wildHome = null; registerSpecies(player, target); player.gold += leaderEffects(player.leaderId).captureGold; }
  else target.enraged = true;
  return [{ type: 'Captured', playerId: actor, unitId: unit.id, targetUnitId: target.id, success, probability }];
}
