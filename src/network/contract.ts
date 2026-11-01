import { isEraProgression, type EraProgression } from '../content/eras.ts';
import { isLeaderId, LEADER_IDS, type LeaderId } from '../content/leaders.ts';
import { canonicalSerialize, type JsonValue } from '../core/snapshot.ts';
import { parseAuditAction } from '../audit/commands.ts';
import { EXPANSION_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';

export type RoomCreateRequest = {
  seed: number;
  width?: number;
  height?: number;
  roundLimit?: 100 | 200 | 300;
  seats?: 2 | 3 | 4;
  ownerName?: string;
  expansionVersion?: 1;
  eraProgression?: EraProgression;
  leaderIds?: LeaderId[];
};

export type SeatInvite = {
  seatId: number;
  joinToken: string | null;
  joined: boolean;
  name: string | null;
};

export type RoomCreateResponse = {
  roomId: string;
  ownerToken: string;
  expansionVersion: 1;
  seats: SeatInvite[];
};

export type JoinRequest = {
  seatId?: number;
  name?: string;
  joinToken?: string;
};

export type JoinResponse = {
  roomId: string;
  seatId: number;
  seatToken: string;
  view: PlayerView;
};

export type StateResponse = {
  seq: number;
  you: number;
  view: PlayerView;
  serverTime: number;
};

export type CommandRequest = {
  expectedSeq?: number;
  action?: Command['action'];
};

export type CommandAccepted = {
  ok: true;
  seq: number;
  view: PlayerView;
};

export type CommandRejected = {
  ok: false;
  code: string;
  reason: string;
  view: PlayerView;
};

export type CommandResponse = CommandAccepted | CommandRejected;

export type OwnerSeatStatus = {
  seatId: number;
  joinToken: string | null;
  joined: boolean;
  name: string | null;
};

export type OwnerRoomResponse = {
  roomId: string;
  seats: OwnerSeatStatus[];
};

export type SaveSlotSummary = {
  slot: string;
  savedAt: number;
  commandSeq: number;
  round: number;
};

export type SaveListResponse = { slots: SaveSlotSummary[] };
export type SaveRequest = { slot?: string };
export type SaveResponse = { slot: string; savedAt: number; commandSeq: number };
export type LoadResponse = { slot: string; view: PlayerView; seq: number };
export type InviteResponse = { seatId: number; joinToken: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Canonical untrusted-action parsing is owned by the audit command parser so
 * legacy and expansion actions cannot drift between browser and server. Extra
 * fields are rejected by comparing the input with the parser's clean clone.
 */
export function isCommandAction(value: unknown, content: Content = EXPANSION_CONTENT): value is Command['action'] {
  try {
    const parsed = parseAuditAction(value, content);
    return canonicalSerialize(parsed) === canonicalSerialize(value as JsonValue);
  } catch {
    return false;
  }
}

export function validateJoinRequest(value: unknown, authorization: string | null): { seatId: number; name?: string; joinToken: string } | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(['seatId', 'name', 'joinToken']);
  if (Object.keys(value).some(key => !allowed.has(key))) return null;
  const seatId = value.seatId;
  if (typeof seatId !== 'number' || !Number.isSafeInteger(seatId) || seatId < 0) return null;
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 32)) return null;
  const supplied = value.joinToken ?? authorization;
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/u.test(supplied)) return null;
  return { seatId, ...(value.name === undefined ? {} : { name: value.name }), joinToken: supplied };
}

export function validateCommandRequest(value: unknown, content: Content = EXPANSION_CONTENT): { expectedSeq: number; action: Command['action'] } | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  const expectedSeq = value.expectedSeq;
  if (typeof expectedSeq !== 'number' || !Number.isSafeInteger(expectedSeq) || expectedSeq < 0 || !isCommandAction(value.action, content)) return null;
  return { expectedSeq, action: value.action };
}

export type ValidRoomCreateRequest = Required<Pick<RoomCreateRequest, 'seed' | 'seats' | 'expansionVersion' | 'eraProgression' | 'leaderIds'>>
  & Pick<RoomCreateRequest, 'width' | 'height' | 'roundLimit' | 'ownerName'>;

export function validateRoomCreateRequest(value: unknown): ValidRoomCreateRequest | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(['seed', 'width', 'height', 'roundLimit', 'seats', 'ownerName', 'expansionVersion', 'eraProgression', 'leaderIds']);
  if ([...Object.keys(value)].some(key => !allowed.has(key))) return null;
  const seed = value.seed;
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0) return null;
  const rawSeats = value.seats ?? 2;
  if (typeof rawSeats !== 'number' || ![2, 3, 4].includes(rawSeats)) return null;
  const seats = rawSeats as 2 | 3 | 4;
  const rawRoundLimit = value.roundLimit ?? 100;
  if (typeof rawRoundLimit !== 'number' || ![100, 200, 300].includes(rawRoundLimit)) return null;
  const roundLimit = rawRoundLimit as 100 | 200 | 300;
  const rawWidth = value.width ?? 24, rawHeight = value.height ?? 16;
  if (typeof rawWidth !== 'number' || typeof rawHeight !== 'number' || !Number.isSafeInteger(rawWidth)
    || !Number.isSafeInteger(rawHeight) || rawWidth < 16 || rawWidth > 60
    || rawHeight < 12 || rawHeight > 40) return null;
  const ownerName = value.ownerName;
  if (ownerName !== undefined && (typeof ownerName !== 'string' || ownerName.length > 32)) return null;
  const expansionVersion = value.expansionVersion ?? 1;
  if (expansionVersion !== 1) return null;
  const eraProgression = value.eraProgression ?? 'simple-v1';
  if (!isEraProgression(eraProgression)) return null;
  const leaderIds = value.leaderIds ?? LEADER_IDS.slice(0, seats);
  if (!Array.isArray(leaderIds) || leaderIds.length !== seats || !leaderIds.every(isLeaderId)) return null;
  return { seed, seats, width: rawWidth, height: rawHeight, roundLimit, ownerName, expansionVersion, eraProgression, leaderIds: [...leaderIds] };
}
