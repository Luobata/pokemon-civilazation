import type { Command, PlayerView } from '../core/model.ts';
import type {
  CommandAccepted,
  CommandResponse,
  JoinResponse,
  LoadResponse,
  OwnerRoomResponse,
  RoomCreateRequest,
  RoomCreateResponse,
  SaveListResponse,
  SaveResponse,
  StateResponse,
} from './contract.ts';

export type NetworkClientOptions = {
  baseUrl?: string;
  roomId: string;
  seatId?: number;
  seatToken?: string;
  ownerToken?: string;
  tokenKind?: 'invite' | 'seat' | undefined;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class NetworkError extends Error {
  constructor(readonly status: number, readonly code: string, reason: string) {
    super(reason);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function parse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new NetworkError(response.status, 'invalid-response', `Server returned ${response.status}.`); }
  if (!response.ok && typeof payload === 'object' && payload !== null) {
    const record = payload as { code?: unknown; reason?: unknown };
    throw new NetworkError(response.status, typeof record.code === 'string' ? record.code : 'request-failed',
      typeof record.reason === 'string' ? record.reason : `Request failed (${response.status}).`);
  }
  return payload as T;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Request timed out', 'AbortError'));
    }, DEFAULT_REQUEST_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
      }),
      timeoutFailure,
    ]);
    return await Promise.race([parse<T>(response), timeoutFailure]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new NetworkError(0, 'request-timeout',
        `请求 ${DEFAULT_REQUEST_TIMEOUT_MS} 毫秒后仍未返回，结果可能已经生效。请刷新房间状态确认后再重新提交；客户端不会自动重试。`);
    }
    if (error instanceof NetworkError) throw error;
    throw new NetworkError(0, 'server-unreachable',
      `无法连接联机服务。请先运行 npm run server，并检查 API 地址 ${url} 是否正确。`);
  } finally {
    clearTimeout(timeout);
  }
}

export class NetworkClient {
  readonly baseUrl: string;
  roomId: string;
  seatId: number | null;
  seatToken: string | null;
  ownerToken: string | null;

  constructor(options: NetworkClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? '');
    this.roomId = options.roomId;
    this.seatId = options.seatId ?? null;
    this.seatToken = options.seatToken ?? null;
    this.ownerToken = options.ownerToken ?? null;
  }

  static async createRoom(baseUrl: string, body: RoomCreateRequest = { seed: 12345, seats: 2 }): Promise<RoomCreateResponse> {
    return request<RoomCreateResponse>(`${normalizeBaseUrl(baseUrl)}/api/rooms`, { method: 'POST', body: JSON.stringify(body) });
  }

  async join(seatId: number, joinToken: string, name: string): Promise<JoinResponse> {
    const result = await request<JoinResponse>(`${this.roomUrl}/join`, {
      method: 'POST',
      body: JSON.stringify({ seatId, joinToken, name }),
    });
    this.roomId = result.roomId;
    this.seatId = result.seatId;
    this.seatToken = result.seatToken;
    return result;
  }

  async getState(): Promise<StateResponse> {
    return request<StateResponse>(`${this.roomUrl}/state`, { headers: this.seatHeaders() });
  }

  async sendCommand(action: Command['action'], expectedSeq: number): Promise<CommandAccepted> {
    const response = await request<CommandResponse>(`${this.roomUrl}/commands`, {
      method: 'POST',
      headers: this.seatHeaders(),
      body: JSON.stringify({ expectedSeq, action }),
    });
    if (!response.ok) throw new NetworkError(409, response.code, response.reason);
    return response;
  }

  async exportSave(): Promise<unknown> {
    return request<unknown>(`${this.roomUrl}/owner/export`, { method: 'POST', headers: this.ownerHeaders() });
  }

  async getRoom(): Promise<OwnerRoomResponse> {
    return request<OwnerRoomResponse>(`${this.roomUrl}/owner/room`, { headers: this.ownerHeaders() });
  }

  async save(slot = 'slot-1'): Promise<SaveResponse> {
    return request<SaveResponse>(`${this.roomUrl}/owner/save`, { method: 'POST', headers: this.ownerHeaders(), body: JSON.stringify({ slot }) });
  }

  async listSaves(): Promise<SaveListResponse> {
    return request<SaveListResponse>(`${this.roomUrl}/owner/saves`, { headers: this.ownerHeaders() });
  }

  async load(slot = 'slot-1'): Promise<LoadResponse> {
    return request<LoadResponse>(`${this.roomUrl}/owner/load`, { method: 'POST', headers: this.ownerHeaders(), body: JSON.stringify({ slot }) });
  }

  private get roomUrl(): string {
    return `${this.baseUrl}/api/rooms/${encodeURIComponent(this.roomId)}`;
  }

  private seatHeaders(): HeadersInit {
    if (!this.seatToken) throw new NetworkError(0, 'missing-seat-token', 'Enter a seat token first.');
    return { authorization: `Bearer ${this.seatToken}` };
  }

  private ownerHeaders(): HeadersInit {
    if (!this.ownerToken) throw new NetworkError(0, 'missing-owner-token', 'Enter the owner token first.');
    return { authorization: `Bearer ${this.ownerToken}` };
  }
}

export type RoomConnection = {
  client: NetworkClient;
  view: PlayerView;
  seq: number;
};

/** Restore an already-claimed connection from a URL hash fragment (never indexed by servers). */
export function connectionFromLocation(location: Location): NetworkClientOptions | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const roomId = hash.get('room'), seat = hash.get('seat'), token = hash.get('token');
  if (!roomId || seat === null || !token) return null;
  const seatId = Number(seat);
  if (!Number.isSafeInteger(seatId) || seatId < 0) return null;
  const kind = hash.get('kind');
  const tokenKind: 'invite' | 'seat' | undefined = kind === 'invite' || kind === 'seat' ? kind : undefined;
  return { baseUrl: '', roomId, seatId, seatToken: token, tokenKind };
}
