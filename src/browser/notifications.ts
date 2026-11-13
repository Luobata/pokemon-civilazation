import { IMPROVEMENTS } from '../content/improvements.ts';
import { pillageRewardLabel } from '../core/pillage.ts';
import { hexDistance } from '../core/hex.ts';
// Civilization-style notifications for the viewer's own milestones and threats (research, production, growth,
// wonders, war, knocked-out units, attacked cities). Pure description from the PlayerView; the notification rail
// (notification-rail.ts) shows them and main.ts decides what a click does.
// `persistent` notifications ask for a decision or report a threat: they stay until handled, resolved or dismissed.
// The rest are informational and fade on their own once the player has control again.
import { ITEM_BALLS, OBJECTIVES } from '../content/opening.ts';
import { discoveryText } from '../content/discoveries.ts';
import { ROLE_POKEMON } from '../content/roles.ts';
import { ESCORT_BONUSES } from '../content/city-network.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { contentForView, techOf } from '../content/units.ts';
import { DISTRICTS } from '../content/districts.ts';
import { ERA_AGES } from '../content/era-honors.ts';
import { DEDICATION_RULES } from '../content/dedications.ts';
import { PROMOTION_TRAITS } from '../content/promotions.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import { researchTaskToast } from './research-card.ts';
import { ESSENCES } from '../content/essences.ts';
import { GYM_LEADERS } from '../content/gym-circuit.ts';
import { rivalSays } from './gym-panel.ts';
import { leagueCountdown, leagueSummary } from './league-card.ts';
import { depthToast } from './late-game-ui.ts';

export type ToastTarget = { kind: 'screen'; screen: 'research' | 'legends' | 'era' | 'diplomacy' | 'world' | 'log' } | { kind: 'city'; cityId: number } | { kind: 'unit'; unitId: number } | null;
export type ToastTone = 'research' | 'production' | 'growth' | 'wonder' | 'war' | 'info';
/** When a persistent notification has been handled without clicking it (the player made the choice elsewhere). */
export type ToastResolve = { kind: 'research' } | { kind: 'city-queued'; cityId: number } | { kind: 'peace-answered'; otherId: number }
  | { kind: 'unit-recovered'; unitId: number } | { kind: 'dedication' };
export type Toast = { id: number; tone: ToastTone; icon: string; title: string; detail: string; action?: string; target: ToastTarget;
  persistent: boolean; resolve?: ToastResolve; /** A newer notification with the same key replaces the older one. */ key?: string;
  /** Playtest 2026-11 U8: a strategic event (war, a city lost or taken, a legend clue, the rival, the league, a wonder lost) is drawn apart from routine pings. */
  strategic?: true };
type ToastOptions = { persistent?: boolean; resolve?: ToastResolve; key?: string };
/** Marks a toast as a strategic event (null stays null). */
const strategic = (item: Toast | null): Toast | null => item && { ...item, strategic: true };
/** What the client remembers from before the events (cities the viewer owned, names of units that are gone). */
export type ToastMemory = { ownCityIds?: ReadonlySet<number>; unitName?: (unitId: number) => string | undefined };

let serial = 0;
const toast = (tone: ToastTone, icon: string, title: string, detail: string, target: ToastTarget, action?: string, options: ToastOptions = {}): Toast =>
  ({ id: ++serial, tone, icon, title, detail, target, ...(action ? { action } : {}), persistent: options.persistent ?? false,
    ...(options.resolve ? { resolve: options.resolve } : {}), ...(options.key ? { key: options.key } : {}) });
/** Options for a notification that waits for the player. */
const decision = (resolve?: ToastResolve, key?: string): ToastOptions => ({ persistent: true, ...(resolve ? { resolve } : {}), ...(key ? { key } : {}) });

