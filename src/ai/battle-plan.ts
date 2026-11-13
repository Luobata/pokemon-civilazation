// Gameplay v26 P1 (docs/design/depth-v26.md §2.4): AI lineups and challenges for relay battles — view-only, never a refused command.
// `chooseLineup` enumerates picks and orders (up to 3 of 6 nearby Pokémon: at most 120 lineups) and plays each with 4 fixed estimate seeds
// (`stableSeed('ai-lineup', trial)`, never the authority's seed): most wins, then least HP lost, then the id order. Six-Pokémon lineups
// (Elite Four, conference) take the six strongest and try every ordered pair of leads, the rest ordered by their average matchup.
// Thresholds: gyms ≥ 75% (3 of 4), the Elite Four ≥ 50%, guardians ≥ 50% and once per sanctuary every 3 rounds.
import { GYM_RULES_V24 } from '../content/gym-circuit.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { Content } from '../content/units.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { viewEliteFourBlocker, viewGymBlocker } from '../core/gym-circuit.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { bestAttack } from '../core/team-battle.ts';
import type { RelayFighter } from '../core/team-battle.ts';
import { lineupFighters, trialWins, viewChampionshipSpec, viewEliteFourSpec, viewGuardianSpec, viewGymSpec } from '../core/team-battle-views.ts';
import type { LineupSpec } from '../core/team-battle-views.ts';
import { threatenedCityIds } from './bond-plan.ts';
import { rivalActive, rivalThreatenedCityIds } from './rival-plan.ts';
import { travelDistance } from './travel.ts';

export const AI_LINEUP_SEEDS = 4;
export type LineupChoice = { unitIds: number[]; wins: number; trials: number; lostHp: number };
const fighterUnit = (fighter: RelayFighter) => fighter.unitId!;
/** Ordered selections of `size` from `pool` (pool ≤ 6, size ≤ 3). */
function arrangements<T>(pool: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return pool.flatMap((item, index) => arrangements([...pool.slice(0, index), ...pool.slice(index + 1)], size - 1).map(rest => [item, ...rest]));
}
const strength = (fighter: RelayFighter) => fighter.hp * (fighter.attack + fighter.veteran) * (fighter.defense + fighter.veteran);
/** Average matchup of a fighter against the opponents (its best multiplier on them minus theirs on it). */
const matchup = (fighter: RelayFighter, opponents: readonly RelayFighter[]) =>
  opponents.reduce((sum, foe) => sum + bestAttack(fighter, foe).effectiveness - bestAttack(foe, fighter).effectiveness, 0);
/** The candidate lineups to try for a spec (each a list of fighters in order). */
function lineups(spec: LineupSpec, fighters: readonly RelayFighter[]): RelayFighter[][] {
  const size = Math.min(spec.size.max, fighters.length);
  if (size < spec.size.min) return [];
  const onSite = new Set(spec.onSite);
  const valid = (lineup: readonly RelayFighter[]) => !spec.onSite.length || lineup.some(fighter => onSite.has(fighterUnit(fighter)));
  if (size <= 3) {
    // Nearby pool: the on-site Pokémon first, then the strongest, six at most.
    const pool = [...fighters].sort((a, b) => Number(onSite.has(fighterUnit(b))) - Number(onSite.has(fighterUnit(a))) || strength(b) - strength(a) || fighterUnit(a) - fighterUnit(b)).slice(0, 6);
    const sizes = Array.from({ length: size - spec.size.min + 1 }, (_, index) => spec.size.min + index);
    return sizes.flatMap(count => arrangements(pool, count)).filter(valid);
  }
  const top = [...fighters].sort((a, b) => strength(b) - strength(a) || fighterUnit(a) - fighterUnit(b)).slice(0, size);
  const foes = spec.opponents.flat();
  return arrangements(top, 2).map(leads => [...leads, ...top.filter(fighter => !leads.includes(fighter))
    .sort((a, b) => matchup(b, foes) - matchup(a, foes) || fighterUnit(a) - fighterUnit(b))]).filter(valid);
}
/** §2.4: the best lineup for a spec from the viewer's Pokémon (`hp`: judge at full health, e.g. for a team still travelling). */
export function chooseLineup(view: PlayerView, spec: LineupSpec, content: Content, options: { fullHp?: boolean; seeds?: number } = {}): LineupChoice | null {
  const seeds = options.seeds ?? AI_LINEUP_SEEDS;
  const fighters = lineupFighters(view, spec.candidates, content).map(fighter => options.fullHp ? { ...fighter, hp: fighter.maxHp } : fighter);
  let best: LineupChoice | null = null;
  for (const lineup of lineups(spec, fighters)) {
    let wins = 0, lostHp = 0;
    for (let trial = 0; trial < seeds; trial++) {
      const result = trialWins(spec, lineup, stableSeed('ai-lineup', trial), trial);
      wins += Number(result.won); lostHp += result.lost;
    }
    const unitIds = lineup.map(fighterUnit);
    if (!best || wins > best.wins || (wins === best.wins && (lostHp < best.lostHp || (lostHp === best.lostHp && unitIds.join(',') < best.unitIds.join(','))))) {
      best = { unitIds, wins, trials: seeds, lostHp };
    }
  }
  return best;
}
const atWar = (view: PlayerView) => view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId));
const percent = (choice: LineupChoice | null) => choice ? Math.floor(choice.wins * 100 / choice.trials) : 0;

