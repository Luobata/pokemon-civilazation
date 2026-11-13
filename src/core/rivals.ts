// Gameplay v24 C (docs/design/world-v24.md §4): one rival trainer per civilization — warning, arrival, round-end actions, rewards, departure.
// Rival Pokémon are ownerless map units listed in `unitTargets`; they hunt only their civilization's Pokémon, never logistics units,
// never take a city below 1 HP and cannot be captured. Placement uses stableSeed; only the city strike's damage roll uses state.rng.
import { RIVAL_COUNTERS, RIVAL_COUNTER_TYPES_V25, RIVAL_LINES, RIVAL_NAMES, RIVAL_RULES_V24, RIVAL_TEAMS } from '../content/rivals.ts';
import { regionalSpeciesIds } from '../content/roster.ts';
import type { StarterId } from '../content/units.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { rivalStayRounds, world24Tuning } from '../content/world24-tuning.ts';
import { stableSeed } from './civilization-systems.ts';
import { resolveAttack } from './combat.ts';
import { dualEffectiveness } from './combat-math.ts';
import { canEnter } from './movement.ts';
import { cityStrengthBreakdown, strengthDamage } from './strength.ts';
import { wallBonus } from './opening.ts';
import { randomBelow } from './rng.ts';
import { cityStrikeTerrain } from './terrain.ts';
import { createMapUnit } from './unit.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit, PlayerView } from './model.ts';
import { landRule, routeDistances } from './reach.ts';
import type { StandRule } from './reach.ts';

/** `encounter`: visits started so far (0–3); `fought`: own Pokémon that dealt damage to (or took a strike back from) this visit's rivals. */
export type RivalLedger = { name: string; encounter: number; pending?: { round: number; cityId: number; tileIndex: number };
  activeUnitIds: number[]; arrivedAtRound?: number; targetCityId?: number; fought?: number[]; outcomes: ('defeated' | 'departed' | 'skipped')[];
  /** v26 duels (depth-v26 §3.1), this visit only: the round of the last duel, a friendly win already paid, the two-visit streak bonus. */
  duelRound?: number; sparRewarded?: true; streak?: true;
  /** v26: the rival's conference appearance (the 4th visit); every duel fought this game (friendly, serious, won). */
  conference?: 'entered' | 'beaten'; duels?: { spar: number; serious: number; won: number } };
/** `unitTargets`: rival unit id -> the civilization it hunts; `spirit`: rival unit id -> its 劲敌气势 bonus. */
export type RivalState = { byPlayer: Record<number, RivalLedger>; unitTargets: Record<number, number>; spirit: Record<number, number> };
/** A rival Pokémon in sight: who it hunts and its public strength bonus. */
export type RivalSighting = { unitId: number; targetPlayerId: number; name: string; spirit: number };
/** Only the target sees its warning and its own ledger (§4.5); rival units in sight are physical and visible to anyone. */
export type RivalView = { name: string; encounter: number; pending?: { round: number; cityId: number; tileIndex: number }; activeUnitIds: number[];
  arrivedAtRound?: number; nextArrival: number | null; outcomes: RivalLedger['outcomes']; sightings: RivalSighting[];
  /** v26 (own ledger only): this visit's last duel round, a friendly win already paid, the streak bonus, the conference appearance. */
  duelRound?: number; sparRewarded?: boolean; streak?: boolean; conference?: RivalLedger['conference']; duels?: RivalLedger['duels'] };
export type RivalEvent =
  | { type: 'RivalAnnounced'; playerId: number; encounter: number; round: number; cityId: number; tileIndex: number }
  | { type: 'RivalArrived'; playerId: number; encounter: number; unitIds: number[]; spirit: number }
  | { type: 'RivalStruckCity'; playerId: number; unitId: number; cityId: number; position: Hex; damage: number; cityHpBefore: number; cityHpAfter: number }
  | { type: 'RivalDefeated'; playerId: number; encounter: number; gold: number; research: number; pokeBalls: number; xpUnitIds: number[]; proof?: true }
  | { type: 'RivalDeparted'; playerId: number; encounter: number }
  | { type: 'RivalSkipped'; playerId: number; encounter: number; reason: 'eliminated' | 'no-site' };

