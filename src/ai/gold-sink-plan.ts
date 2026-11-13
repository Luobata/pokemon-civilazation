// Gameplay v26 D (docs/design/depth-v26.md §5.1): AI gold sinks, view-only and never a refused command (every action passes
// `viewGoldSinkQuote` first). Order: a free badge TM; the Pokémon Center for a recovering Pokémon at war; then, above a reserve of
// 300 + 5 × upkeep, rushes (units in threatened cities first, then the most productive cities), a TM against the next gym leader's
// type and special training for a Pokémon within 40 XP of evolving. In the opening a settler may be rushed when it is cheap.
import { TYPE_ESSENCE } from '../content/essences.ts';
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { unitDefinition } from '../content/units.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { viewGoldSinkQuote } from '../core/gold-sinks.ts';
import type { GoldSinkAction } from '../core/gold-sinks.ts';
import { hexDistance } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { viewBadges } from '../core/unit-classes.ts';
import { threatenedCityIds } from './bond-plan.ts';
import { rivalThreatenedCityIds } from './rival-plan.ts';
import { rosterEvolution } from './roster-plan.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
const TYPES = Object.keys(TYPE_ESSENCE) as TypeId[];
const ok = (view: PlayerView, action: GoldSinkAction, content: Content) => viewGoldSinkQuote(view, action, content).ok;
/** Gold the AI keeps before buying production (§5.1: 300 + 5 × upkeep). */
export function goldSinkReserve(view: PlayerView, content: Content): number {
  const upkeep = [...view.units.filter(unit => unit.ownerId === view.playerId), ...view.recoveringUnits].reduce((sum, unit) => sum + unitDefinition(unit, content).upkeep, 0);
  return 300 + 5 * upkeep;
}
/** The best TM type for a unit against a defending type: the badge type with the highest multiplier above ×1 the unit lacks. */
function tmAgainst(view: PlayerView, unit: Pokemon, target: TypeId, allowed: readonly TypeId[], content: Content): TypeId | null {
  const species = content.species[unit.speciesId], own = [species.typeId, species.secondaryTypeId].filter((type): type is TypeId => type !== undefined);
  const best = Math.max(100, ...own.map(type => dualEffectiveness(type, [target])));
  return allowed.filter(type => !own.includes(type) && dualEffectiveness(type, [target]) > best)
    .sort((a, b) => dualEffectiveness(b, [target]) - dualEffectiveness(a, [target]) || (a < b ? -1 : 1))[0] ?? null;
}
export function planGoldSinkAction(view: PlayerView, content: Content): Command['action'] | null {
  const sinks = view.expansion?.goldSinks;
  if (!content.goldSinks || !sinks || view.outcome) return null;
  const player = view.economy.player, me = view.playerId;
  const own = view.units.filter((unit): unit is Pokemon => unit.ownerId === me && unit.kind === 'pokemon').sort((a, b) => a.id - b.id);
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === me || pair.b === me));
  const strongest = [...own].sort((a, b) => content.species[b.speciesId].stage - content.species[a.speciesId].stage || b.xp - a.xp || a.id - b.id);
  // Next gym leader's type (the nearest gym not yet won), the target of TMs.
  const circuit = view.expansion?.gymCircuit, won = circuit?.badges[me] ?? [];
  const nextGym = circuit?.gyms.filter(gym => !won.includes(gym.id)).sort((a, b) => Math.min(...own.map(unit => hexDistance(unit.position, a.position, view.map)))
    - Math.min(...own.map(unit => hexDistance(unit.position, b.position, view.map))) || a.id - b.id)[0];
  // 1. A free badge TM: to the strongest Pokémon without one, against the next gym when it helps, else the first type it lacks.
  for (const type of sinks.freeTms) {
    const unit = strongest.find(item => sinks.moves[item.id] === undefined && ok(view, { type: 'TeachMove', unitId: item.id, typeId: type }, content));
    if (unit) return { type: 'TeachMove', unitId: unit.id, typeId: type };
  }
  // 2. Pokémon Center: at war, the strongest recovering Pokémon with 2+ rounds left.
  if (atWar) {
    const stage = (unit: { kind: string; speciesId?: string }) => unit.kind === 'pokemon' ? content.species[unit.speciesId!].stage : 0;
    const unit = view.recoveringUnits.filter(item => item.ownerId === me && item.kind === 'pokemon' && item.roundsLeft >= 2)
      .sort((a, b) => stage(b) - stage(a) || a.id - b.id)
      .find(item => { const quote = viewGoldSinkQuote(view, { type: 'RushRecovery', unitId: item.id }, content); return quote.ok && player.gold >= quote.gold + 60; });
    if (unit) return { type: 'RushRecovery', unitId: unit.id };
  }
  // 3. Opening: a settler that is cheap to finish (keeps 20 gold back), so the third city is not late.
  if (view.economy.cities.length < 3 && view.round <= 40) for (const city of view.economy.cities) {
    if (city.queue[0]?.item.kind !== 'logistics' || city.queue[0].item.defId !== 'settler') continue;
    const quote = viewGoldSinkQuote(view, { type: 'RushProduction', cityId: city.id }, content);
    if (quote.ok && player.gold - quote.gold >= 20) return { type: 'RushProduction', cityId: city.id };
  }
  const reserve = goldSinkReserve(view, content);
  if (player.gold < reserve) return null;
  const spare = (gold: number) => player.gold - gold >= reserve;
  // 4. Rush: Pokémon in threatened cities (bond pressure, rivals, at war), then buildings / units in the most productive cities.
  const threatened = new Set([...threatenedCityIds(view), ...rivalThreatenedCityIds(view)]);
  const cities = [...view.economy.cities].sort((a, b) => Number(threatened.has(b.id) || atWar) - Number(threatened.has(a.id) || atWar)
    || Number(b.queue[0]?.item.kind === 'pokemon') - Number(a.queue[0]?.item.kind === 'pokemon') || b.yields.production - a.yields.production || a.id - b.id);
  for (const city of cities) {
    const quote = viewGoldSinkQuote(view, { type: 'RushProduction', cityId: city.id }, content);
    if (quote.ok && spare(quote.gold)) return { type: 'RushProduction', cityId: city.id };
  }
  // 5. A TM against the next gym leader's type for the strongest Pokémon without one.
  if (nextGym) {
    const allowed = TYPES.filter(type => viewBadges(view).has(TYPE_ESSENCE[type]));
    for (const unit of strongest.slice(0, 3)) {
      if (sinks.moves[unit.id] !== undefined) continue;
      const type = tmAgainst(view, unit, nextGym.typeId, allowed, content);
      if (!type) continue;
      const quote = viewGoldSinkQuote(view, { type: 'TeachMove', unitId: unit.id, typeId: type }, content);
      if (quote.ok && spare(quote.gold)) return { type: 'TeachMove', unitId: unit.id, typeId: type };
    }
  }
  // 6. Special training for a Pokémon within the training XP of its evolution.
  for (const unit of own) {
    const evolution = content.roster ? rosterEvolution(view, unit, content) : content.species[unit.speciesId].evolution;
    if (!evolution || unit.xp >= evolution.xp || evolution.xp - unit.xp > 40) continue;
    const quote = viewGoldSinkQuote(view, { type: 'SpecialTraining', unitId: unit.id }, content);
    if (quote.ok && spare(quote.gold)) return { type: 'SpecialTraining', unitId: unit.id };
  }
  return null;
}
