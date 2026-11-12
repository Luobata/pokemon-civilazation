// Gameplay v22 research screen (docs/design/world-v22.md §B): a horizontally scrolling node tree with connector lines.
// Nodes are picture-first (docs/design/ui-icons/README.md): a subject icon, cost and ≈rounds as icon stats, a Pokédex
// discovery marker and a row of unlock chips (species sprite, building art, district / improvement icon, HM disc);
// state (done / current / researchable / locked) reads from the frame and a corner badge. The full text lives in the
// hover card (mouse and keyboard focus) and in the details beside the tree, where 研究此项 is. Hovering or selecting
// highlights the prerequisite chain. The compact select stays as the keyboard path (R / T focuses it).
import { discoveryText, DISCOVERY_PERCENT } from '../content/discoveries.ts';
import type { TechId } from '../content/economy.ts';
import { TECH_LINE_IDS, TECH_LINES, TREE_COLUMNS } from '../content/tech-tree.ts';
import type { Content } from '../content/units.ts';
import { canResearch } from '../core/economy-commands.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { missingPrerequisites } from '../core/tech-tree.ts';
import { techUnlocks } from './tech-info.ts';
import type { TechUnlock } from './tech-info.ts';
import { drawTreeLinks } from './tree-links.ts';
import { civHint } from './civ-hint.ts';
import { escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { TECH_ICONS, UNLOCK_KIND_NAMES, unlockChip, unlockPicture } from './unlock-icons.ts';
import { bindTip, hideTip } from './ui-tip.ts';

const COLUMN_NAMES = ['启程', '探索', '发展', '联盟', '精英', '传说'];
type NodeState = 'done' | 'active' | 'available' | 'locked';
const STATE_ICON: Record<NodeState, UiIconName | null> = { done: 'check', active: 'play', available: null, locked: 'lock' };
const STATE_NAME: Record<NodeState, string> = { done: '已完成', active: '研究中', available: '可研究', locked: '未解锁' };
const LEGEND_KINDS: readonly TechUnlock['kind'][] = ['recruit', 'building', 'district', 'improvement', 'class', 'effect'];
const LEGEND_SAMPLE: Record<TechUnlock['kind'], TechUnlock & { tech: TechId }> = {
  recruit: { kind: 'recruit', text: '', ref: 'pikachu', tech: 'electricity' }, building: { kind: 'building', text: '', ref: 'workshop', tech: 'masonry' },
  district: { kind: 'district', text: '', ref: 'harborDistrict', tech: 'seafaring' }, improvement: { kind: 'improvement', text: '', ref: 'ranch', tech: 'riding' },
  class: { kind: 'class', text: '', ref: 'naval', tech: 'seafaring' }, effect: { kind: 'effect', text: '', tech: 'cartography' },
};

let selected: TechId | null = null;
let observer: ResizeObserver | null = null;

type TreeContext = { view: PlayerView; content: Content; issue: (action: Command['action']) => void; disabled: boolean; perRound: number };

const ids = (content: Content) => Object.keys(content.techs) as TechId[];
const def = (content: Content, id: TechId) => content.techs[id]!;
/** The prerequisite chain of `id` (all ancestors), for highlighting. */
export function prerequisiteChain(content: Content, id: TechId): Set<TechId> {
  const chain = new Set<TechId>();
  const visit = (tech: TechId) => { for (const requirement of def(content, tech).requires ?? []) if (!chain.has(requirement)) { chain.add(requirement); visit(requirement); } };
  visit(id);
  return chain;
}
function stateOf(context: TreeContext, id: TechId): NodeState {
  const research = context.view.economy.player.research;
  return research.unlockedIds.includes(id) ? 'done' : research.techId === id ? 'active' : canResearch(context.view.economy.player, id, context.content) ? 'available' : 'locked';
}
function roundsLeft(context: TreeContext, id: TechId): number {
  const research = context.view.economy.player.research;
  return Math.max(1, Math.ceil(Math.max(0, def(context.content, id).cost - research.progressByTech[id]) / Math.max(1, context.perRound)));
}
function stateLabel(context: TreeContext, id: TechId): string {
  const state = stateOf(context, id), names = missingPrerequisites(context.view.economy.player, id, context.content).map(item => def(context.content, item).name);
  return state === 'done' ? '已完成' : state === 'active' ? `研究中 · 约 ${roundsLeft(context, id)} 轮` : state === 'available' ? `可研究 · 约 ${roundsLeft(context, id)} 轮` : `需要先完成：${names.join('、')}`;
}

function nodeMarkup(context: TreeContext, id: TechId, row: number): string {
  const tech = def(context.content, id), state = stateOf(context, id), research = context.view.economy.player.research;
  const discoveries = context.view.expansion?.discoveries, found = discoveries?.includes(id);
  const percent = state === 'done' ? 100 : Math.min(100, Math.round(research.progressByTech[id] * 100 / tech.cost));
  const chips = techUnlocks(id, context.content, context.view.gameplayVersion).map(item => unlockChip(item, id, 22)).join('');
  const line = TECH_LINES[tech.line ?? 'capture'], badge = STATE_ICON[state];
  return `<button type="button" class="tech-node ${state}${selected === id ? ' selected' : ''}" data-tree-node="${id}" style="grid-column:${tech.tier};grid-row:${row + 1};--line:${line.color}"
      aria-pressed="${selected === id}" aria-label="${tech.name} · ${stateLabel(context, id)}">
      <span class="node-icon">${uiIcon(TECH_ICONS[id], { size: 36 })}${badge ? `<span class="node-state-badge">${uiIcon(badge, { size: 16, label: STATE_NAME[state] })}</span>` : ''}</span>
      <span class="node-main"><strong>${tech.name}</strong>
        <span class="node-meta">${statChip('research', tech.cost, '科研', 'node-cost')}${state === 'done' ? '' : statChip('turns', `≈${roundsLeft(context, id)}`, '约轮数', 'node-rounds')}</span></span>
      ${discoveries ? `<span class="node-eureka ${found ? 'found' : 'pending'}">${uiIcon('pokedex', { size: 16, label: found ? '图鉴发现已触发' : '图鉴发现未触发' })}</span>` : ''}
      <span class="node-progress" aria-hidden="true"><span style="width:${percent}%"></span></span>
      <span class="node-marks">${chips}</span>
    </button>`;
}

/** Hover card: the full text of a node (its chips only show pictures). */
function tipMarkup(context: TreeContext, id: TechId): string {
  const tech = def(context.content, id), state = stateOf(context, id), found = context.view.expansion?.discoveries;
  const unlocks = techUnlocks(id, context.content, context.view.gameplayVersion)
    .map(item => `<li>${unlockPicture(item, id, 18)}<span>${escapeAttr(item.text)}</span></li>`).join('');
  const discovery = found ? discoveryText(id, Boolean(context.content.opening)) : null;
  return `<b>${tech.name} · ${STATE_NAME[state]}</b><small>${tech.cost} 科研${state === 'done' ? '' : ` · 约 ${roundsLeft(context, id)} 轮`} · ${TECH_LINES[tech.line ?? 'capture'].name}</small>
    <ul class="tip-unlocks">${unlocks}</ul>${discovery ? `<small>${found!.includes(id) ? '★ 已触发' : '☆ 未触发'}图鉴发现「${discovery.name}」：${discovery.hint}</small>` : ''}`;
}

function detailMarkup(context: TreeContext, id: TechId): string {
  const { content, view } = context, tech = def(content, id), state = stateOf(context, id), research = view.economy.player.research;
  const found = view.expansion?.discoveries;
  const requires = (tech.requires ?? []).map(item => {
    const met = research.unlockedIds.includes(item);
    return `<li class="${met ? 'met' : 'missing'}">${uiIcon(met ? 'check' : 'lock', { size: 14, label: met ? '已完成' : '未完成' })}${uiIcon(TECH_ICONS[item], { size: 20 })}${def(content, item).name}</li>`;
  }).join('');
  const leadsTo = ids(content).filter(other => def(content, other).requires?.includes(id))
    .map(other => `<span class="tech-lead">${uiIcon(TECH_ICONS[other], { size: 18 })}${def(content, other).name}</span>`).join('');
  const unlocks = techUnlocks(id, content, view.gameplayVersion).map(item => `<li class="${item.kind}"><span class="unlock-chip ${item.kind}${item.boost ? ' boost' : ''}" aria-hidden="true">${unlockPicture(item, id, 24)}</span><span><small>${UNLOCK_KIND_NAMES[item.kind]}</small> ${item.text}</span></li>`).join('');
  const discovery = discoveryText(id, Boolean(content.opening));
  const eureka = found ? `<div class="tech-eureka ${found.includes(id) ? 'hit' : ''}"><span class="eureka-mark">${uiIcon('pokedex', { size: 24, label: found.includes(id) ? '图鉴发现已触发' : '图鉴发现未触发' })}</span><div><b>图鉴发现 · ${discovery.name}</b><small>${discovery.hint}${found.includes(id) ? ` · 已触发 +${DISCOVERY_PERCENT}%` : ` · 达成后 +${DISCOVERY_PERCENT}%`}</small></div></div>` : '';
  const missing = missingPrerequisites(view.economy.player, id, content);
  const action = state === 'available' ? `<button type="button" class="primary" data-tech="${id}" ${context.disabled ? 'disabled' : ''}>研究此项</button>`
    : state === 'locked' ? `<p class="tech-locked-reason" id="tech-locked-reason">需要先完成：${missing.map(item => def(content, item).name).join('、')}</p>`
    : state === 'active' ? '<p class="tech-state">正在研究</p>' : '<p class="tech-state">已完成</p>';
  const line = TECH_LINES[tech.line ?? 'capture'], have = state === 'done' ? tech.cost : research.progressByTech[id];
  return `<header><span class="detail-icon ${state}" style="--line:${line.color}">${uiIcon(TECH_ICONS[id], { size: 48 })}</span><div><strong>${tech.name}</strong><span class="line-chip" style="--line:${line.color}">${line.name}</span></div></header>
    <p class="tech-stats">${statChip('research', `${have}/${tech.cost}`, '科研')}${state === 'done' ? '' : statChip('turns', `≈${roundsLeft(context, id)}`, `按每轮 ${context.perRound} 科研约轮数`)}<span class="tech-column-chip">第 ${tech.tier} 列「${COLUMN_NAMES[tech.tier - 1]}」</span></p>
    <p class="tech-state">${stateLabel(context, id)}</p>
    <h4>前置科技（全部完成）</h4>${requires ? `<ul class="tech-requires">${requires}</ul>` : '<p class="tech-state">无前置，开局即可研究</p>'}
    <h4>解锁</h4><ul class="tech-unlocks">${unlocks}</ul>
    ${leadsTo ? `<h4>通往</h4><p class="tech-leads">${leadsTo}</p>` : ''}
    ${eureka}${action}`;
}

function highlight(root: HTMLElement, content: Content, id: TechId | null): void {
  const chain = id ? prerequisiteChain(content, id) : new Set<TechId>();
  for (const node of root.querySelectorAll<HTMLElement>('[data-tree-node]')) {
    const tech = node.dataset.treeNode as TechId;
    node.classList.toggle('chain', chain.has(tech));
    node.classList.toggle('focus', tech === id);
  }
  for (const path of root.querySelectorAll<SVGPathElement>('.tech-links path')) {
    const to = path.dataset.to as TechId;
    path.classList.toggle('chain', id !== null && (to === id || chain.has(to)) && chain.has(path.dataset.from as TechId));
  }
}

function select(root: HTMLElement, context: TreeContext, id: TechId): void {
  selected = id;
  for (const node of root.querySelectorAll<HTMLElement>('[data-tree-node]')) {
    node.classList.toggle('selected', node.dataset.treeNode === id);
    node.setAttribute('aria-pressed', String(node.dataset.treeNode === id));
  }
  const detail = root.querySelector<HTMLElement>('#tech-detail')!;
  detail.innerHTML = detailMarkup(context, id);
  detail.querySelector<HTMLButtonElement>('[data-tech]')?.addEventListener('click', () => context.issue({ type: 'SetResearch', techId: id }));
  highlight(root, context.content, id);
}

/** Renders the v22 tree into `root` (signature checks happen in renderResearchPanel). */
export function renderTechTree(root: HTMLElement, view: PlayerView, content: Content, issue: (action: Command['action']) => void, disabled: boolean): void {
  const player = view.economy.player, research = player.research;
  const perRound = view.economy.cities.reduce((sum, city) => sum + city.yields.research, 0);
  const context: TreeContext = { view, content, issue, disabled, perRound };
  hideTip();
  const all = ids(content);
  if (selected === null || !Object.hasOwn(content.techs, selected)) selected = research.techId ?? all.find(id => stateOf(context, id) === 'available') ?? all[0];
  const previousScroll = root.querySelector<HTMLElement>('.tech-tree-scroll')?.scrollLeft ?? 0;
  const topics = all.filter(id => canResearch(player, id, content));
  const current = research.techId, found = view.expansion?.discoveries;
  const rows = new Map<TechId, number>();
  for (let column = 1; column <= TREE_COLUMNS; column++) all.filter(id => def(content, id).tier === column).forEach((id, row) => rows.set(id, row));
  const rowCount = Math.max(...rows.values()) + 1;
  const percent = current ? Math.min(100, Math.round(research.progressByTech[current] * 100 / def(content, current).cost)) : 0;
  root.innerHTML = `<section class="research-box" aria-label="研究选择">
      <div class="research-summary"><div class="research-current">${current ? `<span class="detail-icon active">${uiIcon(TECH_ICONS[current], { size: 36 })}</span>` : ''}<div><small>当前研究</small><strong id="research-status">${current ? `${def(content, current).name} ${research.progressByTech[current]}/${def(content, current).cost}` : '未选课题，科研进入储备'}</strong>
        <span class="research-stats">${statChip('research', `+${perRound}`, '每轮科研')}${statChip('turns', research.reserve, '储备科研')}${statChip('check', `${research.unlockedIds.length}/${all.length}`, '已完成科技')}${found ? `${statChip('pokedex', `${found.length}/${all.length}`, '图鉴发现')} ${civHint('discovery')}` : ''}</span></div></div>
        <div class="research-controls"><label>研究课题<select id="research-topic" ${disabled ? 'disabled' : ''}><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>第${def(content, id).tier}列 ${def(content, id).name} ${research.progressByTech[id]}/${def(content, id).cost}${found?.includes(id) ? ' ★' : ''}</option>`).join('')}</select></label>
        <button id="set-research" ${disabled || !topics.length ? 'disabled' : ''}>选择研究</button></div></div>
      ${current ? `<div class="research-progress" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ''}
    </section>
    <p class="tech-tree-help">科技有<strong>指定前置</strong>：连线左端的科技全部完成后才能研究。悬停或选中一项会高亮它的前置链。滚轮、触控板或 ←/→ 键左右浏览。</p>
    <ul class="tech-line-legend" aria-label="科技路线">${TECH_LINE_IDS.map(line => `<li style="--line:${TECH_LINES[line].color}">${TECH_LINES[line].name}</li>`).join('')}</ul>
    <ul class="tech-icon-legend" aria-label="图例">${(['done', 'active', 'available', 'locked'] as const).map(state => `<li class="legend-state ${state}"><span class="legend-frame">${STATE_ICON[state] ? uiIcon(STATE_ICON[state]!, { size: 14 }) : ''}</span>${STATE_NAME[state]}</li>`).join('')}
      ${found ? `<li class="legend-gap">${uiIcon('pokedex', { size: 16 })}图鉴发现</li>` : ''}<li>${uiIcon('research', { size: 16 })}科研</li><li>${uiIcon('turns', { size: 16 })}轮数</li>
      ${LEGEND_KINDS.map((kind, index) => `<li${index ? '' : ' class="legend-gap"'}><span class="unlock-chip ${kind}" aria-hidden="true">${unlockPicture(LEGEND_SAMPLE[kind], LEGEND_SAMPLE[kind].tech, 16)}</span>${UNLOCK_KIND_NAMES[kind]}</li>`).join('')}</ul>
    <div class="tech-tree-layout"><div class="tech-tree-main">
      <div class="tech-tree-scroll" tabindex="0" aria-label="科技树（可左右滚动）">
        <div class="tech-tree-v22" style="grid-template-columns:repeat(${TREE_COLUMNS}, 184px);grid-template-rows:auto repeat(${rowCount}, auto)">
          <svg class="tech-links" aria-hidden="true"></svg>
          ${Array.from({ length: TREE_COLUMNS }, (_, index) => `<h3 class="tech-column-head" style="grid-column:${index + 1};grid-row:1">第 ${index + 1} 列 · ${COLUMN_NAMES[index]}</h3>`).join('')}
          ${all.map(id => nodeMarkup(context, id, rows.get(id)! + 1)).join('')}
        </div>
      </div>
      <div class="tech-tree-nav" aria-label="浏览科技树">${[['first', '« 第 1 列'], ['left', '‹ 向左'], ['right', '向右 ›'], ['last', '第 6 列 »']]
        .map(([key, label]) => `<button type="button" data-tree-pan="${key}">${label}</button>`).join('')}</div></div>
      <aside class="tech-detail" id="tech-detail" aria-live="polite"></aside>
    </div>`;
  root.querySelector('#set-research')!.addEventListener('click', () => {
    const techId = root.querySelector<HTMLSelectElement>('#research-topic')!.value as TechId;
    if (techId) issue({ type: 'SetResearch', techId });
  });
  const scroll = root.querySelector<HTMLElement>('.tech-tree-scroll')!, tree = root.querySelector<HTMLElement>('.tech-tree-v22')!;
  for (const node of root.querySelectorAll<HTMLButtonElement>('[data-tree-node]')) {
    const id = node.dataset.treeNode as TechId;
    node.addEventListener('click', () => select(root, context, id));
    node.addEventListener('mouseenter', () => highlight(root, content, id));
    node.addEventListener('focus', () => highlight(root, content, id));
    node.addEventListener('mouseleave', () => highlight(root, content, selected));
    bindTip(node, () => tipMarkup(context, id));
  }
  // A vertical wheel over the tree pans it sideways until the edge, then the screen scrolls as usual.
  scroll.addEventListener('wheel', event => {
    if (event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const max = scroll.scrollWidth - scroll.clientWidth;
    if ((event.deltaY > 0 && scroll.scrollLeft >= max - 1) || (event.deltaY < 0 && scroll.scrollLeft <= 0)) return;
    event.preventDefault();
    scroll.scrollLeft = Math.max(0, Math.min(max, scroll.scrollLeft + event.deltaY));
  }, { passive: false });
  scroll.addEventListener('keydown', event => {
    const step = { ArrowLeft: -200, ArrowRight: 200, PageUp: -scroll.clientWidth, PageDown: scroll.clientWidth } as Record<string, number>;
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scroll.scrollLeft = event.key === 'Home' ? 0 : scroll.scrollWidth; }
    else if (step[event.key] !== undefined && (event.target === scroll || event.key.startsWith('Arrow'))) { event.preventDefault(); scroll.scrollLeft += step[event.key]; }
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tree-pan]')) button.addEventListener('click', () => {
    const pan = button.dataset.treePan;
    scroll.scrollTo({ left: pan === 'first' ? 0 : pan === 'last' ? scroll.scrollWidth : scroll.scrollLeft + (pan === 'left' ? -1 : 1) * Math.max(200, scroll.clientWidth * 0.6) });
  });
  scroll.scrollLeft = previousScroll;
  const edges = all.flatMap(id => (def(content, id).requires ?? []).map(from => ({ from, to: id, className: research.unlockedIds.includes(from) ? 'done' : '' })));
  const draw = () => { drawTreeLinks(tree, root.querySelector<SVGSVGElement>('.tech-links')!, 'data-tree-node', edges); highlight(root, content, selected); };
  observer?.disconnect();
  observer = new ResizeObserver(draw);
  observer.observe(tree);
  draw();
  select(root, context, selected!);
}