const RULES = RIVAL_RULES_V24;
export function initializeRivals(state: GameState, content: Content): void {
  if (!content.rivals || !state.expansion) return;
  const ids = [...state.turnOrder].sort((a, b) => a - b);
  const names = [...RIVAL_NAMES].sort((a, b) => stableSeed(state.setup.seed, a, 'rival-name') - stableSeed(state.setup.seed, b, 'rival-name') || (a < b ? -1 : 1));
  state.expansion.rivals = { byPlayer: Object.fromEntries(ids.map((id, seat) => [id, { name: names[seat % names.length], encounter: 0, activeUnitIds: [], outcomes: [] }])),
    unitTargets: {}, spirit: {} };
}

export const isRivalUnit = (state: Pick<GameState, 'expansion'>, unitId: number) => state.expansion?.rivals?.unitTargets[unitId] !== undefined;
/** Any rival Pokémon the viewer can see (its own rival's or another civilization's). */
export const viewIsRivalUnit = (view: Pick<PlayerView, 'expansion'>, unitId: number) =>
  view.expansion?.rivals?.sightings.some(sighting => sighting.unitId === unitId) ?? false;
export const viewRivalSighting = (view: Pick<PlayerView, 'expansion'>, unitId: number) => view.expansion?.rivals?.sightings.find(sighting => sighting.unitId === unitId);
/** 劲敌气势 of a unit (0 for everyone but rival Pokémon): authority and preview read the same number. */
export const rivalSpirit = (state: Pick<GameState, 'expansion'>, unitId: number) => state.expansion?.rivals?.spirit[unitId] ?? 0;
export const viewRivalSpirit = (view: Pick<PlayerView, 'expansion'>, unitId: number) => viewRivalSighting(view, unitId)?.spirit ?? 0;

// ---------- schedule, target and spawn tile (§4.1) ----------

/** First visit's target: the capital; later: the city farthest from every other civilization (ties: lower id). */
function targetCity(state: GameState, playerId: number, encounter: number): number | null {
  const own = Object.values(state.cities).filter(city => city.ownerId === playerId).sort((a, b) => a.id - b.id);
  if (!own.length) return null;
  const capital = own.find(city => city.id === state.players[playerId].headquartersCityId);
  if (encounter === 0 && capital) return capital.id;
  const others = Object.values(state.cities).filter(city => city.ownerId !== null && city.ownerId !== playerId);
  const reach = (city: (typeof own)[number]) => others.length ? Math.min(...others.map(other => hexDistance(city.position, other.position, state.map))) : 0;
  return [...own].sort((a, b) => reach(b) - reach(a) || a.id - b.id)[0].id;
}
const occupiedTiles = (state: GameState) => new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)]
  .map(entity => hexToIndex(entity.position, state.map)!));
