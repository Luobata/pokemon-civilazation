import { victoryTargets } from '../content/opening.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { LEGENDS } from '../content/faith-legends.ts';
import { GYM_RULES_V24 } from '../content/gym-circuit.ts';
import { ESSENCES } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { PlayerView } from '../core/model.ts';
import { bannerUrl } from './victory-banners.ts';
import type { BannerId } from './victory-banners.ts';
import { escapeAttr, flagImage, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { CIV_COLORS, locateButton, selectUnitButton, worldCards } from './world-cards.ts';
import type { WorldCardId } from './world-cards.ts';
import '../world-ui.css';
import { installDataTips } from './ui-tip.ts';

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
    detail: `观察 ${records.filter(record => record.observed).length} · 捕捉 ${records.filter(record => record.captured).length}`, hint: '观察并对战或捕捉物种，完成图鉴记录。', nav: '#expansion-panel' });
  const civ = exp.civilization;
  const tablets = CIVILIZATION_CONTENT.sanctuaries.definitions.length;
  const ownTablets = Object.values(civ.tabletOwners).filter(owner => owner === view.playerId).length;
  const tabletLeader = Math.max(0, ...rivals.map(rival => Object.values(civ.tabletOwners).filter(owner => owner === rival.id).length));
  paths.push({ id: 'origin', name: '起源（石板）', value: ownTablets, target: tablets, detail: `对手最多 ${tabletLeader}`, hint: '建立圣所并击败守卫获得石板。', nav: '#expansion-panel' });
  const titles = civ.championship.titlesByPlayer;
  paths.push({ id: 'championship', name: '冠军（联盟大会）', value: titles[view.playerId] ?? 0, target: titleTarget(view),
    detail: `下一届第 ${civ.championship.nextRound} 轮 · 对手最多 ${Math.max(0, ...rivals.map(rival => titles[rival.id] ?? 0))}`, hint: '和平时报名六只宝可梦参加联盟大会。', nav: '#expansion-panel' });
  if (exp.contests) {
    const top = Math.max(0, ...exp.contests.rivals.map(rival => rival.appeal));
    paths.push({ id: 'contest', name: '华丽大赛（文化）', value: exp.contests.own.appeal, target: Math.max(exp.contests.target, Math.ceil(top * 1.5)),
      detail: `每轮 +${exp.contests.own.perRound} · 对手最高 ${top}`, hint: `人气 ≥ ${exp.contests.target} 且为每个对手 1.5 倍。`, nav: '#expansion-panel' });
  }
  if (exp.faith) {
    const mine = exp.faith.faiths.find(item => item.founderId === view.playerId);
    const top = [...exp.faith.faiths].filter(item => item.founderId !== view.playerId).sort((a, b) => b.followers - a.followers)[0];
    const missingRivals = mine ? unconvertedRivals(view).length : rivals.length;
    paths.push({ id: 'faith', name: '传说共鸣（宗教）', value: mine?.followers ?? 0, target: Math.max(victoryTargets(view).faithMinimumCities, Math.ceil(exp.faith.totalCities * exp.faith.winShare)),
      detail: `${mine ? `${LEGENDS[mine.legend].name}信仰` : '尚未创立'}${top ? ` · 对手最多 ${top.followers} 城（${LEGENDS[top.legend].name}）` : ''}${missingRivals ? ` · 仍有 ${missingRivals} 个对手未皈依` : ''}`,
      hint: '信仰城市达到全图 60%，且每个对手至少 1 城信仰。', nav: '#expansion-panel', blocked: missingRivals > 0 });
  }
  return paths;
}
const titleTarget = (view: PlayerView) => (view.gameplayVersion ?? 0) >= 21 ? victoryTargets(view).championshipTitles : CIVILIZATION_CONTENT.championship.titlesNeededForVictory;
/** Living rivals without a known city of the viewer's faith. */
function unconvertedRivals(view: PlayerView) {
  const faith = view.expansion?.faith;
  const rivals = view.civilizations.filter(civ => civ.id !== view.playerId && !civ.eliminated);
  if (!faith) return rivals;
  const knownCities = [...view.cities, ...view.economy.cities,
    ...Object.entries(view.knowledge.lastKnownCities).map(([cityId, city]) => ({ ...city, id: Number(cityId) }))];
  return rivals.filter(rival => !Object.entries(faith.cityFaith).some(([cityId, founderId]) => founderId === view.playerId
    && knownCities.some(city => city.id === Number(cityId) && city.ownerId === rival.id)));
}

