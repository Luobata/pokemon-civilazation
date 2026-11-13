// Gameplay v26 P1 (docs/design/depth-v26.md §2.3–2.6): what a player may know before a relay battle, from its PlayerView only — the
// eligible own Pokémon, the lineup size, the opponents (public: gym leaders and the Elite Four follow public settings, a guardian is its
// species, the conference NPCs are announced five rounds ahead, a rival team stands on the map) and the estimated win percent from fixed
// estimate seeds. The lineup picker, the world page and the AI read the same specs; the authority builds the same opponents from state.
import { ELITE_FOUR, GYM_RULES_V24 } from '../content/gym-circuit.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Content } from '../content/units.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { eliteFourTeam, leaderTeam, leaderTeamFor } from './gym-circuit.ts';
import { guardianFighter } from './civilization-systems.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import type { MapUnit, PlayerView } from './model.ts';
import { viewTaughtMoveType } from './gold-sinks.ts';
import { estimateWins, fighterFromCombatant, fighterFromUnit, healBetween, resolveTeamBattle } from './team-battle.ts';
import type { RelayFighter } from './team-battle.ts';
import { viewRivalSighting } from './rivals.ts';

export type LineupKind = 'gym' | 'guardian' | 'elite' | 'championship' | 'rival';
/**
 * A lineup choice: pick `size.min`–`size.max` of `candidates` in order. `onSite`: candidates standing on the site (the lineup needs one);
 * `opponents`: one team (gym, guardian, rival), the five Elite Four teams in order (`gauntlet`), or the announced NPC teams (conference,
 * the estimate averages one match against each).
 */
export type LineupSpec = { kind: LineupKind; size: { min: number; max: number }; candidates: number[]; onSite: number[]; opponents: RelayFighter[][];
  gauntlet: boolean; terrain: BiomeId; names: string[] };
type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
const ownReady = (view: PlayerView) => view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1)
  .sort((a, b) => a.id - b.id);
const terrainAt = (view: PlayerView, position: { q: number; r: number }): BiomeId => view.map.tiles[hexToIndex(position, view.map) ?? -1] ?? 'grassland';
/** The viewer's own Pokémon as a relay fighter (current HP, 历练, its TM type). */
export const viewFighter = (view: PlayerView, unit: Pokemon, content: Content, index = 0): RelayFighter =>
  fighterFromUnit(unit, `home-${index}-${unit.id}`, content, { taughtTypeId: viewTaughtMoveType(view, unit.id) });

