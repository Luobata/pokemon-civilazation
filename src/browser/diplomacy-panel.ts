import type { Command, PlayerView } from '../core/model.ts';

type DiplomacyCommand = Extract<Command['action'], { type: 'DeclareWar' | 'MakePeace' | 'RespondPeace' }>;
let confirmWar: number | null = null;
let responseOpen = false;
export function hasPendingPeace(view: PlayerView) {
  return view.activePlayerId === view.playerId && view.diplomacy.some(pair => pair.proposal?.recipientId === view.playerId);
}

export function renderDiplomacyPanel(view: PlayerView, busy: boolean,
  issue: (action: DiplomacyCommand) => void): void {
  const root = document.querySelector<HTMLElement>('#diplomacy')!;
  const others = view.civilizations.filter(civilization => civilization.id !== view.playerId && !civilization.eliminated);
  const relation = (id: number) => view.diplomacy.find(pair => (pair.a === view.playerId && pair.b === id) || (pair.b === view.playerId && pair.a === id));
  root.innerHTML = `<div class="subpanel-head"><strong>外交关系</strong><span>全部公开</span></div><ul class="diplomacy-list">${others.map(civilization => {
    const pair = relation(civilization.id), status = pair?.status === 'war' ? '战争' : '和平';
    const cooldown = pair ? Math.max(0, pair.cooldownUntilRound - view.round) : 0;
    const proposal = pair?.proposal ? pair.proposal.proposerId === view.playerId ? '等待对方回应' : '待你回应' : '';
    return `<li><span><strong>文明 ${civilization.id + 1}</strong> · ${status}<small>${cooldown ? `冷却剩余 ${cooldown} 轮` : '无冷却'}${proposal ? ` · ${proposal}` : ''}</small></span><span class="diplomacy-actions"><button data-war="${civilization.id}" ${busy || pair?.status !== 'peace' ? 'disabled' : ''}>宣战</button><button data-peace="${civilization.id}" ${busy || pair?.status !== 'war' || pair.proposal ? 'disabled' : ''}>停战</button></span></li>`;
  }).join('')}</ul>`;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-war]')) button.addEventListener('click', () => {
    confirmWar = Number(button.dataset.war);
    const dialog = document.querySelector<HTMLDialogElement>('#war-confirm')!;
    dialog.querySelector('#war-target')!.textContent = `文明 ${confirmWar + 1}`;
    dialog.showModal();
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-peace]')) button.addEventListener('click', () => issue({ type: 'MakePeace', targetPlayerId: Number(button.dataset.peace) }));
  const warDialog = document.querySelector<HTMLDialogElement>('#war-confirm')!;
  warDialog.querySelector<HTMLButtonElement>('#confirm-war')!.onclick = () => { if (confirmWar !== null) issue({ type: 'DeclareWar', targetPlayerId: confirmWar }); confirmWar = null; warDialog.close(); };
  warDialog.querySelector<HTMLButtonElement>('#cancel-war')!.onclick = () => { confirmWar = null; warDialog.close(); };

  const pending = view.diplomacy.find(pair => pair.proposal?.recipientId === view.playerId);
  const response = document.querySelector<HTMLDialogElement>('#peace-response')!;
  response.oncancel = event => event.preventDefault();
  if (pending && view.activePlayerId === view.playerId) {
    const proposer = pending.proposal!.proposerId;
    response.querySelector('#peace-proposer')!.textContent = `文明 ${proposer + 1}`;
    response.querySelector<HTMLButtonElement>('#accept-peace')!.onclick = () => { response.close(); responseOpen = false; issue({ type: 'RespondPeace', targetPlayerId: proposer, accept: true }); };
    response.querySelector<HTMLButtonElement>('#reject-peace')!.onclick = () => { response.close(); responseOpen = false; issue({ type: 'RespondPeace', targetPlayerId: proposer, accept: false }); };
    if (!responseOpen && !response.open) { response.showModal(); responseOpen = true; }
  } else {
    if (response.open) response.close();
    responseOpen = false;
  }
}
