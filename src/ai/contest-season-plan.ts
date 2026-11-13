// Gameplay v26 D (docs/design/depth-v26.md §5.2): AI contest seasons and cultural defence, view-only.
// - Cultural defence: every personality builds at least one contest hall after round 60 or its third city (aggressive ones included);
//   while a rival's appeal is at 60% of its contest target (or a near-victory warning is out on its contest route) the hall cap is one
//   higher and a show is held whenever the cooldown ends.
// - Seasons: once the category is announced, the best-scoring Pokémon within reach walks to a hall (`contestMoveTargets`) and enters.
import { CONTEST_RULES } from '../core/contests.ts';
import { contestScore, viewContestEntryBlocker } from '../core/contest-seasons.ts';
import { viewTaughtMoveType } from '../core/gold-sinks.ts';
import { lateTuning } from '../content/depth-v26.ts';
import { victoryTargets } from '../content/opening.ts';
import type { Content } from '../content/units.ts';
import { hexDistance } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { treeGateOpen } from '../core/tech-tree.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
/** A rival close to a contest win: appeal at `defencePercent` of its target, or a public near-victory warning on that route. */
export function contestThreat(view: PlayerView, content: Content): boolean {
  const contests = view.expansion?.contests;
  if (!contests) return false;
  const percent = lateTuning(content).defencePercent, minimum = victoryTargets(view).contestMinimum;
  const appeal = new Map([[view.playerId, contests.own.appeal], ...contests.rivals.map(rival => [rival.playerId, rival.appeal] as [number, number])]);
  const close = contests.rivals.some(rival => {
    const target = Math.max(minimum, ...[...appeal].filter(([id]) => id !== rival.playerId).map(([, value]) => Math.ceil(CONTEST_RULES.winRatio * Math.max(1, value))));
    return rival.appeal * 100 >= percent * target;
  });
  return close || (view.expansion?.victoryWatch ?? []).some(alarm => alarm.playerId !== view.playerId && alarm.route === 'contest');
}
const scoreOf = (view: PlayerView, unit: Pokemon, content: Content) => {
  const seasons = view.expansion!.contestSeasons!, halls = view.expansion!.contests!.own.halls.length;
  return contestScore(content, unit.speciesId, unit.xp, viewTaughtMoveType(view, unit.id), halls, seasons.category!);
};
/** The entrant for the announced season: the best score among own Pokémon within 8 tiles of a hall (lowest id on ties). */
function entrant(view: PlayerView, content: Content): { unit: Pokemon; hall: Hex } | null {
  const seasons = view.expansion?.contestSeasons, contests = view.expansion?.contests;
  if (!content.contestSeasons || !seasons?.category || seasons.ownEntry || !contests?.own.halls.length || seasons.nextRound === null || view.round > seasons.nextRound) return null;
  const halls = view.economy.cities.filter(city => contests.own.halls.includes(city.id));
  if (!halls.length) return null;
  const nearest = (unit: Pokemon) => [...halls].sort((a, b) => hexDistance(a.position, unit.position, view.map) - hexDistance(b.position, unit.position, view.map) || a.id - b.id)[0];
  const unit = view.units.filter((item): item is Pokemon => item.ownerId === view.playerId && item.kind === 'pokemon' && hexDistance(nearest(item).position, item.position, view.map) <= 8)
    .sort((a, b) => scoreOf(view, b, content) - scoreOf(view, a, content) || a.id - b.id)[0];
  return unit ? { unit, hall: nearest(unit).position } : null;
}
/** Unit id -> the hall it walks to for the season (empty before v26 or outside the entry window). */
export function contestMoveTargets(view: PlayerView, content: Content): Map<number, Hex> {
  const pick = entrant(view, content);
  return pick && hexDistance(pick.hall, pick.unit.position, view.map) > 1 ? new Map([[pick.unit.id, pick.hall]]) : new Map();
}
export function planContestSeasonAction(view: PlayerView, content: Content): Command['action'] | null {
  const contests = view.expansion?.contests, player = view.economy.player;
  if (!content.contestSeasons || !contests || view.outcome) return null;
  const pick = entrant(view, content);
  if (pick && viewContestEntryBlocker(view, pick.unit.id, content) === null) return { type: 'EnterContest', unitId: pick.unit.id };
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  const threat = contestThreat(view, content), cities = view.economy.cities.length;
  const cap = threat ? Math.ceil(cities / 3) + 1 : (view.round >= 60 || cities >= 3) ? 1 : 0;
  const pending = Object.keys(contests.own.building).length;
  // At war only the first hall, or more while a rival nears a contest win (else a long war leaves the culture race to one civilization).
  if ((!atWar || threat || !contests.own.halls.length) && pending === 0 && contests.own.halls.length < cap && treeGateOpen(player, 'contestHall') && player.gold >= CONTEST_RULES.hallGold + 20) {
    const city = view.economy.cities.filter(item => !contests.own.halls.includes(item.id) && item.capturedAtRound !== view.round)
      .sort((a, b) => b.population - a.population || a.id - b.id)[0];
    if (city) return { type: 'BuildContestHall', cityId: city.id };
  }
  // Halls in cities lost this round are still listed until the round ends; the authority only counts live ones.
  const live = contests.own.halls.filter(id => view.economy.cities.some(city => city.id === id));
  if (threat && live.length && view.round >= contests.own.showReadyAtRound && player.gold >= CONTEST_RULES.showGold) return { type: 'HoldContest' };
  return null;
}
