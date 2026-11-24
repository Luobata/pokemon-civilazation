import { OBJECTIVES, OBJECTIVE_IDS } from '../content/opening.ts';
import type { ObjectiveId } from '../content/opening.ts';
import { isGameplayVersion, LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import type { EraProgression, GameplayVersion } from '../content/eras.ts';
import { audio, audioSettingsMarkup, bindAudioSettings } from './audio/index.ts';
import type { SoundId } from './audio/index.ts';
import { usesMovementPoints, reachablePaths } from '../core/movement.ts';
import { leagueCountdownToast } from './notifications.ts';
import { renderLeagueResult } from './league-card.ts';
import { captureNoTargetReason, captureTargetReason } from './capture-reason.ts';
import { attackTargetReason } from './attack-reason.ts';
import { renderBallStock } from './ball-stock.ts';
import { createNotificationRail } from './notification-rail.ts';
import { ReviewedUnits, cycleId, idleCityIds, idleUnitIds, turnReminders, turnStep } from './turn-button.ts';
import type { TurnStep } from './turn-button.ts';
import { legendCompletionMarkup, legendScreenMarkup } from './legend-panel.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { SpeciesId } from '../content/species.ts';
import { ESSENCE_IDS, ESSENCES } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { bindEraPanel, renderEraPanel } from './era-panel.ts';
import { renderPolicyPanel } from './policy-panel.ts';
import { renderExpansionPanel } from './expansion-panel.ts';
import { renderEconomyPanel } from './economy-panel.ts';
import { AUDIT_SNAPSHOT_KEY } from '../audit/sandbox.ts';
import { renderUnitPanel } from './unit-panel.ts';
import { installUnitActionBar, renderUnitActionBar } from './unit-action-bar.ts';
import type { UnitBarGoTo } from './unit-action-bar.ts';
import { installTrainerCards } from './trainer-card.ts';
import { renderSelectionPanel } from './selection-panel.ts';
import { renderResearchPanel } from './research-panel.ts';
import { renderLeaderPanel, renderLeaderSetup, selectedLeaderId } from './leader-panel.ts';
import { loadPokemonSprites } from './sprites.ts';
import { closeScreen, installScreens, onScreenChange, openScreen, revealPanel } from './screens.ts';
import { renderDiplomacyPanel, hasPendingPeace } from './diplomacy-panel.ts';
import { renderOutcome } from './outcome-panel.ts';
import { renderNeutralPanel } from './neutral-panel.ts';
import type { AiPersonality, Command, GameSetup, PlayerView, VisibleEvent } from '../core/model.ts';
import { GameSession } from '../app/session.ts';
import type { PlayerSession } from '../app/session.ts';
import { unitDefinition, contentForView, techOf, regionalDexDraw, GAME_CONTENT } from '../content/units.ts';
import type { StarterId } from '../content/units.ts';
import { dexSummaryMarkup } from './regional-dex-panel.ts';
import { LEADER_IDS } from '../content/leaders.ts';
import { renderVictoryPanel } from './victory-panel.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import { actionTargets } from './action-targets.ts';
import { districtSites, previewDistrict } from '../core/districts.ts';
import { constructionNotice, districtPreviewMarkup } from './district-panel.ts';
import type { DistrictId } from '../content/districts.ts';
import { BIOME_DISPLAY, FACTION_LEGEND } from './canvas.ts';
import { FACTIONS, RENDER_MODE_KEY, applyRenderMode, createMapRenderer, requestedRenderMode } from './render/index.ts';
import type { DebugOverlay, RenderMode } from './render/index.ts';
import { createMinimap } from './render/minimap.ts';
import { applyTheme, requestedTheme, saveTheme, storedTheme } from './theme.ts';
import { onMapArtChange } from './render/painted/map-art.ts';
import { locateTrack } from './render/animation.ts';
import { describeTile, tileSummary } from './tile-info.ts';
import { renderTilePanel } from './tile-panel.ts';
import { HEX_RADIUS, fitCamera } from './camera.ts';
import type { Camera, Point } from './camera.ts';
import { combatCard, renderCombatCard } from './combat-preview.ts';
import { arrivalText, GoToOrders, isSettler, planArrivalRound, planGoTo, planStops, stopText } from './waypoints.ts';
import type { GoToPlan, GoToStop } from './waypoints.ts';
import { clearClientPlans, conferenceReviewed, markConferenceReviewed, researchQueue, runResearchQueue } from './client-plans.ts';
import { rivalMemory } from './rival-tracker.ts';
import { goToButtonOrder } from './world-goto.ts';
import { openLineupPicker } from './lineup-picker.ts';
import { escapeAttr } from './ui-icons.ts';
import { suggestCitySites } from './city-sites.ts';
import type { CitySite } from './city-sites.ts';
import { renderSitePins } from './site-pins.ts';
import type { SceneGoTo } from './render/scene.ts';
import { rememberChallenge, storedReplay } from './battle-replay.ts';
import type { BattleReplay } from './battle-replay.ts';
import { renderBattleLog, setBattleLogFilter, unitBattleLogButton } from './battle-log.ts';
import { openBattleViewer } from './battle-viewer.ts';
import { challengeCardResult, isPreviewedChallenge } from './challenge-card.ts';
import {
  clearSelectionState, computeFrameMetrics, createUIState, reconcileSelection,
  recordFrameDuration, resetActionState,
} from './shell/ui-state.ts';
import type { FrameMetrics } from './shell/ui-state.ts';
import {
  applyCommandStateEffects, buildConfirmTargetAction, buildDistrictOrderAction,
  buildEvolveAction, focusCameraOnHex,
} from './shell/game-shell.ts';
import {
  createMapTooltip, installGlobalHotkeys, installMapKeyboardControls, installMapPointerControls,
} from './shell/input.ts';
import {
  PresentationController, battleActivityText as formatBattleActivityText, battleSides as formatBattleSides,
} from './shell/presentation.ts';
import type { BattlePayload } from './shell/presentation.ts';

export type { FrameMetrics };

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const info = document.querySelector<HTMLElement>('#map-info')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const frameMetricsElement = document.querySelector<HTMLElement>('#frame-metrics')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const actionNotice = document.querySelector<HTMLElement>('#action-notice')!;
const animate = document.querySelector<HTMLInputElement>('#animate')!;
const showYields = document.querySelector<HTMLInputElement>('#show-yields')!;
const god = document.querySelector<HTMLInputElement>('#god')!;
const starter = document.querySelector<HTMLSelectElement>('#starter')!;
const sequence = document.querySelector<HTMLInputElement>('#sequence')!;
const endTurn = document.querySelector<HTMLButtonElement>('#end-turn')!;
const turnHint = document.querySelector<HTMLElement>('#turn-hint')!;
const unitCycle = [...document.querySelectorAll<HTMLButtonElement>('[data-cycle-unit]')];
const sitePins = document.querySelector<HTMLElement>('#site-pins')!;

/** `?dev=1` shows the debug line (seed, command number) and the developer drawer (replay, god view, audit). */
const devMode = new URLSearchParams(location.search).get('dev') === '1';
info.hidden = !devMode;
document.querySelector<HTMLElement>('#dev-drawer')!.hidden = !devMode;

const ui = createUIState();
export const camera: Camera = ui.camera;
export let session: PlayerSession;
const currentView = (): PlayerView => session.peekView ? session.peekView() : session.getView();
let driver: GameSession;

// Theme & map renderer initialization.
const storedRenderMode = (() => { try { return localStorage.getItem(RENDER_MODE_KEY); } catch { return null; } })();
let theme = requestedTheme(location.search, storedTheme());
applyTheme(theme);
const initialRenderMode: RenderMode = theme === 'painted' ? 'painted' : requestedRenderMode(location.search, storedRenderMode);
applyRenderMode(initialRenderMode);
const renderer = createMapRenderer(canvas, { mode: initialRenderMode });
const pickIndex = (point: Point, view: PlayerView) => hexToIndex(renderer.pick(point, camera), view.map);

let frameRequested = false;
function requestFrame() {
  if (session && !frameRequested) { frameRequested = true; requestAnimationFrame(frame); }
}

const legendArrivals: LegendWonderId[] = [];
/** Queues the full-screen story card (used when an own wonder completes; exported for tests). */
export function showLegendArrival(id: LegendWonderId) { legendArrivals.push(id); controls(); }

const rail = createNotificationRail(document.querySelector<HTMLElement>('#toast-host')!, target => {
  if (target.kind === 'screen') {
    openScreen(target.screen);
    if (target.screen === 'world') {
      const card = document.querySelector<HTMLDetailsElement>('details[data-system="s27-championship"]');
      if (card) { card.open = true; card.scrollIntoView({ block: 'nearest' }); }
    }
  } else if (target.kind === 'city') { closeScreen(); selectCity(target.cityId); }
  else if (target.kind === 'battle') watchReplay(target.key);
  else if (target.kind === 'tile') locateTile(target.tileIndex);
  else { closeScreen(); selectUnit(target.unitId); }
});

const presentation = new PresentationController({
  canvas, renderer, ui, rail,
  getSession: () => session,
  currentView,
  onLegendArrival: (id, refresh) => { legendArrivals.push(id); if (refresh) controls(); },
  onControls: () => controls(),
  onRequestFrame: requestFrame,
});
const busy = () => presentation.isBusy();

export function battleSides(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, string> = presentation.knownUnitLabels) {
  return formatBattleSides(payload, view, known);
}
export function battleActivityText(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, string> = presentation.knownUnitLabels) {
  return formatBattleActivityText(payload, view, known);
}
export function soundsFor(payload: VisibleEvent['payload'], view: PlayerView, animated = false): SoundId[] {
  return presentation.soundsFor(payload, view, animated);
}

export const developerAdapter = {
  getState: () => driver.getState(),
  getDebugView: () => driver.getDebugView(),
  exportLog: () => driver.exportLog(),
  save: () => driver.save(),
  getFrameMetrics: () => ({ ...computeFrameMetrics(ui) }),
  pickTile: (x: number, y: number) => pickIndex({ x, y }, currentView()),
  renderMode: () => renderer.mode,
  getPresentation: () => presentation.getPresentationSnapshot(),
};

document.querySelector<HTMLAnchorElement>('#open-audit')!.addEventListener('click', event => {
  event.preventDefault();
  try {
    sessionStorage.setItem(AUDIT_SNAPSHOT_KEY, driver.save());
    const auditWindow = window.open('/audit.html', '_blank');
    if (auditWindow) auditWindow.opener = null;
    else { ui.notice = '请允许打开审计页面，或在新标签页访问 /audit.html 并导入存档。'; controls(); }
  } catch (error) { ui.notice = `无法打开审计副本：${String(error)}`; controls(); }
});

const minimap = createMinimap(document.querySelector<HTMLElement>('.stage')!, FACTIONS, world => {
  ui.deferredFocus = null;
  camera.x = canvas.clientWidth / 2 - world.x * camera.zoom;
  camera.y = canvas.clientHeight / 2 - world.y * camera.zoom;
  requestFrame();
});

const reviewedUnits = new ReviewedUnits();
let countdownRound = -1;
let turnState: TurnStep | null = null;
let goalsCollapsed = false;
let legendMarkup = '';

// ---------- Go-to waypoints & city site pins ----------
const goToOrders = new GoToOrders();
let goToToastSerial = 1_000_000;
const planCache = new Map<string, GoToPlan | null>();
let siteCache: { key: string; sites: CitySite[] } | null = null;

function cachedPlan(view: PlayerView, unitId: number, index: number): GoToPlan | null {
  const key = `${view.commandSeq}:${unitId}:${index}`;
  if (!planCache.has(key)) {
    if (planCache.size > 64) planCache.clear();
    planCache.set(key, planGoTo(view, unitId, indexToHex(index, view.map)));
  }
  return planCache.get(key)!;
}
function resetGoTo() {
  goToOrders.clear(); ui.goToMode = false; ui.goToHover = null; ui.arrivedUnitId = null;
  planCache.clear(); siteCache = null; rivalMemory.clear(); clearClientPlans();
}
function skippedUnits(view: PlayerView): ReadonlySet<number> {
  return new Set([...reviewedUnits.of(view.round), ...goToOrders.ids()]);
}
const idleWithoutOrders = (view: PlayerView) => idleUnitIds(view).filter(id => !goToOrders.has(id));
function goToRoute(view: PlayerView): SceneGoTo | null {
  if (ui.selected === null || busy()) return null;
  const order = goToOrders.get(ui.selected);
  const target = ui.goToMode ? ui.goToHover ?? ui.keyboardIndex : order ? hexToIndex(order.target, view.map) : null;
  const plan = target === null ? null : cachedPlan(view, ui.selected, target);
  return plan ? { path: plan.path.map(hex => hexToIndex(hex, view.map)!), stops: planStops(plan, view.map), preview: ui.goToMode } : null;
}
function goToEta(view: PlayerView, unitId: number): string {
  const order = goToOrders.get(unitId), plan = order ? cachedPlan(view, unitId, hexToIndex(order.target, view.map)!) : null;
  return plan ? arrivalText(view, planArrivalRound(view, unitId, plan)) : '路线待重新规划';
}
function barGoTo(view: PlayerView): UnitBarGoTo | null {
  if (ui.selected === null) return null;
  const order = goToOrders.get(ui.selected), plan = order ? cachedPlan(view, ui.selected, hexToIndex(order.target, view.map)!) : null;
  return { mode: ui.goToMode, turns: order ? plan?.total ?? 1 : null, arrived: ui.arrivedUnitId === ui.selected, ...(order ? { eta: goToEta(view, ui.selected) } : {}) };
}
function selectedSites(view: PlayerView): CitySite[] {
  const unit = ui.selected === null ? undefined : view.units.find(item => item.id === ui.selected && item.ownerId === view.playerId);
  if (!unit || !isSettler(unit) || busy() || ui.goToMode || view.outcome) return [];
  const key = `${view.commandSeq}:${unit.id}`;
  if (siteCache?.key !== key) siteCache = { key, sites: suggestCitySites(view, unit.id) };
  return siteCache.sites;
}
function updateSitePins(view: PlayerView) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderSitePins(sitePins, selectedSites(view).map(site => ({ site, point: renderer.anchor(site.position, camera, view.map, width) })), { width, height },
    index => { if (ui.selected !== null) setGoTo(ui.selected, index, true); });
}
function setGoTo(unitId: number, index: number, site = false) {
  const view = currentView();
  if (busy() || view.outcome || hasPendingPeace(view)) return;
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit) return;
  ui.goToMode = false; ui.goToHover = null;
  if (hexToIndex(unit.position, view.map) === index) {
    const cleared = goToOrders.cancel(unitId);
    ui.notice = site && isSettler(unit) ? '开拓队就在这个推荐城址上：点「建城」（B）在此建立城市。' : cleared ? '路标已清除。' : '';
    controls(); requestFrame(); return;
  }
  const plan = goToOrders.set(view, unitId, indexToHex(index, view.map));
  if (!plan) {
    presentation.tapFeedback(index, 'error', animate.checked); audio.play('error');
    ui.notice = '到不了这个格子：已知地形上没有路线（未探索的格子按草原估算）。'; controls(); requestFrame(); return;
  }
  presentation.tapFeedback(index, 'ok', animate.checked);
  if (ui.arrivedUnitId === unitId) ui.arrivedUnitId = null;
  runGoTo(new Set(), [unitId]);
  if (goToOrders.has(unitId)) ui.notice = `已设路标${site ? '（推荐城址）' : ''}：${goToEta(currentView(), unitId)}，每回合开始时自动前进。`;
  controls(); requestFrame();
}
function runGoTo(attacked: ReadonlySet<number>, only?: readonly number[]) {
  const view = currentView();
  if (view.outcome || view.activePlayerId !== view.playerId || !goToOrders.size) return;
  const { moves, stops } = goToOrders.plan(view, attacked, only);
  const moved: number[] = [];
  for (const move of moves) {
    if (session.issue({ type: 'Move', unitId: move.unitId, to: move.to }).ok) moved.push(move.unitId);
    else { const found = goToOrders.get(move.unitId)?.found ?? false; goToOrders.cancel(move.unitId); stops.push({ unitId: move.unitId, reason: 'blocked', found }); }
  }
  stops.push(...goToOrders.afterMoves(currentView(), moved));
  reportGoToStops(stops);
}
function remindArrived() {
  const view = currentView(), unit = view.units.find(item => item.id === ui.arrivedUnitId && item.ownerId === view.playerId);
  if (!unit) { ui.arrivedUnitId = null; return; }
  if (!unit.actionLeft || goToOrders.has(unit.id)) return;
  selectUnit(unit.id, false); ui.deferredFocus = unit.position;
  ui.notice = `${unitDefinition(unit, contentForView(view)).name}在路标处待命：点「建城」（B）在此建立城市。`;
}
function reportGoToStops(stops: readonly GoToStop[]) {
  if (!stops.length) return;
  const view = currentView(), CONTENT = contentForView(view);
  const texts = stops.map(stop => {
    const unit = view.units.find(item => item.id === stop.unitId);
    const text = stopText(stop, unit ? unitDefinition(unit, CONTENT).name : presentation.knownUnitLabels.get(stop.unitId)?.replace(/^(野生 |文明 \d+ 的 )/, '') ?? '单位');
    rail.push({ id: ++goToToastSerial, tone: stop.reason === 'arrived' ? 'info' : 'war', icon: stop.reason === 'arrived' ? '⚑' : '!', title: stop.reason === 'arrived' ? '到达路标' : '路标中断',
      detail: text, target: unit ? { kind: 'unit', unitId: stop.unitId } : null, persistent: false, key: `goto:${stop.unitId}` });
    return text;
  });
  const arrived = stops.find(stop => stop.reason === 'arrived' && stop.found && view.units.some(unit => unit.id === stop.unitId));
  if (arrived) {
    ui.arrivedUnitId = arrived.unitId;
    selectUnit(arrived.unitId, false);
    ui.deferredFocus = view.units.find(unit => unit.id === arrived.unitId)!.position;
  }
  ui.notice = texts.join(' ');
}

