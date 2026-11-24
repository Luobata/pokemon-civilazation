// Event presentation, animation timeline, battle/activity formatting, audio/music cues, and evolution/wonder reveals.
import type { PlayerSession } from '../../app/session.ts';
import { discoveryText } from '../../content/discoveries.ts';
import { ERA_ABILITIES, WEATHERS } from '../../content/era-abilities.ts';
import { ERA_AGES } from '../../content/era-honors.ts';
import { ESSENCES } from '../../content/essences.ts';
import { LEGENDS } from '../../content/faith-legends.ts';
import { IMPROVEMENTS } from '../../content/improvements.ts';
import type { LegendWonderId } from '../../content/legend-wonders.ts';
import { CITY_PROJECT_INFO } from '../../content/pace-v27.ts';
import { CHARTERS, GOVERNMENTS, POLICIES } from '../../content/policies.ts';
import { PROMOTION_TRAITS } from '../../content/promotions.ts';
import { RARE_BERRIES } from '../../content/rare-berries.ts';
import { stoneEvolutionsFor } from '../../content/roster.ts';
import { speciesDisplay } from '../../content/species.ts';
import type { SpeciesId, TypeId } from '../../content/species.ts';
import { TYPE_COLORS } from '../../content/type-colors.ts';
import { TYPE_NAMES } from '../../content/type-names.ts';
import { contentForView, techOf, unitDefinition } from '../../content/units.ts';
import type { Content } from '../../content/units.ts';
import { DEDICATIONS } from '../../content/dedications.ts';
import { hexDistance, indexToHex } from '../../core/hex.ts';
import type { Hex } from '../../core/hex.ts';
import type { PlayerView, VisibleEvent } from '../../core/model.ts';
import { evolutionOptions } from '../../core/roster.ts';
import { AmbientTransitions } from '../ambient-transitions.ts';
import { audio } from '../audio/index.ts';
import type { SoundId } from '../audio/index.ts';
import { attackSound } from '../audio/sfx.ts';
import { resetBattleLog } from '../battle-log.ts';
import { battleLook } from '../battle-presentation.ts';
import { clearReplays, recordChallengeResult } from '../battle-replay.ts';
import { closeBattleViewer } from '../battle-viewer.ts';
import { HEX_RADIUS } from '../camera.ts';
import type { Camera } from '../camera.ts';
import { challengeCardResult, closeChallengeCard } from '../challenge-card.ts';
import { cityProjectResultText } from '../city-projects-ui.ts';
import { bigEventTiles, bigEventTrack } from '../event-tracks.ts';
import { leagueActivityText, showLatestLeagueSeason } from '../league-card.ts';
import { legendTitle } from '../legend-panel.ts';
import { WarIntensity, musicMood } from '../music-director.ts';
import type { NotificationRail } from '../notification-rail.ts';
import { toastFor } from '../notifications.ts';
import { battleTrack, captureTrack, evolutionTrack, evolveTrack, moveTrack, tapTrack, wonderRevealTrack } from '../render/animation.ts';
import type { AnimationFrame, BattleSpec } from '../render/animation.ts';
import { Timeline } from '../render/index.ts';
import type { MapRenderer, RenderStats, Track } from '../render/index.ts';
import type { UnitMarkIdentity } from '../render/scene.ts';
import { currentScreen } from '../screens.ts';
import type { UIState } from './ui-state.ts';

export type BattlePayload = Extract<VisibleEvent['payload'], { type: 'BattleResolved' }>;
export type PresentedEvent = { type: string; animated: boolean; effectiveness?: number | null; recorded?: number };
export type AnimationSummary = {
  effects: { kind: string; color?: string; text?: string; tone?: string; ownerId?: number | null; label?: string; form?: string; progress: number }[];
  poses: { id: number; alpha?: number; grey?: boolean; scale?: number; evolution?: string; white?: number; speciesId?: string }[];
  night?: number;
  weather?: { key: string; alpha: number }[];
};

const MUSIC_EVENTS = new Set<string>(['DiplomacyChanged', 'GameEnded', 'BattleResolved', 'TurnChanged', 'WorldRampageStruckCity', 'RoundEnded']);

