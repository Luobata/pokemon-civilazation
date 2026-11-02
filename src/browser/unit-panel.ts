import { doctrineEffects } from '../core/leader-doctrines.ts';
import { ROLE_CITY_ASSAULT } from '../core/role-tactics.ts';
import { improvementOptions, improvementYield } from '../core/improvements.ts';
import { exertsZoc, ignoresZoc, usesTactics } from '../core/tactics.ts';
import { IMPROVEMENT_WORK, IMPROVEMENTS } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import { CONTENT as BASE_CONTENT, EXPANSION_CONTENT, unitDefinition } from '../content/units.ts';
import type { BallId } from '../content/economy.ts';
import type { CombatTarget, PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import { pokemonSpritePath } from './sprites.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';

export type ActionMode = 'move' | 'attack' | 'capture' | null;
export type PendingTarget = CombatTarget & { index: number };
type Callbacks = {
  mode: (mode: ActionMode) => void;
  confirm: () => void;
  cancel: () => void;
  evolve: () => void;
  ball: (ballId: BallId) => void;
  found: () => void;
  improve?: (tileIndex: number, kind: ImprovementId) => void;
};

export function renderUnitPanel(view: PlayerView, selected: number | null, mode: ActionMode,
  target: PendingTarget | null, ballId: BallId, busy: boolean, callbacks: Callbacks): void {
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const root = document.querySelector<HTMLElement>('#unit-panel')!;
  const unit = view.units.find(unit => unit.id === selected && unit.ownerId === view.playerId);
  if (!unit) { root.innerHTML = ''; return; }
  if (unit.kind === 'logistics') {
    const nearest = [...view.cities, ...Object.values(view.knowledge.lastKnownCities)]
      .reduce((distance, city) => Math.min(distance, hexDistance(unit.position, city.position)), Infinity);
    const biome = view.map.tiles[hexToIndex(unit.position, view.map)!];
    const reason = !unit.actionLeft ? '本回合已行动。结束回合后，开拓队恢复行动点。'
      : biome === 'ocean' ? '海洋上无法建城，请选择陆地。'
      : nearest < 4 ? `距最近已知城市 ${nearest} 格，至少需要 4 格。请继续向外探索。` : null;
    root.innerHTML = `<div class="unit-card settler-card"><div class="unit-head"><div class="unit-portrait settler-portrait" aria-hidden="true">⚑</div><div><strong>开拓队</strong><small>建立城市 · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">行动点 ${unit.actionLeft}</span></div>
      <p class="settler-intro">在新的土地上建立一座人口为 1 的城市。</p>
      <ol class="founding-steps"><li>移动到陆地，与其他城市至少相距 4 格。</li><li>移动会消耗行动点；下一回合再建城。</li><li>建城消耗这支开拓队，随后进入城市管理。</li></ol>
      <p id="founding-status" class="founding-status ${reason ? 'unavailable' : ''}">${reason ?? '已知选址条件满足，可以在此建立城市。'}</p>
      <div class="unit-actions"><button id="move-unit" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="found-city" class="primary" ${busy || reason ? 'disabled' : ''}>在此建立城市</button></div>
      <p class="unit-note">需要更多开拓队：选中城市 → 训练开拓队 → 加入队列（30 生产）。</p></div>`;
    root.querySelector('#found-city')!.addEventListener('click', callbacks.found);
    root.querySelector('#move-unit')!.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
    return;
  }
  const definition = unitDefinition(unit, CONTENT), species = CONTENT.species[unit.speciesId];
  const evolution = species.evolution;
  const stoneEvolution = view.expansion && WORLD_DEFINITIONS.stoneEvolutions.find(path => path.fromSpeciesId === unit.speciesId);
  const player = view.economy.player;
  const canEvolve = evolution && !stoneEvolution && unit.xp >= evolution.xp && player.gold >= evolution.gold
    && (!evolution.requiresTraining || player.research.unlockedIds.includes('training'));
  const canCapture = player.research.unlockedIds.includes('domestication')
    && (player.ballInventory.pokeBall > 0 || (player.research.unlockedIds.includes('ballCraft') && player.ballInventory.greatBall > 0));
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
  const yieldLabel = (kind: ImprovementId) => Object.entries(improvementYield(kind, player)).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${({ food: '食', production: '产', gold: '金', research: '研' } as const)[key as 'food']}+${amount}`).join(' ');
  const options = view.expansion?.improvements ? improvementOptions(view, unit.id, CONTENT) : [];
  const improvementMarkup = view.expansion?.improvements ? `<section class="improvement-box" id="improvement-box" aria-label="地块改良"><p class="section-label">地块改良 · 己方领地内，${IMPROVEMENT_WORK.required} 点完工（熟练属性每次 ${IMPROVEMENT_WORK.crew} 点，其他 ${IMPROVEMENT_WORK.other} 点）</p>${options.length
    ? options.map(option => `<button type="button" data-improve="${option.tileIndex}:${option.kind}" ${busy ? 'disabled' : ''}>${IMPROVEMENTS[option.kind].name}（${yieldLabel(option.kind)}）· 进度 ${option.progress}/${IMPROVEMENT_WORK.required} +${option.points}</button>`).join('')
    : `<p class="unit-note">${unit.actionLeft ? '移到己方领地内的非城市地块（渔场可在相邻陆地施工）即可改良。' : '本回合行动点已用完。'}</p>`}</section>` : '';
  root.innerHTML = `<div class="unit-card"><div class="unit-head"><div class="unit-portrait"><img src="${pokemonSpritePath(unit.speciesId)}" alt="${definition.name}" width="64" height="64"></div><div><strong>${definition.name}</strong><small>宝可梦 · 文明 ${view.playerId + 1}${unit.enraged ? ' · 激怒' : ''}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">行动点 ${unit.actionLeft}</span></div>
    <div class="unit-vitals"><span>HP <strong>${unit.hp}/${species.maxHp}</strong><span class="vital-bar" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, unit.hp * 100 / species.maxHp))}%"></span></span></span><span>EXP <strong>${unit.xp}${evolution ? `/${evolution.xp}` : ''}</strong>${evolution ? `<span class="vital-bar xp" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, unit.xp * 100 / evolution.xp))}%"></span></span>` : ''}</span></div>
    <div class="unit-details"><div class="unit-detail"><small>攻</small><strong>${species.attack}</strong></div><div class="unit-detail"><small>防</small><strong>${species.defense}</strong></div><div class="unit-detail"><small>程</small><strong>${species.range}</strong></div><div class="unit-detail"><small>移</small><strong>${species.move + doctrineEffects(player, view.eraProgression, unit, CONTENT).movementBonus}</strong></div><div class="unit-detail"><small>视</small><strong>${species.vision}</strong></div><div class="unit-detail"><small>P</small><strong>${species.power}</strong></div></div>
    ${view.gameplayVersion ? `<p class="unit-note" id="assault-role">兵种：${ROLE_CITY_ASSAULT[species.role].label} · ${ROLE_CITY_ASSAULT[species.role].note}${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus ? `；领袖战术再 +${doctrineEffects(player, view.eraProgression, unit, CONTENT).cityDamageBonus / 10}%` : ''}</p>` : ''}
    <div class="unit-actions"><button id="move-unit" class="${mode === 'move' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>${mode === 'move' ? '取消移动' : '移动'}</button><button id="attack-unit" class="${mode === 'attack' ? 'selected' : ''}" ${busy || !unit.actionLeft ? 'disabled' : ''}>攻击</button><button id="capture-unit" class="${mode === 'capture' ? 'selected' : ''}" ${busy || !unit.actionLeft || !canCapture ? 'disabled' : ''}>捕捉</button><button id="evolve-unit" ${busy || !unit.actionLeft || !canEvolve ? 'disabled' : ''}>${evolution ? `进化→${CONTENT.species[evolution.speciesId].name}` : '不可进化'}</button></div>
    ${usesTactics(view) ? `<p class="unit-note" id="zoc-note">${exertsZoc(unit, CONTENT) ? '控制区：相邻敌军移动到此即停下。' : ''}${ignoresZoc(unit, CONTENT) ? '可无视敌方控制区。' : '进入敌方近战/快速单位相邻格会停下。'}夹击：每只相邻目标的友军 +10% 伤害（最多 +30%）。</p>` : ''}
    ${improvementMarkup}
    ${!canCapture ? '<p class="unit-note">捕捉需要研究「驯化」，并在城市采购精灵球。</p>' : ''}
    ${mode && mode !== 'move' ? `<div class="action-config">${mode === 'capture' ? `<label>球种<select id="capture-ball"><option value="pokeBall" ${ballId === 'pokeBall' ? 'selected' : ''}>精灵球（${view.economy.player.ballInventory.pokeBall}）</option><option value="greatBall" ${ballId === 'greatBall' ? 'selected' : ''}>超级球（${view.economy.player.ballInventory.greatBall}）</option></select></label>` : ''}<button id="cancel-action">取消目标</button></div>${preview}<div class="action-confirm"><button id="confirm-action" class="primary" ${!target || (mode === 'attack' ? attackPreview?.ok !== true : capturePreview?.ok !== true) ? 'disabled' : ''}>确认${mode === 'attack' ? '攻击' : '捕捉'}</button></div>` : ''}
    ${stoneEvolution ? `<p class="unit-note">进化需要 ${WORLD_DEFINITIONS.stones[stoneEvolution.stoneId].name} + EXP ${stoneEvolution.requiredXp}，请在「树果、进化石与满意度」中使用。</p>` : evolution ? `<p class="unit-note">进化条件：EXP ${evolution.xp} + ${evolution.gold} 金币${evolution.requiresTraining ? ' + 特训法' : ''}；经验、金币与科技条件需同时满足。</p>` : ''}</div>`;
  root.querySelector('#move-unit')!.addEventListener('click', () => callbacks.mode(mode === 'move' ? null : 'move'));
  root.querySelector('#attack-unit')!.addEventListener('click', () => callbacks.mode(mode === 'attack' ? null : 'attack'));
  root.querySelector('#capture-unit')!.addEventListener('click', () => callbacks.mode(mode === 'capture' ? null : 'capture'));
  root.querySelector('#evolve-unit')!.addEventListener('click', callbacks.evolve);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-improve]')) button.addEventListener('click', () => {
    const [tile, kind] = button.dataset.improve!.split(':');
    callbacks.improve?.(Number(tile), kind as ImprovementId);
  });
  root.querySelector('#cancel-action')?.addEventListener('click', callbacks.cancel);
  root.querySelector('#confirm-action')?.addEventListener('click', callbacks.confirm);
  root.querySelector<HTMLSelectElement>('#capture-ball')?.addEventListener('change', event => callbacks.ball((event.target as HTMLSelectElement).value as BallId));
}