// ---------- HUD & Panel rendering ----------
function controls() {
  presentation.panelsBusy = busy();
  const view = currentView(), CONTENT = contentForView(view);
  const ended = view.outcome !== null, pendingPeace = hasPendingPeace(view);
  rivalMemory.observe(view);
  reconcileSelection(ui, view);
  presentation.noteVisibleUnits(view, CONTENT);
  const { player } = view.economy;
  const yields = view.economy.cities.reduce((sum, city) => ({ gold: sum.gold + city.yields.gold, research: sum.research + city.yields.research }), { gold: 0, research: 0 });
  const upkeep = [...view.units, ...view.recoveringUnits].filter(unit => unit.ownerId === view.playerId).reduce((sum, unit) => sum + unitDefinition(unit, CONTENT).upkeep, 0);
  const netGold = yields.gold - upkeep;
  info.textContent = `种子 ${view.seed} · 第 ${view.round} 轮 · 当前文明 ${view.activePlayerId + 1} · 命令 ${view.commandSeq}`;
  const sizeName = view.map.width === 24 ? '小地图' : view.map.width === 30 ? '标准地图' : '大地图';
  document.querySelector('#map-size-label')!.textContent = `${sizeName} · ${view.map.width} × ${view.map.height}`;
  document.querySelector('#round-display')!.innerHTML = `${view.round} <span>/ ${view.roundLimit}</span>`;
  document.querySelector('#hud-gold')!.innerHTML = `${player.gold} <span class="delta">${netGold >= 0 ? '+' : ''}${netGold}</span>`;
  document.querySelector('#hud-research')!.innerHTML = `${yields.research} <span class="delta">/ 轮</span>`;
  document.querySelector('#hud-upkeep')!.innerHTML = `−${upkeep} <span class="delta negative">金币</span>`;
  const essences = view.expansion?.essences;
  document.querySelector('#hud-essences')!.innerHTML = essences ? ESSENCE_IDS.map(id => `<span class="essence-chip" title="${ESSENCES[id].name}精华：${ESSENCES[id].types.map(type => TYPE_NAMES[type]).join('、')}系 · 来自${BIOME_DISPLAY[ESSENCES[id].biome].label} · 每轮 +${essences.perRound[id]}" style="--essence:${ESSENCES[id].color}"><b>${ESSENCES[id].mark}</b>${essences.stock[id]}<small>+${essences.perRound[id]}</small></span>`).join('') : '';
  const unit = view.units.find(item => item.id === ui.selected);
  const targets = ui.selected === null ? [] : actionTargets(view, ui.selected, ui.actionMode, ui.selectedBall);
  const placementSite = ui.districtPlacement && ui.districtPlacement.tileIndex !== null
    ? previewDistrict(view, ui.districtPlacement.cityId, ui.districtPlacement.kind, ui.districtPlacement.tileIndex) : null;
  selection.textContent = unit && ui.inspectedTile !== null ? `${unitDefinition(unit, CONTENT).name} → ${tileSummary(describeTile(view, ui.inspectedTile))} · 右侧可直接攻击或捕捉`
    : unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · ${goToOrders.has(unit.id) ? `路标${goToEta(view, unit.id)}` : unit.actionLeft ? '点击高亮格直接移动，右键远处的格子设路标' : '本回合已行动'}`
    : ui.selectedCity !== null ? `已选城市 ${ui.selectedCity} · 在城市面板建造、训练或采购`
    : ui.inspectedTile !== null ? `查看：${tileSummary(describeTile(view, ui.inspectedTile))}`
    : '点选城市管理生产，点选单位执行行动，点任意地块查看详情；拖动地图平移，滚轮缩放。';
  actionNotice.textContent = ui.notice || (pendingPeace ? '请先回应停战提议。' : ui.districtPlacement ? '设施区选址：点击格子预览，再确认入队。Esc 取消。' : ui.actionMode === 'attack' ? (targets.length ? `攻击模式：${targets.length} 个可攻击目标（红色虚线）。点目标看战斗预览，再点一次即攻击。Esc 取消。` : '攻击模式：射程内没有可攻击的目标（和平中的文明不能攻击）。Esc 取消。')
    : ui.goToMode ? '前往模式：点击任意格子设路标（虚线是路线，圆圈数字是第几回合到达）。Esc 取消。'
    : ui.actionMode === 'move' ? '移动模式：点击高亮格移动，包括己方城市。Esc 取消。'
    : ui.actionMode === 'capture' ? (targets.length ? '捕捉模式：点相邻的野生宝可梦看捕捉率，再点一次即捕捉。Esc 取消。' : `捕捉模式：${ui.selected === null ? '没有可捕捉目标。' : captureNoTargetReason(view, ui.selected, ui.selectedBall)} Esc 取消。`) : ended ? '对局已结束，可开始新局。' : '');
  actionNotice.classList.toggle('is-error', ui.notice.includes('拒绝') || ui.notice.includes('失败'));
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${driver.lastRejected ? JSON.stringify(driver.lastRejected) : '无'}${ui.notice ? '\n' + ui.notice : ''}`;
  sequence.max = String(driver.exportLog().commands.length);
  const disabled = busy() || ended || pendingPeace;
  renderSelectionPanel(view, ui.selected, ui.selectedCity, { unit: selectUnit, city: selectCity, clear: clearSelection }, busy());
  const eraPanel = document.querySelector<HTMLElement>('#era-panel')!;
  eraPanel.innerHTML = renderEraPanel(view);
  bindEraPanel(eraPanel, view, issue, disabled);
  renderLegends(view);
  renderGoals(view);
  renderPolicyPanel(view, issue, disabled);
  renderLeaderPanel(view);
  renderVictoryPanel(view);
  renderExpansionPanel(view, ui.selected, ui.selectedCity, action => issue(action), disabled);
  document.querySelector<HTMLElement>('#selection-empty')!.hidden = ui.selected !== null || ui.selectedCity !== null || ui.neutralCity !== null || ui.inspectedTile !== null;
  renderTilePanel(view, ui.inspectedTile, { onSelectUnit: id => selectUnit(id, false), selectedUnitId: ui.selected, disabled,
    onAction: action => { resetActionState(ui); issue(action); } });
  renderUnitPanel(view, ui.selected, ui.actionMode, ui.pendingTarget, ui.selectedBall, disabled, {
    mode: mode => { ui.actionMode = mode; ui.pendingTarget = null; ui.notice = ''; controls(); requestFrame(); },
    confirm: confirmAction,
    cancel: () => { ui.actionMode = null; ui.pendingTarget = null; ui.notice = ''; controls(); requestFrame(); },
    evolve: evolveSelected,
    ball: ballId => { ui.selectedBall = ballId; ui.pendingTarget = null; ui.notice = ''; controls(); requestFrame(); },
    found: () => { if (ui.selected !== null) issue({ type: 'FoundCity', unitId: ui.selected }); },
    improve: (tileIndex, kind) => { if (ui.selected !== null) issue({ type: 'ImproveTile', unitId: ui.selected, tileIndex, kind }); },
    issue,
  }, { actionsInBar: true });
  if (ui.selected !== null) {
    const head = document.querySelector<HTMLElement>('#unit-panel .unit-head'), entry = unitBattleLogButton(ui.selected);
    if (head && entry) {
      head.insertAdjacentHTML('beforeend', entry);
      head.querySelector('#unit-battle-log')?.addEventListener('click', () => { setBattleLogFilter(ui.selected); controls(); openScreen('log', '#battle-log'); });
    }
  }
  renderUnitActionBar(view, ui.districtPlacement ? null : ui.selected, ui.actionMode,
    busy() ? '动画播放中，请稍候或跳过动画。' : ended ? '对局已结束。' : pendingPeace ? '请先回应停战提议。' : null, {
      mode: mode => { ui.actionMode = mode; ui.pendingTarget = null; ui.notice = ''; controls(); requestFrame(); },
      evolve: evolveSelected,
      found: () => { if (ui.selected !== null) issue({ type: 'FoundCity', unitId: ui.selected }); },
      improve: (tileIndex, kind) => { if (ui.selected !== null) issue({ type: 'ImproveTile', unitId: ui.selected, tileIndex, kind }); },
      order: issue,
      skip: () => { if (ui.selected !== null) reviewedUnits.add(currentView().round, ui.selected); cycleIdle('unit'); },
      explain: text => { ui.notice = text; controls(); },
      goTo: () => { const choosing = !ui.goToMode; resetActionState(ui); ui.goToMode = choosing; ui.notice = ''; controls(); requestFrame(); },
      cancelGoTo: () => { if (ui.selected !== null && goToOrders.cancel(ui.selected)) { ui.notice = '路标已取消。'; if (ui.arrivedUnitId === ui.selected) ui.arrivedUnitId = null; } controls(); requestFrame(); },
      goToTile: setGoTo,
    }, barGoTo(view));
  if (placementSite) {
    document.querySelector<HTMLElement>('#unit-panel')!.innerHTML = districtPreviewMarkup(view, placementSite, disabled);
    document.querySelector<HTMLButtonElement>('#confirm-district')?.addEventListener('click', confirmDistrictPlacement);
    document.querySelector<HTMLButtonElement>('#cancel-district')?.addEventListener('click', cancelDistrictPlacement);
  }
  renderEconomyPanel(view, ui.selectedCity, issue, disabled, startDistrictPlacement);
  renderResearchPanel(view, issue, disabled);
  renderNeutralPanel(view, ui.neutralCity, issue, disabled);
  renderDiplomacyPanel(view, busy() || ended, issue);
  renderOutcome(view, newGame);
  renderLeagueResult(view, openReplay);
  renderBattleLog(view, openReplay);
  renderBallStock(view, openBallShop);
  const shown = ui.activityLog.filter(entry => !ui.activityImportantOnly || !entry.routine);
  document.querySelector('#activity-list')!.innerHTML = shown.length ? shown.map((entry, index) =>
    `${index === 0 || shown[index - 1].round !== entry.round ? `<li class="activity-round" aria-hidden="true">第 ${entry.round} 轮</li>` : ''}<li class="${entry.routine ? 'routine' : 'important'}">${entry.text}</li>`).join('')
    : `<li>${ui.activityLog.length ? '本段时间没有重要事件' : '暂无动态'}</li>`;
  if (disabled) for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#economy button, #economy input, #economy select')) element.disabled = true;
  for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#controls button, #controls input, #controls select, #dev-drawer button, #dev-drawer input, #skip')) {
    const newGameSetting = element.matches('#leader-setup input, #starter, #map-size, #round-limit, #ai-count, #ai-personality, #era-progression');
    const transition = pendingPeace && !ended && (newGameSetting || ['new-game', 'load-game', 'import-save', 'replay', 'resume'].includes(element.id));
    const storage = ['load-game', 'export-save', 'import-save'].includes(element.id);
    element.disabled = element.id === 'skip' ? !busy()
      : element.id === 'new-game' || newGameSetting || storage ? busy() || transition : busy() || ended || transition;
  }
  document.querySelector('#context-drawer')!.classList.toggle('has-selection', ui.selected !== null || ui.selectedCity !== null || ui.neutralCity !== null || ui.inspectedTile !== null || ui.districtPlacement !== null);
  const reminders = turnReminders(view, CONTENT, skippedUnits(view)).filter(item => !(item.target.startsWith('unit:') && goToOrders.has(Number(item.target.slice(5)))));
  renderTurnButton(view, reminders, ended, pendingPeace);
  if (!busy()) presentation.syncIdleCityMemory(view);
  if (!busy() && !ended && view.round !== countdownRound) { countdownRound = view.round; rail.push(leagueCountdownToast(view)); }
  rail.sync(view, busy(), { unitId: ui.selected, cityId: ui.selectedCity });
  document.querySelector('#turn-reminders')!.innerHTML = ended ? '' : reminders.map(item => `<button type="button" data-reminder="${item.target}"${item.tip ? ` title="${escapeAttr(item.tip)}"` : ''}>${item.label}</button>`).join('');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reminder]')) button.onclick = () => {
    const kind = button.dataset.reminder!;
    if (kind.startsWith('danger:')) { selectUnit(Number(kind.slice(7))); ui.notice = '附近有野生或敌方宝可梦：让宝可梦护送，或先撤回城市。'; controls(); return; }
    if (kind.startsWith('unit:')) { selectUnit(Number(kind.slice(5))); ui.notice = '开拓队：移动到离其他城市至少 4 格的陆地，下一回合点「在此建立城市」。'; controls(); return; }
    if (kind === 'city' || kind === 'unit') { cycleIdle(kind); return; }
    if (kind === 'conference') { openConference(); return; }
    const target = document.querySelector<HTMLElement>(kind);
    if (target) revealPanel(target);
  };
}

