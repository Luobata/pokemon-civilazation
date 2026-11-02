import { leaderEffects } from '../content/leaders.ts';
import { IMPROVEMENT_IDS, IMPROVEMENT_WORK, IMPROVEMENTS } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import type { Yield } from '../content/economy.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { Hex } from './hex.ts';
import { workRadius } from './city.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState, PlayerState, PlayerView } from './model.ts';
import { visibleTiles } from './vision.ts';
import { playerPolicyEffects } from './policies.ts';

export type TileImprovement = { kind: ImprovementId; builtBy: number; builtAtRound: number };
export type ImprovementProject = { kind: ImprovementId; playerId: number; progress: number };
/** Present only when setup.gameplayVersion >= 2. */
export type ImprovementState = { tiles: Record<number, TileImprovement>; projects: Record<number, ImprovementProject> };
export type ImprovementAction = { type: 'ImproveTile'; unitId: number; tileIndex: number; kind: ImprovementId };
export type ImprovementEvent = { type: 'TileWorked'; playerId: number; unitId: number; tileIndex: number; position: Hex;
  kind: ImprovementId; progress: number; required: number; completed: boolean };
export type ImprovementView = { tiles: (TileImprovement & { tileIndex: number; position: Hex })[]; projects: (ImprovementProject & { tileIndex: number })[] };

