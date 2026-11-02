import type { DoctrineDefinition } from '../core/leader-doctrines.ts';
import { LEADER_DOCTRINES, activeDoctrine } from '../core/leader-doctrines.ts';
import type { DoctrinePhase } from '../content/eras.ts';
import { eraState } from '../content/eras.ts';
import { EXPANSION_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { LEADERS } from '../content/leaders.ts';
import type { PlayerView } from '../core/model.ts';
import '../leader-doctrines.css';

const ROLE_LABELS: Record<DoctrineDefinition['favoredRoles'][number], string> = {
  ranged: '远程',
  melee: '近战',
  scout: '侦察',
  fast: '快速',
  siege: '攻城',
  naval: '水面',
  air: '飞行',
};

const TYPE_LABELS: Record<DoctrineDefinition['favoredTypes'][number], string> = {
  grass: '草', fire: '火', water: '水', electric: '电', normal: '一般', fighting: '格斗', flying: '飞行',
  rock: '岩石', psychic: '超能', ghost: '幽灵', dragon: '龙', ground: '地面', poison: '毒', bug: '虫',
  ice: '冰', steel: '钢', dark: '恶', fairy: '妖精',
};

const PHASE_LABELS: Record<DoctrinePhase, string> = {
  early: '早期',
  middle: '中期',
  late: '后期',
};

function cityEffectLabels(definition: DoctrineDefinition): string[] {
  return definition.researchBonus ? [`科研 +${definition.researchBonus}`] : [];
}

function unitEffectLabels(definition: DoctrineDefinition): string[] {
  const labels: string[] = [];
  if (definition.movementBonus) labels.push(`移动力 +${definition.movementBonus}`);
  if (definition.trainedXpBonus) labels.push(`训练经验 +${definition.trainedXpBonus}`);
  if (definition.territoryHealingBonus) labels.push(`领地恢复 +${definition.territoryHealingBonus}`);
  if (definition.fieldHealing) labels.push(`野外恢复 +${definition.fieldHealing}`);
  if (definition.cityDamageBonus) labels.push(`攻击城市 +${definition.cityDamageBonus / 10}%`);
  return labels;
}

function targetLabel(definition: DoctrineDefinition): string {
  const roles = definition.favoredRoles.map(role => ROLE_LABELS[role]);
  const types = definition.favoredTypes.map(type => TYPE_LABELS[type]);
  return [...roles, ...types].join('／') || '全体';
}

function examples(definition: DoctrineDefinition, content: Content): string {
  const species = Object.values(content.species);
  const selectors: ((item: Content['species'][string]) => boolean)[] = [
    ...definition.favoredRoles.map(role => (item: Content['species'][string]) => item.role === role),
    ...definition.favoredTypes.map(type => (item: Content['species'][string]) => item.typeId === type
      || item.secondaryTypeId === type),
  ];
  const selected: string[] = [];
  for (const matches of selectors) {
    const example = species.find(matches);
    if (example && !selected.includes(example.name)) selected.push(example.name);
  }
  return selected.join('、');
}

function windowMarkup(definition: DoctrineDefinition, active: boolean, content: Content): string {
  const cityEffects = cityEffectLabels(definition);
  const unitEffects = unitEffectLabels(definition);
  const examplesText = examples(definition, content);
  return `<li class="era-window${active ? ' active' : ''}"><div class="era-window-head"><strong>${PHASE_LABELS[definition.phase]}</strong>${active ? '<span class="era-active-pill">当前</span>' : ''}</div><p>${definition.description}</p>${cityEffects.length || unitEffects.length ? `<dl>${cityEffects.length ? `<dt>每座城市</dt><dd>${cityEffects.join('、')}</dd>` : ''}${unitEffects.length ? `<dt>${targetLabel(definition)}</dt><dd>${unitEffects.join('、')}</dd>` : ''}${examplesText ? `<small>示例：${examplesText}</small>` : ''}</dl>` : ''}</li>`;
}

export function renderEraPanel(view: PlayerView): string {
  const { player } = view.economy;
  const state = eraState(player, view.eraProgression);
  if (state === null) return '';
  const active = activeDoctrine(player, view.eraProgression);
  const definition = active?.definition ?? null;
  const leader = player.leaderId === undefined ? null : LEADERS[player.leaderId];
  const windows = player.leaderId === undefined ? [] : (Object.values(LEADER_DOCTRINES[player.leaderId]) as DoctrineDefinition[]);
  const modeLabel = state.mode === 'simple-v1' ? '精简时代' : '完整世代';
  const nextLabel = state.next === null
    ? '最终时代'
    : `${state.next.name}（还需 ${state.techsToNextEra} 项科技）`;
  return `<div class="subpanel-head"><strong>时代进程</strong><span>${modeLabel} · ${state.current.name}</span></div>
<div class="era-body">
  <div class="era-progress" role="img" aria-label="时代进度 ${state.eraProgressPercent}%"><span style="width:${state.eraProgressPercent}%"></span></div>
  <p class="era-next">${nextLabel}</p>
  <dl class="era-summary"><dt>已完成科技</dt><dd>${state.completedTechs} 项</dd><dt>整体进程</dt><dd>${state.overallProgressPercent}%</dd></dl>
  <section class="era-doctrine"><strong>${leader ? `${leader.name} · ${PHASE_LABELS[state.phase]}战术` : '无领袖战术'}</strong>${definition ? `<p>${definition.description}</p>` : '<p>此局未选择领袖，时代只推进，不提供额外战术加成。</p>'}</section>
  ${leader ? `<details class="era-windows-toggle"><summary>查看早 / 中 / 后期战术窗口</summary><ul class="era-windows">${windows.map(item => windowMarkup(item, item.phase === state.phase, EXPANSION_CONTENT)).join('')}</ul></details>` : ''}
</div>`;
}
