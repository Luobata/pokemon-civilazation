// Gameplay v27 ⑥ (docs/design/pace-v27.md §7, option 6A): the league roster — 8 original trainers per game from `stableSeed(seed,
// 'league-roster')` and the regional Pokédex (distinct primary types and signature stage-3 Pokémon), teams that grow per season (4 / 5 / 6
// Pokémon, the signature evolves), stage weights 8 / 10 / 13 and ×1.2 for the signature, records against each civilization and the nemesis.
// Stub: the trainers lane fills it in. Wired once in championshipNpcEntrants (src/core/civilization-systems.ts): null = the v26 NPC teams.
import type { Content } from '../content/units.ts';
import type { ChampionshipNpc } from './civilization-systems.ts';

/** The season's NPC entrants from the league roster (slot order), or null for the v26 per-season draw. Public setup only. */
export function leagueRosterEntrants(_seed: number, _season: number, content: Content): ChampionshipNpc[] | null {
  if (!content.leagueTrainers) return null;
  return null;
}
