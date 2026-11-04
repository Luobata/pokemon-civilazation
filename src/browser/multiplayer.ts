import type { SpeciesId } from '../content/species.ts';
import { renderEraPanel } from './era-panel.ts';
import { LEADERS, LEADER_IDS, type LeaderId } from '../content/leaders.ts';
import type { EraProgression } from '../content/eras.ts';
import { EXPANSION_ACTION_FIELDS } from '../core/expansion-commands.ts';
import { CONTENT as BASE_CONTENT, contentForView } from '../content/units.ts';
import { hexToIndex, indexToHex } from '../core/hex.ts';
import { reachablePaths } from '../core/movement.ts';
import type { Command, PlayerView } from '../core/model.ts';
import type { BallId } from '../content/economy.ts';
import { FACTION_LEGEND } from './canvas.ts';
import { createMapRenderer } from './render/index.ts';
import { renderDiplomacyPanel, hasPendingPeace } from './diplomacy-panel.ts';
import { renderEconomyPanel } from './economy-panel.ts';
import { renderExpansionPanel } from './expansion-panel.ts';
import { renderResearchPanel, resetResearchPanel } from './research-panel.ts';
import { renderUnitPanel, type ActionMode, type PendingTarget } from './unit-panel.ts';
import { actionTargets } from './action-targets.ts';
import { districtSites, previewDistrict } from '../core/districts.ts';
import { constructionNotice, districtPreviewMarkup } from './district-panel.ts';
import type { DistrictId } from '../content/districts.ts';
import { fitCamera, toWorld, worldToHex, zoomAt } from './camera.ts';
import type { Camera, Point } from './camera.ts';
import { loadPokemonSprites } from './sprites.ts';
import { NetworkClient, NetworkError } from '../network/client.ts';
import type { RoomCreateResponse } from '../network/contract.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const renderer = createMapRenderer(canvas);
const status = document.querySelector<HTMLElement>('#connection-status')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const selectionInfo = document.querySelector<HTMLElement>('#selection-info')!;
const notice = document.querySelector<HTMLElement>('#network-notice')!;
const invites = document.querySelector<HTMLUListElement>('#invite-list')!;
const actionSelect = document.querySelector<HTMLSelectElement>('#action-type')!;
const actionEditor = document.querySelector<HTMLTextAreaElement>('#action-json')!;
const targetList = document.querySelector<HTMLSelectElement>('#target-list')!;
const mapNotice = document.querySelector<HTMLElement>('#map-notice')!;

let client: NetworkClient | null = null;
let view: PlayerView | null = null;
let camera: Camera = { x: 0, y: 0, zoom: 1 };
let selectedUnit: number | null = null;
let selectedCity: number | null = null;
let actionMode: ActionMode = null;
let districtPlacement: { cityId: number; kind: DistrictId; tileIndex: number | null } | null = null;
let pendingTarget: PendingTarget | null = null;
let selectedBall: BallId = 'pokeBall';
let lastMapKey = '';
let ownerToken: string | null = null;
let ownerRoomId: string | null = null;
let roomCreation: RoomCreateResponse | null = null;
let apiBaseUrl = '';

type StoredOwnerCredentials = { ownerToken: string; apiBaseUrl: string };
const OWNER_KEY_PREFIX = 'pokemon-multiplayer-owner:';
function ownerKey(roomId: string, baseUrl: string): string {
  return `${OWNER_KEY_PREFIX}${roomId}:${baseUrl}`;
}
function saveOwnerCredentials(roomId: string, token: string, baseUrl: string): void {
  try { sessionStorage.setItem(ownerKey(roomId, baseUrl), JSON.stringify({ ownerToken: token, apiBaseUrl: baseUrl } satisfies StoredOwnerCredentials)); }
  catch { /* A private browsing session may refuse storage; the current page still keeps its token. */ }
}
function restoreOwnerCredentials(roomId: string, baseUrl: string): boolean {
  try {
    const raw = sessionStorage.getItem(ownerKey(roomId, baseUrl));
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Partial<StoredOwnerCredentials>;
    if (Object.keys(record).length !== 2 || record.ownerToken === undefined || record.apiBaseUrl === undefined) return false;
    if (!/^[a-f0-9]{64}$/u.test(record.ownerToken) || record.apiBaseUrl !== baseUrl) return false;
    ownerRoomId = roomId;
    ownerToken = record.ownerToken;
    apiBaseUrl = record.apiBaseUrl;
    document.querySelector<HTMLInputElement>('#owner-token')!.value = ownerToken;
    updateOwnerControls();
    return true;
  } catch { return false; }
}
function updateOwnerControls(): void {
  const available = ownerRoomId !== null && ownerToken !== null;
  for (const id of ['#save-room', '#load-room', '#export-room']) {
    document.querySelector<HTMLButtonElement>(id)!.disabled = !available;
  }
}

