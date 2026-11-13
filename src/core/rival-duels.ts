// Gameplay v26 P3 (docs/design/depth-v26.md §3, option 3A): ChallengeRival — a relay duel against the own rival's team on the map. As many
// own Pokémon as rival Pokémon left, all with their action, each within 2 tiles of a rival Pokémon and one next to it; or, at the city gate,
// all within 2 tiles of an own city a rival Pokémon stands next to. Once per round. The rival's order is its arrival order (main counter
// first), at its map HP, with its 劲敌气势 on attack and defence. Friendly (spar): half the visit's reward once per visit and the rival stays;
// serious: the full reward plus the rival's proof (+1 era score) and the visit ends, or a lost serious duel pays the rival a prize and
// lifts its 气势 by 3 for the rest of the visit. One battle seed from state.rng. The authority, the lineup picker and the AI share the rules.
import { RIVAL_RULES_V24 } from '../content/rivals.ts';
import { depth26Tuning } from '../content/depth-v26.ts';
import type { Content } from '../content/units.ts';
import { contentForView } from '../content/units.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { regionalSpeciesIds } from '../content/roster.ts';
import type { SpeciesId } from '../content/species.ts';
import type { BattleCombatant } from './civilization-systems.ts';
import type { BiomeId } from '../content/rules.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit, PlayerView } from './model.ts';
import { defeatRivalVisit, rivalCounters, rivalSpirit } from './rivals.ts';
import { taughtMoveType } from './gold-sinks.ts';
import { battleSeed, fighterFromUnit, resolveTeamBattle } from './team-battle.ts';
import type { BattleTraceV26 } from './team-battle.ts';

export type RivalDuelStake = 'spar' | 'serious';
export type RivalDuelAction = { type: 'ChallengeRival'; unitIds: number[]; stake: RivalDuelStake };
export type RivalDuelEvent =
  | { type: 'RivalDuel'; playerId: number; encounter: number; stake: RivalDuelStake; victory: boolean; unitIds: number[]; gold: number; pokeBalls: number; research: number;
      prize: number; battle: BattleTraceV26 }
  /** The own rival knocked out at the conference (the 4th visit): +100 gold, era score +2 ("宿命的对决"). */
  | { type: 'RivalConferenceBeaten'; playerId: number; gold: number; eraScore: number };
export const isRivalDuelAction = (action: { type: unknown }): action is RivalDuelAction => action.type === 'ChallengeRival';
/** Extra 劲敌气势 after a lost serious duel, and for a visit after two beaten in a row (§3.1). */
export const RIVAL_DUEL_RULES = { lossSpirit: 3, streakSpirit: 3, streakRewardPercent: 125, fullHpGoldPercent: 150 } as const;