function cycleIdle(kind: 'city' | 'unit', step: 1 | -1 = 1) {
  const view = currentView();
  if (kind === 'city') {
    selectCity(cycleId(idleCityIds(view), ui.selectedCity, step));
    const economy = document.querySelector<HTMLElement>('#economy');
    if (economy) revealPanel(economy);
  } else selectUnit(cycleId(idleWithoutOrders(view), ui.selected, step));
}

function renderTurnButton(view: PlayerView, reminders: ReturnType<typeof turnReminders>, ended: boolean, pendingPeace: boolean) {
  turnState = ended ? null : turnStep(view, reminders, { unitId: ui.selected, cityId: ui.selectedCity }, skippedUnits(view), { conference: conferenceReviewed(view) });
  endTurn.disabled = busy() || ended || pendingPeace;
  endTurn.textContent = turnState?.label ?? `第 ${view.round} 轮 · 对局已结束`;
  endTurn.dataset.state = turnState?.kind ?? 'ended';
  endTurn.title = turnState && turnState.kind !== 'ready' ? '还有待办：点击前往。Shift+点击或 Ctrl/⌘+Enter 直接结束回合。' : '结束本回合（Ctrl/⌘+Enter）';
  turnHint.hidden = !turnState || turnState.kind === 'ready' || endTurn.disabled;
  const idle = idleWithoutOrders(view).length;
  for (const button of unitCycle) button.disabled = busy() || ended || pendingPeace || idle === 0;
}