export function viewGymSpec(view: PlayerView, gymId: number, content: Content): LineupSpec | null {
  const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === gymId);
  if (!gym || !content.teamBattles) return null;
  const held = view.expansion!.gymCircuit!.badges[view.playerId]?.length ?? 0, members = leaderTeamFor(held, content).members;
  const near = ownReady(view).filter(unit => hexDistance(unit.position, gym.position, view.map) <= GYM_RULES_V24.siteRange);
  return { kind: 'gym', size: { min: members, max: members }, candidates: near.map(unit => unit.id),
    onSite: near.filter(unit => hexDistance(unit.position, gym.position, view.map) === 0).map(unit => unit.id),
    opponents: [leaderTeam(gym, held, view.seed, content).map(member => fighterFromCombatant(member, content))], gauntlet: false, terrain: terrainAt(view, gym.position),
    names: [] };
}
export function viewEliteFourSpec(view: PlayerView, content: Content): LineupSpec | null {
  if (!view.expansion?.gymCircuit || !content.teamBattles) return null;
  return { kind: 'elite', size: { min: GYM_RULES_V24.eliteFour.team, max: GYM_RULES_V24.eliteFour.team }, candidates: ownReady(view).map(unit => unit.id), onSite: [],
    opponents: ELITE_FOUR.map((_, stage) => eliteFourTeam(stage, view.seed, content).map(member => fighterFromCombatant(member, content))), gauntlet: true,
    terrain: 'grassland', names: ELITE_FOUR.map(member => member.name) };
}
export function viewGuardianSpec(view: PlayerView, siteId: string, content: Content): LineupSpec | null {
  const site = view.expansion?.civilization.sanctuaries.find(item => item.id === siteId);
  if (!site || !content.teamBattles) return null;
  const near = ownReady(view).filter(unit => hexDistance(unit.position, site.position, view.map) <= 2);
  return { kind: 'guardian', size: { min: 1, max: CIVILIZATION_CONTENT.sanctuaries.maximumChallengeUnits }, candidates: near.map(unit => unit.id),
    onSite: near.filter(unit => hexDistance(unit.position, site.position, view.map) === 0).map(unit => unit.id),
    opponents: [[guardianFighter(site, content)]], gauntlet: false, terrain: terrainAt(view, site.position), names: [site.guardianName] };
}
/** The conference: any six own Pokémon (registration needs no action or position); the NPC teams once announced (else none). */
export function viewChampionshipSpec(view: PlayerView, content: Content): LineupSpec | null {
  const championship = view.expansion?.civilization.championship;
  if (!championship || !content.teamBattles) return null;
  const size = CIVILIZATION_CONTENT.championship.teamSize, own = view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  const npcs = championship.lineup ?? [];
  return { kind: 'championship', size: { min: size, max: size }, candidates: own.sort((a, b) => a.id - b.id).map(unit => unit.id), onSite: [],
    opponents: npcs.map(entrant => entrant.roster.map(member => fighterFromCombatant(member, content))), gauntlet: false, terrain: 'grassland',
    names: npcs.map(entrant => entrant.name) };
}
/** A duel against the own rival's Pokémon in sight (§3.1): as many own Pokémon as rival Pokémon, in reach (rival-duels decides). */
export function viewRivalTeam(view: PlayerView, content: Content): RelayFighter[] {
  const rivals = view.expansion?.rivals;
  if (!rivals) return [];
  return rivals.activeUnitIds.flatMap((id, index) => {
    const unit = view.units.find(item => item.id === id && item.kind === 'pokemon') as Pokemon | undefined;
    const sighting = viewRivalSighting(view, id);
    return unit && sighting ? [fighterFromUnit({ ...unit, xp: 0 }, `rival-${index}-${unit.id}`, content, { spirit: sighting.spirit })] : [];
  });
}

/** Fighters for a lineup of own unit ids (in order). */
export function lineupFighters(view: PlayerView, unitIds: readonly number[], content: Content): RelayFighter[] {
  return unitIds.flatMap((id, index) => {
    const unit = view.units.find(item => item.id === id && item.ownerId === view.playerId && item.kind === 'pokemon') as Pokemon | undefined;
    return unit ? [viewFighter(view, unit, content, index)] : [];
  });
}
const copy = (team: readonly RelayFighter[]) => team.map(fighter => ({ ...fighter, typeIds: [...fighter.typeIds] }));
/** One trial of a spec: true when the lineup wins (every Elite Four battle; for several NPC teams, the match against team `trial % n`). */
export function trialWins(spec: Pick<LineupSpec, 'opponents' | 'gauntlet' | 'terrain'>, lineup: readonly RelayFighter[], seed: number, trial: number): { won: boolean; lost: number } {
  const home = copy(lineup), before = home.reduce((sum, fighter) => sum + fighter.hp, 0);
  if (!spec.opponents.length) return { won: false, lost: 0 };
  let won = true;
  if (spec.gauntlet) {
    for (const [stage, team] of spec.opponents.entries()) {
      if (stage) healBetween(home);
      if (resolveTeamBattle(home, copy(team), stableSeed(seed, stage), spec.terrain).winnerSide !== 'home') { won = false; break; }
    }
  } else won = resolveTeamBattle(home, copy(spec.opponents[trial % spec.opponents.length]), seed, spec.terrain).winnerSide === 'home';
  return { won, lost: before - home.reduce((sum, fighter) => sum + fighter.hp, 0) };
}
/** Estimated win percent of a lineup (16 fixed estimate seeds, rounded to 5%; §2.1): what the lineup picker shows. */
export function estimateLineup(spec: LineupSpec, lineup: readonly RelayFighter[], seeds = 16): number {
  let trial = 0;
  return estimateWins(seed => trialWins(spec, lineup, seed, trial++).won, seeds);
}