export const isEvolutionEdge = (content: Content, from: SpeciesId, to: SpeciesId) =>
  evolutionOptions(content, from).some(option => option.speciesId === to)
  || stoneEvolutionsFor(content).some(path => path.fromSpeciesId === from && path.intoSpeciesId === to)
  || content.species[from]?.evolution?.speciesId === to;

function preEvolution(content: Content, to: SpeciesId): SpeciesId | null {
  return (Object.keys(content.species) as SpeciesId[]).find(id => isEvolutionEdge(content, id, to)) ?? null;
}

/** The attacker and target of a battle as the log names them ("文明 1 的 小火龙", "野生 绿毛虫", "文明 2 的 城市 4"). */
export function battleSides(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, string>): { attacker: string; target: string } {
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
  return { attacker: unitLabel(payload.attackerId), target: targetLabel };
}

export function battleActivityText(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, string>): string {
  const { attacker, target: targetLabel } = battleSides(payload, view, known);
  const ownDown = payload.knockedDownUnitIds.some(id => view.recoveringUnits.some(unit => unit.id === id && unit.ownerId === view.playerId));
  const ownLost = payload.target.kind === 'unit' && !view.units.some(unit => unit.id === payload.target.id) && !view.recoveringUnits.some(unit => unit.id === payload.target.id)
    && known.get(payload.target.id)?.startsWith(`文明 ${view.playerId + 1} 的`);
  return `${attacker} 攻击了 ${targetLabel}：${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}${ownDown ? '（己方单位被击倒，回城休养）' : ownLost ? '（己方单位被击败）' : ''}`;
}

export type PresentationHost = {
  canvas: HTMLCanvasElement;
  renderer: MapRenderer;
  ui: UIState;
  rail: NotificationRail;
  getSession: () => PlayerSession | undefined;
  currentView: () => PlayerView;
  onLegendArrival: (legendId: LegendWonderId, refresh?: boolean) => void;
  onControls: () => void;
  onRequestFrame: () => void;
};

export class PresentationController {
  readonly timeline = new Timeline();
  readonly knownUnits = new Map<number, UnitMarkIdentity>();
  readonly knownUnitLabels = new Map<number, string>();
  readonly knownCityOwners = new Map<number, number | null>();
  readonly knownOwnCityIds = new Set<number>();
  private readonly presenting = new Map<string, VisibleEvent['payload']>();
  private readonly presentationLog: PresentedEvent[] = [];
  private readonly speciesChanges = new Map<number, { from: SpeciesId; to: SpeciesId }>();
  private readonly foreignEvolutions: { unitId: number; from: SpeciesId; to: SpeciesId }[] = [];
  private readonly ambient = new AmbientTransitions();
  private readonly warIntensity = new WarIntensity();
  private lastVisibleUnitIds = new Set<number>();
  private trackSerial = 0;
  private presentationIndex = 0;
  private revealHome: Camera | null = null;
  private pendingReveal: { legendId: LegendWonderId; horn: boolean } | null = null;
  private endingPresented = false;
  lastRenderStats: RenderStats | null = null;
  lastAnimation: AnimationSummary = { effects: [], poses: [] };
  panelsBusy = false;

  constructor(private readonly host: PresentationHost) {}

