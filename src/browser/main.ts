import { OBJECTIVES, OBJECTIVE_IDS } from '../content/opening.ts';
import type { ObjectiveId } from '../content/opening.ts';
import { discoveryText } from '../content/discoveries.ts';
import { isGameplayVersion } from '../content/eras.ts';
import type { GameplayVersion } from '../content/eras.ts';
import { audio, audioSettingsMarkup, bindAudioSettings } from './audio/index.ts';
import type { SoundId } from './audio/index.ts';
import { usesMovementPoints } from '../core/movement.ts';
import { leagueCountdownToast, toastFor } from './notifications.ts';
import { leagueActivityText, renderLeagueResult, showLatestLeagueSeason } from './league-card.ts';
import { captureNoTargetReason, captureTargetReason } from './capture-reason.ts';
import { renderBallStock } from './ball-stock.ts';
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
import { bindEraPanel, renderEraPanel } from './era-panel.ts';
import { DEDICATIONS } from '../content/dedications.ts';
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
import { EXPANSION_CONTENT, unitDefinition, contentForView, techOf, regionalDexDraw, REGIONAL_CONTENT } from '../content/units.ts';
import { dexSummaryMarkup } from './regional-dex-panel.ts';
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
import type { DebugOverlay, RenderStats, Track } from './render/index.ts';
import type { UnitMarkIdentity } from './render/scene.ts';
import type { Hex } from '../core/hex.ts';
import { battleTrack, captureTrack, evolveTrack, moveTrack, tapTrack, wonderRevealTrack } from './render/animation.ts';
import { bigEventTiles, bigEventTrack } from './event-tracks.ts';
import { AmbientTransitions } from './ambient-transitions.ts';
import { WarIntensity, musicMood } from './music-director.ts';
import { currentScreen } from './screens.ts';
import type { BattleSpec } from './render/animation.ts';
import { describeTile, tileSummary } from './tile-info.ts';
import { renderTilePanel } from './tile-panel.ts';
import { ERA_AGES } from '../content/era-honors.ts';
import { previewSummary, targetPreviews } from './target-preview.ts';
import { HEX_RADIUS, fitCamera, hexToWorld, tileToScreen, toWorld, worldToHex, zoomAt } from './camera.ts';
import { combatCard, renderCombatCard } from './combat-preview.ts';
import { battleLook } from './battle-presentation.ts';
import { TYPE_COLORS } from '../content/type-colors.ts';
import type { TypeId } from '../content/species.ts';
import { attackSound } from './audio/sfx.ts';
import type { Camera, Point } from './camera.ts';
import { GoToOrders, isSettler, planGoTo, planStops, stopText } from './waypoints.ts';
import type { GoToPlan, GoToStop } from './waypoints.ts';
import { suggestCitySites } from './city-sites.ts';
import type { CitySite } from './city-sites.ts';
import { renderSitePins } from './site-pins.ts';
import type { SceneGoTo } from './render/scene.ts';
import type { UnitBarGoTo } from './unit-action-bar.ts';

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
  /** Last map frame's layer-cache stats and shake offset, and the recently presented events (animated or skipped). */
  getPresentation: () => ({ render: lastRenderStats && { ...lastRenderStats, shake: { ...lastRenderStats.shake } }, events: presentationLog.map(item => ({ ...item })),
    frame: { effects: lastAnimation.effects.map(item => ({ ...item })), poses: lastAnimation.poses.map(item => ({ ...item })),
      ...(lastAnimation.night !== undefined ? { night: lastAnimation.night } : {}), ...(lastAnimation.weather ? { weather: lastAnimation.weather.map(item => ({ ...item })) } : {}) } }),
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Identities of units seen earlier (owner, species), so a unit removed by a battle can still be drawn and attributed. */
const knownUnits = new Map<number, UnitMarkIdentity>();
/** City owners at the last idle refresh, so a city taken during the AI turns still knows its previous owner. */
const knownCityOwners = new Map<number, number | null>();
function unitOwner(view: PlayerView, id: number): number | null | undefined {
  const unit = view.units.find(item => item.id === id) ?? view.recoveringUnits.find(item => item.id === id);
  return unit ? unit.ownerId : knownUnits.get(id)?.ownerId;
}
/** Whether a battle was fought by, or against, the viewer. */
function battleInvolvesViewer(payload: BattlePayload, view: PlayerView): boolean {
  if (unitOwner(view, payload.attackerId) === view.playerId) return true;
  return payload.target.kind === 'unit' ? unitOwner(view, payload.target.id) === view.playerId
    : knownOwnCityIds.has(payload.target.id) || knownCityOwners.get(payload.target.id) === view.playerId;
}
/** Tiles an event happens on, for the off-screen check. */
function eventTiles(payload: VisibleEvent['payload'], view: PlayerView): Hex[] {
  const at = (id: number) => view.units.find(unit => unit.id === id)?.position;
  switch (payload.type) {
    case 'Moved': return payload.path;
    case 'BattleResolved': return payload.positions;
    case 'Captured': return [at(payload.targetUnitId), at(payload.unitId)].filter((hex): hex is Hex => hex !== undefined);
    case 'Evolved': return [at(payload.unitId)].filter((hex): hex is Hex => hex !== undefined);
    default: return bigEventTiles(payload, view);
  }
}
/** Any of the tiles inside the map viewport (on a wrapping map: the copy nearest the centre, which is the visible one if any is). */
function onScreen(tiles: readonly Hex[], view: PlayerView): boolean {
  const width = canvas.clientWidth, height = canvas.clientHeight, margin = HEX_RADIUS * camera.zoom;
  return tiles.some(hex => {
    const p = tileToScreen(hex, camera, view.map, width);
    return p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin;
  });
}
/** The viewer's own action (moves, attacks, captures, evolutions they issued). */
function ownAction(payload: VisibleEvent['payload'], view: PlayerView): boolean {
  switch (payload.type) {
    case 'Moved': return payload.unit.ownerId === view.playerId;
    case 'BattleResolved': return unitOwner(view, payload.attackerId) === view.playerId;
    case 'Captured': case 'Evolved': return payload.playerId === view.playerId;
    default: return false;
  }
}
/**
 * Recent presented events and whether each got a map animation (developer adapter, tests). Battles also note the
 * matchup the presentation derived and, when a knockdown record carries it, the authority's own figure.
 */