const BASE_ACTIONS: Record<string, Record<string, 'id' | 'ids' | 'string' | 'boolean' | readonly string[] | 'hex' | 'target' | 'orders'>> = {
  EndTurn: {}, Move: { unitId: 'id', to: 'hex' }, FoundCity: { unitId: 'id' }, SetResearch: { techId: 'string' },
  SetProductionQueue: { cityId: 'id', orders: 'orders' }, AssignWork: { cityId: 'id', workedTileIds: 'ids', lockedTileIds: 'ids' },
  BuyBall: { cityId: 'id', ballId: ['pokeBall', 'greatBall'], quantity: 'id' }, Attack: { unitId: 'id', target: 'target' },
  Capture: { unitId: 'id', targetUnitId: 'id', ballId: ['pokeBall', 'greatBall'] }, Evolve: { unitId: 'id', intoSpeciesId: 'string' },
  DeclareWar: { targetPlayerId: 'id' }, MakePeace: { targetPlayerId: 'id' }, RespondPeace: { targetPlayerId: 'id', accept: 'boolean' },
};

function defaultFor(rule: unknown): unknown {
  if (rule === 'id' || rule === 'ids') return rule === 'id' ? 0 : [];
  if (rule === 'string') return '';
  if (rule === 'boolean') return false;
  if (rule === 'hex') return { q: 0, r: 0 };
  if (rule === 'target') return { kind: 'unit', id: 0 };
  if (rule === 'orders') return [{ item: { kind: 'logistics', defId: 'settler' } }];
  if (Array.isArray(rule)) return rule[0];
  return null;
}
for (const type of Object.keys(BASE_ACTIONS)) actionSelect.append(new Option(type, type));
for (const type of Object.keys(EXPANSION_ACTION_FIELDS)) actionSelect.append(new Option(type, type));
actionSelect.value = 'EndTurn';
function actionForType(type: string): Record<string, unknown> {
  const action: Record<string, unknown> = { type };
  const fields = type in BASE_ACTIONS ? BASE_ACTIONS[type] : EXPANSION_ACTION_FIELDS[type as keyof typeof EXPANSION_ACTION_FIELDS] as Record<string, unknown>;
  for (const [key, rule] of Object.entries(fields)) action[key] = defaultFor(rule);
  if (selectedUnit !== null && 'unitId' in fields) action.unitId = selectedUnit;
  if (selectedCity !== null && 'cityId' in fields) action.cityId = selectedCity;
  return action;
}
function setAction(type: string): void {
  actionSelect.value = type;
  actionEditor.value = JSON.stringify(actionForType(type), null, 2);
}
function say(message: string, error = false): void {
  notice.textContent = message;
  notice.dataset.state = error ? 'error' : 'ok';
}
function renderInvites(): void {
  const creation = roomCreation;
  if (!creation || ownerRoomId !== creation.roomId) { invites.textContent = '尚未创建房间。'; return; }
  invites.innerHTML = '';
  creation.seats.forEach(seat => {
    const token = seat.joinToken ?? null;
    const href = token ? `${location.origin}/multiplayer.html#kind=invite&api=${encodeURIComponent(apiBaseUrl)}&room=${encodeURIComponent(creation.roomId)}&seat=${seat.seatId}&token=${encodeURIComponent(token)}` : null;
    const item = document.createElement('li');
    if (href) {
      const link = document.createElement('a');
      link.href = href; link.textContent = `座位 ${seat.seatId + 1}${seat.joined ? '（已加入）' : ''}`;
      item.append(link);
    } else {
      item.textContent = `座位 ${seat.seatId + 1} · 已加入${seat.name ? ` · ${seat.name}` : ''}`;
    }
    invites.append(item);
  });
}

