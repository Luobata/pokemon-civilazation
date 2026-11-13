// Gameplay v26 P3 (docs/design/depth-v26.md §3.3): AI rival duels — view-only, never a refused command. With every rival Pokémon of the
// visit in sight and enough own Pokémon in reach, the best lineup (chooseLineup, 4 fixed estimate seeds) is judged: ≥ 60% → a serious duel;
// at the city gate ≥ 50% → serious; 35–60% with a rival Pokémon within 2 of an own city → a friendly duel (once per visit, it pays half);
// otherwise the map fight goes on (src/ai/rival-plan.ts).
import type { BiomeId } from '../content/rules.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { viewDuelCandidates, viewRivalDuelBlocker, viewRivalLineup } from '../core/rival-duels.ts';
import { viewRivalTeam } from '../core/team-battle-views.ts';
import type { LineupSpec } from '../core/team-battle-views.ts';
import { chooseLineup } from './battle-plan.ts';

/** The duel as a lineup spec (exact size, one adjacent Pokémon needed unless at the gate), or null when no duel is possible now. */
export function rivalDuelSpec(view: PlayerView, content: Content): LineupSpec | null {
  const rivals = view.expansion?.rivals, lineup = viewRivalLineup(view);
  if (!content.rivalDuels || !rivals || !lineup.length || lineup.length !== rivals.activeUnitIds.length || rivals.duelRound === view.round) return null;
  const { candidates, adjacent, gate } = viewDuelCandidates(view);
  if (candidates.length < lineup.length) return null;
  const terrain: BiomeId = view.map.tiles[hexToIndex(lineup[0].position, view.map) ?? -1] ?? 'grassland';
  return { kind: 'rival', size: { min: lineup.length, max: lineup.length }, candidates, onSite: gate ? [] : adjacent, opponents: [viewRivalTeam(view, content)],
    gauntlet: false, terrain, names: [rivals.name] };
}
export function planRivalDuel(view: PlayerView, content: Content): Command['action'] | null {
  const spec = rivalDuelSpec(view, content), rivals = view.expansion?.rivals;
  if (!spec || !rivals) return null;
  if (!spec.onSite.length && viewDuelCandidates(view).adjacent.length === 0 && !viewDuelCandidates(view).gate) return null;
  const choice = chooseLineup(view, spec, content);
  if (!choice || viewRivalDuelBlocker(view, choice.unitIds)) return null;
  const percent = Math.floor(choice.wins * 100 / choice.trials), gate = viewDuelCandidates(view).gate;
  const nearCity = viewRivalLineup(view).some(rival => view.economy.cities.some(city => hexDistance(city.position, rival.position, view.map) <= 2));
  if (percent >= 60 || (gate && percent >= 50)) return { type: 'ChallengeRival', unitIds: choice.unitIds, stake: 'serious' };
  if (percent >= 35 && nearCity && !rivals.sparRewarded) return { type: 'ChallengeRival', unitIds: choice.unitIds, stake: 'spar' };
  return null;
}