/** A free land tile 5–7 tiles from the city and reachable from it over land, preferring tiles outside every territory (stableSeed order). */
export function rivalSpawnTile(input: { state: GameState; playerId: number; encounter: number; cityTile: number; canStand: StandRule }): number | null {
  const { state, canStand } = input, map = state.map, city = indexToHex(input.cityTile, map), [low, high] = RULES.spawnDistance;
  const routes = routeDistances(map, input.cityTile, canStand), occupied = occupiedTiles(state);
  const claimed = (index: number) => Object.values(state.cities).some(other => other.ownerId !== null && hexDistance(other.position, indexToHex(index, map), map) <= 2);
  const candidates = [...routes.keys()].filter(index => {
    const distance = hexDistance(city, indexToHex(index, map), map);
    return index !== input.cityTile && distance >= low && distance <= high && !occupied.has(index);
  });
  return candidates.sort((a, b) => Number(claimed(a)) - Number(claimed(b))
    || stableSeed(state.setup.seed, input.playerId, input.encounter, a, 'rival-spawn') - stableSeed(state.setup.seed, input.playerId, input.encounter, b, 'rival-spawn') || a - b)[0] ?? null;
}
/** Free land tiles nearest `from` (for a team, or when the warned tile is taken), reachable from the city. */
function freeTilesNear(state: GameState, from: number, cityTile: number, canStand: StandRule, speciesIds: readonly SpeciesId[], content: Content): number[] {
  const routes = routeDistances(state.map, cityTile, canStand), occupied = occupiedTiles(state), origin = indexToHex(from, state.map);
  const order = [...routes.keys()].filter(index => index !== cityTile && !occupied.has(index))
    .sort((a, b) => hexDistance(origin, indexToHex(a, state.map), state.map) - hexDistance(origin, indexToHex(b, state.map), state.map) || a - b);
  const chosen: number[] = [];
  for (const speciesId of speciesIds) {
    const index = order.find(tile => !chosen.includes(tile) && canEnter({ kind: 'pokemon', speciesId }, state.map.tiles[tile], content, { map: state.map, index: tile }));
    if (index !== undefined) chosen.push(index);
  }
  return chosen;
}
/** A counter list: the v24 lines, or (v25) the regional land species of the counter type (primary type first, else secondary). */
export function rivalCounters(content: Content, starterId: StarterId, list: 'primary' | 'secondary'): readonly SpeciesId[] {
  if (!content.regionalDex) return RIVAL_COUNTERS[starterId][list];
  const type = RIVAL_COUNTER_TYPES_V25[starterId][list];
  const land = [...regionalSpeciesIds(content)].sort().filter(id => content.species[id].role !== 'naval' && content.species[id].terrain.includes('grassland'));
  const primary = land.filter(id => content.species[id].typeId === type);
  return primary.length ? primary : land.filter(id => content.species[id].secondaryTypeId === type);
}
/**
 * v26 (gate-v26 fix 2): the first visit's species — regional land species neutral to the starter both ways: the best type of either side
 * hits the other at exactly ×1 on the plain type chart (with the relay's research bonus a ×2 × ×0.5 dual matchup is ×1.1, for both alike). At the first visit 80% of civilizations own only their starter, which a counter
 * beats outright; a neutral rival leaves the duel to stats and the 劲敌气势 offset. Empty when no regional species qualifies (counters then).
 */
export function rivalNeutrals(content: Content, starterId: StarterId): readonly SpeciesId[] {
  const starter = content.species[starterId], types = (species: typeof starter) => [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
  const neutral = (attack: readonly TypeId[], defense: readonly TypeId[]) => Math.max(...attack.map(type => dualEffectiveness(type, defense))) === 100;
  return [...regionalSpeciesIds(content)].sort().filter(id => {
    const species = content.species[id];
    return species && species.role !== 'naval' && species.terrain.includes('grassland') && neutral(types(species), types(starter)) && neutral(types(starter), types(species));
  });
}
/** The visit's team: counters to the target's starter, by stage (§4.1), picked with stableSeed; v26: the first visit is neutral (above). */
export function rivalTeam(state: GameState, playerId: number, encounter: number, content: Content): SpeciesId[] {
  const starterId = state.players[playerId].starterId;
  const neutrals = content.rivalDuels && encounter === 0 ? rivalNeutrals(content, starterId) : [];
  return RIVAL_TEAMS[encounter].map((slot, index) => {
    const list = neutrals.length ? neutrals : rivalCounters(content, starterId, slot.list);
    const pool = [0, -1, -2, 1].map(offset => list.filter(id => content.species[id]?.stage === slot.stage + offset)).find(found => found.length) ?? [...list];
    return pool[stableSeed(state.setup.seed, playerId, encounter, index, 'rival-team') % pool.length];
  });
}
/** 劲敌气势 for this visit: clamp(S + offset − species attack, ±cap), S = the target's second-highest attack among its map Pokémon. */
export function spiritFor(state: GameState, playerId: number, encounter: number, speciesId: SpeciesId, content: Content): number {
  const attacks = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === playerId && unit.kind === 'pokemon')
    .map(unit => content.species[(unit as Extract<MapUnit, { kind: 'pokemon' }>).speciesId].attack).sort((a, b) => b - a);
  const strength = attacks.length > 1 ? attacks[1] : attacks[0] ?? 0;
  return Math.max(-RULES.strengthCap, Math.min(RULES.strengthCap, strength + world24Tuning(content).rivalStrengthOffsets[encounter] - content.species[speciesId].attack));
}

