// Playtest 2026-11b U-a: the battle log on the 动态 screen — every replay of this session: the viewer's own gym, guardian, Elite Four
// and rival duel results (battle-replay.ts store, kept for the whole session) and every league conference match (the public season
// history). Reachable from the 动态 screen and from the unit panel (a button that filters the log to that Pokémon's battles).
// Presentation only: reads the PlayerView and the client's replay store.
import type { ChampionshipMatch } from '../core/civilization-systems.ts';
import type { PlayerView } from '../core/model.ts';
import { contentForView, unitDefinition } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { LEAGUE_MATCH_NAMES, leagueMatchReplay, storedReplays } from './battle-replay.ts';
import type { BattleKind, BattleReplay } from './battle-replay.ts';
import { entrantName } from './league-card.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';

const KIND: Record<BattleKind, { icon: UiIconName; name: string }> = {
  gym: { icon: 'badge', name: '道馆挑战' }, guardian: { icon: 'tablet', name: '圣所守卫' }, elite: { icon: 'trophy', name: '四天王' },
  league: { icon: 'trophy', name: '联盟大会' }, rival: { icon: 'rival', name: '劲敌对决' },
};
const MATCHES: ChampionshipMatch['label'][] = ['preliminary-1', 'preliminary-2', 'semifinal-1', 'semifinal-2', 'final'];
/** The unit the log is filtered to (from the unit panel), or null for every battle. */
let filterUnitId: number | null = null;
export const setBattleLogFilter = (unitId: number | null) => { filterUnitId = unitId; };

function ownRow(replay: BattleReplay, index: number, content: Content): string {
  const kind = KIND[replay.kind], team = replay.battles[0]?.home ?? [];
  const name = `${kind.name} · ${replay.title}${replay.round ? ` · 第 ${replay.round} 轮` : ''} · ${replay.victory ? '胜' : '负'}：${replay.outcome}`;
  return `<li class="battle-log-row ${replay.victory ? 'won' : 'lost'}" data-battle-log="${escapeAttr(replay.key)}">
    ${uiIcon(kind.icon, { size: 22, label: kind.name })}
    <span class="battle-log-title"><b>${escapeAttr(replay.title)}</b><small>${replay.round ? `第 ${replay.round} 轮 · ` : ''}${escapeAttr(replay.outcome)}</small></span>
    <span class="battle-log-team">${team.map(member => artImage(pokemonSpritePath(member.speciesId), { size: 28, label: `出战：${content.species[member.speciesId]?.name ?? member.speciesId}` })).join('')}</span>
    ${uiIcon(replay.victory ? 'check' : 'damaged', { size: 16, label: replay.victory ? '胜利' : '落败' })}
    ${replay.estimate === undefined ? '' : statChip('clipboard', `${replay.estimate}%`, '赛前估计胜率')}
    <button type="button" class="battle-log-play" data-battle-replay="${index}" aria-label="观看回放：${escapeAttr(name)}" title="观看回放：${escapeAttr(name)}">${uiIcon('play', { size: 16 })}</button></li>`;
}

/** The log's markup: own battles (newest first; filtered to one unit if asked), then every conference season's matches. */
export function battleLogMarkup(view: PlayerView, replays: readonly BattleReplay[], unitLabel: string | null): string {
  const content = contentForView(view);
  const history = unitLabel ? [] : [...(view.expansion?.civilization?.championship.history ?? [])].reverse();
  if (!replays.length && !history.length && !unitLabel) return '';
  const head = `<div class="subpanel-head"><strong>${uiIcon('swords', { size: 18 })}战斗记录</strong>${unitLabel ? `<span class="battle-log-filter">只看 ${escapeAttr(unitLabel)} 的战斗<button type="button" id="battle-log-all" aria-label="显示全部战斗" title="显示全部战斗">×</button></span>` : `<small>本局的道馆、对决、守卫、四天王和联盟大会，都能重看</small>`}</div>`;
  const own = replays.length ? `<ol class="battle-log-list">${replays.map((replay, index) => ownRow(replay, index, content)).join('')}</ol>` : `<p class="battle-log-empty">${unitLabel ? '它还没有参加过对战。' : '还没有你自己的对战。'}</p>`;
  const league = history.map(season => `<li class="battle-log-row league" data-battle-season="${season.season}">${uiIcon('trophy', { size: 22, label: '联盟大会' })}
    <span class="battle-log-title"><b>第 ${season.season} 届联盟大会</b><small>第 ${season.round} 轮</small></span>
    <span class="battle-log-matches">${MATCHES.filter(label => season.matches.some(match => match.label === label)).map(label => `<button type="button" data-league-log="${season.season}:${label}" aria-label="观看回放：第 ${season.season} 届联盟大会 · ${LEAGUE_MATCH_NAMES[label]}" title="${LEAGUE_MATCH_NAMES[label]}">${uiIcon('play', { size: 12 })}${LEAGUE_MATCH_NAMES[label].replace('预选赛 ', '预').replace('半决赛 ', '半').replace('决赛', '决')}</button>`).join('')}</span></li>`).join('');
  return `${head}${own}${league ? `<ol class="battle-log-list league">${league}</ol>` : ''}`;
}

let rendered = '';
/** Draws the log into #battle-log (hidden while empty). `watch` opens a replay. */
export function renderBattleLog(view: PlayerView, watch: (replay: BattleReplay) => void): void {
  const root = document.querySelector<HTMLElement>('#battle-log');
  if (!root) return;
  const unit = filterUnitId === null ? undefined : view.units.find(item => item.id === filterUnitId) ?? view.recoveringUnits.find(item => item.id === filterUnitId);
  const label = filterUnitId === null ? null : unit ? `${unitDefinition(unit, contentForView(view)).name}（#${filterUnitId}）` : `#${filterUnitId}`;
  const replays = storedReplays(filterUnitId ?? undefined), markup = battleLogMarkup(view, replays, label);
  root.hidden = !markup;
  if (markup === rendered) return;
  rendered = markup; root.innerHTML = markup;
  root.querySelector('#battle-log-all')?.addEventListener('click', () => { filterUnitId = null; renderBattleLog(view, watch); });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-battle-replay]')) button.addEventListener('click', () => watch(replays[Number(button.dataset.battleReplay)]!));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-league-log]')) {
    const [seasonText, label] = button.dataset.leagueLog!.split(':') as [string, ChampionshipMatch['label']];
    const season = view.expansion?.civilization?.championship.history.find(item => item.season === Number(seasonText));
    const replay = season ? leagueMatchReplay(view, season, label, entrant => entrantName(view, entrant)) : null;
    button.disabled = !replay;
    button.addEventListener('click', () => { if (replay) watch(replay); });
  }
}
/** The unit panel's entry: a swords chip with the number of this Pokémon's recorded battles (none when it has fought none). */
export function unitBattleLogButton(unitId: number): string {
  const count = storedReplays(unitId).length;
  return count ? `<button type="button" class="unit-battle-log" id="unit-battle-log" data-unit="${unitId}" aria-label="战斗记录：${count} 场（动态页）" title="战斗记录：${count} 场（动态页）">${uiIcon('swords', { size: 16 })}<b aria-hidden="true">${count}</b></button>` : '';
}
/** Forget the log's state (new game, load). */
export function resetBattleLog(): void { filterUnitId = null; rendered = ''; }
