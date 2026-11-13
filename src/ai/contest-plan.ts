import type { LeaderId } from '../content/leaders.ts';
import { CONTEST_RULES } from '../core/contests.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { treeGateOpen } from '../core/tech-tree.ts';

/** Leaders that lean on culture pursue contests harder: more halls and earlier shows. */
const CONTEST_LEANING: Partial<Record<LeaderId, number>> = { jasmine: 2, misty: 1, joy: 1, oak: 1 };
export function planContestAction(view: PlayerView): Command['action'] | null {
  const contests = view.expansion?.contests, player = view.economy.player;
  if (!contests) return null;
  const leaning = player.leaderId ? CONTEST_LEANING[player.leaderId] ?? 0 : 0;
  const atWar = view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
  // v21: a hall halves a city's production while it is built, so wait until the 3-city opening is done.
  const opening = (view.gameplayVersion ?? 0) >= 21 && view.economy.cities.length < 3 && view.round < 40;
  const wantsHalls = !opening && (player.personality !== 'aggressive' || view.round >= 60 || leaning >= 2);
  const pending = Object.keys(contests.own.building).length;
  const cap = Math.max(1 + leaning, Math.ceil(view.economy.cities.length * (1 + leaning) / 3));
  if (!atWar && wantsHalls && treeGateOpen(player, 'contestHall') && pending === 0 && contests.own.halls.length < cap && player.gold >= CONTEST_RULES.hallGold + 20) {
    const city = view.economy.cities.filter(item => !contests.own.halls.includes(item.id) && item.population >= 2 && item.capturedAtRound !== view.round)
      .sort((a, b) => b.population - a.population || a.id - b.id)[0];
    if (city) return { type: 'BuildContestHall', cityId: city.id };
  }
  const reserve = leaning >= 2 ? 10 : 50;
  // v26: halls in a city lost this round stay listed until the round ends but do not count (the v26 gate saw two refused shows);
  // older games keep the listed halls, so their AI is unchanged.
  const halls = view.expansion?.contestSeasons ? contests.own.halls.filter(id => view.economy.cities.some(city => city.id === id)) : contests.own.halls;
  if (halls.length && view.round >= contests.own.showReadyAtRound && player.gold >= CONTEST_RULES.showGold + reserve) return { type: 'HoldContest' };
  return null;
}