type Spot = { id: number; ownerId: number | null; kind: string; actionLeft: number; position: Hex };
/** Shared by the authority and the view: why these own Pokémon cannot duel these rival Pokémon (null = they can). */
export function duelBlocker(input: { units: readonly Spot[]; rivals: readonly Spot[]; cities: readonly { ownerId: number | null; position: Hex }[]; actorId: number;
  ids: readonly number[]; map: { width: number; height: number; wrap?: boolean }; lastDuelRound?: number; round: number }): string | null {
  const { rivals, map } = input;
  if (!rivals.length) return 'rival-unavailable';
  if (input.lastDuelRound === input.round) return 'duel-cooldown';
  if (input.ids.length !== rivals.length || new Set(input.ids).size !== input.ids.length) return 'invalid-team';
  const team = input.ids.map(id => input.units.find(unit => unit.id === id));
  if (!team.every(unit => unit && unit.ownerId === input.actorId && unit.kind === 'pokemon' && unit.actionLeft === 1)) return 'unit-unavailable';
  const near = (a: Hex, b: Hex, range: number) => hexDistance(a, b, map) <= range;
  const field = team.every(unit => rivals.some(rival => near(unit!.position, rival.position, 2))) && team.some(unit => rivals.some(rival => near(unit!.position, rival.position, 1)));
  const gate = input.cities.some(city => city.ownerId === input.actorId && rivals.some(rival => near(city.position, rival.position, 1)) && team.every(unit => near(unit!.position, city.position, 2)));
  return field || gate ? null : 'unit-not-local';
}
const ledgerOf = (state: GameState, playerId: number) => state.expansion?.rivals?.byPlayer[playerId];
/** The visit's rival Pokémon still on the map, in arrival order (the duel order). */
export function rivalLineup(state: GameState, playerId: number): (MapUnit & { kind: 'pokemon' })[] {
  return (ledgerOf(state, playerId)?.activeUnitIds ?? []).flatMap(id => {
    const unit = state.units[id];
    return unit && isMapUnit(unit) && unit.kind === 'pokemon' && unit.ownerId === null ? [unit as MapUnit & { kind: 'pokemon' }] : [];
  });
}
export function validateRivalDuelAction(state: GameState, actorId: number, action: RivalDuelAction, content: Content): string | null {
  if (!content.rivalDuels || !state.expansion?.rivals) return 'rival-duels-unavailable';
  if (action.stake !== 'spar' && action.stake !== 'serious') return 'invalid-stake';
  const ledger = ledgerOf(state, actorId);
  if (!ledger) return 'rival-unavailable';
  return duelBlocker({ units: Object.values(state.units).filter(isMapUnit), rivals: rivalLineup(state, actorId), cities: Object.values(state.cities), actorId,
    ids: action.unitIds, map: state.map, lastDuelRound: ledger.duelRound, round: state.round });
}
export function applyRivalDuelAction(state: GameState, actorId: number, action: RivalDuelAction, content: Content): EventPayload[] {
  const reason = validateRivalDuelAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const ledger = ledgerOf(state, actorId)!, rivals = rivalLineup(state, actorId), visit = ledger.encounter - 1, player = state.players[actorId];
  const home = action.unitIds.map((id, index) => fighterFromUnit(state.units[id] as MapUnit & { kind: 'pokemon' }, `duel-${actorId}-${index}`, content, { taughtTypeId: taughtMoveType(state, id) }));
  const away = rivals.map((unit, index) => fighterFromUnit({ ...unit, xp: 0 }, `rival-${actorId}-${index}`, content, { spirit: rivalSpirit(state, unit.id) }));
  const fullHp = rivals.every(unit => unit.hp >= content.species[unit.speciesId].maxHp);
  const terrain: BiomeId = state.map.tiles[hexToIndex(rivals[0].position, state.map)!] ?? 'grassland';
  const battle = resolveTeamBattle(home, away, battleSeed(state.rng), terrain), victory = battle.winnerSide === 'home';
  for (const [index, id] of action.unitIds.entries()) {
    const unit = state.units[id]!;
    unit.hp = Math.max(1, home[index].hp);
    unit.actionLeft = 0;
  }
  for (const [index, unit] of rivals.entries()) unit.hp = Math.max(1, away[index].hp);
  ledger.duelRound = state.round;
  const log = ledger.duels ??= { spar: 0, serious: 0, won: 0 };
  log[action.stake === 'spar' ? 'spar' : 'serious']++;
  if (victory) log.won++;
  ledger.fought = [...new Set([...(ledger.fought ?? []), ...action.unitIds])].sort((a, b) => a - b);
  const reward = RIVAL_RULES_V24.rewards[visit] as { gold: number; pokeBalls?: number; research?: number };
  const tuning = depth26Tuning(content);
  const base = { type: 'RivalDuel' as const, playerId: actorId, encounter: ledger.encounter, stake: action.stake, victory, unitIds: [...action.unitIds], battle };
  if (victory && action.stake === 'serious') {
    // The visit ends: the reward (with the duel bonuses) and the rival's proof, through the same settlement as a map knockdown.
    const goldPercent = Math.floor((fullHp ? RIVAL_DUEL_RULES.fullHpGoldPercent : 100) * (ledger.streak ? RIVAL_DUEL_RULES.streakRewardPercent : 100) / 100);
    const events = defeatRivalVisit(state, actorId, { goldPercent, proof: true });
    const defeated = events.find(event => event.type === 'RivalDefeated');
    return [{ ...base, gold: defeated?.type === 'RivalDefeated' ? defeated.gold : 0, pokeBalls: defeated?.type === 'RivalDefeated' ? defeated.pokeBalls : 0,
      research: defeated?.type === 'RivalDefeated' ? defeated.research : 0, prize: 0 }, ...events];
  }
  if (victory) {
    // A friendly win: half the reward, once per visit; the rival stays and can still be fought in earnest.
    if (ledger.sparRewarded) return [{ ...base, gold: 0, pokeBalls: 0, research: 0, prize: 0 }];
    ledger.sparRewarded = true;
    const half = (value = 0) => Math.round(value * tuning.sparRewardPercent / 100);
    const gold = half(reward.gold), pokeBalls = half(reward.pokeBalls), research = half(reward.research);
    player.gold += gold; player.ballInventory.pokeBall += pokeBalls; player.research.reserve += research;
    return [{ ...base, gold, pokeBalls, research, prize: 0 }];
  }
  if (action.stake === 'spar') return [{ ...base, gold: 0, pokeBalls: 0, research: 0, prize: 0 }];
  // A lost serious duel: the rival takes a prize (as trainers do in the games) and is fired up for the rest of the visit.
  const prize = Math.max(0, Math.min(Math.floor(player.gold * tuning.prizePercent / 100), tuning.prizePerVisit * (visit + 1)));
  player.gold -= prize;
  for (const unit of rivals) state.expansion!.rivals!.spirit[unit.id] = rivalSpirit(state, unit.id) + RIVAL_DUEL_RULES.lossSpirit;
  return [{ ...base, gold: 0, pokeBalls: 0, research: 0, prize }];
}