// ---------- route maps (depth-v26 §6.3): milestones as named icons, done / reached / ahead ----------

type Node = { icon: string; label: string; state: 'done' | 'next' | 'todo' };
const esc = escapeAttr;
const node = (icon: string, label: string, state: Node['state']): Node => ({ icon, label, state });
const named = (name: UiIconName, label: string, size = 22) => uiIcon(name, { size, label });
const civColor = (id: number) => CIV_COLORS[id] ?? '#5F6E66';
/** First not-done node is the "next" step. */
function sequence(items: { icon: string; label: string; done: boolean }[]): Node[] {
  let next = false;
  return items.map(item => item.done ? node(item.icon, `${item.label} · 已完成`, 'done') : !next && (next = true) ? node(item.icon, `${item.label} · 下一步`, 'next') : node(item.icon, item.label, 'todo'));
}
function routeNodes(view: PlayerView, path: Path): { nodes: Node[]; groups?: number[]; denominator: string } {
  const exp = view.expansion;
  const others = view.civilizations.filter(civ => civ.id !== view.playerId);
  switch (path.id) {
    case 'conquest':
      return { nodes: others.map(civ => {
        const label = `文明 ${civ.id + 1}${civ.eliminated ? ' · 已出局' : ' · 仍在'}`;
        return node(flagImage(civColor(civ.id), { size: 22, label }), label, civ.eliminated ? 'done' : 'todo');
      }), denominator: `分母 ${path.target} = 对手文明数。攻占每个对手的联盟总部，它就出局；所有对手出局即征服胜利。` };
    case 'pokedex': {
      const steps = [1, 2, 3, 4].map(part => Math.ceil(path.target * part / 4));
      return { nodes: sequence(steps.map((count, index) => {
        const label = `图鉴 ${count} 种${index === 3 ? '（胜利）' : ''}`;
        return { icon: named(index === 3 ? 'trophy' : 'pokedex', label), label, done: path.value >= count };
      })), denominator: `分母 ${path.target} = 本局的图鉴目标（随地图轮数上限提高）。已观察、并且对战过或捕捉过的物种才算完整记录。` };
    }
    case 'origin': {
      const owners = exp?.civilization.tabletOwners ?? {};
      return { nodes: CIVILIZATION_CONTENT.sanctuaries.definitions.map(definition => {
        const owner = owners[definition.tabletId];
        const label = `石板「${definition.tabletName}」${owner === undefined ? ' · 未知' : owner === view.playerId ? ' · 你已取得' : ` · 文明 ${owner + 1} 已取得`}`;
        return node(named('tablet', label), label, owner === view.playerId ? 'done' : owner === undefined ? 'todo' : 'next');
      }), denominator: `分母 ${path.target} = 全图圣所数，每座圣所一块石板。建立圣所并击败守卫取得石板，集齐即起源胜利。` };
    }
    case 'championship': {
      const circuit = exp?.gymCircuit, won = circuit?.badges[view.playerId] ?? [];
      const badges: Node[] = circuit ? Array.from({ length: GYM_RULES_V24.gymCount }, (_, slot) => {
        const gym = circuit.gyms.find(item => item.id === won[slot]);
        return gym ? node(named(`gym:${gym.typeId}`, `${TYPE_NAMES[gym.typeId]}属性徽章 · ${ESSENCES[gym.essence].name}`, 18), '徽章', 'done')
          : node(named('badge', `徽章槽 ${slot + 1} · 空`, 18), '徽章', 'todo');
      }) : [];
      const elite = circuit ? [node(named('trophy', `四天王${circuit.eliteFour[view.playerId]?.won ? ' · 已战胜' : `（需 ${GYM_RULES_V24.gymCount} 枚徽章）`}`), '四天王',
        circuit.eliteFour[view.playerId]?.won ? 'done' : won.length >= GYM_RULES_V24.gymCount ? 'next' : 'todo')] : [];
      const titles = sequence(Array.from({ length: path.target }, (_, index) => ({ icon: named('trophy', `冠军头衔 ${index + 1}/${path.target}`), label: `头衔 ${index + 1}`, done: path.value > index })));
      return { nodes: [...badges, ...elite, ...titles], groups: circuit ? [badges.length, elite.length, titles.length] : [titles.length],
        denominator: `分母 ${path.target} = 本局（${view.roundLimit} 轮）需要的冠军头衔。每届联盟大会冠军 +1；集齐 ${GYM_RULES_V24.gymCount} 枚徽章后战胜四天王 +1，但四天王最多算 1 个。` };
    }
    case 'faith': {
      const faith = exp?.faith, mine = faith?.faiths.find(item => item.founderId === view.playerId);
      const missing = new Set(unconvertedRivals(view).map(civ => civ.id));
      const founded = [node(named('faith', mine ? `已创立${LEGENDS[mine.legend].name}信仰` : '创立传说信仰 · 下一步'), '创立', mine ? 'done' : 'next')];
      const shown = Math.min(path.target, 12);
      const cities = Array.from({ length: shown }, (_, index) => {
        const count = Math.ceil((index + 1) * path.target / shown);
        return node(named('wonder', `信仰城市 ${count}/${path.target}`, 18), '城市', path.value >= count ? 'done' : 'todo');
      });
      const rivals = view.civilizations.filter(civ => civ.id !== view.playerId && !civ.eliminated).map(civ => {
        const label = `文明 ${civ.id + 1}${missing.has(civ.id) ? ' · 还没有信仰城市' : ' · 已有信仰城市'}`;
        return node(flagImage(civColor(civ.id), { size: 18, label }), label, missing.has(civ.id) ? 'todo' : 'done');
      });
      return { nodes: [...founded, ...cities, ...rivals], groups: [founded.length, cities.length, rivals.length],
        denominator: `分母 ${path.target} = 全图城市的 60%（向上取整），且至少 ${victoryTargets(view).faithMinimumCities} 城；另外每个仍在的对手至少要有 1 座城信你的传说。` };
    }
    default:
      return { nodes: [], denominator: '' };
  }
}
/** Contest route: a track with own appeal, the top rival, the 1.5× line and the minimum. */
function contestTrack(view: PlayerView, path: Path): string {
  const contests = view.expansion!.contests!, top = Math.max(0, ...contests.rivals.map(rival => rival.appeal));
  const scale = Math.max(path.target, path.value, 1) * 1.08, at = (value: number) => `${Math.min(100, value * 100 / scale).toFixed(1)}%`;
  const mark = (value: number, icon: string, label: string, kind: string) => `<span class="track-mark ${kind}" style="left:${at(value)}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${icon}</span>`;
  return `<div class="route-track" aria-label="华丽大赛路线"><div class="track-bar"><i style="width:${at(path.value)}"></i></div>
    ${mark(contests.target, uiIcon('check', { size: 14 }), `最低人气 ${contests.target}`, 'line')}
    ${top ? mark(Math.ceil(top * 1.5), uiIcon('star', { size: 14 }), `对手最高的 1.5 倍：${Math.ceil(top * 1.5)}`, 'line') : ''}
    ${top ? mark(top, uiIcon('swords', { size: 16 }), `对手最高 ${top}`, 'rival') : ''}
    ${mark(path.value, uiIcon('ribbon', { size: 18 }), `你的人气 ${path.value}`, 'own')}</div>`;
}
const STEP_CARDS: Record<string, WorldCardId[]> = { pokedex: ['capture'], origin: ['sanctuary'], championship: ['conference', 'gym'], contest: ['contest'], faith: ['legend'] };
const BANNERS: Record<string, BannerId> = { conquest: 'conquest', pokedex: 'pokedex', origin: 'origin', championship: 'championship', contest: 'contest', faith: 'faith' };

