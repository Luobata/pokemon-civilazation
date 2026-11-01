import { CONTENT } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import { canResearch } from '../core/economy-commands.ts';
import type { Command, PlayerView } from '../core/model.ts';

let rendered = '';
export function renderResearchPanel(view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const player = view.economy.player;
  const signature = JSON.stringify([player.research, disabled]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#research-panel')!;
  const topics = (Object.keys(CONTENT.techs) as TechId[]).filter(id => canResearch(player, id));
  root.innerHTML = `<div class="subpanel-head"><strong>文明研究</strong><span>所有城市共享</span></div>
    <section class="research-box" aria-label="研究选择"><div class="research-controls"><label>研究课题<select id="research-topic" ${disabled ? 'disabled' : ''}><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === player.research.techId ? 'selected' : ''}>T${CONTENT.techs[id].tier} ${CONTENT.techs[id].name} ${player.research.progressByTech[id]}/${CONTENT.techs[id].cost}</option>`).join('')}</select></label>
    <button id="set-research" ${disabled || !topics.length ? 'disabled' : ''}>选择研究</button></div><p id="research-status">当前：${player.research.techId ? CONTENT.techs[player.research.techId].name + ' ' + player.research.progressByTech[player.research.techId] + '/' + CONTENT.techs[player.research.techId].cost : '未选课题，科研进入储备'}<br>储备科研 ${player.research.reserve} · 已完成：${player.research.unlockedIds.map(id => CONTENT.techs[id].name).join('、') || '无'}</p>${player.research.techId ? `<div class="research-progress" aria-hidden="true"><span style="width:${Math.min(100, player.research.progressByTech[player.research.techId] * 100 / CONTENT.techs[player.research.techId].cost)}%"></span></div>` : ''}</section>`;
  root.querySelector('#set-research')!.addEventListener('click', () => {
    const techId = root.querySelector<HTMLSelectElement>('#research-topic')!.value as TechId;
    if (techId) issue({ type: 'SetResearch', techId });
  });
}
