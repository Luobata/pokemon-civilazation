// Gameplay v27 ⑥ (docs/design/pace-v27.md §7.4): the league trainers in the interface — the original pixel portrait (one per archetype,
// `public/trainers/<id>.svg`), the trainer chip (portrait + name, hover or focus opens the profile card) and the profile card itself:
// title and personality, primary / secondary type badges, the signature Pokémon (star), titles and the record against the viewer, and
// the nemesis mark. Reads only public information: the roster of the setup (seed, regional Pokédex) and the season history.
import type { ChampionshipSeason } from '../core/civilization-systems.ts';
import { leagueArchetype, leagueNemesis, leagueRecords, leagueRoster, leagueTrainerId, signatureEvolved } from '../core/league-roster.ts';
import type { LeagueRecord, LeagueTrainer } from '../core/league-roster.ts';
import type { PlayerView } from '../core/model.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { contentForView } from '../content/units.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, statChip, typeBadge, uiIcon } from './ui-icons.ts';
import '../trainer-card.css';

export const trainerArtPath = (trainer: Pick<LeagueTrainer, 'id'>): string => `/trainers/${trainer.id}.svg`;
const history = (view: PlayerView): readonly ChampionshipSeason[] => view.expansion?.civilization?.championship.history ?? [];

/** The game's league roster as the viewer knows it (empty before v27). */
export function viewLeagueRoster(view: PlayerView): LeagueTrainer[] {
  const content = contentForView(view);
  return content.leagueTrainers ? leagueRoster(view.seed, content) : [];
}
/** The roster trainer behind an entrant id (null for civilizations, rivals and the v26 NPC teams). */
export function viewLeagueTrainer(view: PlayerView, entrantId: string): LeagueTrainer | null {
  return leagueTrainerId(entrantId) ? viewLeagueRoster(view).find(trainer => trainer.entrantId === entrantId) ?? null : null;
}
/** The viewer's nemesis among the roster trainers (the one who has beaten it most), or null. */
export function viewNemesis(view: PlayerView): LeagueTrainer | null {
  const nemesis = leagueNemesis(history(view), view.playerId);
  return nemesis ? viewLeagueTrainer(view, nemesis.entrantId) : null;
}
export const trainerDisplayName = (trainer: Pick<LeagueTrainer, 'title' | 'name'>): string => `${trainer.title} ${trainer.name}`;
export function trainerPortrait(trainer: LeagueTrainer, size: number, className = ''): string {
  return artImage(trainerArtPath(trainer), { size, label: `${trainerDisplayName(trainer)}的头像`, className: `trainer-portrait${className ? ` ${className}` : ''}` });
}
const emptyRecord = (trainer: LeagueTrainer): LeagueRecord => ({ entrantId: trainer.entrantId, seasons: [], titles: 0, wins: 0, losses: 0, versus: {} });

