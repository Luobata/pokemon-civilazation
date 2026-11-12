import { discoveryText } from '../content/discoveries.ts';
import { contentForView, techOf } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { canResearch } from '../core/economy-commands.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { DISCOVERIES, DISCOVERY_PERCENT } from '../content/discoveries.ts';
import { TECH_TIERS, techUnlocks, techsInTier } from './tech-info.ts';
import { renderTechTree } from './tech-tree-panel.ts';
import { civHint } from './civ-hint.ts';
import { statChip, uiIcon } from './ui-icons.ts';
import { TECH_ICONS, unlockPicture } from './unlock-icons.ts';
import '../ui-icons.css';

const TIER_NOTES = ['无前置', '需完成任一第一层科技', '需完成任一第二层科技'];

let rendered = '';
export function resetResearchPanel(): void {
  rendered = '';
  document.querySelector<HTMLElement>('#research-panel')!.innerHTML = '';
}

/**
 * Civilization-style research screen: a tree of tier columns. Each card shows cost and
 * progress, what it unlocks and its Pokédex discovery (eureka). The compact select above the
 * tree stays as the keyboard path (R / T focuses it).
 */
export function renderResearchPanel(view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const CONTENT = contentForView(view);
  const player = view.economy.player, research = player.research;
  const found = view.expansion?.discoveries;
  const perRound = view.economy.cities.reduce((sum, city) => sum + city.yields.research, 0);
  const signature = JSON.stringify([research, disabled, found, CONTENT.techTree ? perRound : 0]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#research-panel')!;
  // v22: the branching tree replaces the three tier columns (older games keep the page below).
  if (CONTENT.techTree) { renderTechTree(root, view, CONTENT, issue, disabled); return; }
  const tech = (id: TechId) => techOf(CONTENT, id);
  const topics = (Object.keys(CONTENT.techs) as TechId[]).filter(id => canResearch(player, id));
  const current = research.techId;
  const percent = (id: TechId) => Math.min(100, Math.round(research.progressByTech[id] * 100 / tech(id).cost));
  const card = (id: TechId) => {
    const def = tech(id), done = research.unlockedIds.includes(id), active = id === current, available = !done && canResearch(player, id);
    const state = done ? 'done' : active ? 'active' : available ? 'available' : 'locked';
    const label = done ? '已完成' : active ? `研究中 · 剩 ${def.cost - research.progressByTech[id]}` : available ? '可研究' : '未解锁';
    const eureka = found ? `<div class="tech-eureka ${found.includes(id) ? 'hit' : ''}"><span class="eureka-mark">${uiIcon('pokedex', { size: 22, label: found.includes(id) ? '图鉴发现已触发' : '图鉴发现未触发' })}</span><div><b>图鉴发现 · ${discoveryText(id, Boolean(CONTENT.opening)).name}</b><small>${discoveryText(id, Boolean(CONTENT.opening)).hint}${found.includes(id) ? ` · 已触发 +${DISCOVERY_PERCENT}%` : ` · 达成后 +${DISCOVERY_PERCENT}%`}</small></div></div>` : '';
    const action = available && !active ? `<button type="button" data-tech="${id}" ${disabled ? 'disabled' : ''}>研究此项</button>` : '';
    return `<article class="tech-card ${state}" data-tech-card="${id}" aria-label="${def.name} · ${label}">
      <header><span class="detail-icon ${state}">${uiIcon(TECH_ICONS[id], { size: 30 })}</span><strong>${def.name}</strong>${statChip('research', def.cost, '科研', 'tech-cost-icon')}</header>
      <p class="tech-state">${label}</p>
      <div class="tech-progress" aria-hidden="true"><span style="width:${done ? 100 : percent(id)}%"></span></div>
      <ul class="tech-unlocks">${techUnlocks(id, CONTENT, view.gameplayVersion).map(item => `<li class="${item.kind}"><span class="unlock-chip ${item.kind}" aria-hidden="true">${unlockPicture(item, id, 22)}</span><span>${item.text}</span></li>`).join('')}</ul>
      ${eureka}${action}
    </article>`;
  };
  root.innerHTML = `<section class="research-box" aria-label="研究选择">
      <div class="research-summary"><div><small>当前研究</small><strong id="research-status">${current ? `${tech(current).name} ${research.progressByTech[current]}/${tech(current).cost}` : '未选课题，科研进入储备'}</strong>
        <span>储备科研 ${research.reserve} · 已完成 ${research.unlockedIds.length}/${Object.keys(CONTENT.techs).length}${found ? ` · 图鉴发现 ${found.length}/${Object.keys(CONTENT.techs).filter(id => Object.hasOwn(DISCOVERIES, id)).length} ${civHint('discovery')}` : ''}</span></div>
        <div class="research-controls"><label>研究课题<select id="research-topic" ${disabled ? 'disabled' : ''}><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>T${tech(id).tier} ${tech(id).name} ${research.progressByTech[id]}/${tech(id).cost}${found?.includes(id) ? ' ★' : ''}</option>`).join('')}</select></label>
        <button id="set-research" ${disabled || !topics.length ? 'disabled' : ''}>选择研究</button></div></div>
      ${current ? `<div class="research-progress" aria-hidden="true"><span style="width:${percent(current)}%"></span></div>` : ''}
    </section>
    <div class="tech-tree">${TECH_TIERS.map(tier => `<section class="tech-tier" aria-label="第 ${tier} 层科技"><h3>第 ${tier} 层<small>${TIER_NOTES[tier - 1]}</small></h3>${techsInTier(tier).map(card).join('')}</section>`).join('')}</div>`;
  root.querySelector('#set-research')!.addEventListener('click', () => {
    const techId = root.querySelector<HTMLSelectElement>('#research-topic')!.value as TechId;
    if (techId) issue({ type: 'SetResearch', techId });
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tech]')) button.addEventListener('click', () => issue({ type: 'SetResearch', techId: button.dataset.tech as TechId }));
}
