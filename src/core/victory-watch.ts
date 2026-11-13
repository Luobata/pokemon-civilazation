// Gameplay v26 D (docs/design/depth-v26.md §5.5, option 9A): a public warning when any civilization reaches 75% of a victory route.
// Information, not compensation: each (civilization, route) warns once, the warnings are in every view (`expansion.victoryWatch`) and
// the AI's cultural defence reads them. Progress uses the same numbers as the victory checks; all integer, by player id.
import { lateTuning } from '../content/depth-v26.ts';
import { victoryTargets } from '../content/opening.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { FAITH_RULES } from '../content/faith-legends.ts';
import type { Content } from '../content/units.ts';
import { CONTEST_RULES } from './contests.ts';
import { faithCities } from './faith-legends.ts';
import type { EventPayload, GameState } from './model.ts';

export type VictoryRoute = 'conquest' | 'pokedex' | 'origin' | 'championship' | 'contest' | 'faith';
export const VICTORY_ROUTES: readonly VictoryRoute[] = ['conquest', 'pokedex', 'origin', 'championship', 'contest', 'faith'];
/** playerId -> route -> the round of its warning (each route warns once). */
export type VictoryWatchState = Record<number, Partial<Record<VictoryRoute, number>>>;
export type VictoryWatchAlarm = { playerId: number; route: VictoryRoute; percent: number; round: number };
/** Every warning so far, oldest first (public). */
export type VictoryWatchView = VictoryWatchAlarm[];
export type VictoryWatchEvent = { type: 'VictoryWatchAlarm'; public: true; playerId: number; route: VictoryRoute; percent: number };

/** Per-route progress of one civilization in percent (floored; 100 = the route's target). */
export function victoryProgress(state: GameState, playerId: number): Record<VictoryRoute, number> {
  const exp = state.expansion!, alive = state.turnOrder.filter(id => !state.players[id].eliminated), rivals = alive.filter(id => id !== playerId);
  const percent = (value: number, target: number) => target > 0 ? Math.floor(Math.min(value, target) * 100 / target) : 0;
  const pokedex = Object.values(exp.world.players[playerId]?.pokedex ?? {}).filter(record => record.observed && (record.battled || record.captured)).length;
  const tablets = Object.values(exp.civilization.tabletOwners).filter(owner => owner === playerId).length;
  const titles = exp.civilization.championship.titlesByPlayer[playerId] ?? 0;
  const contests = exp.contests, appeal = contests?.[playerId]?.appeal ?? 0;
  const contestTarget = Math.max(victoryTargets(state.setup).contestMinimum, ...rivals.map(id => Math.ceil(CONTEST_RULES.winRatio * Math.max(1, contests?.[id]?.appeal ?? 0))));
  const faith = exp.faith, counted = faithCities(state);
  const followers = faith?.faiths[playerId] ? counted.filter(city => faith.cityFaith[city.id] === playerId).length : 0;
  return {
    conquest: percent(state.turnOrder.length - alive.length, state.turnOrder.length - 1),
    pokedex: percent(pokedex, exp.world.victory?.targetDocumentedSpecies ?? Infinity),
    origin: percent(tablets, CIVILIZATION_CONTENT.sanctuaries.definitions.length),
    championship: percent(titles, (state.setup.gameplayVersion ?? 0) >= 21 ? victoryTargets(state.setup).championshipTitles : CIVILIZATION_CONTENT.championship.titlesNeededForVictory),
    contest: contests ? percent(appeal, contestTarget) : 0,
    faith: faith ? percent(followers, Math.max(victoryTargets(state.setup).faithMinimumCities, Math.ceil(counted.length * FAITH_RULES.winShare))) : 0,
  };
}
/** No flag of its own: it comes with the late-game lanes (the v26 content sets them all). */
export function initializeVictoryWatch(state: GameState, content: Content): void {
  if (content.contestSeasons && state.expansion) state.expansion.victoryWatch = {};
}
export function resolveVictoryWatchRound(state: GameState, content: Content): EventPayload[] {
  const watch = state.expansion?.victoryWatch;
  if (!watch || state.outcome) return [];
  const threshold = lateTuning(content).watchPercent, events: EventPayload[] = [];
  for (const playerId of state.turnOrder.filter(id => !state.players[id].eliminated).sort((a, b) => a - b)) {
    const progress = victoryProgress(state, playerId), warned = watch[playerId] ??= {};
    for (const route of VICTORY_ROUTES) {
      if (warned[route] !== undefined || progress[route] < threshold || progress[route] >= 100) continue;
      warned[route] = state.round;
      events.push({ type: 'VictoryWatchAlarm', public: true, playerId, route, percent: progress[route] });
    }
  }
  return events;
}
/** Public: who has been warned about on which route (the percent is the current one, so the alarm stays meaningful). */
export function observeVictoryWatch(state: GameState): VictoryWatchView | undefined {
  const watch = state.expansion?.victoryWatch;
  if (!watch) return undefined;
  return Object.entries(watch).flatMap(([id, routes]) => {
    const playerId = Number(id);
    if (state.players[playerId]?.eliminated) return [];
    const progress = victoryProgress(state, playerId);
    return VICTORY_ROUTES.filter(route => routes[route] !== undefined).map(route => ({ playerId, route, percent: progress[route], round: routes[route]! }));
  }).sort((a, b) => b.percent - a.percent || a.playerId - b.playerId || VICTORY_ROUTES.indexOf(a.route) - VICTORY_ROUTES.indexOf(b.route));
}