/** The profile card body (hover / focus on a trainer chip; also drawn inline by the tests' screenshots). */
export function trainerProfileMarkup(view: PlayerView, trainer: LeagueTrainer): string {
  const content = contentForView(view), archetype = leagueArchetype(trainer), seasons = history(view);
  const record = leagueRecords(seasons).get(trainer.entrantId) ?? emptyRecord(trainer), versus = record.versus[view.playerId] ?? { wins: 0, losses: 0 };
  const nemesis = viewNemesis(view)?.id === trainer.id, next = view.expansion?.civilization?.championship.nextSeason ?? 1;
  const ace = signatureEvolved(next) ? trainer.signature.finalId : trainer.signature.earlyId, aceName = content.species[ace]?.name ?? ace;
  const line = nemesis ? archetype.lines.nemesis : versus.losses > 0 ? archetype.lines.beaten : signatureEvolved(next) && record.seasons.some(season => !signatureEvolved(season)) ? archetype.lines.evolved : archetype.lines.greet;
  return `<div class="tc-head">${trainerPortrait(trainer, 64)}<div><b class="tc-name">${escapeAttr(trainer.name)}</b><small class="tc-title">${escapeAttr(trainer.title)}${nemesis ? ` · ${uiIcon('rival', { size: 12 })}<span class="tc-nemesis">你的宿敌</span>` : ''}</small>
      <span class="tc-types">${typeBadge(trainer.primaryType, 18, `主属性：${TYPE_NAMES[trainer.primaryType]}`)}${typeBadge(trainer.secondaryType, 18, `副属性：${TYPE_NAMES[trainer.secondaryType]}`)}</span></div></div>
    <p class="tc-personality">${escapeAttr(archetype.personality)}</p>
    <p class="tc-ace">${uiIcon('star', { size: 14, label: '招牌宝可梦' })}招牌 ${artImage(pokemonSpritePath(ace), { size: 32, label: aceName })}<b>${escapeAttr(aceName)}</b>${ace !== trainer.signature.finalId ? `<small>（第 3 届进化）</small>` : ''}</p>
    <p class="tc-record">${statChip('trophy', record.titles, '冠军头衔')}${statChip('check', `${versus.losses}`, '你胜')}${statChip('swords', `${versus.wins}`, '你负')}<small>出场 ${record.seasons.length} 届 · 总战绩 ${record.wins} 胜 ${record.losses} 负</small></p>
    <p class="tc-line">“${escapeAttr(line)}”</p>`;
}
/** A trainer chip: portrait (+ optional inner markup); hover or focus shows the profile card (`data-trainer-card`). */
export function trainerChip(view: PlayerView, trainer: LeagueTrainer, size = 20, inner = ''): string {
  const nemesis = viewNemesis(view)?.id === trainer.id;
  return `<span class="trainer-chip${nemesis ? ' nemesis' : ''}" tabindex="0" data-trainer-card="${trainer.id}" aria-label="${escapeAttr(`${trainerDisplayName(trainer)}${nemesis ? '（你的宿敌）' : ''}：查看训练家资料`)}">${trainerPortrait(trainer, size)}${inner}</span>`;
}
/** §7.4 the roster strip: all trainers, met ones in colour, the others as silhouettes; the viewer's nemesis marked. */
export function leagueRosterMarkup(view: PlayerView): string {
  const roster = viewLeagueRoster(view);
  if (!roster.length) return '';
  const records = leagueRecords(history(view)), nemesis = viewNemesis(view);
  return `<ul class="league-roster-strip" aria-label="联盟名册">${roster.map(trainer => {
    const met = (records.get(trainer.entrantId)?.seasons.length ?? 0) > 0;
    return `<li class="${met ? 'met' : 'unmet'}${nemesis?.id === trainer.id ? ' nemesis' : ''}" data-roster-trainer="${trainer.id}">${trainerChip(view, trainer, 40)}<small>${escapeAttr(trainer.name)}</small>${nemesis?.id === trainer.id ? uiIcon('rival', { size: 14, label: '宿敌' }) : ''}</li>`;
  }).join('')}</ul>`;
}

let host: HTMLElement | null = null, current: (() => PlayerView | null) | null = null;
function place(anchor: HTMLElement): void {
  if (!host) return;
  const box = anchor.getBoundingClientRect(), width = host.offsetWidth, height = host.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2));
  const below = box.bottom + 8 + height <= window.innerHeight;
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(below ? box.bottom + 8 : Math.max(8, box.top - height - 8))}px`;
}
function show(anchor: HTMLElement): void {
  const view = current?.(), trainer = view ? viewLeagueRoster(view).find(item => item.id === anchor.dataset.trainerCard) : undefined;
  if (!view || !trainer) return;
  if (!host?.isConnected) {
    host = document.createElement('aside');
    host.id = 'trainer-card'; host.className = 'trainer-card'; host.setAttribute('role', 'tooltip');
    document.body.append(host);
  }
  host.innerHTML = trainerProfileMarkup(view, trainer);
  host.dataset.trainer = trainer.id; host.hidden = false;
  anchor.setAttribute('aria-describedby', 'trainer-card');
  place(anchor);
}
function hide(): void { if (host) host.hidden = true; }
/** Once per page: chips anywhere (bracket, result card, lineup picker, world page) open the profile card on hover and focus. */
export function installTrainerCards(view: () => PlayerView | null): void {
  current = view;
  if (document.documentElement.dataset.trainerCards) return;
  document.documentElement.dataset.trainerCards = '1';
  const chip = (event: Event) => (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-trainer-card]') ?? null;
  document.addEventListener('mouseover', event => { const anchor = chip(event); if (anchor) show(anchor); });
  document.addEventListener('mouseout', event => { const anchor = chip(event); if (anchor && !anchor.contains(event.relatedTarget as Node | null)) hide(); });
  document.addEventListener('focusin', event => { const anchor = chip(event); if (anchor) show(anchor); else hide(); });
  // Escape closes an open card first (and only the card: the screen underneath stays open).
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !host || host.hidden) return;
    hide(); event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true });
}
