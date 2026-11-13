// Gameplay v26 D (docs/design/depth-v26.md §5.2, option 5A): contest seasons — from round 45 every 15 rounds a contest with a public
// category (a rotation fixed by `stableSeed`, announced 5 rounds before), EnterContest with one Pokémon in or next to an own city with a
// contest hall (one per civilization per season, spends its action), judged at the end of the season round. Score = 20 × matching types
// (primary, secondary and the TM type, at most two) + 10 × stage + veteran rank (XP ÷ 50, at most 5) + 5 × halls (at most 4) + a
// `stableSeed` tiebreak (0–9). Placings add appeal (60 / 30 / 15, 5 for every other entrant) and the winner a ribbon. All public.
import { depth26Tuning, lateTuning } from '../content/depth-v26.ts';
import type { TypeId } from '../content/species.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { hexDistance } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';
import { taughtMoveType } from './gold-sinks.ts';

export type ContestCategory = 'cool' | 'beauty' | 'cute' | 'smart' | 'tough';
export const CONTEST_CATEGORIES: readonly ContestCategory[] = ['cool', 'beauty', 'cute', 'smart', 'tough'];
export const CONTEST_CATEGORY_INFO: Record<ContestCategory, { name: string; types: readonly TypeId[] }> = {
  cool: { name: '帅气', types: ['fire', 'fighting', 'dragon', 'steel'] },
  beauty: { name: '美丽', types: ['water', 'ice', 'flying', 'fairy'] },
  cute: { name: '可爱', types: ['normal', 'grass', 'electric', 'fairy'] },
  smart: { name: '聪明', types: ['psychic', 'ghost', 'dark', 'poison'] },
  tough: { name: '强壮', types: ['rock', 'ground', 'fighting', 'bug'] },
};
export type ContestSeasonAction = { type: 'EnterContest'; unitId: number };
export type ContestEntry = { unitId: number; speciesId: SpeciesId; score: number };
export type ContestPlacing = { playerId: number; speciesId: SpeciesId; score: number; place: number; appeal: number };
export type ContestSeasonResult = { season: number; round: number; category: ContestCategory; placings: ContestPlacing[] };
/** `entries`: this season's entrant per civilization; `ribbons`: wins per civilization; `held`: seasons judged; `last`: the latest result. */
export type ContestSeasonState = { entries: Record<number, ContestEntry>; ribbons: Record<number, number>; held: number; last: ContestSeasonResult | null };
/** `category` only once announced; `entrants`: who has entered this season (public, like the contest itself). */
export type ContestSeasonView = { nextRound: number | null; season: number; category: ContestCategory | null; announceRound: number | null;
  ribbons: Record<number, number>; ownEntry: ContestEntry | null; entrants: number[]; last: ContestSeasonResult | null };
export type ContestSeasonEvent =
  | { type: 'ContestSeasonEntered'; public: true; playerId: number; unitId: number; speciesId: SpeciesId }
  | { type: 'ContestSeasonJudged'; public: true; season: number; category: ContestCategory; placings: ContestPlacing[] };
export const isContestSeasonAction = (action: { type: unknown }): action is ContestSeasonAction => action.type === 'EnterContest';

/** Season rounds of a game (45, 60 … within the round limit). */
export function seasonRounds(content: Content, roundLimit: number): number[] {
  const tuning = lateTuning(content), rounds: number[] = [];
  for (let round = tuning.seasonFirstRound; round <= roundLimit; round += tuning.seasonInterval) rounds.push(round);
  return rounds;
}
/** The season judged at or after `round` (index and round), null after the last one. */
export function currentSeason(content: Content, round: number, roundLimit: number): { index: number; round: number } | null {
  const rounds = seasonRounds(content, roundLimit), index = rounds.findIndex(item => item >= round);
  return index < 0 ? null : { index, round: rounds[index] };
}
/** The category of season `index`: a rotation of the five with a per-game offset. */
export const seasonCategory = (seed: number, index: number): ContestCategory => CONTEST_CATEGORIES[(stableSeed(seed, 'contest-category') + index) % CONTEST_CATEGORIES.length];
/** Entry score of a Pokémon (without the tiebreak): the same numbers the panel and the AI show. */
export function contestScore(content: Content, speciesId: SpeciesId, xp: number, tmType: TypeId | undefined, halls: number, category: ContestCategory): number {
  const tuning = lateTuning(content), depth = depth26Tuning(content), species = content.species[speciesId];
  const types = new Set([species.typeId, species.secondaryTypeId, tmType].filter((type): type is TypeId => type !== undefined));
  const matching = Math.min(2, [...types].filter(type => CONTEST_CATEGORY_INFO[category].types.includes(type)).length);
  return tuning.seasonTypePoints * matching + tuning.seasonStagePoints * species.stage + Math.min(depth.veteranCap, Math.floor(xp / depth.veteranXp))
    + tuning.seasonHallPoints * Math.min(tuning.seasonHallCap, halls);
}
const liveHalls = (state: GameState, playerId: number) => (state.expansion?.contests?.[playerId]?.halls ?? []).filter(cityId => state.cities[cityId]?.ownerId === playerId);
/** Whether the entry window is open: from the announcement to the season round. */
const window = (content: Content, round: number, roundLimit: number) => {
  const season = currentSeason(content, round, roundLimit);
  return season && round >= season.round - lateTuning(content).seasonAnnounce ? season : null;
};

