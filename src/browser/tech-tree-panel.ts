// Gameplay v22 research screen (docs/design/world-v22.md §B): a horizontally scrolling node tree with connector lines.
// Nodes show name, cost / ≈rounds and small unlock marks; state (done / current / researchable / locked) reads at a
// glance. Clicking a node shows its details beside the tree with 研究此项; hovering or selecting highlights the
// prerequisite chain. The compact select stays as the keyboard path (R / T focuses it).
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

const COLUMN_NAMES = ['启程', '探索', '发展', '联盟', '精英', '传说'];
const UNLOCK_MARK: Record<TechUnlock['kind'], string> = { effect: '效', building: '建', district: '区', recruit: '招', class: '秘', improvement: '改' };
const UNLOCK_LABEL: Record<TechUnlock['kind'], string> = { effect: '效果', building: '建筑', district: '设施区', recruit: '招募', class: '秘传', improvement: '改良' };

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
function stateOf(context: TreeContext, id: TechId): 'done' | 'active' | 'available' | 'locked' {
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
  const found = context.view.expansion?.discoveries?.includes(id);
  const percent = state === 'done' ? 100 : Math.min(100, Math.round(research.progressByTech[id] * 100 / tech.cost));
  const marks = techUnlocks(id, context.content, context.view.gameplayVersion)
    .map(item => `<span class="unlock-mark ${item.kind}" title="${UNLOCK_LABEL[item.kind]}：${item.text}">${UNLOCK_MARK[item.kind]}</span>`).join('');
  const line = TECH_LINES[tech.line ?? 'capture'];
  const status = state === 'done' ? '✓ 已完成' : state === 'active' ? '▶ 研究中' : state === 'available' ? '可研究' : '未解锁';
  return `<button type="button" class="tech-node ${state}${selected === id ? ' selected' : ''}" data-tree-node="${id}" style="grid-column:${tech.tier};grid-row:${row + 1};--line:${line.color}"
      aria-pressed="${selected === id}" aria-label="${tech.name} · ${stateLabel(context, id)}">
      <span class="node-head"><strong>${tech.name}</strong>${found ? '<span class="node-eureka" title="图鉴发现已触发">★</span>' : ''}</span>
      <span class="node-meta"><span class="node-cost">${tech.cost} 科研</span><span class="node-rounds">${state === 'done' ? status : `${status} · ≈${roundsLeft(context, id)} 轮`}</span></span>
      <span class="node-progress" aria-hidden="true"><span style="width:${percent}%"></span></span>
      <span class="node-marks">${marks}</span>
    </button>`;
}

function detailMarkup(context: TreeContext, id: TechId): string {
  const { content, view } = context, tech = def(content, id), state = stateOf(context, id), research = view.economy.player.research;
  const found = view.expansion?.discoveries;
  const requires = (tech.requires ?? []).map(item => `<li class="${research.unlockedIds.includes(item) ? 'met' : 'missing'}">${research.unlockedIds.includes(item) ? '✓' : '✗'} ${def(content, item).name}</li>`).join('');
  const leadsTo = ids(content).filter(other => def(content, other).requires?.includes(id)).map(other => def(content, other).name).join('、');
  const unlocks = techUnlocks(id, content, view.gameplayVersion).map(item => `<li class="${item.kind}"><span class="unlock-mark ${item.kind}" aria-hidden="true">${UNLOCK_MARK[item.kind]}</span>${item.text}</li>`).join('');
  const discovery = discoveryText(id, Boolean(content.opening));
  const eureka = found ? `<div class="tech-eureka ${found.includes(id) ? 'hit' : ''}"><span class="eureka-mark" aria-hidden="true">${found.includes(id) ? '★' : '☆'}</span><div><b>图鉴发现 · ${discovery.name}</b><small>${discovery.hint}${found.includes(id) ? ` · 已触发 +${DISCOVERY_PERCENT}%` : ` · 达成后 +${DISCOVERY_PERCENT}%`}</small></div></div>` : '';
  const missing = missingPrerequisites(view.economy.player, id, content);
  const action = state === 'available' ? `<button type="button" class="primary" data-tech="${id}" ${context.disabled ? 'disabled' : ''}>研究此项</button>`
    : state === 'locked' ? `<p class="tech-locked-reason" id="tech-locked-reason">需要先完成：${missing.map(item => def(content, item).name).join('、')}</p>`
    : state === 'active' ? '<p class="tech-state">正在研究</p>' : '<p class="tech-state">已完成</p>';
  const line = TECH_LINES[tech.line ?? 'capture'];
  return `<header><strong>${tech.name}</strong><span class="line-chip" style="--line:${line.color}">${line.name}</span></header>
    <p class="tech-state">第 ${tech.tier} 列「${COLUMN_NAMES[tech.tier - 1]}」 · ${tech.cost} 科研（已有 ${state === 'done' ? tech.cost : research.progressByTech[id]}）${state === 'done' ? '' : ` · 按每轮 ${context.perRound} 科研约 ${roundsLeft(context, id)} 轮`}</p>
    <p class="tech-state">${stateLabel(context, id)}</p>
    <h4>前置科技（全部完成）</h4>${requires ? `<ul class="tech-requires">${requires}</ul>` : '<p class="tech-state">无前置，开局即可研究</p>'}
    <h4>解锁</h4><ul class="tech-unlocks">${unlocks}</ul>
    ${leadsTo ? `<h4>通往</h4><p class="tech-state">${leadsTo}</p>` : ''}
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
      <div class="research-summary"><div><small>当前研究</small><strong id="research-status">${current ? `${def(content, current).name} ${research.progressByTech[current]}/${def(content, current).cost}` : '未选课题，科研进入储备'}</strong>
        <span>每轮科研 ${perRound} · 储备 ${research.reserve} · 已完成 ${research.unlockedIds.length}/${all.length}${found ? ` · 图鉴发现 ${found.length}/${all.length} ${civHint('discovery')}` : ''}</span></div>
        <div class="research-controls"><label>研究课题<select id="research-topic" ${disabled ? 'disabled' : ''}><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>第${def(content, id).tier}列 ${def(content, id).name} ${research.progressByTech[id]}/${def(content, id).cost}${found?.includes(id) ? ' ★' : ''}</option>`).join('')}</select></label>
        <button id="set-research" ${disabled || !topics.length ? 'disabled' : ''}>选择研究</button></div></div>
      ${current ? `<div class="research-progress" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ''}
    </section>
    <p class="tech-tree-help">科技有<strong>指定前置</strong>：连线左端的科技全部完成后才能研究。悬停或选中一项会高亮它的前置链。滚轮、触控板或 ←/→ 键左右浏览。</p>
    <ul class="tech-line-legend" aria-label="科技路线">${TECH_LINE_IDS.map(line => `<li style="--line:${TECH_LINES[line].color}">${TECH_LINES[line].name}</li>`).join('')}
      <li class="legend-state done">已完成</li><li class="legend-state active">研究中</li><li class="legend-state available">可研究</li><li class="legend-state locked">未解锁</li></ul>
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