function onEndTurn(force: boolean) {
  if (busy() || !turnState) return;
  const step = turnState;
  if (force || step.kind === 'ready') { issue({ type: 'EndTurn' }); return; }
  audio.play('click');
  if (step.kind === 'conference') { openConference(); return; }
  if (step.kind === 'city') {
    selectCity(step.cityId);
    const economy = document.querySelector<HTMLElement>('#economy');
    if (economy) revealPanel(economy);
    return;
  }
  if (step.kind !== 'unit') { const panel = document.querySelector<HTMLElement>(step.panel); if (panel) revealPanel(panel); return; }
  const view = currentView();
  reviewedUnits.add(view.round, step.unitId);
  selectUnit(step.unitId);
  ui.notice = step.remaining > 1 ? `待命单位（还有 ${step.remaining - 1} 个）：下达命令，或再点一次按钮看下一个。` : '最后一个待命单位：下达命令，或再点一次按钮进入下一回合。';
  controls();
}

function openConference() {
  const view = currentView();
  markConferenceReviewed(view);
  closeScreen(); openLineupPicker(view, { kind: 'championship', key: '' }, issue);
  ui.notice = '联盟大会报名：选六只宝可梦和出场顺序。不想报名就 Shift+点击结束回合。'; controls();
}
function startQueuedResearch() {
  const started = runResearchQueue(currentView(), action => session.issue(action));
  if (started) rail.push({ id: ++goToToastSerial, tone: 'research', icon: '⚗', title: `研究队列：开始研究「${techOf(contentForView(currentView()), started).name}」`,
    detail: researchQueue.list().length ? `队列里还有 ${researchQueue.list().length} 项。` : '队列已空。', target: { kind: 'screen', screen: 'research' }, persistent: false, key: 'research-queue' });
  return started;
}
function openBallShop() {
  const view = currentView(), city = view.economy.cities.find(item => item.id === view.economy.player.headquartersCityId) ?? view.economy.cities[0];
  if (!city) return;
  closeScreen(); selectCity(city.id);
  const economy = document.querySelector<HTMLElement>('#economy');
  if (economy) revealPanel(economy);
  document.querySelector<HTMLButtonElement>('#economy [data-city-section="supplies"]')?.click();
}

