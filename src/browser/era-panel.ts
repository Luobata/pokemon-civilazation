import { ERA_ABILITIES, ERA_ABILITY_IDS } from '../content/era-abilities.ts';
import type { DoctrineDefinition } from '../core/leader-doctrines.ts';
import { LEADER_DOCTRINES, activeDoctrine } from '../core/leader-doctrines.ts';
import type { DoctrinePhase } from '../content/eras.ts';
import { ERA_DEFINITIONS, eraState } from '../content/eras.ts';
import { EXPANSION_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { LEADERS } from '../content/leaders.ts';
import type { PlayerView } from '../core/model.ts';
import { ERA_AGES, ERA_MILESTONES, ERA_MILESTONE_IDS } from '../content/era-honors.ts';
import { ageFor } from '../core/era-honors.ts';
import { DEDICATION_IDS, DEDICATION_RULES, DEDICATIONS } from '../content/dedications.ts';
import type { DedicationId } from '../content/dedications.ts';
import type { Command } from '../core/model.ts';
import '../leader-doctrines.css';
import { civHint } from './civ-hint.ts';

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

/** v12: this era's score against the golden/dark lines, the projected next age, and history. */
function eraHonorMarkup(view: PlayerView, eraNames: (index: number) => string): string {
  const honor = view.expansion?.eraHonors;
  if (!honor) return '';
  const rounds = Math.max(0, view.round - honor.eraStartRound);
  const rate = rounds ? honor.score / rounds : 0, golden = honor.goldenRatePermille / 1000, dark = honor.darkRatePermille / 1000;
  const projected = ageFor(honor.score, rounds, honor), scale = golden * 1.5;
  const pct = (value: number) => Math.min(100, Math.round(value * 100 / scale));
  const breakdown = ERA_MILESTONE_IDS.filter(id => honor.byMilestone[id]).map(id => `<li>${ERA_MILESTONES[id].name} ×${honor.byMilestone[id]} <b>+${ERA_MILESTONES[id].points * honor.byMilestone[id]!}</b></li>`).join('');
  return `<section class="era-honor age-${honor.age}" aria-label="世代荣誉">
    <div class="era-honor-head"><strong>${honor.dedication?.heroic ? '英雄世代' : ERA_AGES[honor.age].name} ${civHint('eraAge')}</strong><span>${ageDescription(honor)}</span></div>
    <p class="era-honor-score">本世代得分 <b>${honor.score}</b> · 已 ${rounds} 轮 · 平均每轮 <b>${rate.toFixed(2)}</b> ${civHint('eraScore')}</p>
    <div class="era-honor-bar" role="img" aria-label="平均每轮 ${rate.toFixed(2)}，黄金线 ${golden}，黑暗线 ${dark}">
      <span class="fill" style="width:${pct(rate)}%"></span><i class="line dark" style="left:${pct(dark)}%"></i><i class="line golden" style="left:${pct(golden)}%"></i>
    </div>
    <p class="era-honor-legend"><span class="dark">黑暗线 ${dark}</span><span class="golden">黄金线 ${golden}</span></p>
    <p class="era-honor-projection">${rounds < honor.minimumRounds ? `本世代还不到 ${honor.minimumRounds} 轮：现在进入下个世代会是普通世代。` : `按现在的速度，进入下个世代时将是 <b class="age-${projected}">${ERA_AGES[projected].name}</b>。`}</p>
    ${breakdown ? `<ul class="era-honor-breakdown">${breakdown}</ul>` : '<p class="unit-note">本世代还没有得分。建城、进化、捕捉、确立规章、建设施区、清巢穴都能得分。</p>'}
    <details><summary>怎么得分</summary><ul class="era-honor-table">${ERA_MILESTONE_IDS.filter(id => id !== 'legendWonder' || view.expansion?.legends).map(id => `<li>${ERA_MILESTONES[id].name}<b>+${ERA_MILESTONES[id].points}</b></li>`).join('')}</ul></details>
    ${honor.history.length ? `<details><summary>以往世代</summary><ul class="era-honor-history">${honor.history.map(item => `<li>${eraNames(item.eraIndex)} · ${item.heroic ? '英雄世代' : ERA_AGES[item.age].name} · ${item.score} 分 / ${item.rounds} 轮${item.dedications?.length ? ` · 献礼：${item.dedications.map(id => DEDICATIONS[id].name).join('、')}` : ''}</li>`).join('')}</ul></details>` : ''}
  </section>${dedicationMarkup(view)}`;
}
type Honor = NonNullable<NonNullable<PlayerView['expansion']>['eraHonors']>;
/** v22: a golden age's fixed bonus is replaced by the chosen dedications. */
const ageDescription = (honor: Honor) => honor.dedication && honor.age === 'golden' ? DEDICATION_RULES.goldenDescription : ERA_AGES[honor.age].description;

// ---------- v22 era dedications: pick → confirm, then progress for the rest of the era ----------
const dedicationSprite = (id: DedicationId) => `/sprites/gen3/${DEDICATIONS[id].dex}.png`;
/** Cards the player has marked but not yet confirmed, for one era of one player. */
let draft: { key: string; ids: DedicationId[] } = { key: '', ids: [] };
const draftKey = (view: PlayerView, honor: Honor) => `${view.playerId}:${honor.eraIndex}:${honor.eraStartRound}`;
function draftIds(view: PlayerView, honor: Honor): DedicationId[] {
  if (draft.key !== draftKey(view, honor)) draft = { key: draftKey(view, honor), ids: [] };
  return draft.ids;
}
function cardMarkup(id: DedicationId, options: { picked?: boolean; button?: boolean; status?: string; golden?: boolean }): string {
  const card = DEDICATIONS[id];
  const body = `<span class="dedication-art"><img src="${dedicationSprite(id)}" alt="" width="56" height="56"></span>
    <span class="dedication-name">${card.name}</span><span class="dedication-style">${card.style}</span>
    <span class="dedication-line promise${options.golden ? ' inactive' : ''}"><b>承诺</b>${card.promiseText}</span>
    <span class="dedication-line golden${options.golden === false ? ' inactive' : ''}"><b>黄金</b>${card.goldenText}</span>
    ${options.status ? `<span class="dedication-status">${options.status}</span>` : `<span class="dedication-flavor">${card.flavor}</span>`}`;
  return options.button
    ? `<button type="button" class="dedication-card${options.picked ? ' picked' : ''}" data-dedication="${id}" aria-pressed="${options.picked ? 'true' : 'false'}">${body}</button>`
    : `<article class="dedication-card chosen" data-dedication="${id}">${body}</article>`;
}
function dedicationMarkup(view: PlayerView): string {
  const honor = view.expansion?.eraHonors, ledger = honor?.dedication;
  if (!honor || !ledger) return '';
  const golden = honor.age === 'golden';
  if (ledger.pending) {
    const picked = draftIds(view, honor);
    return `<section class="dedications pending" aria-label="时代献礼">
      <div class="dedication-head"><strong>选择时代献礼 ${civHint('dedication')}</strong><span>${ledger.heroic ? '英雄世代：选 3 张，3 张的黄金效果都生效。' : golden ? '黄金世代：选 1 张，获得它的黄金效果。' : `${ERA_AGES[honor.age].name}：选 1 张，本世代按它的承诺额外得世代分。`}</span></div>
      <div class="dedication-cards" role="group" aria-label="献礼卡">${DEDICATION_IDS.map(id => cardMarkup(id, { picked: picked.includes(id), button: true, golden })).join('')}</div>
      <div class="dedication-actions"><span>已选 ${picked.length} / ${ledger.pending}</span><button type="button" id="confirm-dedication"${picked.length === ledger.pending ? '' : ' disabled'}>确认献礼</button></div>
    </section>`;
  }
  if (!ledger.chosen.length) return `<section class="dedications" aria-label="时代献礼"><div class="dedication-head"><strong>时代献礼 ${civHint('dedication')}</strong><span>进入下一个世代时选择献礼卡：普通、黑暗、黄金世代选 1 张，英雄世代（黑暗之后直接黄金）选 3 张。</span></div>
    <details><summary>全部献礼卡</summary><div class="dedication-cards compact">${DEDICATION_IDS.map(id => cardMarkup(id, {})).join('')}</div></details></section>`;
  return `<section class="dedications" aria-label="时代献礼"><div class="dedication-head"><strong>本世代献礼 ${civHint('dedication')}</strong><span>${golden ? '黄金效果生效中；黄金世代里承诺不再额外得分。' : '承诺进度计入本世代得分。'}</span></div>
    <div class="dedication-cards">${ledger.chosen.map(id => cardMarkup(id, { golden, status: golden ? '黄金效果生效中' : `承诺进度 +${ledger.progress[id] ?? 0} 世代分` })).join('')}</div></section>`;
}
/** Wires the dedication cards after `renderEraPanel` filled `root`: a click marks a card, 确认献礼 sends the choice. */
export function bindEraPanel(root: HTMLElement, view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const honor = view.expansion?.eraHonors, ledger = honor?.dedication;
  if (!honor || !ledger?.pending) return;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-dedication]')) {
    button.disabled = disabled;
    button.addEventListener('click', () => {
      const id = button.dataset.dedication as DedicationId, ids = draftIds(view, honor);
      draft.ids = ids.includes(id) ? ids.filter(item => item !== id) : ledger.pending === 1 ? [id] : ids.length < ledger.pending ? [...ids, id] : ids;
      root.innerHTML = renderEraPanel(view);
      bindEraPanel(root, view, issue, disabled);
      root.querySelector<HTMLButtonElement>(`[data-dedication="${id}"]`)?.focus();
    });
  }
  const confirm = root.querySelector<HTMLButtonElement>('#confirm-dedication');
  if (!confirm) return;
  if (disabled) confirm.disabled = true;
  confirm.addEventListener('click', () => {
    const ids = draftIds(view, honor);
    if (ids.length !== ledger.pending) return;
    draft = { key: '', ids: [] };
    issue({ type: 'ChooseDedication', dedicationIds: DEDICATION_IDS.filter(id => ids.includes(id)) });
  });
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
  return `<div class="subpanel-head"><strong>时代进程 ${civHint('era')}</strong><span>${modeLabel} · ${state.current.name}</span></div>
<div class="era-body">
  <div class="era-progress" role="img" aria-label="时代进度 ${state.eraProgressPercent}%"><span style="width:${state.eraProgressPercent}%"></span></div>
  <p class="era-next">${nextLabel}</p>
  ${eraHonorMarkup(view, index => ERA_DEFINITIONS[state.mode][index]?.name ?? `第 ${index + 1} 世代`)}
  <dl class="era-summary"><dt>已完成科技</dt><dd>${state.completedTechs} 项</dd><dt>整体进程</dt><dd>${state.overallProgressPercent}%</dd></dl>
  ${view.expansion?.eraAbilities ? `<section class="era-abilities"><strong>时代能力 · ${view.expansion.eraAbilities.night ? '夜晚' : '白天'}</strong><ul>${ERA_ABILITY_IDS.filter(id => state.mode === 'full-v1' || ERA_ABILITIES[id].generation <= 3).map(id => `<li class="${view.expansion!.eraAbilities!.unlocked.includes(id) ? 'done' : ''}">${view.expansion!.eraAbilities!.unlocked.includes(id) ? '✓' : '○'} ${ERA_ABILITIES[id].era} · ${ERA_ABILITIES[id].name}<small>${ERA_ABILITIES[id].description}</small></li>`).join('')}</ul></section>` : ''}
  <section class="era-doctrine"><strong>${leader ? `${leader.name} · ${PHASE_LABELS[state.phase]}战术` : '无领袖战术'}</strong>${definition ? `<p>${definition.description}</p>` : '<p>此局未选择领袖，时代只推进，不提供额外战术加成。</p>'}</section>
  ${leader ? `<details class="era-windows-toggle"><summary>查看早 / 中 / 后期战术窗口</summary><ul class="era-windows">${windows.map(item => windowMarkup(item, item.phase === state.phase, EXPANSION_CONTENT)).join('')}</ul></details>` : ''}
</div>`;
}