function renderTargets(): void {
  const currentView = view;
  if (!currentView) return;
  targetList.innerHTML = '';
  const ownUnits = currentView.units.filter(unit => unit.ownerId === currentView.playerId);
  const others = currentView.units.filter(unit => unit.ownerId !== currentView.playerId);
  for (const unit of ownUnits) targetList.append(new Option(`己方单位 ${unit.id}`, `unit:${unit.id}`, false, unit.id === selectedUnit));
  for (const city of currentView.economy.cities) targetList.append(new Option(`己方城市 ${city.id}`, `city:${city.id}`, false, city.id === selectedCity));
  for (const unit of others) targetList.append(new Option(`可见单位 ${unit.id}${unit.ownerId === null ? ' · 野生' : ` · 文明${unit.ownerId + 1}`}`, `unit:${unit.id}`));
  for (const city of currentView.cities) if (city.ownerId !== currentView.playerId) targetList.append(new Option(`可见城市 ${city.id}`, `city:${city.id}`));
}
function render(): void {
  const currentView = view, currentClient = client;
  if (!currentView || !currentClient) {
    status.textContent = '未连接';
    hud.textContent = '—';
    selectionInfo.textContent = '';
    mapNotice.textContent = '未连接。';
    selectedUnit = null; selectedCity = null; resetAction();
    targetList.innerHTML = '';
    for (const selector of ['#era-panel', '#unit-panel', '#economy', '#diplomacy', '#expansion-panel']) document.querySelector<HTMLElement>(selector)!.innerHTML = '';
    resetResearchPanel();
    updateOwnerControls();
    return;
  }
  if (selectedUnit !== null && !currentView.units.some(unit => unit.id === selectedUnit && unit.ownerId === currentView.playerId)) {
    selectedUnit = null; resetAction();
  }
  if (selectedCity === null || !currentView.economy.cities.some(city => city.id === selectedCity)) selectedCity = currentView.economy.cities[0]?.id ?? null;
  const active = currentView.activePlayerId === currentView.playerId;
  const pendingPeace = hasPendingPeace(currentView);
  const ended = currentView.outcome !== null;
  const disabled = !active || ended || pendingPeace;
  status.textContent = `房间 ${currentClient.roomId} · 文明 ${currentView.playerId + 1} · 第 ${currentView.round}/${currentView.roundLimit} 轮 · ${active ? '轮到你行动' : `等待文明 ${currentView.activePlayerId + 1}`}`;
  hud.textContent = `第 ${currentView.round} 轮 · 当前文明 ${currentView.activePlayerId + 1} · 序列 ${currentView.commandSeq} · 金币 ${currentView.economy.player.gold} · 城市 ${currentView.economy.cities.length} · 可见单位 ${currentView.units.length}`;
  renderTargets();
  renderInvites();
  updateOwnerControls();
  const unit = currentView.units.find(candidate => candidate.id === selectedUnit && candidate.ownerId === currentView.playerId);
  const city = currentView.economy.cities.find(candidate => candidate.id === selectedCity);
  selectionInfo.textContent = unit ? `己方单位 #${unit.id} · ${unit.kind === 'pokemon' ? unit.speciesId : '开拓队'} · HP ${unit.hp} · 行动 ${unit.actionLeft}`
    : city ? `己方城市 #${city.id} · 人口 ${city.population} · HP ${city.hp}`
    : '点击地图选择己方单位或城市；常规操作面板会随选择更新。';
  document.querySelector<HTMLButtonElement>('#end-turn')!.disabled = disabled;
  document.querySelector<HTMLButtonElement>('#send-action')!.disabled = disabled;
  const key = `${currentView.map.width}x${currentView.map.height}:${currentClient.roomId}`;
  if (key !== lastMapKey) {
    camera = fitCamera(currentView.map, canvas.clientWidth, canvas.clientHeight);
    lastMapKey = key;
  }
  const placementSite = districtPlacement && districtPlacement.tileIndex !== null
    ? previewDistrict(currentView, districtPlacement.cityId, districtPlacement.kind, districtPlacement.tileIndex) : null;
  renderUnitPanel(currentView, selectedUnit, actionMode, pendingTarget, selectedBall, disabled, {
    mode: mode => { actionMode = mode; pendingTarget = null; render(); },
    confirm: confirmAction,
    cancel: () => resetAction(),
    evolve: evolveSelected,
    ball: ballId => { selectedBall = ballId; pendingTarget = null; render(); },
    found: () => { if (selectedUnit !== null) void send({ type: 'FoundCity', unitId: selectedUnit }); },
  });
  if (placementSite) {
    document.querySelector<HTMLElement>('#unit-panel')!.innerHTML = districtPreviewMarkup(currentView, placementSite, disabled);
    document.querySelector<HTMLButtonElement>('#confirm-district')?.addEventListener('click', confirmDistrictPlacement);
    document.querySelector<HTMLButtonElement>('#cancel-district')?.addEventListener('click', cancelDistrictPlacement);
  }
  renderEconomyPanel(currentView, selectedCity, issue, disabled, startDistrictPlacement);
  renderResearchPanel(currentView, issue, disabled);
  renderDiplomacyPanel(currentView, !active || ended, issue);
  document.querySelector<HTMLElement>('#era-panel')!.innerHTML = renderEraPanel(currentView);
  renderExpansionPanel(currentView, selectedUnit, selectedCity, issue, disabled);
  const paths = unit && actionMode === 'move' ? reachablePaths(currentView, unit.id) : {};
  const targets = selectedUnit === null ? [] : actionTargets(currentView, selectedUnit, actionMode, selectedBall)
    .map(target => hexToIndex(target.position, currentView.map)).filter((index): index is number => index !== null);
  renderer.render({ view: currentView, camera, selected: selectedUnit, selectedCity, reachable: Object.keys(paths).map(Number),
    actionMode, actionTargets: targets, pendingTargetIndex: pendingTarget?.index,
    districtPlacement: districtPlacement ? { sites: districtSites(currentView, districtPlacement.cityId, districtPlacement.kind), selectedTileIndex: districtPlacement.tileIndex } : undefined });
  mapNotice.textContent = districtPlacement ? '设施区选址：点击格子预览，再确认入队。Esc 取消。' : actionMode === 'move' ? '移动模式：点击高亮格移动。'
    : actionMode === 'attack' ? '攻击模式：选择红色目标，再确认攻击。'
    : actionMode === 'capture' ? '捕捉模式：选择野生宝可梦，再确认捕捉。'
    : '拖动平移；滚轮缩放；点击选择。';
}
function startDistrictPlacement(cityId: number, kind: DistrictId): void {
  selectedUnit = null; selectedCity = cityId; resetAction();
  districtPlacement = { cityId, kind, tileIndex: null };
  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
  say('选择设施区地块；确认后才会加入队列。'); render();
}
function cancelDistrictPlacement(): void {
  districtPlacement = null; render();
}
function resetAction(): void {
  actionMode = null; pendingTarget = null; districtPlacement = null;
}
function confirmAction(): void {
  if (selectedUnit === null || pendingTarget === null) return;
  if (actionMode === 'attack') void send({ type: 'Attack', unitId: selectedUnit, target: { kind: pendingTarget.kind, id: pendingTarget.id } });
  else if (actionMode === 'capture') void send({ type: 'Capture', unitId: selectedUnit, targetUnitId: pendingTarget.id, ballId: selectedBall });
}
function confirmDistrictPlacement(): void {
  const placement = districtPlacement, currentView = view;
  if (!placement || placement.tileIndex === null || !currentView) return;
  const city = currentView.economy.cities.find(item => item.id === placement.cityId);
  if (!city) { cancelDistrictPlacement(); return; }
  const site = previewDistrict(currentView, placement.cityId, placement.kind, placement.tileIndex);
  if (site.reason !== null || city.queue.length >= 5) {
    say(city.queue.length >= 5 ? '生产队列已满 5 项，请先完成或取消订单。' : '目标格已不可建造，请重新选择。', true);
    render(); return;
  }
  void send({ type: 'SetProductionQueue', cityId: city.id, orders: [
    ...city.queue.map(order => ({ orderId: order.id, item: order.item })),
    { item: { kind: 'district', defId: placement.kind, tileIndex: placement.tileIndex! } },
  ] });
}
function evolveSelected(intoSpeciesId?: SpeciesId): void {
  const currentView = view;
  const unit = currentView?.units.find(candidate => candidate.id === selectedUnit
    && candidate.ownerId === currentView.playerId && candidate.kind === 'pokemon');
  const content = currentView ? contentForView(currentView) : BASE_CONTENT;
  const evolution = unit?.kind === 'pokemon' ? content.species[unit.speciesId].evolution : null;
  if (!currentView || !unit || !(intoSpeciesId ?? evolution)) {
    say('当前单位没有可用的常规进化。', true);
    return;
  }
  issue({ type: 'Evolve', unitId: unit.id, intoSpeciesId: intoSpeciesId ?? evolution!.speciesId });
}

