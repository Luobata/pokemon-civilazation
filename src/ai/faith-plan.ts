import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { FAITH_RULES, LEGEND_IDS } from '../content/faith-legends.ts';
import type { LegendId, TenetId } from '../content/faith-legends.ts';
import type { LeaderId } from '../content/leaders.ts';
import { hexDistance } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** Leaders with a faith leaning seek their preferred legend first. */
const LEGEND_PREFERENCE: Partial<Record<LeaderId, LegendId>> = { lance: 'rayquaza', misty: 'kyogre', brock: 'groudon', oak: 'lugia', joy: 'hooh', giovanni: 'groudon', steven: 'rayquaza', jasmine: 'lugia', jenny: 'hooh' };
const TENET_PREFERENCE: Record<string, TenetId[]> = {
  aggressive: ['zealots', 'missionaries'], expansion: ['missionaries', 'pilgrims'], conservative: ['harmony', 'shrineFood'],
};
export function planFaithAction(view: PlayerView): Command['action'] | null {
  const faith = view.expansion?.faith, civ = view.expansion?.civilization;
  if (!faith || !civ) return null;
  const player = view.economy.player, mine = civ.player;
  const founded = faith.faiths.find(item => item.founderId === view.playerId);
  // Offerings at shrine cities (gym or contest hall) once per city per round.
  const shrines = view.economy.cities.filter(city => view.expansion!.essences?.gyms.some(gym => gym.cityId === city.id) || view.expansion!.contests?.own.halls.includes(city.id));
  const offeringCity = shrines.find(city => mine.offeredThisRoundByCity[city.id] === undefined && (city.food >= CIVILIZATION_CONTENT.offering.foodCost + 10 || player.gold >= CIVILIZATION_CONTENT.offering.goldCost + 60));
  if (!founded) {
    const free = LEGEND_IDS.filter(id => !faith.faiths.some(item => item.legend === id));
    if (free.length && mine.lifetimeOfferings >= FAITH_RULES.foundLifetime && mine.offeringPoints >= FAITH_RULES.foundCost) {
      const preferred = player.leaderId ? LEGEND_PREFERENCE[player.leaderId] : undefined;
      const legend = preferred && free.includes(preferred) ? preferred : free[0];
      return { type: 'FoundFaith', legend, tenets: TENET_PREFERENCE[player.personality] ?? ['missionaries', 'pilgrims'] };
    }
  } else if (mine.offeringPoints >= FAITH_RULES.spreadCost) {
    // Spread to the closest city not yet following us, preferring own cities, then rivals' capitals.
    const own = view.economy.cities.map(city => city.position);
    const target = view.cities.filter(city => city.ownerId !== null && faith.cityFaith[city.id] !== view.playerId
      && own.some(position => hexDistance(position, city.position, view.map) <= FAITH_RULES.spreadRange))
      .sort((a, b) => Number(b.ownerId === view.playerId) - Number(a.ownerId === view.playerId)
        || (faith.ownPressure[b.id] ?? 0) - (faith.ownPressure[a.id] ?? 0) || a.id - b.id)[0];
    if (target) return { type: 'SpreadFaith', cityId: target.id };
  }
  if (offeringCity) return { type: 'MakeOffering', cityId: offeringCity.id, resource: offeringCity.food >= CIVILIZATION_CONTENT.offering.foodCost + 10 ? 'food' : 'gold' };
  return null;
}
