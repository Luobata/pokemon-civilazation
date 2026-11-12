import { worldSiteAllowed } from './terrain.ts';
// Gameplay v15: legendary wonders (docs/design/legend-collection-v15.md). Clues are per civilization; each wonder is
// unique in the world, built with city production, and follows its city when the city changes hands.
import { LEGEND_RULES, LEGEND_WONDERS, LEGEND_WONDER_IDS, legendCost } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import { isNight } from '../content/era-abilities.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { CHARTER_IDS, GOVERNMENTS } from '../content/policies.ts';
import type { PolicyEffects } from '../content/policies.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Yield } from '../content/economy.ts';
import type { Content } from '../content/units.ts';
import { contentFor } from '../content/units.ts';
import { stableSeed } from './civilization-systems.ts';
import { workRadius } from './city.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState, PlayerView } from './model.ts';
import { ownedRareBerries } from './rare-berries.ts';
import { playerGeneration } from './roster.ts';

export type LegendWonderRecord = { cityId: number; builderId: number; round: number };
export type LegendState = {
  /** Trace tiles (never removed; every civilization can find a clue there). */
  sites: Partial<Record<LegendWonderId, number>>;
  siteBiomes: Partial<Record<LegendWonderId, BiomeId>>;
  clues: Record<number, LegendWonderId[]>;
  wonders: Partial<Record<LegendWonderId, LegendWonderRecord>>;
};
export type LegendView = {
  /** Trace tiles the viewer currently sees or has explored. */
  sites: { legendId: LegendWonderId; tileIndex: number; biome: BiomeId }[];
  clues: LegendWonderId[];
  /** Built wonders are public; the city is only given for the viewer's own. */
  wonders: { legendId: LegendWonderId; ownerId: number | null; cityId?: number; round: number }[];
  /** The viewer's own cities building a wonder. */
  building: { legendId: LegendWonderId; cityId: number; progress: number; cost: number }[];
  generation: number; maxGeneration: number;
};
export type LegendEvent =
  | { type: 'LegendClueFound'; playerId: number; legendId: LegendWonderId }
  | { type: 'LegendWonderCompleted'; playerId: number; legendId: LegendWonderId; public: true }
  | { type: 'LegendWonderLost'; playerId: number; legendId: LegendWonderId; cityId: number; refund: number };

export const usesLegends = (state: Pick<GameState, 'setup' | 'expansion'>) =>
  state.expansion !== undefined && state.setup.eraProgression !== undefined && gameplayAtLeast(state.setup, 15);
const modeMaxGeneration = (state: Pick<GameState, 'setup'>) => state.setup.eraProgression === 'full-v1' ? 9 : 3;

/** Trace sites are placed with a stable hash, never `state.rng`, so the v15 world equals the v14 world. */
export function initializeLegends(state: GameState): void {
  if (!usesLegends(state)) return;
  const ledger: LegendState = { sites: {}, siteBiomes: {}, clues: Object.fromEntries(state.turnOrder.map(id => [id, []])), wonders: {} };
  const world = state.expansion!.world, civilization = state.expansion!.civilization;
  const taken = new Set<number>([
    ...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!),
    ...Object.values(world.nests).map(site => site.tileIndex), ...Object.values(world.overlords).map(site => site.tileIndex),
    ...Object.values(world.resources).map(site => site.tileIndex),
    ...Object.keys(state.expansion!.rareBerries?.deposits ?? {}).map(Number),
    ...civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!),
  ]);
  const starts = Object.values(state.cities).map(city => city.position);
  const coastal = (index: number) => neighbors(indexToHex(index, state.map), state.map).some(hex => { const i = hexToIndex(hex, state.map); return i !== null && state.map.tiles[i] === 'ocean'; });
  const inner = (index: number) => { const hex = indexToHex(index, state.map); return neighbors(hex, state.map).every(next => hexToIndex(next, state.map) !== null); };
  for (const id of LEGEND_WONDER_IDS) {
    const legend = LEGEND_WONDERS[id], clue = legend.clue;
    if (clue.kind !== 'trace' || legend.generation > modeMaxGeneration(state)) continue;
    const placed = Object.values(ledger.sites) as number[];
    const ok = (index: number, cityDistance: number, biomes: readonly BiomeId[] | null) => {
      const biome = state.map.tiles[index], hex = indexToHex(index, state.map);
      return biome !== 'ocean' && inner(index) && !taken.has(index) && worldSiteAllowed(state.map, index, 'continent') && (biomes === null || biomes.includes(biome)) && (!clue.coastal || coastal(index))
        && starts.every(start => hexDistance(start, hex, state.map) >= cityDistance) && placed.every(other => hexDistance(indexToHex(other, state.map), hex, state.map) >= LEGEND_RULES.siteSpacing);
    };
    const order = state.map.tiles.map((_, index) => index).sort((a, b) => stableSeed(state.setup.seed, id, a, 'legend-site') - stableSeed(state.setup.seed, id, b, 'legend-site') || a - b);
    const attempts: [number, readonly BiomeId[] | null][] = [...clue.biomes.map(biome => [LEGEND_RULES.siteCityDistance, [biome]] as [number, BiomeId[]]),
      [LEGEND_RULES.siteCityDistance, null], [3, null]];
    let site: number | undefined;
    for (const [distance, biomes] of attempts) { site = order.find(index => ok(index, distance, biomes)); if (site !== undefined) break; }
    if (site === undefined) throw new Error(`No tile for the ${id} trace site.`);
    ledger.sites[id] = site; ledger.siteBiomes[id] = state.map.tiles[site]; taken.add(site);
  }
  state.expansion!.legends = ledger;
}

