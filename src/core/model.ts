import type { DistrictId } from '../content/districts.ts';
import type { ObservedDistrict } from './districts.ts';
import type { EraProgression, GameplayVersion } from '../content/eras.ts';
import type { ExpansionAction, ExpansionEvent, ExpansionState, ExpansionView } from './expansion-model.ts';
import type { TypeId } from '../content/species.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { BallId, BuildingId, TechId, Yield } from '../content/economy.ts';
import type { StarterId, SpeciesId, UnitIdentity } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Hex, GridSize } from './hex.ts';
import type { RngState } from './rng.ts';
import type { MapTerrain } from './map.ts';

export type AiPersonality = 'expansion' | 'aggressive' | 'conservative';
export type Score = { playerId: number; total: number; cities: number; population: number; species: number; techs: number; knockdowns: number };
export type GameOutcome = { kind: 'conquest' | 'score' | 'playerDefeat' | 'pokedex' | 'origin' | 'championship' | 'contest' | 'faith'; winners: number[]; ranking: Score[]; round: number };
export type Diplomacy = { a: number; b: number; status: 'peace' | 'war'; changedAtRound: number; declaredBy: number | null;
  cooldownUntilRound: number; rejectedAtRound: Record<number, number>; citiesLostSinceWar: Record<number, number>;
  proposal: { proposerId: number; recipientId: number } | null };
export type DiplomacyAction = { type: 'DeclareWar'; targetPlayerId: number } | { type: 'MakePeace'; targetPlayerId: number }
  | { type: 'RespondPeace'; targetPlayerId: number; accept: boolean };
export type DiplomacyEvent = { type: 'DiplomacyChanged'; relation: Diplomacy };
export type GameSetup = GridSize & {
  seed: number;
  expansionVersion?: 1;
  eraProgression?: EraProgression;
  gameplayVersion?: GameplayVersion;
  multiplayer?: true;
  roundLimit?: 100 | 200 | 300;
  players: (({ id: number; controller: 'human'; starterId: StarterId }
    | { id: number; controller: 'ai'; personality?: AiPersonality }) & { leaderId?: LeaderId })[];
};
type UnitBase = UnitIdentity & { id: number; ownerId: number | null; actionLeft: 0 | 1; xp: number; hp: number; enraged: boolean; wildHome: Hex | null };
export type MapUnit = UnitBase & { location: 'map'; position: Hex };
export type RecoveringUnit = UnitBase & { location: 'recovering'; cityId: number; roundsLeft: number; position: null };
export type UnitState = MapUnit | RecoveringUnit;
export function isMapUnit(unit: UnitState): unit is MapUnit { return unit.location === 'map'; }
export type ProductionItem = { kind: 'building'; defId: BuildingId }
  | { kind: 'pokemon'; defId: SpeciesId } | { kind: 'logistics'; defId: 'settler' } | { kind: 'district'; defId: DistrictId; tileIndex: number };
