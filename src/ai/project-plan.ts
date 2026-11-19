// Gameplay v27 ③ AI (docs/design/pace-v27.md §4.2): what an idle city queues when nothing else is worth building — planNext offers these
// only for a city with no building, district, legend, logistics unit or Pokémon to queue. Order of need: a drill when at war or a rival
// is announced against the civilization; a rehearsal while a rival is close to a contest win (`contestThreat`) or a season is announced
// and not yet entered; a festival under 50 satisfaction; otherwise the field report and the egg in turn (the cheaper next one first; the
// egg while the army is below 1.5 × the training cap), then whatever else the city can do. Only the first candidate is offered (one project per city).
// View-only: the requirement is `cityProjectBlocker` and the cost `projectCost`, the authority's own rule and function.
import { CITY_PROJECT_IDS } from '../content/pace-v27.ts';
import type { CityProjectId } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import { cityProjectBlocker, projectCost, viewCityProjectInput } from '../core/city-projects.ts';
import type { PlayerView, ProductionItem } from '../core/model.ts';
import { contestThreat } from './contest-season-plan.ts';
import { rivalThreatenedCityIds } from './rival-plan.ts';

/** Benefit of the chosen project: below every building / district / unit candidate of the same goal. */
const BENEFIT = 30;

/** Production candidates (item, benefit) for an idle city; [] before v27. */
export function cityProjectCandidates(view: PlayerView, cityId: number, content: Content): { item: ProductionItem; benefit: number }[] {
  if (!content.cityProjects) return [];
  const city = view.economy.cities.find(item => item.id === cityId);
  if (!city || city.queue.length) return [];
  const input = viewCityProjectInput(view, city, content);
  const open = CITY_PROJECT_IDS.filter(id => cityProjectBlocker(input, id) === null);
  if (!open.length) return [];
  const me = view.playerId;
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === me || pair.b === me));
  const seasons = view.expansion?.contestSeasons;
  const seasonOpen = Boolean(seasons?.category && !seasons.ownEntry && view.expansion?.cityProjects?.rehearsalSeason !== seasons.season);
  const satisfaction = view.expansion?.world.player?.satisfaction ?? 100;
  const army = view.units.filter(unit => unit.ownerId === me && unit.kind === 'pokemon').length + view.recoveringUnits.filter(unit => unit.ownerId === me).length;
  // The egg's limit is 1.5 × the training cap (planNext trains Pokémon itself below `max(4, 2 × cities)` and only asks for a project when it
  // offered nothing, so an egg gated at the training cap was never reached: 0 eggs in the 216-game integration gate).
  const armyRoom = army < Math.max(4, 3 * view.economy.cities.length);
  const need: CityProjectId[] = [];
  if (atWar || rivalThreatenedCityIds(view).length) need.push('gymDrill');
  if (seasonOpen || contestThreat(view, content)) need.push('contestRehearsal');
  if (satisfaction < 50) need.push('festival');
  const turn = (['fieldReport', ...(armyRoom ? ['hatchEgg' as const] : [])] as CityProjectId[])
    .sort((a, b) => projectCost(view, a, content) - projectCost(view, b, content) || (a < b ? -1 : 1));
  const order = [...need, ...turn, 'festival', 'gymDrill', 'contestRehearsal'] as CityProjectId[];
  const pick = order.find(id => open.includes(id));
  return pick ? [{ item: { kind: 'project', defId: pick }, benefit: BENEFIT }] : [];
}