function issue(action: Command['action'], successNotice?: string) {
  const view = currentView();
  if (busy() || view.outcome) return;
  if (action.type !== 'RespondPeace' && hasPendingPeace(view)) { ui.notice = '请先接受或拒绝停战提议。'; controls(); return; }
  rememberChallenge(view, action);
  const result = session.issue(action);
  if (!result.ok && isPreviewedChallenge(action)) challengeCardResult(view, null);
  if (!result.ok) {
    const reason = result.reason === 'diplomacy-unavailable' ? '当前关系或冷却时机不允许该外交操作'
      : result.reason === 'game-ended' ? '对局已结束'
      : result.reason === 'invalid-city-site' ? '此处不能建城：需要陆地，且距所有城市至少 4 格'
      : result.reason === 'no-action' ? '本回合已行动，请结束回合后再试' : result.reason;
    const target = action.type === 'Capture' ? view.units.find(unit => unit.id === action.targetUnitId) : undefined;
    const captureReason = action.type === 'Capture' ? (target ? captureTargetReason(view, action.unitId, hexToIndex(target.position, view.map)!, action.ballId) : '目标已不在视野内。') : null;
    ui.notice = captureReason ? `无法捕捉：${captureReason}` : `${action.type} 被拒绝：${reason}`;
    audio.play('error');
  } else {
    ui.notice = successNotice ?? '';
    if ('unitId' in action && action.type !== 'PromoteUnit' && goToOrders.cancel(action.unitId) && ui.arrivedUnitId === action.unitId) ui.arrivedUnitId = null;
    if (action.type === 'EndTurn') {
      audio.play('endTurn');
      const attacked = new Set(session.presentationQueue.flatMap(event => event.payload.type === 'BattleResolved' && event.payload.target.kind === 'unit' ? [event.payload.target.id] : []));
      runGoTo(attacked);
      remindArrived();
      startQueuedResearch();
    }
    applyCommandStateEffects(ui, action, currentView());
    if (action.type === 'FoundCity') ui.notice = `城市 ${ui.selectedCity} 已建立。现在可以建造建筑或训练新的单位。`;
    advanceToNextUnit(action);
  }
  controls(); requestFrame();
}

function advanceToNextUnit(action: Command['action']) {
  const view = currentView();
  if (!usesMovementPoints(view) || ui.selected === null || !('unitId' in action) || action.unitId !== ui.selected || action.type === 'PromoteUnit') return;
  const current = view.units.find(unit => unit.id === ui.selected);
  if (current?.actionLeft) return;
  const origin = current?.position;
  const next = view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft && unit.id !== ui.selected && !goToOrders.has(unit.id))
    .sort((a, b) => (origin ? hexDistance(origin, a.position, view.map) - hexDistance(origin, b.position, view.map) : 0) || a.id - b.id)[0];
  if (!next) return;
  selectUnit(next.id, false);
  ui.deferredFocus = next.position;
  ui.notice = `下一个待命单位：${next.kind === 'pokemon' ? contentForView(view).species[next.speciesId].name : '开拓队'}（还有 ${view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).length} 个单位待命）`;
}

function updateCombatCard(view: PlayerView) {
  const card = ui.actionMode === 'attack' && ui.pendingTarget && ui.selected !== null ? combatCard(view, ui.selected, ui.pendingTarget) : null;
  const anchor = card && ui.pendingTarget ? renderer.anchor(indexToHex(ui.pendingTarget.index, view.map), camera, view.map, canvas.clientWidth) : null;
  renderCombatCard(card, anchor, HEX_RADIUS * camera.zoom, busy() || view.outcome !== null || hasPendingPeace(view), {
    confirm: confirmAction,
    cancel: cancelTarget,
  });
}

function escapeAction() {
  if (ui.pendingTarget) cancelTarget();
  else if (ui.actionMode !== null || ui.districtPlacement || ui.goToMode) { resetActionState(ui); ui.notice = ''; controls(); requestFrame(); }
  else clearSelection();
}
function cancelTarget() {
  ui.pendingTarget = null; ui.notice = ''; canvas.focus(); controls(); requestFrame();
}
function confirmAction() {
  const action = buildConfirmTargetAction(ui);
  if (action) issue(action);
}
function confirmDistrictPlacement() {
  const result = buildDistrictOrderAction(currentView(), ui.districtPlacement);
  if (!result) return;
  if (!result.ok) {
    if (result.dropPlacement) { cancelDistrictPlacement(); return; }
    ui.notice = result.reason; controls(); return;
  }
  issue(result.action, `设施区已加入城市 ${result.cityId} 队列；格子已预订。`);
}

function requestedGameplayVersion(): GameplayVersion {
  const value = Number(new URLSearchParams(location.search).get('gameplay'));
  return isGameplayVersion(value) && value >= 1 ? value : LATEST_GAMEPLAY_VERSION;
}

