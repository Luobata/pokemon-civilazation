import type { LastKnownUnit, MapUnit, PlayerView } from '../core/model.ts';
import { hexDistance } from '../core/hex.ts';
import { isEraProgression, type EraProgression } from '../content/eras.ts';
import type { CivilizationPlanningPolicy } from '../core/civilization-systems.ts';
import { knownCities } from './query.ts';

type EraProgressionView = PlayerView & { eraProgression?: EraProgression };
type KnownCity = ReturnType<typeof knownCities>[number];

export function hasEraProgression(view: PlayerView): view is EraProgressionView {
  return isEraProgression((view as EraProgressionView).eraProgression);
}

function visibleOrRememberedCombatCount(view: PlayerView, ownerId: number): number {
  const known = new Map<number, LastKnownUnit | MapUnit>(Object.entries(view.knowledge.lastKnownUnits).map(([id, unit]) => [Number(id), unit]));
  for (const unit of view.units) known.set(unit.id, unit);
  return [...known.values()].filter(unit => unit.ownerId === ownerId && unit.kind === 'pokemon').length;
}

/**
 * Era-progression campaigns are deliberately observation-only.  The target and the
 * 1.25x rally floor use current units plus remembered units/cities; no hidden state
 * or persistent planner side channel can affect either decision.
 */
function strategicAllianceBlock(view: PlayerView, alliedEnemies: ReadonlySet<number>): number | null {
  const candidates = knownCities(view).filter(city => city.ownerId !== null
    && city.ownerId !== view.playerId
    && !view.civilizations.find(civilization => civilization.id === city.ownerId)?.eliminated
    && !alliedEnemies.has(city.ownerId));
  if (!candidates.length) return null;
  const ownCombat = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
  if (ownCombat < 2) return null;
  const target = [...candidates].sort((a, b) => {
    const headquarters = Number(b.headquartersOf === b.ownerId) - Number(a.headquartersOf === a.ownerId);
    if (headquarters !== 0) return headquarters;
    const ownCities = view.economy.cities;
    const distance = (city: typeof a) => Math.min(...ownCities.map(own => hexDistance(own.position, city.position)));
    const byDistance = distance(a) - distance(b);
    if (byDistance !== 0) return byDistance;
    return a.id - b.id;
  })[0]!;
  return ownCombat * 1000 >= 1250 * visibleOrRememberedCombatCount(view, target.ownerId!) ? target.ownerId : null;
}

export function eraCivilizationPolicy(view: PlayerView): CivilizationPlanningPolicy | undefined {
  if (!hasEraProgression(view)) return undefined;
  const living = view.civilizations.filter(civilization => !civilization.eliminated);
  const allied = new Set(view.expansion?.civilization.relations
    .filter(relation => relation.allianceSinceRound !== null && !relation.targetEliminated)
    .map(relation => relation.targetPlayerId));
  const blocked = strategicAllianceBlock(view, allied);
  return {
    maximumAllies: living.length <= 2 ? 0 : 1,
    blockedAllianceTargetPlayerIds: blocked === null ? [] : [blocked],
  };
}

export function campaignPlan(view: PlayerView): { target: KnownCity; enemies: number[] } | null {
  if (!hasEraProgression(view)) return null;
  const enemies = view.diplomacy
    .filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a)
    .filter(ownerId => !view.civilizations.find(civilization => civilization.id === ownerId)?.eliminated);
  if (!enemies.length) return null;

  const ownCombat = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon').length;
  const strongestKnownEnemy = Math.max(...enemies.map(enemy => visibleOrRememberedCombatCount(view, enemy)));
  if (ownCombat < 2 || ownCombat * 1000 < 1250 * strongestKnownEnemy) return null;

  const targets = knownCities(view).filter(city => city.ownerId !== null && enemies.includes(city.ownerId));
  if (!targets.length) return null;
  const ownCities = view.economy.cities;
  const distanceFromTerritory = (city: KnownCity) => ownCities.length
    ? Math.min(...ownCities.map(own => hexDistance(own.position, city.position)))
    : Math.min(...view.units.filter(unit => unit.ownerId === view.playerId).map(unit => hexDistance(unit.position, city.position)));
  const target = [...targets].sort((a, b) => {
    const headquarters = Number(b.headquartersOf === b.ownerId) - Number(a.headquartersOf === a.ownerId);
    if (headquarters !== 0) return headquarters;
    const distance = distanceFromTerritory(a) - distanceFromTerritory(b);
    if (distance !== 0) return distance;
    return a.id - b.id;
  })[0]!;
  return { target, enemies };
}
