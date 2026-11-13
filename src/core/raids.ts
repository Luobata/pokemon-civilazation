// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): Max Raid dens — from round 90 every 20 rounds a regional stage-3 or rare species at a
// public site, fought with ordinary attacks; the top damage dealer gets it. The boss is a wild unit that never moves (src/core/wild.ts
// skips it), strikes every adjacent unit at the end of each round, cannot be caught, and leaves after `raidRounds` rounds. Sites and
// species come from `stableSeed` (never `state.rng`); the ledger is public, the site only reaches civilizations that explored it.
import { ERA_MILESTONES } from '../content/era-honors.ts';
import { lateTuning } from '../content/depth-v26.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { regionalSpeciesIds } from '../content/roster.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { resolveAttack } from './combat.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';
import { canEnterTile } from './movement.ts';
import { adjacentLandmarks } from './landmarks.ts';
import { placementBlocked, stateProtectedCivilian } from './stacking.ts';
import { isLandmarkTile, isPeak } from './terrain.ts';
import { createMapUnit, registerSpecies } from './unit.ts';

export type RaidBoss = { unitId: number; tileIndex: number; endsAtRound: number; damage: Record<number, number>; speciesId: SpeciesId; maxHp: number; index: number };
/** `pending`: the next den, announced `raidAnnounce` rounds before it opens (site and species fixed then). */
export type RaidDen = { tileIndex: number; speciesId: SpeciesId; round: number; index: number };
export type RaidState = { active: RaidBoss | null; held: number; pending: RaidDen | null };
/** `tileIndex` / `unitId` only for civilizations that explored the den's tile; the damage ledger is public. */
export type RaidView = { nextRound: number | null; held: number; pending: { tileIndex: number | null; speciesId: SpeciesId; round: number } | null;
  active: { unitId: number | null; tileIndex: number | null; endsAtRound: number; damage: Record<number, number>; speciesId: SpeciesId; maxHp: number } | null };
export type RaidEvent =
  | { type: 'RaidAnnounced'; playerId: number; speciesId: SpeciesId; tileIndex: number | null; round: number }
  | { type: 'RaidAppeared'; playerId: number; speciesId: SpeciesId; tileIndex: number | null; endsAtRound: number; hp: number }
  | { type: 'RaidDefeated'; public: true; playerId: number; speciesId: SpeciesId; unitId: number | null; damage: Record<number, number>; gold: Record<number, number> }
  | { type: 'RaidEnded'; speciesId: SpeciesId; damage: Record<number, number> };

export const isRaidUnit = (state: Pick<GameState, 'expansion'>, unitId: number) => state.expansion?.raids?.active?.unitId === unitId;
export const viewIsRaidUnit = (view: Pick<PlayerView, 'expansion'>, unitId: number) => view.expansion?.raids?.active?.unitId === unitId;
export function initializeRaids(state: GameState, content: Content): void {
  if (content.raids && state.expansion) state.expansion.raids = { active: null, held: 0, pending: null };
}
/** Raid rounds of a game: `raidFirstRound`, then every `raidInterval`, within the round limit. */
export function raidRounds(content: Content, roundLimit: number): number[] {
  const tuning = lateTuning(content), rounds: number[] = [];
  for (let round = tuning.raidFirstRound; round <= roundLimit; round += tuning.raidInterval) rounds.push(round);
  return rounds;
}
const nextRaidRound = (content: Content, round: number, roundLimit: number) => raidRounds(content, roundLimit).find(item => item >= round) ?? null;
const alive = (state: GameState) => state.turnOrder.filter(id => !state.players[id].eliminated);