type PresentedEvent = { type: string; animated: boolean; effectiveness?: number | null; recorded?: number };
const presentationLog: PresentedEvent[] = [];
let lastRenderStats: RenderStats | null = null;
/** The last map frame's effects and poses, summarised (developer adapter, tests). */
let lastAnimation: { effects: { kind: string; color?: string; text?: string; tone?: string; ownerId?: number | null; label?: string; form?: string; progress: number }[];
  poses: { id: number; alpha?: number; grey?: boolean; scale?: number }[]; night?: number; weather?: { key: string; alpha: number }[] } = { effects: [], poses: [] };
/** Territory of a captured city that the viewer knows belongs to its new owner, by distance (0–3) from the city. */
function captureTiles(view: PlayerView, tile: number, ownerId: number | null): { hex: Hex; ring: number }[] {
  const city = indexToHex(tile, view.map);
  return view.territoryOwnerIds.flatMap((owners, index) => {
    if (index !== tile && (ownerId === null || !owners?.includes(ownerId))) return [];
    const hex = indexToHex(index, view.map), ring = hexDistance(city, hex, view.map);
    return ring <= 3 ? [{ hex, ring }] : [];
  });
}
function battleSpec(payload: BattlePayload, view: PlayerView, key: string, finish: () => void): BattleSpec {
  const look = battleLook(payload, view, knownUnits, knownCityOwners);
  const color = (type: TypeId | null) => type ? TYPE_COLORS[type] : undefined;
  // Each hit sounds when it lands: a knockdown chime when the struck side goes down.
  const onImpact = (counter: boolean) => audio.play((counter ? look.attackerDown : look.targetDown) ? 'knockdown' : 'hit');
  return { key, attacker: payload.positions[0], target: payload.positions[1], damage: payload.damage, counterDamage: payload.counterDamage,
    map: view.map, motion: !reducedMotion(), ranged: look.ranged, effectiveness: look.effectiveness, onFinish: finish, onImpact,
    ...(color(look.attackType) ? { attackColor: color(look.attackType) } : {}), ...(color(look.counterType) ? { counterColor: color(look.counterType) } : {}),
    ...(look.attacker ? { attackerUnit: look.attacker } : {}), ...(look.target ? { targetUnit: look.target } : {}),
    ...(look.targetDown ? { targetDown: look.targetTag } : {}), ...(look.attackerDown ? { attackerDown: look.attackerTag } : {}),
    ...(look.city ? { capture: { tiles: captureTiles(view, look.city.tile, look.city.ownerId), ownerId: look.city.ownerId,
      ...(look.city.previousOwner !== undefined ? { previousOwner: look.city.previousOwner } : {}) } } : {}) };
}

/** The visual track for one presentation event, or null for events without an animation. */
function presentationTrack(payload: VisibleEvent['payload']): Track | null {
  const view = session.getView();
  // V7: someone else's action entirely outside the viewport costs no playing time (its toast and log entry remain).
  if (!ownAction(payload, view) && eventTiles(payload, view).length && !onScreen(eventTiles(payload, view), view)) {
    notice = summary(payload) || notice;
    return null;
  }
  const key = `${payload.type}:${trackSerial++}`;
  const finish = () => { notice = summary(payload) || notice; presenting.delete(track!.key); };
  let track: Track | null = null;
  if (payload.type === 'Moved') track = moveTrack(payload.unit, payload.path, finish, view.map);
  else if (payload.type === 'BattleResolved') track = battleTrack(battleSpec(payload, view, key, finish));
  else if (payload.type === 'Captured') track = captureTrack(key, payload.targetUnitId, payload.success, finish);
  else if (payload.type === 'Evolved') track = evolveTrack(key, payload.unitId, finish);
  else if (payload.type === 'LegendWonderCompleted') track = wonderTrack(payload, view, key, finish);
  else track = bigEventTrack(payload, view, key, { motion: !reducedMotion(), onFinish: finish });
  // Non-blocking tracks (V8 pulses) never stand for an event the skip button must still report.
  if (track && track.blocking !== false) presenting.set(track.key, payload);
  return track;
}
/** V10: the player's view before a wonder reveal moved the camera; restored when the story card closes. */
let revealHome: Camera | null = null;
/** The reveal playing now: on skip its story card still opens, and the horn sounds if the pillar had not risen yet. */
let pendingReveal: { legendId: LegendWonderId; horn: boolean } | null = null;
function restoreRevealCamera() {
  if (!revealHome) return;
  Object.assign(camera, revealHome); revealHome = null; requestFrame();
}
/**
 * V10 wonder reveal for the viewer's own wonder: the camera glides to the city when it is out of view (not under
 * reduced motion), the gold pillar rises with the horn, then the story card opens. Other players' wonders have no city.
 */