document.querySelector<HTMLElement>('#opening-goals')?.addEventListener('click', event => {
  if (!(event.target as HTMLElement).closest('.goals-toggle')) return;
  goalsCollapsed = !goalsCollapsed; renderGoals(currentView());
});
function renderGoals(view: PlayerView) {
  const root = document.querySelector<HTMLElement>('#opening-goals')!, opening = view.expansion?.opening;
  const left = opening ? OBJECTIVE_IDS.filter(id => !opening.objectives.includes(id)) : [];
  root.hidden = !opening || !left.length;
  if (!opening) return;
  const reward = (id: ObjectiveId) => { const r = OBJECTIVES[id].reward; return [r.gold ? `金 +${r.gold}` : '', r.research ? `研 +${r.research}` : '', r.pokeBalls ? `球 +${r.pokeBalls}` : ''].filter(Boolean).join(' '); };
  const markup = `<button type="button" class="section-label goals-toggle" aria-expanded="${!goalsCollapsed}" title="${goalsCollapsed ? '展开' : '收起'}开局目标">开局目标 ${opening.objectives.length}/${OBJECTIVE_IDS.length} <span aria-hidden="true">${goalsCollapsed ? '▸' : '▾'}</span></button>${goalsCollapsed ? '' : `<ul>${left.slice(0, 3).map(id => `<li><b>${OBJECTIVES[id].name}</b><small>${OBJECTIVES[id].hint}</small><span>${reward(id)}</span></li>`).join('')}</ul>`}`;
  if (root.innerHTML !== markup) root.innerHTML = markup;
}
function renderLegends(view: PlayerView) {
  document.querySelector<HTMLElement>('#legends-launcher')!.hidden = !view.expansion?.legends;
  const markup = legendScreenMarkup(view), root = document.querySelector<HTMLElement>('#legend-panel')!;
  if (markup !== legendMarkup) {
    const open = new Set([...root.querySelectorAll<HTMLElement>('details[open]')].map(item => item.closest<HTMLElement>('[data-legend]')?.dataset.legend));
    legendMarkup = markup; root.innerHTML = markup;
    for (const id of open) root.querySelector(`[data-legend="${id}"] details`)?.setAttribute('open', '');
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-legend-site]')) button.addEventListener('click', () => {
      const index = Number(button.dataset.legendSite);
      closeScreen(); focusHex(indexToHex(index, currentView().map)); ui.inspectedTile = index; ui.selected = null; ui.selectedCity = null; controls(); requestFrame();
    });
  }
  const arrival = document.querySelector<HTMLElement>('#legend-arrival-root')!;
  if (legendArrivals.length && !arrival.childElementCount) {
    arrival.innerHTML = legendCompletionMarkup(legendArrivals[0]);
    arrival.querySelector('#legend-arrival-close')!.addEventListener('click', () => {
      legendArrivals.shift(); arrival.innerHTML = '';
      if (!legendArrivals.length) presentation.restoreRevealCamera();
      controls();
    });
  }
}
function evolveSelected(intoSpeciesId?: SpeciesId) {
  const action = buildEvolveAction(currentView(), ui.selected, intoSpeciesId);
  if (action) issue(action);
}

// ---------- Frame loop ----------
onMapArtChange(() => requestFrame());
function frame(now: number) {
  frameRequested = false;
  const { animation, queueLength } = presentation.advanceAndSample(now, animate.checked);
  const view = currentView();
  if (ui.deferredFocus && !busy()) focusHex(ui.deferredFocus);
  const paths = ui.selected === null ? {} : reachablePaths(view, ui.selected);
  const targets = ui.selected === null ? [] : actionTargets(view, ui.selected, ui.actionMode, ui.selectedBall).map(target => hexToIndex(target.position, view.map)!);
  const drawStarted = performance.now();
  presentation.lastRenderStats = renderer.render({
    view: import.meta.env.DEV && god.checked ? developerAdapter.getDebugView() : view, camera, animation,
    selected: ui.selected, selectedCity: ui.selectedCity, reachable: Object.keys(paths).map(Number), cursorIndex: ui.keyboardIndex,
    actionMode: ui.actionMode, actionTargets: targets, pendingTargetIndex: ui.pendingTarget?.index, inspectedTile: ui.inspectedTile,
    debugOverlay: import.meta.env.DEV ? document.querySelector<HTMLSelectElement>('#debug-overlay')!.value as DebugOverlay : 'none',
    districtPlacement: ui.districtPlacement ? { sites: districtSites(view, ui.districtPlacement.cityId, ui.districtPlacement.kind), selectedTileIndex: ui.districtPlacement.tileIndex } : undefined,
    goTo: goToRoute(view),
    layers: { yields: showYields.checked },
  });
  updateCombatCard(view);
  updateSitePins(view);
  minimap.update(renderer.mode === '25d' ? view : null, camera, { width: canvas.clientWidth, height: canvas.clientHeight });
  recordFrameDuration(ui, performance.now() - drawStarted);
  if (import.meta.env.DEV) {
    const metrics = computeFrameMetrics(ui);
    frameMetricsElement.textContent = `帧绘制耗时（最近 ${metrics.samples} 帧）：${metrics.last.toFixed(2)} ms\n均值 ${metrics.mean.toFixed(2)} ms · p95 ${metrics.p95.toFixed(2)} ms · 最大 ${metrics.max.toFixed(2)} ms`;
  }
  presentation.afterFrame(queueLength);
}

function openReplay(replay: BattleReplay) {
  openBattleViewer(replay, { reducedMotion: presentation.reducedMotion(), play: id => audio.play(id), onClose: () => canvas.focus({ preventScroll: true }) });
}
function watchReplay(key: string) {
  const replay = storedReplay(key);
  if (replay) openReplay(replay);
  else { ui.notice = '这场对战的回放已不可用（读档或刷新后只保留联盟大会的回放）。'; controls(); }
}
function skip() { presentation.finishPresentations(); controls(); requestFrame(); }
function fit() { Object.assign(camera, fitCamera(currentView().map, canvas.clientWidth, canvas.clientHeight)); requestFrame(); }
function startDistrictPlacement(cityId: number, kind: DistrictId) {
  ui.selected = null; ui.selectedCity = cityId; ui.neutralCity = null; resetActionState(ui);
  ui.districtPlacement = { cityId, kind, tileIndex: null }; ui.notice = '';
  closeScreen(); canvas.focus(); controls(); requestFrame();
}
function cancelDistrictPlacement() { ui.districtPlacement = null; ui.notice = ''; controls(); requestFrame(); }
function clearSelection() { clearSelectionState(ui); controls(); requestFrame(); }
function focusHex(position: { q: number; r: number }) {
  ui.deferredFocus = null;
  ui.keyboardIndex = hexToIndex(position, currentView().map);
  focusCameraOnHex(camera, canvas, hex => renderer.lift(hex), position);
}
function locateTile(index: number) {
  const view = currentView(), position = indexToHex(index, view.map);
  closeScreen();
  ui.deferredFocus = null;
  ui.keyboardIndex = index;
  focusCameraOnHex(camera, canvas, hex => renderer.lift(hex), position, view.map, { wrapNearest: true });
  ui.selected = null; ui.selectedCity = null; ui.neutralCity = null; resetActionState(ui); ui.notice = '';
  ui.inspectedTile = index;
  presentation.timeline.add(locateTrack(position), performance.now());
  controls(); requestFrame();
}
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-locate-tile], [data-locate-unit]') : null;
  if (!button || button.disabled || !session) return;
  if (button.dataset.locateTile !== undefined) locateTile(Number(button.dataset.locateTile));
  else { closeScreen(); selectUnit(Number(button.dataset.locateUnit)); }
});
document.addEventListener('click', event => {
  const order = session ? goToButtonOrder(event) : null;
  if (!order) return;
  closeScreen(); selectUnit(order.unitId); setGoTo(order.unitId, order.tileIndex);
});
function selectUnit(id: number | null, focus = true) {
  const unit = currentView().units.find(item => item.id === id && item.ownerId === currentView().playerId);
  ui.selected = unit?.id ?? null; ui.selectedCity = null; ui.neutralCity = null; ui.inspectedTile = null;
  resetActionState(ui); ui.notice = '';
  if (unit) audio.play('select');
  if (unit && focus) focusHex(unit.position);
  controls(); requestFrame();
}
function selectCity(id: number | null, focus = true) {
  const city = currentView().economy.cities.find(item => item.id === id);
  ui.selectedCity = city?.id ?? null; ui.selected = null; ui.neutralCity = null; ui.inspectedTile = null;
  resetActionState(ui); ui.notice = '';
  if (city && focus) focusHex(city.position);
  controls(); requestFrame();
}
function transitionBlocked() {
  const view = currentView();
  if (view.outcome || !hasPendingPeace(view)) return false;
  ui.notice = '请先接受或拒绝停战提议，再切换对局。'; controls(); return true;
}

