// Shared types, battle helpers, and victory hooks for the civilization expansion.
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { CivilizationContent, OfferingResource, PhantomCategory } from '../content/civilization-systems.ts';
import { depth26Tuning } from '../content/depth-v26.ts';
import type { TechId } from '../content/economy.ts';
import { victoryTargets } from '../content/opening.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { clonePlain } from './clone.ts';
import { damage, dualEffectiveness, terrainMultiplier } from './combat-math.ts';
import type { Hex } from './hex.ts';
import type { LeagueTrainerEvent } from './league-roster.ts';
import type { CityState, EventPayload, GameState, UnitState } from './model.ts';
import { createRng, randomBelow } from './rng.ts';
import { taughtMoveType } from './state-queries.ts';
import { fighterFromCombatant, fighterFromUnit } from './team-battle.ts';
import type { BattleTraceV26, RelayFighter } from './team-battle.ts';
import { finishGame } from './victory.ts';
export { stableSeed } from '../content/stable-seed.ts';

export type CivilizationPlayerState = {
  offeringPoints: number;
  lifetimeOfferings: number;
  offeredThisRoundByCity: Record<number, OfferingResource>;
  nextPhantomCost: number;
  summonedPhantomIds: string[];
  activePhantoms: string[];
  hallOfFame: string[];
  phantomNameLedger: Record<string, string>;
};
export type SanctuarySite = {
  id: string;
  name: string;
  tabletId: string;
  tabletName: string;
  guardianName: string;
  guardianSpeciesId: SpeciesId;
  challengePower: number;
  position: Hex;
  ownerId: number | null;
  guardianDefeated: boolean;
  challengeRoundByPlayer: Record<number, number>;
};
export type BattleCombatant = {
  id: string;
  unitId: number | null;
  side: 'challenger' | 'guardian' | 'home' | 'away';
  speciesId: SpeciesId;
  typeIds: TypeId[];
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  power: number;
};
export type BattleStrike = {
  attackerId: string;
  defenderId: string;
  damage: number;
  effectiveness: number;
  roll: number;
  defenderHpAfter: number;
};
export type BattleRound = { round: number; strikes: BattleStrike[] };
export type BattleTrace = { seed: number; rounds: BattleRound[]; winnerSide: 'challenger' | 'guardian' | 'home' | 'away' };
export type ChampionshipEntrant = {
  entrantId: string;
  playerId: number | null;
  /** v26: an NPC trainer's original name (absent before v26 and for civilizations). */
  name?: string;
  unitIds: number[];
  power: number;
  roster: BattleCombatant[];
};
export type ChampionshipMatch = {
  label: 'preliminary-1' | 'preliminary-2' | 'semifinal-1' | 'semifinal-2' | 'final';
  entrantIds: [string, string];
  winnerEntrantId: string;
  scores: [number, number];
  battle: BattleTrace | BattleTraceV26;
};
export type ChampionshipSeason = {
  season: number;
  round: number;
  entrants: ChampionshipEntrant[];
  matches: ChampionshipMatch[];
  championEntrantId: string;
  championPlayerId: number | null;
};
export type CivilizationRelation = {
  allianceProposal: { proposerId: number; proposedRound: number } | null;
  allianceSinceRound: number | null;
  allianceLastProposalRound: number | null;
  allianceLastRejectedRound: number | null;
  betrayalCooldownUntilRound: number;
  tradeProposal: { proposerId: number; proposedRound: number } | null;
  tradeSinceRound: number | null;
  tradeLastProposalRound: number | null;
  tradeLastRejectedRound: number | null;
  trust: number;
  betrayedBy: number[];
};
export type CivilizationVictory = {
  kind: 'origin' | 'championship';
  playerId: number;
  round: number;
  tablets?: string[];
  season?: number;
};
export type CivilizationState = {
  version: 1;
  initializedRound: number;
  sanctuaries: SanctuarySite[];
  players: Record<number, CivilizationPlayerState>;
  tabletOwners: Record<string, number>;
  pendingProductionByCity: Record<number, { playerId: number; amount: number }>;
  championship: {
    nextSeason: number;
    nextRound: number;
    intervalRounds: number;
    registrations: Record<number, { unitIds: number[]; registeredRound: number; power: number }>;
    history: ChampionshipSeason[];
    titlesByPlayer: Record<number, number>;
    victory: { playerId: number; season: number; round: number } | null;
  };
  relations: Record<string, CivilizationRelation>;
  victory: CivilizationVictory | null;
};
export type CivilizationAction =
  | { type: 'MakeOffering'; cityId: number; resource: OfferingResource }
  | { type: 'SummonPhantom'; category: PhantomCategory }
  | { type: 'ActivatePhantom'; phantomId: string; cityId?: number; techId?: string; unitIds?: number[] }
  | { type: 'EstablishSanctuary'; siteId: string; unitId: number }
  | { type: 'ChallengeGuardian'; siteId: string; unitIds: number[] }
  | { type: 'RegisterChampionshipTeam'; unitIds: number[] }
  | { type: 'ProposeAlliance' | 'RespondAlliance' | 'DissolveAlliance' | 'ProposeTrade' | 'RespondTrade' | 'BetrayAlliance';
      targetPlayerId: number;
      accept?: boolean;
    };