/** Site rule for building a wonder in this city (trace legends follow their placed biome). */
export function legendSiteBiome(ledger: Pick<LegendState, 'siteBiomes'> | { sites: { legendId: LegendWonderId; biome: BiomeId }[] } | undefined, id: LegendWonderId): BiomeId | null {
  const legend = LEGEND_WONDERS[id];
  if (legend.clue.kind === 'trace') {
    if (legend.clue.coastal) return 'ocean';
    const placed = ledger && 'siteBiomes' in ledger ? ledger.siteBiomes[id] : ledger?.sites.find(site => site.legendId === id)?.biome;
    return placed ?? legend.clue.biomes[0];
  }
  return legend.site ?? null;
}
const cityHasBiome = (state: { map: { width: number; height: number; tiles: readonly (BiomeId | null)[] } }, city: Pick<CityState, 'position' | 'population'>, biome: BiomeId) =>
  state.map.tiles.some((tile, index) => tile === biome && hexDistance(city.position, indexToHex(index, state.map), state.map) <= workRadius(city as CityState));

/** Why this city cannot start the wonder (null = it can). */
export function legendWonderBlocker(state: GameState, city: CityState, id: LegendWonderId): string | null {
  const ledger = state.expansion?.legends, ownerId = city.ownerId;
  if (!ledger || ownerId === null) return 'legend-unavailable';
  if (ledger.wonders[id]) return 'legend-built';
  if (!ledger.clues[ownerId]?.includes(id)) return 'legend-no-clue';
  if (playerGeneration(state.players[ownerId], state.setup.eraProgression) < LEGEND_WONDERS[id].generation) return 'legend-generation';
  if (Object.values(state.cities).some(other => other.id !== city.id && other.ownerId === ownerId && other.queue.some(order => order.item.kind === 'legend' && order.item.defId === id))) return 'legend-elsewhere';
  const biome = legendSiteBiome(ledger, id);
  if (biome && !cityHasBiome(state, city, biome)) return 'legend-site';
  return null;
}

/** Completes a wonder order: records it, then cancels the same wonder everywhere else with a half refund. */
export function completeLegendWonder(state: GameState, city: CityState & { ownerId: number }, id: LegendWonderId): EventPayload[] {
  const ledger = state.expansion!.legends!;
  ledger.wonders[id] = { cityId: city.id, builderId: city.ownerId, round: state.round };
  const events: EventPayload[] = [{ type: 'LegendWonderCompleted', playerId: city.ownerId, legendId: id, public: true }];
  for (const other of Object.values(state.cities).sort((a, b) => a.id - b.id)) {
    if (other.ownerId === null) continue;
    for (const order of other.queue.filter(item => item.item.kind === 'legend' && item.item.defId === id)) {
      const refund = Math.floor(order.progress * LEGEND_RULES.lostRefundPermille / 1000);
      state.players[other.ownerId].gold += refund;
      events.push({ type: 'LegendWonderLost', playerId: other.ownerId, legendId: id, cityId: other.id, refund });
    }
    other.queue = other.queue.filter(item => !(item.item.kind === 'legend' && item.item.defId === id));
  }
  return events;
}
export const legendProductionCost = legendCost;