// ---------- Game lifecycle (new game, load, replay) ----------
function pendingSetup(): GameSetup {
  const aiCount = Number(document.querySelector<HTMLSelectElement>('#ai-count')!.value);
  const personality = document.querySelector<HTMLSelectElement>('#ai-personality')!.value as AiPersonality;
  const humanLeaderId = selectedLeaderId();
  const seed = Number(new URLSearchParams(location.search).get('seed') ?? '12345');
  const aiLeaderIds = LEADER_IDS.filter(id => id !== humanLeaderId)
    .map((id, index) => ({ id, key: (Math.imul(seed + 1, 2654435761) ^ Math.imul(index + 7, 40503)) >>> 0 }))
    .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id)).map(item => item.id);
  const players: GameSetup['players'] = [{ id: 0, controller: 'human', starterId: starter.value as StarterId, leaderId: humanLeaderId },
    ...Array.from({ length: aiCount }, (_, index) => ({ id: index + 1, controller: 'ai' as const, personality, leaderId: aiLeaderIds[index] }))];
  const mapSizes = { '24x16': { width: 24, height: 16 }, '30x20': { width: 30, height: 20 }, '40x26': { width: 40, height: 26 }, '56x36': { width: 56, height: 36 } } as const;
  const sizeOption = document.querySelector<HTMLSelectElement>('#map-size')!.value as keyof typeof mapSizes;
  const pinned = new URLSearchParams(location.search).get('size') as keyof typeof mapSizes | null;
  const size = (pinned && mapSizes[pinned]) || mapSizes[sizeOption] || mapSizes['40x26'];
  const eraProgression = document.querySelector<HTMLSelectElement>('#era-progression')!.value as EraProgression;
  return { expansionVersion: 1, eraProgression, gameplayVersion: requestedGameplayVersion(), seed, ...size,
    roundLimit: Number(document.querySelector<HTMLSelectElement>('#round-limit')!.value) as GameSetup['roundLimit'], players };
}
function renderDexSummary() {
  const root = document.querySelector<HTMLElement>('#regional-dex-summary');
  if (!root) return;
  const setup = pendingSetup();
  root.hidden = (setup.gameplayVersion ?? 0) < 25 || !setup.eraProgression;
  if (root.hidden) { root.innerHTML = ''; return; }
  root.innerHTML = dexSummaryMarkup(regionalDexDraw({ ...setup, eraProgression: setup.eraProgression! }), GAME_CONTENT);
}
function newGame() {
  if (session && transitionBlocked()) return;
  try {
    driver = new GameSession(pendingSetup());
    session = driver.asPlayerSession();
    clearSelectionState(ui);
    ui.selectedCity = currentView().economy.player.headquartersCityId;
    ui.deferredFocus = null; ui.frameDurations.length = 0;
    rail.clear(); countdownRound = -1; reviewedUnits.clear();
    presentation.reset(true); resetGoTo();
    sequence.value = '0';
    canvas.hidden = false;
    fit();
    selectCity(ui.selectedCity);
    ui.keyboardIndex = null;
    info.hidden = !devMode;
    closeScreen();
  } catch (error) {
    canvas.hidden = true;
    info.hidden = false;
    info.textContent = `无法生成地图：${error instanceof Error ? error.message : String(error)}`;
    for (const element of document.querySelectorAll<HTMLButtonElement>('#controls button, #end-turn')) element.disabled = true;
  }
}

function activateIndex(index: number | null, confirmSelection = false) {
  if (busy()) return;
  const view = currentView();
  ui.keyboardIndex = index;
  if (index === null) { clearSelection(); return; }
  if (ui.districtPlacement) {
    if (confirmSelection && ui.districtPlacement.tileIndex === index) confirmDistrictPlacement();
    else {
      ui.districtPlacement.tileIndex = index; ui.notice = ''; controls();
      revealPanel(document.querySelector<HTMLElement>('#unit-panel')!); requestFrame();
    }
    return;
  }
  if (ui.goToMode && ui.selected !== null) { setGoTo(ui.selected, index); return; }
  const construction = constructionNotice(view, index);
  if (construction && ui.actionMode) { presentation.tapFeedback(index, 'error', animate.checked); ui.notice = construction; controls(); requestFrame(); return; }
  if (ui.actionMode === 'move' && ui.selected !== null) {
    if (reachablePaths(view, ui.selected)[index]) { presentation.tapFeedback(index, 'ok', animate.checked); issue({ type: 'Move', unitId: ui.selected, to: indexToHex(index, view.map) }); }
    else { presentation.tapFeedback(index, 'error', animate.checked); ui.notice = '此处无法移动，请选择高亮格，或取消移动以选择其他对象。'; controls(); }
    requestFrame(); return;
  }
  if (ui.actionMode && ui.selected !== null) {
    const target = actionTargets(view, ui.selected, ui.actionMode, ui.selectedBall).find(candidate => hexToIndex(candidate.position, view.map) === index);
    if (target && (ui.actionMode === 'attack' || ui.actionMode === 'capture') && ui.pendingTarget?.index === index && ui.pendingTarget.kind === target.kind && ui.pendingTarget.id === target.id) {
      presentation.tapFeedback(index, 'ok', animate.checked); confirmAction(); requestFrame(); return;
    }
    if (target) { ui.pendingTarget = { kind: target.kind, id: target.id, index }; presentation.tapFeedback(index, 'ok', animate.checked); }
    else {
      ui.pendingTarget = null; presentation.tapFeedback(index, 'error', animate.checked);
      const why = ui.actionMode === 'capture' ? captureTargetReason(view, ui.selected, index, ui.selectedBall) : ui.actionMode === 'attack' ? attackTargetReason(view, ui.selected, index) : null;
      ui.notice = why ? `${ui.actionMode === 'capture' ? '无法捕捉' : '无法攻击'}：${why}` : '该目标不适用；请选择高亮目标。';
    }
    controls(); requestFrame();
    if (target && ui.actionMode === 'capture') document.querySelector('#capture-preview')?.closest('.combat-preview')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  presentation.tapFeedback(index, 'ok', animate.checked);
  const hex = indexToHex(index, view.map);
  const city = view.cities.find(item => hexToIndex(item.position, view.map) === index);
  const keepUnit = ui.selected !== null && (view.units.some(unit => unit.ownerId !== view.playerId && hexToIndex(unit.position, view.map) === index)
    || (city !== undefined && city.ownerId !== view.playerId));
  if (city?.ownerId === null) {
    ui.neutralCity = city; ui.selected = keepUnit ? ui.selected : null; ui.selectedCity = null; ui.inspectedTile = index; resetActionState(ui); ui.notice = '';
    controls(); requestFrame(); return;
  }
  ui.neutralCity = null;
  const owns = view.units.filter(unit => unit.ownerId === view.playerId && hexToIndex(unit.position, view.map) === index);
  const own = owns.find(unit => unit.id !== ui.selected) ?? owns[0];
  const ownCity = city?.ownerId === view.playerId ? city : null;
  if (!construction && ui.selected !== null && owns.length && !owns.some(unit => unit.id === ui.selected) && reachablePaths(view, ui.selected)[index]) {
    ui.inspectedTile = null; issue({ type: 'Move', unitId: ui.selected, to: hex }); controls(); requestFrame(); return;
  }
  if (!construction && ownCity && (!own || ui.selectedCity !== ownCity.id)) { selectCity(ownCity.id, false); return; }
  if (!construction && own) { selectUnit(own.id, false); return; }
  if (!construction && ui.selected !== null && reachablePaths(view, ui.selected)[index]) { ui.inspectedTile = null; issue({ type: 'Move', unitId: ui.selected, to: hex }); }
  else {
    if (!keepUnit) ui.selected = null;
    ui.selectedCity = null; resetActionState(ui); ui.inspectedTile = index; ui.notice = construction ?? '';
  }
  controls(); requestFrame();
}

// ---------- Map pointer, tooltip, keyboard, and global hotkeys ----------
const tooltip = createMapTooltip({
  canvas, tooltip: document.querySelector<HTMLElement>('#map-tooltip')!,
  getView: () => session ? currentView() : null,
  getSelected: () => ui.selected,
  isGoToMode: () => ui.goToMode,
  goToSuffix: (view, unitId, index) => {
    const route = cachedPlan(view, unitId, index);
    return route ? ` · 前往：约${arrivalText(view, planArrivalRound(view, unitId, route))}` : ' · 无法前往';
  },
});

installMapPointerControls({
  canvas, camera,
  getView: () => session ? currentView() : null,
  pickIndex,
  isBusy: busy,
  onDragStart: () => { ui.deferredFocus = null; },
  onPan: () => { ui.deferredFocus = null; requestFrame(); },
  onZoom: () => { ui.deferredFocus = null; requestFrame(); },
  onClick: index => { tooltip.resetKey(); activateIndex(index); },
  onLeave: () => tooltip.hide(),
  onHover: (event, point, index, dragging) => {
    tooltip.update(event, point, index, dragging);
    if (!dragging && ui.goToMode && index !== ui.goToHover) { ui.goToHover = index; requestFrame(); }
    if (!dragging && ui.districtPlacement && index !== null && index !== ui.districtPlacement.tileIndex) {
      ui.districtPlacement.tileIndex = index; controls(); requestFrame();
    }
  },
  onContextMenu: (_event, _point, index) => {
    if (ui.selected === null || index === null) return;
    const view = currentView();
    if (reachablePaths(view, ui.selected)[index]) issue({ type: 'Move', unitId: ui.selected, to: indexToHex(index, view.map) });
    else if (view.units.some(unit => unit.id === ui.selected && unit.ownerId === view.playerId)) setGoTo(ui.selected, index);
  },
});

installMapKeyboardControls({
  canvas, camera,
  getView: currentView,
  isBusy: busy,
  getSelected: () => ui.selected,
  getCursor: () => ui.keyboardIndex,
  onCursorChange: next => {
    ui.keyboardIndex = next;
    if (ui.districtPlacement) ui.districtPlacement.tileIndex = next;
    ui.goToHover = null;
    controls(); requestFrame();
  },
  onActivate: activateIndex,
  onEscape: escapeAction,
  onFit: fit,
  onFrame: requestFrame,
});

installGlobalHotkeys({
  canvas, showYields,
  getView: currentView,
  isBusy: busy,
  hasIdleUnits: view => idleWithoutOrders(view).length > 0,
  onEscape: escapeAction,
  onEndTurn,
  onCycleUnit: step => cycleIdle('unit', step),
  onSelectCity: id => selectCity(id),
  onOpenResearch: () => openScreen('research', '#research-topic'),
  onOpenHelp: () => {
    const help = document.querySelector<HTMLDetailsElement>('#keyboard-help')!;
    openScreen('menu'); help.open = true; help.querySelector('summary')!.focus();
  },
  onFrame: requestFrame,
});

// ---------- Controls, persistence, settings, and bootstrap ----------
endTurn.addEventListener('click', event => onEndTurn(event.shiftKey));
for (const button of unitCycle) button.addEventListener('click', () => cycleIdle('unit', button.dataset.cycleUnit === 'prev' ? -1 : 1));
document.querySelector('#skip')!.addEventListener('click', skip);
document.querySelector('#debug-overlay')!.addEventListener('change', requestFrame);
document.querySelector('#new-game')!.addEventListener('click', newGame);
for (const type of ['change', 'click'] as const) document.querySelector('#controls')!.addEventListener(type, event => {
  if ((event.target as HTMLElement).closest('#regional-dex-summary')) return;
  renderDexSummary();
});
renderDexSummary();
document.querySelector('#fit')!.addEventListener('click', fit);
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(driver.exportLog(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `pokemon-${currentView().seed}-commands.json`;
  link.click(); URL.revokeObjectURL(url);
});
document.querySelector('#replay')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  try {
    driver.replayTo(Number(sequence.value));
    clearSelectionState(ui); ui.deferredFocus = null;
    presentation.clearMemories(); presentation.reset(false); resetGoTo();
    skip();
  } catch (error) { ui.notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  driver.resumeFromReplay(); resetGoTo(); clearSelectionState(ui); ui.deferredFocus = null;
  presentation.clearMemories(); controls(); requestFrame();
});

