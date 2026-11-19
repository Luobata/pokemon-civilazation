// Gameplay v27 ⑥ (docs/design/pace-v27.md §7, option 6A): the league roster — 8 original trainers per game from `stableSeed(seed,
// 'league-roster')` and the regional Pokédex (distinct primary types and signature stage-3 Pokémon), teams that grow per season (4 / 5 / 6
// Pokémon, the signature evolves), stage weights 8 / 10 / 13 and ×1.2 for the signature, records against each civilization and the nemesis.
// Wired once in championshipNpcEntrants (src/core/civilization-systems.ts): null = the v26 NPC teams.
//
// Everything here is a pure function of public information: the roster of the setup (seed, regional Pokédex, content), a season's
// trainers of the public season history (who sat out the previous season goes first), the records and the nemesis of the public
// `ChampionshipResolved` history. Integers only; no `state.rng`.
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { TRAINER_ARCHETYPES, trainerArchetype } from '../content/conference.ts';
import type { TrainerArchetype, TrainerArchetypeId } from '../content/conference.ts';
import { depth26Tuning } from '../content/depth-v26.ts';
import { trainersTuning } from '../content/pace-v27.ts';
import { regionalSpeciesIds, stoneEvolutionsFor } from '../content/roster.ts';
import type { TypeId } from '../content/species.ts';
import { stableSeed } from '../content/stable-seed.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import type { BattleCombatant, ChampionshipNpc, ChampionshipSeason } from './civilization-systems.ts';
import type { EventPayload, GameState } from './model.ts';
import { evolutionOptions } from './roster.ts';

/** One line of a trainer's team: the form it ends as and the form it starts as (one evolution earlier when that is in the Pokédex). */
export type LeagueLine = { finalId: SpeciesId; earlyId: SpeciesId };
export type LeagueTrainer = {
  id: TrainerArchetypeId; entrantId: string; name: string; title: string;
  primaryType: TypeId; secondaryType: TypeId;
  /** The ace: a stage-3 Pokémon of the primary type (distinct across the roster); its stage-2 form in seasons 1–2. */
  signature: LeagueLine;
  /** The other five, in team order (the signature goes out last). */
  members: LeagueLine[];
};
export type LeagueTrainerEvent = { type: 'LeagueNemesisBeaten'; playerId: number; entrantId: string; name: string; season: number; eraScore: number };

const PREFIX = 'league-';
export const leagueEntrantId = (id: TrainerArchetypeId): string => `${PREFIX}${id}`;
/** The archetype of a league trainer's entrant id (null for civilizations, rivals and the v26 NPC teams). */
export function leagueTrainerId(entrantId: string): TrainerArchetypeId | null {
  if (!entrantId.startsWith(PREFIX)) return null;
  const id = entrantId.slice(PREFIX.length);
  return TRAINER_ARCHETYPES.some(archetype => archetype.id === id) ? id as TrainerArchetypeId : null;
}
/** §7.1 growth: 4 Pokémon in seasons 1–2, 5 in 3–4, 6 from season 5; the signature evolves in season 3, the others in season 5. */
export const leagueTeamSize = (season: number): number => season <= 2 ? 4 : season <= 4 ? 5 : 6;
export const signatureEvolved = (season: number): boolean => season >= 3;
export const membersEvolved = (season: number): boolean => season >= 5;

const rosters = new WeakMap<Content, Map<number, LeagueTrainer[]>>();
/** The game's league roster (archetype order; `rosterSize` of the 8 archetypes, picked with stableSeed). Memoized per content and seed. */
export function leagueRoster(seed: number, content: Content): LeagueTrainer[] {
  let bySeed = rosters.get(content);
  if (!bySeed) rosters.set(content, bySeed = new Map());
  let roster = bySeed.get(seed);
  if (!roster) bySeed.set(seed, roster = buildRoster(seed, content));
  return roster;
}

