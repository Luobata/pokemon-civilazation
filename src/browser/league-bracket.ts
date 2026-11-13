// depth-v26 §6.2 (presentation only): the league conference bracket — two preliminaries, two semi-finals (the two
// strongest teams enter there), the final and the champion. Each slot is the team's flag (civilization colour, or an
// original trainer icon for league trainers), its lead Pokémon's sprite and its HP left after the match; the lines light
// up along the champion's path (gold) and the viewer's (accent). Every match can open its replay (`data-league-replay`).
// Self-contained markup + CSS so other pages (the world page) can reuse it; reads only the public season record.
import type { ChampionshipEntrant, ChampionshipMatch, ChampionshipSeason } from '../core/civilization-systems.ts';
import type { PlayerView } from '../core/model.ts';
import { contentForView } from '../content/units.ts';
import { LEAGUE_MATCH_NAMES } from './battle-replay.ts';
import { FACTIONS } from './render/canvas2d.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import '../league-bracket.css';

type Label = ChampionshipMatch['label'];
const BOX = { width: 174, height: 76 }, COLUMN = 190;
/** Box positions (px): preliminary 2 feeds semi-final 1 and preliminary 1 feeds semi-final 2, so no lines cross. */
const LAYOUT: Record<Label, { x: number; y: number }> = {
  'preliminary-2': { x: 0, y: 58 }, 'preliminary-1': { x: 0, y: 238 },
  'semifinal-1': { x: COLUMN, y: 40 }, 'semifinal-2': { x: COLUMN, y: 220 }, final: { x: COLUMN * 2, y: 130 },
};
const CHAMPION = { x: COLUMN * 3, y: 112, width: 112 };
const HEIGHT = 330, WIDTH = CHAMPION.x + CHAMPION.width;
const slotY = (label: Label, slot: 0 | 1) => LAYOUT[label].y + 22 + slot * 26 + 13;
/** Which slot of the next match a match's winner takes. */
const FEEDS: Partial<Record<Label, { to: Label; slot: 0 | 1 }>> = {
  'preliminary-2': { to: 'semifinal-1', slot: 1 }, 'preliminary-1': { to: 'semifinal-2', slot: 1 }, 'semifinal-1': { to: 'final', slot: 0 }, 'semifinal-2': { to: 'final', slot: 1 },
};