function wonderTrack(payload: Extract<VisibleEvent['payload'], { type: 'LegendWonderCompleted' }>, view: PlayerView, key: string, finish: () => void): Track | null {
  if (payload.playerId !== view.playerId) return null;
  const cityId = view.expansion?.legends?.wonders.find(wonder => wonder.legendId === payload.legendId)?.cityId;
  const city = view.cities.find(item => item.id === cityId);
  if (!city) return null;
  const motion = !reducedMotion(), visible = onScreen([city.position], view);
  if (!motion && !visible) return null;
  let move: { from: Camera; to: Camera } | undefined;
  if (motion && !visible) {
    const width = canvas.clientWidth, height = canvas.clientHeight, p = tileToScreen(city.position, camera, view.map, width), zoom = Math.max(camera.zoom, 1.2);
    // The copy of the city nearest the view (wrapping maps), centred at the new zoom.
    const world = { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
    move = { from: { ...camera }, to: { x: width / 2 - world.x * zoom, y: height / 2 - world.y * zoom, zoom } };
    revealHome ??= { ...camera };
  }
  const reveal: { legendId: LegendWonderId; horn: boolean } = pendingReveal = { legendId: payload.legendId, horn: false };
  return wonderRevealTrack({ key, city: city.position, motion, ...(move ? { camera: move } : {}), onPillar: () => { reveal.horn = true; audio.play('wonder'); },
    onFinish: () => { finish(); pendingReveal = null; legendArrivals.push(payload.legendId); controls(); } });
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
    case 'ImprovementPillaged': return `文明 ${payload.playerId + 1} 掠夺了文明 ${payload.ownerId + 1} 的${IMPROVEMENTS[payload.kind].name}`;
    case 'ImprovementRepaired': return `文明 ${payload.playerId + 1} 修复了${IMPROVEMENTS[payload.kind].name}`;
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
    case 'EraAgeBegan': return payload.playerId === session.getView().playerId ? `进入${payload.heroic ? '英雄世代' : ERA_AGES[payload.age].name}（上个世代 ${payload.previousScore} 分 / ${payload.previousRounds} 轮）${payload.dedicationPicks ? `，选择 ${payload.dedicationPicks} 张时代献礼` : ''}` : '';
    case 'DedicationChosen': return `时代献礼：${payload.dedicationIds.map(id => DEDICATIONS[id].name).join('、')}`;
    case 'GovernmentChanged': return `采用体制「${GOVERNMENTS[payload.governmentId].name}」${payload.goldCost ? `（${payload.goldCost} 金）` : ''}${payload.droppedPolicies.length ? `，取下方针：${payload.droppedPolicies.map(id => POLICIES[id].name).join('、')}` : ''}`;
    case 'PoliciesChanged': return `方针更新：${payload.policyIds.map(id => POLICIES[id].name).join('、') || '无'}${payload.goldCost ? `（${payload.goldCost} 金）` : ''}`;
    case 'ChampionshipResolved': return leagueActivityText(session.getView(), payload.season);
    case 'DiscoveryMade': return `★ 图鉴发现「${discoveryText(payload.techId, Boolean(contentForView(session.getView()).opening)).name}」：${techOf(contentForView(session.getView()), payload.techId).name} +${payload.bonus}`;
    default: return '';
  }
}
// ---------- notifications (Civilization-style rail, notification-rail.ts) ----------
const rail = createNotificationRail(document.querySelector<HTMLElement>('#toast-host')!, target => {
  if (target.kind === 'screen') {
    openScreen(target.screen);
    // The league countdown points at the conference card of the world page.
    if (target.screen === 'world') { const card = document.querySelector<HTMLDetailsElement>('details[data-system="s27-championship"]'); if (card) { card.open = true; card.scrollIntoView({ block: 'nearest' }); } }
  }
  else if (target.kind === 'city') { closeScreen(); selectCity(target.cityId); }
  else { closeScreen(); selectUnit(target.unitId); }
});
/** Cities the viewer owned at the last refresh, so a city taken during the AI turns still reads as "yours". */
const knownOwnCityIds = new Set<number>();
const reviewedUnits = new ReviewedUnits();
/** The round whose league countdown notice was last considered. */
let countdownRound = -1;
/** Events that can change the music (mood or war intensity, music-director.ts). */
const MUSIC_EVENTS = new Set<string>(['DiplomacyChanged', 'GameEnded', 'BattleResolved', 'TurnChanged', 'WorldRampageStruckCity', 'RoundEnded']);
const warIntensity = new WarIntensity();
/** The GameEnded event has been presented (the ending theme starts with it, not with the final battle). */
let endingPresented = false;
/** Music follows the situation (A3 / A5): menu and opening, peace (drums forward when troops gather), war in layers, victory or defeat. */
function syncMusic() {
  if (!session) return;
  const view = session.getView();
  audio.setMood(musicMood(view, currentScreen() === 'menu', endingPresented || !busy()));
  audio.setIntensity(warIntensity.level(view));
}
/**
 * Sounds for a battle: the attack type's sound (A2) plus a rising arpeggio when super effective; city captured / lost;
 * an alarm when one of our cities is hit. When the battle is animated, the hit / knockdown sound plays on impact instead
 * (track cue). Nothing for strangers' fights off screen.
 */
