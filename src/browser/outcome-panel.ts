import type { GameOutcome, PlayerView } from '../core/model.ts';

let shown = false;
function kindName(kind: GameOutcome['kind']) {
  return { conquest: '征服胜利', score: '轮上限计分', playerDefeat: '失败出局', pokedex: '图鉴胜利', origin: '起源胜利', championship: '冠军胜利', contest: '华丽大赛胜利', faith: '传说共鸣胜利' }[kind];
}
export function renderOutcome(view: PlayerView, newGame: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#gameover-dialog')!;
  const outcome = view.outcome;
  if (!outcome) { if (dialog.open) dialog.close(); shown = false; return; }
  dialog.querySelector('#outcome-title')!.textContent = kindName(outcome.kind);
  dialog.querySelector('#outcome-summary')!.textContent = outcome.winners.length ? `获胜：${outcome.winners.map(id => `文明 ${id + 1}`).join('、')} · 第 ${outcome.round} 轮` : `你在第 ${outcome.round} 轮出局。`;
  dialog.querySelector('#outcome-ranking')!.innerHTML = outcome.ranking.map((score, index) => `<tr><td>${index + 1}</td><td>文明 ${score.playerId + 1}${outcome.winners.includes(score.playerId) ? '（胜）' : ''}</td><td>${score.total}</td><td>${score.cities}×80</td><td>${score.population}×10</td><td>${score.species}×5</td><td>${score.techs}×20</td><td>${score.knockdowns}×2</td></tr>`).join('');
  dialog.querySelector<HTMLButtonElement>('#gameover-new')!.onclick = () => { dialog.close(); shown = false; newGame(); };
  dialog.querySelector<HTMLButtonElement>('#gameover-close')!.onclick = () => dialog.close();
  if (!shown && !dialog.open) { dialog.showModal(); shown = true; }
}
