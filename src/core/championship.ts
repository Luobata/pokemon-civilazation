// League conference championship: NPC entrants, team registration, bracket relay matches, and title awards.
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { CivilizationContent } from '../content/civilization-systems.ts';
import { CONFERENCE_TRAINERS } from '../content/conference.ts';
import { depth26Tuning } from '../content/depth-v26.ts';
import { regionalSpeciesIds } from '../content/roster.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import { stableSeed } from '../content/stable-seed.ts';
import type { Content } from '../content/units.ts';
import { atPeaceWithAll, battleRosterFromState, civilization, isPokemon, relayFighters, sortedPlayerIds, teamPower, titlesNeeded } from './civilization-model.ts';
import type { ChampionshipEntrant, ChampionshipMatch, ChampionshipNpc, ChampionshipSeason, CivilizationAction, CivilizationHost } from './civilization-model.ts';
import { clonePlain } from './clone.ts';
import { leagueRosterEntrants, settleLeagueNemeses } from './league-roster.ts';
import type { EventPayload } from './model.ts';
import { conferenceRivals, settleConferenceRivals } from './rival-duels.ts';
import type { ConferenceRival } from './rival-duels.ts';
import { battleSeed, fighterFromCombatant, healBetween, resolveTeamBattle } from './team-battle.ts';
import type { RelayFighter } from './team-battle.ts';

/**
 * v26 (depth-v26 §2.2): the six NPC teams of a season, in slot order (a season uses the first 6 − civilizations entered). Each team has
 * two types (stableSeed) and picks regional Pokémon of those types, highest stage first; its total power is
 * `npcBasePower + season × npcSeasonPower + slot × npcSlotPower`, split evenly and scaled per Pokémon (integers). Public setup only.
 */
export function championshipNpcEntrants(seed: number, season: number, content: Content, history: readonly ChampionshipSeason[] = []): ChampionshipNpc[] {
  // v27 ⑥: the league roster (null before v27); who sat out the previous season (public history) comes first.
  const league = leagueRosterEntrants(seed, season, content, history);
  if (league) return league;
  const tuning = depth26Tuning(content), size = CIVILIZATION_CONTENT.championship.teamSize;
  const ids = [...regionalSpeciesIds(content)].filter(id => content.species[id]).sort() as SpeciesId[];
  const types = [...new Set(ids.flatMap(id => [content.species[id].typeId, content.species[id].secondaryTypeId].filter((type): type is TypeId => Boolean(type))))].sort();
  return Array.from({ length: CIVILIZATION_CONTENT.championship.entrantCount }, (_, index) => {
    const slot = index + 1, tag = (part: string) => stableSeed(seed, season, slot, part);
    const first = types[tag('npc-type-1') % types.length], rest = types.filter(type => type !== first);
    const second = rest.length ? rest[tag('npc-type-2') % rest.length] : first;
    const has = (id: SpeciesId, type: TypeId) => content.species[id].typeId === type || content.species[id].secondaryTypeId === type;
    const order = (a: SpeciesId, b: SpeciesId) => content.species[b].stage - content.species[a].stage || stableSeed(seed, season, slot, a) - stableSeed(seed, season, slot, b) || (a < b ? -1 : 1);
    const pool = [...ids.filter(id => has(id, first)).sort(order), ...ids.filter(id => has(id, second) && !has(id, first)).sort(order),
      ...ids.filter(id => !has(id, first) && !has(id, second)).sort(order)];
    const power = tuning.npcBasePower + season * tuning.npcSeasonPower + slot * tuning.npcSlotPower, share = Math.floor(power / size);
    const roster = pool.slice(0, size).map((speciesId, member) => {
      const species = content.species[speciesId], base = species.maxHp + species.attack + species.defense;
      const scale = (stat: number) => Math.max(1, Math.floor(stat * share / base));
      return { id: `npc-${season}-${slot}-${member}`, unitId: null, side: 'away' as const, speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
        hp: scale(species.maxHp), maxHp: scale(species.maxHp), attack: scale(species.attack), defense: scale(species.defense), power: species.power };
    });
    return { entrantId: `npc-${season}-${slot}`, name: CONFERENCE_TRAINERS[tag('npc-name') % CONFERENCE_TRAINERS.length], roster };
  });
}

/**
 * v26: the NPC entrants of the next season for these entered civilizations — first their rivals at the conference (§3.1, the 4th visit),
 * then the season's NPC teams in slot order. The view shows the same list (for the civilizations entered so far).
 */
