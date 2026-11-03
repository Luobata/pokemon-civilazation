import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createGame } from '../src/core/game.ts';
import { step } from '../src/core/step.ts';
import { observe } from '../src/core/vision.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import { replay } from '../src/app/session.ts';
import { serializeSave } from '../src/app/save.ts';
import type { CommandLog } from '../src/app/session.ts';
import { EXPANSION_CONTENT } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import type { Command, GameSetup, GameState, PlayerView } from '../src/core/model.ts';
import {
  validateCommandRequest,
  validateJoinRequest,
  type ValidRoomCreateRequest,
  validateRoomCreateRequest,
} from '../src/network/contract.ts';

export type NetworkServerOptions = {
  content?: Content;
  persistenceDirectory?: string | null;
  now?: () => number;
  maxRooms?: number;
  /** Idle rooms are closed after this interval; saves remain on disk. */
  roomTtlMs?: number;
};

type Seat = {
  seatId: number;
  joinToken: string | null;
  seatToken: string | null;
  name: string | null;
};

type Room = {
  id: string;
  ownerToken: string;
  ownerName: string | null;
  expansionVersion: 1;
  seats: Seat[];
  state: GameState;
  commands: Command[];
  createdAt: number;
  updatedAt: number;
  pending: Promise<void>;
};

type SaveFile = Parameters<typeof serializeSave>[0] extends never ? never : {
  formatVersion: 1;
  schemaVersion: GameState['schemaVersion'];
  rulesVersion: GameState['rulesVersion'];
  contentVersion: string;
  state: GameState;
  log: CommandLog;
};

const SLOT_PATTERN = /^slot-(?:[1-9]|0[1-9]|10)$/;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SAVE_BYTES = 10 * 1024 * 1024;
const MAX_PERSISTED_ROOMS = 20;
const DEFAULT_ROOM_TTL_MS = 6 * 60 * 60 * 1000;

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function token(): string {
  return randomBytes(32).toString('hex');
}

function sameToken(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(payload: unknown, status = 200): Response {
  const body = JSON.stringify(payload);
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
  });
}