function battleSounds(payload: BattlePayload, view: PlayerView, animated: boolean): SoundId[] {
  const me = view.playerId, involved = battleInvolvesViewer(payload, view);
  if (!involved && !onScreen(payload.positions, view)) return [];
  const look = battleLook(payload, view, knownUnits, knownCityOwners);
  const sounds: SoundId[] = [attackSound(look.attackType), ...((look.effectiveness ?? 100) > 100 ? ['superEffective' as const] : [])];
  const ownCity = payload.target.kind === 'city' && (knownOwnCityIds.has(payload.target.id) || knownCityOwners.get(payload.target.id) === me);
  if (!animated) sounds.push(payload.knockedDownUnitIds.length ? 'knockdown' : 'hit');
  if (payload.capturedCity && unitOwner(view, payload.attackerId) === me) sounds.push('cityCaptured');
  else if (payload.capturedCity && ownCity) sounds.push('cityLost');
  else if (ownCity) sounds.push('alarm');
  return sounds;
}
/** The effects for one presented event (only what the viewer did, or what happened to the viewer). `animated`: the event got a map track. */
export function soundsFor(payload: VisibleEvent['payload'], view: PlayerView, animated = false): SoundId[] {
  const me = view.playerId;
  const own = (playerId: number, id: SoundId): SoundId[] => playerId === me ? [id] : [];
  switch (payload.type) {
    case 'Moved': return payload.unit.ownerId === me ? ['move'] : [];
    case 'BattleResolved': return battleSounds(payload, view, animated);
    case 'Captured': return payload.playerId !== me ? [] : [payload.success ? 'capture' : 'captureFail'];
    case 'Evolved': case 'WorldStoneEvolution': return own(payload.playerId, 'evolve');
    case 'CityFounded': return own(payload.playerId, 'cityFounded');
    case 'BuildingCompleted': case 'DistrictCompleted': case 'UnitTrained': return own(payload.playerId, 'production');
    case 'TechCompleted': case 'DiscoveryMade': return own(payload.playerId, 'research');
    case 'TradeRouteEstablished': return own(payload.playerId, 'tradeRoute');
    case 'ObjectiveCompleted': case 'ItemBallClaimed': return own(payload.playerId, 'notify');
    case 'UnitPromoted': return own(payload.playerId, 'promotion');
    // V10: with the reveal track the horn sounds when the pillar rises (track cue) instead.
    case 'LegendWonderCompleted': return animated && payload.playerId === me ? [] : ['wonder'];
    case 'LegendWonderLost': return own(payload.playerId, 'legendLost');
    case 'LegendClueFound': return own(payload.playerId, 'notify');
    case 'EraAgeBegan': return own(payload.playerId, 'eraChange');
    case 'WeatherSummoned': return own(payload.playerId, 'weather');
    case 'EraAbilityUsed': return own(payload.playerId, 'formChange');
    case 'WildSpawned': case 'WorldNestSpawned': return ['alarm'];
    case 'WorldRampageStruckCity': return knownOwnCityIds.has(payload.cityId) ? ['alarm'] : [];
    case 'GameEnded': return payload.outcome.winners.includes(me) ? ['victory'] : ['defeat'];
    case 'DiplomacyChanged': return payload.relation.a !== me && payload.relation.b !== me ? [] : payload.relation.status === 'war' && payload.relation.changedAtRound >= view.round - 1 ? ['war'] : payload.relation.status === 'peace' && payload.relation.changedAtRound >= view.round - 1 ? ['peace'] : [];
    case 'TurnChanged': return payload.activePlayerId === me ? ['turn'] : [];
    case 'ChampionshipResolved': return [payload.playerId === me ? 'victory' : 'notify'];
    default: return [];
  }
}
function recordActivity(payload: VisibleEvent['payload'], animated = false) {
  for (const sound of soundsFor(payload, session.getView(), animated)) audio.play(sound);
  if (payload.type === 'GameEnded') endingPresented = true;
  if (payload.type === 'ChampionshipResolved') showLatestLeagueSeason();
  if (MUSIC_EVENTS.has(payload.type)) {
    const view = session.getView();
    warIntensity.observe(payload, view, () => payload.type === 'BattleResolved' && battleInvolvesViewer(payload, view),
      id => knownOwnCityIds.has(id) || knownCityOwners.get(id) === view.playerId);
    syncMusic();
  }
  // V10: an animated reveal opens the story card when its pillar ends (or on skip).
  if (payload.type === 'LegendWonderCompleted' && payload.playerId === session.getView().playerId && !animated) legendArrivals.push(payload.legendId);
  rail.push(toastFor(payload, session.getView(), { ownCityIds: knownOwnCityIds, unitName: id => knownUnitLabels.get(id)?.replace(/^(野生 |文明 \d+ 的 )/, '') }));
  const text = activityText(payload);
  if (!text || activityLog[0]?.text === text) return;
  activityLog.unshift({ text, round: session.getView().round, routine: payload.type === 'TurnChanged' || payload.type === 'Moved' });
  activityLog.splice(40);
}
// ---------- v26 §7.1 go-to orders (client waypoints, waypoints.ts) and §7.3 suggested city sites (city-sites.ts) ----------
// Orders are client state only: never commands, log entries or save data. They live in memory for the current game and are
// dropped on new game, load, replay and resume (a reload starts a new game, and a loaded save is an earlier position, so a
// stored order would point a different unit's past at a stale target; we chose not to keep them in session storage).
const goToOrders = new GoToOrders();
/** Choosing a waypoint for the selected unit (action bar 前往 / W); `goToHover` is the tile under the mouse. */
let goToMode = false;
let goToHover: number | null = null;
/** A settler that reached its waypoint this turn: the bar highlights 建城 (never founded automatically, as in Civilization). */
let arrivedUnitId: number | null = null;
let goToToastSerial = 1_000_000;
const planCache = new Map<string, GoToPlan | null>();
function cachedPlan(view: PlayerView, unitId: number, index: number): GoToPlan | null {
  const key = `${view.commandSeq}:${unitId}:${index}`;
  if (!planCache.has(key)) {
    if (planCache.size > 64) planCache.clear();
    planCache.set(key, planGoTo(view, unitId, indexToHex(index, view.map)));
  }
  return planCache.get(key)!;
}
function resetGoTo() { goToOrders.clear(); goToMode = false; goToHover = null; arrivedUnitId = null; planCache.clear(); siteCache = null; }
/** Units the to-do flow skips this round: the ones the end-turn button already showed, and those on a go-to order. */
function skippedUnits(view: PlayerView): ReadonlySet<number> { return new Set([...reviewedUnits.of(view.round), ...goToOrders.ids()]); }
const idleWithoutOrders = (view: PlayerView) => idleUnitIds(view).filter(id => !goToOrders.has(id));
/** The route drawn for the selected unit: a preview while choosing a waypoint, else its standing order. */
function goToRoute(view: PlayerView): SceneGoTo | null {
  if (selected === null || busy()) return null;
  const order = goToOrders.get(selected);
  const target = goToMode ? goToHover ?? keyboardIndex : order ? hexToIndex(order.target, view.map) : null;
  const plan = target === null ? null : cachedPlan(view, selected, target);
  return plan ? { path: plan.path.map(hex => hexToIndex(hex, view.map)!), stops: planStops(plan, view.map), preview: goToMode } : null;
}
function barGoTo(view: PlayerView): UnitBarGoTo | null {
  if (selected === null) return null;
  const order = goToOrders.get(selected), plan = order ? cachedPlan(view, selected, hexToIndex(order.target, view.map)!) : null;
  return { mode: goToMode, turns: order ? plan?.total ?? 1 : null, arrived: arrivedUnitId === selected };
}
let siteCache: { key: string; sites: CitySite[] } | null = null;
function selectedSites(view: PlayerView): CitySite[] {
  const unit = selected === null ? undefined : view.units.find(item => item.id === selected && item.ownerId === view.playerId);
  if (!unit || !isSettler(unit) || busy() || goToMode || view.outcome) return [];
  const key = `${view.commandSeq}:${unit.id}`;
  if (siteCache?.key !== key) siteCache = { key, sites: suggestCitySites(view, unit.id) };
  return siteCache.sites;
}
const sitePins = document.querySelector<HTMLElement>('#site-pins')!;
function updateSitePins(view: PlayerView) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderSitePins(sitePins, selectedSites(view).map(site => ({ site, point: tileToScreen(site.position, camera, view.map, width) })), { width, height },
    index => { if (selected !== null) setGoTo(selected, index, true); });
}
/** Sets (or, on the unit's own tile, clears) a go-to order and makes this round's first step at once. */
function setGoTo(unitId: number, index: number, site = false) {
  const view = session.getView();
  if (busy() || view.outcome || hasPendingPeace(view)) return;
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit) return;
  goToMode = false; goToHover = null;
  if (hexToIndex(unit.position, view.map) === index) {
    const cleared = goToOrders.cancel(unitId);
    notice = site && isSettler(unit) ? '开拓队就在这个推荐城址上：点「建城」（B）在此建立城市。' : cleared ? '路标已清除。' : '';
    controls(); requestFrame(); return;
  }
  const plan = goToOrders.set(view, unitId, indexToHex(index, view.map));
  if (!plan) {
    tapFeedback(index, 'error'); audio.play('error');
    notice = '到不了这个格子：已知地形上没有路线（未探索的格子按草原估算）。'; controls(); requestFrame(); return;
  }
  tapFeedback(index);
  if (arrivedUnitId === unitId) arrivedUnitId = null;
  notice = `已设路标${site ? '（推荐城址）' : ''}：约 ${plan.total} 轮到达，每回合开始时自动前进。`;
  runGoTo(new Set(), [unitId]);
  controls(); requestFrame();
}
/**
 * Carries out the go-to orders for this round with ordinary Move commands (animated as usual), then reports orders that
 * stopped. Runs at the start of the viewer's turn (after EndTurn returns) and when an order is set.
 */