export function usesImprovements(state: GameState): boolean {
  return state.expansion !== undefined && gameplayAtLeast(state.setup, 2);
}
export function initializeImprovements(state: GameState): void {
  if (usesImprovements(state)) state.expansion!.improvements = { tiles: {}, projects: {} };
}
export function isImprovementAction(action: { type: unknown }): action is ImprovementAction {
  return action.type === 'ImproveTile';
}
export function crewPoints(identity: UnitIdentity, content: Content, kind: ImprovementId): number {
  if (identity.kind !== 'pokemon') return 0;
  const species = content.species[identity.speciesId];
  const types = [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
  return types.some(type => IMPROVEMENTS[kind].crewTypes.includes(type)) ? IMPROVEMENT_WORK.crew : IMPROVEMENT_WORK.other;
}
/** Bonus a completed improvement adds to the tile, for the player working it. */
export function improvementYield(kind: ImprovementId, player: Pick<PlayerState, 'research'>): Yield {
  const definition = IMPROVEMENTS[kind], boosted = player.research.unlockedIds.includes(definition.boostTech);
  return { food: definition.base.food + (boosted ? definition.boost.food : 0), production: definition.base.production + (boosted ? definition.boost.production : 0),
    gold: definition.base.gold + (boosted ? definition.boost.gold : 0), research: definition.base.research + (boosted ? definition.boost.research : 0) };
}
export function tileImprovementYield(state: GameState, tileIndex: number, player: Pick<PlayerState, 'research'>): Yield | null {
  const improvement = state.expansion?.improvements?.tiles[tileIndex];
  return improvement ? improvementYield(improvement.kind, player) : null;
}
function ownTerritory(cities: readonly Pick<CityState, 'ownerId' | 'position' | 'population'>[], playerId: number, position: Hex): boolean {
  return cities.some(city => city.ownerId === playerId && hexDistance(city.position, position) <= workRadius(city as CityState) && hexDistance(city.position, position) > 0);
}
/** Shared by authority, UI and AI. Returns a reason code or null. */
export function improvementBlocker(input: { tiles: readonly (string | null)[]; width: number; height: number; cities: readonly Pick<CityState, 'ownerId' | 'position' | 'population'>[];
  improved: (tileIndex: number) => boolean; unitPosition: Hex; playerId: number; tileIndex: number; kind: ImprovementId }): string | null {
  const { tileIndex, kind } = input;
  if (!Object.hasOwn(IMPROVEMENTS, kind)) return 'unknown-improvement';
  const biome = input.tiles[tileIndex];
  if (biome === undefined || biome === null) return 'unknown-tile';
  const position = indexToHex(tileIndex, input);
  if (!IMPROVEMENTS[kind].biomes.includes(biome as never)) return 'wrong-biome';
  const distance = hexDistance(input.unitPosition, position);
  if (biome === 'ocean' ? distance > 1 : distance !== 0) return 'not-on-site';
  if (input.cities.some(city => hexDistance(city.position, position) === 0)) return 'city-center';
  if (!ownTerritory(input.cities, input.playerId, position)) return 'outside-territory';
  if (input.improved(tileIndex)) return 'already-improved';
  return null;
}
export function validateImprovementAction(state: GameState, actorId: number, action: ImprovementAction): string | null {
  const improvements = state.expansion?.improvements;
  if (!usesImprovements(state) || !improvements) return 'improvements-unavailable';
  const unit = state.units[action.unitId];
  if (!unit || unit.ownerId !== actorId || !isMapUnit(unit) || unit.kind !== 'pokemon') return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  if (!Number.isSafeInteger(action.tileIndex) || action.tileIndex < 0 || action.tileIndex >= state.map.tiles.length) return 'unknown-tile';
  if (!visibleTiles(state, actorId).has(action.tileIndex)) return 'unknown-tile';
  return improvementBlocker({ tiles: state.map.tiles, width: state.map.width, height: state.map.height, cities: Object.values(state.cities),
    improved: index => Object.hasOwn(improvements.tiles, index), unitPosition: unit.position, playerId: actorId, tileIndex: action.tileIndex, kind: action.kind });
}
export function applyImprovementAction(state: GameState, actorId: number, action: ImprovementAction, content: Content): EventPayload[] {
  const improvements = state.expansion!.improvements!, unit = state.units[action.unitId];
  if (!isMapUnit(unit)) throw new Error('Expected deployed worker');
  unit.actionLeft = 0;
  const previous = improvements.projects[action.tileIndex];
  const base = previous && previous.kind === action.kind && previous.playerId === actorId ? previous.progress : 0;
  const progress = Math.min(IMPROVEMENT_WORK.required, base + crewPoints(unit, content, action.kind) + playerPolicyEffects(state, actorId).workPointBonus + leaderEffects(state.players[actorId].leaderId).workPointBonus);
  const completed = progress >= IMPROVEMENT_WORK.required;
  if (completed) {
    delete improvements.projects[action.tileIndex];
    improvements.tiles[action.tileIndex] = { kind: action.kind, builtBy: actorId, builtAtRound: state.round };
  } else improvements.projects[action.tileIndex] = { kind: action.kind, playerId: actorId, progress };
  return [{ type: 'TileWorked', playerId: actorId, unitId: unit.id, tileIndex: action.tileIndex, position: indexToHex(action.tileIndex, state.map),
    kind: action.kind, progress, required: IMPROVEMENT_WORK.required, completed }];
}
/** Completed improvements are public map features once seen; projects are private to their builder. */
export function observeImprovements(state: GameState, playerId: number, visible: ReadonlySet<number>): ImprovementView | undefined {
  const improvements = state.expansion?.improvements;
  if (!improvements) return undefined;
  const remembered = state.knowledge[playerId]?.rememberedTiles ?? {};
  return {
    tiles: Object.entries(improvements.tiles).map(([index, value]) => ({ index: Number(index), value }))
      .filter(({ index }) => visible.has(index) || Object.hasOwn(remembered, index))
      .sort((a, b) => a.index - b.index)
      .map(({ index, value }) => ({ ...value, tileIndex: index, position: indexToHex(index, state.map) })),
    projects: Object.entries(improvements.projects).map(([index, value]) => ({ ...value, tileIndex: Number(index) }))
      .filter(project => project.playerId === playerId).sort((a, b) => a.tileIndex - b.tileIndex),
  };
}
/** Improvement choices available to a unit from its own observation (used by UI and AI). */
export function improvementOptions(view: PlayerView, unitId: number, content: Content): { tileIndex: number; kind: ImprovementId; points: number; progress: number }[] {
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  const improvements = view.expansion?.improvements;
  if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft || !improvements) return [];
  const improved = new Set(improvements.tiles.map(tile => tile.tileIndex)), visible = new Set(view.visibleTileIds);
  const here = hexToIndex(unit.position, view.map)!;
  const nearby = [here, ...view.map.tiles.flatMap((_, index) => index !== here && hexDistance(indexToHex(index, view.map), unit.position) === 1 ? [index] : [])];
  return nearby.filter(index => visible.has(index)).flatMap(tileIndex => IMPROVEMENT_IDS.flatMap(kind => improvementBlocker({ tiles: view.map.tiles, width: view.map.width, height: view.map.height,
    cities: [...view.economy.cities.map(city => ({ ownerId: city.ownerId, position: city.position, population: city.population })),
      ...view.cities.filter(city => city.ownerId !== view.playerId).map(city => ({ ownerId: city.ownerId, position: city.position, population: 1 }))],
    improved: index => improved.has(index), unitPosition: unit.position, playerId: view.playerId, tileIndex, kind }) === null
    ? [{ tileIndex, kind, points: crewPoints(unit, content, kind), progress: improvements.projects.find(project => project.tileIndex === tileIndex && project.kind === kind)?.progress ?? 0 }] : []));
}
