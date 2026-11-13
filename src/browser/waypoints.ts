// Multi-turn go-to orders (docs/design/depth-v26.md §7.1, choice 6A: client-side waypoints). Presentation only: an order is
// client state (never part of the authority, the command log or saves), planned from the player's own view, and carried out
// by issuing ordinary `Move` commands at the start of each of the player's turns. Pure (no DOM), so it is unit-tested in Node.
//
// Path rules are those of `reachablePaths` (src/core/movement.ts): the species / role terrain table with the v24 passage
// (peaks, landmarks, water access, harbours), biome + hill + river step costs, boarding or landing spends what is left, a unit
// that has not moved this round may always enter one adjacent tile (v24), visible hostile zones of control end the move, and
// no unit or foreign city may be entered. Unexplored tiles are assumed passable at the grassland cost (as §7.1 asks), so a
// plan never reads hidden terrain; tiles occupied by visible units count only within this round's reach (they move).
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { canEnter, embarkStep, harborTiles, movementBudget, reachablePaths, tileStepCost, waterAccess } from '../core/movement.ts';
import { inZoc, usesTactics, zocTiles } from '../core/tactics.ts';

/** A planned route: `path` starts on the unit's tile; `turns[k]` is the turn (1 = the next one the unit can move in) path[k] is reached. */
export type GoToPlan = { path: Hex[]; turns: number[]; total: number };
/** The last tile reached in each turn (the ①②③ stops drawn on the route), as tile indices. */
export const planStops = (plan: GoToPlan, map: PlayerView['map']) =>
  plan.path.flatMap((hex, k) => k > 0 && (k === plan.path.length - 1 || plan.turns[k + 1] !== plan.turns[k]) ? [{ index: hexToIndex(hex, map)!, turn: plan.turns[k] }] : []);

/** A unit that founds cities (the bar's 建城 button): logistics that are neither builders nor traders. */
export const isSettler = (unit: MapUnit) => unit.kind === 'logistics' && unit.role !== 'builder' && unit.role !== 'trader';
const ownUnit = (view: PlayerView, unitId: number) => view.units.find(unit => unit.id === unitId && unit.ownerId === view.playerId);
/** Whether the unit can still move in the current round (the viewer's turn, action left). */
const movesNow = (view: PlayerView, unit: MapUnit) => view.activePlayerId === view.playerId && unit.actionLeft > 0;

/** Packed Dijkstra label: turn * SCALE + movement points spent in that turn (never above the budget). */
const SCALE = 1024;
/** Turn-aware labels from a unit to every tile it can reach on known terrain (or until `goal` is settled). */
export type GoToField = { origin: number; labels: Map<number, number>; from: Map<number, number> };
export const fieldTurns = (field: GoToField, index: number): number | null => {
  const label = field.labels.get(index);
  return label === undefined ? null : Math.floor(label / SCALE);
};

/**
 * Turn-aware Dijkstra from the unit over the player's known terrain. Labels are (turn, points spent) compared
 * lexicographically, which a step can only increase, so the first label settled on a tile dominates. `blockAll` also blocks
 * visible units beyond this round's reach (used to re-plan around a blocked route). Null for a unit that cannot move.
 */