function buildRoster(seed: number, content: Content): LeagueTrainer[] {
  const tag = (...parts: (string | number)[]) => stableSeed(seed, 'league-roster', ...parts);
  const species = (id: SpeciesId) => content.species[id];
  const dex = [...regionalSpeciesIds(content)].filter(id => content.species[id]).sort() as SpeciesId[];
  const stones = stoneEvolutionsFor(content);
  const evolvesInto = (from: SpeciesId, into: SpeciesId) => evolutionOptions(content, from).some(option => option.speciesId === into)
    || stones.some(path => path.fromSpeciesId === from && path.intoSpeciesId === into);
  const earlyOf = (id: SpeciesId): SpeciesId => dex.filter(other => species(other).stage < species(id).stage && evolvesInto(other, id))
    .sort((a, b) => species(b).stage - species(a).stage || (a < b ? -1 : 1))[0] ?? id;
  const isFinal = (id: SpeciesId) => !dex.some(other => other !== id && species(other).stage > species(id).stage && evolvesInto(id, other));
  const line = (id: SpeciesId): LeagueLine => ({ finalId: id, earlyId: earlyOf(id) });
  const has = (id: SpeciesId, type: TypeId) => species(id).typeId === type || species(id).secondaryTypeId === type;
  const pick = <T,>(items: readonly T[], ...parts: (string | number)[]): T => items[tag(...parts) % items.length]!;
  const size = Math.max(1, Math.min(TRAINER_ARCHETYPES.length, trainersTuning(content).rosterSize));
  const stage3 = dex.filter(id => species(id).stage === 3);
  // The seated archetypes (stableSeed), then the order in which they choose their primary type and signature: fewest favoured types
  // with a stage-3 Pokémon in this Pokédex first, so as many trainers as possible get one of their own types.
  const options = (archetype: TrainerArchetype) => archetype.types.filter(type => stage3.some(id => species(id).typeId === type)).length;
  const order = [...TRAINER_ARCHETYPES].sort((a, b) => tag(a.id, 'order') - tag(b.id, 'order') || (a.id < b.id ? -1 : 1)).slice(0, size)
    .sort((a, b) => options(a) - options(b) || tag(a.id, 'order') - tag(b.id, 'order') || (a.id < b.id ? -1 : 1));
  const usedTypes = new Set<TypeId>(), usedSignatures = new Set<SpeciesId>();
  const chosen = new Map<TrainerArchetypeId, { primary: TypeId; signature: SpeciesId }>();
  for (const archetype of order) {
    const free = (type: TypeId) => stage3.filter(id => species(id).typeId === type && !usedSignatures.has(id));
    const freeTypes = [...new Set(stage3.map(id => species(id).typeId))].sort().filter(type => !usedTypes.has(type) && free(type).length);
    const favoured = archetype.types.filter(type => freeTypes.includes(type));
    let primary: TypeId, pool: SpeciesId[];
    if (favoured.length || freeTypes.length) {
      primary = pick(favoured.length ? favoured : freeTypes, archetype.id, 'type');
      pool = free(primary);
    } else {
      // A Pokédex with fewer stage-3 types than trainers (not a v27 draw): any unused Pokémon, highest stage first.
      const rest = dex.filter(id => !usedSignatures.has(id));
      const top = Math.max(...rest.map(id => species(id).stage));
      pool = rest.filter(id => species(id).stage === top);
      primary = species(pick(pool, archetype.id, 'fallback')).typeId;
      pool = pool.filter(id => species(id).typeId === primary);
    }
    // A signature that evolves during the game when one is there (its stage-2 form opens the first seasons).
    const growing = pool.filter(id => earlyOf(id) !== id);
    const signature = pick(growing.length ? growing : pool, archetype.id, 'signature');
    usedTypes.add(primary); usedSignatures.add(signature);
    chosen.set(archetype.id, { primary, signature });
  }
  // Teams: up to three more of the primary type, then the secondary type, then the archetype's favoured roles, then anything; final forms
  // only, never another trainer's signature, a species in at most three teams of the game (four, five… only when a team would otherwise
  // stay short; any other Pokémon only when the Pokédex has too few final forms).
  const used = new Map<SpeciesId, number>(), finals = dex.filter(isFinal).filter(id => !usedSignatures.has(id));
  const names = new Set<string>();
  const trainers = new Map<TrainerArchetypeId, LeagueTrainer>();
  for (const archetype of order) {
    const { primary, signature } = chosen.get(archetype.id)!;
    const typesInDex = [...new Set(dex.flatMap(id => [species(id).typeId, species(id).secondaryTypeId].filter((type): type is TypeId => Boolean(type))))].sort();
    const secondary = archetype.types.find(type => type !== primary && typesInDex.includes(type))
      ?? (species(signature).secondaryTypeId && species(signature).secondaryTypeId !== primary ? species(signature).secondaryTypeId! : undefined)
      ?? pick(typesInDex.filter(type => type !== primary).length ? typesInDex.filter(type => type !== primary) : [primary], archetype.id, 'secondary');
    const ranked = (ids: readonly SpeciesId[]) => [...ids].sort((a, b) => species(b).stage - species(a).stage || tag(archetype.id, a) - tag(archetype.id, b) || (a < b ? -1 : 1));
    const team: SpeciesId[] = [];
    let cap = 3;
    const open = (id: SpeciesId) => (used.get(id) ?? 0) < cap && !team.includes(id) && id !== signature;
    const take = (ids: readonly SpeciesId[], limit: number) => { for (const id of ranked(ids)) if (team.length < limit && open(id)) team.push(id); };
    take(finals.filter(id => has(id, primary)), 3);
    take(finals.filter(id => has(id, secondary)), 5);
    take(finals.filter(id => (archetype.roles as readonly string[]).includes(species(id).role)), 5);
    take(finals.filter(id => has(id, primary)), 5);
    take(finals, 5);
    for (; team.length < 5 && cap < order.length; cap++) take(finals, 5);
    take(dex.filter(isFinal), 5);
    for (const id of team) used.set(id, (used.get(id) ?? 0) + 1);
    const name = pick(archetype.names.filter(item => !names.has(item)), archetype.id, 'name');
    names.add(name);
    trainers.set(archetype.id, { id: archetype.id, entrantId: leagueEntrantId(archetype.id), name, title: archetype.title,
      primaryType: primary, secondaryType: secondary, signature: line(signature), members: team.map(line) });
  }
  return TRAINER_ARCHETYPES.flatMap(archetype => trainers.has(archetype.id) ? [trainers.get(archetype.id)!] : []);
}

