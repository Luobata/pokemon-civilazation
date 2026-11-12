import { CHARTER_IDS, CHARTERS, GOVERNMENT_IDS, GOVERNMENTS, LEADER_GOVERNMENT_AFFINITY, LEADER_POLICY_AFFINITY, POLICIES, POLICY_IDS } from '../content/policies.ts';
import type { CharterId, GovernmentId, PolicyId, SlotKind } from '../content/policies.ts';
import { charterAvailable, fitsSlots } from '../core/policies.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { drawTreeLinks } from './tree-links.ts';
import { civHint } from './civ-hint.ts';
import { escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import { CHARTER_ICONS, GOVERNMENT_ICONS, POLICY_ICONS, effectChips, policyChip, slotCard, slotPip } from './effect-icons.ts';

const SLOT_LABEL: Record<SlotKind, string> = { military: '军事', economic: '经济', wild: '通配' };

/** Tree depth of each charter: roots at 0, otherwise one more than its deepest requirement. */
export const CHARTER_DEPTH: Record<CharterId, number> = (() => {
  const depth = {} as Record<CharterId, number>;
  const of = (id: CharterId): number => depth[id] ??= CHARTERS[id].requires.length ? 1 + Math.max(...CHARTERS[id].requires.map(of)) : 0;
  for (const id of CHARTER_IDS) of(id);
  return depth;
})();
const unlockedBy = Object.fromEntries(POLICY_IDS.map(id => [id, CHARTER_IDS.find(charter => CHARTERS[charter].unlocks.includes(id))])) as Record<PolicyId, CharterId | undefined>;

let draft: PolicyId[] | null = null, draftKey = '';
let observer: ResizeObserver | null = null;

/** Draws requirement lines between charter cards; called whenever the tree is laid out. */
function drawLinks(root: HTMLElement) {
  const tree = root.querySelector<HTMLElement>('.charter-tree'), svg = root.querySelector<SVGSVGElement>('.charter-links');
  if (!tree || !svg) return;
  drawTreeLinks(tree, svg, 'data-charter-card', CHARTER_IDS.flatMap(id => CHARTERS[id].requires.map(requirement =>
    ({ from: requirement, to: id, className: tree.querySelector(`[data-charter-card="${requirement}"]`)!.classList.contains('done') ? 'done' : '' }))));
}

/**
 * League charters as a tree (Civilization civics): each card shows cost and progress, the slots it
 * opens and the policy cards it unlocks. Below, the slot board and the card picker; the draft is
 * local until the player presses 应用方针.
 */
export function renderPolicyPanel(view: PlayerView, issue: (action: Command['action']) => void, disabled: boolean): void {
  const root = document.querySelector<HTMLElement>('#policy-panel')!;
  const ledger = view.expansion?.policies;
  if (!ledger) { root.innerHTML = ''; return; }
  const key = JSON.stringify([ledger.slotted, ledger.adopted]);
  if (key !== draftKey) { draft = [...ledger.slotted]; draftKey = key; }
  const current = draft ?? [...ledger.slotted];
  const affinity = new Set(view.economy.player.leaderId ? LEADER_POLICY_AFFINITY[view.economy.player.leaderId] : []);
  const changed = [...current].sort().join() !== [...ledger.slotted].sort().join();
  const government = ledger.government ?? null;
  const valid = fitsSlots(ledger.adopted, current, government);
  const charter = ledger.charterId;
  const perRound = Math.max(1, ledger.perRound);

  const depthCount = Math.max(...Object.values(CHARTER_DEPTH)) + 1;
  const rowInDepth = new Map<CharterId, number>();
  for (let depth = 0; depth < depthCount; depth++) CHARTER_IDS.filter(id => CHARTER_DEPTH[id] === depth).forEach((id, row) => rowInDepth.set(id, row));
  const card = (id: CharterId) => {
    const definition = CHARTERS[id], done = ledger.adopted.includes(id), open = charterAvailable(ledger.adopted, id), active = charter === id;
    const progress = ledger.progressByCharter[id], state = done ? 'done' : active ? 'active' : open ? 'available' : 'locked';
    const remaining = Math.max(0, definition.cost - progress);
    const label = done ? '已确立' : active ? `制定中 · 约 ${Math.ceil(remaining / perRound)} 轮` : open ? `可制定 · 约 ${Math.ceil(remaining / perRound)} 轮` : `需要 ${definition.requires.filter(req => !ledger.adopted.includes(req)).map(req => CHARTERS[req].name).join('、')}`;
    const slots = (Object.entries(definition.grantsSlots) as [SlotKind, number][]).map(([kind, count]) => slotPip(kind, count, SLOT_LABEL[kind])).join('');
    const unlocks = definition.unlocks.map(policy => policyChip(policy, POLICIES[policy].slot, `方针卡「${POLICIES[policy].name}」：${POLICIES[policy].description}${affinity.has(policy) ? ' ★ 领袖偏好' : ''}`, affinity.has(policy))).join('');
    const govs = GOVERNMENT_IDS.filter(gov => GOVERNMENTS[gov].requires === id);
    const badge = done ? uiIcon('check', { size: 14, label: '已确立' }) : active ? uiIcon('play', { size: 14, label: '制定中' }) : open ? '' : uiIcon('lock', { size: 14, label: '未解锁' });
    return `<article class="charter-card ${state}" data-charter-card="${id}" style="grid-column:${CHARTER_DEPTH[id] + 1};grid-row:${rowInDepth.get(id)! + 1}">
      <header><span class="card-emblem">${uiIcon(CHARTER_ICONS[id], { size: 30 })}${badge ? `<span class="emblem-badge">${badge}</span>` : ''}</span><strong>${definition.name}</strong>${statChip('civics', definition.cost, '规章点', 'charter-cost')}</header>
      <p class="charter-state">${done ? '已确立' : open ? `${active ? '制定中' : '可制定'} ${statChip('turns', `≈${Math.ceil(remaining / perRound)}`, '约轮数')}` : label}</p>
      <div class="charter-progress" aria-hidden="true"><span style="width:${done ? 100 : Math.min(100, Math.round(progress * 100 / definition.cost))}%"></span></div>
      <div class="charter-row"><div class="charter-slots">${slots}</div>${unlocks ? `<div class="charter-unlocks">${unlocks}</div>` : ''}</div>
      ${unlocks ? '' : '<p class="charter-state">不解锁新卡，只开槽位</p>'}
      ${ledger.government !== undefined && govs.length ? `<p class="charter-government"><span class="section-mini">体制</span>${govs.map(gov => uiIcon(GOVERNMENT_ICONS[gov], { size: 20, label: `解锁体制「${GOVERNMENTS[gov].name}」` })).join('')}</p>` : ''}
      ${!done && open ? `<button type="button" data-charter="${id}" ${disabled || active ? 'disabled' : ''}>${active ? '推进中' : '设为目标'}</button>` : ''}
    </article>`;
  };

  const slotKinds = (Object.keys(SLOT_LABEL) as SlotKind[]).filter(kind => ledger.slots[kind] > 0);
  // Fill slots the way the rules count them: own-kind slots first, overflow into wild slots.
  const placed: Record<SlotKind, PolicyId[]> = { military: [], economic: [], wild: [] };
  for (const id of current) {
    const kind = POLICIES[id].slot;
    (placed[kind].length < ledger.slots[kind] ? placed[kind] : placed.wild).push(id);
  }
  const board = slotKinds.length ? `<div class="slot-board">${slotKinds.map(kind => `<div class="slot-row"><span class="slot-chip ${kind}">${slotCard(kind, SLOT_LABEL[kind])}</span>${
    Array.from({ length: ledger.slots[kind] }, (_, index) => { const id = placed[kind][index];
      return `<span class="slot ${id ? `filled ${POLICIES[id].slot}` : 'empty'}">${id ? `${uiIcon(POLICY_ICONS[id], { size: 18 })}${POLICIES[id].name}` : '空槽'}</span>`; }).join('')}</div>`).join('')}</div>`
    : '<p class="unit-note">还没有方针槽：确立「道馆守则」开放第一批槽位。</p>';
  const policyCard = (id: PolicyId) => {
    const definition = POLICIES[id], unlocked = ledger.unlockedPolicies.includes(id), on = current.includes(id);
    if (!unlocked) return `<div class="policy-card locked ${definition.slot}">${uiIcon(POLICY_ICONS[id], { size: 24, className: 'policy-icon' })}<span><strong>${definition.name}</strong><small>${SLOT_LABEL[definition.slot]} · 由「${CHARTERS[unlockedBy[id]!].name}」解锁${affinity.has(id) ? ' · 领袖偏好 +50%' : ''}</small>${definition.description}</span></div>`;
    const wouldFit = on || fitsSlots(ledger.adopted, [...current, id], government);
    return `<label class="policy-card ${on ? 'on' : ''} ${definition.slot}"><input type="checkbox" data-policy="${id}" ${on ? 'checked' : ''} ${disabled || (!on && !wouldFit) ? 'disabled' : ''}>${uiIcon(POLICY_ICONS[id], { size: 24, className: 'policy-icon' })}<span><strong>${definition.name}</strong><small>${SLOT_LABEL[definition.slot]}${affinity.has(id) ? ' · 领袖偏好 +50%' : ''}</small>${definition.description}</span></label>`;
  };
  const cardGroups = (['military', 'economic'] as const).map(kind => `<section class="policy-group"><p class="section-label">${SLOT_LABEL[kind]}方针</p><div class="policy-grid">${POLICY_IDS.filter(id => POLICIES[id].slot === kind)
    .sort((a, b) => Number(ledger.unlockedPolicies.includes(b)) - Number(ledger.unlockedPolicies.includes(a))).map(policyCard).join('')}</div></section>`).join('');

  // v11 governments: the current one, then every government with its unlock state and price.
  const leaderGovernment = view.economy.player.leaderId ? LEADER_GOVERNMENT_AFFINITY[view.economy.player.leaderId] : null;
  const governmentCard = (id: GovernmentId) => {
    const definition = GOVERNMENTS[id], available = ledger.availableGovernments?.includes(id) ?? false, active = government === id;
    const price = ledger.governmentSwapCost ?? 0;
    const slots = (Object.entries(definition.grantsSlots) as [SlotKind, number][]).map(([kind, count]) => slotPip(kind, count, SLOT_LABEL[kind])).join('');
    const action = active ? '<span class="government-current">当前体制</span>'
      : available ? `<button type="button" data-government="${id}" ${disabled || view.economy.player.gold < price ? 'disabled' : ''}>${price ? `更换 · ${price} 金` : government ? '免费更换' : '采用'}</button>`
      : `<span class="government-locked">需要「${CHARTERS[definition.requires].name}」</span>`;
    return `<article class="government-card ${active ? 'active' : available ? 'available' : 'locked'}" data-government-card="${id}">
      <header><span class="card-emblem">${uiIcon(GOVERNMENT_ICONS[id], { size: 30 })}</span><strong>${definition.name}</strong><span class="government-tier" title="第 ${definition.tier} 层">${'◆'.repeat(definition.tier)}</span>${leaderGovernment === id ? uiIcon('star', { size: 16, label: '领袖偏好：效果 +50%', className: 'government-affinity' }) : ''}</header>
      <div class="government-effects" title="${escapeAttr(definition.description)}"><div class="charter-slots">${slots}</div>${effectChips(definition.effects)}</div>
      ${action}
    </article>`;
  };
  const governments = ledger.government === undefined ? '' : `<section class="government-section" aria-label="联盟体制">
      <div class="government-head"><p class="section-label">联盟体制 ${civHint('government')}</p><span>${government ? `当前：${GOVERNMENTS[government].name}` : (ledger.availableGovernments?.length ? '尚未采用体制，第一次采用免费' : '确立「道馆守则」后可以采用第一个体制')}${government && ledger.governmentSwapCost === 0 ? ' · 下次更换免费' : ''}</span></div>
      <p class="policy-explain">体制同一时间只能有一个：提供额外方针槽和常驻加成。确立规章解锁新体制时，可以免费更换一次；其他时候更换花 ${ledger.governmentSwapCost || 60} 金。更换后方针卡放不下的会被取下。</p>
      <div class="government-grid">${GOVERNMENT_IDS.map(governmentCard).join('')}</div>
    </section>`;
  const idle = (charter === null && CHARTER_IDS.some(id => charterAvailable(ledger.adopted, id))) || (government === null && (ledger.availableGovernments?.length ?? 0) > 0);
  const emptySlots = ledger.slots.military + ledger.slots.economic + ledger.slots.wild - ledger.slotted.length;
  root.innerHTML = `<div class="subpanel-head"><strong>联盟规章与训练方针 ${civHint('charter')}${idle || (emptySlots > 0 && ledger.unlockedPolicies.length > ledger.slotted.length) ? ' <em class="needs-choice">待选择</em>' : ''}</strong><span>每轮 +${ledger.perRound} 规章点 ${civHint('charterPoints')}</span></div>
  <div class="policy-body">
    <p class="policy-status">${charter ? `正在制定「${CHARTERS[charter].name}」 ${ledger.progressByCharter[charter]}/${CHARTERS[charter].cost}` : ledger.adopted.length === CHARTER_IDS.length ? '全部规章已确立' : `请选择下一项规章（已暂存 ${ledger.points} 点）`}</p>
    <p class="policy-explain">规章点每轮来自：1 + 每座城市 1 + 每 3 人口 1 + 每 2 个改良 1 + 满意度 ≥50 时 2。确立规章会开放方针槽，并解锁新的方针卡；★ 是你的领袖偏好的卡，效果 +50%。</p>
    ${governments}
    <p class="tree-scroll-hint">← 左右滑动查看完整规章树 →</p>
    <div class="charter-tree-wrap"><div class="charter-tree" style="grid-template-columns:repeat(${depthCount}, minmax(170px, 1fr))"><svg class="charter-links" aria-hidden="true"></svg>${CHARTER_IDS.map(card).join('')}</div></div>
    <details id="policy-cards" open><summary>方针卡 ${civHint('policyCard')} · 已用 ${current.length}/${ledger.slots.military + ledger.slots.economic + ledger.slots.wild}${changed ? ' · 未应用' : ''}</summary>
      ${board}
      ${cardGroups}
      <div class="policy-actions"><span>${ledger.swapCost ? `更换需 ${ledger.swapCost} 金币（确立新规章或进入新时代后免费一次）` : '本次更换免费'}</span>
      <button type="button" id="apply-policies" class="primary" ${disabled || !changed || !valid || view.economy.player.gold < ledger.swapCost ? 'disabled' : ''}>应用方针</button></div>
    </details>
  </div>`;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-charter]')) button.addEventListener('click', () => issue({ type: 'SetCharter', charterId: button.dataset.charter as never }));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-government]')) button.addEventListener('click', () => issue({ type: 'SetGovernment', governmentId: button.dataset.government as GovernmentId }));
  for (const box of root.querySelectorAll<HTMLInputElement>('[data-policy]')) box.addEventListener('change', () => {
    const id = box.dataset.policy as PolicyId;
    draft = box.checked ? [...current, id] : current.filter(item => item !== id);
    renderPolicyPanel(view, issue, disabled);
  });
  root.querySelector('#apply-policies')?.addEventListener('click', () => { if (draft) issue({ type: 'SetPolicies', policyIds: [...draft].sort() }); });
  // Lines need real layout; the screen may still be hidden, so redraw whenever the tree resizes.
  observer?.disconnect();
  const tree = root.querySelector<HTMLElement>('.charter-tree')!;
  observer = new ResizeObserver(() => drawLinks(root));
  observer.observe(tree);
  drawLinks(root);
}