export function goToField(view: PlayerView, unitId: number, options: { blockAll?: boolean; content?: Content; goal?: number } = {}): GoToField | null {
  const content = options.content ?? contentForView(view), unit = ownUnit(view, unitId), map = view.map;
  if (!unit) return null;
  const origin = hexToIndex(unit.position, map)!, budget = movementBudget(view, unit, content);
  if (budget <= 0 || budget >= SCALE) return null;
  const features = Boolean(map.features), access = waterAccess(view.economy.player, content), harbors = harborTiles(map, view.cities, view.playerId, content);
  const blocked = new Set<number>();
  for (const city of [...view.cities, ...Object.values(view.knowledge.lastKnownCities)]) if (city.ownerId !== view.playerId) blocked.add(hexToIndex(city.position, map)!);
  for (const other of view.units) if (other.id !== unit.id && (options.blockAll || hexDistance(other.position, unit.position, map) <= budget + 1)) blocked.add(hexToIndex(other.position, map)!);
  const zoc = usesTactics(view) ? zocTiles(unit, view.units, view.diplomacy, content) : [];
  const grass = content.moveCosts.grassland;
  const labels = new Map<number, number>([[origin, SCALE + (movesNow(view, unit) ? unit.movesSpent ?? 0 : 0)]]), from = new Map<number, number>();
  const done = new Set<number>(), heap = new MinHeap();
  heap.push(labels.get(origin)!, origin);
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [label, current] = item;
    if (done.has(current) || label !== labels.get(current)) continue;
    done.add(current);
    if (current === options.goal) break;
    const turn = Math.floor(label / SCALE), spent = label % SCALE;
    for (const hex of neighbors(indexToHex(current, map), map)) {
      const index = hexToIndex(hex, map);
      if (index === null || done.has(index) || blocked.has(index)) continue;
      const biome = map.tiles[index];
      let cost: number;
      if (biome === null) cost = grass;
      else {
        if (!canEnter(unit, biome, content, { map, index, access, harbor: harbors.has(index) })) continue;
        cost = embarkStep(unit, map, current, index, content, harbors) ? -1 : tileStepCost(unit, map, current, index, content);
      }
      // Boarding or landing spends what is left (at least one point); a unit that has not moved this round may always enter
      // one adjacent tile in v24; otherwise a step that does not fit starts the next turn.
      let nextTurn = turn, nextSpent: number;
      if (cost < 0) { if (spent >= budget) nextTurn++; nextSpent = budget; }
      else if (spent + cost <= budget) nextSpent = spent + cost;
      else if (spent === 0 && features) nextSpent = budget;
      else if (cost <= budget) { nextTurn++; nextSpent = cost; }
      else if (features) { nextTurn++; nextSpent = budget; }
      else continue;
      // Entering a visible hostile zone of control ends the move there.
      if (zoc.length && inZoc(hex, zoc, map)) nextSpent = budget;
      const value = nextTurn * SCALE + nextSpent;
      if (value >= (labels.get(index) ?? Infinity)) continue;
      labels.set(index, value); from.set(index, current); heap.push(value, index);
    }
  }
  for (const index of [...labels.keys()]) if (!done.has(index)) { labels.delete(index); from.delete(index); }
  return { origin, labels, from };
}
/** The route from a field's origin to `goal`, or null when the field does not reach it. */
export function fieldPlan(field: GoToField, goal: number, map: PlayerView['map']): GoToPlan | null {
  if (goal === field.origin || !field.labels.has(goal)) return null;
  const indices = [goal];
  while (indices[0] !== field.origin) indices.unshift(field.from.get(indices[0])!);
  const turns = indices.map(index => fieldTurns(field, index)!);
  return { path: indices.map(index => indexToHex(index, map)), turns, total: turns.at(-1)! };
}
/** The planned route from the unit to `target` (see `goToField`), or null when unreachable on known terrain. */
export function planGoTo(view: PlayerView, unitId: number, target: Hex, options: { blockAll?: boolean; content?: Content } = {}): GoToPlan | null {
  const goal = hexToIndex(target, view.map);
  const field = goal === null ? null : goToField(view, unitId, { ...options, goal });
  return field && goal !== null ? fieldPlan(field, goal, view.map) : null;
}

/** Binary min-heap of (label, tile) pairs; ties go to the lower tile index, so plans are deterministic. */
class MinHeap {
  private readonly items: [number, number][] = [];
  private less(a: [number, number], b: [number, number]) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }
  push(label: number, index: number) {
    const items = this.items; items.push([label, index]);
    for (let k = items.length - 1; k > 0;) {
      const parent = (k - 1) >> 1;
      if (!this.less(items[k], items[parent])) break;
      [items[k], items[parent]] = [items[parent], items[k]]; k = parent;
    }
  }
  pop(): [number, number] | undefined {
    const items = this.items, top = items[0], last = items.pop();
    if (!items.length || !last) return top;
    items[0] = last;
    for (let k = 0; ;) {
      const left = 2 * k + 1, right = left + 1;
      let next = k;
      if (left < items.length && this.less(items[left], items[next])) next = left;
      if (right < items.length && this.less(items[right], items[next])) next = right;
      if (next === k) break;
      [items[k], items[next]] = [items[next], items[k]]; k = next;
    }
    return top;
  }
}

/**
 * Where to move this round: the furthest tile of the plan's first turn that `reachablePaths` (the authority's own preview)
 * reaches now; `to` is null when the plan starts next turn (no movement left). Re-plans around visible units when the first
 * leg is blocked. Null when there is no plan, or the unit cannot get closer this round.
 */
export function goToStep(view: PlayerView, unitId: number, target: Hex, content: Content = contentForView(view)): { to: Hex | null; plan: GoToPlan } | null {
  const unit = ownUnit(view, unitId);
  if (!unit || !movesNow(view, unit)) return null;
  const reachable = reachablePaths(view, unitId, content);
  for (const blockAll of [false, true]) {
    const plan = planGoTo(view, unitId, target, { blockAll, content });
    if (!plan) continue;
    if (plan.turns[1] > 1) return { to: null, plan };
    for (let k = plan.path.length - 1; k > 0; k--) {
      if (plan.turns[k] !== 1) continue;
      const index = hexToIndex(plan.path[k], view.map)!;
      if (reachable[index]) return { to: plan.path[k], plan };
    }
  }
  return null;
}

/** Hostile units the viewer can see within `radius` of `position`: wild and rival Pokémon, and units of civilizations at war. */
export function hostilesNear(view: PlayerView, position: Hex, radius = 2): number[] {
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  return view.units.filter(other => other.ownerId !== view.playerId && (other.ownerId === null ? other.kind === 'pokemon' : enemies.has(other.ownerId))
    && hexDistance(other.position, position, view.map) <= radius).map(other => other.id).sort((a, b) => a - b);
}