/** The toast for one presented event, or null when it is not a personal milestone. */
export function toastFor(payload: VisibleEvent['payload'], view: PlayerView, memory: ToastMemory = {}): Toast | null {
  const me = view.playerId, content = contentForView(view);
  const ownCity = (cityId: number) => view.economy.cities.some(city => city.id === cityId);
  const idle = (cityId: number) => view.economy.cities.find(city => city.id === cityId)?.queue.length === 0;
  const produced = (cityId: number) => idle(cityId) ? decision({ kind: 'city-queued', cityId }) : {};
  switch (payload.type) {
    case 'TechCompleted': {
      if (payload.playerId !== me) return null;
      const choose = view.economy.player.research.techId === null;
      return toast('research', '⚗', `研究完成：${techOf(content, payload.techId).name}`, choose ? '选择下一项研究。' : '已自动继续下一项研究。',
        { kind: 'screen', screen: 'research' }, choose ? '选择研究' : '查看', choose ? decision({ kind: 'research' }, 'choose-research') : {});
    }
    case 'BuildingCompleted':
      if (payload.playerId !== me) return null;
      return toast('production', '🏛', `城市 ${payload.cityId} 建成：${content.buildings[payload.definitionId].name}`, idle(payload.cityId) ? '生产队列空了，选择下一项。' : '队列继续生产下一项。',
        { kind: 'city', cityId: payload.cityId }, idle(payload.cityId) ? '选择生产' : '查看城市', produced(payload.cityId));
    case 'DistrictCompleted':
      if (payload.playerId !== me) return null;
      return toast('production', '▣', `城市 ${payload.cityId} 建成设施区：${DISTRICTS[payload.kind].name}`, idle(payload.cityId) ? '生产队列空了，选择下一项。' : '队列继续生产下一项。',
        { kind: 'city', cityId: payload.cityId }, idle(payload.cityId) ? '选择生产' : '查看城市', produced(payload.cityId));
    case 'UnitTrained': {
      if (payload.playerId !== me) return null;
      const unit = payload.unit, name = unit.kind === 'pokemon' ? content.species[unit.speciesId].name : `${ROLE_POKEMON[unit.role].unitName}（${ROLE_POKEMON[unit.role].species}）`;
      const hint = unit.kind === 'pokemon' ? '新单位已在城市旁出场。' : { settler: '选中它，去建立新城市。', builder: '选中它，到己方地块上修建改良。', trader: '选中它，走到另一座己方城市旁开通商路。' }[unit.role];
      return toast('production', '★', `城市 ${payload.cityId} 训练完成：${name}`, hint,
        { kind: 'unit', unitId: unit.id }, '选中', decision());
    }
    case 'ProductionWaiting':
      if (payload.playerId !== me) return null;
      return toast('production', '⏸', `城市 ${payload.cityId} 的单位等待出场`, '城市周围没有空位，腾出相邻格子即可出场。', { kind: 'city', cityId: payload.cityId }, '查看城市',
        decision(undefined, `waiting:${payload.cityId}`));
    case 'CityFounded':
      if (payload.playerId !== me) return null;
      return toast('growth', '⚑', `建立了城市 ${payload.cityId}`, '为新城市选择第一项生产。', { kind: 'city', cityId: payload.cityId }, '选择生产',
        decision({ kind: 'city-queued', cityId: payload.cityId }));
    case 'CityFoodSettled':
      if (payload.playerId !== me || payload.populationAfter === payload.populationBefore || !ownCity(payload.cityId)) return null;
      return payload.populationAfter > payload.populationBefore
        ? toast('growth', '↑', `城市 ${payload.cityId} 人口增长到 ${payload.populationAfter}`, '新居民会自动耕作最好的地块。', { kind: 'city', cityId: payload.cityId }, '查看城市')
        : toast('war', '↓', `城市 ${payload.cityId} 饥荒，人口降到 ${payload.populationAfter}`, '食物不足：调整耕作地块或减少维护。', { kind: 'city', cityId: payload.cityId }, '查看城市',
          decision(undefined, `famine:${payload.cityId}`));
    case 'DiscoveryMade':
      if (payload.playerId !== me) return null;
      return toast('research', '✦', `图鉴发现「${discoveryText(payload.techId, Boolean(content.opening)).name}」`, `${techOf(content, payload.techId).name} 研究进度 +${payload.bonus}。`, { kind: 'screen', screen: 'research' }, '查看');
    case 'EraAgeBegan':
      if (payload.playerId !== me) return null;
      // v22: the new era asks for dedication cards; the notification stays until they are chosen.
      if (payload.dedicationPicks) return toast(payload.age === 'dark' ? 'war' : 'wonder', '◷', `进入${payload.heroic ? '英雄世代' : ERA_AGES[payload.age].name}`,
        `选择 ${payload.dedicationPicks} 张时代献礼。${payload.age === 'golden' ? DEDICATION_RULES.goldenDescription : ERA_AGES[payload.age].description}`, { kind: 'screen', screen: 'era' }, '选择献礼',
        decision({ kind: 'dedication' }, 'choose-dedication'));
      return toast(payload.age === 'dark' ? 'war' : 'wonder', '◷', `进入${ERA_AGES[payload.age].name}`, ERA_AGES[payload.age].description, { kind: 'screen', screen: 'era' }, '查看时代', decision());
    case 'UnitPromoted':
      if (payload.playerId !== me) return null;
      return toast('info', '⌃', `晋升：获得特性「${PROMOTION_TRAITS[payload.trait].name}」`, PROMOTION_TRAITS[payload.trait].summary, { kind: 'unit', unitId: payload.unitId }, '选中');
    case 'LegendClueFound':
      if (payload.playerId !== me) return null;
      return strategic(toast('wonder', '✧', `传说线索：${LEGEND_WONDERS[payload.legendId].name}`, `剧情第一章已解锁。可以在合适的城市建造「${LEGEND_WONDERS[payload.legendId].wonderName}」。`, { kind: 'screen', screen: 'legends' }, '查看传说', decision()));
    case 'LegendWonderCompleted':
      return payload.playerId === me ? null // the full-screen story card covers it
        : toast('wonder', '♛', `文明 ${payload.playerId + 1} 建成了「${LEGEND_WONDERS[payload.legendId].wonderName}」`, `${LEGEND_WONDERS[payload.legendId].name} 的奇观已被他人建成。`, { kind: 'screen', screen: 'legends' }, '查看传说');
    case 'LegendWonderLost':
      if (payload.playerId !== me) return null;
      return strategic(toast('war', '✕', `「${LEGEND_WONDERS[payload.legendId].wonderName}」被别人抢先建成`, `城市 ${payload.cityId} 的工程作废，退还 ${payload.refund} 金。`, { kind: 'city', cityId: payload.cityId }, '选择生产',
        idle(payload.cityId) ? produced(payload.cityId) : decision()));
    case 'DiplomacyChanged': {
      const relation = payload.relation;
      if (relation.a !== me && relation.b !== me) return null;
      const other = relation.a === me ? relation.b : relation.a;
      if (relation.proposal && relation.proposal.recipientId === me) return toast('info', '✉', `文明 ${other + 1} 提议停战`, '在外交页面接受或拒绝。', { kind: 'screen', screen: 'diplomacy' }, '外交',
        decision({ kind: 'peace-answered', otherId: other }, `peace:${other}`));
      if (relation.status === 'war' && relation.changedAtRound >= view.round - 1 && relation.declaredBy !== me) return strategic(toast('war', '⚔', `文明 ${other + 1} 向你宣战！`, '保护城市和开拓队。', { kind: 'screen', screen: 'diplomacy' }, '外交',
        decision(undefined, `war:${other}`)));
      return null;
    }
    case 'ImprovementPillaged': {
      if (payload.ownerId !== me && payload.playerId !== me) return null;
      const name = IMPROVEMENTS[payload.kind].name;
      if (payload.playerId === me) return toast('war', '⚔', `掠夺了${name}`, pillageRewardLabel(payload.reward), payload.reward.cityId !== undefined ? { kind: 'city', cityId: payload.reward.cityId } : null);
      const city = [...view.economy.cities].sort((a, b) => hexDistance(a.position, payload.position, view.map) - hexDistance(b.position, payload.position, view.map) || a.id - b.id)[0];
      return toast('war', '⚔', `你的${name}被文明 ${payload.playerId + 1} 掠夺`, '改良已损坏，不再产出；派工匠站上去修复（不消耗次数）。', city ? { kind: 'city', cityId: city.id } : null, city ? '查看城市' : undefined);
    }
    case 'EscortBonus':
      if (payload.playerId !== me) return null;
      return toast('growth', '✚', `随行的${content.species[payload.escortId].name}帮了新城一把`, ESCORT_BONUSES[payload.kind].label, { kind: 'city', cityId: payload.cityId }, '查看城市');
    case 'TradeRouteEstablished':
      if (payload.playerId !== me) return null;
      return toast('production', '⇄', `商路开通：城市 ${payload.fromCityId} → 城市 ${payload.toCityId}`, '目的城 食物 +2、生产 +1，出发城 金币 +3。', { kind: 'city', cityId: payload.toCityId }, '查看城市');
    case 'TradeRouteLost': {
      if (payload.playerId !== me) return null;
      const kept = ownCity(payload.fromCityId) ? payload.fromCityId : ownCity(payload.toCityId) ? payload.toCityId : null;
      return toast('war', '✕', `商路中断：城市 ${payload.fromCityId} ↔ 城市 ${payload.toCityId}`, '其中一座城市已经易主。', kept === null ? null : { kind: 'city', cityId: kept }, '查看城市',
        decision(undefined, `route:${payload.fromCityId}:${payload.toCityId}`));
    }
    case 'ObjectiveCompleted': {
      if (payload.playerId !== me) return null;
      const objective = OBJECTIVES[payload.objectiveId], reward = objective.reward;
      return toast('growth', '✔', `目标达成：${objective.name}`, [reward.gold ? `金币 +${reward.gold}` : '', reward.research ? `科研 +${reward.research}` : '', reward.pokeBalls ? `精灵球 +${reward.pokeBalls}` : ''].filter(Boolean).join('，'), null,
        undefined, decision());
    }
    case 'ResearchTaskCompleted': {
      if (payload.playerId !== me) return null;
      const note = researchTaskToast(payload, view, content);
      // One rail item for all research progress: each completion replaces the previous one (no pile-up next to objectives).
      return toast('research', '◎', note.title, note.detail, null, undefined, { key: 'research-task' });
    }
    case 'ItemBallClaimed':
      if (payload.playerId !== me) return null;
      return toast('growth', '◓', `捡到道具球：${ITEM_BALLS[payload.kind].name}`, ITEM_BALLS[payload.kind].text, null);
    case 'UnitRecovering': {
      if (payload.playerId !== me) return null;
      const unit = view.recoveringUnits.find(item => item.id === payload.unitId);
      const name = unit?.kind === 'pokemon' ? content.species[unit.speciesId].name : memory.unitName?.(payload.unitId) ?? '己方宝可梦';
      return toast('war', '✖', `${name}被击倒`, `回到城市 ${payload.cityId} 休养，${payload.roundsLeft} 轮后归队。`, { kind: 'city', cityId: payload.cityId }, '查看城市',
        decision({ kind: 'unit-recovered', unitId: payload.unitId }));
    }
    // v24 B: gym circuit and Elite Four (public events: only the viewer's own are notified).
    case 'GymChallenged': {
      if (payload.playerId !== me) return null;
      const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === payload.gymId);
      const name = gym ? `${ESSENCES[gym.essence].name}徽章` : '徽章';
      return payload.victory
        ? toast('growth', '◆', `你赢得了${name}（第 ${payload.badges} 枚）`, `${gym ? `${GYM_LEADERS[gym.leader].name}：` : ''}队伍战力 ${payload.teamPower} 对馆主 ${payload.leaderPower}，${payload.battle.rounds.length} 回合获胜。`, null, undefined, decision())
        : toast('war', '◇', `道馆挑战失败${gym ? `：${GYM_LEADERS[gym.leader].name}` : ''}`, `队伍战力 ${payload.teamPower} 对馆主 ${payload.leaderPower}。宝可梦恢复后 3 轮可再挑战。`, null);
    }
    case 'EliteFourChallenged':
      if (payload.playerId !== me) return null;
      return payload.victory ? toast('wonder', '♛', '你战胜了四天王与冠军！', '冠军赛头衔 +1、金币 +100。', null, undefined, decision())
        : toast('war', '♚', `四天王挑战止步第 ${payload.reached + 1} 场`, '10 轮后可以再挑战。', null);
    // v24 C: the own rival (these events reach only their target).
    case 'RivalAnnounced':
      return toast('war', '!', `劲敌${view.expansion?.rivals?.name ?? ''}将在第 ${payload.round} 轮出现`, `目标：${view.economy.player.headquartersCityId === payload.cityId ? '首都' : `城市 ${payload.cityId}`}。地图上的红色“!”是它的登场地点。`,
        { kind: 'city', cityId: payload.cityId }, '查看城市', decision(undefined, 'rival-warning'));
    case 'RivalArrived':
      return strategic(toast('war', '!', `劲敌${view.expansion?.rivals?.name ?? ''}登场！`, `“${rivalSays(payload.encounter, 'arrive')}” 劲敌气势 ${payload.spirit >= 0 ? '+' : ''}${payload.spirit}。`,
        payload.unitIds.length ? { kind: 'unit', unitId: payload.unitIds[0] } : null, '查看', decision(undefined, 'rival-warning')));
    case 'RivalStruckCity':
      return toast('war', '⚔', `劲敌攻击城市 ${payload.cityId}`, `造成 ${payload.damage} 伤害，城防剩余 ${payload.cityHpAfter}（劲敌不会把城市打到 1 HP 以下）。`, { kind: 'city', cityId: payload.cityId }, '查看城市',
        decision(undefined, `city-attacked:${payload.cityId}`));
    case 'RivalDefeated':
      return toast('growth', '★', `击退了劲敌${view.expansion?.rivals?.name ?? ''}！`, `“${rivalSays(payload.encounter, 'beaten')}” 金币 +${payload.gold}${payload.pokeBalls ? `、精灵球 +${payload.pokeBalls}` : ''}${payload.research ? `、科研 +${payload.research}` : ''}${payload.xpUnitIds.length ? `、${payload.xpUnitIds.length} 只参战宝可梦经验 +50` : ''}。`, null, undefined, decision());
    case 'RivalDeparted':
      return toast('info', '…', `劲敌${view.expansion?.rivals?.name ?? ''}离开了`, `“${rivalSays(payload.encounter, 'leave')}”`, null);
    case 'BattleResolved': return battleToast(payload, view, memory);
    // Playtest 2026-11 B1: the league conference result (public; the card is on the 动态 screen).
    case 'ChampionshipResolved': {
      const note = leagueSummary(view, payload.season);
      return strategic(toast(note.own === 'champion' ? 'wonder' : 'info', '♚', note.title, note.detail, { kind: 'screen', screen: 'log' }, '查看对阵',
        decision(undefined, `league:${payload.season.season}`)));
    }
    case 'CivilizationEliminated':
      return strategic(toast('war', '☠', `文明 ${payload.eliminatedPlayerId + 1} 出局`, '', null));
    default: {
      // v26 late game: contest seasons, raids, the near-victory warning, the legend race, the opening gift (late-game-ui.ts).
      const note = depthToast(payload, view);
      if (!note) return null;
      const item = toast(note.tone, note.icon, note.title, note.detail, note.target, note.action, note.persistent ? decision(undefined, note.key) : { ...(note.key ? { key: note.key } : {}) });
      return note.strategic ? strategic(item) : item;
    }
  }
}