function issue(action: Command['action']): void {
  void send(action);
}

async function refresh(showErrors = false): Promise<void> {
  if (!client) return;
  try {
    const state = await client.getState();
    view = state.view;
    await syncOwnerRoom();
    if (client.seatId !== null) {
      location.hash = `kind=seat&api=${encodeURIComponent(apiBaseUrl || location.origin)}&room=${encodeURIComponent(client.roomId)}&seat=${client.seatId}&token=${encodeURIComponent(client.seatToken ?? '')}`;
    }
    render();
  } catch (error) {
    if (showErrors) say(error instanceof Error ? error.message : String(error), true);
  }
}
async function send(action: Command['action']): Promise<void> {
  if (!client || !view) return;
  if (view.outcome) {
    say('对局已结束。', true);
    render();
    return;
  }
  if (view.activePlayerId !== view.playerId) {
    say(`等待文明 ${view.activePlayerId + 1} 行动。`, true);
    render();
    return;
  }
  if (action.type !== 'RespondPeace' && hasPendingPeace(view)) {
    say('请先接受或拒绝停战提议。', true);
    render();
    return;
  }
  try {
    const result = await client.sendCommand(action, view.commandSeq);
    view = result.view;
    if (action.type === 'Move' || action.type === 'Attack' || action.type === 'Capture' || action.type === 'EndTurn') resetAction();
    if (action.type === 'SetProductionQueue' && action.orders.some(order => order.item.kind === 'district')) districtPlacement = null;
    if (action.type === 'FoundCity') {
      selectedUnit = null;
      selectedCity = result.view.economy.cities.at(-1)?.id ?? selectedCity;
      resetAction();
    }
    say(`命令已接受；服务器序列 ${result.seq}。`);
    render();
  } catch (error) {
    say(error instanceof Error ? error.message : String(error), true);
    await refresh();
  }
}

