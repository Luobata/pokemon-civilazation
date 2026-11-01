import { afterEach, describe, expect, test, vi } from 'vitest';
import { NetworkClient, NetworkError } from '../../src/network/client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('network client transport failures', () => {
  test('turns fetch transport failures into actionable server-unreachable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await NetworkClient.createRoom('http://127.0.0.1:8787').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({
      status: 0,
      code: 'server-unreachable',
      message: expect.stringContaining('请先运行 npm run server'),
    });
    expect((error as NetworkError).message).toContain('http://127.0.0.1:8787/api/rooms');
  });

  test('preserves rejection status, code, and reason from the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'room-not-found', reason: '房间不存在或已过期。' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )));
    const client = new NetworkClient({ baseUrl: 'http://127.0.0.1:8787', roomId: 'missing', seatToken: 'seat-token' });
    const error = await client.getState().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ status: 404, code: 'room-not-found', message: '房间不存在或已过期。' });
  });

  test('times out one hanging request without retrying and tells the user to refresh first', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new NetworkClient({ baseUrl: 'http://127.0.0.1:8787', roomId: 'room', seatToken: 'seat-token' });
    const pending = client.sendCommand({ type: 'EndTurn' }, 0);
    const rejection = expect(pending).rejects.toMatchObject({
      status: 0,
      code: 'request-timeout',
      message: expect.stringContaining('请刷新房间状态确认后再重新提交'),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('also bounds a response whose JSON body never finishes', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Deliberately leave the stream open so response.json() never settles.
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-type': 'application/json' },
    })));
    const client = new NetworkClient({ baseUrl: 'http://127.0.0.1:8787', roomId: 'room', seatToken: 'seat-token' });
    const pending = client.getState();
    const rejection = expect(pending).rejects.toMatchObject({
      status: 0,
      code: 'request-timeout',
      message: expect.stringContaining('结果可能已经生效'),
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });
});