// ---------- view ----------

/** The viewer's own rival Pokémon in sight, in duel order (the view's `activeUnitIds` order). */
export function viewRivalLineup(view: PlayerView): (MapUnit & { kind: 'pokemon' })[] {
  const rivals = view.expansion?.rivals;
  return (rivals?.activeUnitIds ?? []).flatMap(id => {
    const unit = view.units.find(item => item.id === id && item.kind === 'pokemon' && item.ownerId === null);
    return unit && rivals!.sightings.some(sighting => sighting.unitId === id && sighting.targetPlayerId === view.playerId) ? [unit as MapUnit & { kind: 'pokemon' }] : [];
  });
}
/** Why the viewer cannot duel with these Pokémon now (null = the authority accepts it). Every rival Pokémon must be in sight. */
export function viewRivalDuelBlocker(view: PlayerView, unitIds: readonly number[]): string | null {
  const rivals = view.expansion?.rivals;
  if (!rivals || !contentDuels(view)) return 'rival-duels-unavailable';
  if (view.outcome || view.activePlayerId !== view.playerId) return 'not-your-turn';
  const lineup = viewRivalLineup(view);
  if (lineup.length !== rivals.activeUnitIds.length) return 'rival-unavailable';
  return duelBlocker({ units: view.units, rivals: lineup, cities: view.economy.cities.map(city => ({ ownerId: view.playerId, position: city.position })), actorId: view.playerId,
    ids: unitIds, map: view.map, lastDuelRound: rivals.duelRound, round: view.round });
}
/** Own Pokémon that could join a duel now (each within reach on its own; the team still needs one next to a rival unless at the gate). */
export function viewDuelCandidates(view: PlayerView): { candidates: number[]; adjacent: number[]; gate: boolean } {
  const lineup = viewRivalLineup(view), cities = view.economy.cities;
  const gateCities = cities.filter(city => lineup.some(rival => hexDistance(city.position, rival.position, view.map) <= 1));
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1);
  const gate = gateCities.length > 0;
  const reach = own.filter(unit => lineup.some(rival => hexDistance(unit.position, rival.position, view.map) <= 2)
    || gateCities.some(city => hexDistance(unit.position, city.position, view.map) <= 2));
  return { candidates: reach.map(unit => unit.id).sort((a, b) => a - b), gate,
    adjacent: reach.filter(unit => lineup.some(rival => hexDistance(unit.position, rival.position, view.map) <= 1)).map(unit => unit.id).sort((a, b) => a - b) };
}
const contentDuels = (view: PlayerView) => Boolean(contentForView(view).rivalDuels);

// ---------- the conference (4th visit, §3.1) ----------