// ---------- round end ----------

const ledgerOf = (state: GameState, playerId: number) => state.expansion!.rivals!.byPlayer[playerId];
function forget(state: GameState, unitIds: readonly number[]): void {
  const rivals = state.expansion!.rivals!;
  for (const id of unitIds) { delete rivals.unitTargets[id]; delete rivals.spirit[id]; }
}
/** A visit whose rival Pokémon are all knocked down: the target's reward (§4.1). Called after every command and at round end. */
function settleDefeats(state: GameState): EventPayload[] {
  const rivals = state.expansion?.rivals;
  if (!rivals) return [];
  const events: EventPayload[] = [];
  for (const playerId of Object.keys(rivals.byPlayer).map(Number).sort((a, b) => a - b)) {
    const ledger = rivals.byPlayer[playerId];
    if (!ledger.activeUnitIds.length) continue;
    const alive = ledger.activeUnitIds.filter(id => { const unit = state.units[id]; return unit !== undefined && isMapUnit(unit) && unit.ownerId === null; });
    forget(state, ledger.activeUnitIds.filter(id => !alive.includes(id)));
    ledger.activeUnitIds = alive;
    if (alive.length) continue;
    events.push(...settleVisit(state, playerId, {}));
  }
  return events;
}
/** A visit beaten (all rival Pokémon down, or a won serious duel): the reward, the outcome, the ledger cleared. */
function settleVisit(state: GameState, playerId: number, options: { goldPercent?: number; proof?: true }): EventPayload[] {
  const ledger = ledgerOf(state, playerId), visit = ledger.encounter - 1, reward = RULES.rewards[visit] as { gold: number; pokeBalls?: number; research?: number; xp?: number };
  const player = state.players[playerId], fought = (ledger.fought ?? []).filter(id => state.units[id]?.ownerId === playerId);
  delete ledger.arrivedAtRound; delete ledger.targetCityId; delete ledger.fought;
  clearDuels(ledger);
  ledger.outcomes.push('defeated');
  if (player.eliminated) return [];
  const gold = Math.floor(reward.gold * (options.goldPercent ?? 100) / 100);
  player.gold += gold;
  player.ballInventory.pokeBall += reward.pokeBalls ?? 0;
  player.research.reserve += reward.research ?? 0;
  for (const id of reward.xp ? fought : []) state.units[id]!.xp += reward.xp!;
  return [{ type: 'RivalDefeated', playerId, encounter: ledger.encounter, gold, research: reward.research ?? 0, pokeBalls: reward.pokeBalls ?? 0,
    xpUnitIds: reward.xp ? fought : [], ...(options.proof ? { proof: true as const } : {}) }];
}
/** v26: the duel notes belong to one visit. */
function clearDuels(ledger: RivalLedger): void {
  delete ledger.duelRound; delete ledger.sparRewarded; delete ledger.streak;
}
/** v26 (depth-v26 §3.1): a won serious duel ends the visit — the rival team leaves the map and the visit is settled as beaten. */
export function defeatRivalVisit(state: GameState, playerId: number, options: { goldPercent?: number; proof?: true }): EventPayload[] {
  const ledger = ledgerOf(state, playerId);
  for (const id of ledger.activeUnitIds) delete state.units[id];
  forget(state, ledger.activeUnitIds);
  ledger.activeUnitIds = [];
  return settleVisit(state, playerId, options);
}
function nearestOwnCity(state: GameState, playerId: number, from: Hex) {
  return Object.values(state.cities).filter(city => city.ownerId === playerId)
    .sort((a, b) => hexDistance(from, a.position, state.map) - hexDistance(from, b.position, state.map) || a.id - b.id)[0];
}
/** One rival Pokémon's turn: strike the hunted civilization's Pokémon in range (the one it hits hardest), else its city (never below 1 HP),
 *  else walk toward the target city. Logistics units are ignored. */
