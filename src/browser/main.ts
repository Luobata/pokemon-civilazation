import { OBJECTIVES, OBJECTIVE_IDS } from '../content/opening.ts';
import type { ObjectiveId } from '../content/opening.ts';
import { discoveryText } from '../content/discoveries.ts';
import { isGameplayVersion } from '../content/eras.ts';
import type { GameplayVersion } from '../content/eras.ts';
import { audio, audioSettingsMarkup, bindAudioSettings } from './audio/index.ts';
import type { SoundId } from './audio/index.ts';
import { usesMovementPoints } from '../core/movement.ts';
import { toastFor } from './notifications.ts';
import { createNotificationRail } from './notification-rail.ts';
import { ReviewedUnits, cycleId, idleCityIds, idleUnitIds, turnReminders, turnStep } from './turn-button.ts';
import type { TurnStep } from './turn-button.ts';
import { legendCompletionMarkup, legendScreenMarkup, legendTitle } from './legend-panel.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { SpeciesId } from '../content/species.ts';
import { PROMOTION_TRAITS } from '../content/promotions.ts';
import { LEGENDS } from '../content/faith-legends.ts';
import { RARE_BERRIES } from '../content/rare-berries.ts';
import { ERA_ABILITIES, WEATHERS } from '../content/era-abilities.ts';
import { ESSENCE_IDS, ESSENCES } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { CHARTERS, POLICIES, GOVERNMENTS } from '../content/policies.ts';
import { IMPROVEMENTS } from '../content/improvements.ts';
import { renderEraPanel } from './era-panel.ts';
import { renderPolicyPanel } from './policy-panel.ts';
import type { EraProgression } from '../content/eras.ts';
import { LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import { renderExpansionPanel } from './expansion-panel.ts';
import { renderEconomyPanel } from './economy-panel.ts';
import { AUDIT_SNAPSHOT_KEY } from '../audit/sandbox.ts';
import { renderUnitPanel } from './unit-panel.ts';
import { installUnitActionBar, renderUnitActionBar } from './unit-action-bar.ts';
import { renderSelectionPanel } from './selection-panel.ts';
import { renderResearchPanel } from './research-panel.ts';
import { renderLeaderPanel, renderLeaderSetup, selectedLeaderId } from './leader-panel.ts';
import { loadPokemonSprites } from './sprites.ts';
import { closeScreen, installScreens, onScreenChange, openScreen, revealPanel } from './screens.ts';
import { renderDiplomacyPanel, hasPendingPeace } from './diplomacy-panel.ts';
import { renderOutcome } from './outcome-panel.ts';
import { renderNeutralPanel } from './neutral-panel.ts';
import type { ActionMode, PendingTarget } from './unit-panel.ts';
import type { AiPersonality, CitySummary, Command, GameSetup } from '../core/model.ts';
import { GameSession } from '../app/session.ts';
import type { PlayerSession } from '../app/session.ts';
import { EXPANSION_CONTENT, unitDefinition, contentForView } from '../content/units.ts';
import type { StarterId } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import { LEADER_IDS } from '../content/leaders.ts';
import { speciesDisplay } from '../content/species.ts';
import { renderVictoryPanel } from './victory-panel.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import { actionTargets } from './action-targets.ts';
import { districtSites, previewDistrict } from '../core/districts.ts';
import { constructionNotice, districtPreviewMarkup } from './district-panel.ts';
import type { DistrictId } from '../content/districts.ts';
import { reachablePaths } from '../core/movement.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { BIOME_DISPLAY, FACTION_LEGEND } from './canvas.ts';
import { createMapRenderer, Timeline } from './render/index.ts';
import type { DebugOverlay, Track } from './render/index.ts';
import { battleTrack, captureTrack, evolveTrack, moveTrack, tapTrack } from './render/animation.ts';
import { describeTile, tileSummary } from './tile-info.ts';
import { renderTilePanel } from './tile-panel.ts';
import { ERA_AGES } from '../content/era-honors.ts';
import { previewSummary, targetPreviews } from './target-preview.ts';
import { HEX_RADIUS, fitCamera, hexToWorld, toScreen, toWorld, worldToHex, zoomAt } from './camera.ts';
import { combatCard, renderCombatCard } from './combat-preview.ts';
import type { Camera, Point } from './camera.ts';

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
/** `?dev=1` shows the debug line (seed, command number) and the developer drawer (replay, god view, audit). */
const devMode = new URLSearchParams(location.search).get('dev') === '1';
info.hidden = !devMode;
document.querySelector<HTMLElement>('#dev-drawer')!.hidden = !devMode;
document.querySelector<HTMLAnchorElement>('#open-audit')!.addEventListener('click', event => {
  event.preventDefault();
  try {
    sessionStorage.setItem(AUDIT_SNAPSHOT_KEY, driver.save());
    const auditWindow = window.open('/audit.html', '_blank');
    if (auditWindow) auditWindow.opener = null;
    else { notice = '请允许打开审计页面，或在新标签页访问 /audit.html 并导入存档。'; controls(); }
  } catch (error) { notice = `无法打开审计副本：${String(error)}`; controls(); }
});
type BattlePayload = Extract<VisibleEvent['payload'], { type: 'BattleResolved' }>;
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
/** Tile open in the inspector (terrain, foreign units and cities, resources). */
let inspectedTile: number | null = null;
let keyboardIndex: number | null = null;
type ActivityEntry = { text: string; round: number; routine: boolean };
const activityLog: ActivityEntry[] = [];
let activityImportantOnly = false;
let actionMode: ActionMode = null;
let districtPlacement: { cityId: number; kind: DistrictId; tileIndex: number | null } | null = null;
let pendingTarget: PendingTarget | null = null;
let selectedBall: BallId = 'pokeBall';
// Presentation: events play one after another as timeline tracks; `presenting` maps a running
// track to its event so skipping can still report the last summary.
const timeline = new Timeline();
const presenting = new Map<string, VisibleEvent['payload']>();
let trackSerial = 0;
const renderer = createMapRenderer(canvas);
let frameRequested = false;
let notice = '';
let presentationIndex = 0;
const busy = () => timeline.busy || presentationIndex < session.presentationQueue.length;

/** The visual track for one presentation event, or null for events without an animation. */
function presentationTrack(payload: VisibleEvent['payload']): Track | null {
  const key = `${payload.type}:${trackSerial++}`;
  const finish = () => { notice = summary(payload) || notice; presenting.delete(track!.key); };
  let track: Track | null = null;
  if (payload.type === 'Moved') track = moveTrack(payload.unit, payload.path, finish);
  else if (payload.type === 'BattleResolved') track = battleTrack(key, payload.positions[1], payload.damage, payload.counterDamage, finish);
  else if (payload.type === 'Captured') track = captureTrack(key, payload.targetUnitId, payload.success, finish);
  else if (payload.type === 'Evolved') track = evolveTrack(key, payload.unitId, finish);
  if (track) presenting.set(track.key, payload);
  return track;
}
function summary(payload: VisibleEvent['payload']) {
  switch (payload.type) {
    case 'BattleResolved': return `攻击结算：造成 ${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}${payload.knockedDownUnitIds.length ? '，有单位击坠/休养' : ''}。`;
    case 'Captured': return payload.success ? `捕捉成功（${payload.probability}%）。` : `捕捉失败（${payload.probability}%），目标激怒。`;
    case 'Evolved': return `进化完成：${speciesDisplay(payload.speciesId).name}。`;
    default: return '';
  }
}
/** Labels of units seen earlier, so a unit removed by the battle (e.g. a defeated settler) still has a name. */
const knownUnitLabels = new Map<number, string>();
export function battleActivityText(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, string> = knownUnitLabels): string {
  const CONTENT = contentForView(view);
  const unitLabel = (id: number) => {
    const unit = view.units.find(candidate => candidate.id === id) ?? view.recoveringUnits.find(candidate => candidate.id === id && candidate.ownerId === view.playerId);
    if (!unit) return known.get(id) ?? '未知单位';
    const name = unitDefinition(unit, CONTENT).name;
    return unit.ownerId === null ? `野生 ${name}` : `文明 ${unit.ownerId + 1} 的 ${name}`;
  };
  const targetLabel = payload.target.kind === 'unit' ? unitLabel(payload.target.id) : (() => {
    const city = view.cities.find(candidate => candidate.id === payload.target.id);
    if (!city) return '未知城市';
    return city.ownerId === null ? `中立营地 ${city.id}` : `文明 ${city.ownerId + 1} 的 城市 ${city.id}`;
  })();
  const ownDown = payload.knockedDownUnitIds.some(id => view.recoveringUnits.some(unit => unit.id === id && unit.ownerId === view.playerId));
  const ownLost = payload.target.kind === 'unit' && !view.units.some(unit => unit.id === payload.target.id) && !view.recoveringUnits.some(unit => unit.id === payload.target.id)
    && known.get(payload.target.id)?.startsWith(`文明 ${view.playerId + 1} 的`);
  return `${unitLabel(payload.attackerId)} 攻击了 ${targetLabel}：${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}${ownDown ? '（己方单位被击倒，回城休养）' : ownLost ? '（己方单位被击败）' : ''}`;
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
    case 'FaithFounded': return `文明 ${payload.playerId + 1} 创立${LEGENDS[payload.legend].name}信仰`;
    case 'CityConverted': return `城市 ${payload.cityId} 改宗${LEGENDS[payload.legend].name}信仰`;
    case 'ContestHallBuilt': return `城市 ${payload.cityId} 建成华丽大赛馆`;
    case 'ContestHeld': return `文明 ${payload.playerId + 1} 举办华丽大赛，人气 +${payload.appeal}`;
    case 'BerryGifted': return `文明 ${payload.playerId + 1} 赠送${RARE_BERRIES[payload.berry].name}给文明 ${payload.targetPlayerId + 1}`;
    case 'CityDefected': return `城市 ${payload.cityId} 羁绊耗尽，脱离文明 ${payload.playerId + 1} 成为中立营地`;
    case 'GymBuilt': return `城市 ${payload.cityId} 建成${ESSENCES[payload.essence].name}道馆`;
    case 'CharterAdopted': return `文明 ${payload.playerId + 1} 确立规章「${CHARTERS[payload.charterId].name}」`;
    case 'UnitPromoted': { const unit = session.getView().units.find(item => item.id === payload.unitId); return `${unit && unit.kind === 'pokemon' ? EXPANSION_CONTENT.species[unit.speciesId].name : '宝可梦'}晋升：获得特性「${PROMOTION_TRAITS[payload.trait].name}」（第 ${payload.rank} 次）`; }
    case 'LegendClueFound': return payload.playerId === session.getView().playerId ? `发现传说线索：${legendTitle(payload.legendId)}（剧情第一章，打开「传说」查看）` : '';
    case 'LegendWonderCompleted': return payload.playerId === session.getView().playerId ? `★ 建成传说奇观：${legendTitle(payload.legendId)}` : `文明 ${payload.playerId + 1} 建成了传说奇观：${legendTitle(payload.legendId)}`;
    case 'LegendWonderLost': return payload.playerId === session.getView().playerId ? `${legendTitle(payload.legendId)} 已被他人建成，城市 ${payload.cityId} 的工程作废，退还 ${payload.refund} 金` : '';
    case 'EraAgeBegan': return payload.playerId === session.getView().playerId ? `进入${ERA_AGES[payload.age].name}（上个世代 ${payload.previousScore} 分 / ${payload.previousRounds} 轮）` : '';
    case 'GovernmentChanged': return `采用体制「${GOVERNMENTS[payload.governmentId].name}」${payload.goldCost ? `（${payload.goldCost} 金）` : ''}${payload.droppedPolicies.length ? `，取下方针：${payload.droppedPolicies.map(id => POLICIES[id].name).join('、')}` : ''}`;
    case 'PoliciesChanged': return `方针更新：${payload.policyIds.map(id => POLICIES[id].name).join('、') || '无'}${payload.goldCost ? `（${payload.goldCost} 金）` : ''}`;
    case 'DiscoveryMade': return `★ 图鉴发现「${discoveryText(payload.techId, Boolean(contentForView(session.getView()).opening)).name}」：${contentForView(session.getView()).techs[payload.techId].name} +${payload.bonus}`;
    default: return '';
  }
}
// ---------- notifications (Civilization-style rail, notification-rail.ts) ----------
const rail = createNotificationRail(document.querySelector<HTMLElement>('#toast-host')!, target => {
  if (target.kind === 'screen') openScreen(target.screen);
  else if (target.kind === 'city') { closeScreen(); selectCity(target.cityId); }
  else { closeScreen(); selectUnit(target.unitId); }
});
/** Cities the viewer owned at the last refresh, so a city taken during the AI turns still reads as "yours". */
const knownOwnCityIds = new Set<number>();
const reviewedUnits = new ReviewedUnits();
/** Music follows the situation: war while the viewer is at war, otherwise exploration. */
function syncMusic() {
  if (!session) return;
  const view = session.getView();
  audio.setMood(view.outcome ? 'menu' : view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId)) ? 'war' : 'peace');
}
/** The effect for one presented event (only what the viewer did, or what happened to the viewer). */
function soundFor(payload: VisibleEvent['payload'], view: PlayerView): SoundId | null {
  const me = view.playerId;
  switch (payload.type) {
    case 'Moved': return payload.unit.ownerId === me ? 'move' : null;
    case 'BattleResolved': return payload.knockedDownUnitIds.length ? 'knockdown' : 'hit';
    case 'Captured': return payload.playerId !== me ? null : payload.success ? 'capture' : 'captureFail';
    case 'Evolved': case 'WorldStoneEvolution': return payload.playerId === me ? 'evolve' : null;
    case 'CityFounded': return payload.playerId === me ? 'cityFounded' : null;
    case 'BuildingCompleted': case 'DistrictCompleted': case 'UnitTrained': return payload.playerId === me ? 'production' : null;
    case 'TechCompleted': case 'DiscoveryMade': return payload.playerId === me ? 'research' : null;
    case 'TradeRouteEstablished': return payload.playerId === me ? 'production' : null;
    case 'ObjectiveCompleted': case 'ItemBallClaimed': return payload.playerId === me ? 'notify' : null;
    case 'UnitPromoted': return 'promotion';
    case 'LegendWonderCompleted': return 'wonder';
    case 'LegendClueFound': case 'EraAgeBegan': return payload.playerId === me ? 'notify' : null;
    case 'DiplomacyChanged': return payload.relation.a !== me && payload.relation.b !== me ? null : payload.relation.status === 'war' && payload.relation.changedAtRound >= view.round - 1 ? 'war' : payload.relation.status === 'peace' && payload.relation.changedAtRound >= view.round - 1 ? 'peace' : null;
    case 'TurnChanged': return payload.activePlayerId === me ? 'turn' : null;
    default: return null;
  }
}
function recordActivity(payload: VisibleEvent['payload']) {
  const sound = soundFor(payload, session.getView());
  if (sound) audio.play(sound);
  if (payload.type === 'DiplomacyChanged' || payload.type === 'GameEnded') syncMusic();
  if (payload.type === 'LegendWonderCompleted' && payload.playerId === session.getView().playerId) legendArrivals.push(payload.legendId);
  rail.push(toastFor(payload, session.getView(), { ownCityIds: knownOwnCityIds, unitName: id => knownUnitLabels.get(id)?.replace(/^(野生 |文明 \d+ 的 )/, '') }));
  const text = activityText(payload);
  if (!text || activityLog[0]?.text === text) return;
  activityLog.unshift({ text, round: session.getView().round, routine: payload.type === 'TurnChanged' || payload.type === 'Moved' });
  activityLog.splice(40);
}
function controls() {
  const view = session.getView();
  const CONTENT = contentForView(view);
  const ended = view.outcome !== null, pendingPeace = hasPendingPeace(view);
  if (selected !== null && !view.units.some(unit => unit.id === selected && unit.ownerId === view.playerId)) {
    selected = null; resetAction();
  }
  if (selectedCity !== null && !view.economy.cities.some(city => city.id === selectedCity)) selectedCity = null;
  for (const unit of view.units) knownUnitLabels.set(unit.id, `${unit.ownerId === null ? '野生 ' : `文明 ${unit.ownerId + 1} 的 `}${unitDefinition(unit, CONTENT).name}`);
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
  const targets = selected === null ? [] : actionTargets(view, selected, actionMode, selectedBall);
  const placementSite = districtPlacement && districtPlacement.tileIndex !== null
    ? previewDistrict(view, districtPlacement.cityId, districtPlacement.kind, districtPlacement.tileIndex) : null;
  selection.textContent = unit && inspectedTile !== null ? `${unitDefinition(unit, CONTENT).name} → ${tileSummary(describeTile(view, inspectedTile))} · 右侧可直接攻击或捕捉`
    : unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · ${unit.actionLeft ? '点击高亮格直接移动，或右键移动' : '本回合已行动'}`
    : selectedCity !== null ? `已选城市 ${selectedCity} · 在城市面板建造、训练或采购`
    : inspectedTile !== null ? `查看：${tileSummary(describeTile(view, inspectedTile))}`
    : '点选城市管理生产，点选单位执行行动，点任意地块查看详情；拖动地图平移，滚轮缩放。';
  actionNotice.textContent = notice || (pendingPeace ? '请先回应停战提议。' : districtPlacement ? '设施区选址：点击格子预览，再确认入队。Esc 取消。' : actionMode === 'attack' ? (targets.length ? `攻击模式：${targets.length} 个可攻击目标（红色虚线）。点目标看战斗预览，再点一次即攻击。Esc 取消。` : '攻击模式：射程内没有可攻击的目标（和平中的文明不能攻击）。Esc 取消。')
    : actionMode === 'move' ? '移动模式：点击高亮格移动，包括己方城市。Esc 取消。'
    : actionMode === 'capture' ? (targets.length ? '捕捉模式：点相邻的野生宝可梦看捕捉率，再点一次即捕捉。Esc 取消。' : '捕捉模式：没有可捕捉目标；检查相邻目标、当前球种的库存与科技。Esc 取消。') : ended ? '对局已结束，可开始新局。' : '');
  actionNotice.classList.toggle('is-error', notice.includes('拒绝') || notice.includes('失败'));
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${driver.lastRejected ? JSON.stringify(driver.lastRejected) : '无'}${notice ? '\n' + notice : ''}`;
  sequence.max = String(driver.exportLog().commands.length);
  renderSelectionPanel(view, selected, selectedCity, { unit: selectUnit, city: selectCity, clear: clearSelection }, busy());
  document.querySelector<HTMLElement>('#era-panel')!.innerHTML = renderEraPanel(view);
  renderLegends(view);
  renderGoals(view);
  renderPolicyPanel(view, issue, busy() || ended || pendingPeace);
  renderLeaderPanel(view);
  renderVictoryPanel(view);
  renderExpansionPanel(view, selected, selectedCity, issue, busy() || ended || pendingPeace);
  document.querySelector<HTMLElement>('#selection-empty')!.hidden = selected !== null || selectedCity !== null || neutralCity !== null || inspectedTile !== null;
  renderTilePanel(view, inspectedTile, { onSelectUnit: id => selectUnit(id, false), selectedUnitId: selected, disabled: busy() || ended || pendingPeace,
    onAction: action => { resetAction(); issue(action); } });
  renderUnitPanel(view, selected, actionMode, pendingTarget, selectedBall, busy() || ended || pendingPeace, {
    mode: mode => { actionMode = mode; pendingTarget = null; notice = ''; controls(); requestFrame(); },
    confirm: confirmAction,
    cancel: () => { actionMode = null; pendingTarget = null; notice = ''; controls(); requestFrame(); },
    evolve: evolveSelected,
    ball: ballId => { selectedBall = ballId; pendingTarget = null; notice = ''; controls(); requestFrame(); },
    found: () => { if (selected !== null) issue({ type: 'FoundCity', unitId: selected }); },
    improve: (tileIndex, kind) => { if (selected !== null) issue({ type: 'ImproveTile', unitId: selected, tileIndex, kind }); },
    issue,
  }, { actionsInBar: true });
  // Unit orders live in the bar at the bottom-right of the map (same callbacks as the old drawer buttons).
  renderUnitActionBar(view, districtPlacement ? null : selected, actionMode,
    busy() ? '动画播放中，请稍候或跳过动画。' : ended ? '对局已结束。' : pendingPeace ? '请先回应停战提议。' : null, {
      mode: mode => { actionMode = mode; pendingTarget = null; notice = ''; controls(); requestFrame(); },
      evolve: evolveSelected,
      found: () => { if (selected !== null) issue({ type: 'FoundCity', unitId: selected }); },
      improve: (tileIndex, kind) => { if (selected !== null) issue({ type: 'ImproveTile', unitId: selected, tileIndex, kind }); },
      skip: () => { if (selected !== null) reviewedUnits.add(session.getView().round, selected); cycleIdle('unit'); },
      explain: text => { notice = text; controls(); },
    });
  if (placementSite) {
    document.querySelector<HTMLElement>('#unit-panel')!.innerHTML = districtPreviewMarkup(view, placementSite, busy() || ended || pendingPeace);
    document.querySelector<HTMLButtonElement>('#confirm-district')?.addEventListener('click', confirmDistrictPlacement);
    document.querySelector<HTMLButtonElement>('#cancel-district')?.addEventListener('click', cancelDistrictPlacement);
  }
  renderEconomyPanel(view, selectedCity, issue, busy() || ended || pendingPeace, startDistrictPlacement);
  renderResearchPanel(view, issue, busy() || ended || pendingPeace);
  renderNeutralPanel(view, neutralCity, issue, busy() || ended || pendingPeace);
  renderDiplomacyPanel(view, busy() || ended, issue);
  renderOutcome(view, newGame);
  const shown = activityLog.filter(entry => !activityImportantOnly || !entry.routine);
  document.querySelector('#activity-list')!.innerHTML = shown.length ? shown.map((entry, index) =>
    `${index === 0 || shown[index - 1].round !== entry.round ? `<li class="activity-round" aria-hidden="true">第 ${entry.round} 轮</li>` : ''}<li class="${entry.routine ? 'routine' : 'important'}">${entry.text}</li>`).join('')
    : `<li>${activityLog.length ? '本段时间没有重要事件' : '暂无动态'}</li>`;
  if (busy() || ended || pendingPeace) for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#economy button, #economy input, #economy select')) element.disabled = true;
  for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#controls button, #controls input, #controls select, #dev-drawer button, #dev-drawer input, #skip')) {
    const newGameSetting = element.matches('#leader-setup input, #starter, #map-size, #round-limit, #ai-count, #ai-personality, #era-progression');
    const transition = pendingPeace && !ended && (newGameSetting || ['new-game', 'load-game', 'import-save', 'replay', 'resume'].includes(element.id));
    const storage = ['load-game', 'export-save', 'import-save'].includes(element.id);
    element.disabled = element.id === 'skip' ? !busy()
      : element.id === 'new-game' || newGameSetting || storage ? busy() || transition : busy() || ended || transition;
  }
  document.querySelector('#context-drawer')!.classList.toggle('has-selection', selected !== null || selectedCity !== null || neutralCity !== null || inspectedTile !== null || districtPlacement !== null);
  const reminders = turnReminders(view, CONTENT, reviewedUnits.of(view.round));
  renderTurnButton(view, reminders, ended, pendingPeace);
  if (!busy()) { knownOwnCityIds.clear(); for (const city of view.economy.cities) knownOwnCityIds.add(city.id); }
  rail.sync(view, busy(), { unitId: selected, cityId: selectedCity });
  document.querySelector('#turn-reminders')!.innerHTML = ended ? '' : reminders.map(item => `<button type="button" data-reminder="${item.target}">${item.label}</button>`).join('');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reminder]')) button.onclick = () => {
    const kind = button.dataset.reminder!;
    if (kind.startsWith('danger:')) { selectUnit(Number(kind.slice(7))); notice = '附近有野生或敌方宝可梦：让宝可梦护送，或先撤回城市。'; controls(); return; }
    if (kind.startsWith('unit:')) { selectUnit(Number(kind.slice(5))); notice = '开拓队：移动到离其他城市至少 4 格的陆地，下一回合点「在此建立城市」。'; controls(); return; }
    if (kind === 'city' || kind === 'unit') { cycleIdle(kind); return; }
    const target = document.querySelector<HTMLElement>(kind);
    if (target) revealPanel(target);
  };
}