/** v26: from this round on, a civilization's rival enters the first conference the civilization enters (once per game). */
export const CONFERENCE_RIVAL_FROM_ROUND = 100;
export const RIVAL_CONFERENCE_REWARD = { gold: 100, eraScore: 2 } as const;
export type ConferenceRival = { entrantId: string; name: string; targetPlayerId: number; roster: BattleCombatant[] };
/**
 * The rivals entering this season (§3.1): for each entered civilization (in id order) whose three visits are over and whose rival has not
 * been to a conference, while NPC slots are left. The team: a stage-3 main counter, a stage-3 secondary counter and four stage-3 regional
 * Pokémon (stableSeed), at the season's NPC power for that slot plus `conferenceRivalPower`. Public: the rival's name and team.
 */
export function conferenceRivals(state: GameState, content: Content, season: number, entered: readonly number[], slots: number,
  npcPower: (slot: number) => number, firstSlot: number): ConferenceRival[] {
  const rivals = state.expansion?.rivals;
  if (!content.rivalDuels || !rivals || state.round < CONFERENCE_RIVAL_FROM_ROUND) return [];
  const out: ConferenceRival[] = [];
  for (const playerId of [...entered].sort((a, b) => a - b)) {
    const ledger = rivals.byPlayer[playerId];
    if (out.length >= slots || !ledger || ledger.conference || ledger.encounter < RIVAL_RULES_V24.arrivals.length || ledger.pending || ledger.activeUnitIds.length) continue;
    const starterId = state.players[playerId].starterId, stage3 = (ids: readonly SpeciesId[]) => ids.filter(id => content.species[id]?.stage === 3);
    const pick = (ids: readonly SpeciesId[], tag: string) => ids.length ? ids[stableSeed(state.setup.seed, playerId, season, tag) % ids.length] : undefined;
    const primary = pick(stage3(rivalCounters(content, starterId, 'primary')), 'conference-primary');
    const secondary = pick(stage3(rivalCounters(content, starterId, 'secondary')), 'conference-secondary');
    const chosen = [primary, secondary].filter((id): id is SpeciesId => Boolean(id));
    const rest = stage3([...regionalSpeciesIds(content)].sort() as SpeciesId[]).filter(id => !chosen.includes(id))
      .sort((a, b) => stableSeed(state.setup.seed, playerId, season, a) - stableSeed(state.setup.seed, playerId, season, b) || (a < b ? -1 : 1));
    const team = [...chosen, ...rest].slice(0, 6), slot = firstSlot + out.length;
    const share = Math.floor((npcPower(slot) + depth26Tuning(content).conferenceRivalPower) / 6);
    out.push({ entrantId: `rival-${playerId}`, name: ledger.name, targetPlayerId: playerId, roster: team.map((speciesId, member) => {
      const species = content.species[speciesId], base = species.maxHp + species.attack + species.defense;
      const scale = (stat: number) => Math.max(1, Math.floor(stat * share / base));
      return { id: `rival-${playerId}-${season}-${member}`, unitId: null, side: 'away' as const, speciesId,
        typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
        hp: scale(species.maxHp), maxHp: scale(species.maxHp), attack: scale(species.attack), defense: scale(species.defense), power: species.power };
    }) });
  }
  return out;
}
/** After a season with rivals: the target that knocked its own rival out gets the reward (+100 gold, era score +2); the rival is done. */
export function settleConferenceRivals(state: GameState, rivals: readonly Pick<ConferenceRival, 'entrantId' | 'targetPlayerId'>[],
  matches: readonly { entrantIds: [string, string]; winnerEntrantId: string }[]): EventPayload[] {
  const ledgers = state.expansion?.rivals?.byPlayer, events: EventPayload[] = [];
  for (const rival of rivals) {
    const ledger = ledgers?.[rival.targetPlayerId];
    if (!ledger) continue;
    const own = `player-${rival.targetPlayerId}`;
    const beaten = matches.some(match => match.entrantIds.includes(own) && match.entrantIds.includes(rival.entrantId) && match.winnerEntrantId === own);
    ledger.conference = beaten ? 'beaten' : 'entered';
    if (!beaten || state.players[rival.targetPlayerId].eliminated) continue;
    state.players[rival.targetPlayerId].gold += RIVAL_CONFERENCE_REWARD.gold;
    events.push({ type: 'RivalConferenceBeaten', playerId: rival.targetPlayerId, gold: RIVAL_CONFERENCE_REWARD.gold, eraScore: RIVAL_CONFERENCE_REWARD.eraScore });
  }
  return events;
}