/** The den of raid `index`: a land tile ≥ `raidCapitalDistance` from every living capital, preferring the reach of a nest or overlord. */
function raidSite(state: GameState, index: number, content: Content): { tileIndex: number; speciesId: SpeciesId } | null {
  const tuning = lateTuning(content), world = state.expansion!.world;
  const capitals = alive(state).map(id => state.cities[state.players[id].headquartersCityId]?.position).filter(position => position !== undefined);
  const units = new Set(Object.values(state.units).filter(isMapUnit).map(unit => hexToIndex(unit.position, state.map)));
  const taken = new Set<number>([...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!),
    ...Object.values(world.nests).map(site => site.tileIndex), ...Object.values(world.overlords).map(site => site.tileIndex),
    ...(state.expansion!.gymCircuit?.gyms.map(gym => gym.tileIndex) ?? []), ...state.expansion!.civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!),
    ...Object.values(state.expansion!.legends?.sites ?? {}) as number[]]);
  const anchors = [...Object.values(world.nests), ...Object.values(world.overlords)].map(site => site.position);
  const pool = regionalSpeciesIds(content).filter(id => content.species[id] && (content.species[id].stage === 3 || content.species[id].rare) && content.species[id].role !== 'naval')
    .slice().sort();
  const order = state.map.tiles.map((_, tile) => tile).filter(tile => state.map.tiles[tile] !== 'ocean' && !units.has(tile) && !taken.has(tile)
    && !isPeak(state.map, tile) && !isLandmarkTile(state.map, tile) && !adjacentLandmarks(state.map, tile).length
    && capitals.every(capital => hexDistance(capital, indexToHex(tile, state.map), state.map) >= tuning.raidCapitalDistance)
    && Object.values(state.cities).every(city => hexDistance(city.position, indexToHex(tile, state.map), state.map) >= 3))
    .sort((a, b) => stableSeed(state.setup.seed, index, a, 'raid-site') - stableSeed(state.setup.seed, index, b, 'raid-site') || a - b);
  const near = (tile: number) => anchors.some(anchor => hexDistance(anchor, indexToHex(tile, state.map), state.map) <= 2);
  for (const tile of [...order.filter(near), ...order.filter(tile => !near(tile))]) {
    const fits = pool.filter(id => canEnterTile({ kind: 'pokemon', speciesId: id }, state.map, tile, content));
    if (fits.length) return { tileIndex: tile, speciesId: fits[stableSeed(state.setup.seed, index, 'raid-species') % fits.length] };
  }
  return null;
}

/** Round end: strike the units next to the boss, let an expired boss leave, open the next den on the round before a raid round. */
export function resolveRaidRound(state: GameState, content: Content): EventPayload[] {
  const raids = state.expansion?.raids;
  if (!raids || !content.raids || state.outcome) return [];
  const events: EventPayload[] = [];
  const boss = raids.active;
  if (boss && state.units[boss.unitId]) {
    const unit = state.units[boss.unitId];
    if (isMapUnit(unit)) for (const target of Object.values(state.units).filter(isMapUnit)
      .filter(other => other.ownerId !== null && hexDistance(other.position, unit.position, state.map) === 1 && !stateProtectedCivilian(state, other, content))
      .sort((a, b) => a.id - b.id)) {
      if (!state.units[boss.unitId] || !isMapUnit(state.units[boss.unitId]) || !state.units[target.id] || !isMapUnit(state.units[target.id])) continue;
      events.push(...resolveAttack(state, boss.unitId, { kind: 'unit', id: target.id }, content, true));
    }
    // A boss knocked out by a counter-strike is awarded by recordRaids (it sees these events); an expired one leaves now.
    if (state.units[boss.unitId] && state.round >= boss.endsAtRound) {
      delete state.units[boss.unitId];
      raids.active = null;
      events.push({ type: 'RaidEnded', speciesId: boss.speciesId, damage: { ...boss.damage } });
    }
  }
  // Announce the next den `raidAnnounce` rounds ahead (site and species fixed now), then open it on its round.
  const tuning = lateTuning(content), next = nextRaidRound(content, state.round + 1, state.setup.roundLimit ?? 100);
  const explored = (playerId: number, tile: number) => state.knowledge[playerId]?.exploredTileIds.includes(tile) ?? false;
  if (!raids.pending && next !== null && next - (state.round + 1) === Math.min(tuning.raidAnnounce, tuning.raidInterval - 1)) {
    const site = raidSite(state, raids.held, content);
    if (site) {
      raids.pending = { tileIndex: site.tileIndex, speciesId: site.speciesId, round: next, index: raids.held };
      for (const playerId of [...alive(state)].sort((a, b) => a - b)) events.push({ type: 'RaidAnnounced', playerId, speciesId: site.speciesId,
        tileIndex: explored(playerId, site.tileIndex) ? site.tileIndex : null, round: next });
    }
  }
  const den = raids.pending;
  if (!raids.active && den && den.round === state.round + 1) {
    raids.pending = null;
    const tile = denTile(state, den, content);
    if (tile !== null) {
      const id = state.nextEntityId++, position = indexToHex(tile, state.map);
      state.units[id] = { ...createMapUnit({ kind: 'pokemon', speciesId: den.speciesId }, id, null, position, content), hp: tuning.raidBaseHp + tuning.raidHpPerCiv * alive(state).length };
      raids.active = { unitId: id, tileIndex: tile, endsAtRound: den.round + tuning.raidRounds - 1, damage: {}, speciesId: den.speciesId, maxHp: state.units[id].hp, index: den.index };
      raids.held++;
      for (const playerId of [...alive(state)].sort((a, b) => a - b)) {
        events.push({ type: 'RaidAppeared', playerId, speciesId: den.speciesId, tileIndex: explored(playerId, tile) ? tile : null, endsAtRound: raids.active.endsAtRound, hp: state.units[id].hp });
      }
    }
  }
  return events;
}