/** Selects the next (or previous) idle city or unit after the current selection, cycling. */
function cycleIdle(kind: 'city' | 'unit', step: 1 | -1 = 1) {
  const view = session.getView();
  if (kind === 'city') {
    selectCity(cycleId(idleCityIds(view), selectedCity, step));
    const economy = document.querySelector<HTMLElement>('#economy');
    if (economy) revealPanel(economy);
  } else selectUnit(cycleId(idleUnitIds(view), selected, step));
}
// ---------- end-turn state machine (turn-button.ts) ----------
const turnHint = document.querySelector<HTMLElement>('#turn-hint')!;
const unitCycle = [...document.querySelectorAll<HTMLButtonElement>('[data-cycle-unit]')];
let turnState: TurnStep | null = null;
function renderTurnButton(view: PlayerView, reminders: ReturnType<typeof turnReminders>, ended: boolean, pendingPeace: boolean) {
  turnState = ended ? null : turnStep(view, reminders, { unitId: selected, cityId: selectedCity }, reviewedUnits.of(view.round));
  endTurn.disabled = busy() || ended || pendingPeace;
  endTurn.textContent = turnState?.label ?? `第 ${view.round} 轮 · 对局已结束`;
  endTurn.dataset.state = turnState?.kind ?? 'ended';
  endTurn.title = turnState && turnState.kind !== 'ready' ? '还有待办：点击前往。Shift+点击或 Ctrl/⌘+Enter 直接结束回合。' : '结束本回合（Ctrl/⌘+Enter）';
  turnHint.hidden = !turnState || turnState.kind === 'ready' || endTurn.disabled;
  const idle = idleUnitIds(view).length;
  for (const button of unitCycle) button.disabled = busy() || ended || pendingPeace || idle === 0;
}
/** End-turn button: a plain click goes to the first pending item; with nothing pending (or Shift held) it ends the turn. */
function onEndTurn(force: boolean) {
  if (busy() || !turnState) return;
  const step = turnState;
  if (force || step.kind === 'ready') { issue({ type: 'EndTurn' }); return; }
  if (step.kind === 'city') {
    selectCity(step.cityId);
    const economy = document.querySelector<HTMLElement>('#economy');
    if (economy) revealPanel(economy);
    return;
  }
  if (step.kind !== 'unit') { const panel = document.querySelector<HTMLElement>(step.panel); if (panel) revealPanel(panel); return; }
  const view = session.getView();
  reviewedUnits.add(view.round, step.unitId);
  selectUnit(step.unitId);
  notice = step.remaining > 1 ? `待命单位（还有 ${step.remaining - 1} 个）：下达命令，或再点一次按钮看下一个。` : '最后一个待命单位：下达命令，或再点一次按钮进入下一回合。';
  controls();
}
function issue(action: Command['action'], successNotice?: string) {
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
    audio.play('error');
  }
  else {
    notice = successNotice ?? '';
    if (action.type === 'Attack') audio.play('attack');
    if (action.type === 'Attack' || action.type === 'Capture' || action.type === 'Move' || action.type === 'EndTurn') resetAction();
    if (action.type === 'SetProductionQueue' && action.orders.some(order => order.item.kind === 'district')) districtPlacement = null;
    if (action.type === 'FoundCity') {
      selected = null; selectedCity = session.getView().economy.cities.at(-1)!.id; resetAction();
      notice = `城市 ${selectedCity} 已建立。现在可以建造建筑或训练新的单位。`;
    }
    advanceToNextUnit(action);
  }
  controls(); requestFrame();
}
/** v16 (Civilization-style): when the selected unit has used up its turn, select the nearest unit still waiting for orders. */
function advanceToNextUnit(action: Command['action']) {
  const view = session.getView();
  if (!usesMovementPoints(view) || selected === null || !('unitId' in action) || action.unitId !== selected || action.type === 'PromoteUnit') return;
  const current = view.units.find(unit => unit.id === selected);
  if (current?.actionLeft) return;
  const origin = current?.position;
  const next = view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft && unit.id !== selected)
    .sort((a, b) => (origin ? hexDistance(origin, a.position) - hexDistance(origin, b.position) : 0) || a.id - b.id)[0];
  if (!next) return;
  selectUnit(next.id);
  notice = `下一个待命单位：${next.kind === 'pokemon' ? contentForView(view).species[next.speciesId].name : '开拓队'}（还有 ${view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).length} 个单位待命）`;
}
/** P0-4: the floating combat preview beside the chosen attack target (follows the camera; hidden otherwise). */
function updateCombatCard(view: PlayerView) {
  const card = actionMode === 'attack' && pendingTarget && selected !== null ? combatCard(view, selected, pendingTarget) : null;
  const anchor = card && pendingTarget ? toScreen(hexToWorld(indexToHex(pendingTarget.index, view.map)), camera) : null;
  renderCombatCard(card, anchor, HEX_RADIUS * camera.zoom, busy() || view.outcome !== null || hasPendingPeace(view), {
    confirm: confirmAction,
    cancel: cancelTarget,
  });
}
/** Drops the chosen target (closing the combat card) but stays in the current action mode. */
/** Esc on the map: drop the chosen target, then leave the action mode, then clear the selection. */
function escapeAction() {
  if (pendingTarget) cancelTarget();
  else if (actionMode !== null || districtPlacement) { resetAction(); notice = ''; controls(); requestFrame(); }
  else clearSelection();
}
function cancelTarget() {
  pendingTarget = null; notice = ''; canvas.focus(); controls(); requestFrame();
}
function confirmAction() {
  if (selected === null || !pendingTarget) return;
  if (actionMode === 'attack') issue({ type: 'Attack', unitId: selected, target: { kind: pendingTarget.kind, id: pendingTarget.id } });
  else if (actionMode === 'capture') issue({ type: 'Capture', unitId: selected, targetUnitId: pendingTarget.id, ballId: selectedBall });
}
function confirmDistrictPlacement() {
  const placement = districtPlacement;
  if (!placement || placement.tileIndex === null) return;
  const view = session.getView(), city = view.economy.cities.find(item => item.id === placement.cityId);
  if (!city) { cancelDistrictPlacement(); return; }
  const site = previewDistrict(view, placement.cityId, placement.kind, placement.tileIndex);
  if (site.reason !== null || city.queue.length >= 5) {
    notice = city.queue.length >= 5 ? '生产队列已满 5 项，请先完成或取消订单。' : '目标格已不可建造，请重新选择。';
    controls(); return;
  }
  issue({ type: 'SetProductionQueue', cityId: city.id, orders: [
    ...city.queue.map(order => ({ orderId: order.id, item: order.item })),
    { item: { kind: 'district', defId: placement.kind, tileIndex: placement.tileIndex! } },
  ] }, `设施区已加入城市 ${city.id} 队列；格子已预订。`);
}
/** `?gameplay=N` starts a new game on an older rules pack (for testing and comparing); defaults to the latest. */
function requestedGameplayVersion(): GameplayVersion {
  const value = Number(new URLSearchParams(location.search).get('gameplay'));
  return isGameplayVersion(value) && value >= 1 ? value : LATEST_GAMEPLAY_VERSION;
}
// ---------- v21 opening objectives ----------
let goalsCollapsed = false;
document.querySelector<HTMLElement>('#opening-goals')?.addEventListener('click', event => {
  if (!(event.target as HTMLElement).closest('.goals-toggle')) return;
  goalsCollapsed = !goalsCollapsed; renderGoals(session.getView());
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
// ---------- v15 legendary wonders ----------
const legendArrivals: LegendWonderId[] = [];
/** Queues the full-screen story card (used when an own wonder completes; exported for tests). */
export function showLegendArrival(id: LegendWonderId) { legendArrivals.push(id); controls(); }
let legendMarkup = '';
function renderLegends(view: PlayerView) {
  document.querySelector<HTMLElement>('#legends-launcher')!.hidden = !view.expansion?.legends;
  const markup = legendScreenMarkup(view), root = document.querySelector<HTMLElement>('#legend-panel')!;
  if (markup !== legendMarkup) {
    const open = new Set([...root.querySelectorAll<HTMLElement>('details[open]')].map(item => item.closest<HTMLElement>('[data-legend]')?.dataset.legend));
    legendMarkup = markup; root.innerHTML = markup;
    for (const id of open) root.querySelector(`[data-legend="${id}"] details`)?.setAttribute('open', '');
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-legend-site]')) button.addEventListener('click', () => {
      const index = Number(button.dataset.legendSite);
      closeScreen(); focusHex(indexToHex(index, session.getView().map)); inspectedTile = index; selected = null; selectedCity = null; controls(); requestFrame();
    });
  }
  const arrival = document.querySelector<HTMLElement>('#legend-arrival-root')!;
  if (legendArrivals.length && !arrival.childElementCount) {
    arrival.innerHTML = legendCompletionMarkup(legendArrivals[0]);
    arrival.querySelector('#legend-arrival-close')!.addEventListener('click', () => { legendArrivals.shift(); arrival.innerHTML = ''; controls(); });
  }
}
function evolveSelected(intoSpeciesId?: SpeciesId) {
  const view = session.getView(), unit = view.units.find(unit => unit.id === selected && unit.kind === 'pokemon');
  const CONTENT = contentForView(view);
  const evolution = unit?.kind === 'pokemon' ? CONTENT.species[unit.speciesId].evolution : null;
  if (unit && (intoSpeciesId ?? evolution)) issue({ type: 'Evolve', unitId: unit.id, intoSpeciesId: intoSpeciesId ?? evolution!.speciesId });
}
function requestFrame() {
  if (session && !frameRequested) { frameRequested = true; requestAnimationFrame(frame); }
}
function finishPresentations() {
  const pending = session.presentationQueue.slice(presentationIndex);
  for (const event of pending) recordActivity(event.payload);
  const payloads = [...presenting.values(), ...pending.map(event => event.payload)];
  const text = payloads.map(summary).filter(Boolean).at(-1);
  if (text) notice = text;
  timeline.clear(); presenting.clear();
  presentationIndex = 0;
  session.skipAnimations();
}
function frame(now: number) {
  frameRequested = false;
  if (!animate.checked) finishPresentations();
  timeline.advance(now);
  // The player session returns a defensive copy; read it once per frame, not per event.
  const queue = session.presentationQueue;
  while (!timeline.busy && presentationIndex < queue.length) {
    const event = queue[presentationIndex++]!;
    recordActivity(event.payload);
    const track = presentationTrack(event.payload);
    if (track) timeline.add(track, now);
  }
  const view = session.getView();
  const animation = timeline.sample(now, { unitPosition: id => view.units.find(unit => unit.id === id)?.position });
  const paths = selected === null ? {} : reachablePaths(view, selected);
  const targets = selected === null ? [] : actionTargets(view, selected, actionMode, selectedBall).map(target => hexToIndex(target.position, view.map)!);
  const drawStarted = performance.now();
  renderer.render({
    view: import.meta.env.DEV && god.checked ? developerAdapter.getDebugView() : view, camera, animation,
    selected, selectedCity, reachable: Object.keys(paths).map(Number), cursorIndex: keyboardIndex,
    actionMode, actionTargets: targets, pendingTargetIndex: pendingTarget?.index, inspectedTile,
    debugOverlay: import.meta.env.DEV ? document.querySelector<HTMLSelectElement>('#debug-overlay')!.value as DebugOverlay : 'none',
    districtPlacement: districtPlacement ? { sites: districtSites(view, districtPlacement.cityId, districtPlacement.kind), selectedTileIndex: districtPlacement.tileIndex } : undefined,
    layers: { yields: showYields.checked },
  });
  updateCombatCard(view);
  frameDurations.push(performance.now() - drawStarted);
  if (frameDurations.length > 240) frameDurations.shift();
  if (import.meta.env.DEV) {
    const metrics = frameMetrics();
    frameMetricsElement.textContent = `帧绘制耗时（最近 ${metrics.samples} 帧）：${metrics.last.toFixed(2)} ms\n均值 ${metrics.mean.toFixed(2)} ms · p95 ${metrics.p95.toFixed(2)} ms · 最大 ${metrics.max.toFixed(2)} ms`;
  }
  // Drop fully presented events so the queue (and its per-frame copy) stays small in long games.
  if (!timeline.busy && presentationIndex > 0 && presentationIndex >= queue.length) { session.skipAnimations(); presentationIndex = 0; }
  if (busy()) requestFrame();
  // Non-blocking tracks (click ripples) only need the map redrawn; panels refresh once they end.
  else if (timeline.animating) requestFrame();
  else controls();
}
function skip() { finishPresentations(); controls(); requestFrame(); }
function fit() { camera = fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight); requestFrame(); }
function startDistrictPlacement(cityId: number, kind: DistrictId) {
  selected = null; selectedCity = cityId; neutralCity = null; resetAction();
  districtPlacement = { cityId, kind, tileIndex: null }; notice = '';
  closeScreen(); canvas.focus();
  controls(); requestFrame();
}
function cancelDistrictPlacement() {
  districtPlacement = null; notice = ''; controls(); requestFrame();
}
function resetAction() { actionMode = null; pendingTarget = null; districtPlacement = null; }
function clearSelection() {
  selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null;
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
  selected = unit?.id ?? null; selectedCity = null; neutralCity = null; inspectedTile = null;
  resetAction(); notice = '';
  if (unit) audio.play('select');
  if (unit && focus) focusHex(unit.position);
  controls(); requestFrame();
}
function selectCity(id: number | null, focus = true) {
  const city = session.getView().economy.cities.find(city => city.id === id);
  selectedCity = city?.id ?? null; selected = null; neutralCity = null; inspectedTile = null;
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
    const mapSizes = { '24x16': { width: 24, height: 16 }, '30x20': { width: 30, height: 20 }, '40x26': { width: 40, height: 26 }, '56x36': { width: 56, height: 36 } } as const;
    const sizeOption = document.querySelector<HTMLSelectElement>('#map-size')!.value as keyof typeof mapSizes;
    // `?size=24x16` pins a map size (tests and quick comparisons); the menu default is the large map.
    const pinned = new URLSearchParams(location.search).get('size') as keyof typeof mapSizes | null;
    const size = (pinned && mapSizes[pinned]) || mapSizes[sizeOption] || mapSizes['40x26'];
    const eraProgression = document.querySelector<HTMLSelectElement>('#era-progression')!.value as EraProgression;
    driver = new GameSession({ expansionVersion: 1, eraProgression, gameplayVersion: requestedGameplayVersion(), seed: Number(new URLSearchParams(location.search).get('seed') ?? '12345'), ...size,
      roundLimit: Number(document.querySelector<HTMLSelectElement>('#round-limit')!.value) as GameSetup['roundLimit'], players });
    session = driver.asPlayerSession();
    timeline.clear(); presenting.clear(); presentationIndex = 0; selected = null; selectedCity = session.getView().economy.player.headquartersCityId; neutralCity = null; inspectedTile = null; keyboardIndex = null; activityLog.length = 0; knownUnitLabels.clear();
    rail.clear(); reviewedUnits.clear(); knownOwnCityIds.clear();
    frameDurations.length = 0;
    resetAction(); notice = ''; sequence.value = '0';
    canvas.hidden = false;
    fit();
    selectCity(selectedCity);
    // Opening camera focus should not change the first keyboard unit selection.
    keyboardIndex = null;
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
  const view = session.getView();
  keyboardIndex = index;
  if (index === null) { clearSelection(); return; }
  if (districtPlacement) {
    if (confirmSelection && districtPlacement.tileIndex === index) confirmDistrictPlacement();
    else {
      districtPlacement.tileIndex = index; notice = ''; controls();
      revealPanel(document.querySelector<HTMLElement>('#unit-panel')!); requestFrame();
    }
    return;
  }
  const construction = constructionNotice(view, index);
  if (construction && actionMode) { tapFeedback(index, 'error'); notice = construction; controls(); requestFrame(); return; }
  if (actionMode === 'move' && selected !== null) {
    if (reachablePaths(view, selected)[index]) { tapFeedback(index); issue({ type: 'Move', unitId: selected, to: indexToHex(index, view.map) }); }
    else { tapFeedback(index, 'error'); notice = '此处无法移动，请选择高亮格，或取消移动以选择其他对象。'; controls(); }
    requestFrame(); return;
  }
  if (actionMode && selected !== null) {
    const target = actionTargets(view, selected, actionMode, selectedBall).find(candidate => hexToIndex(candidate.position, view.map) === index);
    // Civilization-style: clicking the chosen attack / capture target a second time confirms it.
    if (target && (actionMode === 'attack' || actionMode === 'capture') && pendingTarget?.index === index && pendingTarget.kind === target.kind && pendingTarget.id === target.id) {
      tapFeedback(index); confirmAction(); requestFrame(); return;
    }
    if (target) { pendingTarget = { kind: target.kind, id: target.id, index }; tapFeedback(index); }
    else { pendingTarget = null; tapFeedback(index, 'error'); notice = '该目标不适用；请选择高亮目标。'; }
    controls(); requestFrame();
    if (target && actionMode === 'capture') document.querySelector('#capture-preview')?.closest('.combat-preview')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  tapFeedback(index);
  const hex = indexToHex(index, view.map);
  const city = view.cities.find(city => hexToIndex(city.position, view.map) === index);
  // With one of your units selected, clicking a foreign/wild unit or a city keeps the unit, so the
  // inspector can show what it could do to the target (Civilization-style combat preview).
  const keepUnit = selected !== null && (view.units.some(unit => unit.ownerId !== view.playerId && hexToIndex(unit.position, view.map) === index)
    || (city !== undefined && city.ownerId !== view.playerId));
  if (city?.ownerId === null) {
    neutralCity = city; selected = keepUnit ? selected : null; selectedCity = null; inspectedTile = index; resetAction(); notice = '';
    controls(); requestFrame(); return;
  }
  neutralCity = null;
  const own = view.units.find(unit => unit.ownerId === view.playerId && hexToIndex(unit.position, view.map) === index);
  const ownCity = city?.ownerId === view.playerId ? city : null;
  if (!construction && ownCity && (!own || selectedCity !== ownCity.id)) { selectCity(ownCity.id, false); return; }
  if (!construction && own) { selectUnit(own.id, false); return; }
  if (!construction && selected !== null && reachablePaths(view, selected)[index]) { inspectedTile = null; issue({ type: 'Move', unitId: selected, to: hex }); }
  else {
    // Anything else (terrain, a foreign unit or city, a resource) opens the tile inspector.
    if (!keepUnit) selected = null;
    selectedCity = null; resetAction(); inspectedTile = index; notice = construction ?? '';
  }
  controls(); requestFrame();
}
/** Click ripple on the map; skipped when animation is off or the player prefers reduced motion. */
function tapFeedback(index: number, tone: 'ok' | 'error' = 'ok') {
  if (!animate.checked || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  timeline.add(tapTrack(indexToHex(index, session.getView().map), tone), performance.now());
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
// Hover tooltip (mouse only): one line naming what is under the pointer.
const tooltip = document.querySelector<HTMLElement>('#map-tooltip')!;
let tooltipKey: string | null = null;
function hideTooltip() { tooltip.hidden = true; tooltipKey = null; }
function updateTooltip(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || drag?.moved || !session) { hideTooltip(); return; }
  const point = localPoint(event), view = session.getView();
  const index = hexToIndex(worldToHex(toWorld(point, camera)), view.map);
  if (index === null) { hideTooltip(); return; }
  if (`${index}:${selected}` !== tooltipKey) {
    const preview = previewSummary(targetPreviews(view, selected, index));
    tooltip.textContent = tileSummary(describeTile(view, index)) + (preview ? ` · ${preview}` : '');
    tooltipKey = `${index}:${selected}`;
  }
  tooltip.hidden = false;
  const x = Math.min(point.x + 16, canvas.clientWidth - tooltip.offsetWidth - 8), y = point.y + 18 + tooltip.offsetHeight > canvas.clientHeight ? point.y - tooltip.offsetHeight - 10 : point.y + 18;
  tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}
canvas.addEventListener('pointerleave', hideTooltip);
canvas.addEventListener('pointermove', event => {
  updateTooltip(event);
  if (!drag && districtPlacement) {
    const index = hexToIndex(worldToHex(toWorld(localPoint(event), camera)), session.getView().map);
    if (index !== null && index !== districtPlacement.tileIndex) { districtPlacement.tileIndex = index; controls(); requestFrame(); }
  }
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
  const click = drag && !drag.moved; drag = null; tooltipKey = null;
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
    if (districtPlacement) districtPlacement.tileIndex = keyboardIndex;
    controls(); requestFrame();
  } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); activateIndex(fallback, true); }
  else if (event.key === 'Escape') { event.preventDefault(); escapeAction(); }
  else if (event.key === '+' || event.key === '=' || event.key === '-') {
    event.preventDefault();
    zoomAt(camera, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, event.key === '-' ? .9 : 1.1);
    requestFrame();
  } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
});
endTurn.addEventListener('click', event => onEndTurn(event.shiftKey));
for (const button of unitCycle) button.addEventListener('click', () => cycleIdle('unit', button.dataset.cycleUnit === 'prev' ? -1 : 1));
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
  try { driver.replayTo(Number(sequence.value)); selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null; knownUnitLabels.clear(); resetAction(); notice = ''; skip(); }
  catch (error) { notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  driver.resumeFromReplay(); selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null; knownUnitLabels.clear(); resetAction(); controls(); requestFrame();
});
const saveKey = 'pokemon-civilization-save';
function load(text: string) {
  if (transitionBlocked()) return;
  driver.load(text); closeScreen(); timeline.clear(); presenting.clear(); selected = null; selectedCity = session.getView().economy.cities[0]?.id ?? null; neutralCity = null; inspectedTile = null; keyboardIndex = null; activityLog.length = 0; knownUnitLabels.clear(); resetAction(); notice = '读档完成';
  rail.clear(); reviewedUnits.clear(); knownOwnCityIds.clear();
  frameDurations.length = 0;
  fit();
  const focusCity = session.getView().economy.cities.find(city => city.id === selectedCity);
  if (focusCity) { focusHex(focusCity.position); keyboardIndex = null; }
  skip();
}
function storageAction(action: () => void) {
  try { action(); } catch (error) { notice = error instanceof Error ? error.message : String(error); }
  controls();
}
document.querySelector('#save-game')!.addEventListener('click', () => storageAction(() => {
  localStorage.setItem(saveKey, driver.save()); notice = '已保存到此浏览器'; closeScreen();
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
  // Hotkeys act on the map: not behind an open screen or dialog (Esc and Tab are handled by screens.ts).
  if (document.querySelector('dialog[open]') || !document.querySelector<HTMLElement>('#screen-host')!.hidden) return;
  // The canvas handles its own Esc; elsewhere (drawer, action bar, page) Esc backs out of the current action too.
  if (event.key === 'Escape' && target !== canvas && !target?.closest('#combat-card') && !document.querySelector('#unit-action-bar .unit-action-menu')) { escapeAction(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); onEndTurn(true); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === ',' || event.key === '.') {
    if (!idleUnitIds(session.getView()).length) return;
    event.preventDefault(); if (!busy()) cycleIdle('unit', event.key === ',' ? -1 : 1);
  }
  else if (event.key.toLowerCase() === 'c') {
    event.preventDefault();
    selectCity(session.getView().economy.cities[0]?.id ?? null);
    document.querySelector<HTMLElement>('#city-select')?.focus();
  } else if (event.key.toLowerCase() === 'y') { event.preventDefault(); showYields.checked = !showYields.checked; requestFrame(); }
  else if (['r', 't'].includes(event.key.toLowerCase())) { event.preventDefault(); openScreen('research', '#research-topic'); }
  else if (event.key === '?') {
    event.preventDefault();
    const help = document.querySelector<HTMLDetailsElement>('#keyboard-help')!;
    openScreen('menu'); help.open = true; help.querySelector('summary')!.focus();
  }
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
// ---------- audio (original Web Audio music and effects; starts on the first gesture) ----------
document.querySelector<HTMLElement>('#audio-settings-root')!.innerHTML = audioSettingsMarkup();
bindAudioSettings(document.querySelector<HTMLElement>('#audio-settings-root')!);
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => { audio.unlock(); syncMusic(); }, { passive: true });
document.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) audio.play('click'); }, true);
// The map fills the stage; redraw when a screen closes so the canvas picks up any resize.
onScreenChange(screen => { rail.screenOpened(screen); if (screen === null && session) requestFrame(); });
document.querySelector<HTMLInputElement>('#activity-important')!.addEventListener('change', event => { activityImportantOnly = (event.target as HTMLInputElement).checked; controls(); });
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