const saveKey = 'pokemon-civilization-save';
function load(text: string) {
  if (transitionBlocked()) return;
  driver.load(text); closeScreen();
  clearSelectionState(ui);
  ui.selectedCity = currentView().economy.cities[0]?.id ?? null;
  ui.deferredFocus = null; ui.frameDurations.length = 0; ui.notice = '读档完成';
  rail.clear(); countdownRound = -1; reviewedUnits.clear();
  presentation.reset(true); resetGoTo();
  fit();
  const focusCity = currentView().economy.cities.find(city => city.id === ui.selectedCity);
  if (focusCity) { focusHex(focusCity.position); ui.keyboardIndex = null; }
  skip();
}
function storageAction(action: () => void) {
  try { action(); } catch (error) { ui.notice = error instanceof Error ? error.message : String(error); }
  controls();
}
document.querySelector('#save-game')!.addEventListener('click', () => storageAction(() => {
  localStorage.setItem(saveKey, driver.save()); ui.notice = '已保存到此浏览器'; closeScreen();
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
  catch (error) { ui.notice = String(error); controls(); }
  input.value = '';
});

god.addEventListener('change', skip);
showYields.addEventListener('change', requestFrame);
if (!import.meta.env.DEV) {
  document.querySelector<HTMLElement>('#god-label')!.hidden = true;
  frameMetricsElement.hidden = true;
}
new ResizeObserver(() => { if (session) requestFrame(); }).observe(canvas);
installScreens();
installUnitActionBar();
installTrainerCards(() => session ? currentView() : null);

// Audio, projection, and painted theme settings.
document.querySelector<HTMLElement>('#audio-settings-root')!.innerHTML = audioSettingsMarkup();
{
  const root = document.querySelector<HTMLElement>('#audio-settings-root')!;
  root.insertAdjacentHTML('afterend', `<fieldset class="audio-settings render-settings" id="render-settings"><legend>地图视角</legend>
    <label class="audio-mute"><input type="radio" name="render-mode" value="25d"${initialRenderMode === '25d' ? ' checked' : ''} />2.5D 立体</label>
    <label class="audio-mute"><input type="radio" name="render-mode" value="flat"${initialRenderMode === 'flat' ? ' checked' : ''} />平面</label></fieldset>`);
  document.querySelector('#render-settings')!.addEventListener('change', event => {
    const mode = (event.target as HTMLInputElement).value === '25d' ? '25d' : 'flat';
    try { localStorage.setItem(RENDER_MODE_KEY, mode); } catch { /* private mode */ }
    renderer.setMode(mode);
    if (session) fit();
  });
}
{
  const renderSettings = document.querySelector<HTMLFieldSetElement>('#render-settings')!;
  renderSettings.insertAdjacentHTML('beforebegin', `<fieldset class="audio-settings theme-settings" id="theme-settings"><legend>画风</legend>
    <label class="audio-mute"><input type="radio" name="theme" value="painted"${theme === 'painted' ? ' checked' : ''} />绘卷（插画）</label>
    <label class="audio-mute"><input type="radio" name="theme" value="pixel"${theme === 'pixel' ? ' checked' : ''} />像素</label></fieldset>`);
  renderSettings.disabled = theme === 'painted';
  document.querySelector('#theme-settings')!.addEventListener('change', event => {
    theme = (event.target as HTMLInputElement).value === 'painted' ? 'painted' : 'pixel';
    saveTheme(theme); applyTheme(theme);
    renderSettings.disabled = theme === 'painted';
    const pixelMode = requestedRenderMode(location.search.replace(/[?&]theme=[^&]*/, ''), (() => { try { return localStorage.getItem(RENDER_MODE_KEY); } catch { return null; } })());
    for (const input of renderSettings.querySelectorAll<HTMLInputElement>('input')) input.checked = theme === 'pixel' && input.value === pixelMode;
    renderer.setMode(theme === 'painted' ? 'painted' : pixelMode);
    if (session) { fit(); controls(); }
  });
}
bindAudioSettings(document.querySelector<HTMLElement>('#audio-settings-root')!);
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => { audio.unlock(); presentation.syncMusic(); }, { passive: true });
document.addEventListener('click', event => { const button = (event.target as HTMLElement).closest('button'); if (button && button !== endTurn) audio.play('click'); }, true);
onScreenChange(screen => { rail.screenOpened(screen); presentation.syncMusic(); if (screen === null && session) requestFrame(); });
document.querySelector<HTMLInputElement>('#activity-important')!.addEventListener('change', event => { ui.activityImportantOnly = (event.target as HTMLInputElement).checked; controls(); });

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