/** One unit's standing order. `seen`: hostiles already in sight near it (only new ones interrupt); `hp` at the last check. */
export type GoToOrder = { unitId: number; target: Hex; found: boolean; seen: number[]; hp: number };
/** `ready`: on arrival, the unit can still act this round (a settler can found at once). */
export type GoToStop = { unitId: number; reason: 'arrived' | 'blocked' | 'unreachable' | 'attacked' | 'enemy' | 'lost'; found: boolean; ready?: boolean };
export type GoToMove = { unitId: number; to: Hex };

/** Why an order stopped, as the player reads it. */
export function stopText(stop: GoToStop, name: string): string {
  switch (stop.reason) {
    case 'arrived': return stop.found ? `${name}已到达路标：${stop.ready ? '' : '下回合'}点「建城」（B）在此建立城市。` : `${name}已到达路标。`;
    case 'blocked': return `${name}的路线被挡住，路标已取消：请重新下达命令。`;
    case 'unreachable': return `${name}到不了路标（已知地形无路可走），路标已取消。`;
    case 'attacked': return `${name}遭到攻击，路标已取消。`;
    case 'enemy': return `${name}附近出现敌对单位，路标已取消。`;
    case 'lost': return `${name}已不在地图上，路标已取消。`;
  }
}

/**
 * The client's go-to orders for one game (in memory only: a reload starts a new game, and a loaded save is an older
 * position, so orders are never persisted). `attacked` lists unit ids hit since the last check (from battle events).
 */
export class GoToOrders {
  private readonly orders = new Map<number, GoToOrder>();
  get size() { return this.orders.size; }
  ids(): number[] { return [...this.orders.keys()].sort((a, b) => a - b); }
  get(unitId: number): GoToOrder | undefined { return this.orders.get(unitId); }
  has(unitId: number): boolean { return this.orders.has(unitId); }
  cancel(unitId: number): boolean { return this.orders.delete(unitId); }
  clear(): void { this.orders.clear(); }
  /** Sets (or replaces) an order; null when the target cannot be reached on known terrain. */
  set(view: PlayerView, unitId: number, target: Hex, content: Content = contentForView(view)): GoToPlan | null {
    const unit = ownUnit(view, unitId), plan = unit ? planGoTo(view, unitId, target, { content }) : null;
    if (!unit || !plan) return null;
    this.orders.set(unitId, { unitId, target: { ...plan.path.at(-1)! }, found: isSettler(unit),
      seen: hostilesNear(view, unit.position), hp: unit.hp });
    return plan;
  }
  /**
   * Checks every order against the view (arrival, knock-out, attack, new hostiles) and returns this round's moves for the
   * rest. Call at the start of the viewer's turn, then `afterMoves` once the moves are applied.
   */
  plan(view: PlayerView, attacked: ReadonlySet<number> = new Set(), only?: readonly number[], content: Content = contentForView(view)): { moves: GoToMove[]; stops: GoToStop[] } {
    const moves: GoToMove[] = [], stops: GoToStop[] = [];
    for (const order of [...this.orders.values()].filter(item => !only || only.includes(item.unitId))) {
      const stop = this.check(view, order, attacked);
      if (stop) { stops.push(stop); continue; }
      const unit = ownUnit(view, order.unitId)!;
      if (!movesNow(view, unit)) continue;
      const step = goToStep(view, order.unitId, order.target, content);
      if (step) { if (step.to) moves.push({ unitId: order.unitId, to: step.to }); continue; }
      this.orders.delete(order.unitId);
      stops.push({ unitId: order.unitId, reason: planGoTo(view, order.unitId, order.target, { blockAll: true, content }) || planGoTo(view, order.unitId, order.target, { content }) ? 'blocked' : 'unreachable', found: order.found });
    }
    return { moves, stops };
  }
  /** After this round's moves: arrival, and hostiles revealed by the move (the order stops, Civilization-style). */
  afterMoves(view: PlayerView, unitIds: readonly number[]): GoToStop[] {
    const stops: GoToStop[] = [];
    for (const unitId of unitIds) {
      const order = this.orders.get(unitId);
      const stop = order && this.check(view, order, new Set());
      if (stop) stops.push(stop);
    }
    return stops;
  }
  private check(view: PlayerView, order: GoToOrder, attacked: ReadonlySet<number>): GoToStop | null {
    const unit = ownUnit(view, order.unitId);
    const stop = (reason: GoToStop['reason']): GoToStop => { this.orders.delete(order.unitId); return { unitId: order.unitId, reason, found: order.found }; };
    if (!unit) return stop('lost');
    if (attacked.has(unit.id) || unit.hp < order.hp) return stop('attacked');
    if (hexDistance(unit.position, order.target, view.map) === 0) return { ...stop('arrived'), ...(unit.actionLeft ? { ready: true } : {}) };
    const near = hostilesNear(view, unit.position);
    if (near.some(id => !order.seen.includes(id))) return stop('enemy');
    order.hp = unit.hp;
    return null;
  }
}
