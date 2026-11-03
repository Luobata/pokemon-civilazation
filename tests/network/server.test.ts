import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect as socketConnect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createNetworkServer, createNodeServer } from '../../server/server.ts';
import type { CommandResponse, JoinResponse, RoomCreateResponse, StateResponse } from '../../src/network/contract.ts';
import type { SaveFile } from '../../src/app/save.ts';

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pokemon-network-'));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function post(server: ReturnType<typeof createNetworkServer>, url: string, body: unknown, token?: string): Promise<Response> {
  return server.handle(new Request(`http://local.test${url}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}
async function get(server: ReturnType<typeof createNetworkServer>, url: string, token?: string): Promise<Response> {
  return server.handle(new Request(`http://local.test${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
}
async function payload(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

describe('authoritative local multiplayer rooms', () => {
  test('room eras and per-seat leaders survive join, refresh, save and load', async () => {
    const server = createNetworkServer({ persistenceDirectory: directory });
    for (const eraProgression of ['simple-v1', 'full-v1'] as const) {
      const created = await payload(await post(server, '/api/rooms', {
        seed: 23456, seats: 2, eraProgression, leaderIds: ['joy', 'lance'],
      })) as unknown as RoomCreateResponse;
      const joined = await payload(await post(server, `/api/rooms/${created.roomId}/join`, {
        seatId: 0, joinToken: created.seats[0].joinToken,
      })) as unknown as JoinResponse;
      expect(joined.view.eraProgression).toBe(eraProgression);
      expect(joined.view.economy.player.leaderId).toBe('joy');
      expect((await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot: 'slot-1' }, created.ownerToken)).status).toBe(200);
      expect((await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, joined.seatToken)).status).toBe(200);
      expect((await post(server, `/api/rooms/${created.roomId}/owner/load`, { slot: 'slot-1' }, created.ownerToken)).status).toBe(200);
      const refreshed = await payload(await get(server, `/api/rooms/${created.roomId}/state`, joined.seatToken)) as unknown as StateResponse;
      expect(refreshed.view).toMatchObject({ eraProgression, commandSeq: 0, economy: { player: { leaderId: 'joy' } } });
      const exported = await payload(await post(server, `/api/rooms/${created.roomId}/owner/export`, {}, created.ownerToken)) as unknown as SaveFile;
      expect(exported.state.setup).toMatchObject({ eraProgression, roundLimit: 100 });
      expect(exported.state.setup.players.map(player => player.leaderId)).toEqual(['joy', 'lance']);
    }
    for (const bad of [{ eraProgression: 'unknown' }, { leaderIds: ['joy'] }, { leaderIds: ['joy', 'unknown'] }]) {
      expect((await post(server, '/api/rooms', { seed: 23456, seats: 2, ...bad })).status).toBe(400);
    }
  });

  test('explicit v10 rooms preserve their district envelope through save/export/load', async () => {
    const server = createNetworkServer({ persistenceDirectory: directory });
    const created = await payload(await post(server, '/api/rooms', { seed: 31, seats: 2, gameplayVersion: 10 })) as unknown as RoomCreateResponse;
    const joined = await payload(await post(server, `/api/rooms/${created.roomId}/join`, {
      seatId: 0, joinToken: created.seats[0].joinToken,
    })) as unknown as JoinResponse;
    expect(joined.view.gameplayVersion).toBe(10);
    expect(joined.view.expansion?.districts).toEqual({ tiles: [], projects: [] });
    expect((await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot: 'slot-1' }, created.ownerToken)).status).toBe(200);
    expect((await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, joined.seatToken)).status).toBe(200);
    expect((await post(server, `/api/rooms/${created.roomId}/owner/load`, { slot: 'slot-1' }, created.ownerToken)).status).toBe(200);
    const exported = await payload(await post(server, `/api/rooms/${created.roomId}/owner/export`, {}, created.ownerToken)) as unknown as SaveFile;
    expect(exported).toMatchObject({ schemaVersion: 5, rulesVersion: 'districts-v10', state: { commandSeq: 0 }, log: { schemaVersion: 5, rulesVersion: 'districts-v10' } });
  });

  test('two clients authenticate, reject wrong seat and stale sequence, and receive only PlayerView', async () => {
    const server = createNetworkServer({ persistenceDirectory: null, now: () => 1700000000000 });
    const createdResponse = await post(server, '/api/rooms', { seed: 12345, seats: 2, ownerName: 'host' });
    expect(createdResponse.status).toBe(201);
    const created = await payload(createdResponse) as unknown as RoomCreateResponse;
    expect(created.ownerToken).toHaveLength(64);
    expect(created.seats).toHaveLength(2);
    expect(created.seats.map(seat => seat.joinToken)).toEqual(expect.arrayContaining([expect.any(String)]));

    const wrongJoin = await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 1, name: 'thief', joinToken: created.seats[0].joinToken });
    expect(wrongJoin.status).toBe(401);
    const first = await payload(await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 0, name: 'host', joinToken: created.seats[0].joinToken })) as unknown as JoinResponse;
    const second = await payload(await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 1, name: 'guest', joinToken: created.seats[1].joinToken })) as unknown as JoinResponse;
    expect(first.seatToken).not.toBe(second.seatToken);
    const replayJoin = await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 1, joinToken: created.seats[1].joinToken });
    expect(replayJoin.status).toBe(409);

    const wrongSeat = await payload(await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, second.seatToken)) as unknown as CommandResponse;
    expect(wrongSeat).toMatchObject({ ok: false, code: 'wrong-seat' });
    expect(wrongSeat.view.playerId).toBe(1);

    const accepted = await payload(await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, first.seatToken)) as unknown as CommandResponse;
    expect(accepted).toMatchObject({ ok: true, seq: 1 });
    expect((accepted.view as { activePlayerId: number }).activePlayerId).toBe(1);

    const stale = await payload(await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, second.seatToken)) as unknown as CommandResponse;
    expect(stale).toMatchObject({ ok: false, code: 'stale-command' });
    const future = await payload(await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 2, action: { type: 'EndTurn' } }, second.seatToken)) as unknown as CommandResponse;
    expect(future).toMatchObject({ ok: false, code: 'future-command' });

    const state = await payload(await get(server, `/api/rooms/${created.roomId}/state?seq=1`, second.seatToken)) as unknown as StateResponse;
    expect(state).toMatchObject({ seq: 1, you: 1, serverTime: 1700000000000 });
    const exported = await state.view;
    expect(JSON.stringify(Object.keys(exported).sort())).not.toContain('rng');
    expect(exported).toEqual(expect.objectContaining({ playerId: 1, commandSeq: 1 }));
    expect(JSON.stringify(state)).not.toContain('"schemaVersion"');
    expect(JSON.stringify(state)).not.toContain('"rng"');
    expect(JSON.stringify(state)).not.toContain('"nextEntityId"');

    const malformed = await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 1, action: { type: 'Move', unitId: 1, to: { q: 0, r: 0 }, extra: true } }, second.seatToken);
    expect(malformed.status).toBe(400);
  });


  test('rejects malformed transport bodies and expires only idle rooms', async () => {
    let now = 1700000000000;
    const server = createNetworkServer({ persistenceDirectory: null, now: () => now, roomTtlMs: 10_000 });
    const malformed = await server.handle(new Request('http://local.test/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }));
    expect(malformed.status).toBe(400);
    expect(await payload(malformed)).toMatchObject({ code: 'invalid-body' });

    const created = await payload(await post(server, '/api/rooms', { seed: 999, seats: 2 })) as unknown as RoomCreateResponse;
    now += 9_999;
    const stillActive = await post(server, `/api/rooms/${created.roomId}/join`, {
      seatId: 0, joinToken: created.seats[0].joinToken, name: 'host',
    });
    expect(stillActive.status).toBe(200);
    now += 10_001;
    const expired = await post(server, `/api/rooms/${created.roomId}/join`, {
      seatId: 1, joinToken: created.seats[1].joinToken, name: 'late',
    });
    expect(expired.status).toBe(404);
    const replacement = await payload(await post(server, '/api/rooms', { seed: 1000, seats: 2 })) as unknown as RoomCreateResponse;
    expect(replacement.roomId).not.toBe(created.roomId);
  });

  test('the real Node adapter bounds streamed request bodies', async () => {
    const server = createNodeServer({ persistenceDirectory: null });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = httpRequest({
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/rooms',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
        }, outgoing => {
          let body = '';
          outgoing.on('data', chunk => { body += chunk; });
          outgoing.on('end', () => resolve({ status: outgoing.statusCode ?? 0, body }));
        });
        request.on('error', reject);
        request.end(Buffer.alloc(1024 * 1024 + 1, 0x78));
      });
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'invalid-body-size' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  test('the real Node adapter supports no-body owner export and room status', async () => {
    const server = createNodeServer({ persistenceDirectory: null });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const requestJson = (path: string, method: string, body: unknown, token?: string) => new Promise<unknown>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const request = httpRequest({
        hostname: '127.0.0.1', port: address.port, path, method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : { 'content-length': '0' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      }, outgoing => {
        let text = '';
        outgoing.on('data', chunk => { text += chunk; });
        outgoing.on('end', () => resolve(JSON.parse(text) as unknown));
      });
      request.on('error', reject);
      request.end(payload);
    });
    try {
      const created = await requestJson('/api/rooms', 'POST', { seed: 2468, seats: 2 }) as unknown as { roomId: string; ownerToken: string; seats: { seatId: number; joinToken: string }[] };
      await requestJson(`/api/rooms/${created.roomId}/join`, 'POST', { seatId: 0, joinToken: created.seats[0].joinToken, name: 'host' });
      const room = await requestJson(`/api/rooms/${created.roomId}/owner/room`, 'GET', undefined, created.ownerToken) as unknown as { seats: { seatId: number; joined: boolean; joinToken: string | null }[] };
      expect(room.seats).toEqual([
        expect.objectContaining({ seatId: 0, joined: true, joinToken: null }),
        expect.objectContaining({ seatId: 1, joined: false, joinToken: expect.any(String) }),
      ]);
      const exported = await requestJson(`/api/rooms/${created.roomId}/owner/export`, 'POST', undefined, created.ownerToken) as unknown as { formatVersion: number };
      expect(exported.formatVersion).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  test('the real Node adapter bounds malformed request-target failures', async () => {
    const server = createNodeServer({ persistenceDirectory: null });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = socketConnect({ host: '127.0.0.1', port: address.port }, () => {
          socket.end('GET http://[::1 HTTP/1.1\r\nHost: ignored\r\nConnection: close\r\n\r\n');
        });
        let text = '';
        socket.on('data', chunk => { text += chunk; });
        socket.on('end', () => resolve(text));
        socket.on('error', reject);
      });
      expect(response).toMatch(/^HTTP\/1\.1 400 /u);
      expect(response).toContain('"code":"invalid-request"');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  test('the persisted-room bound survives restarts and removes whole room groups only', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'pokemon-network-bound-'));
    const createRooms = async (server: ReturnType<typeof createNetworkServer>, count: number) => {
      const rooms: { roomId: string; ownerToken: string }[] = [];
      for (let index = 0; index < count; index++) {
        const created = await payload(await post(server, '/api/rooms', { seed: 20_000 + index, seats: 2 })) as unknown as RoomCreateResponse;
        rooms.push({ roomId: created.roomId, ownerToken: created.ownerToken });
        for (const slot of ['slot-1', 'slot-2']) {
          const saved = await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot }, created.ownerToken);
          expect(saved.status).toBe(200);
        }
      }
      return rooms;
    };
    try {
      const first = createNetworkServer({ persistenceDirectory: directory });
      const oldRooms = await createRooms(first, 20);
      const ancient = oldRooms[0], retained = oldRooms[19];
      for (const room of oldRooms) {
        for (const slot of ['slot-1', 'slot-2']) await utimes(path.join(directory, `${room.roomId}-${slot}.json`), new Date(1000), new Date(1000));
      }
      for (const slot of ['slot-1', 'slot-2']) await utimes(path.join(directory, `${ancient.roomId}-${slot}.json`), new Date(500), new Date(500));
      for (const slot of ['slot-1', 'slot-2']) await utimes(path.join(directory, `${retained.roomId}-${slot}.json`), new Date(2000), new Date(2000));
      await writeFile(path.join(directory, 'unrelated.json'), '{}', 'utf8');
      await writeFile(path.join(directory, 'not-a-room-slot-1.json'), '{}', 'utf8');

      // A fresh server proves the bound is reconstructed from disk, not memory.
      const restarted = createNetworkServer({ persistenceDirectory: directory });
      const incoming = await createRooms(restarted, 1);
      const names = await readdir(directory);
      expect(names.filter(name => name.startsWith(`${ancient.roomId}-slot-`))).toEqual([]);
      for (const room of [...oldRooms.slice(1), ...incoming]) {
        expect(names.filter(name => name.startsWith(`${room.roomId}-slot-`))).toEqual([`${room.roomId}-slot-1.json`, `${room.roomId}-slot-2.json`].sort());
      }
      expect(names).toContain('unrelated.json');
      expect(names).toContain('not-a-room-slot-1.json');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('a disk-backed load and a concurrent seat command resolve in room order', async () => {
    const server = createNetworkServer({ persistenceDirectory: directory });
    const created = await payload(await post(server, '/api/rooms', { seed: 555, seats: 2 })) as unknown as RoomCreateResponse;
    const host = await payload(await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 0, joinToken: created.seats[0].joinToken })) as unknown as JoinResponse;
    expect((await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot: 'slot-1' }, created.ownerToken)).status).toBe(200);
    const [loaded, commanded] = await Promise.all([
      post(server, `/api/rooms/${created.roomId}/owner/load`, { slot: 'slot-1' }, created.ownerToken),
      post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, host.seatToken),
    ]);
    expect(loaded.status).toBe(200);
    expect(await payload(commanded)).toMatchObject({ ok: true, seq: 1 });
    const final = await payload(await get(server, `/api/rooms/${created.roomId}/state`, host.seatToken)) as unknown as StateResponse;
    expect(final.seq).toBe(1);
    expect(final.view.activePlayerId).toBe(1);
    const exported = await payload(await post(server, `/api/rooms/${created.roomId}/owner/export`, {}, created.ownerToken)) as unknown as SaveFile;
    expect(exported.log.commands).toHaveLength(1);
    expect(exported.state.commandSeq).toBe(1);
  });

  test('owner-only persistence is bounded, validates replay, and remains room-scoped', async () => {
    const ticks = [1700000000000];
    const server = createNetworkServer({ persistenceDirectory: directory, now: () => ticks.at(-1)! });
    const created = await payload(await post(server, '/api/rooms', { seed: 54321, seats: 2 })) as unknown as RoomCreateResponse;
    const host = await payload(await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 0, joinToken: created.seats[0].joinToken })) as unknown as JoinResponse;
    await post(server, `/api/rooms/${created.roomId}/join`, { seatId: 1, joinToken: created.seats[1].joinToken });
    const accepted = await payload(await post(server, `/api/rooms/${created.roomId}/commands`, { expectedSeq: 0, action: { type: 'EndTurn' } }, host.seatToken)) as unknown as CommandResponse;
    expect(accepted.ok).toBe(true);

    const forbidden = await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot: 'slot-1' }, host.seatToken);
    expect(forbidden.status).toBe(401);
    const saved = await payload(await post(server, `/api/rooms/${created.roomId}/owner/save`, { slot: 'slot-1' }, created.ownerToken));
    expect(saved).toMatchObject({ slot: 'slot-1', commandSeq: 1 });

    const file = path.join(directory, `${created.roomId}-slot-1.json`);
    expect((await stat(file)).size).toBeGreaterThan(1000);
    const disk = JSON.parse(await readFile(file, 'utf8')) as SaveFile;
    expect(disk.state.commandSeq).toBe(1);
    // Tampering with either state or command history must make owner load fail.
    disk.state.round = 99;
    await writeFile(file, JSON.stringify(disk), 'utf8');
    const invalid = await post(server, `/api/rooms/${created.roomId}/owner/load`, { slot: 'slot-1' }, created.ownerToken);
    expect(invalid.status).toBe(400);

    // The endpoint returns projected state to ordinary clients even after export.
    const state = await payload(await get(server, `/api/rooms/${created.roomId}/state`, host.seatToken)) as unknown as StateResponse;
    expect(state.view.round).toBe(1);
  });
});
