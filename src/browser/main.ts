import { ERA_ABILITIES, WEATHERS } from '../content/era-abilities.ts';
import { ESSENCE_IDS, ESSENCES } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { TechId } from '../content/economy.ts';
import { canResearch } from '../core/economy-commands.ts';
import { CHARTERS, POLICIES } from '../content/policies.ts';
import { IMPROVEMENTS } from '../content/improvements.ts';
import { DISCOVERIES } from '../content/discoveries.ts';
import { renderEraPanel } from './era-panel.ts';
import { renderPolicyPanel } from './policy-panel.ts';
import type { EraProgression } from '../content/eras.ts';
import { LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import { renderExpansionPanel } from './expansion-panel.ts';
import { renderEconomyPanel } from './economy-panel.ts';
import { AUDIT_SNAPSHOT_KEY } from '../audit/sandbox.ts';
import { renderUnitPanel } from './unit-panel.ts';
import { renderSelectionPanel } from './selection-panel.ts';
import { renderResearchPanel } from './research-panel.ts';
import { renderLeaderPanel, renderLeaderSetup, selectedLeaderId } from './leader-panel.ts';
import { loadPokemonSprites } from './sprites.ts';
import { renderDiplomacyPanel, hasPendingPeace } from './diplomacy-panel.ts';
import { renderOutcome } from './outcome-panel.ts';
import { renderNeutralPanel } from './neutral-panel.ts';
import type { ActionMode, PendingTarget } from './unit-panel.ts';
import type { AiPersonality, CitySummary, Command, GameSetup } from '../core/model.ts';
import { GameSession } from '../app/session.ts';
import type { PlayerSession } from '../app/session.ts';
import { CONTENT as BASE_CONTENT, EXPANSION_CONTENT, unitDefinition } from '../content/units.ts';
import type { StarterId } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import { LEADER_IDS } from '../content/leaders.ts';
import { speciesDisplay } from '../content/species.ts';
import { hexToIndex, indexToHex } from '../core/hex.ts';
import { reachablePaths } from '../core/movement.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { BIOME_DISPLAY, FACTION_LEGEND, drawMap } from './canvas.ts';
import type { AnimationPose, MapEffect } from './canvas.ts';
import { fitCamera, hexToWorld, toWorld, worldToHex, zoomAt } from './camera.ts';
import type { Camera, Point } from './camera.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const info = document.querySelector<HTMLElement>('#map-info')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const frameMetricsElement = document.querySelector<HTMLElement>('#frame-metrics')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const actionNotice = document.querySelector<HTMLElement>('#action-notice')!;
const animate = document.querySelector<HTMLInputElement>('#animate')!;
const god = document.querySelector<HTMLInputElement>('#god')!;
const starter = document.querySelector<HTMLSelectElement>('#starter')!;
const sequence = document.querySelector<HTMLInputElement>('#sequence')!;
const endTurn = document.querySelector<HTMLButtonElement>('#end-turn')!;
document.querySelector<HTMLAnchorElement>('#open-audit')!.addEventListener('click', event => {
  event.preventDefault();
  try {
    sessionStorage.setItem(AUDIT_SNAPSHOT_KEY, driver.save());
    const auditWindow = window.open('/audit.html', '_blank');
    if (auditWindow) auditWindow.opener = null;
    else { notice = '请允许打开审计页面，或在新标签页访问 /audit.html 并导入存档。'; controls(); }
  } catch (error) { notice = `无法打开审计副本：${String(error)}`; controls(); }
});
type MovedPayload = Extract<VisibleEvent['payload'], { type: 'Moved' }>;
type BattlePayload = Extract<VisibleEvent['payload'], { type: 'BattleResolved' }>;
type CapturePayload = Extract<VisibleEvent['payload'], { type: 'Captured' }>;
type EvolvePayload = Extract<VisibleEvent['payload'], { type: 'Evolved' }>;
type Active = { kind: 'move'; payload: MovedPayload; started: number }
  | { kind: 'battle'; payload: BattlePayload; started: number }
  | { kind: 'capture'; payload: CapturePayload; started: number }
  | { kind: 'evolve'; payload: EvolvePayload; started: number };
export type FrameMetrics = { samples: number; last: number; mean: number; p95: number; max: number };
const frameDurations: number[] = [];
function frameMetrics(): FrameMetrics {
  const sorted = [...frameDurations].sort((a, b) => a - b);
  const sum = frameDurations.reduce((total, duration) => total + duration, 0);
  return { samples: frameDurations.length, last: frameDurations.at(-1) ?? 0,
    mean: frameDurations.length ? sum / frameDurations.length : 0,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0, max: sorted.at(-1) ?? 0 };
}
export let session: PlayerSession;
let driver: GameSession;
export const developerAdapter = {
  getState: () => driver.getState(),
  getDebugView: () => driver.getDebugView(),
  exportLog: () => driver.exportLog(),
  save: () => driver.save(),
  getFrameMetrics: () => ({ ...frameMetrics() }),
};
export let camera: Camera = { x: 0, y: 0, zoom: 1 };
let selected: number | null = null;
let selectedCity: number | null = null;
let neutralCity: CitySummary | null = null;
let keyboardIndex: number | null = null;
const activityLog: string[] = [];
let actionMode: ActionMode = null;
let pendingTarget: PendingTarget | null = null;
let selectedBall: BallId = 'pokeBall';
let active: Active | null = null;
let frameRequested = false;
let notice = '';
let presentationIndex = 0;
const busy = () => active !== null || presentationIndex < session.presentationQueue.length;

function duration(item: Active) {
  if (item.kind === 'move') return Math.max(1, item.payload.path.length - 1) * 180;
  if (item.kind === 'battle' || item.kind === 'capture') return 600;
  return 450;
}
function summary(payload: VisibleEvent['payload']) {
  switch (payload.type) {
    case 'BattleResolved': return `攻击结算：造成 ${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}${payload.knockedDownUnitIds.length ? '，有单位击坠/休养' : ''}。`;
    case 'Captured': return payload.success ? `捕捉成功（${payload.probability}%）。` : `捕捉失败（${payload.probability}%），目标激怒。`;
    case 'Evolved': return `进化完成：${speciesDisplay(payload.speciesId).name}。`;
    default: return '';
  }
}
export function battleActivityText(payload: BattlePayload, view: PlayerView): string {
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const unitLabel = (id: number) => {
    const unit = view.units.find(candidate => candidate.id === id);
    if (!unit) return '未知单位';
    const name = unitDefinition(unit, CONTENT).name;
    return unit.ownerId === null ? `野生 ${name}` : `文明 ${unit.ownerId + 1} 的 ${name}`;
  };
  const targetLabel = payload.target.kind === 'unit' ? unitLabel(payload.target.id) : (() => {
    const city = view.cities.find(candidate => candidate.id === payload.target.id);
    if (!city) return '未知城市';
    return city.ownerId === null ? `中立营地 ${city.id}` : `文明 ${city.ownerId + 1} 的 城市 ${city.id}`;
  })();
  return `${unitLabel(payload.attackerId)} 攻击了 ${targetLabel}：${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}`;
}
function activityText(payload: VisibleEvent['payload']) {
  switch (payload.type) {
    case 'TurnChanged': return `文明 ${payload.activePlayerId + 1} 开始行动`;
    case 'Moved': return `${payload.unit.ownerId === null ? '野生' : `文明 ${payload.unit.ownerId + 1}`}单位移动`;
    case 'BattleResolved': return battleActivityText(payload, session.getView());
    case 'Captured': return `文明 ${payload.playerId + 1} 捕捉${payload.success ? '成功' : '失败'}`;
    case 'Evolved': return `文明 ${payload.playerId + 1} 进化为${speciesDisplay(payload.speciesId).name}`;
    case 'DiplomacyChanged': return `文明 ${payload.relation.a + 1}/${payload.relation.b + 1}：${payload.relation.status === 'war' ? '战争' : '和平'}${payload.relation.proposal ? '，停战待回应' : ''}`;
    case 'CityFounded': return `文明 ${payload.playerId + 1} 建立城市 ${payload.cityId}`;
    case 'UnitTrained': return `文明 ${payload.playerId + 1} 训练单位`;
    case 'CivilizationEliminated': return `文明 ${payload.eliminatedPlayerId + 1} 出局`;
    case 'GameEnded': return '对局结束';
    case 'TileWorked': return payload.completed ? `建成${IMPROVEMENTS[payload.kind].name}` : `施工${IMPROVEMENTS[payload.kind].name} ${payload.progress}/${payload.required}`;
    case 'WeatherSummoned': return `文明 ${payload.playerId + 1} 召唤了${WEATHERS[payload.weather].name}`;
    case 'EraAbilityUsed': return `文明 ${payload.playerId + 1} 发动${ERA_ABILITIES[payload.ability].name}${payload.typeId ? `（${TYPE_NAMES[payload.typeId]}）` : ''}`;
    case 'GymBuilt': return `城市 ${payload.cityId} 建成${ESSENCES[payload.essence].name}道馆`;
    case 'CharterAdopted': return `文明 ${payload.playerId + 1} 确立规章「${CHARTERS[payload.charterId].name}」`;
    case 'PoliciesChanged': return `方针更新：${payload.policyIds.map(id => POLICIES[id].name).join('、') || '无'}${payload.goldCost ? `（${payload.goldCost} 金）` : ''}`;
    case 'DiscoveryMade': return `★ 图鉴发现「${DISCOVERIES[payload.techId].name}」：${EXPANSION_CONTENT.techs[payload.techId].name} +${payload.bonus}`;
    default: return '';
  }
}
function recordActivity(payload: VisibleEvent['payload']) {
  const text = activityText(payload);
  if (!text || activityLog[0] === text) return;
  activityLog.unshift(text);
  activityLog.splice(6);
}
function controls() {
  const view = session.getView();
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const ended = view.outcome !== null, pendingPeace = hasPendingPeace(view);
  if (selected !== null && !view.units.some(unit => unit.id === selected && unit.ownerId === view.playerId)) {
    selected = null; resetAction();
  }
  if (selectedCity !== null && !view.economy.cities.some(city => city.id === selectedCity)) selectedCity = null;
  const { player } = view.economy;
  const yields = view.economy.cities.reduce((sum, city) => ({
    gold: sum.gold + city.yields.gold,
    research: sum.research + city.yields.research,
  }), { gold: 0, research: 0 });
  const upkeep = [...view.units, ...view.recoveringUnits].filter(unit => unit.ownerId === view.playerId)
    .reduce((sum, unit) => sum + unitDefinition(unit, CONTENT).upkeep, 0);
  const netGold = yields.gold - upkeep;
  info.textContent = `种子 ${view.seed} · 第 ${view.round} 轮 · 当前文明 ${view.activePlayerId + 1} · 命令 ${view.commandSeq}`;
  const sizeName = view.map.width === 24 ? '小地图' : view.map.width === 30 ? '标准地图' : '大地图';
  document.querySelector('#map-size-label')!.textContent = `${sizeName} · ${view.map.width} × ${view.map.height}`;
  document.querySelector('#round-display')!.innerHTML = `${view.round} <span>/ ${view.roundLimit}</span>`;
  document.querySelector('#hud-gold')!.innerHTML = `${player.gold} <span class="delta">${netGold >= 0 ? '+' : ''}${netGold}</span>`;
  document.querySelector('#hud-research')!.innerHTML = `${yields.research} <span class="delta">/ 轮</span>`;
  document.querySelector('#hud-upkeep')!.innerHTML = `−${upkeep} <span class="delta negative">金币</span>`;
  const essences = view.expansion?.essences;
  document.querySelector('#hud-essences')!.innerHTML = essences ? ESSENCE_IDS.map(id => `<span class="essence-chip" title="${ESSENCES[id].name}精华：${ESSENCES[id].types.map(type => TYPE_NAMES[type]).join('、')}系 · 来自${BIOME_DISPLAY[ESSENCES[id].biome].label}" style="--essence:${ESSENCES[id].color}"><b>${ESSENCES[id].mark}</b>${essences.stock[id]}<small>+${essences.perRound[id]}</small></span>`).join('') : '';
  const unit = view.units.find(unit => unit.id === selected);
  selection.textContent = unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · ${unit.actionLeft ? '点击高亮格直接移动，或右键移动' : '本回合已行动'}`
    : selectedCity !== null ? `已选城市 ${selectedCity} · 在城市面板建造、训练或采购`
    : '点选城市管理生产，点选单位执行行动；拖动地图平移，滚轮缩放。';
  actionNotice.textContent = notice || (pendingPeace ? '请先回应停战提议。' : actionMode === 'attack' ? '攻击模式：选择红色虚线目标，再确认攻击。'
    : actionMode === 'move' ? '移动模式：点击高亮格移动，包括己方城市。Esc 取消。'
    : actionMode === 'capture' ? '捕捉模式：选择野生宝可梦，再确认捕捉。' : ended ? '对局已结束，可开始新局。' : '');
  actionNotice.classList.toggle('is-error', notice.includes('拒绝') || notice.includes('失败'));
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${driver.lastRejected ? JSON.stringify(driver.lastRejected) : '无'}${notice ? '\n' + notice : ''}`;
  sequence.max = String(driver.exportLog().commands.length);
  renderSelectionPanel(view, selected, selectedCity, { unit: selectUnit, city: selectCity, clear: clearSelection }, busy());
  document.querySelector<HTMLElement>('#era-panel')!.innerHTML = renderEraPanel(view);
  renderPolicyPanel(view, issue, busy() || ended || pendingPeace);
  renderLeaderPanel(view);
  renderExpansionPanel(view, selected, selectedCity, issue, busy() || ended || pendingPeace);
  document.querySelector<HTMLElement>('#selection-empty')!.hidden = selected !== null || selectedCity !== null || neutralCity !== null;
  renderUnitPanel(view, selected, actionMode, pendingTarget, selectedBall, busy() || ended || pendingPeace, {
    mode: mode => { actionMode = mode; pendingTarget = null; notice = ''; controls(); requestFrame(); },
    confirm: confirmAction,
    cancel: () => { actionMode = null; pendingTarget = null; notice = ''; controls(); requestFrame(); },
    evolve: evolveSelected,
    ball: ballId => { selectedBall = ballId; controls(); requestFrame(); },
    found: () => { if (selected !== null) issue({ type: 'FoundCity', unitId: selected }); },
    improve: (tileIndex, kind) => { if (selected !== null) issue({ type: 'ImproveTile', unitId: selected, tileIndex, kind }); },
    issue,
  });
  renderEconomyPanel(view, selectedCity, issue, busy() || ended || pendingPeace);
  renderResearchPanel(view, issue, busy() || ended || pendingPeace);
  renderNeutralPanel(view, neutralCity);
  renderDiplomacyPanel(view, busy() || ended, issue);
  renderOutcome(view, newGame);
  document.querySelector('#activity-list')!.innerHTML = activityLog.length ? activityLog.map(text => `<li>${text}</li>`).join('') : '<li>暂无动态</li>';
  if (busy() || ended || pendingPeace) for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#economy button, #economy input, #economy select')) element.disabled = true;
  for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#controls button, #controls input, #controls select, #dev-drawer button, #dev-drawer input, #skip')) {
    const newGameSetting = element.matches('#leader-setup input, #starter, #map-size, #round-limit, #ai-count, #ai-personality, #era-progression');
    const transition = pendingPeace && !ended && (newGameSetting || ['new-game', 'load-game', 'import-save', 'replay', 'resume'].includes(element.id));
    element.disabled = element.id === 'skip' ? !busy()
      : element.id === 'new-game' || newGameSetting ? busy() || transition : busy() || ended || transition;
  }
  endTurn.disabled = busy() || ended || pendingPeace;
  document.querySelector('#turn-reminders')!.innerHTML = ended ? '' : turnReminders(view, CONTENT).map(item => `<button type="button" data-reminder="${item.target}">${item.label}</button>`).join('');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reminder]')) button.onclick = () => {
    const kind = button.dataset.reminder!;
    if (kind === 'city' || kind === 'unit') { cycleIdle(kind); return; }
    const target = document.querySelector<HTMLElement>(kind);
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
}