export function seasonNpcEntrants(state: CivilizationHost, content: CivilizationContent, entered: readonly number[]): { npcs: ChampionshipNpc[]; rivals: ConferenceRival[] } {
  const championship = civilization(state)!.championship, season = championship.nextSeason, tuning = depth26Tuning(content.world);
  const slots = Math.max(0, content.championship.entrantCount - entered.length);
  const rivals = conferenceRivals(state, content.world, season, entered, slots, slot => tuning.npcBasePower + season * tuning.npcSeasonPower + slot * tuning.npcSlotPower, entered.length + 1);
  const npcs = championshipNpcEntrants(state.setup.seed, season, content.world, championship.history).slice(0, slots - rivals.length);
  return { npcs: [...rivals.map(rival => ({ entrantId: rival.entrantId, name: rival.name, roster: rival.roster })), ...npcs], rivals };
}

export function validateChampionshipAction(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'RegisterChampionshipTeam' }>, content: CivilizationContent): string | null {
  const ids = action.unitIds;
  if (ids.length !== content.championship.teamSize || new Set(ids).size !== ids.length) return 'invalid-team';
  if (!ids.every(id => isPokemon(state.units[id]) && state.units[id]!.ownerId === actorId)) return 'unit-unavailable';
  if (!atPeaceWithAll(state, actorId)) return 'peace-required';
  // Registering again before the season replaces the team and its order.
  return null;
}

export function applyChampionshipAction(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'RegisterChampionshipTeam' }>, content: CivilizationContent): EventPayload[] {
  const civilizationState = civilization(state)!;
  civilizationState.championship.registrations[actorId] = {
    unitIds: [...action.unitIds], registeredRound: state.round, power: teamPower(state, action.unitIds, content),
  };
  return [{ type: 'ChampionshipTeamRegistered', playerId: actorId, unitIds: action.unitIds,
    power: civilizationState.championship.registrations[actorId]!.power, season: civilizationState.championship.nextSeason }];
}

/** v26 relay match: each side heals half its lost HP if it has fought already this season; the roster records the HP afterwards. */
function relayChampionshipMatch(label: ChampionshipMatch['label'], first: ChampionshipEntrant, second: ChampionshipEntrant, relays: Map<string, RelayFighter[]>,
  fought: Set<string>, state: CivilizationHost): ChampionshipMatch {
  const home = relays.get(first.entrantId)!, away = relays.get(second.entrantId)!;
  for (const [entrant, team] of [[first, home], [second, away]] as const) if (fought.has(entrant.entrantId)) healBetween(team);
  const battle = resolveTeamBattle(home, away, battleSeed(state.rng), 'grassland');
  for (const [entrant, team] of [[first, home], [second, away]] as const) {
    team.forEach((fighter, index) => { entrant.roster[index].hp = fighter.hp; });
    fought.add(entrant.entrantId);
  }
  const winner = battle.winnerSide === 'home' ? first : second;
  const total = (entrant: ChampionshipEntrant) => entrant.roster.reduce((sum, combatant) => sum + combatant.hp, 0);
  return { label, entrantIds: [first.entrantId, second.entrantId], winnerEntrantId: winner.entrantId, scores: [total(first), total(second)], battle };
}

