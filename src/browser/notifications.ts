// Civilization-style notifications: a short toast stack for the viewer's own milestones (research, production,
// growth, wonders, war). Pure description from the PlayerView; main.ts decides what a click does.
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { contentForView } from '../content/units.ts';
import { DISTRICTS } from '../content/districts.ts';
import { ERA_AGES } from '../content/era-honors.ts';
import { DISCOVERIES } from '../content/discoveries.ts';
import { PROMOTION_TRAITS } from '../content/promotions.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';

export type ToastTarget = { kind: 'screen'; screen: 'research' | 'legends' | 'era' | 'diplomacy' } | { kind: 'city'; cityId: number } | { kind: 'unit'; unitId: number } | null;
export type ToastTone = 'research' | 'production' | 'growth' | 'wonder' | 'war' | 'info';
export type Toast = { id: number; tone: ToastTone; icon: string; title: string; detail: string; action?: string; target: ToastTarget };

let serial = 0;
const toast = (tone: ToastTone, icon: string, title: string, detail: string, target: ToastTarget, action?: string): Toast =>
  ({ id: ++serial, tone, icon, title, detail, target, ...(action ? { action } : {}) });

/** The toast for one presented event, or null when it is not a personal milestone. */
export function toastFor(payload: VisibleEvent['payload'], view: PlayerView): Toast | null {
  const me = view.playerId, content = contentForView(view);
  const ownCity = (cityId: number) => view.economy.cities.some(city => city.id === cityId);
  const idle = (cityId: number) => view.economy.cities.find(city => city.id === cityId)?.queue.length === 0;
  switch (payload.type) {
    case 'TechCompleted':
      if (payload.playerId !== me) return null;
      return toast('research', '⚗', `研究完成：${content.techs[payload.techId].name}`, view.economy.player.research.techId === null ? '选择下一项研究。' : '已自动继续下一项研究。',
        { kind: 'screen', screen: 'research' }, view.economy.player.research.techId === null ? '选择研究' : '查看');
    case 'BuildingCompleted':
      if (payload.playerId !== me) return null;
      return toast('production', '🏛', `城市 ${payload.cityId} 建成：${content.buildings[payload.definitionId].name}`, idle(payload.cityId) ? '生产队列空了，选择下一项。' : '队列继续生产下一项。',
        { kind: 'city', cityId: payload.cityId }, idle(payload.cityId) ? '选择生产' : '查看城市');
    case 'DistrictCompleted':
      if (payload.playerId !== me) return null;
      return toast('production', '▣', `城市 ${payload.cityId} 建成设施区：${DISTRICTS[payload.kind].name}`, idle(payload.cityId) ? '生产队列空了，选择下一项。' : '队列继续生产下一项。',
        { kind: 'city', cityId: payload.cityId }, idle(payload.cityId) ? '选择生产' : '查看城市');
    case 'UnitTrained': {
      if (payload.playerId !== me) return null;
      const unit = payload.unit, name = unit.kind === 'pokemon' ? content.species[unit.speciesId].name : '开拓队';
      return toast('production', '★', `城市 ${payload.cityId} 训练完成：${name}`, unit.kind === 'logistics' ? '开拓队已出发，选中它去建立新城市。' : '新单位已在城市旁出场。',
        { kind: 'unit', unitId: unit.id }, '选中');
    }
    case 'ProductionWaiting':
      if (payload.playerId !== me) return null;
      return toast('production', '⏸', `城市 ${payload.cityId} 的单位等待出场`, '城市周围没有空位，腾出相邻格子即可出场。', { kind: 'city', cityId: payload.cityId }, '查看城市');
    case 'CityFounded':
      if (payload.playerId !== me) return null;
      return toast('growth', '⚑', `建立了城市 ${payload.cityId}`, '为新城市选择第一项生产。', { kind: 'city', cityId: payload.cityId }, '选择生产');
    case 'CityFoodSettled':
      if (payload.playerId !== me || payload.populationAfter === payload.populationBefore || !ownCity(payload.cityId)) return null;
      return payload.populationAfter > payload.populationBefore
        ? toast('growth', '↑', `城市 ${payload.cityId} 人口增长到 ${payload.populationAfter}`, '新居民会自动耕作最好的地块。', { kind: 'city', cityId: payload.cityId }, '查看城市')
        : toast('war', '↓', `城市 ${payload.cityId} 饥荒，人口降到 ${payload.populationAfter}`, '食物不足：调整耕作地块或减少维护。', { kind: 'city', cityId: payload.cityId }, '查看城市');
    case 'DiscoveryMade':
      if (payload.playerId !== me) return null;
      return toast('research', '✦', `图鉴发现「${DISCOVERIES[payload.techId].name}」`, `${content.techs[payload.techId].name} 研究进度 +${payload.bonus}。`, { kind: 'screen', screen: 'research' }, '查看');
    case 'EraAgeBegan':
      if (payload.playerId !== me) return null;
      return toast(payload.age === 'dark' ? 'war' : 'wonder', '◷', `进入${ERA_AGES[payload.age].name}`, ERA_AGES[payload.age].description, { kind: 'screen', screen: 'era' }, '查看时代');
    case 'UnitPromoted':
      if (payload.playerId !== me) return null;
      return toast('info', '⌃', `晋升：获得特性「${PROMOTION_TRAITS[payload.trait].name}」`, PROMOTION_TRAITS[payload.trait].summary, { kind: 'unit', unitId: payload.unitId }, '选中');
    case 'LegendClueFound':
      if (payload.playerId !== me) return null;
      return toast('wonder', '✧', `传说线索：${LEGEND_WONDERS[payload.legendId].name}`, `剧情第一章已解锁。可以在合适的城市建造「${LEGEND_WONDERS[payload.legendId].wonderName}」。`, { kind: 'screen', screen: 'legends' }, '查看传说');
    case 'LegendWonderCompleted':
      return payload.playerId === me ? null // the full-screen story card covers it
        : toast('wonder', '♛', `文明 ${payload.playerId + 1} 建成了「${LEGEND_WONDERS[payload.legendId].wonderName}」`, `${LEGEND_WONDERS[payload.legendId].name} 的奇观已被他人建成。`, { kind: 'screen', screen: 'legends' }, '查看传说');
    case 'LegendWonderLost':
      if (payload.playerId !== me) return null;
      return toast('war', '✕', `「${LEGEND_WONDERS[payload.legendId].wonderName}」被别人抢先建成`, `城市 ${payload.cityId} 的工程作废，退还 ${payload.refund} 金。`, { kind: 'city', cityId: payload.cityId }, '选择生产');
    case 'DiplomacyChanged': {
      const relation = payload.relation;
      if (relation.a !== me && relation.b !== me) return null;
      const other = relation.a === me ? relation.b : relation.a;
      if (relation.proposal && relation.proposal.recipientId === me) return toast('info', '✉', `文明 ${other + 1} 提议停战`, '在外交页面接受或拒绝。', { kind: 'screen', screen: 'diplomacy' }, '外交');
      if (relation.status === 'war' && relation.changedAtRound === view.round && relation.declaredBy !== me) return toast('war', '⚔', `文明 ${other + 1} 向你宣战！`, '保护城市和开拓队。', { kind: 'screen', screen: 'diplomacy' }, '外交');
      return null;
    }
    case 'CivilizationEliminated':
      return toast('war', '☠', `文明 ${payload.eliminatedPlayerId + 1} 出局`, '', null);
    default: return null;
  }
}

export function toastMarkup(toasts: readonly Toast[]): string {
  return toasts.map(item => `<div class="toast toast-${item.tone}" data-toast="${item.id}" role="status">
    <span class="toast-icon" aria-hidden="true">${item.icon}</span><div class="toast-body"><strong>${item.title}</strong>${item.detail ? `<small>${item.detail}</small>` : ''}</div>
    ${item.target && item.action ? `<button type="button" class="toast-action" data-toast-action="${item.id}">${item.action}</button>` : ''}
    <button type="button" class="toast-close" data-toast-close="${item.id}" aria-label="关闭">×</button></div>`).join('');
}