function actRival(state: GameState, unit: MapUnit & { kind: 'pokemon' }, playerId: number, canStand: StandRule, content: Content): EventPayload[] {
  const ledger = ledgerOf(state, playerId), map = state.map, species = content.species[unit.speciesId];
  const types = (target: MapUnit) => target.kind === 'pokemon' ? [content.species[target.speciesId].typeId, ...(content.species[target.speciesId].secondaryTypeId ? [content.species[target.speciesId].secondaryTypeId!] : [])] : [];
  const prey = Object.values(state.units).filter(isMapUnit).filter(target => target.ownerId === playerId && target.kind === 'pokemon'
    && hexDistance(unit.position, target.position, map) <= species.range)
    .sort((a, b) => dualEffectiveness(species.typeId, types(b), true) - dualEffectiveness(species.typeId, types(a), true) || a.hp - b.hp || a.id - b.id)[0];
  if (prey) return resolveAttack(state, unit.id, { kind: 'unit', id: prey.id }, content, true);
  let city = ledger.targetCityId === undefined ? undefined : state.cities[ledger.targetCityId];
  if (!city || city.ownerId !== playerId) {
    city = nearestOwnCity(state, playerId, unit.position);
    if (!city) return [];
    ledger.targetCityId = city.id;
  }
  const struck = Object.values(state.cities).filter(other => other.ownerId === playerId && other.hp > 1 && hexDistance(unit.position, other.position, map) <= species.range)
    .sort((a, b) => Number(b.id === city!.id) - Number(a.id === city!.id) || a.id - b.id)[0];
  if (struck) {
    const from = map.tiles[hexToIndex(unit.position, map)!], to = map.tiles[hexToIndex(struck.position, map)!];
    const capital = state.players[playerId].headquartersCityId === struck.id;
    const breakdown = cityStrengthBreakdown(unit, from, to, content, [], content.opening ? wallBonus(state.round, capital) : 0,
      cityStrikeTerrain(map, unit, struck.position, content), rivalSpirit(state, unit.id));
    const damage = strengthDamage(breakdown, 85 + randomBelow(state.rng, 16), false, struck.hp), before = struck.hp;
    struck.hp = Math.max(1, struck.hp - damage);
    unit.actionLeft = 0;
    return [{ type: 'RivalStruckCity', playerId, unitId: unit.id, cityId: struck.id, position: { ...struck.position }, damage, cityHpBefore: before, cityHpAfter: struck.hp }];
  }
  if (hexDistance(unit.position, city.position, map) <= species.range) return [];
  // v24: walk the land route to the city (around water, peaks and landmarks); rivals never embark, so the passage carries no water access.
  // Tiles off the route (or before v24) fall back to the straight hex distance.
  const route = map.features ? routeDistances(map, hexToIndex(city.position, map)!, canStand) : null;
  const toward = (index: number, hex: Hex) => route?.get(index) ?? (route ? Infinity : hexDistance(hex, city!.position, map));
  const path = [{ ...unit.position }];
  for (let step = 0; step < world24Tuning(content).rivalStepsPerRound; step++) {
    const here = hexToIndex(unit.position, map)!, onRoute = route?.has(here) ?? false;
    const occupied = occupiedTiles(state), distance = onRoute ? toward(here, unit.position) : hexDistance(unit.position, city.position, map);
    if (hexDistance(unit.position, city.position, map) <= species.range) break;
    const measure = (index: number, hex: Hex) => onRoute ? toward(index, hex) : hexDistance(hex, city!.position, map);
    const next = neighbors(unit.position, map).map(hex => ({ hex, index: hexToIndex(hex, map) }))
      .filter((item): item is { hex: Hex; index: number } => item.index !== null && canStand(item.index) && !occupied.has(item.index)
        && canEnter(unit, map.tiles[item.index], content, { map, index: item.index }) && measure(item.index, item.hex) < distance)
      .sort((a, b) => measure(a.index, a.hex) - measure(b.index, b.hex) || a.index - b.index)[0];
    if (!next) break;
    unit.position = next.hex;
    path.push({ ...next.hex });
  }
  return path.length > 1 ? [{ type: 'Moved', unitId: unit.id, path }] : [];
}
function announce(state: GameState, playerId: number, canStand: StandRule, content: Content): EventPayload[] {
  const ledger = ledgerOf(state, playerId), arrival = world24Tuning(content).rivalArrivals[ledger.encounter];
  const skip = (reason: 'eliminated' | 'no-site'): EventPayload[] => { ledger.encounter++; ledger.outcomes.push('skipped'); return [{ type: 'RivalSkipped', playerId, encounter: ledger.encounter, reason }]; };
  if (state.players[playerId].eliminated) return skip('eliminated');
  const cityId = targetCity(state, playerId, ledger.encounter);
  if (cityId === null) return skip('eliminated');
  const cityTile = hexToIndex(state.cities[cityId].position, state.map)!;
  const tileIndex = rivalSpawnTile({ state, playerId, encounter: ledger.encounter, cityTile, canStand });
  if (tileIndex === null) return skip('no-site');
  ledger.pending = { round: arrival, cityId, tileIndex };
  return [{ type: 'RivalAnnounced', playerId, encounter: ledger.encounter + 1, round: arrival, cityId, tileIndex }];
}
function arrive(state: GameState, playerId: number, canStand: StandRule, content: Content): EventPayload[] {
  const rivals = state.expansion!.rivals!, ledger = ledgerOf(state, playerId), pending = ledger.pending!, visit = ledger.encounter;
  delete ledger.pending;
  ledger.encounter++;
  const skip = (reason: 'eliminated' | 'no-site'): EventPayload[] => { ledger.outcomes.push('skipped'); return [{ type: 'RivalSkipped', playerId, encounter: ledger.encounter, reason }]; };
  if (state.players[playerId].eliminated) return skip('eliminated');
  // The warned city may have changed hands: fall back to the same choice among the cities left.
  const cityId = state.cities[pending.cityId]?.ownerId === playerId ? pending.cityId : targetCity(state, playerId, visit);
  if (cityId === null) return skip('eliminated');
  const cityTile = hexToIndex(state.cities[cityId].position, state.map)!, team = rivalTeam(state, playerId, visit, content);
  const tiles = freeTilesNear(state, pending.tileIndex, cityTile, canStand, team, content);
  if (!tiles.length) return skip('no-site');
  const unitIds: number[] = [];
  // v26 (depth-v26 §3.1): after two visits beaten in a row the rival comes back fired up (+3 气势) and pays more (×1.25).
  const streak = Boolean(content.rivalDuels) && ledger.outcomes.length >= 2 && ledger.outcomes.slice(-2).every(outcome => outcome === 'defeated');
  if (streak) ledger.streak = true;
  for (const [index, tile] of tiles.entries()) {
    const id = state.nextEntityId++, unit = createMapUnit({ kind: 'pokemon', speciesId: team[index] }, id, null, indexToHex(tile, state.map), content);
    unit.wildHome = null;
    state.units[id] = unit;
    rivals.unitTargets[id] = playerId;
    rivals.spirit[id] = spiritFor(state, playerId, visit, team[index], content) + (streak ? 3 : 0);
    unitIds.push(id);
  }
  Object.assign(ledger, { activeUnitIds: unitIds, arrivedAtRound: pending.round, targetCityId: cityId, fought: [] });
  return [{ type: 'RivalArrived', playerId, encounter: ledger.encounter, unitIds, spirit: rivals.spirit[unitIds[0]] }];
}
/** Round end, right after the world's rampages: rival moves and strikes, departures after six rounds, arrivals, then warnings. */
export function resolveRivalRound(state: GameState, content: Content, canStand: StandRule = landRule(state.map)): EventPayload[] {
  const rivals = state.expansion?.rivals;
  if (!rivals || !content.rivals) return [];
  const events = settleDefeats(state);
  for (const playerId of Object.keys(rivals.byPlayer).map(Number).sort((a, b) => a - b)) {
    const ledger = rivals.byPlayer[playerId];
    if (ledger.activeUnitIds.length) {
      for (const id of [...ledger.activeUnitIds].sort((a, b) => a - b)) {
        const unit = state.units[id];
        if (unit && isMapUnit(unit) && unit.kind === 'pokemon' && unit.ownerId === null && !state.players[playerId].eliminated) events.push(...actRival(state, unit, playerId, canStand, content));
        if (state.outcome) return events;
      }
      events.push(...settleDefeats(state));
      if (ledger.activeUnitIds.length && (state.round >= (ledger.arrivedAtRound ?? 0) + rivalStayRounds(content, ledger.encounter - 1) - 1 || state.players[playerId].eliminated)) {
        for (const id of ledger.activeUnitIds) delete state.units[id];
        forget(state, ledger.activeUnitIds);
        ledger.activeUnitIds = [];
        delete ledger.arrivedAtRound; delete ledger.targetCityId; delete ledger.fought;
        clearDuels(ledger);
        ledger.outcomes.push('departed');
        events.push({ type: 'RivalDeparted', playerId, encounter: ledger.encounter });
      }
    }
    if (ledger.pending && state.round + 1 >= ledger.pending.round) events.push(...arrive(state, playerId, canStand, content));
    const next = world24Tuning(content).rivalArrivals[ledger.encounter];
    if (!ledger.pending && !ledger.activeUnitIds.length && next !== undefined && state.round + 1 >= next - RULES.warningRounds) events.push(...announce(state, playerId, canStand, content));
  }
  return events;
}
/** After every command: who fought this visit's rivals, and a visit cleared by a knockdown (so the era score sees it). */
export function recordRivals(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  const rivals = after.expansion?.rivals;
  if (!rivals) return [];
  for (const event of events) {
    if (event.type !== 'BattleResolved' || event.target.kind !== 'unit') continue;
    const attacker = before.units[event.attackerId], defender = before.units[event.target.id];
    const hunted = (id: number) => before.expansion?.rivals?.unitTargets[id];
    const note = (playerId: number | undefined, unitId: number) => {
      const ledger = playerId === undefined ? undefined : rivals.byPlayer[playerId];
      if (ledger?.fought && !ledger.fought.includes(unitId)) ledger.fought = [...ledger.fought, unitId].sort((a, b) => a - b);
    };
    if (hunted(event.target.id) !== undefined && attacker?.ownerId === hunted(event.target.id) && event.damage > 0) note(attacker.ownerId!, attacker.id);
    if (hunted(event.attackerId) !== undefined && defender?.ownerId === hunted(event.attackerId) && event.counterDamage > 0) note(defender.ownerId!, defender.id);
  }
  return settleDefeats(after);
}