export type CivilizationEvent =
  /** v27 ⑥: a civilization beat its league nemesis (era score). */
  | LeagueTrainerEvent
  | { type: 'OfferingMade'; playerId: number; cityId: number; resource: OfferingResource; points: number }
  | { type: 'PhantomSummoned'; playerId: number; phantomId: string; name: string; cost: number; offeringPointsAfter: number }
  | { type: 'PhantomActivated'; playerId: number; phantomId: string; name: string; cityId?: number; techId?: string; unitIds?: number[]; amount: number }
  | { type: 'PhantomResearchCompleted'; playerId: number; phantomId: string; techId: string }
  | { type: 'SanctuaryEstablished'; playerId: number; siteId: string; goldAfter: number }
  | { type: 'GuardianChallenged'; playerId: number; siteId: string; challengePower: number; teamPower: number; victory: boolean; battle: BattleTrace | BattleTraceV26 }
  /** v26 (depth-v26 §2.2): the season's NPC teams, five rounds ahead (public). */
  | { type: 'ChampionshipLineupAnnounced'; public: true; season: number; round: number; entrants: { entrantId: string; name: string; speciesIds: SpeciesId[] }[] }
  | { type: 'ChampionshipTeamRegistered'; playerId: number; unitIds: number[]; power: number; season: number }
  | { type: 'ChampionshipResolved'; public: true; playerId: number | null; season: ChampionshipSeason }
  | { type: 'AllianceChanged'; public: boolean; playerIds: [number, number]; status: 'proposed' | 'active' | 'dissolved' | 'betrayed'; proposerId?: number }
  | { type: 'TradeChanged'; public: boolean; playerIds: [number, number]; status: 'proposed' | 'active' | 'expired' | 'ended'; proposerId?: number }
  | { type: 'TradeSettled'; playerId: number; targetPlayerId: number; gold: number; trust: number }
  | { type: 'CivilizationProductionConsumed'; playerId: number; cityId: number; amount: number }
  | { type: 'CivilizationVictoryAchieved'; playerId: number; kind: 'origin' | 'championship'; round: number };
export type CivilizationPlanningCity = { id: number; food: number; hasProduction: boolean };
export type CivilizationPlanningUnit = {
  id: number;
  speciesId: SpeciesId;
  position: Hex | null;
  actionLeft: 0 | 1;
  power: number;
};
export type CivilizationPlanningState = {
  playerId: number;
  gold: number;
  activeResearchTechId: TechId | null;
  atPeaceWithAll: boolean;
  canOffer: boolean;
  cities: CivilizationPlanningCity[];
  units: CivilizationPlanningUnit[];
};
export type CivilizationSanctuaryView = {
  id: string;
  name: string;
  tabletId: string;
  tabletName: string;
  guardianName: string;
  guardianSpeciesId: SpeciesId;
  challengePower: number;
  position: Hex;
  ownerId: number | null;
  guardianDefeated: boolean;
  /** v26: the viewer's own last challenge round here (the AI waits 3 rounds between tries). */
  lastChallengeRound?: number;
};
export type CivilizationRelationView = CivilizationRelation & {
  targetPlayerId: number;
  atPeace: boolean;
  targetEliminated: boolean;
};
export type CivilizationPlanningPolicy = {
  maximumAllies: number;
  blockedAllianceTargetPlayerIds: readonly number[];
};
/** v26: a conference NPC team (an original trainer name, Pokémon of two themed types from the regional Pokédex). */
export type ChampionshipNpc = { entrantId: string; name: string; roster: BattleCombatant[] };