export function validateContestSeasonAction(state: GameState, actorId: number, action: ContestSeasonAction, content: Content): string | null {
  const ledger = state.expansion?.contestSeasons;
  if (!content.contestSeasons || !ledger || state.players[actorId]?.eliminated) return 'contest-seasons-unavailable';
  if (!window(content, state.round, state.setup.roundLimit ?? 100)) return 'season-closed';
  if (ledger.entries[actorId]) return 'season-entered';
  const unit = state.units[action.unitId];
  if (!unit || unit.ownerId !== actorId || !isMapUnit(unit) || unit.kind !== 'pokemon') return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  const halls = liveHalls(state, actorId);
  if (!halls.some(cityId => hexDistance(state.cities[cityId].position, unit.position, state.map) <= 1)) return 'season-hall';
  return null;
}
export function applyContestSeasonAction(state: GameState, actorId: number, action: ContestSeasonAction, content: Content): EventPayload[] {
  const reason = validateContestSeasonAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const ledger = state.expansion!.contestSeasons!, unit = state.units[action.unitId];
  if (!isMapUnit(unit) || unit.kind !== 'pokemon') throw new Error('Expected a deployed Pokémon');
  const season = window(content, state.round, state.setup.roundLimit ?? 100)!;
  const score = contestScore(content, unit.speciesId, unit.xp, taughtMoveType(state, unit.id), liveHalls(state, actorId).length, seasonCategory(state.setup.seed, season.index))
    + stableSeed(state.setup.seed, season.index, actorId, 'contest-tiebreak') % 10;
  ledger.entries[actorId] = { unitId: unit.id, speciesId: unit.speciesId, score };
  unit.actionLeft = 0;
  return [{ type: 'ContestSeasonEntered', public: true, playerId: actorId, unitId: unit.id, speciesId: unit.speciesId }];
}
export function initializeContestSeasons(state: GameState, content: Content): void {
  if (content.contestSeasons && state.expansion?.contests) state.expansion.contestSeasons = { entries: {}, ribbons: {}, held: 0, last: null };
}
/** Round end of a season round: rank the entrants, add appeal and the ribbon (before the contest victory is checked next round). */
export function resolveContestSeasonRound(state: GameState, content: Content): EventPayload[] {
  const ledger = state.expansion?.contestSeasons, contests = state.expansion?.contests;
  if (!content.contestSeasons || !ledger || !contests || state.outcome) return [];
  const season = currentSeason(content, state.round, state.setup.roundLimit ?? 100);
  if (!season || season.round !== state.round) return [];
  const tuning = lateTuning(content), category = seasonCategory(state.setup.seed, season.index);
  const ranked = Object.entries(ledger.entries).map(([id, entry]) => ({ playerId: Number(id), ...entry }))
    .filter(entry => !state.players[entry.playerId].eliminated).sort((a, b) => b.score - a.score || a.playerId - b.playerId);
  const placings: ContestPlacing[] = ranked.map((entry, index) => ({ playerId: entry.playerId, speciesId: entry.speciesId, score: entry.score, place: index + 1,
    appeal: tuning.seasonRewards[index] ?? tuning.seasonEntryAppeal }));
  for (const placing of placings) contests[placing.playerId].appeal += placing.appeal;
  if (placings.length) ledger.ribbons[placings[0].playerId] = (ledger.ribbons[placings[0].playerId] ?? 0) + 1;
  ledger.entries = {}; ledger.held++;
  ledger.last = { season: season.index + 1, round: state.round, category, placings };
  return [{ type: 'ContestSeasonJudged', public: true, season: season.index + 1, category, placings: placings.map(item => ({ ...item })) }];
}
export function observeContestSeasons(state: GameState, playerId: number, content: Content): ContestSeasonView | undefined {
  const ledger = state.expansion?.contestSeasons;
  if (!ledger) return undefined;
  const limit = state.setup.roundLimit ?? 100;
  // After the season round is judged, the next one is current.
  const season = currentSeason(content, ledger.last?.round === state.round ? state.round + 1 : state.round, limit);
  const announceRound = season ? season.round - lateTuning(content).seasonAnnounce : null;
  return { nextRound: season?.round ?? null, season: season ? season.index + 1 : 0, announceRound,
    category: season && state.round >= announceRound! ? seasonCategory(state.setup.seed, season.index) : null,
    ribbons: { ...ledger.ribbons }, ownEntry: ledger.entries[playerId] ? { ...ledger.entries[playerId] } : null,
    entrants: Object.keys(ledger.entries).map(Number).sort((a, b) => a - b), last: ledger.last ? JSON.parse(JSON.stringify(ledger.last)) as ContestSeasonResult : null };
}
/** View mirror of the authority's checks (null = the unit may enter now). */
export function viewContestEntryBlocker(view: PlayerView, unitId: number, content: Content): string | null {
  const seasons = view.expansion?.contestSeasons, contests = view.expansion?.contests;
  if (!content.contestSeasons || !seasons || !contests || view.activePlayerId !== view.playerId || view.outcome) return 'contest-seasons-unavailable';
  if (!seasons.category || seasons.nextRound === null || view.round > seasons.nextRound) return 'season-closed';
  if (seasons.ownEntry) return 'season-entered';
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!unit || unit.kind !== 'pokemon') return 'unit-unavailable';
  if (!unit.actionLeft) return 'no-action';
  const halls = view.economy.cities.filter(city => contests.own.halls.includes(city.id));
  return halls.some(city => hexDistance(city.position, unit.position, view.map) <= 1) ? null : 'season-hall';
}
export const CONTEST_SEASON_REASONS: Record<string, string> = {
  'contest-seasons-unavailable': '现在不能参赛', 'season-closed': '本届大赛还没开始报名（赛前 5 轮公布类别后开放）', 'season-entered': '本届已经派出参赛者',
  'unit-unavailable': '没有这只宝可梦', 'no-action': '它本轮已经行动过', 'season-hall': '要站在有大赛馆的己方城市里或旁边',
};