function finishChampionship(state: CivilizationHost, events: EventPayload[], entrants: ChampionshipEntrant[],
  championshipMatch: (label: ChampionshipMatch['label'], first: ChampionshipEntrant, second: ChampionshipEntrant) => ChampionshipMatch): void {
  const civilizationState = civilization(state)!;
  const championship = civilizationState.championship;
  const seeds = [...entrants].sort((a, b) => b.power - a.power || a.entrantId.localeCompare(b.entrantId));
  const preliminary1 = championshipMatch('preliminary-1', seeds[2]!, seeds[5]!);
  const preliminary2 = championshipMatch('preliminary-2', seeds[3]!, seeds[4]!);
  const winner1 = seeds.find(entrant => entrant.entrantId === preliminary1.winnerEntrantId)!;
  const winner2 = seeds.find(entrant => entrant.entrantId === preliminary2.winnerEntrantId)!;
  const semifinal1 = championshipMatch('semifinal-1', seeds[0]!, winner2);
  const semifinal2 = championshipMatch('semifinal-2', seeds[1]!, winner1);
  const finalist1 = seeds.find(entrant => entrant.entrantId === semifinal1.winnerEntrantId)!;
  const finalist2 = seeds.find(entrant => entrant.entrantId === semifinal2.winnerEntrantId)!;
  const final = championshipMatch('final', finalist1, finalist2);
  const champion = entrants.find(entrant => entrant.entrantId === final.winnerEntrantId)!;
  const season: ChampionshipSeason = {
    season: championship.nextSeason, round: state.round, entrants: clonePlain(entrants),
    matches: [preliminary1, preliminary2, semifinal1, semifinal2, final],
    championEntrantId: champion.entrantId, championPlayerId: champion.playerId,
  };
  for (const entrant of entrants) for (const combatant of entrant.roster) {
    if (combatant.unitId !== null && state.units[combatant.unitId]) {
      state.units[combatant.unitId]!.hp = Math.max(1, combatant.hp);
      state.units[combatant.unitId]!.actionLeft = 0;
    }
  }
  championship.history.push(season);
  if (champion.playerId !== null) {
    championship.titlesByPlayer[champion.playerId] = (championship.titlesByPlayer[champion.playerId] ?? 0) + 1;
    if (championship.titlesByPlayer[champion.playerId] >= titlesNeeded(state)) {
      championship.victory = { playerId: champion.playerId, season: season.season, round: state.round };
      civilizationState.victory = { kind: 'championship', playerId: champion.playerId, round: state.round, season: season.season };
    }
  }
  championship.registrations = {};
  championship.nextSeason++;
  championship.nextRound += championship.intervalRounds;
  events.push({ type: 'ChampionshipResolved', public: true, playerId: champion.playerId, season: clonePlain(season) });
}

function resolveChampionship(state: CivilizationHost, content: CivilizationContent, events: EventPayload[]): void {
  const civilizationState = civilization(state)!;
  const championship = civilizationState.championship;
  const entrants: ChampionshipEntrant[] = [];
  for (const playerId of sortedPlayerIds(state)) {
    const registration = championship.registrations[playerId];
    if (!registration) continue;
    const valid = registration.unitIds.length === content.championship.teamSize
      && registration.unitIds.every(unitId => isPokemon(state.units[unitId]) && state.units[unitId]!.ownerId === playerId);
    if (!valid) continue;
    const roster = battleRosterFromState(state, registration.unitIds, 'home', `player-${playerId}`, content);
    entrants.push({
      entrantId: `player-${playerId}`, playerId, unitIds: [...registration.unitIds],
      power: teamPower(state, registration.unitIds, content), roster,
    });
  }
  const relays = new Map<string, RelayFighter[]>();
  for (const entrant of entrants) relays.set(entrant.entrantId, relayFighters(state, entrant.unitIds, entrant.entrantId, content.world));
  const { npcs, rivals } = seasonNpcEntrants(state, content, entrants.map(entrant => entrant.playerId!));
  for (const npc of npcs) {
    entrants.push({ entrantId: npc.entrantId, playerId: null, name: npc.name, unitIds: [], power: npc.roster.reduce((total, member) => total + member.maxHp + member.attack + member.defense, 0), roster: npc.roster });
    relays.set(npc.entrantId, npc.roster.map(member => fighterFromCombatant(member, content.world)));
  }
  const fought = new Set<string>();
  finishChampionship(state, events, entrants, (label, first, second) => relayChampionshipMatch(label, first, second, relays, fought, state));
  if (rivals.length) events.push(...settleConferenceRivals(state, rivals, state.expansion!.civilization.championship.history.at(-1)!.matches));
  events.push(...settleLeagueNemeses(state, content.world));
}

export function resolveChampionshipRound(state: CivilizationHost, content: CivilizationContent, events: EventPayload[]): void {
  const civilizationState = civilization(state)!;
  if (state.round >= civilizationState.championship.nextRound) resolveChampionship(state, content, events);
  // v26: the next season's NPC teams are public from five rounds ahead (the view carries them; this is the notice).
  else if (civilizationState.championship.nextRound - state.round === 6) {
    const championship = civilizationState.championship;
    events.push({ type: 'ChampionshipLineupAnnounced', public: true, season: championship.nextSeason, round: championship.nextRound,
      entrants: championshipNpcEntrants(state.setup.seed, championship.nextSeason, content.world, championship.history).map(npc => ({ entrantId: npc.entrantId, name: npc.name, speciesIds: npc.roster.map(member => member.speciesId) })) });
  }
}
