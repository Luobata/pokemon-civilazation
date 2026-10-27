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
export type UnitState = UnitIdentity & { id: number; ownerId: number; position: Hex; actionLeft: 0 | 1 };
export type CityState = { id: number; ownerId: number; position: Hex };
export type LastKnownUnit = UnitIdentity & { ownerId: number; position: Hex; lastSeenRound: number };
export type KnowledgeState = {
  exploredTileIds: number[];
  rememberedTiles: Record<number, { biomeId: BiomeId }>;
  lastKnownUnits: Record<number, LastKnownUnit>;
  lastKnownCities: Record<number, { ownerId: number; position: Hex; lastSeenRound: number }>;
};
export type GameState = {
  schemaVersion: 1; rulesVersion: 'm1-v1'; contentVersion: string;
  setup: GameSetup; rng: RngState; nextEntityId: number; commandSeq: number;
  round: number; activePlayerId: number; turnOrder: number[];
  map: MapTerrain;
  players: Record<number, { id: number; controller: 'human' | 'ai'; starterId: StarterId }>;
  units: Record<number, UnitState>; cities: Record<number, CityState>;
  knowledge: Record<number, KnowledgeState>;
};
export type PlayerView = {
  playerId: number; seed: number; round: number; activePlayerId: number; commandSeq: number;
  map: GridSize & { tiles: (BiomeId | null)[] };
  visibleTileIds: number[]; knowledge: KnowledgeState;
  units: UnitState[]; cities: CityState[];
};
export type Command = { actorId: number; expectedSeq: number; action:
  | { type: 'Move'; unitId: number; to: Hex }
  | { type: 'EndTurn' }
};
export type EventPayload =
  | { type: 'Moved'; unitId: number; path: Hex[] }
  | { type: 'RoundEnded'; round: number }
  | { type: 'TurnChanged'; activePlayerId: number; round: number };
export type GameEvent = { seq: number; index: number; payload: EventPayload };
export type VisibleEvent = { seq: number; payload:
  | { type: 'Moved'; unit: UnitIdentity & { id: number; ownerId: number }; path: Hex[] }
  | Exclude<EventPayload, { type: 'Moved' }>
};
export type StepResult = { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: 'not-your-turn' | 'stale-command' | 'invalid-command' | 'unit-unavailable' | 'no-action' | 'unreachable' };