const rendered = new WeakMap<HTMLElement, string>();
export function renderVictoryPanel(view: PlayerView): void {
  const root = document.querySelector<HTMLElement>('#victory-panel');
  if (!root) return;
  installDataTips();
  const opened = root.querySelector<HTMLDetailsElement>('details')?.open ?? false;
  const paths = victoryPaths(view);
  const percent = (path: Path) => Math.min(path.blocked ? 99 : 100, Math.round(path.value / Math.max(1, path.target) * 100));
  const best = [...paths].sort((a, b) => percent(b) - percent(a))[0];
  const cards = worldCards(view);
  const routeMarkup = (path: Path) => {
    if (path.id === 'contest' && view.expansion?.contests) return { html: contestTrack(view, path),
      denominator: `分母 ${path.target} = 最低人气 ${view.expansion.contests.target} 与“对手最高 × 1.5”中较大的一个；两条都达到才算华丽大赛胜利。` };
    const { nodes, groups, denominator } = routeNodes(view, path);
    let index = 0;
    const lists = (groups ?? [nodes.length]).map(size => nodes.slice(index, index += size)).filter(list => list.length);
    return { denominator, html: `<div class="route-map">${lists.map(list => `<ol class="route-group">${list.map(item => `<li class="route-node ${item.state}">${item.icon}</li>`).join('')}</ol>`).join('<span class="route-arrow" aria-hidden="true">›</span>')}</div>` };
  };
  const steps = (path: Path) => (STEP_CARDS[path.id] ?? []).map(id => cards.find(card => card.id === id)).filter(card => card !== undefined).slice(0, 3)
    .map(card => `<span class="route-step" data-tip="${esc(card.tip)}">${'icon' in card.art ? uiIcon(card.art.icon, { size: 16 }) : `<img class="px-art" src="${card.art.sprite}" width="16" height="16" alt="" aria-hidden="true">`}<span>${esc(card.title)} · ${esc(card.status)}</span>${card.tileIndex !== undefined ? locateButton(card.tileIndex, card.title) : card.unitId !== undefined ? selectUnitButton(card.unitId, card.title) : ''}</span>`).join('');
  const markup = `<div class="subpanel-head"><strong>胜利进度</strong><span>第 ${view.round}/${view.roundLimit} 轮 · 到期按分数</span></div>
    <p class="victory-best">最接近：<b>${best.name}</b> ${percent(best)}%</p>
    <ul class="victory-list victory-routes">${paths.map(path => {
      const route = routeMarkup(path), next = steps(path);
      return `<li data-victory="${path.id}" class="victory-route${path.id === best.id ? ' best' : ''}">
      <div class="victory-banner"><img class="banner-art" src="${bannerUrl(BANNERS[path.id] ?? 'score')}" width="240" height="48" alt="${esc(`${path.name}路线横幅`)}" draggable="false"></div>
      <div class="victory-body"><div class="victory-row"><span><b class="route-name">${path.name}</b> ${percent(path)}%</span><span class="victory-count" tabindex="0" data-tip="${esc(route.denominator)}" role="img" aria-label="${esc(`${path.name} ${path.value}/${path.target}。${route.denominator}`)}">${path.value}/${path.target}<sup aria-hidden="true">?</sup></span></div>
      <div class="victory-bar" role="progressbar" aria-label="${esc(path.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent(path)}"><i style="width:${percent(path)}%"></i></div>
      ${route.html}
      <small>${path.detail}</small>${next ? `<div class="route-steps">${next}</div>` : ''}</div></li>`;
    }).join('')}</ul>
    <section class="victory-score"><img class="banner-art" src="${bannerUrl('score')}" width="240" height="48" alt="分数路线横幅" draggable="false">
      <p><b>分数</b>：第 ${view.roundLimit} 轮结束时总分最高者获胜。还剩 ${Math.max(0, view.roundLimit - view.round)} 轮。</p></section>
    <details${opened ? ' open' : ''}><summary>各胜利条件说明</summary><ul class="victory-hints">${paths.map(path => `<li><b>${path.name}</b>：${path.hint}</li>`).join('')}<li><b>分数</b>：轮次用尽时总分最高者获胜。</li></ul></details>`;
  // Unchanged markup is not rewritten, so an open hover card keeps its anchor between refreshes.
  if (rendered.get(root) !== markup) { root.innerHTML = markup; rendered.set(root, markup); }
}