/** Selects the next idle city or unit after the current selection, cycling. */
function cycleIdle(kind: 'city' | 'unit') {
  const view = session.getView();
  if (kind === 'city') {
    const ids = view.economy.cities.filter(city => city.queue.length === 0).map(city => city.id).sort((a, b) => a - b);
    selectCity(ids.find(id => id > (selectedCity ?? -1)) ?? ids[0] ?? null);
    document.querySelector('#economy')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    const ids = view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).map(unit => unit.id).sort((a, b) => a - b);
    selectUnit(ids.find(id => id > (selected ?? -1)) ?? ids[0] ?? null);
  }
}
/** Non-blocking reminders for idle research, charters, cities or units (Civilization "needs orders"). */
function turnReminders(view: PlayerView, content: typeof EXPANSION_CONTENT): { label: string; target: string }[] {
  const items: { label: string; target: string }[] = [];
  const player = view.economy.player;
  if (player.research.techId === null && (Object.keys(content.techs) as TechId[]).some(id => canResearch(player, id))) items.push({ label: '选择研究', target: '#research-panel' });
  const policies = view.expansion?.policies;
  if (policies && policies.charterId === null && policies.adopted.length < Object.keys(CHARTERS).length) items.push({ label: '选择规章', target: '#policy-panel' });
  const idleCities = view.economy.cities.filter(city => city.queue.length === 0).length;
  if (idleCities) items.push({ label: `${idleCities} 城空闲`, target: 'city' });
  const idleUnits = view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).length;
  if (idleUnits) items.push({ label: `${idleUnits} 单位待命`, target: 'unit' });
  return items;
}
function issue(action: Command['action']) {
  const view = session.getView();
  if (busy() || view.outcome) return;
  if (action.type !== 'RespondPeace' && hasPendingPeace(view)) { notice = '请先接受或拒绝停战提议。'; controls(); return; }
  const result = session.issue(action);
  if (!result.ok) {
    const reason = result.reason === 'diplomacy-unavailable' ? '当前关系或冷却时机不允许该外交操作'
      : result.reason === 'game-ended' ? '对局已结束'
      : result.reason === 'invalid-city-site' ? '此处不能建城：需要陆地，且距所有城市至少 4 格'
      : result.reason === 'no-action' ? '本回合已行动，请结束回合后再试' : result.reason;
    notice = `${action.type} 被拒绝：${reason}`;
  }
  else {
    notice = '';
    if (action.type === 'Attack' || action.type === 'Capture' || action.type === 'Move') resetAction();
    if (action.type === 'FoundCity') {
      selected = null; selectedCity = session.getView().economy.cities.at(-1)!.id; resetAction();
      notice = `城市 ${selectedCity} 已建立。现在可以建造建筑或训练新的单位。`;
    }
  }
  controls(); requestFrame();
}
function confirmAction() {
  if (selected === null || !pendingTarget) return;
  if (actionMode === 'attack') issue({ type: 'Attack', unitId: selected, target: { kind: pendingTarget.kind, id: pendingTarget.id } });
  else if (actionMode === 'capture') issue({ type: 'Capture', unitId: selected, targetUnitId: pendingTarget.id, ballId: selectedBall });
}
function evolveSelected() {
  const view = session.getView(), unit = view.units.find(unit => unit.id === selected && unit.kind === 'pokemon');
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const evolution = unit?.kind === 'pokemon' ? CONTENT.species[unit.speciesId].evolution : null;
  if (unit && evolution) issue({ type: 'Evolve', unitId: unit.id, intoSpeciesId: evolution.speciesId });
}
function requestFrame() {
  if (session && !frameRequested) { frameRequested = true; requestAnimationFrame(frame); }
}
function finishPresentations() {
  const pending = session.presentationQueue.slice(presentationIndex);
  for (const event of pending) recordActivity(event.payload);
  const payloads = [...(active ? [active.payload] : []), ...pending.map(event => event.payload)];
  const text = payloads.map(summary).filter(Boolean).at(-1);
  if (text) notice = text;
  active = null;
  presentationIndex = 0;
  session.skipAnimations();
}
function frame(now: number) {
  frameRequested = false;
  if (!animate.checked) finishPresentations();
  if (active && now - active.started >= duration(active)) {
    notice = summary(active.payload) || notice;
    active = null;
  }
  // The player session returns a defensive copy; read it once per frame, not per event.
  const queue = session.presentationQueue;
  while (!active && presentationIndex < queue.length) {
    const event = queue[presentationIndex++]!;
    recordActivity(event.payload);
    if (event.payload.type === 'Moved') active = { kind: 'move', payload: event.payload, started: now };
    else if (event.payload.type === 'BattleResolved') active = { kind: 'battle', payload: event.payload, started: now };
    else if (event.payload.type === 'Captured') active = { kind: 'capture', payload: event.payload, started: now };
    else if (event.payload.type === 'Evolved') active = { kind: 'evolve', payload: event.payload, started: now };
  }
  let pose: AnimationPose | undefined, effect: MapEffect | undefined;
  if (active?.kind === 'move') {
    const path = active.payload.path;
    const progress = Math.min(path.length - 1, (now - active.started) / 180);
    const index = Math.floor(progress), fraction = progress - index;
    const a = hexToWorld(path[index]), b = hexToWorld(path[Math.min(index + 1, path.length - 1)]);
    pose = { unit: active.payload.unit, position: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction } };
  } else if (active) {
    const progress = Math.min(1, (now - active.started) / duration(active));
    if (active.kind === 'battle') effect = { kind: 'battle', position: active.payload.positions[1], damage: active.payload.damage, counterDamage: active.payload.counterDamage, progress };
    else if (active.kind === 'capture') {
      const payload = active.payload;
      const target = session.getView().units.find(unit => unit.id === payload.targetUnitId);
      if (target) effect = { kind: 'capture', position: target.position, success: payload.success, progress };
    } else {
      const payload = active.payload;
      const unit = session.getView().units.find(unit => unit.id === payload.unitId);
      if (unit) effect = { kind: 'evolve', position: unit.position, progress };
    }
  }
  const view = session.getView();
  const paths = selected === null ? {} : reachablePaths(view, selected);
  const targets = actionMode === 'attack'
    ? [...view.units.filter(unit => unit.ownerId !== view.playerId).map(unit => hexToIndex(unit.position, view.map)!),
      ...view.cities.filter(city => city.ownerId !== view.playerId).map(city => hexToIndex(city.position, view.map)!)]
    : actionMode === 'capture' ? view.units.filter(unit => unit.ownerId === null).map(unit => hexToIndex(unit.position, view.map)!) : [];
  const drawStarted = performance.now();
  drawMap(canvas, import.meta.env.DEV && god.checked ? developerAdapter.getDebugView() : view,
    camera, selected, Object.keys(paths).map(Number), pose, keyboardIndex, effect, actionMode, targets, pendingTarget?.index, selectedCity, import.meta.env.DEV ? document.querySelector<HTMLSelectElement>('#debug-overlay')!.value as import('./canvas.ts').DebugOverlay : 'none');
  frameDurations.push(performance.now() - drawStarted);
  if (frameDurations.length > 240) frameDurations.shift();
  if (import.meta.env.DEV) {
    const metrics = frameMetrics();
    frameMetricsElement.textContent = `帧绘制耗时（最近 ${metrics.samples} 帧）：${metrics.last.toFixed(2)} ms\n均值 ${metrics.mean.toFixed(2)} ms · p95 ${metrics.p95.toFixed(2)} ms · 最大 ${metrics.max.toFixed(2)} ms`;
  }
  // Drop fully presented events so the queue (and its per-frame copy) stays small in long games.
  if (!active && presentationIndex > 0 && presentationIndex >= queue.length) { session.skipAnimations(); presentationIndex = 0; }
  if (busy()) requestFrame(); else controls();
}
function skip() { finishPresentations(); controls(); requestFrame(); }
function fit() { camera = fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight); requestFrame(); }
function resetAction() { actionMode = null; pendingTarget = null; }
function clearSelection() {
  selected = null; selectedCity = null; neutralCity = null; keyboardIndex = null;
  resetAction(); notice = ''; controls(); requestFrame();
}
function focusHex(position: { q: number; r: number }) {
  keyboardIndex = hexToIndex(position, session.getView().map);
  camera.zoom = Math.max(camera.zoom, 1.5);
  const point = hexToWorld(position);
  camera.x = canvas.clientWidth / 2 - point.x * camera.zoom;
  camera.y = canvas.clientHeight / 2 - point.y * camera.zoom;
}
function selectUnit(id: number | null, focus = true) {
  const unit = session.getView().units.find(unit => unit.id === id && unit.ownerId === session.getView().playerId);
  selected = unit?.id ?? null; selectedCity = null; neutralCity = null;
  resetAction(); notice = '';
  if (unit && focus) focusHex(unit.position);
  controls(); requestFrame();
}
function selectCity(id: number | null, focus = true) {
  const city = session.getView().economy.cities.find(city => city.id === id);
  selectedCity = city?.id ?? null; selected = null; neutralCity = null;
  resetAction(); notice = '';
  if (city && focus) focusHex(city.position);
  controls(); requestFrame();
}
function transitionBlocked() {
  const view = session.getView();
  if (view.outcome || !hasPendingPeace(view)) return false;
  notice = '请先接受或拒绝停战提议，再切换对局。'; controls(); return true;
}
function newGame() {
  if (session && transitionBlocked()) return;
  try {
    const aiCount = Number(document.querySelector<HTMLSelectElement>('#ai-count')!.value);
    const personality = document.querySelector<HTMLSelectElement>('#ai-personality')!.value as AiPersonality;
    const humanLeaderId = selectedLeaderId();
    // Nine leaders: AI opponents are drawn without repeats from the rest, ordered by the map seed.
    const seed = Number(new URLSearchParams(location.search).get('seed') ?? '12345');
    const aiLeaderIds = LEADER_IDS.filter(id => id !== humanLeaderId)
      .map((id, index) => ({ id, key: (Math.imul(seed + 1, 2654435761) ^ Math.imul(index + 7, 40503)) >>> 0 }))
      .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id)).map(item => item.id);
    const players: GameSetup['players'] = [{ id: 0, controller: 'human', starterId: starter.value as StarterId, leaderId: humanLeaderId },
      ...Array.from({ length: aiCount }, (_, index) => ({ id: index + 1, controller: 'ai' as const, personality, leaderId: aiLeaderIds[index] }))];
    const mapSizes = { '24x16': { width: 24, height: 16 }, '30x20': { width: 30, height: 20 }, '40x26': { width: 40, height: 26 } } as const;
    const sizeOption = document.querySelector<HTMLSelectElement>('#map-size')!.value as keyof typeof mapSizes;
    const size = mapSizes[sizeOption] ?? mapSizes['24x16'];
    const eraProgression = document.querySelector<HTMLSelectElement>('#era-progression')!.value as EraProgression;
    driver = new GameSession({ expansionVersion: 1, eraProgression, gameplayVersion: LATEST_GAMEPLAY_VERSION, seed: Number(new URLSearchParams(location.search).get('seed') ?? '12345'), ...size,
      roundLimit: Number(document.querySelector<HTMLSelectElement>('#round-limit')!.value) as GameSetup['roundLimit'], players });
    session = driver.asPlayerSession();
    active = null; presentationIndex = 0; selected = null; selectedCity = session.getView().economy.player.headquartersCityId; neutralCity = null; keyboardIndex = null; activityLog.length = 0;
    frameDurations.length = 0;
    resetAction(); notice = ''; sequence.value = '0';
    canvas.hidden = false;
    fit();
    selectCity(selectedCity);
    // Opening camera focus should not change the first keyboard unit selection.
    keyboardIndex = null;
  } catch (error) {
    canvas.hidden = true;
    info.textContent = `无法生成地图：${error instanceof Error ? error.message : String(error)}`;
    for (const element of document.querySelectorAll<HTMLButtonElement>('#controls button, #end-turn')) element.disabled = true;
  }
}
function activateIndex(index: number | null) {
  if (busy()) return;
  const view = session.getView();
  keyboardIndex = index;
  if (index === null) { clearSelection(); return; }
  if (actionMode === 'move' && selected !== null) {
    if (reachablePaths(view, selected)[index]) issue({ type: 'Move', unitId: selected, to: indexToHex(index, view.map) });
    else { notice = '此处无法移动，请选择高亮格，或取消移动以选择其他对象。'; controls(); }
    requestFrame(); return;
  }
  if (actionMode && selected !== null) {
    const unit = view.units.find(unit => hexToIndex(unit.position, view.map) === index);
    const city = view.cities.find(city => hexToIndex(city.position, view.map) === index);
    if (actionMode === 'attack' && unit && unit.ownerId !== view.playerId) pendingTarget = { kind: 'unit', id: unit.id, index };
    else if (actionMode === 'attack' && city && city.ownerId !== view.playerId) pendingTarget = { kind: 'city', id: city.id, index };
    else if (actionMode === 'capture' && unit?.ownerId === null) pendingTarget = { kind: 'unit', id: unit.id, index };
    else { pendingTarget = null; notice = '该目标不适用；请选择高亮目标。'; }
    controls(); requestFrame(); return;
  }
  const hex = indexToHex(index, view.map);
  const city = view.cities.find(city => hexToIndex(city.position, view.map) === index);
  if (city?.ownerId === null) {
    neutralCity = city; selected = null; selectedCity = null; resetAction(); notice = '';
    controls(); requestFrame(); return;
  }
  neutralCity = null;
  const own = view.units.find(unit => unit.ownerId === view.playerId && hexToIndex(unit.position, view.map) === index);
  const ownCity = city?.ownerId === view.playerId ? city : null;
  if (ownCity && (!own || selectedCity !== ownCity.id)) { selectCity(ownCity.id, false); return; }
  if (own) { selectUnit(own.id, false); return; }
  if (selected !== null && reachablePaths(view, selected)[index]) issue({ type: 'Move', unitId: selected, to: hex });
  else { selected = null; selectedCity = null; resetAction(); notice = ''; }
  controls(); requestFrame();
}
function localPoint(event: { clientX: number; clientY: number }): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
let drag: { start: Point; last: Point; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const point = localPoint(event); drag = { start: point, last: point, moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const point = localPoint(event);
  if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
  if (drag.moved) {
    camera.x += point.x - drag.last.x; camera.y += point.y - drag.last.y;
    requestFrame();
  }
  drag.last = point;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerup', event => {
  const click = drag && !drag.moved; drag = null;
  if (!click || busy()) return;
  const hex = worldToHex(toWorld(localPoint(event), camera));
  activateIndex(hexToIndex(hex, session.getView().map));
});
canvas.addEventListener('wheel', event => {
  event.preventDefault(); zoomAt(camera, localPoint(event), Math.exp(-event.deltaY * .001)); requestFrame();
}, { passive: false });
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (busy() || selected === null) return;
  const view = session.getView(), hex = worldToHex(toWorld(localPoint(event), camera));
  const index = hexToIndex(hex, view.map);
  if (index !== null && reachablePaths(view, selected)[index]) issue({ type: 'Move', unitId: selected, to: hex });
});
canvas.addEventListener('keydown', event => {
  if (busy()) return;
  const view = session.getView();
  const selectedUnit = view.units.find(unit => unit.id === selected);
  const current = keyboardIndex ?? (selectedUnit ? hexToIndex(selectedUnit.position, view.map) : null);
  const initialUnit = view.units.find(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon')
    ?? view.units.find(unit => unit.ownerId === view.playerId);
  const initialPosition = initialUnit?.position ?? view.economy.cities[0]?.position;
  const fallback = current ?? (initialPosition ? hexToIndex(initialPosition, view.map) : null);
  if (fallback === null) return;
  const hex = indexToHex(fallback, view.map);
  const directions: Record<string, { q: number; r: number }> = {
    ArrowLeft: { q: hex.q - 1, r: hex.r }, ArrowRight: { q: hex.q + 1, r: hex.r },
    ArrowUp: { q: hex.q, r: hex.r - 1 }, ArrowDown: { q: hex.q, r: hex.r + 1 },
  };
  if (directions[event.key]) {
    event.preventDefault();
    keyboardIndex = hexToIndex(directions[event.key], view.map) ?? fallback;
    requestFrame();
  } else if (event.key === 'Enter') { event.preventDefault(); activateIndex(fallback); }
  else if (event.key === 'Escape') { event.preventDefault(); clearSelection(); }
  else if (event.key === '+' || event.key === '=' || event.key === '-') {
    event.preventDefault();
    zoomAt(camera, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, event.key === '-' ? .9 : 1.1);
    requestFrame();
  } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
});
endTurn.addEventListener('click', () => { if (!busy()) issue({ type: 'EndTurn' }); });
document.querySelector('#skip')!.addEventListener('click', skip);
document.querySelector('#debug-overlay')!.addEventListener('change', requestFrame);
document.querySelector('#new-game')!.addEventListener('click', newGame);
document.querySelector('#fit')!.addEventListener('click', fit);
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(driver.exportLog(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `pokemon-${session.getView().seed}-commands.json`;
  link.click(); URL.revokeObjectURL(url);
});
document.querySelector('#replay')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  try { driver.replayTo(Number(sequence.value)); selected = null; selectedCity = null; neutralCity = null; keyboardIndex = null; resetAction(); notice = ''; skip(); }
  catch (error) { notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  driver.resumeFromReplay(); selected = null; selectedCity = null; neutralCity = null; keyboardIndex = null; resetAction(); controls(); requestFrame();
});
const saveKey = 'pokemon-civilization-save';
function load(text: string) {
  if (transitionBlocked()) return;
  driver.load(text); active = null; selected = null; selectedCity = session.getView().economy.cities[0]?.id ?? null; neutralCity = null; keyboardIndex = null; activityLog.length = 0; resetAction(); notice = '读档完成';
  frameDurations.length = 0;
  fit(); skip();
}
function storageAction(action: () => void) {
  try { action(); } catch (error) { notice = error instanceof Error ? error.message : String(error); }
  controls();
}
document.querySelector('#save-game')!.addEventListener('click', () => storageAction(() => {
  localStorage.setItem(saveKey, driver.save()); notice = '已保存到此浏览器';
}));
document.querySelector('#load-game')!.addEventListener('click', () => storageAction(() => {
  const text = localStorage.getItem(saveKey); if (!text) throw new Error('此浏览器暂无存档'); load(text);
}));
document.querySelector('#export-save')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([driver.save()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pokemon-save.json'; link.click(); URL.revokeObjectURL(url);
});
document.querySelector<HTMLInputElement>('#import-save')!.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try { const text = await file.text(); if (!busy()) storageAction(() => load(text)); }
  catch (error) { notice = String(error); controls(); }
  input.value = '';
});
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
  if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); if (!busy()) issue({ type: 'EndTurn' }); }
  else if (event.key.toLowerCase() === 'c') {
    event.preventDefault();
    selectCity(session.getView().economy.cities[0]?.id ?? null);
    document.querySelector<HTMLElement>('#city-select')?.focus();
  } else if (['r', 't'].includes(event.key.toLowerCase())) { event.preventDefault(); document.querySelector<HTMLElement>('#research-topic')?.focus(); }
  else if (event.key === '?') {
    event.preventDefault();
    const help = document.querySelector<HTMLDetailsElement>('#keyboard-help')!;
    help.open = true; help.querySelector('summary')!.focus();
  }
});
god.addEventListener('change', skip);
if (!import.meta.env.DEV) {
  document.querySelector<HTMLElement>('#god-label')!.hidden = true;
  frameMetricsElement.hidden = true;
}
new ResizeObserver(() => { if (session) requestFrame(); }).observe(canvas);
for (const { label, color, symbol } of Object.values(BIOME_DISPLAY)) {
  const item = document.createElement('li'), swatch = document.createElement('span'), text = document.createElement('span');
  swatch.className = 'swatch'; swatch.style.backgroundColor = color;
  text.className = 'legend-symbol'; text.textContent = symbol;
  item.append(swatch, text, label); document.querySelector('#legend')!.append(item);
}
for (const faction of FACTION_LEGEND) {
  const item = document.createElement('li'), swatch = document.createElement('span');
  swatch.className = `faction-swatch ${faction.className}`; swatch.textContent = String(faction.id + 1);
  item.append(swatch, faction.label); document.querySelector('#faction-legend')!.append(item);
}
renderLeaderSetup();
newGame();
loadPokemonSprites(requestFrame);

// Clear the fallback only after synchronous page initialization succeeds.
document.querySelector<HTMLElement>('#startup-notice')!.hidden = true;
