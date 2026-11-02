import { CHARTER_IDS, CHARTERS, LEADER_POLICY_AFFINITY, POLICIES } from '../content/policies.ts';
import type { PolicyId, SlotKind } from '../content/policies.ts';
import { charterAvailable, fitsSlots } from '../core/policies.ts';
import type { Command, PlayerView } from '../core/model.ts';

const SLOT_LABEL: Record<SlotKind, string> = { military: '军事', economic: '经济', wild: '通配' };
let draft: PolicyId[] | null = null, draftKey = '';
/** Renders the charter tree and the policy-card editor. The draft is local until the player confirms it. */
export function renderPolicyPanel(view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const root = document.querySelector<HTMLElement>('#policy-panel')!;
  const ledger = view.expansion?.policies;
  if (!ledger) { root.innerHTML = ''; return; }
  const key = JSON.stringify([ledger.slotted, ledger.adopted]);
  if (key !== draftKey) { draft = [...ledger.slotted]; draftKey = key; }
  const opened = root.querySelector<HTMLDetailsElement>('#policy-cards')?.open ?? false;
  const current = draft ?? [...ledger.slotted];
  const affinity = new Set(view.economy.player.leaderId ? LEADER_POLICY_AFFINITY[view.economy.player.leaderId] : []);
  const changed = [...current].sort().join() !== [...ledger.slotted].sort().join();
  const valid = fitsSlots(ledger.adopted, current);
  const charter = ledger.charterId;
  const slotText = (Object.keys(SLOT_LABEL) as SlotKind[]).filter(kind => ledger.slots[kind]).map(kind => `${SLOT_LABEL[kind]} ${ledger.slots[kind]}`).join(' · ') || '尚无方针槽';
  const charters = CHARTER_IDS.map(id => {
    const done = ledger.adopted.includes(id), open = charterAvailable(ledger.adopted, id), active = charter === id;
    const progress = ledger.progressByCharter[id];
    return `<li class="charter ${done ? 'done' : active ? 'active' : open ? 'open' : 'locked'}"><div><strong>${CHARTERS[id].name}</strong><small>${done ? '已确立' : `${progress}/${CHARTERS[id].cost}`}${!done && !open ? ` · 需要 ${CHARTERS[id].requires.filter(req => !ledger.adopted.includes(req)).map(req => CHARTERS[req].name).join('、')}` : ''}</small><p>${CHARTERS[id].description}</p></div>${!done && open ? `<button type="button" data-charter="${id}" ${disabled || active ? 'disabled' : ''}>${active ? '推进中' : '设为目标'}</button>` : ''}</li>`;
  }).join('');
  const cards = ledger.unlockedPolicies.map(id => {
    const on = current.includes(id), definition = POLICIES[id];
    const wouldFit = on || fitsSlots(ledger.adopted, [...current, id]);
    return `<label class="policy-card ${on ? 'on' : ''} ${definition.slot}"><input type="checkbox" data-policy="${id}" ${on ? 'checked' : ''} ${disabled || (!on && !wouldFit) ? 'disabled' : ''}><span><strong>${definition.name}</strong><small>${SLOT_LABEL[definition.slot]}${affinity.has(id) ? ' · 领袖偏好 +50%' : ''}</small>${definition.description}</span></label>`;
  }).join('');
  const idle = charter === null && CHARTER_IDS.some(id => charterAvailable(ledger.adopted, id));
  const emptySlots = ledger.slots.military + ledger.slots.economic + ledger.slots.wild - ledger.slotted.length;
  root.innerHTML = `<div class="subpanel-head"><strong>联盟规章与训练方针${idle || (emptySlots > 0 && ledger.unlockedPolicies.length > ledger.slotted.length) ? ' <em class="needs-choice">待选择</em>' : ''}</strong><span>每轮 +${ledger.perRound} 规章点</span></div>
  <div class="policy-body">
    <p class="policy-status">${charter ? `正在制定「${CHARTERS[charter].name}」 ${ledger.progressByCharter[charter]}/${CHARTERS[charter].cost}` : ledger.adopted.length === CHARTER_IDS.length ? '全部规章已确立' : `请选择下一项规章（已暂存 ${ledger.points} 点）`}</p>
    <ul class="charter-list">${charters}</ul>
    <details id="policy-cards" ${opened || changed ? 'open' : ''}><summary>方针卡 · ${slotText} · 已用 ${ledger.slotted.length}</summary>
      ${ledger.unlockedPolicies.length ? `<div class="policy-grid">${cards}</div>` : '<p class="unit-note">确立「道馆守则」后解锁第一批方针卡。</p>'}
      <div class="policy-actions"><span>${ledger.swapCost ? `更换需 ${ledger.swapCost} 金币（确立新规章或进入新时代后免费一次）` : '本次更换免费'}</span>
      <button type="button" id="apply-policies" class="primary" ${disabled || !changed || !valid || view.economy.player.gold < ledger.swapCost ? 'disabled' : ''}>应用方针</button></div>
    </details>
  </div>`;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-charter]')) button.addEventListener('click', () => issue({ type: 'SetCharter', charterId: button.dataset.charter as never }));
  for (const box of root.querySelectorAll<HTMLInputElement>('[data-policy]')) box.addEventListener('change', () => {
    const id = box.dataset.policy as PolicyId;
    draft = box.checked ? [...current, id] : current.filter(item => item !== id);
    renderPolicyPanel(view, issue, disabled);
  });
  root.querySelector('#apply-policies')?.addEventListener('click', () => { if (draft) issue({ type: 'SetPolicies', policyIds: [...draft].sort() }); });
}
