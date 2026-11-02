import { LEADER_IDS, LEADERS } from '../content/leaders.ts';
import type { LeaderId } from '../content/leaders.ts';
import { speciesDisplay } from '../content/species.ts';
import { LEADER_DOCTRINES } from '../core/leader-doctrines.ts';
import type { PlayerView } from '../core/model.ts';
import '../leaders.css';

export const leaderArtPath = (id: LeaderId) => `/leaders/${id}.svg`;

export function renderLeaderSetup(): void {
  const root = document.querySelector<HTMLElement>('#leader-options')!;
  root.innerHTML = LEADER_IDS.map(id => {
    const leader = LEADERS[id];
    const peak = (['early', 'middle', 'late'] as const).filter(phase => {
      const window = LEADER_DOCTRINES[id][phase];
      return window.researchBonus || window.movementBonus || window.trainedXpBonus || window.territoryHealingBonus || window.fieldHealing || window.cityDamageBonus;
    }).map(phase => ({ early: '早', middle: '中', late: '后' })[phase]).join('/');
    return `<label class="leader-choice"><input type="radio" name="leader" value="${id}" data-leader-choice="${id}" aria-describedby="leader-setup-note" ${id === 'oak' ? 'checked' : ''}><img class="leader-choice-art" src="${leaderArtPath(id)}" width="64" height="64" alt="" aria-hidden="true"><span class="leader-choice-name">${leader.name}</span><span class="leader-choice-specialty">${leader.specialty} · ${leader.title}</span><strong class="leader-choice-ability">${leader.ability}${peak ? `<em class="leader-peak">发力 ${peak}期</em>` : ''}</strong><span class="leader-choice-description">${leader.description}</span></label>`;
  }).join('');
}

export function selectedLeaderId(): LeaderId {
  const value = document.querySelector<HTMLInputElement>('input[name="leader"]:checked')?.value;
  return LEADER_IDS.includes(value as LeaderId) ? value as LeaderId : 'oak';
}

let rendered = '';
export function renderLeaderPanel(view: PlayerView): void {
  const { player } = view.economy;
  const signature = JSON.stringify([player.leaderId, player.starterId]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#leader-panel')!;
  const leader = player.leaderId === undefined ? null : LEADERS[player.leaderId];
  const starterName = speciesDisplay(player.starterId).name;
  root.innerHTML = `<div class="subpanel-head"><strong>当前领袖</strong><span>${leader ? '本局生效' : '旧局规则'}</span></div>
    ${leader ? `<div class="current-leader"><img class="current-leader-art" src="${leaderArtPath(leader.id)}" width="72" height="72" alt="${leader.name}像素头像"><div class="current-leader-copy"><strong>${leader.name}</strong><small>${leader.specialty} · ${leader.title}</small><span class="current-leader-ability">${leader.ability}</span></div><p class="current-leader-description">${leader.description}</p></div>` : '<div class="current-leader legacy"><div class="current-leader-copy"><strong>氏族领袖</strong><p class="current-leader-description">此存档沿用原有御三家羁绊，经典领袖需开启新游戏</p></div></div>'}
    <div class="current-leader-footer"><span>当前御三家 · ${starterName}</span><button id="choose-leader" type="button">选择下局领袖</button></div>`;
  root.querySelector<HTMLButtonElement>('#choose-leader')!.addEventListener('click', () => {
    const setup = document.querySelector<HTMLElement>('#leader-setup')!;
    const selected = document.querySelector<HTMLInputElement>('input[name="leader"]:checked');
    setup.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    (selected && !selected.disabled ? selected : setup).focus({ preventScroll: true });
  });
}