/** The announced den tile, or (when a unit or city stands there now) the nearest free land tile within 2 that fits the species; null if none. */
function denTile(state: GameState, den: RaidDen, content: Content): number | null {
  const taken = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(item => hexToIndex(item.position, state.map)));
  const identity = { kind: 'pokemon' as const, speciesId: den.speciesId }, center = indexToHex(den.tileIndex, state.map);
  const fits = (tile: number) => !taken.has(tile) && state.map.tiles[tile] !== 'ocean' && !isPeak(state.map, tile) && !isLandmarkTile(state.map, tile) && canEnterTile(identity, state.map, tile, content);
  if (fits(den.tileIndex)) return den.tileIndex;
  const ring = [...new Set([...neighbors(center, state.map), ...neighbors(center, state.map).flatMap(hex => neighbors(hex, state.map))]
    .map(hex => hexToIndex(hex, state.map)).filter((tile): tile is number => tile !== null && tile !== den.tileIndex))];
  return ring.filter(fits).sort((a, b) => hexDistance(indexToHex(a, state.map), center, state.map) - hexDistance(indexToHex(b, state.map), center, state.map) || a - b)[0] ?? null;
}
/** The free tile next to the top damage dealer's city nearest the den (ring 1, then ring 2); null when there is none. */
function rewardTile(state: GameState, playerId: number, speciesId: SpeciesId, den: number, content: Content): number | null {
  const denHex = indexToHex(den, state.map), identity = { kind: 'pokemon' as const, speciesId };
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId)
    .sort((a, b) => hexDistance(a.position, denHex, state.map) - hexDistance(b.position, denHex, state.map) || a.id - b.id);
  const blocked = new Set([...placementBlocked(state, identity, playerId, content), ...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!)]);
  for (const city of cities) {
    const ring1 = neighbors(city.position, state.map), ring2 = ring1.flatMap(hex => neighbors(hex, state.map));
    for (const ring of [ring1, ring2]) {
      const tile = ring.map(hex => hexToIndex(hex, state.map)).filter((index): index is number => index !== null && !blocked.has(index) && canEnterTile(identity, state.map, index, content))
        .sort((a, b) => a - b)[0];
      if (tile !== undefined) return tile;
    }
  }
  return null;
}