/** The target's own ledger and warning, plus every rival Pokémon in sight. */
export function observeRivals(state: GameState, playerId: number, visible: ReadonlySet<number>, content?: Content): RivalView | undefined {
  const rivals = state.expansion?.rivals, ledger = rivals?.byPlayer[playerId];
  if (!rivals || !ledger) return undefined;
  const sightings = Object.keys(rivals.unitTargets).map(Number).sort((a, b) => a - b).flatMap(unitId => {
    const unit = state.units[unitId];
    if (!unit || !isMapUnit(unit) || !visible.has(hexToIndex(unit.position, state.map)!)) return [];
    const target = rivals.unitTargets[unitId];
    return [{ unitId, targetPlayerId: target, name: rivals.byPlayer[target].name, spirit: rivals.spirit[unitId] ?? 0 }];
  });
  return { name: ledger.name, encounter: ledger.encounter, ...(ledger.pending ? { pending: { ...ledger.pending } } : {}), activeUnitIds: [...ledger.activeUnitIds],
    ...(ledger.arrivedAtRound !== undefined ? { arrivedAtRound: ledger.arrivedAtRound } : {}),
    nextArrival: ledger.pending?.round ?? world24Tuning(content).rivalArrivals[ledger.encounter] ?? null, outcomes: [...ledger.outcomes], sightings,
    ...(ledger.duelRound !== undefined ? { duelRound: ledger.duelRound } : {}), ...(ledger.sparRewarded ? { sparRewarded: true } : {}),
    ...(ledger.streak ? { streak: true } : {}), ...(ledger.conference ? { conference: ledger.conference } : {}), ...(ledger.duels ? { duels: { ...ledger.duels } } : {}) };
}
/** Original lines for a visit (1-based). */
export const rivalLines = (encounter: number) => RIVAL_LINES[Math.max(0, Math.min(RIVAL_LINES.length - 1, encounter - 1))];