function runGoTo(attacked: ReadonlySet<number>, only?: readonly number[]) {
  const view = session.getView();
  if (view.outcome || view.activePlayerId !== view.playerId || !goToOrders.size) return;
  const { moves, stops } = goToOrders.plan(view, attacked, only);
  const moved: number[] = [];
  for (const move of moves) {
    if (session.issue({ type: 'Move', unitId: move.unitId, to: move.to }).ok) moved.push(move.unitId);
    else { const found = goToOrders.get(move.unitId)?.found ?? false; goToOrders.cancel(move.unitId); stops.push({ unitId: move.unitId, reason: 'blocked', found }); }
  }
  stops.push(...goToOrders.afterMoves(session.getView(), moved));
  reportGoToStops(stops);
}
/** A settler that arrived with no moves left: at the start of the next turn it is selected with 建城 highlighted. */
function remindArrived() {
  const view = session.getView(), unit = view.units.find(item => item.id === arrivedUnitId && item.ownerId === view.playerId);
  if (!unit) { arrivedUnitId = null; return; }
  if (!unit.actionLeft || goToOrders.has(unit.id)) return;
  selectUnit(unit.id, false); deferredFocus = unit.position;
  notice = `${unitDefinition(unit, contentForView(view)).name}在路标处待命：点「建城」（B）在此建立城市。`;
}
function reportGoToStops(stops: readonly GoToStop[]) {
  if (!stops.length) return;
  const view = session.getView(), CONTENT = contentForView(view);
  const texts = stops.map(stop => {
    const unit = view.units.find(item => item.id === stop.unitId);
    const text = stopText(stop, unit ? unitDefinition(unit, CONTENT).name : knownUnitLabels.get(stop.unitId)?.replace(/^(野生 |文明 \d+ 的 )/, '') ?? '单位');
    rail.push({ id: ++goToToastSerial, tone: stop.reason === 'arrived' ? 'info' : 'war', icon: stop.reason === 'arrived' ? '⚑' : '!', title: stop.reason === 'arrived' ? '到达路标' : '路标中断',
      detail: text, target: unit ? { kind: 'unit', unitId: stop.unitId } : null, persistent: false, key: `goto:${stop.unitId}` });
    return text;
  });
  const arrived = stops.find(stop => stop.reason === 'arrived' && stop.found && view.units.some(unit => unit.id === stop.unitId));
  if (arrived) {
    arrivedUnitId = arrived.unitId;
    selectUnit(arrived.unitId, false);
    deferredFocus = view.units.find(unit => unit.id === arrived.unitId)!.position;
  }
  notice = texts.join(' ');
}