export type EntrantNamer = (entrant: Pick<ChampionshipEntrant, 'playerId' | 'entrantId'>) => string;
function flag(entrant: ChampionshipEntrant, name: string): string {
  if (entrant.playerId === null) return `<span class="lb-flag npc">${uiIcon('trainer', { size: 16, label: name })}</span>`;
  return `<span class="lb-flag" style="--flag:${FACTIONS[entrant.playerId] ?? '#5F6E66'}" role="img" aria-label="${escapeAttr(name)}" title="${escapeAttr(name)}"><b aria-hidden="true">${entrant.playerId + 1}</b></span>`;
}
function slot(view: PlayerView, season: ChampionshipSeason, match: ChampionshipMatch, side: 0 | 1, names: EntrantNamer): string {
  const entrant = season.entrants.find(item => item.entrantId === match.entrantIds[side])!, content = contentForView(view), name = names(entrant);
  const won = match.winnerEntrantId === entrant.entrantId, lead = entrant.roster[0]!;
  const team = entrant.roster.map(item => content.species[item.speciesId]?.name ?? item.speciesId).join('、');
  return `<li class="league-team lb-slot${won ? ' won' : ' lost'}${entrant.playerId === view.playerId ? ' mine' : ''}${entrant.entrantId === season.championEntrantId ? ' champion' : ''}" data-entrant="${entrant.entrantId}" title="${escapeAttr(`${name}：${team}`)}">
    ${flag(entrant, name)}${artImage(pokemonSpritePath(lead.speciesId), { size: 26, label: `${name}的首发：${content.species[lead.speciesId]?.name ?? lead.speciesId}` })}
    <span class="league-team-name"><b>${escapeAttr(name)}</b></span>${statChip('heart', match.scores[side], '赛后剩余 HP 合计', 'league-score')}${won ? uiIcon('check', { size: 12, label: '胜' }) : ''}</li>`;
}
function box(view: PlayerView, season: ChampionshipSeason, match: ChampionshipMatch, names: EntrantNamer, replay: boolean): string {
  const [a, b] = match.entrantIds.map(id => season.entrants.find(entrant => entrant.entrantId === id)!), at = LAYOUT[match.label];
  const label = `${LEAGUE_MATCH_NAMES[match.label]}：${names(a)} 对 ${names(b)}，${names(match.winnerEntrantId === a.entrantId ? a : b)}胜，${match.battle.rounds.length} 回合`;
  return `<li class="league-match lb-match${match.label === 'final' ? ' final' : ''}" data-match="${match.label}" style="left:${at.x}px;top:${at.y}px" aria-label="${escapeAttr(label)}">
    <small class="league-match-head">${LEAGUE_MATCH_NAMES[match.label]} ${statChip('turns', match.battle.rounds.length, '回合数')}${replay ? `<button type="button" class="lb-replay" data-league-replay="${match.label}" aria-label="${escapeAttr(`观看回放：${LEAGUE_MATCH_NAMES[match.label]}`)}" title="观看回放">${uiIcon('play', { size: 10 })}</button>` : ''}</small>
    <ol class="league-pair">${slot(view, season, match, 0, names)}${slot(view, season, match, 1, names)}</ol></li>`;
}
/** The bracket of one season; `replay` adds a ▶ button to every match. */
export function leagueBracketMarkup(view: PlayerView, season: ChampionshipSeason, names: EntrantNamer, options: { replay?: boolean } = {}): string {
  const byLabel = new Map(season.matches.map(match => [match.label, match]));
  const champion = season.entrants.find(entrant => entrant.entrantId === season.championEntrantId)!;
  const mine = season.entrants.find(entrant => entrant.playerId === view.playerId)?.entrantId;
  const tone = (entrantId: string) => entrantId === season.championEntrantId ? 'champ' : entrantId === mine ? 'mine' : 'lit';
  const lines = season.matches.map(match => {
    const at = LAYOUT[match.label], x1 = at.x + BOX.width, y1 = at.y + BOX.height / 2 + 4, feed = FEEDS[match.label];
    const x2 = feed ? LAYOUT[feed.to].x : CHAMPION.x, y2 = feed ? slotY(feed.to, feed.slot) : CHAMPION.y + 54, mid = x1 + (x2 - x1) / 2;
    return `<path class="${tone(match.winnerEntrantId)}" d="M${x1} ${y1}H${mid}V${y2}H${x2}"/>`;
  }).join('');
  const content = contentForView(view), name = names(champion);
  return `<div class="league-bracket lb" role="group" aria-label="对阵表"><div class="lb-canvas" style="width:${WIDTH}px;height:${HEIGHT}px">
    <svg class="lb-lines" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true">${lines}</svg>
    <p class="lb-col-head" style="left:0">预选赛</p><p class="lb-col-head" style="left:${COLUMN}px">半决赛 <small>战力前二直通</small></p><p class="lb-col-head" style="left:${COLUMN * 2}px">决赛</p><p class="lb-col-head" style="left:${CHAMPION.x}px">冠军</p>
    <ol class="lb-matches">${(['preliminary-2', 'preliminary-1', 'semifinal-1', 'semifinal-2', 'final'] as const).flatMap(label => byLabel.has(label) ? [box(view, season, byLabel.get(label)!, names, options.replay ?? false)] : []).join('')}</ol>
    <section class="lb-champion${champion.entrantId === mine ? ' mine' : ''}" style="left:${CHAMPION.x}px;top:${CHAMPION.y}px;width:${CHAMPION.width}px" aria-label="${escapeAttr(`冠军：${name}`)}">
      ${uiIcon('trophy', { size: 34, label: '冠军奖杯' })}${flag(champion, name)}<b>${escapeAttr(name)}</b>
      <span class="league-team-sprites">${champion.roster.slice(0, 6).map(item => artImage(pokemonSpritePath(item.speciesId), { size: 20, label: content.species[item.speciesId]?.name ?? item.speciesId })).join('')}</span></section>
  </div></div>`;
}
