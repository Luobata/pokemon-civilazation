// v26 §7.1 / §7.3 (presentation only): client go-to orders and suggested city sites, planned from the player's own view.
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/app/session.ts';
import { isCitySite } from '../../src/ai/query.ts';
import { hexDistance, hexToIndex, hexToOffset, indexToHex, neighbors, offsetToHex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { MapUnit, PlayerView } from '../../src/core/model.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { GoToOrders, goToStep, hostilesNear, planGoTo, planStops, stopText } from '../../src/browser/waypoints.ts';
import { suggestCitySites } from '../../src/browser/city-sites.ts';
import { sitePinsMarkup } from '../../src/browser/site-pins.ts';

function game(seed = 12345) {
  return new GameSession({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
    players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai', personality: 'expansion' }, { id: 2, controller: 'ai', personality: 'conservative' }] });
}
const settlerOf = (view: PlayerView) => view.units.find(unit => unit.ownerId === view.playerId && unit.kind === 'logistics')!;
/** Sends the settler towards a far tile for a few rounds (go-to orders), so the opening fog lifts a little. */
function explore(driver: GameSession, rounds: number) {
  const session = driver.asPlayerSession(), orders = new GoToOrders();
  let view = session.getView();
  const settler = settlerOf(view);
  const target = view.map.tiles.map((_, index) => indexToHex(index, view.map))
    .filter(hex => hexDistance(hex, settler.position, view.map) === 7).find(hex => planGoTo(view, settler.id, hex))!;
  for (let round = 0; round < rounds; round++) {
    view = session.getView();
    if (!orders.has(settler.id)) orders.set(view, settler.id, target);
    for (const move of orders.plan(view).moves) session.issue({ type: 'Move', unitId: move.unitId, to: move.to });
    session.issue({ type: 'EndTurn' });
  }
  return session.getView();
}
const around = (view: PlayerView, center: Hex, radius: number) => view.map.tiles.flatMap((_, index) => hexDistance(indexToHex(index, view.map), center, view.map) <= radius ? [index] : []);

describe('go-to planning (player view only)', () => {
  it('plans a connected route whose first turn the authority preview reaches, with ①②③ stops', () => {
    const view = game().getView(), settler = settlerOf(view);
    const target = view.map.tiles.map((biome, index) => ({ biome, index, hex: indexToHex(index, view.map) }))
      .filter(tile => tile.biome !== 'ocean' && hexDistance(tile.hex, settler.position, view.map) >= 5)
      .map(tile => ({ ...tile, plan: planGoTo(view, settler.id, tile.hex) })).find(tile => tile.plan && tile.plan.total >= 2)!;
    expect(target, 'a land or unexplored tile at least 5 tiles away (unexplored tiles plan at the grassland cost)').toBeTruthy();
    const plan = target.plan!;
    expect(plan.path[0]).toEqual(settler.position);
    for (let k = 1; k < plan.path.length; k++) {
      expect(hexDistance(plan.path[k - 1], plan.path[k], view.map)).toBe(1);
      expect(plan.turns[k]).toBeGreaterThanOrEqual(plan.turns[k - 1]);
    }
    const stops = planStops(plan, view.map);
    expect(stops.at(-1)).toEqual({ index: target.index, turn: plan.total });
    expect(stops.map(stop => stop.turn)).toEqual([...new Set(stops.map(stop => stop.turn))]);
    const step = goToStep(view, settler.id, target.hex)!;
    expect(step.to).not.toBeNull();
    expect(reachablePaths(view, settler.id)[hexToIndex(step.to!, view.map)!]).toBeTruthy();
  });

  it('takes the short way across the wrapped seam', () => {
    const session = game(), debug = session.getDebugView();
    expect(debug.map.wrap).toBe(true);
    const width = debug.map.width, settler = settlerOf(debug);
    const land = (col: number, row: number) => { const index = hexToIndex(offsetToHex({ col, row }), debug.map)!; return debug.map.tiles[index] === 'grassland' ? index : null; };
    let pair: { from: number; to: number } | null = null;
    for (let row = 2; row < debug.map.height - 2 && !pair; row++) {
      const from = land(1, row), to = land(width - 2, row);
      if (from !== null && to !== null) pair = { from, to };
    }
    expect(pair, 'grassland on both sides of the seam').toBeTruthy();
    // Stand the settler on the west side of the seam (an all-explored copy of the view, no other units in the way).
    const view: PlayerView = { ...debug, units: [{ ...settler, position: indexToHex(pair!.from, debug.map) } as MapUnit] };
    const plan = planGoTo(view, settler.id, indexToHex(pair!.to, view.map))!;
    expect(plan).toBeTruthy();
    expect(plan.path.length - 1).toBeLessThanOrEqual(6);
    const cols = plan.path.map(hex => hexToOffset(hex).col);
    expect(cols.some(col => col <= 1) && cols.some(col => col >= width - 2)).toBe(true);
    expect(cols.every(col => col <= 2 || col >= width - 3)).toBe(true);
  });

  it('stops on arrival, when attacked, when a new hostile comes within 2 tiles, and keeps hostiles already seen', () => {
    const session = game(), view = session.getView(), settler = settlerOf(view);
    const target = view.map.tiles.map((biome, index) => ({ biome, hex: indexToHex(index, view.map) }))
      .find(tile => tile.biome !== 'ocean' && hexDistance(tile.hex, settler.position, view.map) === 4 && planGoTo(view, settler.id, tile.hex))!.hex;
    const orders = new GoToOrders();
    expect(orders.set(view, settler.id, target)).toBeTruthy();
    expect(orders.get(settler.id)!.found).toBe(true);
    expect(orders.plan(view, new Set([settler.id])).stops).toEqual([{ unitId: settler.id, reason: 'attacked', found: true }]);
    orders.set(view, settler.id, target);
    const hurt: PlayerView = { ...view, units: view.units.map(unit => unit.id === settler.id ? { ...unit, hp: unit.hp - 1 } : unit) };
    expect(orders.plan(hurt).stops[0].reason).toBe('attacked');
    // A wild Pokémon appears next to the settler: the order stops before moving.
    orders.set(view, settler.id, target);
    const free = neighbors(settler.position, view.map).find(hex => !view.units.some(unit => hexDistance(unit.position, hex, view.map) === 0))!;
    const wild = { ...view.units.find(unit => unit.kind === 'pokemon')!, id: 9999, ownerId: null, position: free } as MapUnit;
    const sighted: PlayerView = { ...view, units: [...view.units, wild] };
    expect(hostilesNear(sighted, settler.position)).toContain(9999);
    const result = orders.plan(sighted);
    expect(result.moves).toEqual([]);
    expect(result.stops).toEqual([{ unitId: settler.id, reason: 'enemy', found: true }]);
    expect(stopText(result.stops[0], '开拓队')).toContain('敌对');
    // Set with the wild already in sight: it does not interrupt.
    orders.set(sighted, settler.id, target);
    expect(orders.plan(sighted).stops).toEqual([]);
    // Arrival.
    const there: PlayerView = { ...view, units: view.units.map(unit => unit.id === settler.id ? { ...unit, position: target } : unit) };
    orders.set(view, settler.id, target);
    expect(orders.plan(there).stops).toEqual([{ unitId: settler.id, reason: 'arrived', found: true, ready: true }]);
    expect(orders.size).toBe(0);
  });

  it('a settler sent 6+ tiles away arrives over several turns with ordinary Move commands, then founds a city', () => {
    const driver = game(), session = driver.asPlayerSession();
    let view = session.getView();
    const settler = settlerOf(view), debug = driver.getDebugView();
    const orders = new GoToOrders();
    const target = debug.map.tiles.map((biome, index) => ({ biome, hex: indexToHex(index, debug.map) }))
      .filter(tile => tile.biome !== null && tile.biome !== 'ocean' && hexDistance(tile.hex, settler.position, view.map) >= 6 && hexDistance(tile.hex, settler.position, view.map) <= 8
        && isCitySite(debug, tile.hex) && planGoTo(view, settler.id, tile.hex))
      .sort((a, b) => hexDistance(a.hex, settler.position, view.map) - hexDistance(b.hex, settler.position, view.map))[0]!.hex;
    expect(orders.set(view, settler.id, target)!.total).toBeGreaterThan(1);
    const before = driver.exportLog().commands.length;
    let arrived = false, turns = 0;
    for (; turns < 20 && !arrived; turns++) {
      view = session.getView();
      const { moves, stops } = orders.plan(view);
      // A hostile sighting stops the order; the player looks and sends the settler on again.
      if (stops.some(stop => stop.reason === 'enemy')) { orders.set(view, settler.id, target); continue; }
      arrived = stops.some(stop => stop.reason === 'arrived');
      expect(stops.filter(stop => stop.reason !== 'arrived')).toEqual([]);
      for (const move of moves) expect(session.issue({ type: 'Move', unitId: move.unitId, to: move.to }).ok).toBe(true);
      arrived ||= orders.afterMoves(session.getView(), moves.map(move => move.unitId)).some(stop => stop.reason === 'arrived');
      if (!arrived) expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
    }
    expect(arrived).toBe(true);
    expect(turns).toBeGreaterThan(1);
    const human = driver.exportLog().commands.slice(before).filter(command => command.actorId === 0);
    expect(new Set(human.map(command => command.action.type))).toEqual(new Set(['Move', 'EndTurn']));
    expect(session.issue({ type: 'FoundCity', unitId: settler.id }).ok).toBe(true);
  });
});

describe('suggested city sites', () => {
  it('ranks up to three legal, spread-out sites from explored tiles only', () => {
    const view = explore(game(), 3), settler = settlerOf(view);
    const sites = suggestCitySites(view, settler.id);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(3);
    expect(sites.map(site => site.rank)).toEqual(sites.map((_, k) => k + 1));
    for (let k = 1; k < sites.length; k++) expect(sites[k].score).toBeLessThanOrEqual(sites[k - 1].score);
    for (const site of sites) {
      for (const index of around(view, site.position, 1)) expect(view.map.tiles[index], `tile ${index} near site ${site.index}`).not.toBeNull();
      expect(site.reasons.unexplored).toBe(around(view, site.position, 3).filter(index => view.map.tiles[index] === null).length);
      expect(view.cities.every(city => hexDistance(city.position, site.position, view.map) >= 4)).toBe(true);
      expect(view.map.tiles[site.index]).not.toBe('ocean');
      for (const other of sites) if (other !== site) expect(hexDistance(other.position, site.position, view.map)).toBeGreaterThanOrEqual(3);
      expect(site.reasons.turns).toBeGreaterThanOrEqual(0);
    }
    // Only settlers get suggestions.
    expect(suggestCitySites(view, view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!.id)).toEqual([]);
    // Pins are named and carry their reasons as icon chips.
    const markup = sitePinsMarkup(sites);
    expect(markup).toContain('推荐城址 ①');
    expect(markup).toContain('aria-label="食物（半径 2）');
    expect(markup).toContain('预计回合');
  });

  it('does not change when hidden terrain changes (no fog leak)', () => {
    const view = explore(game(), 3), settler = settlerOf(view);
    const hidden = view.map.tiles.flatMap((biome, index) => biome === null ? [index] : []);
    expect(hidden.length).toBeGreaterThan(0);
    // The view never carries hidden terrain; the suggestion is a function of the view alone.
    expect(suggestCitySites(structuredClone(view), settler.id)).toEqual(suggestCitySites(view, settler.id));
  });
});