/** Playtest 2026-11 B1: the notice 5 rounds and 1 round before a league season (null on other rounds). */
export function leagueCountdownToast(view: PlayerView): Toast | null {
  const note = leagueCountdown(view);
  return note && toast('info', '♚', note.title, note.detail, { kind: 'screen', screen: 'world' }, note.registered ? '查看' : '去报名', { key: 'league-countdown' });
}

/** Battles that hurt the viewer: an own city attacked or taken, an own settler/builder/trader defeated. Knocked-out Pokémon are `UnitRecovering`. */
function battleToast(payload: Extract<VisibleEvent['payload'], { type: 'BattleResolved' }>, view: PlayerView, memory: ToastMemory): Toast | null {
  const me = view.playerId;
  const attacker = view.units.find(unit => unit.id === payload.attackerId) ?? view.recoveringUnits.find(unit => unit.id === payload.attackerId);
  // U8: a city the viewer takes is a strategic event too.
  if (attacker?.ownerId === me) return payload.target.kind === 'city' && payload.capturedCity && view.economy.cities.some(city => city.id === payload.target.id)
    ? strategic(toast('growth', '⚑', `攻占了城市 ${payload.target.id}！`, '它现在是你的城市：为它选择生产。', { kind: 'city', cityId: payload.target.id }, '查看城市', decision({ kind: 'city-queued', cityId: payload.target.id })))
    : null;
  const by = attacker === undefined ? '敌方单位' : attacker.ownerId === null ? '野生宝可梦' : `文明 ${attacker.ownerId + 1}`;
  if (payload.target.kind === 'city') {
    const cityId = payload.target.id, ownsNow = view.economy.cities.some(city => city.id === cityId);
    if (!ownsNow && !memory.ownCityIds?.has(cityId)) return null;
    if (payload.capturedCity && !ownsNow) return strategic(toast('war', '⚑', `城市 ${cityId} 被攻占！`, `${by}夺走了这座城市。`, null, undefined, decision(undefined, `city-lost:${cityId}`)));
    const hp = view.combat.cities[cityId]?.hp;
    return toast('war', '⚔', `城市 ${cityId} 遭到攻击`, `${by}造成 ${payload.damage} 伤害${hp === undefined ? '' : `，城防剩余 ${hp}`}。`, { kind: 'city', cityId }, '查看城市',
      decision(undefined, `city-attacked:${cityId}`));
  }
  const lost = (payload.knockdowns ?? []).find(record => record.target.ownerId === me && record.target.kind === 'logistics');
  if (!lost) return null;
  return toast('war', '✖', `${memory.unitName?.(lost.target.id) ?? '己方职能单位'}被击败`, `${by}击败了它；职能单位被击败后不会回城休养。`, null, undefined, decision());
}

/** True once a persistent notification no longer needs the player (the choice was made elsewhere, the unit is gone). */
export function toastResolved(item: Toast, view: PlayerView): boolean {
  const resolve = item.resolve;
  if (resolve?.kind === 'research') return view.economy.player.research.techId !== null;
  if (resolve?.kind === 'city-queued') { const city = view.economy.cities.find(candidate => candidate.id === resolve.cityId); return !city || city.queue.length > 0; }
  if (resolve?.kind === 'peace-answered') return !view.diplomacy.some(pair => pair.proposal?.recipientId === view.playerId && pair.proposal.proposerId === resolve.otherId);
  if (resolve?.kind === 'dedication') return !view.expansion?.eraHonors?.dedication?.pending;
  if (resolve?.kind === 'unit-recovered') return !view.recoveringUnits.some(unit => unit.id === resolve.unitId);
  const target = item.target;
  return target?.kind === 'unit' && !view.units.some(unit => unit.id === target.unitId);
}