async function connect(baseUrl: string, roomId: string, seatId: number, token: string, tokenKind: 'invite' | 'seat' | 'unknown' = 'unknown'): Promise<void> {
  if (client?.roomId !== roomId) {
    selectedUnit = null; selectedCity = null; resetAction(); lastMapKey = '';
  }
  const candidate = new NetworkClient({ baseUrl, roomId, seatId, seatToken: token });
  let state: Awaited<ReturnType<NetworkClient['getState']>>;
  if (tokenKind === 'invite') {
    const joined = await candidate.join(seatId, token, `玩家${seatId + 1}`);
    state = { seq: joined.view.commandSeq, you: seatId, view: joined.view, serverTime: 0 };
    say('已使用邀请令牌入座；新座位令牌已写入链接。');
  } else {
    try {
      // New links carry kind=seat. Old links retain the safe fallback below.
      state = await candidate.getState();
      say('已使用座位令牌恢复连接。');
    } catch (error) {
      if (tokenKind === 'seat' || !(error instanceof NetworkError) || error.code !== 'unauthorized') throw error;
      const joined = await candidate.join(seatId, token, `玩家${seatId + 1}`);
      state = { seq: joined.view.commandSeq, you: seatId, view: joined.view, serverTime: 0 };
      say('已使用邀请令牌入座；新座位令牌已写入链接。');
    }
  }
  apiBaseUrl = baseUrl;
  restoreOwnerCredentials(roomId, baseUrl);
  client = candidate; view = state.view;
  if (selectedUnit === null && selectedCity === null) selectedUnit = state.view.units.find(unit => unit.ownerId === state.view.playerId)?.id ?? null;
  render();
  await refresh();
  void syncOwnerRoom();
}