function bearer(request: Request): string | null {
  const value = request.headers.get('authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return `玩家 ${Date.now().toString(36).slice(-4)}`;
  const name = [...value.trim()].filter(char => { const code = char.codePointAt(0) ?? 0; return code !== 0x7f && !(code >= 0 && code <= 0x1f); }).join('').slice(0, 24);
  return name || '训练家';
}

function buildSetup(request: ValidRoomCreateRequest): GameSetup {
  const starters = ['bulbasaur', 'charmander', 'squirtle'] as const;
  const players = Array.from({ length: request.seats }, (_, index) => ({
    id: index,
    controller: 'human' as const,
    starterId: starters[index % starters.length],
    leaderId: request.leaderIds[index],
  }));
  return {
    seed: request.seed,
    width: request.width,
    height: request.height,
    roundLimit: request.roundLimit,
    expansionVersion: request.expansionVersion,
    eraProgression: request.eraProgression,
    gameplayVersion: request.gameplayVersion,
    multiplayer: true,
    players,
  } as GameSetup;
}

export class NetworkGameServer {
  private readonly rooms = new Map<string, Room>();
  private readonly content: Content;
  private readonly now: () => number;
  private readonly persistenceDirectory: string | null;
  private readonly maxRooms: number;
  private readonly roomTtlMs: number;

  constructor(options: NetworkServerOptions = {}) {
    this.content = options.content ?? EXPANSION_CONTENT;
    this.now = options.now ?? Date.now;
    this.persistenceDirectory = options.persistenceDirectory ?? null;
    this.maxRooms = options.maxRooms ?? 64;
    this.roomTtlMs = options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS;
  }

  handle(request: Request): Promise<Response> {
    return this.handleRequest(request).catch(error => {
      if (error instanceof HttpError) return json({ code: `invalid-${error.statusCode === 413 ? 'body-size' : 'body'}`, reason: error.message }, error.statusCode);
      return json({
        code: 'server-error',
        reason: error instanceof Error ? error.message : 'Unexpected server error',
      }, 500);
    });
  }

  private expireIdleRooms(): void {
    const cutoff = this.now() - this.roomTtlMs;
    for (const [id, room] of this.rooms) if (room.updatedAt < cutoff) this.rooms.delete(id);
  }

  private async handleRequest(request: Request): Promise<Response> {
    this.expireIdleRooms();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    const url = new URL(request.url, 'http://local.invalid');
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'POST' && pathParts.join('/') === 'api/rooms') return this.createRoom(await readJson(request));
    if (pathParts[0] !== 'api' || pathParts[1] !== 'rooms' || pathParts.length < 3) return json({ code: 'not-found', reason: 'Unknown endpoint.' }, 404);
    const room = this.rooms.get(pathParts[2]);
    if (!room) return json({ code: 'room-not-found', reason: 'Room does not exist.' }, 404);
    const tail = pathParts.slice(3).join('/');
    if (request.method === 'POST' && tail === 'join') {
      return this.enqueue(room, async () => this.join(room, await readJson(request), bearer(request)));
    }
    if (tail === 'commands' && request.method === 'POST') {
      return this.enqueue(room, async () => this.command(room, request, await readJson(request)));
    }
    if (tail === 'state' && request.method === 'GET') return this.state(room, url.searchParams.get('seq'), bearer(request));
    if (tail.startsWith('owner/')) {
      return this.enqueue(room, async () => this.ownerControl(room, request, tail.slice(6), await readMaybe(request)));
    }
    return json({ code: 'not-found', reason: 'Unknown endpoint.' }, 404);
  }

  /** Serialize room mutations, including disk-backed loads, in request order. */
  private enqueue(room: Room, operation: () => Response | Promise<Response>): Promise<Response> {
    const response = room.pending.then(() => this.rooms.get(room.id) === room
      ? operation() : json({ code: 'room-not-found', reason: 'Room does not exist.' }, 404));
    room.pending = response.then(() => undefined, () => undefined);
    return response;
  }

  private async createRoom(body: unknown): Promise<Response> {
    const parsed = validateRoomCreateRequest(body);
    if (!parsed) return json({ code: 'invalid-room', reason: 'Invalid room request.' }, 400);
    if (this.rooms.size >= this.maxRooms) return json({ code: 'server-full', reason: 'Too many active rooms.' }, 503);
    let state: GameState;
    try { state = createGame(buildSetup(parsed), this.content); }
    catch (error) { return json({ code: 'invalid-room', reason: error instanceof Error ? error.message : String(error) }, 400); }
    const id = randomBytes(16).toString('hex');
    const now = this.now();
    this.rooms.set(id, {
      id,
      ownerToken: token(),
      ownerName: parsed.ownerName ? sanitizeName(parsed.ownerName) : null,
      expansionVersion: parsed.expansionVersion,
      seats: Array.from({ length: parsed.seats }, (_, seatId) => ({ seatId, joinToken: token(), seatToken: null, name: null })),
      state,
      commands: [],
      createdAt: now,
      updatedAt: now,
      pending: Promise.resolve(),
    });
    const created = this.rooms.get(id)!;
    return json({
      roomId: id,
      ownerToken: created.ownerToken,
      expansionVersion: created.expansionVersion,
      seats: created.seats.map(seat => ({ seatId: seat.seatId, joinToken: seat.joinToken, joined: false, name: null })),
    }, 201);
  }

  private join(room: Room, body: unknown, authorization: string | null): Response {
    const request = validateJoinRequest(body, authorization);
    if (!request) return json({ code: 'invalid-join', reason: 'A valid seat, token, and optional name are required.' }, 400);
    const seat = room.seats.find(candidate => candidate.seatId === request.seatId);
    if (!seat || !seat.joinToken) return json({ code: 'seat-unavailable', reason: 'Seat is unavailable or already joined.' }, 409);
    const supplied = request.joinToken ?? authorization;
    if (typeof supplied !== 'string' || !sameToken(seat.joinToken, supplied)) return json({ code: 'invalid-join-token', reason: 'Join token does not match this seat.' }, 401);
    seat.seatToken = token();
    seat.name = sanitizeName(request.name);
    seat.joinToken = null;
    room.updatedAt = this.now();
    return json({ roomId: room.id, seatId: seat.seatId, seatToken: seat.seatToken, view: this.view(room, seat.seatId) });
  }

  private state(room: Room, seq: unknown, supplied: string | null): Response {
    const seat = this.authenticatedSeat(room, supplied);
    if (!seat) return json({ code: 'unauthorized', reason: 'A valid seat token is required.' }, 401);
    if (seq !== null && (!Number.isSafeInteger(Number(seq)) || Number(seq) < 0)) return json({ code: 'invalid-sequence', reason: 'Sequence must be a nonnegative integer.' }, 400);
    return json({ seq: room.state.commandSeq, you: seat.seatId, view: this.view(room, seat.seatId), serverTime: this.now() });
  }

  private command(room: Room, request: Request, body: unknown): Response {
    const seat = this.authenticatedSeat(room, bearer(request));
    if (!seat) return json({ code: 'unauthorized', reason: 'A valid seat token is required.' }, 401);
    const parsed = validateCommandRequest(body, this.content);
    if (!parsed) return json({ ok: false, code: 'invalid-command', reason: 'Malformed command.', view: this.view(room, seat.seatId) }, 400);
    const view = this.view(room, seat.seatId);
    if (room.state.outcome) return json({ ok: false, code: 'game-ended', reason: 'The game has ended.', view }, 409);
    if (seat.seatId !== room.state.activePlayerId) return json({ ok: false, code: 'wrong-seat', reason: `It is seat ${room.state.activePlayerId}'s turn.`, view }, 409);
    if (parsed.expectedSeq < room.state.commandSeq) return json({ ok: false, code: 'stale-command', reason: `Expected sequence ${room.state.commandSeq}.`, view }, 409);
    if (parsed.expectedSeq > room.state.commandSeq) return json({ ok: false, code: 'future-command', reason: `Expected sequence ${room.state.commandSeq}.`, view }, 409);
    const command: Command = { actorId: seat.seatId, expectedSeq: parsed.expectedSeq, action: parsed.action };
    const result = step(room.state, command, this.content);
    if (!result.ok) return json({ ok: false, code: result.reason, reason: result.reason, view }, 409);
    room.state = result.state;
    room.commands = room.commands.slice(0, result.state.commandSeq - 1);
    room.commands.push(command);
    room.updatedAt = this.now();
    return json({ ok: true, seq: room.state.commandSeq, view: this.view(room, seat.seatId) });
  }

  private async ownerControl(room: Room, request: Request, action: string, body: unknown): Promise<Response> {
    const supplied = bearer(request);
    if (!supplied || !sameToken(room.ownerToken, supplied)) return json({ code: 'owner-required', reason: 'A valid owner token is required.' }, 401);
    if (action === 'room' && request.method === 'GET') {
      return json({
        roomId: room.id,
        seats: room.seats.map(seat => ({
          seatId: seat.seatId,
          joinToken: seat.joinToken,
          joined: seat.seatToken !== null,
          name: seat.name,
        })),
      });
    }
    if (action === 'export' && request.method === 'POST') {
      const save = this.exportSave(room);
      return new Response(JSON.stringify(save), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
    if (action === 'save' && request.method === 'POST') return this.persist(room, body);
    if (action === 'saves' && request.method === 'GET') return this.listSaves(room);
    if (action === 'load' && request.method === 'POST') return this.load(room, body);
    if (action === 'close' && request.method === 'POST') {
      await this.deleteRoomSaves(room.id);
      this.rooms.delete(room.id);
      return json({ ok: true });
    }
    const seatMatch = /^seats\/([0-3])\/invite$/.exec(action);
    if (seatMatch && request.method === 'POST') {
      const seatId = Number(seatMatch[1]);
      const seat = room.seats.find(candidate => candidate.seatId === seatId && candidate.seatToken === null);
      if (!seat) return json({ code: 'seat-unavailable', reason: 'Only an unclaimed seat can receive a new invite.' }, 409);
      seat.joinToken = token();
      room.updatedAt = this.now();
      return json({ seatId, joinToken: seat.joinToken });
    }
    return json({ code: 'not-found', reason: 'Unknown owner endpoint.' }, 404);
  }

  private exportSave(room: Room): SaveFile {
    const log: CommandLog = {
      version: 1,
      schemaVersion: room.state.schemaVersion,
      rulesVersion: room.state.rulesVersion,
      contentVersion: this.content.version,
      setup: JSON.parse(JSON.stringify(room.state.setup)) as GameSetup,
      commands: JSON.parse(JSON.stringify(room.commands)) as Command[],
    };
    return JSON.parse(serializeSave(room.state, log)) as SaveFile;
  }

  private view(room: Room, seatId: number): PlayerView {
    return observe(room.state, seatId, this.content);
  }

  private authenticatedSeat(room: Room, supplied: string | null): Seat | null {
    if (!supplied) return null;
    const seat = room.seats.find(candidate => candidate.seatToken !== null && sameToken(candidate.seatToken, supplied));
    return seat ?? null;
  }

  private savePath(roomId: string, slot: unknown): string | null {
    if (!this.persistenceDirectory || typeof slot !== 'string' || !SLOT_PATTERN.test(slot)) return null;
    return path.join(this.persistenceDirectory, `${roomId}-${slot}.json`);
  }

  private async roomSaveGroups(): Promise<Map<string, { files: string[]; latest: number }>> {
    if (!this.persistenceDirectory) return new Map();
    const groups = new Map<string, { files: string[]; latest: number }>();
    let names: string[];
    try { names = await readdir(this.persistenceDirectory); }
    catch { return groups; }
    await Promise.all(names.map(async name => {
      const match = /^([a-f0-9]{32})-slot-(?:[1-9]|0[1-9]|10)\.json$/u.exec(name);
      if (!match) return;
      const file = path.join(this.persistenceDirectory!, name);
      const info = await stat(file);
      const group = groups.get(match[1]) ?? { files: [], latest: info.mtimeMs };
      group.files.push(file);
      group.latest = Math.max(group.latest, info.mtimeMs);
      groups.set(match[1], group);
    }));
    return groups;
  }

  private async enforceGlobalSaveBound(newRoom = false): Promise<void> {
    if (!this.persistenceDirectory) return;
    await mkdir(this.persistenceDirectory, { recursive: true });
    const groups = [...(await this.roomSaveGroups()).entries()]
      .map(([roomId, group]) => ({ roomId, ...group }))
      .sort((a, b) => a.latest - b.latest || a.roomId.localeCompare(b.roomId));
    // A room receiving its first save is not on disk yet. Make one whole-group slot
    // available before writing; the post-write scan below keeps the invariant even
    // after a process restart or external file changes.
    const maximum = newRoom ? MAX_PERSISTED_ROOMS - 1 : MAX_PERSISTED_ROOMS;
    for (const stale of groups.slice(0, Math.max(0, groups.length - maximum))) {
      await Promise.all(stale.files.map(file => rm(file, { force: true })));
    }
  }

  private async persist(room: Room, body: unknown): Promise<Response> {
    const slot = typeof body === 'object' && body !== null && 'slot' in body ? (body as { slot?: unknown }).slot : 'slot-1';
    const target = this.savePath(room.id, slot);
    if (!target) return json({ code: 'invalid-slot', reason: 'Slots are slot-1 through slot-10.' }, 400);
    const save = this.exportSave(room);
    const text = JSON.stringify(save);
    if (Buffer.byteLength(text) > MAX_SAVE_BYTES) return json({ code: 'save-too-large', reason: 'Save exceeds the local limit.' }, 413);
    const first = !(await this.ownsAnySave(room.id));
    await this.enforceGlobalSaveBound(first);
    await writeFile(target, text, { encoding: 'utf8', mode: 0o600 });
    await this.enforceGlobalSaveBound();
    return json({ slot, savedAt: this.now(), commandSeq: save.state.commandSeq });
  }

  private async ownsAnySave(roomId: string): Promise<boolean> {
    if (!this.persistenceDirectory) return false;
    try {
      const names = await readdir(this.persistenceDirectory);
      return names.some(name => name.startsWith(`${roomId}-slot-`) && name.endsWith('.json'));
    } catch { return false; }
  }

  private async listSaves(room: Room): Promise<Response> {
    if (!this.persistenceDirectory) return json({ slots: [] });
    const summaries = [];
    for (let index = 1; index <= 10; index++) {
      const slot = `slot-${index}`;
      const target = this.savePath(room.id, slot);
      if (!target) continue;
      try {
        const info = await stat(target);
        if (info.size > MAX_SAVE_BYTES) throw new Error('oversized');
        const save = JSON.parse(await readFile(target, 'utf8')) as SaveFile;
        summaries.push({ slot, savedAt: Math.round(info.mtimeMs), commandSeq: save.state.commandSeq, round: save.state.round });
      } catch { /* omit corrupt or missing slot */ }
    }
    return json({ slots: summaries });
  }

  private async load(room: Room, body: unknown): Promise<Response> {
    const slot = typeof body === 'object' && body !== null && 'slot' in body ? (body as { slot?: unknown }).slot : 'slot-1';
    const target = this.savePath(room.id, slot);
    if (!target) return json({ code: 'invalid-slot', reason: 'Slots are slot-1 through slot-10.' }, 400);
    let save: SaveFile;
    try {
      const info = await stat(target);
      if (info.size > MAX_SAVE_BYTES) throw new Error('Save is too large');
      save = JSON.parse(await readFile(target, 'utf8')) as SaveFile;
    } catch { return json({ code: 'save-unavailable', reason: 'Save slot is missing or invalid.' }, 404); }
    const invalid = save?.formatVersion !== 1 || save.schemaVersion !== room.state.schemaVersion || save.rulesVersion !== room.state.rulesVersion
      || save.contentVersion !== this.content.version || save.state?.setup === undefined || save.log?.commands === undefined
      || canonicalSerialize(save.state.setup) !== canonicalSerialize(room.state.setup)
      || !Array.isArray(save.log.commands) || save.state.commandSeq !== save.log.commands.length;
    if (invalid) return json({ code: 'save-invalid', reason: 'Save does not match this room or engine version.' }, 400);
    let replayed: GameState;
    try { replayed = replay(save.log, undefined, undefined, this.content); }
    catch { return json({ code: 'save-invalid', reason: 'Save command log does not replay.' }, 400); }
    if (canonicalSerialize(replayed) !== canonicalSerialize(save.state)) return json({ code: 'save-invalid', reason: 'Save state does not match its command log.' }, 400);
    room.state = replayed;
    room.commands = JSON.parse(JSON.stringify(save.log.commands)) as Command[];
    room.updatedAt = this.now();
    return json({ slot, view: this.view(room, 0), seq: room.state.commandSeq });
  }

  private async deleteRoomSaves(roomId: string): Promise<void> {
    if (!this.persistenceDirectory) return;
    for (let index = 1; index <= 10; index++) await rm(path.join(this.persistenceDirectory, `${roomId}-slot-${index}.json`), { force: true });
  }
}


async function readJson(request: Request): Promise<unknown> {
  if (request.method !== 'POST') return {};
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Request body must be JSON.'); }
}

async function readMaybe(request: Request): Promise<unknown> {
  if (request.method === 'GET' || !request.body) return {};
  return readJson(request);
}

export function createNetworkServer(options?: NetworkServerOptions): NetworkGameServer {
  return new NetworkGameServer(options);
}

export function createNodeServer(options?: NetworkServerOptions) {
  const gameServer = createNetworkServer(options);
  return createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    const fail = (status: number, code: string, reason: string) => {
      if (aborted || outgoing.destroyed) return;
      aborted = true;
      incoming.removeAllListeners('data');
      incoming.removeAllListeners('end');
      const response = new Response(JSON.stringify({ code, reason }), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
      void response.arrayBuffer().then(buffer => {
        const rawHeaders: Record<string, string | string[]> = {};
        response.headers.forEach((value, key) => { rawHeaders[key] = value; });
        outgoing.writeHead(response.status, rawHeaders);
        outgoing.end(Buffer.from(buffer));
      });
    };

    incoming.on('error', () => fail(400, 'request-failed', 'The request connection failed.'));
    outgoing.on('error', () => { aborted = true; });
    incoming.on('data', chunk => {
      received += chunk.byteLength;
      if (received <= MAX_BODY_BYTES && !aborted) {
        chunks.push(Buffer.from(chunk));
        return;
      }
      fail(413, 'invalid-body-size', 'Request body is too large.');
    });
    incoming.on('end', () => {
      void (async () => {
        try {
          const body = Buffer.concat(chunks);
          const target = new URL(incoming.url ?? '/', 'http://local.invalid');
          const headers = new Headers(incoming.headers as Record<string, string>);
          headers.set('content-length', String(body.byteLength));
          const request = new Request(target, { method: incoming.method, headers, body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET') || body.byteLength === 0 ? undefined : body });
          const response = await gameServer.handle(request);
          const buffer = Buffer.from(await response.arrayBuffer());
          const rawHeaders: Record<string, string | string[]> = {};
          response.headers.forEach((value, key) => { rawHeaders[key] = value; });
          outgoing.writeHead(response.status, rawHeaders);
          outgoing.end(buffer);
        } catch (error) {
          if (aborted || outgoing.destroyed) return;
          const malformed = error instanceof TypeError || error instanceof RangeError;
          fail(malformed ? 400 : 500, malformed ? 'invalid-request' : 'server-error',
            malformed ? 'The HTTP request is malformed.' : 'The server failed to process the request.');
        }
      })();
    });
  });
}
