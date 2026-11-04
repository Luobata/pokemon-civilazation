import type { PlayerView } from '../core/model.ts';
import { describeTile } from './tile-info.ts';
import type { TileEntity } from './tile-info.ts';

const esc = (text: string | number) => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const TONE_LABEL = { own: '己方', peace: '和平', enemy: '敌对', neutral: '中立', wild: '野生', info: '' } as const;
const KIND_LABEL: Record<TileEntity['kind'], string> = { city: '城市', unit: '单位', resource: '资源', luxury: '奢侈品', nest: '巢穴',
  overlord: '霸主', sanctuary: '圣所', improvement: '改良', district: '设施区', construction: '施工' };

/** Click inspector for any tile: what it is, who owns it, what stands on it and what you can do. */
export function renderTilePanel(view: PlayerView, index: number | null, onSelectUnit: (id: number) => void): void {
  const root = document.querySelector<HTMLElement>('#tile-info');
  if (!root) return;
  if (index === null) { root.innerHTML = ''; root.hidden = true; return; }
  root.hidden = false;
  const info = describeTile(view, index);
  const head = `<div class="subpanel-head"><strong>${info.terrain ? `${esc(info.terrain.name)}${info.visible ? '' : ' · 记忆地形'}` : '未探索区域'}</strong><span>地块 ${index}</span></div>`;
  if (!info.terrain) {
    root.innerHTML = `${head}<p class="tile-note">还没有单位到过这里。派侦察型宝可梦探索，就能看到地形和资源。</p>`;
    return;
  }
  const y = info.yields;
  const yields = y ? `<div class="tile-yields" aria-label="耕作产出">${([['food', '食物'], ['production', '生产'], ['gold', '金币'], ['research', '科研']] as const)
    .map(([key, label]) => `<span class="tile-yield ${key}${y[key] ? '' : ' zero'}"><i></i>${label} ${y[key]}</span>`).join('')}</div>
    ${info.workable ? '' : '<p class="tile-note">雪原和火山要研究气象观测后才能耕作。</p>'}` : '<p class="tile-note">城市中心或设施区，不能单独耕作。</p>';
  const entity = (item: TileEntity) => `<article class="tile-entity tone-${item.tone}" data-entity="${item.kind}">
      <header><span class="tile-kind">${KIND_LABEL[item.kind]}</span>${TONE_LABEL[item.tone] ? `<span class="tile-tone">${TONE_LABEL[item.tone]}</span>` : ''}<strong>${esc(item.title)}</strong></header>
      <p class="tile-sub">${esc(item.subtitle)}</p>
      ${item.lines.map(line => `<p>${esc(line)}</p>`).join('')}
      ${item.hint ? `<p class="tile-hint">${esc(item.hint)}</p>` : ''}
      ${item.kind === 'unit' && item.tone === 'own' && item.unitId !== undefined ? `<button type="button" data-select-unit="${item.unitId}">选中这只宝可梦</button>` : ''}
    </article>`;
  root.innerHTML = `${head}
    <div class="tile-body">
      <p class="tile-territory tone-${info.territory.tone}">${esc(info.territory.text)}${info.workedBy !== null ? ` · 城市 ${info.workedBy} 正在耕作` : ''}</p>
      ${info.entities.map(entity).join('')}
      <section class="tile-terrain" aria-label="地形">
        <p class="section-label">耕作这一格</p>${yields}
        <dl><dt>移动消耗</dt><dd>${info.terrain.moveCost}</dd><dt>可进入</dt><dd>${esc(info.terrain.access)}</dd>
        ${info.terrain.defense ? `<dt>战斗</dt><dd>${esc(info.terrain.defense)}</dd>` : ''}<dt>精华</dt><dd>${esc(info.terrain.essence)}</dd></dl>
      </section>
      ${info.visible ? '' : '<p class="tile-note">斜线表示你现在看不到这里，显示的是上次看到时的样子；单位不会显示。</p>'}
    </div>`;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-select-unit]')) button.addEventListener('click', () => onSelectUnit(Number(button.dataset.selectUnit)));
}