/** The Pokémon a trainer brings to a season, in team order (the signature last), with its form for that season. */
export function leagueTeamSpecies(trainer: LeagueTrainer, season: number): { speciesId: SpeciesId; signature: boolean }[] {
  const members = trainer.members.slice(0, leagueTeamSize(season) - 1).map(member => ({ speciesId: membersEvolved(season) ? member.finalId : member.earlyId, signature: false }));
  return [...members, { speciesId: signatureEvolved(season) ? trainer.signature.finalId : trainer.signature.earlyId, signature: true }];
}
/**
 * A trainer's team at this power: the power is split by integer weights — stage 1 / 2 / 3 → `stageWeights`, the signature ×
 * `signaturePercent`% — and each Pokémon's HP, attack and defence are scaled so they add up to its share (as the v26 teams).
 */
export function leagueTeam(trainer: LeagueTrainer, season: number, power: number, content: Content): BattleCombatant[] {
  const tuning = trainersTuning(content), team = leagueTeamSpecies(trainer, season);
  const weight = (entry: { speciesId: SpeciesId; signature: boolean }) =>
    tuning.stageWeights[content.species[entry.speciesId].stage - 1]! * (entry.signature ? tuning.signaturePercent : 100);
  const total = team.reduce((sum, entry) => sum + weight(entry), 0);
  return team.map((entry, member) => {
    const species = content.species[entry.speciesId], base = species.maxHp + species.attack + species.defense;
    const share = Math.floor(power * weight(entry) / total), scale = (stat: number) => Math.max(1, Math.floor(stat * share / base));
    return { id: `${trainer.entrantId}-${season}-${member}`, unitId: null, side: 'away' as const, speciesId: entry.speciesId,
      typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
      hp: scale(species.maxHp), maxHp: scale(species.maxHp), attack: scale(species.attack), defense: scale(species.defense), power: species.power };
  });
}
/** §7.1 who comes to a season: the trainers who sat out the previous season first, then stableSeed order (per season). */
export function leagueSeasonTrainers(seed: number, season: number, content: Content, history: readonly ChampionshipSeason[] = []): LeagueTrainer[] {
  const previous = new Set(history.find(item => item.season === season - 1)?.entrants.map(entrant => entrant.entrantId) ?? []);
  const order = (trainer: LeagueTrainer) => stableSeed(seed, season, trainer.id, 'league-order');
  return [...leagueRoster(seed, content)].sort((a, b) => Number(previous.has(a.entrantId)) - Number(previous.has(b.entrantId)) || order(a) - order(b) || (a.id < b.id ? -1 : 1));
}
/** The power of the NPC team in this slot (v26's season and slot steps, the trainers' base). */
export function leagueTeamPower(season: number, slot: number, content: Content): number {
  const tuning = depth26Tuning(content);
  return trainersTuning(content).npcBasePower + season * tuning.npcSeasonPower + slot * tuning.npcSlotPower;
}