  reducedMotion(): boolean {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  isBusy(): boolean {
    const session = this.host.getSession();
    return this.timeline.busy || (session !== undefined && this.presentationIndex < session.presentationQueue.length);
  }

  getPresentationSnapshot() {
    return {
      render: this.lastRenderStats && { ...this.lastRenderStats, shake: { ...this.lastRenderStats.shake } },
      events: this.presentationLog.map(item => ({ ...item })),
      frame: {
        effects: this.lastAnimation.effects.map(item => ({ ...item })),
        poses: this.lastAnimation.poses.map(item => ({ ...item })),
        ...(this.lastAnimation.night !== undefined ? { night: this.lastAnimation.night } : {}),
        ...(this.lastAnimation.weather ? { weather: this.lastAnimation.weather.map(item => ({ ...item })) } : {}),
      },
    };
  }

  private unitOwner(view: PlayerView, id: number): number | null | undefined {
    const unit = view.units.find(item => item.id === id) ?? view.recoveringUnits.find(item => item.id === id);
    return unit ? unit.ownerId : this.knownUnits.get(id)?.ownerId;
  }

  private battleInvolvesViewer(payload: BattlePayload, view: PlayerView): boolean {
    if (this.unitOwner(view, payload.attackerId) === view.playerId) return true;
    return payload.target.kind === 'unit' ? this.unitOwner(view, payload.target.id) === view.playerId
      : this.knownOwnCityIds.has(payload.target.id) || this.knownCityOwners.get(payload.target.id) === view.playerId;
  }

  private eventTiles(payload: VisibleEvent['payload'], view: PlayerView): Hex[] {
    const at = (id: number) => view.units.find(unit => unit.id === id)?.position;
    switch (payload.type) {
      case 'Moved': return payload.path;
      case 'BattleResolved': return payload.positions;
      case 'Captured': return [at(payload.targetUnitId), at(payload.unitId)].filter((hex): hex is Hex => hex !== undefined);
      case 'Evolved': case 'WorldStoneEvolution': return [at(payload.unitId)].filter((hex): hex is Hex => hex !== undefined);
      default: return bigEventTiles(payload, view);
    }
  }

  onScreen(tiles: readonly Hex[], view: PlayerView): boolean {
    const { canvas, renderer, ui } = this.host;
    const width = canvas.clientWidth, height = canvas.clientHeight, margin = HEX_RADIUS * ui.camera.zoom;
    return tiles.some(hex => {
      const p = renderer.anchor(hex, ui.camera, view.map, width);
      return p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin;
    });
  }

  private ownAction(payload: VisibleEvent['payload'], view: PlayerView): boolean {
    switch (payload.type) {
      case 'Moved': return payload.unit.ownerId === view.playerId;
      case 'BattleResolved': return this.unitOwner(view, payload.attackerId) === view.playerId;
      case 'Captured': case 'Evolved': case 'WorldStoneEvolution': return payload.playerId === view.playerId;
      default: return false;
    }
  }

  private captureTiles(view: PlayerView, tile: number, ownerId: number | null): { hex: Hex; ring: number }[] {
    const city = indexToHex(tile, view.map);
    return view.territoryOwnerIds.flatMap((owners, index) => {
      if (index !== tile && (ownerId === null || !owners?.includes(ownerId))) return [];
      const hex = indexToHex(index, view.map), ring = hexDistance(city, hex, view.map);
      return ring <= 3 ? [{ hex, ring }] : [];
    });
  }

  private battleSpec(payload: BattlePayload, view: PlayerView, key: string, finish: () => void): BattleSpec {
    const look = battleLook(payload, view, this.knownUnits, this.knownCityOwners);
    const color = (type: TypeId | null) => type ? TYPE_COLORS[type] : undefined;
    const onImpact = (counter: boolean) => audio.play((counter ? look.attackerDown : look.targetDown) ? 'knockdown' : 'hit');
    return {
      key, attacker: payload.positions[0], target: payload.positions[1], damage: payload.damage, counterDamage: payload.counterDamage,
      map: view.map, motion: !this.reducedMotion(), ranged: look.ranged, effectiveness: look.effectiveness, onFinish: finish, onImpact,
      ...(color(look.attackType) ? { attackColor: color(look.attackType) } : {}),
      ...(color(look.counterType) ? { counterColor: color(look.counterType) } : {}),
      ...(look.attacker ? { attackerUnit: look.attacker } : {}),
      ...(look.target ? { targetUnit: look.target } : {}),
      ...(look.targetDown ? { targetDown: look.targetTag } : {}),
      ...(look.attackerDown ? { attackerDown: look.attackerTag } : {}),
      ...(look.city ? { capture: { tiles: this.captureTiles(view, look.city.tile, look.city.ownerId), ownerId: look.city.ownerId,
        ...(look.city.previousOwner !== undefined ? { previousOwner: look.city.previousOwner } : {}) } } : {}),
    };
  }

  private evolvedFrom(payload: Extract<VisibleEvent['payload'], { type: 'Evolved' | 'WorldStoneEvolution' }>): SpeciesId | null {
    return payload.type === 'WorldStoneEvolution' ? payload.fromSpeciesId
      : this.speciesChanges.get(payload.unitId)?.from ?? preEvolution(contentForView(this.host.currentView()), payload.speciesId);
  }

  private evolutionMoment(payload: Extract<VisibleEvent['payload'], { type: 'Evolved' | 'WorldStoneEvolution' }>, view: PlayerView, key: string, finish: () => void): Track {
    const to = payload.type === 'Evolved' ? payload.speciesId : payload.intoSpeciesId, from = this.evolvedFrom(payload);
    const unit = view.units.find(item => item.id === payload.unitId);
    if (!unit || !from) return evolveTrack(key, payload.unitId, finish);
    return evolutionTrack({ key, unit, from, to, position: unit.position, motion: !this.reducedMotion(), onFinish: finish,
      ...(payload.playerId === view.playerId ? { onReveal: () => audio.play('evolveFanfare') } : {}) });
  }

  restoreRevealCamera(): void {
    if (!this.revealHome) return;
    Object.assign(this.host.ui.camera, this.revealHome);
    this.revealHome = null;
    this.host.onRequestFrame();
  }

  private wonderTrack(payload: Extract<VisibleEvent['payload'], { type: 'LegendWonderCompleted' }>, view: PlayerView, key: string, finish: () => void): Track | null {
    if (payload.playerId !== view.playerId) return null;
    const cityId = view.expansion?.legends?.wonders.find(wonder => wonder.legendId === payload.legendId)?.cityId;
    const city = view.cities.find(item => item.id === cityId);
    if (!city) return null;
    const motion = !this.reducedMotion(), visible = this.onScreen([city.position], view);
    if (!motion && !visible) return null;
    const { canvas, renderer, ui } = this.host;
    let move: { from: Camera; to: Camera } | undefined;
    if (motion && !visible) {
      const width = canvas.clientWidth, height = canvas.clientHeight, p = renderer.anchor(city.position, ui.camera, view.map, width), zoom = Math.max(ui.camera.zoom, 1.2);
      const world = { x: (p.x - ui.camera.x) / ui.camera.zoom, y: (p.y - ui.camera.y) / ui.camera.zoom };
      move = { from: { ...ui.camera }, to: { x: width / 2 - world.x * zoom, y: height / 2 - world.y * zoom, zoom } };
      this.revealHome ??= { ...ui.camera };
    }
    const reveal: { legendId: LegendWonderId; horn: boolean } = this.pendingReveal = { legendId: payload.legendId, horn: false };
    return wonderRevealTrack({
      key, city: city.position, motion, ...(move ? { camera: move } : {}),
      onPillar: () => { reveal.horn = true; audio.play('wonder'); },
      onFinish: () => { finish(); this.pendingReveal = null; this.host.onLegendArrival(payload.legendId, true); },
    });
  }

  private summary(payload: VisibleEvent['payload']): string {
    switch (payload.type) {
      case 'BattleResolved': {
        const view = this.host.currentView(), sides = battleSides(payload, view, this.knownUnitLabels);
        const own = (label: string) => label.replace(`文明 ${view.playerId + 1} 的 `, '你的');
        return `${own(sides.attacker)} 攻击 ${own(sides.target)}：造成 ${payload.damage} 伤害${payload.counterDamage ? `，反击 ${payload.counterDamage}` : ''}${payload.knockedDownUnitIds.length ? '，有单位被击倒/回城休养' : ''}。`;
      }
      case 'Captured': return payload.success ? `捕捉成功（${payload.probability}%）。` : `捕捉失败（${payload.probability}%），目标激怒。`;
      case 'Evolved': case 'WorldStoneEvolution': {
        const to = payload.type === 'Evolved' ? payload.speciesId : payload.intoSpeciesId, from = this.evolvedFrom(payload);
        return `进化完成：${speciesDisplay(to).name}。${from ? `恭喜！${speciesDisplay(from).name}进化成了${speciesDisplay(to).name}！` : ''}`;
      }
      default: return '';
    }
  }

  private activityText(payload: VisibleEvent['payload']): string {
    const view = this.host.currentView();
    switch (payload.type) {
      case 'TurnChanged': return `文明 ${payload.activePlayerId + 1} 开始行动`;
      case 'Moved': return `${payload.unit.ownerId === null ? '野生' : `文明 ${payload.unit.ownerId + 1}`}单位移动`;
      case 'BattleResolved': return battleActivityText(payload, view, this.knownUnitLabels);
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
      case 'UnitPromoted': {
        const unit = view.units.find(item => item.id === payload.unitId);
        return `${unit && unit.kind === 'pokemon' ? (contentForView(view).species[unit.speciesId]?.name ?? '宝可梦') : '宝可梦'}晋升：获得特性「${PROMOTION_TRAITS[payload.trait].name}」（第 ${payload.rank} 次）`;
      }
      case 'LegendClueFound': return payload.playerId === view.playerId ? `发现传说线索：${legendTitle(payload.legendId)}（剧情第一章，打开「传说」查看）` : '';
      case 'LegendWonderCompleted': return payload.playerId === view.playerId ? `★ 建成传说奇观：${legendTitle(payload.legendId)}` : `文明 ${payload.playerId + 1} 建成了传说奇观：${legendTitle(payload.legendId)}`;
      case 'LegendWonderLost': return payload.playerId === view.playerId ? `${legendTitle(payload.legendId)} 已被他人建成，城市 ${payload.cityId} 的工程作废，退还 ${payload.refund} 金${payload.trail ? `，传说踪迹 ${payload.trail} 生产留给下一座传说` : ''}` : '';
      case 'CityProjectCompleted': return payload.playerId === view.playerId ? `城市 ${payload.cityId} 完成计划「${CITY_PROJECT_INFO[payload.projectId].name}」（第 ${payload.nth} 次）：${cityProjectResultText(payload, contentForView(view))}` : '';
      case 'EraAgeBegan': return payload.playerId === view.playerId ? `进入${payload.heroic ? '英雄时代' : ERA_AGES[payload.age].name}（上个世代 ${payload.previousScore} 分 / ${payload.previousRounds} 轮）${payload.dedicationPicks ? `，选择 ${payload.dedicationPicks} 张时代献礼` : ''}` : '';
      case 'DedicationChosen': return `时代献礼：${payload.dedicationIds.map(id => DEDICATIONS[id].name).join('、')}`;
      case 'GovernmentChanged': return `采用体制「${GOVERNMENTS[payload.governmentId].name}」${payload.goldCost ? `（${payload.goldCost} 金）` : ''}${payload.droppedPolicies.length ? `，取下方针：${payload.droppedPolicies.map(id => POLICIES[id].name).join('、')}` : ''}`;
      case 'PoliciesChanged': return `方针更新：${payload.policyIds.map(id => POLICIES[id].name).join('、') || '无'}${payload.goldCost ? `（${payload.goldCost} 金）` : ''}`;
      case 'ChampionshipResolved': return leagueActivityText(view, payload.season);
      case 'DiscoveryMade': return `★ 图鉴发现「${discoveryText(payload.techId).name}」：${techOf(contentForView(view), payload.techId).name} +${payload.bonus}`;
      default: return '';
    }
  }

  private battleSounds(payload: BattlePayload, view: PlayerView, animated: boolean): SoundId[] {
    const me = view.playerId, involved = this.battleInvolvesViewer(payload, view);
    if (!involved && !this.onScreen(payload.positions, view)) return [];
    const look = battleLook(payload, view, this.knownUnits, this.knownCityOwners);
    const sounds: SoundId[] = [attackSound(look.attackType), ...((look.effectiveness ?? 100) > 100 ? ['superEffective' as const] : [])];
    const ownCity = payload.target.kind === 'city' && (this.knownOwnCityIds.has(payload.target.id) || this.knownCityOwners.get(payload.target.id) === me);
    if (!animated) sounds.push(payload.knockedDownUnitIds.length ? 'knockdown' : 'hit');
    if (payload.capturedCity && this.unitOwner(view, payload.attackerId) === me) sounds.push('cityCaptured');
    else if (payload.capturedCity && ownCity) sounds.push('cityLost');
    else if (ownCity) sounds.push('alarm');
    return sounds;
  }

  soundsFor(payload: VisibleEvent['payload'], view: PlayerView, animated = false): SoundId[] {
    const me = view.playerId;
    const own = (playerId: number, id: SoundId): SoundId[] => playerId === me ? [id] : [];
    switch (payload.type) {
      case 'Moved': return payload.unit.ownerId === me ? ['move'] : [];
      case 'BattleResolved': return this.battleSounds(payload, view, animated);
      case 'Captured': return payload.playerId !== me ? [] : [payload.success ? 'capture' : 'captureFail'];
      case 'Evolved': case 'WorldStoneEvolution': return own(payload.playerId, 'evolve');
      case 'CityFounded': return own(payload.playerId, 'cityFounded');
      case 'BuildingCompleted': case 'DistrictCompleted': case 'UnitTrained': case 'CityProjectCompleted': return own(payload.playerId, 'production');
      case 'TechCompleted': case 'DiscoveryMade': return own(payload.playerId, 'research');
      case 'TradeRouteEstablished': return own(payload.playerId, 'tradeRoute');
      case 'ObjectiveCompleted': case 'ItemBallClaimed': return own(payload.playerId, 'notify');
      case 'UnitPromoted': return own(payload.playerId, 'promotion');
      case 'LegendWonderCompleted': return animated && payload.playerId === me ? [] : ['wonder'];
      case 'LegendWonderLost': return own(payload.playerId, 'legendLost');
      case 'LegendClueFound': return own(payload.playerId, 'notify');
      case 'EraAgeBegan': return own(payload.playerId, 'eraChange');
      case 'WeatherSummoned': return own(payload.playerId, 'weather');
      case 'EraAbilityUsed': case 'RaidDynamaxed': return own(payload.playerId, 'formChange');
      case 'WildSpawned': case 'WorldNestSpawned': return ['alarm'];
      case 'WorldRampageStruckCity': return this.knownOwnCityIds.has(payload.cityId) ? ['alarm'] : [];
      case 'GameEnded': return payload.outcome.winners.includes(me) ? ['victory'] : ['defeat'];
      case 'DiplomacyChanged': return payload.relation.a !== me && payload.relation.b !== me ? [] : payload.relation.status === 'war' && payload.relation.changedAtRound >= view.round - 1 ? ['war'] : payload.relation.status === 'peace' && payload.relation.changedAtRound >= view.round - 1 ? ['peace'] : [];
      case 'TurnChanged': return payload.activePlayerId === me ? ['turn'] : [];
      case 'ChampionshipResolved': return [payload.playerId === me ? 'victory' : 'notify'];
      default: return [];
    }
  }

  syncMusic(): void {
    if (!this.host.getSession()) return;
    const view = this.host.currentView();
    audio.setMood(musicMood(view, currentScreen() === 'menu', this.endingPresented || !this.isBusy()));
    audio.setIntensity(this.warIntensity.level(view));
  }

  private presentationTrack(payload: VisibleEvent['payload']): Track | null {
    const view = this.host.currentView();
    if (!this.ownAction(payload, view) && this.eventTiles(payload, view).length && !this.onScreen(this.eventTiles(payload, view), view)) {
      this.host.ui.notice = this.summary(payload) || this.host.ui.notice;
      return null;
    }
    const key = `${payload.type}:${this.trackSerial++}`;
    let track: Track | null = null;
    const finish = () => { this.host.ui.notice = this.summary(payload) || this.host.ui.notice; this.presenting.delete(track!.key); };
    if (payload.type === 'Moved') track = moveTrack(payload.unit, payload.path, finish, view.map);
    else if (payload.type === 'BattleResolved') track = battleTrack(this.battleSpec(payload, view, key, finish));
    else if (payload.type === 'Captured') track = captureTrack(key, payload.targetUnitId, payload.success, finish);
    else if (payload.type === 'Evolved' || payload.type === 'WorldStoneEvolution') track = this.evolutionMoment(payload, view, key, finish);
    else if (payload.type === 'LegendWonderCompleted') track = this.wonderTrack(payload, view, key, finish);
    else track = bigEventTrack(payload, view, key, { motion: !this.reducedMotion(), onFinish: finish });
    if (track && track.blocking !== false) this.presenting.set(track.key, payload);
    return track;
  }

  recordActivity(payload: VisibleEvent['payload'], animated = false): void {
    const view = this.host.currentView();
    for (const sound of this.soundsFor(payload, view, animated)) audio.play(sound);
    if (payload.type === 'GameEnded') this.endingPresented = true;
    if (payload.type === 'ChampionshipResolved') showLatestLeagueSeason();
    if (MUSIC_EVENTS.has(payload.type)) {
      this.warIntensity.observe(payload, view, () => payload.type === 'BattleResolved' && this.battleInvolvesViewer(payload, view),
        id => this.knownOwnCityIds.has(id) || this.knownCityOwners.get(id) === view.playerId);
      this.syncMusic();
    }
    if (payload.type === 'LegendWonderCompleted' && payload.playerId === view.playerId && !animated) this.host.onLegendArrival(payload.legendId);
    const replayKey = recordChallengeResult(view, payload);
    if (payload.type === 'GuardianChallenged' || payload.type === 'EliteFourChallenged') {
      if (payload.playerId === view.playerId) challengeCardResult(view, {
        key: replayKey, victory: payload.victory,
        text: payload.type === 'GuardianChallenged' ? payload.victory ? '击败了守卫！' : '挑战失败' : payload.victory ? '战胜了四天王与冠军！' : `止步第 ${payload.reached + 1} 场`,
      });
    }
    this.host.rail.push(toastFor(payload, view, { ownCityIds: this.knownOwnCityIds, unitName: id => this.knownUnitLabels.get(id)?.replace(/^(野生 |文明 \d+ 的 )/, '') }));
    const text = this.activityText(payload);
    if (!text || this.host.ui.activityLog[0]?.text === text) return;
    this.host.ui.activityLog.unshift({ text, round: view.round, routine: payload.type === 'TurnChanged' || payload.type === 'Moved' });
    this.host.ui.activityLog.splice(40);
  }

  noteVisibleUnits(view: PlayerView, content: Content): void {
    for (const unit of view.units) {
      const known = this.knownUnits.get(unit.id);
      if (known && known.kind === 'pokemon' && unit.kind === 'pokemon' && known.speciesId !== unit.speciesId && known.ownerId === unit.ownerId && isEvolutionEdge(content, known.speciesId, unit.speciesId)) {
        this.speciesChanges.set(unit.id, { from: known.speciesId, to: unit.speciesId });
        if (this.speciesChanges.size > 64) this.speciesChanges.delete(this.speciesChanges.keys().next().value!);
        if (unit.ownerId !== view.playerId && this.lastVisibleUnitIds.has(unit.id) && this.foreignEvolutions.length < 6) {
          this.foreignEvolutions.push({ unitId: unit.id, from: known.speciesId, to: unit.speciesId });
        }
      }
      this.knownUnitLabels.set(unit.id, `${unit.ownerId === null ? '野生 ' : `文明 ${unit.ownerId + 1} 的 `}${unitDefinition(unit, content).name}`);
      this.knownUnits.set(unit.id, unit);
    }
    this.lastVisibleUnitIds = new Set(view.units.map(unit => unit.id));
  }

  syncIdleCityMemory(view: PlayerView): void {
    this.knownOwnCityIds.clear();
    for (const city of view.economy.cities) this.knownOwnCityIds.add(city.id);
    for (const city of view.cities) this.knownCityOwners.set(city.id, city.ownerId);
  }

  tapFeedback(index: number, tone: 'ok' | 'error', animateChecked: boolean): void {
    if (!animateChecked || this.reducedMotion()) return;
    this.timeline.add(tapTrack(indexToHex(index, this.host.currentView().map), tone), performance.now());
  }

  finishPresentations(): void {
    const session = this.host.getSession();
    if (!session) return;
    const pending = session.presentationQueue.slice(this.presentationIndex);
    for (const event of pending) this.recordActivity(event.payload);
    const payloads = [...this.presenting.values(), ...pending.map(event => event.payload)];
    const text = payloads.map(item => this.summary(item)).filter(Boolean).at(-1);
    if (text) this.host.ui.notice = text;
    this.timeline.clear();
    this.presenting.clear();
    this.foreignEvolutions.length = 0;
    if (this.pendingReveal) {
      if (!this.pendingReveal.horn) audio.play('wonder');
      const legendId = this.pendingReveal.legendId;
      this.pendingReveal = null;
      this.host.onLegendArrival(legendId);
    }
    this.presentationIndex = 0;
    session.skipAnimations();
  }

  advanceAndSample(now: number, animateChecked: boolean): { animation: AnimationFrame; queueLength: number } {
    if (!animateChecked) this.finishPresentations();
    this.timeline.advance(now);
    const session = this.host.getSession()!;
    const queue = session.presentationQueue;
    while (!this.timeline.busy && this.presentationIndex < queue.length) {
      const event = queue[this.presentationIndex++]!;
      const track = this.presentationTrack(event.payload);
      this.recordActivity(event.payload, track !== null);
      if (track) this.timeline.add(track, now);
      const payload = event.payload, battle = payload.type === 'BattleResolved' ? payload : null;
      const recorded = battle?.knockdowns?.find(record => !record.counter && record.source.id === battle.attackerId && record.target.kind !== 'city')?.effectiveness;
      this.presentationLog.push({
        type: payload.type, animated: track !== null,
        ...(battle ? { effectiveness: battleLook(battle, this.host.currentView(), this.knownUnits, this.knownCityOwners).effectiveness, ...(recorded !== undefined ? { recorded } : {}) } : {}),
      });
      if (this.presentationLog.length > 80) this.presentationLog.shift();
    }
    if (!this.timeline.busy && this.presentationIndex >= queue.length && this.foreignEvolutions.length) {
      const next = this.foreignEvolutions.shift()!, current = this.host.currentView(), unit = current.units.find(item => item.id === next.unitId);
      const shown = Boolean(unit && unit.kind === 'pokemon' && unit.speciesId === next.to && this.onScreen([unit.position], current));
      if (shown) this.timeline.add(evolutionTrack({ key: `ForeignEvolution:${this.trackSerial++}`, unit: unit!, from: next.from, to: next.to, position: unit!.position, motion: !this.reducedMotion() }), now);
      this.presentationLog.push({ type: 'ForeignEvolution', animated: shown });
      if (this.presentationLog.length > 80) this.presentationLog.shift();
    }
    const view = this.host.currentView();
    const fades = this.ambient.update(view);
    if (animateChecked && !this.reducedMotion()) for (const track of fades) this.timeline.add(track, now);
    const animation = this.timeline.sample(now, { unitPosition: id => view.units.find(unit => unit.id === id)?.position });
    if (animation.camera) Object.assign(this.host.ui.camera, animation.camera);
    this.lastAnimation = {
      effects: animation.effects.map(effect => ({
        kind: effect.kind, progress: effect.progress,
        ...('color' in effect ? { color: effect.color } : {}),
        ...('text' in effect ? { text: effect.text, tone: effect.tone } : {}),
        ...('ownerId' in effect ? { ownerId: effect.ownerId } : {}),
        ...('label' in effect && effect.label ? { label: effect.label } : {}),
        ...('form' in effect ? { form: effect.form } : {}),
      })),
      poses: animation.poses.map(pose => ({
        id: pose.unit.id,
        ...(pose.alpha !== undefined ? { alpha: pose.alpha } : {}),
        ...(pose.grey ? { grey: true } : {}),
        ...(pose.scale ? { scale: pose.scale } : {}),
        ...(pose.evolution ? { evolution: pose.evolution.form, white: pose.evolution.white, ...(pose.unit.kind === 'pokemon' ? { speciesId: pose.unit.speciesId } : {}) } : {}),
      })),
      ...(animation.night !== undefined ? { night: animation.night } : {}),
      ...(animation.weather ? { weather: animation.weather.map(fade => ({ key: fade.key, alpha: fade.alpha })) } : {}),
    };
    return { animation, queueLength: queue.length };
  }

  afterFrame(queueLength: number): void {
    const session = this.host.getSession()!;
    if (!this.timeline.busy && this.presentationIndex > 0 && this.presentationIndex >= queueLength) {
      session.skipAnimations();
      this.presentationIndex = 0;
    }
    if (this.isBusy()) this.host.onRequestFrame();
    else {
      if (this.panelsBusy || !this.timeline.animating) this.host.onControls();
      if (this.timeline.animating) this.host.onRequestFrame();
    }
  }

  reset(clearSessionLog = false): void {
    this.timeline.clear();
    this.presenting.clear();
    this.presentationIndex = 0;
    this.ambient.reset();
    this.warIntensity.reset();
    this.revealHome = null;
    this.pendingReveal = null;
    this.endingPresented = false;
    this.speciesChanges.clear();
    this.foreignEvolutions.length = 0;
    clearReplays();
    resetBattleLog();
    closeBattleViewer();
    closeChallengeCard();
    if (clearSessionLog) {
      this.host.ui.activityLog.length = 0;
      this.knownUnitLabels.clear();
      this.knownUnits.clear();
      this.knownCityOwners.clear();
      this.knownOwnCityIds.clear();
    }
  }

  clearMemories(): void {
    this.knownUnitLabels.clear();
    this.knownUnits.clear();
    this.knownCityOwners.clear();
  }
}
