import { CONTENT as BASE_CONTENT, EXPANSION_CONTENT } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { canResearch } from '../core/economy-commands.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { DISCOVERIES, DISCOVERY_PERCENT } from '../content/discoveries.ts';
import { TECH_TIERS, techUnlocks, techsInTier } from './tech-info.ts';

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
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const player = view.economy.player, research = player.research;
  const found = view.expansion?.discoveries;
  const signature = JSON.stringify([research, disabled, found]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#research-panel')!;
  const topics = (Object.keys(CONTENT.techs) as TechId[]).filter(id => canResearch(player, id));
  const current = research.techId;
  const percent = (id: TechId) => Math.min(100, Math.round(research.progressByTech[id] * 100 / CONTENT.techs[id].cost));
  const card = (id: TechId) => {
    const tech = CONTENT.techs[id], done = research.unlockedIds.includes(id), active = id === current, available = !done && canResearch(player, id);
    const state = done ? 'done' : active ? 'active' : available ? 'available' : 'locked';
    const label = done ? '已完成' : active ? `研究中 · 剩 ${tech.cost - research.progressByTech[id]}` : available ? '可研究' : '未解锁';
    const eureka = found ? `<div class="tech-eureka ${found.includes(id) ? 'hit' : ''}"><span class="eureka-mark" aria-hidden="true">${found.includes(id) ? '★' : '☆'}</span><div><b>图鉴发现 · ${DISCOVERIES[id].name}</b><small>${DISCOVERIES[id].hint}${found.includes(id) ? ` · 已触发 +${DISCOVERY_PERCENT}%` : ` · 达成后 +${DISCOVERY_PERCENT}%`}</small></div></div>` : '';
    const action = available && !active ? `<button type="button" data-tech="${id}" ${disabled ? 'disabled' : ''}>研究此项</button>` : '';
    return `<article class="tech-card ${state}" data-tech-card="${id}" aria-label="${tech.name} · ${label}">
      <header><strong>${tech.name}</strong><span class="tech-cost">${tech.cost}</span></header>
      <p class="tech-state">${label}</p>
      <div class="tech-progress" aria-hidden="true"><span style="width:${done ? 100 : percent(id)}%"></span></div>
      <ul class="tech-unlocks">${techUnlocks(id).map(item => `<li class="${item.kind}">${item.text}</li>`).join('')}</ul>
      ${eureka}${action}
    </article>`;
  };
  root.innerHTML = `<section class="research-box" aria-label="研究选择">
      <div class="research-summary"><div><small>当前研究</small><strong id="research-status">${current ? `${CONTENT.techs[current].name} ${research.progressByTech[current]}/${CONTENT.techs[current].cost}` : '未选课题，科研进入储备'}</strong>
        <span>储备科研 ${research.reserve} · 已完成 ${research.unlockedIds.length}/${Object.keys(CONTENT.techs).length}${found ? ` · 图鉴发现 ${found.length}/${Object.keys(DISCOVERIES).length}` : ''}</span></div>
        <div class="research-controls"><label>研究课题<select id="research-topic" ${disabled ? 'disabled' : ''}><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>T${CONTENT.techs[id].tier} ${CONTENT.techs[id].name} ${research.progressByTech[id]}/${CONTENT.techs[id].cost}${found?.includes(id) ? ' ★' : ''}</option>`).join('')}</select></label>
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