/** The season's NPC entrants from the league roster (slot order), or null for the v26 per-season draw. Public setup and history only. */
export function leagueRosterEntrants(seed: number, season: number, content: Content, history: readonly ChampionshipSeason[] = []): ChampionshipNpc[] | null {
  if (!content.leagueTrainers) return null;
  return leagueSeasonTrainers(seed, season, content, history).slice(0, CIVILIZATION_CONTENT.championship.entrantCount).map((trainer, index) => ({
    entrantId: trainer.entrantId, name: trainer.name, roster: leagueTeam(trainer, season, leagueTeamPower(season, index + 1, content), content),
  }));
}

// ---------- records and the nemesis (from the public season history) ----------

export type LeagueRecord = {
  entrantId: string; seasons: number[]; titles: number; wins: number; losses: number;
  /** Head-to-head against each civilization: the trainer's wins and losses. */
  versus: Record<number, { wins: number; losses: number }>;
};
const playerOf = (entrantId: string): number | null => entrantId.startsWith('player-') ? Number(entrantId.slice('player-'.length)) : null;
/** Every league trainer's record so far (entrant id → record). */
export function leagueRecords(history: readonly ChampionshipSeason[]): Map<string, LeagueRecord> {
  const records = new Map<string, LeagueRecord>();
  const record = (entrantId: string) => {
    let found = records.get(entrantId);
    if (!found) records.set(entrantId, found = { entrantId, seasons: [], titles: 0, wins: 0, losses: 0, versus: {} });
    return found;
  };
  for (const season of history) {
    for (const entrant of season.entrants) if (leagueTrainerId(entrant.entrantId)) record(entrant.entrantId).seasons.push(season.season);
    if (leagueTrainerId(season.championEntrantId)) record(season.championEntrantId).titles++;
    for (const match of season.matches) for (const [index, entrantId] of match.entrantIds.entries()) {
      if (!leagueTrainerId(entrantId)) continue;
      const won = match.winnerEntrantId === entrantId, own = record(entrantId), opponent = playerOf(match.entrantIds[1 - index]!);
      if (won) own.wins++; else own.losses++;
      if (opponent === null) continue;
      const versus = own.versus[opponent] ??= { wins: 0, losses: 0 };
      if (won) versus.wins++; else versus.losses++;
    }
  }
  return records;
}
/** A civilization's nemesis: the league trainer who has beaten it most (ties: the latest such win, then the entrant id); null if none. */
export function leagueNemesis(history: readonly ChampionshipSeason[], playerId: number): { entrantId: string; wins: number; lastSeason: number } | null {
  const own = `player-${playerId}`, beaten = new Map<string, { wins: number; lastSeason: number }>();
  for (const season of history) for (const match of season.matches) {
    if (!match.entrantIds.includes(own) || match.winnerEntrantId === own || !leagueTrainerId(match.winnerEntrantId)) continue;
    const entry = beaten.get(match.winnerEntrantId) ?? { wins: 0, lastSeason: 0 };
    beaten.set(match.winnerEntrantId, { wins: entry.wins + 1, lastSeason: season.season });
  }
  const [best] = [...beaten.entries()].sort(([a, x], [b, y]) => y.wins - x.wins || y.lastSeason - x.lastSeason || (a < b ? -1 : 1));
  return best ? { entrantId: best[0], ...best[1] } : null;
}
/** §7.1: era score +1 (once per season) for each civilization that beat its nemesis (as it stood before the season) this season. */
export function settleLeagueNemeses(state: GameState, content: Content): EventPayload[] {
  const history = state.expansion?.civilization?.championship.history;
  const season = history?.at(-1);
  if (!content.leagueTrainers || !history || !season) return [];
  const before = history.slice(0, -1), events: LeagueTrainerEvent[] = [];
  for (const entrant of season.entrants) {
    if (entrant.playerId === null || state.players[entrant.playerId]?.eliminated) continue;
    const nemesis = leagueNemesis(before, entrant.playerId);
    if (!nemesis || !season.matches.some(match => match.entrantIds.includes(nemesis.entrantId) && match.winnerEntrantId === entrant.entrantId)) continue;
    const name = season.entrants.find(item => item.entrantId === nemesis.entrantId)?.name ?? '';
    events.push({ type: 'LeagueNemesisBeaten', playerId: entrant.playerId, entrantId: nemesis.entrantId, name, season: season.season, eraScore: 1 });
  }
  return events;
}
/** The archetype (title, personality, lines) of a roster trainer. */
export const leagueArchetype = (trainer: Pick<LeagueTrainer, 'id'>): TrainerArchetype => trainerArchetype(trainer.id);
