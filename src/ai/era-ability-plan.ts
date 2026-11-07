import { ERA_ABILITY_RULES, WEATHERS, WEATHER_IDS } from '../content/era-abilities.ts';
import type { WeatherId } from '../content/era-abilities.ts';
import type { Content } from '../content/units.ts';
import { TYPE_ESSENCE } from '../content/essences.ts';
import type { TypeId } from '../content/species.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { canMega, primaryEssence } from '../core/era-abilities.ts';
import { hexDistance } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';

/** Uses era abilities only at war, from the AI's own observation. */
export function planEraAbilityAction(view: PlayerView, content: Content): Command['action'] | null {
  const era = view.expansion?.eraAbilities, essences = view.expansion?.essences;
  if (!era || !essences || !era.unlocked.length) return null;
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  if (!enemies.size) return null;
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft) as (MapUnit & { kind: 'pokemon' })[];
  const hostile = view.units.filter(unit => unit.ownerId !== null && enemies.has(unit.ownerId));
  const hostileCities = view.cities.filter(city => city.ownerId !== null && enemies.has(city.ownerId));
  const near = (unit: MapUnit, distance: number) => hostile.some(other => hexDistance(other.position, unit.position, view.map) <= distance)
    || hostileCities.some(city => hexDistance(city.position, unit.position, view.map) <= distance);
  const front = own.filter(unit => near(unit, 3)).sort((a, b) => content.species[b.speciesId].attack - content.species[a.speciesId].attack || a.id - b.id);
  const stock = essences.stock, statuses = era.units;
  if (era.unlocked.includes('mega') && era.own.megaUnitId === null) {
    const unit = front.find(item => canMega(item, content) && stock[primaryEssence(item, content)!] >= ERA_ABILITY_RULES.megaCost);
    if (unit) return { type: 'MegaEvolve', unitId: unit.id };
  }
  if (era.unlocked.includes('dynamax') && view.round >= era.own.dynamaxReadyAtRound) {
    const unit = front.find(item => hostileCities.some(city => hexDistance(city.position, item.position, view.map) <= 2) && stock[primaryEssence(item, content)!] >= ERA_ABILITY_RULES.dynamaxCost);
    if (unit) return { type: 'Dynamax', unitId: unit.id };
  }
  if (era.unlocked.includes('zMove') && view.round >= era.own.zReadyAtRound) {
    const unit = front.find(item => near(item, content.species[item.speciesId].range) && !statuses[item.id]?.zPrimed && stock[primaryEssence(item, content)!] >= ERA_ABILITY_RULES.zCost);
    if (unit) return { type: 'PrimeZMove', unitId: unit.id };
  }
  if (era.unlocked.includes('tera') && era.own.teraUnitId === null) {
    // Pick the frontline unit facing the worst incoming matchup and the type that resists most visible attackers.
    const attackers = hostile.filter(unit => unit.kind === 'pokemon').map(unit => content.species[(unit as MapUnit & { kind: 'pokemon' }).speciesId].typeId);
    if (attackers.length) {
      const types = Object.keys(TYPE_ESSENCE) as TypeId[];
      const incoming = (defense: readonly TypeId[]) => attackers.reduce((sum, type) => sum + dualEffectiveness(type, defense, false), 0);
      for (const unit of front.filter(item => near(item, 2))) {
        const species = content.species[unit.speciesId], current = incoming([species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])]);
        const best = types.filter(type => stock[TYPE_ESSENCE[type]] >= ERA_ABILITY_RULES.teraCost).sort((a, b) => incoming([a]) - incoming([b]) || a.localeCompare(b))[0];
        if (best && incoming([best]) * 10 <= current * 7) return { type: 'Terastallize', unitId: unit.id, typeId: best };
      }
    }
  }
  if (era.unlocked.includes('weather') && view.round >= era.own.weatherReadyAtRound && front.length >= 2) {
    const counts = new Map<WeatherId, number>();
    for (const unit of front) for (const id of WEATHER_IDS) if (WEATHERS[id].boost.includes(content.species[unit.speciesId].typeId)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const weather = [...counts.entries()].filter(([id]) => stock[WEATHERS[id].essence] >= ERA_ABILITY_RULES.weatherCost).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const city = weather && [...view.economy.cities].sort((a, b) => Math.min(...front.map(unit => hexDistance(unit.position, a.position, view.map))) - Math.min(...front.map(unit => hexDistance(unit.position, b.position, view.map))) || a.id - b.id)[0];
    if (weather && city && front.some(unit => hexDistance(unit.position, city.position, view.map) <= ERA_ABILITY_RULES.weatherRadius)) return { type: 'SummonWeather', cityId: city.id, weather };
  }
  return null;
}
