import type { BallId, BuildingId, TechId, Yield } from '../content/economy.ts';
import type { StarterId, UnitIdentity } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Hex, GridSize } from './hex.ts';
import type { RngState } from './rng.ts';
import type { MapTerrain } from './map.ts';

export type GameSetup = GridSize & {
  seed: number;
  players: ({ id: number; controller: 'human'; starterId: StarterId }
    | { id: number; controller: 'ai' })[];
};
export type UnitState = UnitIdentity & { id: number; ownerId: number; position: Hex; actionLeft: 0 | 1; xp: number };
export type ProductionItem = { kind: 'building'; defId: BuildingId }
  | { kind: 'pokemon'; defId: StarterId } | { kind: 'logistics'; defId: 'settler' };
export type ProductionOrder = { id: number; progress: number; item: ProductionItem };
export type PendingDeployment = { enteredAtRound: number; sourceOrderId: number; item: Exclude<ProductionItem, { kind: 'building' }> };
export type CitySummary = { id: number; ownerId: number; position: Hex };
export type CityState = CitySummary & {
  hp: number; population: number; food: number; buildingIds: BuildingId[];
  queue: ProductionOrder[]; pendingDeployments: PendingDeployment[];
  workedTileIds: number[]; lockedTileIds: number[]; capturedAtRound: number | null;
};
export type PlayerState = {
  id: number; controller: 'human' | 'ai'; starterId: StarterId; gold: number;
  ballInventory: Record<BallId, number>; registeredSpeciesIds: StarterId[];
  research: { techId: TechId | null; progressByTech: Record<TechId, number>; unlockedIds: TechId[]; reserve: number };
};
export type EconomyAction =
  | { type: 'FoundCity'; unitId: number }
  | { type: 'SetProductionQueue'; cityId: number; orders: { orderId?: number; item: ProductionItem }[] }
  | { type: 'AssignWork'; cityId: number; workedTileIds: number[]; lockedTileIds: number[] }
  | { type: 'SetResearch'; techId: TechId }
  | { type: 'BuyBall'; cityId: number; ballId: BallId; quantity: number };
export type EconomyEvent = { playerId: number } & (
  | { type: 'CityFounded'; cityId: number; unitId: number; position: Hex }
  | { type: 'ProductionQueueChanged'; cityId: number; orders: ProductionOrder[] }
  | { type: 'WorkAssigned'; cityId: number; workedTileIds: number[]; lockedTileIds: number[] }
  | { type: 'ResearchSelected'; techId: TechId }
  | { type: 'BallsPurchased'; cityId: number; ballId: BallId; quantity: number; goldBefore: number; goldAfter: number; inventoryBefore: number; inventoryAfter: number }
  | { type: 'CityFoodSettled'; cityId: number; foodBefore: number; foodAfter: number; populationBefore: number; populationAfter: number }
  | { type: 'BuildingCompleted'; cityId: number; orderId: number; definitionId: BuildingId; cost: number; overflow: number }
  | { type: 'ProductionWaiting'; cityId: number; enteredAtRound: number; sourceOrderId: number; definitionId: string }
  | { type: 'UnitTrained'; cityId: number; orderId: number; unit: UnitState }
  | { type: 'UnitRemoved'; unitId: number; reason: 'deficitDisbanded' }
  | { type: 'GoldSettled'; income: number; upkeep: number; refundedUpkeep: number; goldBefore: number; goldAfter: number }
  | { type: 'ResearchProgressed'; techId: TechId | null; progress: number; reserve: number }
  | { type: 'TechCompleted'; techId: TechId }
);
export type LastKnownUnit = UnitIdentity & { ownerId: number; position: Hex; lastSeenRound: number };
export type KnowledgeState = {
  exploredTileIds: number[];
  rememberedTiles: Record<number, { biomeId: BiomeId }>;
  lastKnownUnits: Record<number, LastKnownUnit>;
  lastKnownCities: Record<number, { ownerId: number; position: Hex; lastSeenRound: number }>;
};
export type GameState = {
  schemaVersion: 2; rulesVersion: 'm2-v1'; contentVersion: string;
  setup: GameSetup; rng: RngState; nextEntityId: number; commandSeq: number;
  round: number; activePlayerId: number; turnOrder: number[];
  map: MapTerrain;
  players: Record<number, PlayerState>;
  units: Record<number, UnitState>; cities: Record<number, CityState>;
  knowledge: Record<number, KnowledgeState>;
};
export type PlayerView = {
  playerId: number; seed: number; round: number; activePlayerId: number; commandSeq: number;
  map: GridSize & { tiles: (BiomeId | null)[] };
  visibleTileIds: number[]; knowledge: KnowledgeState;
  units: UnitState[]; cities: CitySummary[];
  economy: { player: PlayerState; cities: (CityState & { yields: Yield; availableTileIds: number[] })[] };
};
export type Command = { actorId: number; expectedSeq: number; action:
  | { type: 'Move'; unitId: number; to: Hex }
  | { type: 'EndTurn' }
  | EconomyAction
};
export type EventPayload = EconomyEvent
  | { type: 'Moved'; unitId: number; path: Hex[] }
  | { type: 'RoundEnded'; round: number }
  | { type: 'TurnChanged'; activePlayerId: number; round: number };
export type GameEvent = { seq: number; index: number; payload: EventPayload };
export type VisibleEvent = { seq: number; payload:
  | { type: 'Moved'; unit: UnitIdentity & { id: number; ownerId: number }; path: Hex[] }
  | Exclude<EventPayload, { type: 'Moved' }>
};
export type StepResult = { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'not-your-turn' | 'stale-command' | 'invalid-command' | 'unit-unavailable' | 'no-action' | 'unreachable' | 'city-unavailable' | 'invalid-production' | 'invalid-work' | 'research-unavailable' | 'purchase-unavailable' | 'invalid-city-site' };