async function syncOwnerRoom(): Promise<void> {
  if (!ownerRoomId || !ownerToken || ownerRoomId !== client?.roomId) return;
  try {
    const owner = ownerClient();
    if (!owner) return;
    const room = await owner.getRoom();
    roomCreation = { ...(roomCreation ?? { roomId: room.roomId, ownerToken: ownerToken!, expansionVersion: 1 }), roomId: room.roomId, seats: room.seats };
    renderInvites();
  } catch {
    // Owner controls are optional for seated play; state refresh will surface connection failures.
  }
}
function renderRoomLeaderOptions(): void {
  const current = [...document.querySelectorAll<HTMLSelectElement>('[data-seat-leader]')].map(select => select.value);
  const seats = Number(document.querySelector<HTMLSelectElement>('#room-seats')!.value);
  document.querySelector<HTMLElement>('#room-leader-options')!.innerHTML = Array.from({ length: seats }, (_, seat) =>
    `<label>座位 ${seat + 1}<select data-seat-leader="${seat}">${LEADER_IDS.map(id =>
      `<option value="${id}"${id === (current[seat] ?? LEADER_IDS[seat]) ? ' selected' : ''}>${LEADERS[id].name}</option>`).join('')}</select></label>`).join('');
}
document.querySelector<HTMLSelectElement>('#room-seats')!.addEventListener('change', renderRoomLeaderOptions);
renderRoomLeaderOptions();
document.querySelector<HTMLButtonElement>('#create-room')!.addEventListener('click', async () => {
  try {
    const seed = Number(document.querySelector<HTMLInputElement>('#room-seed')!.value || '12345');
    const seats = Number(document.querySelector<HTMLSelectElement>('#room-seats')!.value) as 2 | 3 | 4;
    apiBaseUrl = document.querySelector<HTMLInputElement>('#api-base-url')!.value.trim() || location.origin;
    const eraProgression = document.querySelector<HTMLSelectElement>('#room-era-mode')!.value as EraProgression;
    const leaderIds = [...document.querySelectorAll<HTMLSelectElement>('[data-seat-leader]')].map(select => select.value as LeaderId);
    const created = await NetworkClient.createRoom(apiBaseUrl, { seed, seats, ownerName: 'host', eraProgression, leaderIds });
    roomCreation = created;
    ownerToken = created.ownerToken;
    ownerRoomId = created.roomId;
    saveOwnerCredentials(created.roomId, ownerToken, apiBaseUrl);
    document.querySelector<HTMLInputElement>('#owner-token')!.value = ownerToken;
    renderInvites(); updateOwnerControls();
    say('房间已创建。自己使用座位 1；把座位 2+ 链接发给其他玩家。');
  } catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
document.querySelector<HTMLButtonElement>('#join-room')!.addEventListener('click', async () => {
  try {
    const input = document.querySelector<HTMLInputElement>('#room-url')!.value.trim();
    if (!input) throw new Error('请输入房间链接或令牌链接。');
    const url = new URL(input, location.href);
    const room = url.searchParams.get('room') ?? url.hash.match(/room=([^&]+)/)?.[1];
    const seat = url.searchParams.get('seat') ?? url.hash.match(/seat=([^&]+)/)?.[1];
    const token = url.searchParams.get('token') ?? url.hash.match(/token=([^&]+)/)?.[1];
    const explicitApi = url.searchParams.get('api') ?? url.hash.match(/api=([^&]+)/)?.[1];
    if (!room || seat === null || !token) throw new Error('链接缺少 room、seat 或 token。');
    const base = explicitApi ? decodeURIComponent(explicitApi) : `${url.protocol}//${url.host}`;
    const kindParam = url.searchParams.get('kind') ?? url.hash.match(/kind=([^&]+)/)?.[1];
    const tokenKind = kindParam === 'invite' || kindParam === 'seat' ? kindParam : 'unknown';
    await connect(base, room, Number(seat), token, tokenKind);
  } catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
actionSelect.addEventListener('change', () => setAction(actionSelect.value));
targetList.addEventListener('change', () => {
  const [kind, id] = targetList.value.split(':');
  if (kind === 'unit') { selectedUnit = Number(id); selectedCity = null; }
  else { selectedCity = Number(id); selectedUnit = null; }
  setAction(actionSelect.value); render();
});
document.querySelector<HTMLButtonElement>('#move-mode')!.addEventListener('click', () => {
  actionMode = actionMode === 'move' ? null : 'move';
  setAction(actionMode === 'move' ? 'Move' : actionSelect.value);
  render();
});
document.querySelector<HTMLButtonElement>('#end-turn')!.addEventListener('click', () => void send({ type: 'EndTurn' }));
document.querySelector<HTMLButtonElement>('#send-action')!.addEventListener('click', () => {
  try { void send(JSON.parse(actionEditor.value) as Command['action']); }
  catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', () => void refresh(true));
document.querySelector<HTMLButtonElement>('#fit-map')!.addEventListener('click', () => {
  const currentView = view;
  if (currentView) { camera = fitCamera(currentView.map, canvas.clientWidth, canvas.clientHeight); render(); }
});
function ownerClient(): NetworkClient | null {
  if (!ownerRoomId || !ownerToken || !apiBaseUrl) return null;
  return new NetworkClient({ baseUrl: apiBaseUrl, roomId: ownerRoomId, ownerToken });
}
document.querySelector<HTMLButtonElement>('#save-room')!.addEventListener('click', async () => {
  const owner = ownerClient();
  if (!owner) { say('需要先创建房间并保留房主令牌。', true); return; }
  try {
    const slot = document.querySelector<HTMLInputElement>('#save-slot')!.value.trim();
    const saved = await owner.save(slot);
    say(`已保存 ${saved.slot}；服务器序列 ${saved.commandSeq}。`);
  } catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
document.querySelector<HTMLButtonElement>('#load-room')!.addEventListener('click', async () => {
  const owner = ownerClient();
  if (!owner) { say('需要先创建房间并保留房主令牌。', true); return; }
  try {
    const slot = document.querySelector<HTMLInputElement>('#save-slot')!.value.trim();
    const loaded = await owner.load(slot);
    say(`已读取 ${loaded.slot}；服务器序列 ${loaded.seq}。`);
    if (client) await refresh();
  } catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
document.querySelector<HTMLButtonElement>('#export-room')!.addEventListener('click', async () => {
  const owner = ownerClient();
  if (!owner) { say('需要先创建房间并保留房主令牌。', true); return; }
  try {
    const save = await owner.exportSave();
    const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'pokemon-multiplayer-save.json'; link.click();
    URL.revokeObjectURL(url);
    say('已导出 owner-only 存档。');
  } catch (error) { say(error instanceof Error ? error.message : String(error), true); }
});
function localPoint(event: PointerEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
let drag: { start: Point; last: Point; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { start: localPoint(event), last: localPoint(event), moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag && districtPlacement && view) {
    const index = hexToIndex(worldToHex(toWorld(localPoint(event), camera)), view.map);
    if (index !== null && index !== districtPlacement.tileIndex) { districtPlacement.tileIndex = index; render(); }
  }
  if (!drag) return;
  const point = localPoint(event);
  if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
  if (drag.moved) { camera.x += point.x - drag.last.x; camera.y += point.y - drag.last.y; render(); }
  drag.last = point;
});
canvas.addEventListener('pointerup', event => {
  const click = drag && !drag.moved;
  drag = null;
  const currentView = view;
  if (!click || !currentView) return;
  const index = hexToIndex(worldToHex(toWorld(localPoint(event), camera)), currentView.map);
  if (index === null) return;
  if (districtPlacement) { districtPlacement.tileIndex = index; render(); return; }
  const construction = constructionNotice(currentView, index);
  if (construction) { say(construction); render(); return; }
  if (actionMode === 'move' && selectedUnit !== null) {
    if (!reachablePaths(currentView, selectedUnit)[index]) {
      say('该格不在当前单位移动范围内。', true);
      render();
      return;
    }
    void send({ type: 'Move', unitId: selectedUnit, to: indexToHex(index, currentView.map) });
    actionMode = null;
    return;
  }
  if (actionMode && selectedUnit !== null) {
    const target = actionTargets(currentView, selectedUnit, actionMode, selectedBall)
      .find(candidate => hexToIndex(candidate.position, currentView.map) === index);
    if (!target) {
      pendingTarget = null;
      say(actionMode === 'attack' ? '攻击目标必须是可见且可攻击的敌方单位或非己方城市。' : '捕捉目标必须是当前球种可捕捉的相邻野生宝可梦。', true);
      render();
      return;
    }
    pendingTarget = { kind: target.kind, id: target.id, index };
    say(actionMode === 'attack' ? '已选择攻击目标；请在单位面板确认。' : '已选择捕捉目标；请在单位面板确认。');
    render();
    return;
  }
  const unit = currentView.units.find(candidate => candidate.ownerId === currentView.playerId && hexToIndex(candidate.position, currentView.map) === index);
  const city = currentView.economy.cities.find(candidate => hexToIndex(candidate.position, currentView.map) === index);
  selectedUnit = unit?.id ?? null; selectedCity = city?.id ?? null;
  setAction(actionSelect.value); render();
});
window.addEventListener('keydown', event => {
  if (districtPlacement && view) {
    const city = view.economy.cities.find(item => item.id === districtPlacement!.cityId);
    const fallback = districtPlacement.tileIndex ?? (city ? hexToIndex(city.position, view.map) : null);
    if (fallback === null) return;
    const hex = indexToHex(fallback, view.map), directions: Record<string, { q: number; r: number }> = {
      ArrowLeft: { q: hex.q - 1, r: hex.r }, ArrowRight: { q: hex.q + 1, r: hex.r },
      ArrowUp: { q: hex.q, r: hex.r - 1 }, ArrowDown: { q: hex.q, r: hex.r + 1 },
    };
    if (directions[event.key]) {
      event.preventDefault(); districtPlacement.tileIndex = hexToIndex(directions[event.key], view.map) ?? fallback; render(); return;
    }
    if (event.key === 'Enter') { event.preventDefault(); districtPlacement.tileIndex = fallback; confirmDistrictPlacement(); return; }
    if (event.key === 'Escape') { event.preventDefault(); cancelDistrictPlacement(); return; }
  }
  if (event.key === 'Escape' && actionMode !== null) {
    resetAction();
    say('已取消当前地图操作。');
    render();
  }
});

canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoomAt(camera, localPoint(event), Math.exp(-event.deltaY * .001));
  render();
}, { passive: false });
new ResizeObserver(() => render()).observe(canvas);
const factionLegend = document.querySelector<HTMLUListElement>('#faction-legend')!;
for (const faction of FACTION_LEGEND) factionLegend.append(Object.assign(document.createElement('li'), { textContent: faction.label }));
setAction('EndTurn');
render();
updateOwnerControls();
loadPokemonSprites(() => render());
let connectingHash: string | null = null;
function connectFromHash(): void {
  const hash = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const room = params.get('room');
  const seat = params.get('seat');
  const token = params.get('token');
  if (!room || seat === null || !token || connectingHash === hash) return;
  connectingHash = hash;
  const api = params.get('api') ?? location.origin;
  const kindParam = params.get('kind');
  const tokenKind = kindParam === 'invite' || kindParam === 'seat' ? kindParam : 'unknown';
  void connect(api, room, Number(seat), token, tokenKind)
    .catch(error => say(error instanceof Error ? error.message : String(error), true))
    .finally(() => {
      if (connectingHash === hash) connectingHash = null;
    });
}
window.addEventListener('hashchange', connectFromHash);
connectFromHash();
window.setInterval(() => void refresh(), 2000);

// Clear the fallback only after synchronous page initialization succeeds.
document.querySelector<HTMLElement>('#startup-notice')!.hidden = true;