export type CivilizationView = {
  version: 1;
  playerId: number;
  round: number;
  victory: CivilizationVictory | null;
  sanctuaries: CivilizationSanctuaryView[];
  tabletOwners: Record<string, number>;
  player: CivilizationPlayerState;
  championship: {
    nextSeason: number;
    nextRound: number;
    intervalRounds: number;
    registration: { unitIds: number[]; registeredRound: number; power: number } | null;
    history: ChampionshipSeason[];
    titlesByPlayer: Record<number, number>;
    victory: CivilizationState['championship']['victory'];
    registrationCount: number;
    /** v26 (depth-v26 §2.2): the NPC teams of the next season, from five rounds ahead (public); absent before v26. */
    lineup?: ChampionshipNpc[];
  };
  relations: CivilizationRelationView[];
  planning: CivilizationPlanningState;
};

export type CivilizationHost = GameState;
export const RELATION_ACTIONS = ['ProposeAlliance', 'RespondAlliance', 'DissolveAlliance', 'ProposeTrade', 'RespondTrade', 'BetrayAlliance'] as const;
export const PHANTOM_IDS = ['scientist', 'engineer', 'merchant', 'general', 'artist'] as const;

export function sanctuaryView(site: SanctuarySite): CivilizationSanctuaryView {
  return {
    id: site.id, name: site.name, tabletId: site.tabletId, tabletName: site.tabletName,
    guardianName: site.guardianName, guardianSpeciesId: site.guardianSpeciesId,
    challengePower: site.challengePower, position: { ...site.position }, ownerId: site.ownerId,
    guardianDefeated: site.guardianDefeated,
  };
}
export function civilization(state: CivilizationHost): CivilizationState | undefined {
  return state.expansion?.civilization;
}
export function sortedPlayerIds(state: CivilizationHost): number[] {
  return Object.keys(state.players).map(Number).sort((a, b) => a - b);
}
export function relationKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}
export function civilizationRelation(state: CivilizationHost, a: number, b: number): CivilizationRelation | undefined {
  return civilization(state)?.relations[relationKey(a, b)];
}
export function isPokemon(unit: UnitState | undefined): unit is UnitState & { kind: 'pokemon' } {
  return !!unit && unit.ownerId !== null && unit.kind === 'pokemon';
}
export function ownedCity(state: CivilizationHost, actorId: number, cityId: number): CityState | undefined {
  const city = state.cities[cityId];
  return city?.ownerId === actorId ? city : undefined;
}
export function unitBattlePower(unit: UnitState, content: CivilizationContent): number {
  if (unit.kind !== 'pokemon') return 0;
  const species = content.world.species[unit.speciesId];
  return species.maxHp + species.attack + species.defense + Math.floor(unit.xp / 10);
}
export function teamPower(state: CivilizationHost, unitIds: readonly number[], content: CivilizationContent): number {
  return unitIds.reduce((total, unitId) => total + unitBattlePower(state.units[unitId], content), 0);
}
export function combatantFromUnit(unit: UnitState, id: string, side: BattleCombatant['side'], content: CivilizationContent): BattleCombatant {
  const species = content.world.species[unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur'];
  return {
    id, unitId: unit.id, side, speciesId: unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur',
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: unit.hp, maxHp: species.maxHp, attack: species.attack, defense: species.defense, power: species.power,
  };
}
/** v26 (depth-v26 §2.2): a guardian keeps its species' attack and defence; its HP is 150% (challenge power 620) to 200% (860), linear. */
export function guardianFighter(site: Pick<SanctuarySite, 'id' | 'guardianSpeciesId' | 'challengePower'>, content: Content): RelayFighter {
  const species = content.species[site.guardianSpeciesId], [low, high] = depth26Tuning(content).guardianHpPercent;
  const powers = CIVILIZATION_CONTENT.sanctuaries.definitions.map(definition => definition.challengePower), min = Math.min(...powers), max = Math.max(...powers);
  const percent = low + Math.floor((high - low) * Math.max(0, Math.min(max - min, site.challengePower - min)) / Math.max(1, max - min));
  const hp = Math.max(1, Math.floor(species.maxHp * percent / 100));
  return fighterFromCombatant({ id: `${site.id}-guardian`, unitId: null, side: 'away', speciesId: site.guardianSpeciesId,
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])], hp, maxHp: hp, attack: species.attack, defense: species.defense, power: species.power }, content);
}
/** v26: a civilization's Pokémon as relay fighters in lineup order. */
export function relayFighters(state: CivilizationHost, unitIds: readonly number[], prefix: string, content: Content): RelayFighter[] {
  return unitIds.map((unitId, index) => {
    const unit = state.units[unitId] as UnitState & { kind: 'pokemon' };
    return fighterFromUnit(unit, `${prefix}-${index}`, content, { taughtTypeId: taughtMoveType(state, unitId) });
  });
}
/** The sanctuary guardian as it fights (also read by the battle replay viewer). */
export function guardianCombatant(site: Pick<SanctuarySite, 'id' | 'guardianSpeciesId' | 'challengePower'>, content: CivilizationContent): BattleCombatant {
  const species = content.world.species[site.guardianSpeciesId];
  const scale = Math.max(1, Math.round(site.challengePower / (species.maxHp + species.attack + species.defense)));
  return {
    id: `${site.id}-guardian`, unitId: null, side: 'guardian', speciesId: site.guardianSpeciesId,
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: species.maxHp * scale, maxHp: species.maxHp * scale,
    attack: species.attack * scale, defense: species.defense * scale, power: species.power,
  };
}
function strikeEffectiveness(attacker: BattleCombatant, defender: BattleCombatant): number {
  return dualEffectiveness(attacker.typeIds[0], defender.typeIds, true);
}
function expectedDamage(attacker: BattleCombatant, defender: BattleCombatant): number {
  return Math.max(1, Math.floor(attacker.attack * attacker.power * strikeEffectiveness(attacker, defender) / (defender.defense * 1000)));
}
/** Shared auto-battle (guardians, championship; v24 gym circuit and Elite Four). */
export function simulateBattle(home: BattleCombatant[], away: BattleCombatant[], seed: number, terrain: Parameters<typeof terrainMultiplier>[0]): BattleTrace {
  const rng = createRng(seed || 1);
  const fighters = [...home.map(combatant => ({ ...combatant, side: 'home' as const })), ...away.map(combatant => ({ ...combatant, side: 'away' as const }))];
  const rounds: BattleRound[] = [];
  for (let round = 1; round <= 100; round++) {
    const strikes: BattleStrike[] = [];
    const order = fighters.filter(fighter => fighter.hp > 0)
      .sort((a, b) => b.attack - a.attack || a.id.localeCompare(b.id));
    for (const attacker of order) {
      if (attacker.hp <= 0) continue;
      const opponents = fighters.filter(fighter => fighter.hp > 0 && fighter.side !== attacker.side);
      const defender = opponents.sort((a, b) => expectedDamage(attacker, a) / a.hp - expectedDamage(attacker, b) / b.hp
        || a.id.localeCompare(b.id))[0];
      if (!defender) break;
      const roll = 85 + randomBelow(rng, 16);
      const effectiveness = strikeEffectiveness(attacker, defender);
      const hit = damage(attacker.attack, defender.defense, attacker.power, effectiveness, terrainMultiplier(terrain, terrain), roll);
      defender.hp = Math.max(0, defender.hp - hit);
      strikes.push({ attackerId: attacker.id, defenderId: defender.id, damage: hit, effectiveness, roll, defenderHpAfter: defender.hp });
    }
    rounds.push({ round, strikes });
    const homeAlive = fighters.some(fighter => fighter.side === 'home' && fighter.hp > 0);
    const awayAlive = fighters.some(fighter => fighter.side === 'away' && fighter.hp > 0);
    if (!homeAlive || !awayAlive) break;
  }
  const homeAlive = fighters.filter(fighter => fighter.side === 'home' && fighter.hp > 0);
  const awayAlive = fighters.filter(fighter => fighter.side === 'away' && fighter.hp > 0);
  const homeScore = homeAlive.reduce((total, fighter) => total + fighter.hp / fighter.maxHp, 0);
  const awayScore = awayAlive.reduce((total, fighter) => total + fighter.hp / fighter.maxHp, 0);
  const winnerSide = homeAlive.length && (!awayAlive.length || homeScore > awayScore)
    ? 'home' : awayAlive.length && (!homeAlive.length || awayScore > homeScore)
      ? 'away' : home.reduce((total, fighter) => total + fighter.attack + fighter.defense, 0) >= away.reduce((total, fighter) => total + fighter.attack + fighter.defense, 0)
        ? 'home' : 'away';
  for (const fighter of fighters) {
    const source = fighter.side === 'home' ? home.find(candidate => candidate.id === fighter.id) : away.find(candidate => candidate.id === fighter.id);
    if (source) source.hp = fighter.hp;
  }
  return { seed, rounds: clonePlain(rounds), winnerSide };
}
export function battleRosterFromState(state: CivilizationHost, unitIds: readonly number[], side: BattleCombatant['side'], prefix: string, content: CivilizationContent): BattleCombatant[] {
  return unitIds.map((unitId, index) => combatantFromUnit(state.units[unitId]!, `${prefix}-${index}`, side, content));
}
export function baseRelation(state: CivilizationHost, a: number, b: number) {
  return state.diplomacy.find(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b));
}
export function atPeaceWithAll(state: CivilizationHost, playerId: number): boolean {
  return state.diplomacy
    .filter(pair => pair.a === playerId || pair.b === playerId)
    .every(pair => pair.status === 'peace');
}
export function tabletClaimed(state: CivilizationState, tabletId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.tabletOwners, tabletId);
}
export function emptyRelation(round: number): CivilizationRelation {
  return {
    allianceProposal: null, allianceSinceRound: null, allianceLastProposalRound: null, allianceLastRejectedRound: null,
    betrayalCooldownUntilRound: round, tradeProposal: null, tradeSinceRound: null, tradeLastProposalRound: null,
    tradeLastRejectedRound: null, trust: 0, betrayedBy: [],
  };
}
/** Championship titles needed for the victory (by map size). */
export const titlesNeeded = (state: CivilizationHost) => victoryTargets(state.setup).championshipTitles;

export function checkCivilizationVictory(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const victory = state.expansion?.civilization?.victory;
  if (!victory || state.outcome) return [];
  const outcomeEvents = finishGame(state, victory.kind, [victory.playerId], content.world);
  return [...outcomeEvents, { type: 'CivilizationVictoryAchieved', playerId: victory.playerId, kind: victory.kind, round: victory.round }];
}

/** v24 B (world-v24 §3.2): the Elite Four adds one championship title, judged by the same victory test as a won season. */
export function grantChampionshipTitle(state: CivilizationHost, playerId: number, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const civilizationState = civilization(state);
  if (!civilizationState || civilizationState.victory) return [];
  const championship = civilizationState.championship;
  championship.titlesByPlayer[playerId] = (championship.titlesByPlayer[playerId] ?? 0) + 1;
  if (championship.titlesByPlayer[playerId] >= titlesNeeded(state)) {
    const season = championship.nextSeason - 1;
    championship.victory = { playerId, season, round: state.round };
    civilizationState.victory = { kind: 'championship', playerId, round: state.round, season };
  }
  return checkCivilizationVictory(state, content);
}
