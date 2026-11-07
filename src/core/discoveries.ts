import { DISCOVERIES, DISCOVERY_PERCENT } from '../content/discoveries.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { TechId } from '../content/economy.ts';
import { techOf } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { Command, EventPayload, GameState } from './model.ts';

/** gameplayVersion >= 2: per player, discovered milestone tech IDs (sorted). */
export type DiscoveryState = Record<number, TechId[]>;
export type DiscoveryEvent = { type: 'DiscoveryMade'; playerId: number; techId: TechId; bonus: number; progress: number };

export function usesDiscoveries(state: GameState): boolean {
  return state.expansion !== undefined && gameplayAtLeast(state.setup, 2);
}
export function initializeDiscoveries(state: GameState): void {
  if (usesDiscoveries(state)) state.expansion!.discoveries = Object.fromEntries(state.turnOrder.map(id => [id, []]));
}
const documented = (state: GameState, playerId: number) => Object.values(state.expansion?.world.players[playerId]?.pokedex ?? {});

/** Milestones that are true after this transaction for `playerId`, derived from authoritative events and state. */
function reached(before: GameState, next: GameState, playerId: number, events: readonly EventPayload[], content: Content): TechId[] {
  const hits = new Set<TechId>();
  const player = next.players[playerId];
  const own = (id: number) => (before.units[id] ?? next.units[id])?.ownerId === playerId;
  for (const event of events) {
    if (event.type === 'Captured' && event.playerId === playerId && event.success) hits.add('domestication');
    // v21: capturing needs 驯化, so its discovery is a first battle with a wild Pokémon instead.
    if (content.opening && event.type === 'BattleResolved' && own(event.attackerId) && event.target.kind === 'unit' && before.units[event.target.id]?.ownerId === null) hits.add('domestication');
    if (event.type === 'WorldResourceHarvested' && event.playerId === playerId) hits.add(event.resourceKind === 'berry' ? 'berryCultivation' : 'stoneCraft');
    if (event.type === 'TileWorked' && event.playerId === playerId && event.completed) {
      if (event.kind === 'berryFarm') hits.add('berryCultivation');
      if (event.kind === 'mine') hits.add('stoneCraft');
      if (event.kind === 'observatoryCamp') hits.add('fieldObservation');
    }
    if (event.type === 'BattleResolved' && own(event.attackerId)) {
      if (event.target.kind === 'city' && before.cities[event.target.id]?.ownerId !== null && before.cities[event.target.id]?.ownerId !== playerId) hits.add('siegeCraft');
      if ((event.knockdowns ?? []).some(record => record.source.ownerId === playerId && !record.counter && record.effectiveness > 100)) hits.add('typeResearch');
    }
    if ((event.type === 'Evolved' || event.type === 'WorldStoneEvolution') && event.playerId === playerId) hits.add('training');
    if (event.type === 'UnitRecovered' && event.playerId === playerId) hits.add('medicine');
    if ((event.type === 'AllianceChanged' || event.type === 'TradeChanged') && event.status === 'active' && event.playerIds.includes(playerId)) hits.add('leagueRules');
  }
  if (player.registeredSpeciesIds.length >= 4) hits.add('ballCraft');
  if (Object.values(next.cities).filter(city => city.ownerId === playerId).length >= 3) hits.add('riding');
  if (documented(next, playerId).filter(record => record.observed).length >= 10) hits.add('fieldObservation');
  if (Object.values(next.units).some(unit => unit.ownerId === playerId && isMapUnit(unit) && ['snow', 'volcano'].includes(next.map.tiles[hexToIndex(unit.position, next.map)!]))) hits.add('meteorology');
  if (content.techTree) for (const id of treeMilestones(before, next, playerId, events, content)) hits.add(id);
  return [...hits].filter(techId => Object.hasOwn(DISCOVERIES, techId)).sort();
}
/** v22: milestones of the 18 new tree technologies (older contents never call this, so their ledgers are unchanged). */
function treeMilestones(before: GameState, next: GameState, playerId: number, events: readonly EventPayload[], content: Content): TechId[] {
  const hits: TechId[] = [];
  const player = next.players[playerId];
  const cities = Object.values(next.cities).filter(city => city.ownerId === playerId);
  const ownedCity = (id: number) => (next.cities[id] ?? before.cities[id])?.ownerId === playerId;
  const units = Object.values(next.units).filter(unit => unit.ownerId === playerId && unit.kind === 'pokemon');
  const species = new Set<string>([...player.registeredSpeciesIds, ...units.map(unit => unit.kind === 'pokemon' ? unit.speciesId : '')].filter(Boolean));
  const hasType = (type: string) => [...species].some(id => content.species[id]?.typeId === type || content.species[id]?.secondaryTypeId === type);
  const ocean = (index: number) => neighbors(indexToHex(index, next.map), next.map).some(hex => { const at = hexToIndex(hex, next.map); return at !== null && next.map.tiles[at] === 'ocean'; });
  for (const event of events) {
    if (event.type === 'TileWorked' && event.playerId === playerId && event.completed && event.kind === 'fishery') hits.push('seafaring');
    if (event.type === 'BuildingCompleted' && ownedCity(event.cityId)) hits.push('masonry');
    if (event.type === 'Captured' && event.playerId === playerId && !event.success) hits.push('lureCraft');
    if (event.type === 'DistrictCompleted' && ownedCity(event.cityId)) hits.push('laboratory');
    if ((event.type === 'Evolved' || event.type === 'WorldStoneEvolution') && event.playerId === playerId && content.species[event.type === 'Evolved' ? event.speciesId : event.intoSpeciesId]?.stage === 3) hits.push('eliteTraining');
  }
  if (cities.some(city => ocean(hexToIndex(city.position, next.map)!))) hits.push('seafaring');
  if (player.gold >= 100) hits.push('commerce');
  if (hasType('electric')) hits.push('electricity');
  if (cities.some(city => city.population >= 4)) hits.push('contestArts');
  if (hasType('flying')) hits.push('aviation');
  if (cities.length >= 4) hits.push('urbanPlanning');
  if (units.some(unit => unit.kind === 'pokemon' && content.species[unit.speciesId]?.role === 'naval')) hits.push('oceanography');
  if (units.length >= 8) hits.push('breeding');
  if ((next.knowledge[playerId]?.exploredTileIds.length ?? 0) * 100 >= next.map.tiles.length * 30) hits.push('cartography');
  if ((next.expansion?.legends?.clues[playerId]?.length ?? 0) > 0 || next.expansion?.faith?.faiths[playerId]) hits.push('legendLore');
  if (hasType('steel')) hits.push('steelworks');
  if (player.registeredSpeciesIds.length >= 15) hits.push('masterBallTheory');
  if (hasType('dragon')) hits.push('dragonLore');
  if (player.knockdownCount >= 15) hits.push('championLeague');
  return hits;
}
/** Applies newly reached milestones. Unlocked techs are recorded but grant nothing. */
export function recordDiscoveries(before: GameState, next: GameState, _command: Command, events: readonly EventPayload[], content: Content): EventPayload[] {
  const ledger = next.expansion?.discoveries;
  if (!ledger || next.outcome) return [];
  const out: EventPayload[] = [];
  for (const playerId of [...next.turnOrder].sort((a, b) => a - b)) {
    const player = next.players[playerId];
    if (player.eliminated) continue;
    const known = new Set(ledger[playerId]);
    for (const techId of reached(before, next, playerId, events, content)) {
      if (known.has(techId)) continue;
      known.add(techId);
      if (player.research.unlockedIds.includes(techId)) continue;
      const cost = techOf(content, techId).cost, bonus = Math.floor(cost * DISCOVERY_PERCENT / 100);
      // Never completes a technology on its own: completion still happens in round research settlement.
      player.research.progressByTech[techId] = Math.min(cost - 1, player.research.progressByTech[techId] + bonus);
      out.push({ type: 'DiscoveryMade', playerId, techId, bonus, progress: player.research.progressByTech[techId] });
    }
    ledger[playerId] = [...known].sort();
  }
  return out;
}