/** City yield bonus of the wonders standing in this city. */
export function legendCityYield(state: Pick<GameState, 'expansion'>, cityId: number): Partial<Yield> {
  const total: Partial<Yield> = {};
  for (const [id, record] of Object.entries(state.expansion?.legends?.wonders ?? {}) as [LegendWonderId, LegendWonderRecord][]) {
    if (record.cityId !== cityId) continue;
    for (const [key, value] of Object.entries(LEGEND_WONDERS[id].cityYield) as [keyof Yield, number][]) total[key] = (total[key] ?? 0) + value;
  }
  return total;
}
const addEffects = (into: PolicyEffects, effects: PolicyEffects) => {
  for (const [key, value] of Object.entries(effects) as [keyof PolicyEffects, number][]) into[key] = (into[key] ?? 0) + value;
  return into;
};
/** Empire-wide effects of the wonders in the player's cities (summed with the other policy effects). */
export function legendEffects(state: Pick<GameState, 'expansion' | 'cities'>, playerId: number): PolicyEffects {
  const total: PolicyEffects = {};
  for (const [id, record] of Object.entries(state.expansion?.legends?.wonders ?? {}) as [LegendWonderId, LegendWonderRecord][]) {
    if (state.cities[record.cityId]?.ownerId === playerId) addEffects(total, LEGEND_WONDERS[id].effects);
  }
  return total;
}
export function viewLegendEffects(view: { playerId: number; expansion?: { legends?: LegendView } }): PolicyEffects {
  const total: PolicyEffects = {};
  for (const wonder of view.expansion?.legends?.wonders ?? []) if (wonder.ownerId === view.playerId) addEffects(total, LEGEND_WONDERS[wonder.legendId].effects);
  return total;
}
export const mergeEffects = (a: PolicyEffects, b: PolicyEffects): PolicyEffects => addEffects({ ...a }, b);

// ---------- clues ----------
const documentedCount = (state: GameState, playerId: number) => Object.values(state.expansion?.world.players[playerId]?.pokedex ?? {})
  .filter(record => record.observed && (record.battled || record.captured)).length;
function speciesTypes(state: GameState, playerId: number, content: Content): number {
  const types = new Set<string>();
  for (const id of state.players[playerId].registeredSpeciesIds) { const s = content.species[id]; if (s) { types.add(s.typeId); if (s.secondaryTypeId) types.add(s.secondaryTypeId); } }
  return types.size;
}
const ownTraits = (state: GameState, playerId: number) => Object.entries(state.expansion?.promotions?.units ?? {})
  .filter(([id]) => state.units[Number(id)]?.ownerId === playerId).map(([, record]) => record.traits as readonly string[]);

/** Whether the player meets a legend's clue condition now (state) or in this command's events. */
export function meetsClue(state: GameState, playerId: number, id: LegendWonderId, events: readonly EventPayload[], content: Content): boolean {
  const clue = LEGEND_WONDERS[id].clue, player = state.players[playerId], exp = state.expansion!;
  const generation = playerGeneration(player, state.setup.eraProgression);
  switch (clue.kind) {
    case 'trace': {
      const site = exp.legends!.sites[id];
      return site !== undefined && player.research.unlockedIds.includes('fieldObservation')
        && Object.values(state.units).some(unit => unit.ownerId === playerId && isMapUnit(unit) && unit.kind === 'pokemon' && hexToIndex(unit.position, state.map) === site);
    }
    case 'tablet': return exp.civilization.tabletOwners[clue.tabletId] === playerId;
    case 'faith': return Object.values(exp.faith?.faiths ?? {}).some(faith => faith.founderId === playerId && faith.legend === id);
    case 'techDistrict': return player.research.unlockedIds.includes(clue.techId)
      && Object.values(exp.districts?.tiles ?? {}).some(tile => tile.kind === clue.districtId && state.cities[tile.cityId]?.ownerId === playerId);
    case 'documented': return documentedCount(state, playerId) >= clue.count;
    case 'goldenAge': return exp.eraHonors?.players[playerId]?.age === 'golden';
    case 'darkAge': return generation >= clue.minGeneration && exp.eraHonors?.players[playerId]?.age === 'dark';
    case 'contestAppeal': return (exp.contests?.[playerId]?.appeal ?? 0) >= clue.count;
    case 'districtKinds': return new Set(Object.values(exp.districts?.tiles ?? {}).filter(tile => state.cities[tile.cityId]?.ownerId === playerId).map(tile => tile.kind)).size >= clue.count;
    case 'discoveries': return (exp.discoveries?.[playerId]?.length ?? 0) >= clue.count;
    case 'rareBerries': return exp.rareBerries !== undefined && Object.values(ownedRareBerries(state, playerId)).filter(count => count > 0).length >= clue.count;
    case 'traits': return ownTraits(state, playerId).some(traits => traits.length >= clue.count);
    case 'traitPair': return ownTraits(state, playerId).some(traits => clue.traits.every(trait => traits.includes(trait)));
    case 'generation': return generation >= clue.generation;
    case 'explored': return state.knowledge[playerId].exploredTileIds.length * 100 >= state.map.tiles.length * clue.percent;
    case 'nightKnockdown': case 'dayKnockdown': {
      if (isNight(state.round) !== (clue.kind === 'nightKnockdown')) return false;
      return events.some(event => event.type === 'BattleResolved' && (event.knockdowns ?? []).some(record => !record.counter && record.source.ownerId === playerId
        && record.source.kind === 'pokemon' && (() => { const unit = state.units[record.source.id]; const s = unit && unit.kind === 'pokemon' ? content.species[unit.speciesId] : null;
          return s !== null && (s.typeId === clue.typeId || s.secondaryTypeId === clue.typeId); })()));
    }
    case 'speciesTypes': return speciesTypes(state, playerId, content) >= clue.count;
    case 'allCharters': return CHARTER_IDS.every(charter => exp.policies?.[playerId]?.adopted.includes(charter));
    case 'tierTwoGovernment': { const government = exp.policies?.[playerId]?.government; return Boolean(government && GOVERNMENTS[government].tier === 2); }
    case 'population': return Object.values(state.cities).filter(city => city.ownerId === playerId).reduce((sum, city) => sum + city.population, 0) >= clue.count;
    case 'knockdowns': return player.knockdownCount >= clue.count;
    case 'improvements': return Object.values(exp.improvements?.tiles ?? {}).filter(tile => tile.builtBy === playerId).length >= clue.count;
    case 'eraAbility': return events.some(event => event.type === 'EraAbilityUsed' && event.playerId === playerId && event.ability === clue.ability);
  }
}