function controls() {
  panelsBusy = busy();
  const view = session.getView();
  const CONTENT = contentForView(view);
  const ended = view.outcome !== null, pendingPeace = hasPendingPeace(view);
  if (selected !== null && !view.units.some(unit => unit.id === selected && unit.ownerId === view.playerId)) {
    selected = null; resetAction();
  }
  if (selectedCity !== null && !view.economy.cities.some(city => city.id === selectedCity)) selectedCity = null;
  for (const unit of view.units) {
    knownUnitLabels.set(unit.id, `${unit.ownerId === null ? '野生 ' : `文明 ${unit.ownerId + 1} 的 `}${unitDefinition(unit, CONTENT).name}`);
    knownUnits.set(unit.id, unit);
  }
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
    : unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · ${goToOrders.has(unit.id) ? `路标约 ${barGoTo(view)?.turns ?? 1} 轮到达` : unit.actionLeft ? '点击高亮格直接移动，右键远处的格子设路标' : '本回合已行动'}`
    : selectedCity !== null ? `已选城市 ${selectedCity} · 在城市面板建造、训练或采购`
    : inspectedTile !== null ? `查看：${tileSummary(describeTile(view, inspectedTile))}`
    : '点选城市管理生产，点选单位执行行动，点任意地块查看详情；拖动地图平移，滚轮缩放。';
  actionNotice.textContent = notice || (pendingPeace ? '请先回应停战提议。' : districtPlacement ? '设施区选址：点击格子预览，再确认入队。Esc 取消。' : actionMode === 'attack' ? (targets.length ? `攻击模式：${targets.length} 个可攻击目标（红色虚线）。点目标看战斗预览，再点一次即攻击。Esc 取消。` : '攻击模式：射程内没有可攻击的目标（和平中的文明不能攻击）。Esc 取消。')
    : goToMode ? '前往模式：点击任意格子设路标（虚线是路线，圆圈数字是第几回合到达）。Esc 取消。'
    : actionMode === 'move' ? '移动模式：点击高亮格移动，包括己方城市。Esc 取消。'
    : actionMode === 'capture' ? (targets.length ? '捕捉模式：点相邻的野生宝可梦看捕捉率，再点一次即捕捉。Esc 取消。' : `捕捉模式：${selected === null ? '没有可捕捉目标。' : captureNoTargetReason(view, selected, selectedBall)} Esc 取消。`) : ended ? '对局已结束，可开始新局。' : '');
  actionNotice.classList.toggle('is-error', notice.includes('拒绝') || notice.includes('失败'));
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${driver.lastRejected ? JSON.stringify(driver.lastRejected) : '无'}${notice ? '\n' + notice : ''}`;
  sequence.max = String(driver.exportLog().commands.length);
  renderSelectionPanel(view, selected, selectedCity, { unit: selectUnit, city: selectCity, clear: clearSelection }, busy());
  const eraPanel = document.querySelector<HTMLElement>('#era-panel')!;
  eraPanel.innerHTML = renderEraPanel(view);
  bindEraPanel(eraPanel, view, issue, busy() || ended || pendingPeace);
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
      order: issue,
      skip: () => { if (selected !== null) reviewedUnits.add(session.getView().round, selected); cycleIdle('unit'); },
      explain: text => { notice = text; controls(); },
      goTo: () => { const choosing = !goToMode; resetAction(); goToMode = choosing; notice = ''; controls(); requestFrame(); },
      cancelGoTo: () => { if (selected !== null && goToOrders.cancel(selected)) { notice = '路标已取消。'; if (arrivedUnitId === selected) arrivedUnitId = null; } controls(); requestFrame(); },
    }, barGoTo(view));
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
  renderLeagueResult(view);
  renderBallStock(view, openBallShop);
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
  // Units on a go-to order are not waiting for orders (nor is the settler reminder about them).
  const reminders = turnReminders(view, CONTENT, skippedUnits(view)).filter(item => !(item.target.startsWith('unit:') && goToOrders.has(Number(item.target.slice(5)))));
  renderTurnButton(view, reminders, ended, pendingPeace);
  if (!busy()) {
    knownOwnCityIds.clear(); for (const city of view.economy.cities) knownOwnCityIds.add(city.id);
    for (const city of view.cities) knownCityOwners.set(city.id, city.ownerId);
  }
  // Playtest 2026-11 B1: the league countdown (5 rounds and 1 round before a season), once per round.
  if (!busy() && !ended && view.round !== countdownRound) { countdownRound = view.round; rail.push(leagueCountdownToast(view)); }
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
  } else selectUnit(cycleId(idleWithoutOrders(view), selected, step));
}
// ---------- end-turn state machine (turn-button.ts) ----------
const turnHint = document.querySelector<HTMLElement>('#turn-hint')!;
const unitCycle = [...document.querySelectorAll<HTMLButtonElement>('[data-cycle-unit]')];
let turnState: TurnStep | null = null;
function renderTurnButton(view: PlayerView, reminders: ReturnType<typeof turnReminders>, ended: boolean, pendingPeace: boolean) {
  turnState = ended ? null : turnStep(view, reminders, { unitId: selected, cityId: selectedCity }, skippedUnits(view));
  endTurn.disabled = busy() || ended || pendingPeace;
  endTurn.textContent = turnState?.label ?? `第 ${view.round} 轮 · 对局已结束`;
  endTurn.dataset.state = turnState?.kind ?? 'ended';
  endTurn.title = turnState && turnState.kind !== 'ready' ? '还有待办：点击前往。Shift+点击或 Ctrl/⌘+Enter 直接结束回合。' : '结束本回合（Ctrl/⌘+Enter）';
  turnHint.hidden = !turnState || turnState.kind === 'ready' || endTurn.disabled;
  const idle = idleWithoutOrders(view).length;
  for (const button of unitCycle) button.disabled = busy() || ended || pendingPeace || idle === 0;
}
/** End-turn button: a plain click goes to the first pending item; with nothing pending (or Shift held) it ends the turn. */
function onEndTurn(force: boolean) {
  if (busy() || !turnState) return;
  const step = turnState;
  if (force || step.kind === 'ready') { issue({ type: 'EndTurn' }); return; }
  audio.play('click');
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
/** U6: the top-bar ball stock opens the capital's 物资采购 tab. */
function openBallShop() {
  const view = session.getView(), city = view.economy.cities.find(item => item.id === view.economy.player.headquartersCityId) ?? view.economy.cities[0];
  if (!city) return;
  closeScreen(); selectCity(city.id);
  const economy = document.querySelector<HTMLElement>('#economy');
  if (economy) revealPanel(economy);
  document.querySelector<HTMLButtonElement>('#economy [data-city-section="supplies"]')?.click();
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
    // U5: a refused capture says why (not adjacent, not wild, no balls, ...).
    const target = action.type === 'Capture' ? view.units.find(unit => unit.id === action.targetUnitId) : undefined;
    const captureReason = action.type === 'Capture' ? (target ? captureTargetReason(view, action.unitId, hexToIndex(target.position, view.map)!, action.ballId) : '目标已不在视野内。') : null;
    notice = captureReason ? `无法捕捉：${captureReason}` : `${action.type} 被拒绝：${reason}`;
    audio.play('error');
  }
  else {
    notice = successNotice ?? '';
    // Any other order the player gives a unit replaces its go-to order.
    if ('unitId' in action && action.type !== 'PromoteUnit' && goToOrders.cancel(action.unitId) && arrivedUnitId === action.unitId) arrivedUnitId = null;
    if (action.type === 'EndTurn') {
      audio.play('endTurn');
      // The next turn starts with the go-to moves; units hit during the other players' turns stop instead.
      const attacked = new Set(session.presentationQueue.flatMap(event => event.payload.type === 'BattleResolved' && event.payload.target.kind === 'unit' ? [event.payload.target.id] : []));
      runGoTo(attacked);
      remindArrived();
    }
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
  const next = view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft && unit.id !== selected && !goToOrders.has(unit.id))
    .sort((a, b) => (origin ? hexDistance(origin, a.position, view.map) - hexDistance(origin, b.position, view.map) : 0) || a.id - b.id)[0];
  if (!next) return;
  // The camera moves on once the action's animation has played, so the player sees their own battle.
  selectUnit(next.id, false);
  deferredFocus = next.position;
  notice = `下一个待命单位：${next.kind === 'pokemon' ? contentForView(view).species[next.speciesId].name : '开拓队'}（还有 ${view.units.filter(unit => unit.ownerId === view.playerId && unit.actionLeft).length} 个单位待命）`;
}
/** P0-4: the floating combat preview beside the chosen attack target (follows the camera; hidden otherwise). */
function updateCombatCard(view: PlayerView) {
  const card = actionMode === 'attack' && pendingTarget && selected !== null ? combatCard(view, selected, pendingTarget) : null;
  const anchor = card && pendingTarget ? tileToScreen(indexToHex(pendingTarget.index, view.map), camera, view.map, canvas.clientWidth) : null;
  renderCombatCard(card, anchor, HEX_RADIUS * camera.zoom, busy() || view.outcome !== null || hasPendingPeace(view), {
    confirm: confirmAction,
    cancel: cancelTarget,
  });
}
/** Drops the chosen target (closing the combat card) but stays in the current action mode. */
/** Esc on the map: drop the chosen target, then leave the action mode, then clear the selection. */
function escapeAction() {
  if (pendingTarget) cancelTarget();
  else if (actionMode !== null || districtPlacement || goToMode) { resetAction(); notice = ''; controls(); requestFrame(); }
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
    arrival.querySelector('#legend-arrival-close')!.addEventListener('click', () => {
      legendArrivals.shift(); arrival.innerHTML = '';
      if (!legendArrivals.length) restoreRevealCamera();
      controls();
    });
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
  if (pendingReveal) { if (!pendingReveal.horn) audio.play('wonder'); legendArrivals.push(pendingReveal.legendId); pendingReveal = null; }
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
    const track = presentationTrack(event.payload);
    recordActivity(event.payload, track !== null);
    if (track) timeline.add(track, now);
    const payload = event.payload, battle = payload.type === 'BattleResolved' ? payload : null;
    const recorded = battle?.knockdowns?.find(record => !record.counter && record.source.id === battle.attackerId && record.target.kind !== 'city')?.effectiveness;
    presentationLog.push({ type: payload.type, animated: track !== null,
      ...(battle ? { effectiveness: battleLook(battle, session.getView(), knownUnits, knownCityOwners).effectiveness, ...(recorded !== undefined ? { recorded } : {}) } : {}) });
    if (presentationLog.length > 80) presentationLog.shift();
  }
  const view = session.getView();
  // V11: night and weather changes cross-fade (not with animation off or reduced motion: they switch at once).
  const fades = ambient.update(view);
  if (animate.checked && !reducedMotion()) for (const track of fades) timeline.add(track, now);
  if (deferredFocus && !busy()) focusHex(deferredFocus);
  const animation = timeline.sample(now, { unitPosition: id => view.units.find(unit => unit.id === id)?.position });
  // V10: the wonder reveal is the one track that moves the camera (restored when its story card closes).
  if (animation.camera) Object.assign(camera, animation.camera);
  lastAnimation = {
    effects: animation.effects.map(effect => ({ kind: effect.kind, progress: effect.progress,
      ...('color' in effect ? { color: effect.color } : {}), ...('text' in effect ? { text: effect.text, tone: effect.tone } : {}), ...('ownerId' in effect ? { ownerId: effect.ownerId } : {}),
      ...('label' in effect && effect.label ? { label: effect.label } : {}), ...('form' in effect ? { form: effect.form } : {}) })),
    poses: animation.poses.map(pose => ({ id: pose.unit.id, ...(pose.alpha !== undefined ? { alpha: pose.alpha } : {}), ...(pose.grey ? { grey: true } : {}), ...(pose.scale ? { scale: pose.scale } : {}) })),
    ...(animation.night !== undefined ? { night: animation.night } : {}), ...(animation.weather ? { weather: animation.weather.map(fade => ({ key: fade.key, alpha: fade.alpha })) } : {}) };
  const paths = selected === null ? {} : reachablePaths(view, selected);
  const targets = selected === null ? [] : actionTargets(view, selected, actionMode, selectedBall).map(target => hexToIndex(target.position, view.map)!);
  const drawStarted = performance.now();
  lastRenderStats = renderer.render({
    view: import.meta.env.DEV && god.checked ? developerAdapter.getDebugView() : view, camera, animation,
    selected, selectedCity, reachable: Object.keys(paths).map(Number), cursorIndex: keyboardIndex,
    actionMode, actionTargets: targets, pendingTargetIndex: pendingTarget?.index, inspectedTile,
    debugOverlay: import.meta.env.DEV ? document.querySelector<HTMLSelectElement>('#debug-overlay')!.value as DebugOverlay : 'none',
    districtPlacement: districtPlacement ? { sites: districtSites(view, districtPlacement.cityId, districtPlacement.kind), selectedTileIndex: districtPlacement.tileIndex } : undefined,
    goTo: goToRoute(view),
    layers: { yields: showYields.checked },
  });
  updateCombatCard(view);
  updateSitePins(view);
  frameDurations.push(performance.now() - drawStarted);
  if (frameDurations.length > 240) frameDurations.shift();
  if (import.meta.env.DEV) {
    const metrics = frameMetrics();
    frameMetricsElement.textContent = `帧绘制耗时（最近 ${metrics.samples} 帧）：${metrics.last.toFixed(2)} ms\n均值 ${metrics.mean.toFixed(2)} ms · p95 ${metrics.p95.toFixed(2)} ms · 最大 ${metrics.max.toFixed(2)} ms`;
  }
  // Drop fully presented events so the queue (and its per-frame copy) stays small in long games.
  if (!timeline.busy && presentationIndex > 0 && presentationIndex >= queue.length) { session.skipAnimations(); presentationIndex = 0; }
  if (busy()) requestFrame();
  else {
    // Panels refresh as soon as the queue drains (non-blocking pulses and fades may still be playing), and once more when they end.
    if (panelsBusy || !timeline.animating) controls();
    if (timeline.animating) requestFrame();
  }
}
/** Whether the panels were last drawn in the busy (animation playing) state. */
let panelsBusy = false;
const ambient = new AmbientTransitions();
/** New game, load, replay: no fades from the previous game, no war layers carried over, no reveal camera to restore. */
function resetPresentationState() {
  ambient.reset(); warIntensity.reset(); revealHome = null; pendingReveal = null; endingPresented = false; resetGoTo();
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
function resetAction() { actionMode = null; pendingTarget = null; districtPlacement = null; goToMode = false; goToHover = null; }
function clearSelection() {
  selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null;
  resetAction(); notice = ''; controls(); requestFrame();
}
/** A camera focus waiting for the presentation queue to drain (auto-advance to the next unit). */
let deferredFocus: Hex | null = null;
function focusHex(position: { q: number; r: number }) {
  deferredFocus = null;
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
/** The setup the new-game controls describe (also used for the v25 regional Pokédex summary before the game starts). */
function pendingSetup(): GameSetup {
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
    return { expansionVersion: 1, eraProgression, gameplayVersion: requestedGameplayVersion(), seed: Number(new URLSearchParams(location.search).get('seed') ?? '12345'), ...size,
      roundLimit: Number(document.querySelector<HTMLSelectElement>('#round-limit')!.value) as GameSetup['roundLimit'], players };
}
/** v25: "地区图鉴：48 种 · 水面 2 线 · 飞行 5 种" beside the start button, from the same pure draw as the game (public setup only). */
function renderDexSummary() {
  const root = document.querySelector<HTMLElement>('#regional-dex-summary');
  if (!root) return;
  const setup = pendingSetup();
  root.hidden = (setup.gameplayVersion ?? 0) < 25 || !setup.eraProgression;
  if (root.hidden) { root.innerHTML = ''; return; }
  root.innerHTML = dexSummaryMarkup(regionalDexDraw({ ...setup, eraProgression: setup.eraProgression! }), REGIONAL_CONTENT);
}
function newGame() {
  if (session && transitionBlocked()) return;
  try {
    driver = new GameSession(pendingSetup());
    session = driver.asPlayerSession();
    timeline.clear(); presenting.clear(); presentationIndex = 0; selected = null; selectedCity = session.getView().economy.player.headquartersCityId; neutralCity = null; inspectedTile = null; keyboardIndex = null; activityLog.length = 0; knownUnitLabels.clear(); knownUnits.clear(); knownCityOwners.clear(); deferredFocus = null;
    rail.clear(); countdownRound = -1; reviewedUnits.clear(); knownOwnCityIds.clear(); resetPresentationState();
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
  if (goToMode && selected !== null) { setGoTo(selected, index); return; }
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
    else {
      pendingTarget = null; tapFeedback(index, 'error');
      const why = actionMode === 'capture' ? captureTargetReason(view, selected, index, selectedBall) : null;
      notice = why ? `无法捕捉：${why}` : '该目标不适用；请选择高亮目标。';
    }
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
  if (`${index}:${selected}:${goToMode}` !== tooltipKey) {
    const preview = previewSummary(targetPreviews(view, selected, index));
    const route = goToMode && selected !== null ? cachedPlan(view, selected, index) : null;
    tooltip.textContent = tileSummary(describeTile(view, index)) + (preview ? ` · ${preview}` : '') + (goToMode && selected !== null ? route ? ` · 前往：约 ${route.total} 轮` : ' · 无法前往' : '');
    tooltipKey = `${index}:${selected}:${goToMode}`;
  }
  tooltip.hidden = false;
  const x = Math.min(point.x + 16, canvas.clientWidth - tooltip.offsetWidth - 8), y = point.y + 18 + tooltip.offsetHeight > canvas.clientHeight ? point.y - tooltip.offsetHeight - 10 : point.y + 18;
  tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}
canvas.addEventListener('pointerleave', hideTooltip);
canvas.addEventListener('pointermove', event => {
  updateTooltip(event);
  if (!drag && goToMode) {
    const index = hexToIndex(worldToHex(toWorld(localPoint(event), camera)), session.getView().map);
    if (index !== goToHover) { goToHover = index; requestFrame(); }
  }
  if (!drag && districtPlacement) {
    const index = hexToIndex(worldToHex(toWorld(localPoint(event), camera)), session.getView().map);
    if (index !== null && index !== districtPlacement.tileIndex) { districtPlacement.tileIndex = index; controls(); requestFrame(); }
  }
  if (!drag) return;
  const point = localPoint(event);
  if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
  if (drag.moved) {
    deferredFocus = null; camera.x += point.x - drag.last.x; camera.y += point.y - drag.last.y;
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
  event.preventDefault(); deferredFocus = null; zoomAt(camera, localPoint(event), Math.exp(-event.deltaY * .001)); requestFrame();
}, { passive: false });
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (busy() || selected === null) return;
  const view = session.getView(), hex = worldToHex(toWorld(localPoint(event), camera));
  const index = hexToIndex(hex, view.map);
  // The pointer may be over a copy across the v22 seam: commands always carry the canonical tile.
  if (index === null) return;
  if (reachablePaths(view, selected)[index]) issue({ type: 'Move', unitId: selected, to: indexToHex(index, view.map) });
  // v26 §7.1: right-click beyond this round's reach sets a go-to waypoint (Civilization-style).
  else if (view.units.some(unit => unit.id === selected && unit.ownerId === view.playerId)) setGoTo(selected, index);
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
    goToHover = null;
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
// v25: the summary follows the leader, era and opponent choices.
for (const type of ['change', 'click'] as const) document.querySelector('#controls')!.addEventListener(type, event => {
  if ((event.target as HTMLElement).closest('#regional-dex-summary')) return;
  renderDexSummary();
});
renderDexSummary();
document.querySelector('#fit')!.addEventListener('click', fit);
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(driver.exportLog(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `pokemon-${session.getView().seed}-commands.json`;
  link.click(); URL.revokeObjectURL(url);
});
document.querySelector('#replay')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  try { driver.replayTo(Number(sequence.value)); selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null; knownUnitLabels.clear(); knownUnits.clear(); knownCityOwners.clear(); deferredFocus = null; resetAction(); resetPresentationState(); notice = ''; skip(); }
  catch (error) { notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  if (transitionBlocked()) return;
  driver.resumeFromReplay(); resetGoTo(); selected = null; selectedCity = null; neutralCity = null; inspectedTile = null; keyboardIndex = null; knownUnitLabels.clear(); knownUnits.clear(); knownCityOwners.clear(); deferredFocus = null; resetAction(); controls(); requestFrame();
});
const saveKey = 'pokemon-civilization-save';
function load(text: string) {
  if (transitionBlocked()) return;
  driver.load(text); closeScreen(); timeline.clear(); presenting.clear(); selected = null; selectedCity = session.getView().economy.cities[0]?.id ?? null; neutralCity = null; inspectedTile = null; keyboardIndex = null; activityLog.length = 0; knownUnitLabels.clear(); knownUnits.clear(); knownCityOwners.clear(); deferredFocus = null; resetAction(); notice = '读档完成';
  rail.clear(); countdownRound = -1; reviewedUnits.clear(); knownOwnCityIds.clear(); resetPresentationState();
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
    if (!idleWithoutOrders(session.getView()).length) return;
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
// Every button clicks, except 下一回合: it plays the end-turn cue when the turn ends (or a click when it only points at a pending unit or city).
document.addEventListener('click', event => { const button = (event.target as HTMLElement).closest('button'); if (button && button !== endTurn) audio.play('click'); }, true);
// The map fills the stage; redraw when a screen closes so the canvas picks up any resize.
onScreenChange(screen => { rail.screenOpened(screen); syncMusic(); if (screen === null && session) requestFrame(); });
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
