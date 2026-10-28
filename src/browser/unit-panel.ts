import { CONTENT, unitDefinition } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import type { CombatTarget, PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';

export type ActionMode = 'attack' | 'capture' | null;
export type PendingTarget = CombatTarget & { index: number };
type Callbacks = {
  mode: (mode: ActionMode) => void;
  confirm: () => void;
  cancel: () => void;
  evolve: () => void;
  ball: (ballId: BallId) => void;
};

export function renderUnitPanel(view: PlayerView, selected: number | null, mode: ActionMode,
  target: PendingTarget | null, ballId: BallId, busy: boolean, callbacks: Callbacks): void {
  const root = document.querySelector<HTMLElement>('#unit-panel')!;
  const unit = view.units.find(unit => unit.id === selected && unit.ownerId === view.playerId);
  if (!unit || unit.kind !== 'pokemon') { root.innerHTML = ''; return; }
  const definition = unitDefinition(unit, CONTENT), species = CONTENT.species[unit.speciesId];
  const evolution = species.evolution;
  const targetUnit = target?.kind === 'unit' ? view.units.find(unit => unit.id === target.id) : null;
  const targetLabel = targetUnit
    ? targetUnit.kind === 'pokemon' ? CONTENT.species[targetUnit.speciesId].name : '开拓队'
    : target ? `城市 ${target.id}` : null;
  const attackPreview = mode === 'attack' && target ? previewAttack(view, unit.id, { kind: target.kind, id: target.id }) : null;
  const capturePreview = mode === 'capture' && target ? previewCapture(view, unit.id, target.id, ballId) : null;
  const reasonText = (reason: string) => ({ 'at-peace': '未处于战争状态', 'out-of-range': '超出射程', 'attack-unavailable': '当前不可攻击', 'capture-unavailable': '当前不可捕捉' })[reason] ?? reason;
  const attackText = attackPreview
    ? attackPreview.ok
      ? `预计伤害 ${attackPreview.damage.min}–${attackPreview.damage.max}；${attackPreview.counter.trigger === 'never' ? '无反击' : `${attackPreview.counter.trigger === 'always' ? '预计反击' : '可能反击'} ${attackPreview.counter.damage}`}；击坠：${attackPreview.knockdown === 'guaranteed' ? '必定' : attackPreview.knockdown === 'possible' ? '可能' : '无'}`
      : `不可攻击：${reasonText(attackPreview.reason)}`
    : '选择红色虚线目标查看伤害、反击与击坠。';
  const captureText = capturePreview
    ? capturePreview.ok ? `捕捉成功率 ${capturePreview.probability}%；使用${ballId === 'greatBall' ? '超级球' : '精灵球'}。`
      : `不可捕捉：${reasonText(capturePreview.reason)}`
    : '选择野生宝可梦查看成功率。';
  const preview = mode === 'attack'
    ? `<div class="combat-preview"><p class="eyebrow">战斗结算预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="battle-preview">${attackText}</p></div>`
    : mode === 'capture'
      ? `<div class="combat-preview"><p class="eyebrow">捕捉预览</p><strong>${targetLabel ?? '未选择目标'}</strong><p id="capture-preview">${captureText}</p></div>`
      : '';
  root.innerHTML = `<div class="unit-card"><div class="unit-head"><div class="unit-portrait">${definition.name.slice(0, 1)}</div><div><strong>${definition.name}</strong><small>宝可梦 · 文明 ${view.playerId + 1}${unit.enraged ? ' · 激怒' : ''}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">行动点 ${unit.actionLeft}</span></div>
    <div class="unit-vitals"><span>HP <strong>${unit.hp}/${species.maxHp}</strong></span><span>EXP <strong>${unit.xp}${evolution ? `/${evolution.xp}` : ''}</strong></span></div>
    <div class="unit-details"><div class="unit-detail"><small>攻</small><strong>${species.attack}</strong></div><div class="unit-detail"><small>防</small><strong>${species.defense}</strong></div><div class="unit-detail"><small>程</small><strong>${species.range}</strong></div><div class="unit-detail"><small>移</small><strong>${species.move}</strong></div><div class="unit-detail"><small>视</small><strong>${species.vision}</strong></div><div class="unit-detail"><small>P</small><strong>${species.power}</strong></div></div>
    <div class="unit-actions"><button id="attack-unit" class="${mode === 'attack' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>攻击</button><button id="capture-unit" class="${mode === 'capture' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>捕捉</button><button id="evolve-unit" ${busy || !unit.actionLeft || !evolution ? 'disabled' : ''}>${evolution ? `进化→${CONTENT.species[evolution.speciesId].name}` : '不可进化'}</button></div>
    ${mode ? `<div class="action-config">${mode === 'capture' ? `<label>球种<select id="capture-ball"><option value="pokeBall" ${ballId === 'pokeBall' ? 'selected' : ''}>精灵球（${view.economy.player.ballInventory.pokeBall}）</option><option value="greatBall" ${ballId === 'greatBall' ? 'selected' : ''}>超级球（${view.economy.player.ballInventory.greatBall}）</option></select></label>` : ''}<button id="cancel-action">取消目标</button></div>${preview}<div class="action-confirm"><button id="confirm-action" class="primary" ${!target || (mode === 'attack' ? attackPreview?.ok !== true : capturePreview?.ok !== true) ? 'disabled' : ''}>确认${mode === 'attack' ? '攻击' : '捕捉'}</button></div>` : ''}
    ${evolution ? `<p class="unit-note">进化条件：EXP ${evolution.xp} + ${evolution.gold} 金币${evolution.requiresTraining ? ' + 特训法' : ''}；经验、金币与科技条件需同时满足。</p>` : ''}</div>`;
  root.querySelector('#attack-unit')!.addEventListener('click', () => callbacks.mode(mode === 'attack' ? null : 'attack'));
  root.querySelector('#capture-unit')!.addEventListener('click', () => callbacks.mode(mode === 'capture' ? null : 'capture'));
  root.querySelector('#evolve-unit')!.addEventListener('click', callbacks.evolve);
  root.querySelector('#cancel-action')?.addEventListener('click', callbacks.cancel);
  root.querySelector('#confirm-action')?.addEventListener('click', callbacks.confirm);
  root.querySelector<HTMLSelectElement>('#capture-ball')?.addEventListener('change', event => callbacks.ball((event.target as HTMLSelectElement).value as BallId));
}
