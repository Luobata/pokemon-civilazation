// Sacred sanctuaries: continent-proportional placement, establishment, guardian challenge, and origin victory.
import type { CivilizationContent } from '../content/civilization-systems.ts';
import { battleRosterFromState, civilization, guardianFighter, isPokemon, relayFighters, tabletClaimed, teamPower } from './civilization-model.ts';
import type { CivilizationAction, CivilizationHost, CivilizationView, SanctuarySite } from './civilization-model.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex, neighbors, offsetToHex } from './hex.ts';
import type { EventPayload, UnitState } from './model.ts';
import { battleSeed, resolveTeamBattle } from './team-battle.ts';
import type { BattleTraceV26 } from './team-battle.ts';
import { worldSiteAllowed } from './terrain.ts';
import type { MapFeatures } from './terrain.ts';

type SanctuaryAction = Extract<CivilizationAction, { type: 'EstablishSanctuary' | 'ChallengeGuardian' }>;

/**
 * v24: the passable tiles of the continent each sanctuary goes to. Continents get sanctuaries in proportion to the capitals on them
 * (largest remainder, ties to the lower continent), so 2 + 2 on four-player maps and 3 + 1 on three-player maps.
 */
function sanctuaryAnchorsV24(state: CivilizationHost & { map: { features: MapFeatures } }, count: number): number[][] {
  const capitals = Object.values(state.cities).filter(city => city.ownerId !== null).map(city => hexToIndex(city.position, state.map)!).sort((a, b) => a - b);
  const groups: number[][] = [];
  const groupOf = new Map<number, number>();
  for (const capital of capitals) {
    if (groupOf.has(capital)) continue;
    const group = [capital], seen = new Set(group);
    for (let k = 0; k < group.length; k++) for (const hex of neighbors(indexToHex(group[k], state.map), state.map)) {
      const next = hexToIndex(hex, state.map);
      if (next !== null && !seen.has(next) && state.map.tiles[next] !== 'ocean') { seen.add(next); group.push(next); }
    }
    for (const index of group) groupOf.set(index, groups.length);
    groups.push(group.filter(index => worldSiteAllowed(state.map, index, 'continent')).sort((a, b) => a - b));
  }
  const civs = groups.map((_, g) => capitals.filter(capital => groupOf.get(capital) === g).length);
  const quota = civs.map(n => Math.floor(count * n / capitals.length));
  const order = civs.map((n, g) => ({ g, rest: (count * n) % capitals.length })).sort((a, b) => b.rest - a.rest || a.g - b.g);
  for (let k = 0; quota.reduce((s, q) => s + q, 0) < count; k++) quota[order[k % order.length].g]++;
  return quota.flatMap((q, g) => Array.from({ length: q }, () => groups[g]));
}

export function selectSanctuarySites(state: CivilizationHost, content: CivilizationContent): SanctuarySite[] {
  const anchors = [
    { col: Math.floor(state.map.width / 4), row: Math.floor(state.map.height / 4) },
    { col: Math.floor((state.map.width * 3) / 4), row: Math.floor(state.map.height / 4) },
    { col: Math.floor(state.map.width / 4), row: Math.floor((state.map.height * 3) / 4) },
    { col: Math.floor((state.map.width * 3) / 4), row: Math.floor((state.map.height * 3) / 4) },
  ].map(offsetToHex);
  const cityIndexes = new Set(Object.values(state.cities)
    .map(city => hexToIndex(city.position, state.map))
    .filter((index): index is number => index !== null));
  const chosen: number[] = [];
  const v24 = state.map.features ? sanctuaryAnchorsV24(state as CivilizationHost & { map: { features: MapFeatures } }, content.sanctuaries.definitions.length) : null;
  for (const definition of content.sanctuaries.definitions) {
    if (v24) {
      // v24 A3 (world-v24 §2.7): on the k-th sanctuary's continent, the passable tile farthest (up to 6) from cities and earlier sanctuaries.
      const continent = v24[content.sanctuaries.definitions.indexOf(definition)];
      const spread = (index: number) => Math.min(6, ...Object.values(state.cities).map(city => hexDistance(city.position, indexToHex(index, state.map), state.map))) * 16
        + Math.min(10, ...chosen.map(other => hexDistance(indexToHex(other, state.map), indexToHex(index, state.map), state.map)));
      const options = continent.filter(index => !cityIndexes.has(index) && !chosen.includes(index) && edgeDistance(indexToHex(index, state.map), state.map) >= 1);
      const best = options.sort((a, b) => spread(b) - spread(a) || a - b)[0];
      if (best !== undefined) { chosen.push(best); continue; }
    }
    const anchor = anchors[(content.sanctuaries.definitions.indexOf(definition)) % anchors.length];
    const candidates = state.map.tiles.flatMap((biome, index) => biome === 'ocean' || cityIndexes.has(index) || chosen.includes(index)
      || !worldSiteAllowed(state.map, index, 'land') ? [] : [index]).sort((a, b) => {
      const first = indexToHex(a, state.map), second = indexToHex(b, state.map);
      return hexDistance(first, anchor, state.map) - hexDistance(second, anchor, state.map)
        || edgeDistance(second, state.map) - edgeDistance(first, state.map) || a - b;
    });
    const index = candidates[0];
    if (index === undefined) throw new Error(`Map has fewer than four valid sanctuary tiles for ${definition.id}.`);
    chosen.push(index);
  }
  return content.sanctuaries.definitions.map((definition, index) => ({
    ...definition, position: indexToHex(chosen[index], state.map), ownerId: null,
    guardianDefeated: false, challengeRoundByPlayer: {},
  }));
}

