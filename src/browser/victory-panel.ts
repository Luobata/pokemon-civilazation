import { victoryTargets } from '../content/opening.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { LEGENDS } from '../content/faith-legends.ts';
import type { PlayerView } from '../core/model.ts';
import { dexCaptureCounts } from './dex-owned.ts';

type Path = { id: string; name: string; value: number; target: number; detail: string; hint: string; nav?: string; blocked?: boolean };
/** Civilization-style victory overview: every win path the current game enables, with own progress and the visible leader. */
export function victoryPaths(view: PlayerView): Path[] {
  const exp = view.expansion;
  const rivals = view.civilizations.filter(civ => civ.id !== view.playerId && !civ.eliminated);
  const paths: Path[] = [{
    id: 'conquest', name: '征服', value: view.civilizations.filter(civ => civ.id !== view.playerId && civ.eliminated).length, target: view.civilizations.length - 1,
    detail: `剩余对手 ${rivals.length}`, hint: '攻占对手的联盟总部即可使其出局。', nav: '#diplomacy',
  }];
  if (!exp) return paths;
  const records = Object.values(exp.world.player?.pokedex ?? {});
  const documented = records.filter(record => record.observed && (record.battled || record.captured)).length;
  paths.push({ id: 'pokedex', name: '图鉴', value: documented, target: exp.world.victory?.targetDocumentedSpecies ?? 18,
    detail: `观察 ${records.filter(record => record.observed).length} · 捕捉 ${dexCaptureCounts(view, records).caught}${dexCaptureCounts(view, records).owned ? ` · 拥有 ${dexCaptureCounts(view, records).owned}` : ''}`, hint: '观察并对战或捕捉物种，完成图鉴记录。', nav: '#expansion-panel' });
  const civ = exp.civilization;
  const tablets = CIVILIZATION_CONTENT.sanctuaries.definitions.length;
  const ownTablets = Object.values(civ.tabletOwners).filter(owner => owner === view.playerId).length;
  const tabletLeader = Math.max(0, ...rivals.map(rival => Object.values(civ.tabletOwners).filter(owner => owner === rival.id).length));
  paths.push({ id: 'origin', name: '起源（石板）', value: ownTablets, target: tablets, detail: `对手最多 ${tabletLeader}`, hint: '建立圣所并击败守卫获得石板。', nav: '#expansion-panel' });
  const titles = civ.championship.titlesByPlayer;
  paths.push({ id: 'championship', name: '冠军（联盟大会）', value: titles[view.playerId] ?? 0, target: (view.gameplayVersion ?? 0) >= 21 ? victoryTargets(view).championshipTitles : CIVILIZATION_CONTENT.championship.titlesNeededForVictory,
    detail: `下一届第 ${civ.championship.nextRound} 轮 · 对手最多 ${Math.max(0, ...rivals.map(rival => titles[rival.id] ?? 0))}`, hint: '和平时报名六只宝可梦参加联盟大会。', nav: '#expansion-panel' });
  if (exp.contests) {
    const top = Math.max(0, ...exp.contests.rivals.map(rival => rival.appeal));
    paths.push({ id: 'contest', name: '华丽大赛（文化）', value: exp.contests.own.appeal, target: Math.max(exp.contests.target, Math.ceil(top * 1.5)),
      detail: `每轮 +${exp.contests.own.perRound} · 对手最高 ${top}`, hint: `人气 ≥ ${exp.contests.target} 且为每个对手 1.5 倍。`, nav: '#expansion-panel' });
  }
  if (exp.faith) {
    const mine = exp.faith.faiths.find(item => item.founderId === view.playerId);
    const top = [...exp.faith.faiths].filter(item => item.founderId !== view.playerId).sort((a, b) => b.followers - a.followers)[0];
    const knownCities = [...view.cities, ...view.economy.cities,
      ...Object.entries(view.knowledge.lastKnownCities).map(([cityId, city]) => ({ ...city, id: Number(cityId) }))];
    const missingRivals = mine ? rivals.filter(rival => !Object.entries(exp.faith!.cityFaith).some(([cityId, founderId]) => founderId === view.playerId
      && knownCities.some(city => city.id === Number(cityId) && city.ownerId === rival.id))).length : rivals.length;
    paths.push({ id: 'faith', name: '传说共鸣（宗教）', value: mine?.followers ?? 0, target: Math.max(victoryTargets(view).faithMinimumCities, Math.ceil(exp.faith.totalCities * exp.faith.winShare)),
      detail: `${mine ? `${LEGENDS[mine.legend].name}信仰` : '尚未创立'}${top ? ` · 对手最多 ${top.followers} 城（${LEGENDS[top.legend].name}）` : ''}${missingRivals ? ` · 仍有 ${missingRivals} 个对手未皈依` : ''}`,
      hint: '信仰城市达到全图 60%，且每个对手至少 1 城信仰。', nav: '#expansion-panel', blocked: missingRivals > 0 });
  }
  return paths;
}
export function renderVictoryPanel(view: PlayerView): void {
  const root = document.querySelector<HTMLElement>('#victory-panel');
  if (!root) return;
  const opened = root.querySelector<HTMLDetailsElement>('details')?.open ?? false;
  const paths = victoryPaths(view);
  const percent = (path: Path) => Math.min(path.blocked ? 99 : 100, Math.round(path.value / Math.max(1, path.target) * 100));
  const best = [...paths].sort((a, b) => percent(b) - percent(a))[0];
  root.innerHTML = `<div class="subpanel-head"><strong>胜利进度</strong><span>第 ${view.round}/${view.roundLimit} 轮 · 到期按分数</span></div>
    <p class="victory-best">最接近：<b>${best.name}</b> ${percent(best)}%</p>
    <ul class="victory-list">${paths.map(path => `<li data-victory="${path.id}"><div class="victory-row"><span>${path.name}</span><span>${path.value}/${path.target}</span></div>
      <div class="victory-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent(path)}"><i style="width:${percent(path)}%"></i></div>
      <small>${path.detail}</small></li>`).join('')}</ul>
    <details${opened ? ' open' : ''}><summary>各胜利条件说明</summary><ul class="victory-hints">${paths.map(path => `<li><b>${path.name}</b>：${path.hint}</li>`).join('')}<li><b>分数</b>：轮次用尽时总分最高者获胜。</li></ul></details>`;
}