/** v26 replacement of `planGymAction`: Elite Four, a gym, a guardian, the conference registration (and its re-ordering). */
export function planTeamBattleAction(view: PlayerView, content: Content): Command['action'] | null {
  const circuit = view.expansion?.gymCircuit, civilization = view.expansion?.civilization;
  if (circuit) {
    const won = circuit.badges[view.playerId] ?? [];
    const elite = won.length >= GYM_RULES_V24.gymCount && !circuit.eliteFour[view.playerId]?.won && !atWar(view) && circuit.eliteFourReadyAt <= view.round ? viewEliteFourSpec(view, content) : null;
    if (elite) {
      const choice = chooseLineup(view, elite, content);
      if (choice && percent(choice) >= 50 && !viewEliteFourBlocker(view, choice.unitIds)) return { type: 'ChallengeEliteFour', unitIds: choice.unitIds };
    }
    for (const gym of circuit.gyms) {
      if (won.includes(gym.id) || (circuit.readyAt[gym.id] ?? 0) > view.round) continue;
      const spec = viewGymSpec(view, gym.id, content);
      if (!spec?.onSite.length) continue;
      const choice = chooseLineup(view, spec, content);
      if (choice && percent(choice) >= 75 && !viewGymBlocker(view, gym.id, choice.unitIds)) return { type: 'ChallengeGym', gymId: gym.id, unitIds: choice.unitIds };
    }
  }
  if (civilization) {
    for (const site of civilization.sanctuaries) {
      if (site.ownerId !== view.playerId || site.guardianDefeated || (site.lastChallengeRound ?? -Infinity) > view.round - 3) continue;
      const spec = viewGuardianSpec(view, site.id, content);
      if (!spec?.onSite.length) continue;
      const choice = chooseLineup(view, spec, content);
      if (choice && percent(choice) >= 50) return { type: 'ChallengeGuardian', siteId: site.id, unitIds: choice.unitIds };
    }
    const championship = civilization.championship, until = championship.nextRound - view.round;
    if (civilization.planning.atPeaceWithAll && until <= 5 && until >= 0) {
      const spec = viewChampionshipSpec(view, content), registered = championship.registration?.unitIds ?? null;
      // Register five rounds ahead; re-order once, the round before, against the announced NPC teams.
      const kept = registered?.filter(id => spec?.candidates.includes(id)) ?? [];
      const reorder = registered !== null && kept.length === registered.length && until <= 1 && championship.registration!.registeredRound < championship.nextRound - 1;
      if (spec && (registered === null || kept.length < registered.length || reorder)) {
        const choice = chooseLineup(view, reorder ? { ...spec, candidates: kept } : spec, content, { fullHp: true });
        if (choice && choice.unitIds.length === CIVILIZATION_CONTENT.championship.teamSize && choice.unitIds.join(',') !== registered?.join(',')) {
          return { type: 'RegisterChampionshipTeam', unitIds: choice.unitIds };
        }
      }
    }
  }
  return null;
}

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
/** v26 replacement of `gymMoveTargets`' readiness test: the nearest team wins at full HP in ≥ 3 of 4 estimate runs (its best lineup). */
export function teamBattleGymTargets(view: PlayerView, content: Content): Map<number, Hex> {
  const circuit = view.expansion?.gymCircuit, targets = new Map<number, Hex>();
  if (!circuit || atWar(view) || rivalActive(view) || threatenedCityIds(view).length || rivalThreatenedCityIds(view).length) return targets;
  const cityTiles = new Set(view.economy.cities.map(city => `${city.position.q},${city.position.r}`));
  const own = view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  const free = own.filter(unit => !cityTiles.has(`${unit.position.q},${unit.position.r}`));
  const won = circuit.badges[view.playerId] ?? [];
  const plans = circuit.gyms.filter(gym => !won.includes(gym.id) && (circuit.readyAt[gym.id] ?? 0) <= view.round + 2).flatMap(gym => {
    const spec = viewGymSpec(view, gym.id, content);
    if (!spec || spec.size.min > Math.min(own.length - 1, free.length)) return [];
    // One Pokémon always stays home; the team is the nearest six free ones, judged at full health (it heals on the way).
    const near = free.map(unit => ({ unit, distance: travelDistance(view, unit, unit.position, gym.position) })).filter(item => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance || a.unit.id - b.unit.id).slice(0, Math.min(6, Math.max(spec.size.min, 3)));
    if (near.length < spec.size.min) return [];
    const choice = chooseLineup(view, { ...spec, candidates: near.map(item => item.unit.id), onSite: [] }, content, { fullHp: true, seeds: 2 });
    if (!choice || choice.wins < choice.trials) return [];
    const team = near.filter(item => choice.unitIds.includes(item.unit.id));
    return [{ gym, team, distance: Math.max(...team.map(item => item.distance)) }];
  }).sort((a, b) => a.distance - b.distance || a.gym.id - b.gym.id);
  for (const item of plans[0]?.team ?? []) targets.set(item.unit.id, plans[0].gym.position);
  return targets;
}
