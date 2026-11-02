import { EXPANSION_CONTENT, CONTENT } from '../content/units.ts';
import { leaderEffects } from '../content/leaders.ts';
import type { Content } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import type { CombatTarget, PlayerView } from './model.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { unitDamage, cityDamage, cityCounterDamage } from './combat-query.ts';
import { captureProbability } from './combat-math.ts';
import { cityAssaultMultiplier } from './role-tactics.ts';
import { flankBonus } from './tactics.ts';
import { mistyWaterMultiplier } from './leader-systems.ts';
import { homeDefenseMultiplier } from './essences.ts';
import { viewPolicyEffects } from './policies.ts';

export type AttackPreview = { ok: true; damage: { min: number; max: number };
  counter: { trigger: 'always' | 'possible' | 'never'; damage: number };
  knockdown: 'guaranteed' | 'possible' | 'none' } | { ok: false; reason: string };
export type CapturePreview = { ok: true; probability: number } | { ok: false; reason: string };
// Queries consume only the observation, never state, RNG, or last-known entities as live targets.
export function previewAttack(view: PlayerView, unitId: number, target: CombatTarget, content: Content = view.expansion ? EXPANSION_CONTENT : CONTENT): AttackPreview {
  const unit = view.units.find(unit => unit.id === unitId && unit.ownerId === view.playerId);
  const defender = target.kind === 'unit' ? view.units.find(unit => unit.id === target.id) : view.cities.find(city => city.id === target.id);
  if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft || view.outcome || view.activePlayerId !== view.playerId || !defender) return { ok: false, reason: 'attack-unavailable' };
  if (defender.ownerId === view.playerId || (defender.ownerId !== null && !view.diplomacy.some(pair => pair.status === 'war'
    && pair.a === Math.min(view.playerId, defender.ownerId!) && pair.b === Math.max(view.playerId, defender.ownerId!)))) return { ok: false, reason: 'at-peace' };
  const distance = hexDistance(unit.position, defender.position), range = content.species[unit.speciesId].range;
  const from = view.map.tiles[hexToIndex(unit.position, view.map)!], to = view.map.tiles[hexToIndex(defender.position, view.map)!];
  if (!from || !to || distance < 1 || distance > range || ('kind' in defender && defender.kind === 'logistics' && distance !== 1)) return { ok: false, reason: 'out-of-range' };
  const techs = view.economy.player.research.unlockedIds;
  const baseMultiplier = leaderEffects(view.economy.player.leaderId).activeAttackMultiplier;
  const attackMultiplier = view.economy.player.leaderId === 'lance' && (view.expansion?.leaders.activeUntilRound ?? 0) >= view.round ? Math.floor(baseMultiplier * 1150 / 1000) : baseMultiplier;
  let min: number, max: number, counter = 0, canCounter: boolean, hp: number;
  if (target.kind === 'unit') {
    const defendingUnit = view.units.find(unit => unit.id === target.id)!;
    hp = defendingUnit.hp;
    const flank = flankBonus(view, unit, defendingUnit, view.units);
    const mapView = { map: view.map as never, expansion: view.expansion ? { leaders: { players: { [view.playerId]: view.expansion.leaders } } } as never : undefined, round: view.round,
      players: Object.fromEntries(view.civilizations.map(civ => [civ.id, { leaderId: civ.leaderId }])) as never };
    const home = (identity: import("../content/units.ts").UnitIdentity, biome: typeof to) => homeDefenseMultiplier(view.expansion?.essences !== undefined, identity, biome, content);
    const side = mistyWaterMultiplier(mapView, unit.ownerId, unit, content) * home(defendingUnit, to) / 1000;
    min = unitDamage(unit, defendingUnit, from, to, techs.includes('typeResearch'), 85, false, content, attackMultiplier, Boolean(view.expansion), flank, side);
    max = unitDamage(unit, defendingUnit, from, to, techs.includes('typeResearch'), 100, false, content, attackMultiplier, Boolean(view.expansion), flank, side);
    canCounter = defendingUnit.kind === 'pokemon' && distance <= content.species[defendingUnit.speciesId].range;
    if (canCounter) counter = unitDamage(defendingUnit, unit, to, from, view.combat.units[defendingUnit.id].typeResearch, 100, true, content, 1000, Boolean(view.expansion), 0,
      mistyWaterMultiplier(mapView, defendingUnit.ownerId, defendingUnit, content) * home(unit, from) / 1000);
  } else {
    const city = view.combat.cities[defender.id]; hp = city.hp;
    const assault = cityAssaultMultiplier(view.economy.player, view.eraProgression, view.gameplayVersion, unit, content, distance, techs.includes('siegeCraft'));
    min = cityDamage(unit, from, to, techs.includes('siegeCraft'), 85, content, attackMultiplier, assault);
    max = cityDamage(unit, from, to, techs.includes('siegeCraft'), 100, content, attackMultiplier, assault);
    canCounter = distance <= 2 && city.counterAttack > 0;
    if (canCounter) counter = cityCounterDamage(city.counterAttack, unit, to, from, content);
  }
  const trigger = !canCounter || min >= hp ? 'never' : max >= hp ? 'possible' : 'always';
  return { ok: true, damage: { min, max }, counter: { trigger, damage: trigger === 'never' ? 0 : counter },
    knockdown: min >= hp ? 'guaranteed' : max >= hp ? 'possible' : 'none' };
}
export function previewCapture(view: PlayerView, unitId: number, targetUnitId: number, ballId: BallId, content: Content = view.expansion ? EXPANSION_CONTENT : CONTENT): CapturePreview {
  const unit = view.units.find(unit => unit.id === unitId && unit.ownerId === view.playerId), target = view.units.find(unit => unit.id === targetUnitId);
  const player = view.economy.player;
  if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft || view.outcome || view.activePlayerId !== view.playerId || !target || target.kind !== 'pokemon'
    || target.ownerId !== null || hexDistance(unit.position, target.position) !== 1 || !Object.hasOwn(content.balls, ballId)
    || !player.research.unlockedIds.includes('domestication') || !player.research.unlockedIds.includes(content.balls[ballId].requiredTech)
    || player.ballInventory[ballId] < 1) return { ok: false, reason: 'capture-unavailable' };
  const definition = content.species[target.speciesId];
  return { ok: true, probability: Math.min(100, captureProbability(definition.maxHp, target.hp, ballId === 'greatBall' ? 1500 : 1000,
    player.research.unlockedIds.includes('fieldObservation'), definition.rare) + viewPolicyEffects(view).captureBonus + leaderEffects(player.leaderId).captureBonus
    + (player.leaderId === 'giovanni' && (view.expansion?.leaders.activeUntilRound ?? 0) >= view.round ? 15 : 0)) };
}
