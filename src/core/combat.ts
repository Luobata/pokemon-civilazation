import { eliminateCivilization } from './victory.ts';
import { leaderAttackMultiplier } from './leader-systems.ts';
import { leaderEffects } from '../content/leaders.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { relationFor } from './diplomacy.ts';
import { unitDamage, cityDamage, cityCounterDamage } from './combat-query.ts';
import { EXPANSION_CONTENT, CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CombatAction, CombatEvent, CombatTarget, GameState, MapUnit, StepResult, KnockdownRecord, KnockdownCombatant } from './model.ts';
import { assignNewWorkers, cityCounterAttack, cleanWork } from './city.ts';
import { cityAssaultMultiplier } from './role-tactics.ts';
import { flankBonus } from './tactics.ts';
import { captureProbability, dualEffectiveness, effectiveness } from './combat-math.ts';
import { randomBelow } from './rng.ts';
import { registerSpecies } from './unit.ts';
import { visibleTiles } from './vision.ts';

type Rejection = Extract<StepResult, { ok: false }>['reason'];
const hasTech = (state: GameState, owner: number | null, tech: TechId) => owner !== null && state.players[owner].research.unlockedIds.includes(tech);
export function atWar(state: GameState, a: number, b: number): boolean {
  return state.diplomacy.some(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b) && pair.status === 'war');
}
export function validateCombatAction(state: GameState, actor: number, action: CombatAction, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): Rejection | null {
  const unit = state.units[action.unitId];
  if (!unit || unit.ownerId !== actor || !isMapUnit(unit) || unit.kind !== 'pokemon') return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  const definition = content.species[unit.speciesId], player = state.players[actor];
  if (action.type === 'Evolve') {
    if (state.expansion && WORLD_DEFINITIONS.stoneEvolutions.some(path => path.fromSpeciesId === unit.speciesId)) return 'evolution-unavailable';
    const evolution = definition.evolution;
    return evolution && evolution.speciesId === action.intoSpeciesId && unit.xp >= evolution.xp && player.gold >= evolution.gold
      && (!evolution.requiresTraining || hasTech(state, actor, 'training')) ? null : 'evolution-unavailable';
  }
  const target = action.type === 'Capture' ? state.units[action.targetUnitId]
    : action.target.kind === 'unit' ? state.units[action.target.id] : state.cities[action.target.id];
  const unavailable = action.type === 'Capture' ? 'capture-unavailable' : 'attack-unavailable';
  if (!target || ('location' in target && !isMapUnit(target)) || !target.position
    || !visibleTiles(state, actor, content).has(hexToIndex(target.position, state.map)!)) return unavailable;
  const distance = hexDistance(unit.position, target.position);
  if (action.type === 'Capture') {
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
    .sort((a, b) => hexDistance(unit.position, a.position) - hexDistance(unit.position, b.position) || a.id - b.id)[0];
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
  const hit = unitDamage(attacker, defender, state.map.tiles[hexToIndex(attacker.position, state.map)!],
    state.map.tiles[hexToIndex(defender.position, state.map)!], hasTech(state, attacker.ownerId, 'typeResearch'), roll, counter, content,
    leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(attacker.ownerId === null ? undefined : state.players[attacker.ownerId].leaderId).activeAttackMultiplier), Boolean(state.expansion),
    counter ? 0 : flankBonus(state.setup, attacker, defender, Object.values(state.units).filter(isMapUnit)));
  attacker.enraged = false;
  defender.hp = Math.max(0, defender.hp - hit);
  experience(state, attacker, (hit > 0 ? 10 : 0) + (defender.hp === 0 && d ? 40 * d.stage : 0));
  if (defender.hp === 0) {
    knockdowns.push({ source: combatant(attacker, content), target: combatant(defender, content), counter,
      effectiveness: d ? (state.expansion ? dualEffectiveness(content.species[attacker.speciesId].typeId, [d.typeId, ...(d.secondaryTypeId ? [d.secondaryTypeId] : [])], hasTech(state, attacker.ownerId, 'typeResearch')) : effectiveness(content.species[attacker.speciesId].typeId, d.typeId, d.immunities, hasTech(state, attacker.ownerId, 'typeResearch'))) : 100 });
    knockedDown(state, defender, attacker.ownerId, wildPhase, events);
  }
  return hit;
}
// Executes one validated battle, also used by neutral guards at stage 6.
export function resolveAttack(state: GameState, unitId: number, target: CombatTarget, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT, wildPhase = false): CombatEvent[] {
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
      && hexDistance(attacker.position, defendingUnit.position) <= content.species[defendingUnit.speciesId].range) {
      counterDamage = unitStrike(state, defendingUnit, attacker, true, wildPhase, content, events, knockdowns);
    }
  } else {
    const city = state.cities[target.id];
    hit = cityDamage(attacker, state.map.tiles[hexToIndex(attacker.position, state.map)!],
      state.map.tiles[hexToIndex(city.position, state.map)!], hasTech(state, attacker.ownerId, 'siegeCraft'), 85 + randomBelow(state.rng, 16), content,
      leaderAttackMultiplier(state, attacker.ownerId, leaderEffects(attacker.ownerId === null ? undefined : state.players[attacker.ownerId].leaderId).activeAttackMultiplier),
      cityAssaultMultiplier(attacker.ownerId === null ? undefined : state.players[attacker.ownerId], state.setup.eraProgression, state.setup.gameplayVersion, attacker, content,
        hexDistance(attacker.position, city.position), hasTech(state, attacker.ownerId, 'siegeCraft')));
    attacker.enraged = false;
    city.hp = Math.max(0, city.hp - hit); experience(state, attacker, hit > 0 ? 10 : 0);
    if (city.hp === 0) {
      capturedCity = true;
      const previousOwner = city.ownerId;
      const headquarters = previousOwner !== null && state.players[previousOwner].headquartersCityId === city.id;
      if (!headquarters) for (const unit of Object.values(state.units)) if (unit.location === 'recovering' && unit.cityId === city.id) delete state.units[unit.id];
      city.ownerId = attacker.ownerId!; city.hp = content.balance.city.capturedHp; city.capturedAtRound = state.round;
      if (state.expansion) delete state.expansion.civilization.pendingProductionByCity[city.id];
      city.workedTileIds = []; city.lockedTileIds = [];
      for (const other of Object.values(state.cities)) cleanWork(state, other, content);
      assignNewWorkers(state, city, city.population, content);
      if (previousOwner !== null) {
        const pair = relationFor(state.diplomacy, attacker.ownerId!, previousOwner);
        if (pair?.status === 'war') pair.citiesLostSinceWar[previousOwner] = (pair.citiesLostSinceWar[previousOwner] ?? 0) + 1;
        if (headquarters) events.push(...eliminateCivilization(state, previousOwner, content));
      }
    } else if (city.ownerId !== null && hexDistance(attacker.position, city.position) <= 2) {
      const attack = cityCounterAttack(state.players[city.ownerId], content);
      counterDamage = cityCounterDamage(attack, attacker, state.map.tiles[hexToIndex(city.position, state.map)!],
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
export function applyCombatAction(state: GameState, actor: number, action: CombatAction, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): CombatEvent[] {
  if (action.type === 'Attack') return resolveAttack(state, action.unitId, action.target, content);
  const unit = state.units[action.unitId];
  if (!isMapUnit(unit) || unit.kind !== 'pokemon') throw new Error('Expected deployed pokemon');
  unit.actionLeft = 0;
  const player = state.players[actor];
  if (action.type === 'Evolve') {
    const before = content.species[unit.speciesId], after = content.species[action.intoSpeciesId];
    player.gold -= before.evolution!.gold;
    unit.hp = Math.max(1, Math.floor(unit.hp * after.maxHp / before.maxHp));
    unit.speciesId = action.intoSpeciesId; unit.xp = 0; registerSpecies(player, unit);
    return [{ type: 'Evolved', playerId: actor, unitId: unit.id, speciesId: unit.speciesId }];
  }
  const target = state.units[action.targetUnitId];
  if (target.kind !== 'pokemon') throw new Error('Expected wild pokemon');
  const definition = content.species[target.speciesId];
  const probability = captureProbability(definition.maxHp, target.hp, action.ballId === 'greatBall' ? 1500 : 1000,
    hasTech(state, actor, 'fieldObservation'), definition.rare);
  player.ballInventory[action.ballId]--;
  const success = randomBelow(state.rng, 100) < probability;
  if (success) { target.ownerId = actor; target.actionLeft = 0; target.wildHome = null; registerSpecies(player, target); }
  else target.enraged = true;
  return [{ type: 'Captured', playerId: actor, unitId: unit.id, targetUnitId: target.id, success, probability }];
}