function validateGuardianChallenge(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'ChallengeGuardian' }>, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId);
  if (!site) return 'site-unavailable';
  if (site.ownerId !== actorId) return 'sanctuary-not-owned';
  if (site.guardianDefeated || tabletClaimed(civilizationState, site.tabletId)) return 'guardian-unavailable';
  if ((site.challengeRoundByPlayer[actorId] ?? -1) >= state.round) return 'challenge-cooldown';
  const ids = action.unitIds;
  if (ids.length < 1 || ids.length > content.sanctuaries.maximumChallengeUnits || new Set(ids).size !== ids.length) return 'invalid-team';
  const siteIndex = hexToIndex(site.position, state.map);
  const local = ids.every(id => {
    const unit = state.units[id];
    return isPokemon(unit) && unit.ownerId === actorId && unit.location === 'map' && unit.actionLeft === 1
      && siteIndex !== null && hexDistance(unit.position, site.position, state.map) <= 2;
  });
  if (!local) return 'unit-not-local';
  return ids.some(id => state.units[id]?.location === 'map' && siteIndex !== null
    && hexToIndex((state.units[id] as Extract<UnitState, { location: 'map' }>).position, state.map) === siteIndex)
    ? null : 'unit-not-on-site';
}

export function validateSanctuaryAction(state: CivilizationHost, actorId: number, action: SanctuaryAction, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const player = state.players[actorId];
  if (action.type === 'EstablishSanctuary') {
    const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId);
    const unit = state.units[action.unitId];
    if (!site) return 'site-unavailable';
    if (site.ownerId !== null) return 'sanctuary-owned';
    if (!unit || unit.ownerId !== actorId || unit.location !== 'map') return 'unit-unavailable';
    if (player.gold < content.sanctuaries.establishmentCost) return 'insufficient-gold';
    const index = hexToIndex(site.position, state.map);
    return index !== null && hexToIndex((unit as Extract<UnitState, { location: 'map' }>).position, state.map) === index ? null : 'unit-not-on-site';
  }
  return validateGuardianChallenge(state, actorId, action, content);
}

export function applySanctuaryAction(state: CivilizationHost, actorId: number, action: SanctuaryAction, content: CivilizationContent): EventPayload[] {
  const civilizationState = civilization(state)!;
  if (action.type === 'EstablishSanctuary') {
    const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId)!;
    state.players[actorId].gold -= content.sanctuaries.establishmentCost;
    site.ownerId = actorId;
    return [{ type: 'SanctuaryEstablished', playerId: actorId, siteId: site.id, goldAfter: state.players[actorId].gold }];
  }
  const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId)!;
  const power = teamPower(state, action.unitIds, content);
  const roster = battleRosterFromState(state, action.unitIds, 'challenger', `challenge-${actorId}-${site.id}`, content)
    .map(combatant => ({ ...combatant, side: 'challenger' as const }));
  const terrain = state.map.tiles[hexToIndex(site.position, state.map)!];
  const home = relayFighters(state, action.unitIds, `challenge-${actorId}-${site.id}`, content.world);
  const battle: BattleTraceV26 = resolveTeamBattle(home, [guardianFighter(site, content.world)], battleSeed(state.rng), terrain);
  home.forEach((fighter, index) => { roster[index].hp = fighter.hp; });
  for (const unitId of action.unitIds) state.units[unitId]!.actionLeft = 0;
  for (const [index, combatant] of roster.entries()) {
    const unit = state.units[action.unitIds[index]!]!;
    unit.hp = Math.max(1, combatant.hp);
  }
  site.challengeRoundByPlayer[actorId] = state.round;
  const victory = battle.winnerSide === 'home';
  if (victory) {
    site.guardianDefeated = true;
    civilizationState.tabletOwners[site.tabletId] = actorId;
    if (content.sanctuaries.definitions.every(definition => civilizationState.tabletOwners[definition.tabletId] === actorId)) {
      civilizationState.victory = { kind: 'origin', playerId: actorId, round: state.round,
        tablets: content.sanctuaries.definitions.map(definition => definition.tabletId) };
    }
  }
  return [{ type: 'GuardianChallenged', playerId: actorId, siteId: site.id, challengePower: site.challengePower, teamPower: power, victory, battle }];
}

export function planSanctuaryAction(view: CivilizationView, content: CivilizationContent): CivilizationAction | null {
  const own = view.planning;
  const freeSanctuary = view.sanctuaries.find(site => site.ownerId === null);
  if (!freeSanctuary) return null;
  const establisher = own.units
    .filter(unit => unit.position !== null && unit.position.q === freeSanctuary.position.q && unit.position.r === freeSanctuary.position.r)
    .sort((a, b) => a.id - b.id)[0];
  if (establisher && own.gold >= content.sanctuaries.establishmentCost) {
    return { type: 'EstablishSanctuary', siteId: freeSanctuary.id, unitId: establisher.id };
  }
  return null;
}