/** After every command: credit raid damage (attacks on the boss, counter-strikes against it) and award a knocked-out boss. */
export function recordRaids(before: GameState, after: GameState, events: readonly EventPayload[], content: Content): EventPayload[] {
  const raids = after.expansion?.raids, boss = raids?.active;
  if (!raids || !boss) return [];
  const ownerOf = (id: number) => (before.units[id] ?? after.units[id])?.ownerId ?? null;
  for (const event of events) {
    if (event.type !== 'BattleResolved' || event.target.kind !== 'unit') continue;
    if (event.target.id === boss.unitId) {
      const owner = ownerOf(event.attackerId);
      if (owner !== null) boss.damage[owner] = (boss.damage[owner] ?? 0) + event.damage;
    } else if (event.attackerId === boss.unitId && event.counterDamage > 0) {
      const owner = ownerOf(event.target.id);
      if (owner !== null) boss.damage[owner] = (boss.damage[owner] ?? 0) + event.counterDamage;
    }
  }
  const unit = after.units[boss.unitId];
  if (unit && isMapUnit(unit)) return [];
  // Knocked out: the top damage dealer gets the species and +1 era score; every share of at least the minimum earns gold.
  raids.active = null;
  const tuning = lateTuning(content);
  const ranked = Object.entries(boss.damage).map(([id, damage]) => ({ id: Number(id), damage })).filter(item => !after.players[item.id]?.eliminated)
    .sort((a, b) => b.damage - a.damage || a.id - b.id);
  const total = ranked.reduce((sum, item) => sum + item.damage, 0);
  if (!ranked.length || total <= 0) return [{ type: 'RaidEnded', speciesId: boss.speciesId, damage: { ...boss.damage } }];
  const top = ranked[0].id, gold: Record<number, number> = {};
  for (const item of ranked) if (item.damage * 100 >= tuning.raidMinSharePercent * total) {
    gold[item.id] = Math.min(tuning.raidMaxGold, Math.floor(tuning.raidShareGold * item.damage * 10 / total));
    after.players[item.id].gold += gold[item.id];
  }
  const tile = rewardTile(after, top, boss.speciesId, boss.tileIndex, content);
  let unitId: number | null = null;
  if (tile !== null) {
    unitId = after.nextEntityId++;
    after.units[unitId] = createMapUnit({ kind: 'pokemon', speciesId: boss.speciesId }, unitId, top, indexToHex(tile, after.map), content);
    registerSpecies(after.players[top], after.units[unitId]);
  }
  const honor = after.expansion?.eraHonors?.players[top];
  if (honor) { honor.score += ERA_MILESTONES.raidWon.points; honor.byMilestone.raidWon = (honor.byMilestone.raidWon ?? 0) + 1; }
  return [{ type: 'RaidDefeated', public: true, playerId: top, speciesId: boss.speciesId, unitId, damage: { ...boss.damage }, gold }];
}

export function observeRaids(state: GameState, playerId: number, content: Content): RaidView | undefined {
  const raids = state.expansion?.raids;
  if (!raids) return undefined;
  const boss = raids.active;
  const explored = boss ? state.knowledge[playerId]?.exploredTileIds.includes(boss.tileIndex) ?? false : false;
  const den = raids.pending, knows = (tile: number) => state.knowledge[playerId]?.exploredTileIds.includes(tile) ?? false;
  return { nextRound: boss ? null : den?.round ?? nextRaidRound(content, state.round + 1, state.setup.roundLimit ?? 100), held: raids.held,
    pending: den ? { tileIndex: knows(den.tileIndex) ? den.tileIndex : null, speciesId: den.speciesId, round: den.round } : null,
    active: boss ? { unitId: explored ? boss.unitId : null, tileIndex: explored ? boss.tileIndex : null, endsAtRound: boss.endsAtRound, damage: { ...boss.damage }, speciesId: boss.speciesId, maxHp: boss.maxHp } : null };
}