export type ProductionOrder = { id: number; progress: number; item: ProductionItem };
export type PendingDeployment = { enteredAtRound: number; sourceOrderId: number; item: Exclude<ProductionItem, { kind: 'building' | 'district' }> };
export type CitySummary = { id: number; ownerId: number | null; position: Hex; headquartersOf?: number | null };
export type CityState = CitySummary & {
  hp: number; population: number; food: number; buildingIds: BuildingId[];
  queue: ProductionOrder[]; pendingDeployments: PendingDeployment[];
  workedTileIds: number[]; lockedTileIds: number[]; capturedAtRound: number | null;
};
export type PlayerState = {
  leaderId?: LeaderId;
  id: number; controller: 'human' | 'ai'; starterId: StarterId; gold: number; headquartersCityId: number; knockdownCount: number;
  personality: AiPersonality; lastSettlerProducedRound: number; eliminated: boolean; frozenScore: Score | null;
  ballInventory: Record<BallId, number>; registeredSpeciesIds: SpeciesId[];
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
  | { type: 'DistrictCompleted'; cityId: number; orderId: number; tileIndex: number; kind: DistrictId; cost: number; overflow: number }
  | { type: 'BuildingCompleted'; cityId: number; orderId: number; definitionId: BuildingId; cost: number; overflow: number }
  | { type: 'ProductionWaiting'; cityId: number; enteredAtRound: number; sourceOrderId: number; definitionId: string }
  | { type: 'UnitTrained'; cityId: number; orderId: number; unit: UnitState }
  | { type: 'UnitRemoved'; unitId: number; reason: 'deficitDisbanded' }
  | { type: 'GoldSettled'; income: number; upkeep: number; refundedUpkeep: number; goldBefore: number; goldAfter: number }
  | { type: 'ResearchProgressed'; techId: TechId | null; progress: number; reserve: number }
  | { type: 'TechCompleted'; techId: TechId }
);
export type LastKnownUnit = UnitIdentity & { ownerId: number | null; position: Hex; lastSeenRound: number };
export type KnowledgeState = {
  rememberedDistricts?: Record<number, ObservedDistrict>;
  exploredTileIds: number[];
  rememberedTiles: Record<number, { biomeId: BiomeId; territoryOwnerIds?: number[] }>;
  lastKnownUnits: Record<number, LastKnownUnit>;
  lastKnownCities: Record<number, { ownerId: number | null; position: Hex; lastSeenRound: number; headquartersOf?: number | null }>;
};
export type GameState = {
  schemaVersion: 4 | 5 | 6 | 7 | 8; rulesVersion: 'm5-v1' | 'districts-v10' | 'governments-v11' | 'eras-v12' | 'promotions-v13'; contentVersion: string;
  expansion?: ExpansionState;
  setup: GameSetup; rng: RngState; nextEntityId: number; commandSeq: number;
  round: number; activePlayerId: number; turnOrder: number[];
  map: MapTerrain;
  players: Record<number, PlayerState>;
  units: Record<number, UnitState>; cities: Record<number, CityState>;
  diplomacy: Diplomacy[];
  outcome: GameOutcome | null;
  knowledge: Record<number, KnowledgeState>;
};
export type PlayerView = {
  eraProgression?: EraProgression;
  gameplayVersion?: GameplayVersion;
  expansion?: ExpansionView;
  playerId: number; seed: number; round: number; activePlayerId: number; commandSeq: number;
  map: GridSize & { tiles: (BiomeId | null)[] };
  /** Per tile: sorted civilization IDs, [] observed unclaimed, null ownership never observed. */
  territoryOwnerIds: (number[] | null)[];
  visibleTileIds: number[]; knowledge: KnowledgeState;
  units: MapUnit[]; recoveringUnits: RecoveringUnit[]; cities: CitySummary[];
  combat: { units: Record<number, { typeResearch: boolean }>; cities: Record<number, { hp: number; counterAttack: number }> };
  diplomacy: GameState['diplomacy'];
  outcome: GameOutcome | null; roundLimit: 100 | 200 | 300;
  civilizations: { id: number; eliminated: boolean; leaderId?: LeaderId }[];
  economy: { player: PlayerState; cities: (CityState & { yields: Yield; availableTileIds: number[] })[] };
};
export type CombatTarget = { kind: 'unit' | 'city'; id: number };
export type CombatAction = { type: 'Attack'; unitId: number; target: CombatTarget }
  | { type: 'Capture'; unitId: number; targetUnitId: number; ballId: BallId }
  | { type: 'Evolve'; unitId: number; intoSpeciesId: SpeciesId };
export type KnockdownCombatant = { id: number; ownerId: number | null; kind: 'pokemon' | 'logistics' | 'city'; typeId: TypeId | null };
export type KnockdownRecord = { source: KnockdownCombatant; target: KnockdownCombatant; effectiveness: number; counter: boolean };
export type CombatEvent =
  | { type: 'CivilizationEliminated'; eliminatedPlayerId: number }
  | { type: 'GameEnded'; outcome: GameOutcome }
  | { type: 'BattleResolved'; attackerId: number; target: CombatTarget; positions: Hex[]; damage: number; counterDamage: number; capturedCity: boolean; knockedDownUnitIds: number[]; knockdowns?: KnockdownRecord[] }
  | { type: 'Captured'; playerId: number; unitId: number; targetUnitId: number; success: boolean; probability: number }
  | { type: 'Evolved'; playerId: number; unitId: number; speciesId: SpeciesId }
  | { type: 'UnitRecovering'; playerId: number; unitId: number; cityId: number; roundsLeft: number }
  | { type: 'UnitRecovered'; playerId: number; unitId: number; position: Hex }
  | { type: 'WildSpawned'; unitId: number; position: Hex };
export type Command = { actorId: number; expectedSeq: number; action:
  | { type: 'Move'; unitId: number; to: Hex }
  | { type: 'EndTurn' }
  | EconomyAction | CombatAction | DiplomacyAction | ExpansionAction
};
export type EventPayload = EconomyEvent | CombatEvent | DiplomacyEvent | ExpansionEvent
  | { type: 'Moved'; unitId: number; path: Hex[] }
  | { type: 'RoundEnded'; round: number }
  | { type: 'TurnChanged'; activePlayerId: number; round: number };
export type GameEvent = { seq: number; index: number; payload: EventPayload };
export type VisibleEvent = { seq: number; payload:
  | { type: 'Moved'; unit: UnitIdentity & { id: number; ownerId: number | null }; path: Hex[] }
  | Exclude<EventPayload, { type: 'Moved' }>
};
export type StepResult = { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'game-ended' | 'diplomacy-unavailable' | 'not-your-turn' | 'stale-command' | 'invalid-command' | 'unit-unavailable' | 'no-action' | 'unreachable' | 'city-unavailable' | 'invalid-production' | 'contested-territory' | 'invalid-work' | 'research-unavailable' | 'purchase-unavailable' | 'invalid-city-site' | 'attack-unavailable' | 'capture-unavailable' | 'evolution-unavailable' };