/** Per command, after every other system: new clues (story chapter 1). */
export function recordLegends(after: GameState, events: readonly EventPayload[], content: Content = contentFor(after.setup)): EventPayload[] {
  const ledger = after.expansion?.legends;
  if (!ledger || after.outcome) return [];
  const output: EventPayload[] = [];
  for (const playerId of [...after.turnOrder].sort((a, b) => a - b)) {
    if (after.players[playerId].eliminated) continue;
    const clues = ledger.clues[playerId] ??= [];
    for (const id of LEGEND_WONDER_IDS) {
      if (clues.includes(id) || LEGEND_WONDERS[id].generation > modeMaxGeneration(after) || !meetsClue(after, playerId, id, events, content)) continue;
      clues.push(id);
      output.push({ type: 'LegendClueFound', playerId, legendId: id });
    }
    clues.sort((a, b) => LEGEND_WONDERS[a].dex - LEGEND_WONDERS[b].dex);
  }
  return output;
}

export function observeLegends(state: GameState, playerId: number, visible: ReadonlySet<number>): LegendView | undefined {
  const ledger = state.expansion?.legends;
  if (!ledger) return undefined;
  const explored = new Set(state.knowledge[playerId]?.exploredTileIds ?? []);
  const sites = (Object.entries(ledger.sites) as [LegendWonderId, number][]).filter(([, index]) => visible.has(index) || explored.has(index))
    .map(([legendId, tileIndex]) => ({ legendId, tileIndex, biome: ledger.siteBiomes[legendId]! })).sort((a, b) => a.tileIndex - b.tileIndex);
  const wonders = (Object.entries(ledger.wonders) as [LegendWonderId, LegendWonderRecord][]).map(([legendId, record]) => {
    const ownerId = state.cities[record.cityId]?.ownerId ?? null;
    return { legendId, ownerId, ...(ownerId === playerId ? { cityId: record.cityId } : {}), round: record.round };
  }).sort((a, b) => LEGEND_WONDERS[a.legendId].dex - LEGEND_WONDERS[b.legendId].dex);
  const building = Object.values(state.cities).filter(city => city.ownerId === playerId).sort((a, b) => a.id - b.id)
    .flatMap(city => city.queue.flatMap(order => order.item.kind === 'legend' ? [{ legendId: order.item.defId, cityId: city.id, progress: order.progress, cost: legendCost(order.item.defId) }] : []));
  return { sites, clues: [...(ledger.clues[playerId] ?? [])], wonders, building,
    generation: playerGeneration(state.players[playerId], state.setup.eraProgression), maxGeneration: modeMaxGeneration(state) };
}

export type LegendStartBlocker = 'unavailable' | 'built' | 'no-clue' | 'generation' | 'elsewhere' | 'queued' | 'site';
/** View-side mirror of `legendWonderBlocker` for the UI and AI (null = this city can start it). */
export function viewLegendBlocker(view: PlayerView, city: PlayerView['economy']['cities'][number], id: LegendWonderId): LegendStartBlocker | null {
  const legends = view.expansion?.legends;
  if (!legends) return 'unavailable';
  if (legends.wonders.some(wonder => wonder.legendId === id)) return 'built';
  if (!legends.clues.includes(id)) return 'no-clue';
  if (legends.generation < LEGEND_WONDERS[id].generation) return 'generation';
  if (legends.building.some(item => item.legendId === id && item.cityId !== city.id)) return 'elsewhere';
  if (city.queue.some(order => order.item.kind === 'legend' && order.item.defId === id)) return 'queued';
  const biome = legendSiteBiome(legends, id);
  if (biome && !cityHasBiome(view, city, biome)) return 'site';
  return null;
}
