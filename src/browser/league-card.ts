// Playtest 2026-11 B1: the Pokémon League conference (联盟大会) result. The authority resolves a season into a public
// `ChampionshipResolved` event and keeps every season in `expansion.civilization.championship.history`; this module only
// reads them. It draws the result card (bracket, the viewer's placement, the champion, per-Pokémon damage from the battle
// traces) on the 动态 screen, and words the toast, the log line and the countdown notices before each season.
// depth-v26: the bracket is the sprite bracket of league-bracket.ts, and every match opens its replay (battle-viewer.ts).
import type { ChampionshipEntrant, ChampionshipMatch, ChampionshipSeason } from '../core/civilization-systems.ts';
import type { PlayerView } from '../core/model.ts';
import { contentForView } from '../content/units.ts';
import { artImage, escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import { pokemonSpritePath } from './sprites.ts';
import { leagueBracketMarkup } from './league-bracket.ts';
import { leagueMatchReplay } from './battle-replay.ts';
import type { BattleReplay } from './battle-replay.ts';
import '../league.css';
import { traceStrikes } from '../core/team-battle.ts';

/** Rounds before a season at which the countdown notice appears. */
export const LEAGUE_COUNTDOWN = [5, 1] as const;
type Placement = 'champion' | 'final' | 'semifinal' | 'preliminary';
export const PLACEMENT_NAMES: Record<Placement, string> = { champion: '冠军', final: '亚军', semifinal: '四强', preliminary: '预选赛出局' };

/** Where an entrant finished: the champion, or the stage of the match it lost. */
export function placementOf(season: ChampionshipSeason, entrantId: string): Placement {
  if (season.championEntrantId === entrantId) return 'champion';
  const lost = season.matches.find(match => match.entrantIds.includes(entrantId) && match.winnerEntrantId !== entrantId);
  return !lost ? 'semifinal' : lost.label === 'final' ? 'final' : lost.label.startsWith('semifinal') ? 'semifinal' : 'preliminary';
}
/** Display name of an entrant from the viewer's side. */
export function entrantName(view: PlayerView, entrant: Pick<ChampionshipEntrant, 'playerId' | 'entrantId' | 'name'>): string {
  if (entrant.playerId === view.playerId) return '你的队伍';
  if (entrant.playerId !== null) return `文明 ${entrant.playerId + 1}`;
  if (entrant.entrantId.startsWith('rival-')) return `劲敌${entrant.name ?? ''}`;
  return entrant.name ? `训练家 ${entrant.name}` : `联盟训练家 ${entrant.entrantId.split('-').at(-1)}`;
}
const ownEntrant = (view: PlayerView, season: ChampionshipSeason) => season.entrants.find(entrant => entrant.playerId === view.playerId) ?? null;

/** Damage each Pokémon dealt and took across the whole season (from the battle traces), with its HP afterwards. */
export function seasonDamage(season: ChampionshipSeason, entrant: ChampionshipEntrant) {
  return entrant.roster.map(combatant => {
    let dealt = 0, taken = 0;
    for (const match of season.matches) for (const strike of traceStrikes(match.battle)) {
      if (strike.attackerId === combatant.id) dealt += strike.damage;
      if (strike.defenderId === combatant.id) taken += strike.damage;
    }
    return { combatant, dealt, taken };
  });
}

// ---------- notices (wording shared by the toast, the log and the countdown) ----------

/** One line: the champion and the viewer's own result. */
export function leagueSummary(view: PlayerView, season: ChampionshipSeason): { title: string; detail: string; own: Placement | null } {
  const champion = season.entrants.find(entrant => entrant.entrantId === season.championEntrantId);
  const mine = ownEntrant(view, season), own = mine ? placementOf(season, mine.entrantId) : null;
  const titles = view.expansion?.civilization?.championship.titlesByPlayer[view.playerId] ?? 0;
  const title = own === 'champion' ? `你赢得第 ${season.season} 届联盟大会冠军！` : `第 ${season.season} 届联盟大会：${champion ? entrantName(view, champion) : '—'}夺冠`;
  const detail = own === 'champion' ? `冠军头衔 ${titles}。点开看对阵与每只宝可梦的战绩。`
    : own ? `你的队伍：${PLACEMENT_NAMES[own]}。参赛宝可梦带着战损回到地图（HP 至少 1）。`
      : '你没有报名。和平时在「世界 › 联盟大会」报名六只宝可梦。';
  return { title, detail, own };
}
export function leagueActivityText(view: PlayerView, season: ChampionshipSeason): string {
  const { title, own } = leagueSummary(view, season);
  return `${own === 'champion' ? '★ ' : ''}${title}${own && own !== 'champion' ? `（你的队伍：${PLACEMENT_NAMES[own]}）` : own ? '' : '（未参赛）'}`;
}
/** The countdown notice for this round (5 and 1 rounds before a season), or null. */
export function leagueCountdown(view: PlayerView): { rounds: number; title: string; detail: string; registered: boolean } | null {
  const league = view.expansion?.civilization?.championship;
  if (!league || league.victory || view.outcome) return null;
  const rounds = league.nextRound - view.round;
  if (!(LEAGUE_COUNTDOWN as readonly number[]).includes(rounds)) return null;
  const registered = Boolean(league.registration);
  return { rounds, registered, title: `第 ${league.nextSeason} 届联盟大会：${rounds === 1 ? '下一轮' : `${rounds} 轮后`}开幕`,
    detail: `第 ${league.nextRound} 轮结束时比赛。${registered ? `已报名，队伍战力 ${league.registration!.power}。` : '尚未报名：与所有文明和平时，在「世界 › 联盟大会」报名六只宝可梦。'}` };
}

// ---------- the result card ----------

const sprite = (view: PlayerView, speciesId: ChampionshipEntrant['roster'][number]['speciesId'], size: number, extra = '') =>
  artImage(pokemonSpritePath(speciesId), { size, label: `${contentForView(view).species[speciesId]?.name ?? speciesId}${extra}` });
function damageTable(view: PlayerView, season: ChampionshipSeason, entrant: ChampionshipEntrant): string {
  const rows = seasonDamage(season, entrant);
  const top = Math.max(1, ...rows.map(row => row.dealt));
  return `<ul class="league-damage" aria-label="${escapeAttr(entrantName(view, entrant))}每只宝可梦的战绩">${rows.map(({ combatant, dealt, taken }) => {
    const name = contentForView(view).species[combatant.speciesId]?.name ?? combatant.speciesId;
    return `<li data-unit="${combatant.unitId ?? ''}" aria-label="${escapeAttr(`${name}：造成 ${dealt} 伤害，承受 ${taken} 伤害，剩余 HP ${combatant.hp}/${combatant.maxHp}`)}">
      ${sprite(view, combatant.speciesId, 36)}
      <span class="league-bar dealt" aria-hidden="true"><i style="width:${Math.round(dealt * 100 / top)}%"></i></span>
      ${statChip('swords', dealt, '造成伤害')}${statChip('damaged', taken, '承受伤害')}${statChip('heart', `${combatant.hp}/${combatant.maxHp}`, '赛后 HP')}</li>`;
  }).join('')}</ul>`;
}
let shownSeason: number | null = null;
/** The card of one season (the latest by default); `history` chips switch between seasons. */
export function leagueResultMarkup(view: PlayerView, seasonNumber: number | null = shownSeason): string {
  const history = view.expansion?.civilization?.championship.history ?? [];
  if (!history.length) return '';
  const season = history.find(item => item.season === seasonNumber) ?? history.at(-1)!;
  const champion = season.entrants.find(entrant => entrant.entrantId === season.championEntrantId)!;
  const mine = ownEntrant(view, season), own = mine ? placementOf(season, mine.entrantId) : null;
  const seeds = [...season.entrants].sort((a, b) => b.power - a.power || a.entrantId.localeCompare(b.entrantId)).slice(0, 2);
  return `<article class="league-card" id="league-result-card" data-season="${season.season}" aria-label="第 ${season.season} 届联盟大会结果">
    <header class="league-head">${uiIcon('trophy', { size: 40, label: '联盟大会' })}<div><strong>第 ${season.season} 届联盟大会</strong><small>第 ${season.round} 轮 · 六队淘汰赛 · 战力前二直通半决赛</small></div>
      <span class="league-own ${own ?? 'absent'}" id="league-own">${own ? `${uiIcon(own === 'champion' ? 'trophy' : 'badge', { size: 20, label: '你的名次' })}你的队伍：${PLACEMENT_NAMES[own]}` : `${uiIcon('lock', { size: 18, label: '未参赛' })}本届未参赛`}</span></header>
    <section class="league-champion" aria-label="冠军">${uiIcon('crown', { size: 28, label: '冠军' })}<b>${escapeAttr(entrantName(view, champion))}</b>
      <span class="league-team-sprites">${champion.roster.map(combatant => sprite(view, combatant.speciesId, 40)).join('')}</span>${statChip('swords', champion.power, '队伍战力')}</section>
    <p class="league-seeds">${uiIcon('play', { size: 12 })}点任意一场的 ▶ 观看对战回放 · 半决赛直通：${seeds.map(seed => escapeAttr(entrantName(view, seed))).join('、')}</p>
    ${leagueBracketMarkup(view, season, entrant => entrantName(view, entrant), { replay: true })}
    <section class="league-roster"><h4>${mine ? '你的队伍 · 每只宝可梦的战绩' : `冠军队伍 · 每只宝可梦的战绩`}</h4>${damageTable(view, season, mine ?? champion)}</section>
    ${history.length > 1 ? `<nav class="league-history" aria-label="历届联盟大会">${history.map(item => `<button type="button" data-league-season="${item.season}" aria-pressed="${item.season === season.season}" title="第 ${item.season} 届：${escapeAttr(entrantName(view, item.entrants.find(entrant => entrant.entrantId === item.championEntrantId)!))}夺冠">${uiIcon('trophy', { size: 14 })}${item.season}</button>`).join('')}</nav>` : ''}
  </article>`;
}

/** The replay of one match of the shown season (null when the record does not add up). */
export function leagueReplay(view: PlayerView, label: ChampionshipMatch['label'], seasonNumber: number | null = shownSeason): BattleReplay | null {
  const history = view.expansion?.civilization?.championship.history ?? [];
  const season = history.find(item => item.season === seasonNumber) ?? history.at(-1);
  return season ? leagueMatchReplay(view, season, label, entrant => entrantName(view, entrant)) : null;
}
let rendered = '';
/** Draws the latest season's card on the 动态 screen (hidden before the first season); `watch` opens a match's replay. */
export function renderLeagueResult(view: PlayerView, watch?: (replay: BattleReplay) => void): void {
  const root = document.querySelector<HTMLElement>('#league-result');
  if (!root) return;
  const markup = leagueResultMarkup(view);
  root.hidden = !markup;
  if (markup === rendered) return;
  rendered = markup; root.innerHTML = markup;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-league-season]')) button.addEventListener('click', () => {
    shownSeason = Number(button.dataset.leagueSeason); renderLeagueResult(view, watch);
  });
  const season = Number(root.querySelector<HTMLElement>('#league-result-card')?.dataset.season);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-league-replay]')) {
    const replay = watch ? leagueReplay(view, button.dataset.leagueReplay as ChampionshipMatch['label'], season) : null;
    button.disabled = !replay;
    button.addEventListener('click', () => { if (replay) watch?.(replay); });
  }
}
/** A new season was presented: show it (not an older one the player picked earlier). */
export function showLatestLeagueSeason(): void { shownSeason = null; }
