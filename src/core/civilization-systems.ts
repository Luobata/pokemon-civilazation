import { victoryTargets } from '../content/opening.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { CivilizationContent, OfferingResource, PhantomCategory } from '../content/civilization-systems.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import type { TechId } from '../content/economy.ts';
import { contentFor, techOf } from '../content/units.ts';
import { dualEffectiveness, damage, terrainMultiplier } from './combat-math.ts';
import { createRng, randomBelow } from './rng.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex, offsetToHex } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import type { CityState, EventPayload, GameState, UnitState } from './model.ts';
import { finishGame } from './victory.ts';

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
  unitIds: number[];
  power: number;
  roster: BattleCombatant[];
};
export type ChampionshipMatch = {
  label: 'preliminary-1' | 'preliminary-2' | 'semifinal-1' | 'semifinal-2' | 'final';
  entrantIds: [string, string];
  winnerEntrantId: string;
  scores: [number, number];
  battle: BattleTrace;
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
  | { type: 'OfferingMade'; playerId: number; cityId: number; resource: OfferingResource; points: number }
  | { type: 'PhantomSummoned'; playerId: number; phantomId: string; name: string; cost: number; offeringPointsAfter: number }
  | { type: 'PhantomActivated'; playerId: number; phantomId: string; name: string; cityId?: number; techId?: string; unitIds?: number[]; amount: number }
  | { type: 'PhantomResearchCompleted'; playerId: number; phantomId: string; techId: string }
  | { type: 'SanctuaryEstablished'; playerId: number; siteId: string; goldAfter: number }
  | { type: 'GuardianChallenged'; playerId: number; siteId: string; challengePower: number; teamPower: number; victory: boolean; battle: BattleTrace }
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
};
function sanctuaryView(site: SanctuarySite): CivilizationSanctuaryView {
  return {
    id: site.id, name: site.name, tabletId: site.tabletId, tabletName: site.tabletName,
    guardianName: site.guardianName, guardianSpeciesId: site.guardianSpeciesId,
    challengePower: site.challengePower, position: { ...site.position }, ownerId: site.ownerId,
    guardianDefeated: site.guardianDefeated,
  };
}
export type CivilizationRelationView = CivilizationRelation & {
  targetPlayerId: number;
  atPeace: boolean;
  targetEliminated: boolean;
};
export type CivilizationPlanningPolicy = {
  maximumAllies: number;
  blockedAllianceTargetPlayerIds: readonly number[];
};

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
  };
  relations: CivilizationRelationView[];
  planning: CivilizationPlanningState;
};

type CivilizationHost = GameState;
const RELATION_ACTIONS = ['ProposeAlliance', 'RespondAlliance', 'DissolveAlliance', 'ProposeTrade', 'RespondTrade', 'BetrayAlliance'] as const;
const PHANTOM_IDS = ['scientist', 'engineer', 'merchant', 'general', 'artist'] as const;

function civilization(state: CivilizationHost): CivilizationState | undefined {
  return state.expansion?.civilization;
}
function sortedPlayerIds(state: CivilizationHost): number[] {
  return Object.keys(state.players).map(Number).sort((a, b) => a - b);
}
function relationKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}
function civilizationRelation(state: CivilizationHost, a: number, b: number): CivilizationRelation | undefined {
  return civilization(state)?.relations[relationKey(a, b)];
}
function isPokemon(unit: UnitState | undefined): unit is UnitState & { kind: 'pokemon' } {
  return !!unit && unit.ownerId !== null && unit.kind === 'pokemon';
}
function ownedCity(state: CivilizationHost, actorId: number, cityId: number): CityState | undefined {
  const city = state.cities[cityId];
  return city?.ownerId === actorId ? city : undefined;
}
function unitBattlePower(unit: UnitState, content: CivilizationContent): number {
  if (unit.kind !== 'pokemon') return 0;
  const species = content.world.species[unit.speciesId];
  return species.maxHp + species.attack + species.defense + Math.floor(unit.xp / 10);
}
function teamPower(state: CivilizationHost, unitIds: readonly number[], content: CivilizationContent): number {
  return unitIds.reduce((total, unitId) => total + unitBattlePower(state.units[unitId], content), 0);
}
function combatantFromUnit(unit: UnitState, id: string, side: BattleCombatant['side'], content: CivilizationContent): BattleCombatant {
  const species = content.world.species[unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur'];
  return {
    id, unitId: unit.id, side, speciesId: unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur',
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: unit.hp, maxHp: species.maxHp, attack: species.attack, defense: species.defense, power: species.power,
  };
}
function npcCombatant(speciesId: SpeciesId, index: number, season: number, slot: number, powerTarget: number, content: CivilizationContent): BattleCombatant {
  const species = content.world.species[speciesId], base = species.maxHp + species.attack + species.defense;
  const scale = Math.max(1, Math.round(powerTarget / content.championship.teamSize / base));
  return {
    id: `npc-${season}-${slot}-${index}`, unitId: null, side: 'home', speciesId,
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: species.maxHp * scale, maxHp: species.maxHp * scale,
    attack: species.attack * scale, defense: species.defense * scale, power: species.power,
  };
}
function guardianCombatant(site: SanctuarySite, content: CivilizationContent): BattleCombatant {
  const species = content.world.species[site.guardianSpeciesId];
  const scale = Math.max(1, Math.round(site.challengePower / (species.maxHp + species.attack + species.defense)));
  return {
    id: `${site.id}-guardian`, unitId: null, side: 'guardian', speciesId: site.guardianSpeciesId,
    typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: species.maxHp * scale, maxHp: species.maxHp * scale,
    attack: species.attack * scale, defense: species.defense * scale, power: species.power,
  };
}
export function stableSeed(...parts: (string | number)[]): number {
  let value = 0x811c9dc5;
  for (const part of parts) for (const byte of String(part)) {
    value ^= byte.codePointAt(0)!;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}
function strikeEffectiveness(attacker: BattleCombatant, defender: BattleCombatant): number {
  return dualEffectiveness(attacker.typeIds[0], defender.typeIds, true);
}
function expectedDamage(attacker: BattleCombatant, defender: BattleCombatant): number {
  return Math.max(1, Math.floor(attacker.attack * attacker.power * strikeEffectiveness(attacker, defender) / (defender.defense * 1000)));
}
function simulateBattle(home: BattleCombatant[], away: BattleCombatant[], seed: number, terrain: Parameters<typeof terrainMultiplier>[0]): BattleTrace {
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
  return { seed, rounds: JSON.parse(JSON.stringify(rounds)) as BattleRound[], winnerSide };
}
function battleRosterFromState(state: CivilizationHost, unitIds: readonly number[], side: BattleCombatant['side'], prefix: string, content: CivilizationContent): BattleCombatant[] {
  return unitIds.map((unitId, index) => combatantFromUnit(state.units[unitId]!, `${prefix}-${index}`, side, content));
}
function baseRelation(state: CivilizationHost, a: number, b: number) {
  return state.diplomacy.find(pair => pair.a === Math.min(a, b) && pair.b === Math.max(a, b));
}
function atPeaceWithAll(state: CivilizationHost, playerId: number): boolean {
  return state.diplomacy
    .filter(pair => pair.a === playerId || pair.b === playerId)
    .every(pair => pair.status === 'peace');
}
function tabletClaimed(state: CivilizationState, tabletId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.tabletOwners, tabletId);
}
function phantomCost(player: CivilizationPlayerState, content: CivilizationContent): number {
  return content.phantoms.firstSummonCost + content.phantoms.summonCostStep * player.summonedPhantomIds.length;
}
function choosePhantomName(state: CivilizationHost, playerId: number, category: PhantomCategory, content: CivilizationContent): string {
  const definition = content.phantoms.definitions.find(candidate => candidate.id === category)!;
  const used = new Set(Object.values(state.expansion?.civilization?.players ?? {}).flatMap(player => Object.entries(player.phantomNameLedger))
    .filter(([id]) => id === category).map(([, name]) => name));
  const available = definition.names.filter(name => !used.has(name));
  const pool = available.length ? available : definition.names;
  const offset = stableSeed(state.setup.seed, playerId, category, 'name') % pool.length;
  return pool[offset]!;
}
function emptyRelation(round: number): CivilizationRelation {
  return {
    allianceProposal: null, allianceSinceRound: null, allianceLastProposalRound: null, allianceLastRejectedRound: null,
    betrayalCooldownUntilRound: round, tradeProposal: null, tradeSinceRound: null, tradeLastProposalRound: null,
    tradeLastRejectedRound: null, trust: 0, betrayedBy: [],
  };
}
function selectSanctuarySites(state: CivilizationHost, content: CivilizationContent): SanctuarySite[] {
  const anchors = [
    { col: Math.floor(state.map.width / 4), row: Math.floor(state.map.height / 4) },
    { col: Math.floor((state.map.width * 3) / 4), row: Math.floor(state.map.height / 4) },
    { col: Math.floor(state.map.width / 4), row: Math.floor((state.map.height * 3) / 4) },
    { col: Math.floor((state.map.width * 3) / 4), row: Math.floor((state.map.height * 3) / 4) },
  ].map(offsetToHex);
  const cityIndexes = new Set(Object.values(state.cities)
    .map(city => hexToIndex(city.position, state.map))
    .filter((index): index is number => index !== null));
  const chosen: number[] = [];
  for (const definition of content.sanctuaries.definitions) {
    const anchor = anchors[(content.sanctuaries.definitions.indexOf(definition)) % anchors.length];
    const candidates = state.map.tiles.flatMap((biome, index) => biome === 'ocean' || cityIndexes.has(index) || chosen.includes(index)
      ? [] : [index]).sort((a, b) => {
      const first = indexToHex(a, state.map), second = indexToHex(b, state.map);
      return hexDistance(first, anchor, state.map) - hexDistance(second, anchor, state.map)
        || edgeDistance(second, state.map) - edgeDistance(first, state.map) || a - b;
    });
    const index = candidates[0];
    if (index === undefined) throw new Error(`Map has fewer than four valid sanctuary tiles for ${definition.id}.`);
    chosen.push(index);
  }
  return content.sanctuaries.definitions.map((definition, index) => ({
    ...definition, position: indexToHex(chosen[index], state.map), ownerId: null,
    guardianDefeated: false, challengeRoundByPlayer: {},
  }));
}

export function initializeCivilization(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): CivilizationState {
  if (state.expansion?.civilization) return state.expansion.civilization;
  const created: CivilizationState = {
    version: 1,
    initializedRound: state.round,
    sanctuaries: selectSanctuarySites(state, content),
    players: Object.fromEntries(sortedPlayerIds(state).map(playerId => [playerId, {
      offeringPoints: 0, lifetimeOfferings: 0, offeredThisRoundByCity: {}, nextPhantomCost: content.phantoms.firstSummonCost,
      summonedPhantomIds: [], activePhantoms: [], hallOfFame: [], phantomNameLedger: {},
    }])),
    tabletOwners: {},
    pendingProductionByCity: {},
    championship: {
      nextSeason: 1,
      nextRound: state.round + content.championship.firstSeasonRound - 1,
      intervalRounds: content.championship.intervalRounds,
      registrations: {}, history: [], titlesByPlayer: {}, victory: null,
    },
    relations: Object.fromEntries(state.diplomacy.map(pair => [relationKey(pair.a, pair.b), emptyRelation(state.round)])),
    victory: null,
  };
  if (state.expansion) state.expansion.civilization = created;
  else state.expansion = { version: 1, civilization: created } as NonNullable<GameState['expansion']>;
  return created;
}

export function isCivilizationAction(value: unknown): value is CivilizationAction {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const action = value as Record<string, unknown>;
  const type = action.type;
  if (type === 'MakeOffering') return typeof action.cityId === 'number' && (action.resource === 'food' || action.resource === 'gold');
  if (type === 'SummonPhantom') return PHANTOM_IDS.includes(action.category as PhantomCategory);
  if (type === 'ActivatePhantom') {
    return PHANTOM_IDS.includes(action.phantomId as PhantomCategory)
      && (action.cityId === undefined || typeof action.cityId === 'number')
      && (action.techId === undefined || typeof action.techId === 'string')
      && (action.unitIds === undefined || (Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number')));
  }
  if (type === 'EstablishSanctuary') return typeof action.siteId === 'string' && typeof action.unitId === 'number';
  if (type === 'ChallengeGuardian') return typeof action.siteId === 'string'
    && Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number');
  if (type === 'RegisterChampionshipTeam') return Array.isArray(action.unitIds) && action.unitIds.every(id => typeof id === 'number');
  if (RELATION_ACTIONS.includes(type as (typeof RELATION_ACTIONS)[number])) {
    return typeof action.targetPlayerId === 'number'
      && (action.accept === undefined || typeof action.accept === 'boolean');
  }
  return false;
}

function validatePhantomActivation(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'ActivatePhantom' }>, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const player = civilizationState.players[actorId];
  if (!player?.activePhantoms.includes(action.phantomId)) return 'phantom-unavailable';
  if (action.phantomId === 'scientist') return state.players[actorId].research.techId === null ? 'research-unselected' : null;
  if (action.phantomId === 'engineer' || action.phantomId === 'artist') {
    if (action.cityId === undefined) return 'city-required';
    return ownedCity(state, actorId, action.cityId) ? null : 'city-unavailable';
  }
  if (action.phantomId === 'general') {
    const ids = action.unitIds ?? [];
    if (ids.length < 1 || ids.length > content.phantoms.maximumGeneralUnits) return 'invalid-team';
    if (new Set(ids).size !== ids.length) return 'invalid-team';
    return ids.every(id => isPokemon(state.units[id]) && state.units[id]!.ownerId === actorId) ? null : 'unit-unavailable';
  }
  return null;
}
function validateGuardianChallenge(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: 'ChallengeGuardian' }>, content: CivilizationContent): string | null {
  const civilizationState = civilization(state)!;
  const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId);
  if (!site) return 'site-unavailable';
  if (site.ownerId !== actorId) return 'sanctuary-not-owned';
  if (site.guardianDefeated || tabletClaimed(civilizationState, site.tabletId)) return 'guardian-unavailable';
  if ((site.challengeRoundByPlayer[actorId] ?? -1) >= state.round) return 'challenge-cooldown';
  const ids = action.unitIds;
  if (ids.length < 1 || ids.length > content.sanctuaries.maximumChallengeUnits || new Set(ids).size !== ids.length) return 'invalid-team';
  const siteIndex = hexToIndex(site.position, state.map);
  const local = ids.every(id => {
    const unit = state.units[id];
    return isPokemon(unit) && unit.ownerId === actorId && unit.location === 'map' && unit.actionLeft === 1
      && siteIndex !== null && hexDistance(unit.position, site.position, state.map) <= 2;
  });
  if (!local) return 'unit-not-local';
  return ids.some(id => state.units[id]?.location === 'map' && siteIndex !== null
    && hexToIndex((state.units[id] as Extract<UnitState, { location: 'map' }>).position, state.map) === siteIndex)
    ? null : 'unit-not-on-site';
}
function validateRelationAction(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: (typeof RELATION_ACTIONS)[number] }>, content: CivilizationContent): string | null {
  const targetId = action.targetPlayerId;
  if (targetId === actorId || !state.players[targetId] || state.players[targetId].eliminated) return 'player-unavailable';
  const pair = baseRelation(state, actorId, targetId);
  const relation = civilizationRelation(state, actorId, targetId);
  if (!pair || !relation || pair.status !== 'peace') return 'peace-required';
  if (action.type === 'ProposeAlliance') {
    return !relation.allianceProposal && relation.allianceSinceRound === null
      && state.round >= relation.betrayalCooldownUntilRound
      && state.round > (relation.allianceLastProposalRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds
      && state.round > (relation.allianceLastRejectedRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds ? null : 'proposal-unavailable';
  }
  if (action.type === 'RespondAlliance') {
    return relation.allianceProposal?.proposerId === targetId && action.accept !== undefined && typeof action.accept === 'boolean' ? null : 'proposal-unavailable';
  }
  if (action.type === 'DissolveAlliance' || action.type === 'BetrayAlliance') {
    if (relation.allianceSinceRound === null) return 'alliance-inactive';
    if (action.type === 'BetrayAlliance' && state.players[actorId].gold < content.diplomacy.betrayalGoldCost) return 'insufficient-gold';
    return null;
  }
  if (action.type === 'ProposeTrade') {
    return !relation.tradeProposal && relation.tradeSinceRound === null
      && state.round > (relation.tradeLastProposalRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds
      && state.round > (relation.tradeLastRejectedRound ?? -Infinity) + content.diplomacy.rejectionCooldownRounds ? null : 'proposal-unavailable';
  }
  return relation.tradeProposal?.proposerId === targetId && action.accept !== undefined && typeof action.accept === 'boolean' ? null : 'proposal-unavailable';
}

export function validateCivilizationAction(state: CivilizationHost, actorId: number, action: CivilizationAction, content: CivilizationContent = CIVILIZATION_CONTENT): string | null {
  const civilizationState = civilization(state);
  if (!civilizationState) return 'civilization-uninitialized';
  if (state.outcome || civilizationState.victory) return 'game-ended';
  const player = state.players[actorId];
  if (!player || player.eliminated) return 'player-unavailable';
  const expansionPlayer = civilizationState.players[actorId];
  if (!expansionPlayer) return 'player-unavailable';
  if (action.type === 'MakeOffering') {
    const city = ownedCity(state, actorId, action.cityId);
    if (!city) return 'city-unavailable';
    // Gameplay v9: a type gym or contest hall in this city also acts as a shrine for offerings.
    const shrine = gameplayAtLeast(state.setup, 9) && (state.expansion?.essences?.gyms[action.cityId] !== undefined
      || state.expansion?.contests?.[actorId]?.halls.includes(action.cityId));
    if (!shrine && !civilizationState.sanctuaries.some(site => site.ownerId === actorId)) return 'sanctuary-not-owned';
    if (expansionPlayer.offeredThisRoundByCity[action.cityId]) return 'offering-already-made';
    if (action.resource === 'food') return city.food >= content.offering.foodCost ? null : 'insufficient-food';
    return player.gold >= content.offering.goldCost ? null : 'insufficient-gold';
  }
  if (action.type === 'SummonPhantom') {
    if (!content.phantoms.definitions.some(definition => definition.id === action.category)) return 'phantom-unavailable';
    if (expansionPlayer.summonedPhantomIds.includes(action.category) || expansionPlayer.hallOfFame.includes(action.category)) return 'phantom-already-summoned';
    return expansionPlayer.offeringPoints >= phantomCost(expansionPlayer, content) ? null : 'insufficient-offering';
  }
  if (action.type === 'ActivatePhantom') return validatePhantomActivation(state, actorId, action, content);
  if (action.type === 'EstablishSanctuary') {
    const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId);
    const unit = state.units[action.unitId];
    if (!site) return 'site-unavailable';
    if (site.ownerId !== null) return 'sanctuary-owned';
    if (!unit || unit.ownerId !== actorId || unit.location !== 'map') return 'unit-unavailable';
    if (player.gold < content.sanctuaries.establishmentCost) return 'insufficient-gold';
    const index = hexToIndex(site.position, state.map);
    return index !== null && hexToIndex((unit as Extract<UnitState, { location: 'map' }>).position, state.map) === index ? null : 'unit-not-on-site';
  }
  if (action.type === 'ChallengeGuardian') return validateGuardianChallenge(state, actorId, action, content);
  if (action.type === 'RegisterChampionshipTeam') {
    const ids = action.unitIds;
    if (ids.length !== content.championship.teamSize || new Set(ids).size !== ids.length) return 'invalid-team';
    if (!ids.every(id => isPokemon(state.units[id]) && state.units[id]!.ownerId === actorId)) return 'unit-unavailable';
    if (!atPeaceWithAll(state, actorId)) return 'peace-required';
    const current = civilizationState.championship.registrations[actorId];
    return !current || current.registeredRound < civilizationState.championship.nextRound ? null : 'already-registered';
  }
  return validateRelationAction(state, actorId, action, content);
}

function activateResearchPhantom(state: CivilizationHost, actorId: number, phantomId: string, content: CivilizationContent): CivilizationEvent[] {
  const player = state.players[actorId];
  const techId = player.research.techId!;
  const progress = player.research.progressByTech[techId] + player.research.reserve + content.phantoms.researchBonus;
  // v22: the tree's own costs (the civilization pack's `world` table only knows the 12 older techs).
  const cost = techOf(player.research.tree ? contentFor(state.setup) : content.world, techId).cost;
  player.research.progressByTech[techId] = Math.min(progress, cost);
  const events: CivilizationEvent[] = [{ type: 'PhantomActivated', playerId: actorId, phantomId, name: state.expansion!.civilization.players[actorId].phantomNameLedger[phantomId] ?? phantomId, techId, amount: content.phantoms.researchBonus }];
  if (progress >= cost) {
    if (!player.research.unlockedIds.includes(techId)) player.research.unlockedIds.push(techId);
    player.research.unlockedIds.sort();
    player.research.reserve = progress - cost;
    player.research.techId = null;
    events.push({ type: 'PhantomResearchCompleted', playerId: actorId, phantomId, techId });
  } else player.research.reserve = 0;
  return events;
}
function applyRelationAction(state: CivilizationHost, actorId: number, action: Extract<CivilizationAction, { type: (typeof RELATION_ACTIONS)[number] }>, content: CivilizationContent): CivilizationEvent[] {
  const targetId = action.targetPlayerId;
  const relation = civilizationRelation(state, actorId, targetId)!;
  const playerIds: [number, number] = [Math.min(actorId, targetId), Math.max(actorId, targetId)];
  if (action.type === 'ProposeAlliance') {
    relation.allianceProposal = { proposerId: actorId, proposedRound: state.round };
    relation.allianceLastProposalRound = state.round;
    return [{ type: 'AllianceChanged', public: false, playerIds, status: 'proposed', proposerId: actorId }];
  }
  if (action.type === 'RespondAlliance') {
    if (action.accept) {
      relation.allianceSinceRound = state.round;
      relation.allianceProposal = null;
      return [{ type: 'AllianceChanged', public: true, playerIds, status: 'active', proposerId: targetId }];
    }
    relation.allianceLastRejectedRound = state.round;
    relation.allianceProposal = null;
    return [{ type: 'AllianceChanged', public: false, playerIds, status: 'dissolved', proposerId: targetId }];
  }
  if (action.type === 'DissolveAlliance') {
    relation.allianceSinceRound = null;
    return [{ type: 'AllianceChanged', public: true, playerIds, status: 'dissolved', proposerId: actorId }];
  }
  if (action.type === 'BetrayAlliance') {
    state.players[actorId].gold -= content.diplomacy.betrayalGoldCost;
    relation.allianceSinceRound = null;
    relation.tradeSinceRound = null;
    relation.allianceProposal = null;
    relation.tradeProposal = null;
    relation.trust = content.diplomacy.betrayalTrust;
    relation.betrayalCooldownUntilRound = state.round + content.diplomacy.betrayalCooldownRounds;
    if (!relation.betrayedBy.includes(actorId)) relation.betrayedBy.push(actorId);
    return [{ type: 'AllianceChanged', public: true, playerIds, status: 'betrayed', proposerId: actorId }];
  }
  if (action.type === 'ProposeTrade') {
    relation.tradeProposal = { proposerId: actorId, proposedRound: state.round };
    relation.tradeLastProposalRound = state.round;
    return [{ type: 'TradeChanged', public: false, playerIds, status: 'proposed', proposerId: actorId }];
  }
  if (action.type === 'RespondTrade') {
    if (action.accept) {
      relation.tradeSinceRound = state.round;
      relation.tradeProposal = null;
      return [{ type: 'TradeChanged', public: true, playerIds, status: 'active', proposerId: targetId }];
    }
    relation.tradeLastRejectedRound = state.round;
    relation.tradeProposal = null;
    return [{ type: 'TradeChanged', public: false, playerIds, status: 'ended', proposerId: targetId }];
  }
  return [];
}

export function applyCivilizationAction(state: CivilizationHost, actorId: number, action: CivilizationAction, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const reason = validateCivilizationAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const civilizationState = civilization(state)!;
  const player = civilizationState.players[actorId];
  const events: EventPayload[] = [];
  if (action.type === 'MakeOffering') {
    const city = state.cities[action.cityId]!;
    if (action.resource === 'food') city.food -= content.offering.foodCost;
    else state.players[actorId].gold -= content.offering.goldCost;
    player.offeringPoints += content.offering.points;
    player.lifetimeOfferings += content.offering.points;
    player.offeredThisRoundByCity[action.cityId] = action.resource;
    events.push({ type: 'OfferingMade', playerId: actorId, cityId: action.cityId, resource: action.resource, points: content.offering.points });
  } else if (action.type === 'SummonPhantom') {
    const cost = phantomCost(player, content);
    const phantomName = choosePhantomName(state, actorId, action.category, content);
    player.offeringPoints -= cost;
    player.nextPhantomCost = phantomCost({ ...player, summonedPhantomIds: [...player.summonedPhantomIds, action.category] }, content);
    player.summonedPhantomIds.push(action.category);
    player.phantomNameLedger[action.category] = phantomName;
    player.activePhantoms.push(action.category);
    events.push({ type: 'PhantomSummoned', playerId: actorId, phantomId: action.category, name: phantomName, cost, offeringPointsAfter: player.offeringPoints });
  } else if (action.type === 'ActivatePhantom') {
    if (action.phantomId === 'scientist') events.push(...activateResearchPhantom(state, actorId, action.phantomId, content));
    else if (action.phantomId === 'engineer') {
      const previous = civilizationState.pendingProductionByCity[action.cityId!];
      civilizationState.pendingProductionByCity[action.cityId!] = { playerId: actorId,
        amount: (previous?.playerId === actorId ? previous.amount : 0) + content.phantoms.productionBonus };
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, cityId: action.cityId, amount: content.phantoms.productionBonus });
    } else if (action.phantomId === 'merchant') {
      state.players[actorId].gold += content.phantoms.goldBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, amount: content.phantoms.goldBonus });
    } else if (action.phantomId === 'general') {
      for (const unitId of action.unitIds ?? []) state.units[unitId]!.xp += content.phantoms.experienceBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, unitIds: action.unitIds, amount: content.phantoms.experienceBonus });
    } else {
      state.cities[action.cityId!]!.food += content.phantoms.foodBonus;
      events.push({ type: 'PhantomActivated', playerId: actorId, phantomId: action.phantomId, name: player.phantomNameLedger[action.phantomId] ?? action.phantomId, cityId: action.cityId, amount: content.phantoms.foodBonus });
    }
    player.activePhantoms = player.activePhantoms.filter(id => id !== action.phantomId);
    player.hallOfFame.push(action.phantomId);
    player.hallOfFame.sort();
  } else if (action.type === 'EstablishSanctuary') {
    const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId)!;
    state.players[actorId].gold -= content.sanctuaries.establishmentCost;
    site.ownerId = actorId;
    events.push({ type: 'SanctuaryEstablished', playerId: actorId, siteId: site.id, goldAfter: state.players[actorId].gold });
  } else if (action.type === 'ChallengeGuardian') {
    const site = civilizationState.sanctuaries.find(candidate => candidate.id === action.siteId)!;
    const power = teamPower(state, action.unitIds, content);
    const roster = battleRosterFromState(state, action.unitIds, 'challenger', `challenge-${actorId}-${site.id}`, content)
      .map(combatant => ({ ...combatant, side: 'challenger' as const }));
    const guardian = guardianCombatant(site, content);
    const terrain = state.map.tiles[hexToIndex(site.position, state.map)!];
    const battle = simulateBattle(roster, [{ ...guardian, side: 'away' as const }], stableSeed(state.setup.seed, state.round, actorId, site.id, 'guardian'), terrain);
    for (const unitId of action.unitIds) state.units[unitId]!.actionLeft = 0;
    for (const [index, combatant] of roster.entries()) {
      const unit = state.units[action.unitIds[index]!]!;
      unit.hp = Math.max(1, combatant.hp);
    }
    site.challengeRoundByPlayer[actorId] = state.round;
    const victory = battle.winnerSide === 'home';
    if (victory) {
      site.guardianDefeated = true;
      civilizationState.tabletOwners[site.tabletId] = actorId;
      if (content.sanctuaries.definitions.every(definition => civilizationState.tabletOwners[definition.tabletId] === actorId)) {
        civilizationState.victory = { kind: 'origin', playerId: actorId, round: state.round,
          tablets: content.sanctuaries.definitions.map(definition => definition.tabletId) };
      }
    }
    events.push({ type: 'GuardianChallenged', playerId: actorId, siteId: site.id, challengePower: site.challengePower, teamPower: power, victory, battle });
  } else if (action.type === 'RegisterChampionshipTeam') {
    civilizationState.championship.registrations[actorId] = {
      unitIds: [...action.unitIds], registeredRound: state.round, power: teamPower(state, action.unitIds, content),
    };
    events.push({ type: 'ChampionshipTeamRegistered', playerId: actorId, unitIds: action.unitIds,
      power: civilizationState.championship.registrations[actorId]!.power, season: civilizationState.championship.nextSeason });
  } else events.push(...applyRelationAction(state, actorId, action, content));
  events.push(...checkCivilizationVictory(state, content));
  return events;
}

export function consumeCivilizationProduction(state: CivilizationHost, cityId: number): number {
  const civilizationState = civilization(state);
  if (!civilizationState) return 0;
  const pending = civilizationState.pendingProductionByCity[cityId];
  if (!pending) return 0;
  const city = state.cities[cityId];
  if (!city || city.ownerId !== pending.playerId || state.players[pending.playerId]?.eliminated) {
    delete civilizationState.pendingProductionByCity[cityId];
    return 0;
  }
  if (city.capturedAtRound === state.round) return 0;
  const order = city.queue[0];
  if (!order) return 0;
  order.progress += pending.amount;
  delete civilizationState.pendingProductionByCity[cityId];
  return pending.amount;
}
function championshipMatch(label: ChampionshipMatch['label'], first: ChampionshipEntrant, second: ChampionshipEntrant, state: CivilizationHost): ChampionshipMatch {
  const battle = simulateBattle(first.roster, second.roster,
    stableSeed(state.setup.seed, state.round, label, first.entrantId, second.entrantId, 'championship'), 'grassland');
  const winner = battle.winnerSide === 'home' ? first : second;
  const firstScore = first.roster.reduce((total, combatant) => total + combatant.hp, 0);
  const secondScore = second.roster.reduce((total, combatant) => total + combatant.hp, 0);
  return { label, entrantIds: [first.entrantId, second.entrantId], winnerEntrantId: winner.entrantId, scores: [firstScore, secondScore], battle };
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
  const speciesIds = Object.keys(content.world.species).sort() as SpeciesId[];
  const npcTargetPower = content.championship.npcBasePower + championship.nextSeason * content.championship.npcSeasonPower;
  for (let npcIndex = 1; entrants.length < content.championship.entrantCount; npcIndex++) {
    const slot = entrants.length + 1;
    const roster = Array.from({ length: content.championship.teamSize }, (_, memberIndex) => npcCombatant(
      speciesIds[(stableSeed(state.setup.seed, championship.nextSeason, slot, 'npc') + memberIndex) % speciesIds.length]!,
      memberIndex, championship.nextSeason, slot,
      npcTargetPower + slot * content.championship.npcSlotPower, content,
    ));
    const power = roster.reduce((total, combatant) => total + combatant.maxHp + combatant.attack + combatant.defense, 0);
    entrants.push({ entrantId: `npc-${championship.nextSeason}-${slot}`, playerId: null, unitIds: [], power, roster });
  }
  entrants.length = content.championship.entrantCount;
  const seeds = [...entrants].sort((a, b) => b.power - a.power || a.entrantId.localeCompare(b.entrantId));
  const preliminary1 = championshipMatch('preliminary-1', seeds[2]!, seeds[5]!, state);
  const preliminary2 = championshipMatch('preliminary-2', seeds[3]!, seeds[4]!, state);
  const winner1 = seeds.find(entrant => entrant.entrantId === preliminary1.winnerEntrantId)!;
  const winner2 = seeds.find(entrant => entrant.entrantId === preliminary2.winnerEntrantId)!;
  const semifinal1 = championshipMatch('semifinal-1', seeds[0]!, winner2, state);
  const semifinal2 = championshipMatch('semifinal-2', seeds[1]!, winner1, state);
  const finalist1 = seeds.find(entrant => entrant.entrantId === semifinal1.winnerEntrantId)!;
  const finalist2 = seeds.find(entrant => entrant.entrantId === semifinal2.winnerEntrantId)!;
  const final = championshipMatch('final', finalist1, finalist2, state);
  const champion = entrants.find(entrant => entrant.entrantId === final.winnerEntrantId)!;
  const season: ChampionshipSeason = {
    season: championship.nextSeason, round: state.round, entrants: JSON.parse(JSON.stringify(entrants)) as ChampionshipEntrant[],
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
    if (championship.titlesByPlayer[champion.playerId] >= ((state.setup?.gameplayVersion ?? 0) >= 21 ? victoryTargets(state.setup).championshipTitles : content.championship.titlesNeededForVictory)) {
      championship.victory = { playerId: champion.playerId, season: season.season, round: state.round };
      civilizationState.victory = { kind: 'championship', playerId: champion.playerId, round: state.round, season: season.season };
    }
  }
  championship.registrations = {};
  championship.nextSeason++;
  championship.nextRound += championship.intervalRounds;
  events.push({ type: 'ChampionshipResolved', public: true, playerId: champion.playerId, season: JSON.parse(JSON.stringify(season)) as ChampionshipSeason });
}

export function resolveCivilizationRound(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const civilizationState = civilization(state);
  if (!civilizationState || civilizationState.victory || state.outcome) return [];
  const events: EventPayload[] = [];
  for (const city of Object.values(state.cities).sort((a, b) => a.id - b.id)) {
    const amount = consumeCivilizationProduction(state, city.id);
    if (amount && city.ownerId !== null) events.push({ type: 'CivilizationProductionConsumed', playerId: city.ownerId, cityId: city.id, amount });
  }
  for (const player of Object.values(civilizationState.players)) player.offeredThisRoundByCity = {};
  for (const [key, relation] of Object.entries(civilizationState.relations)) {
    const [a, b] = key.split(':').map(Number);
    const publicIds: [number, number] = [a, b];
    if (baseRelation(state, a, b)?.status === 'war') {
      if (relation.allianceSinceRound !== null || relation.allianceProposal || relation.tradeSinceRound !== null || relation.tradeProposal) {
        const publicChange = relation.allianceSinceRound !== null || relation.tradeSinceRound !== null;
        relation.allianceSinceRound = null; relation.allianceProposal = null;
        relation.tradeSinceRound = null; relation.tradeProposal = null;
        events.push({ type: 'AllianceChanged', public: publicChange, playerIds: publicIds, status: 'dissolved' });
      }
      continue;
    }
    if (relation.allianceProposal && state.round - relation.allianceProposal.proposedRound >= content.diplomacy.proposalExpiryRounds) {
      relation.allianceLastProposalRound = relation.allianceProposal.proposedRound;
      relation.allianceProposal = null;
      events.push({ type: 'AllianceChanged', public: false, playerIds: publicIds, status: 'dissolved' });
    }
    if (relation.tradeProposal && state.round - relation.tradeProposal.proposedRound >= content.diplomacy.proposalExpiryRounds) {
      relation.tradeLastProposalRound = relation.tradeProposal.proposedRound;
      relation.tradeProposal = null;
      events.push({ type: 'TradeChanged', public: false, playerIds: publicIds, status: 'expired' });
    }
    if (relation.tradeSinceRound !== null && state.round - relation.tradeSinceRound >= content.diplomacy.tradeIntervalRounds
      && (state.round - relation.tradeSinceRound) % content.diplomacy.tradeIntervalRounds === 0) {
      const tradeA = content.diplomacy.tradeIncome * (state.players[a].leaderId === 'jasmine' ? 2 : 1);
      const tradeB = content.diplomacy.tradeIncome * (state.players[b].leaderId === 'jasmine' ? 2 : 1);
      state.players[a].gold += tradeA;
      state.players[b].gold += tradeB;
      relation.trust = Math.min(content.diplomacy.maximumTrust, relation.trust + content.diplomacy.trustStep);
      events.push({ type: 'TradeSettled', playerId: a, targetPlayerId: b, gold: tradeA, trust: relation.trust });
      events.push({ type: 'TradeSettled', playerId: b, targetPlayerId: a, gold: tradeB, trust: relation.trust });
    }
  }
  if (state.round >= civilizationState.championship.nextRound) resolveChampionship(state, content, events);
  events.push(...checkCivilizationVictory(state, content));
  return events;
}

export function checkCivilizationVictory(state: CivilizationHost, content: CivilizationContent = CIVILIZATION_CONTENT): EventPayload[] {
  const victory = state.expansion?.civilization?.victory;
  if (!victory || state.outcome) return [];
  const outcomeEvents = finishGame(state, victory.kind, [victory.playerId], content.world);
  return [...outcomeEvents, { type: 'CivilizationVictoryAchieved', playerId: victory.playerId, kind: victory.kind, round: victory.round }];
}

export function observeCivilization(state: CivilizationHost, playerId: number, visibleTileIds: Set<number>, content: CivilizationContent = CIVILIZATION_CONTENT): CivilizationView {
  const civilizationState = civilization(state);
  if (!civilizationState) throw new Error('civilization-uninitialized');
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const visible = (position: Hex) => visibleTileIds.has(hexToIndex(position, state.map)!);
  const defaultPlayer: CivilizationPlayerState = {
    offeringPoints: 0, lifetimeOfferings: 0, offeredThisRoundByCity: {}, nextPhantomCost: content.phantoms.firstSummonCost,
    summonedPhantomIds: [], activePhantoms: [], hallOfFame: [], phantomNameLedger: {},
  };
  const ownedUnits = Object.values(state.units).filter(unit => unit.ownerId === playerId).sort((a, b) => a.id - b.id);
  const visibleSanctuaries = civilizationState.sanctuaries.filter(site => visible(site.position));
  return {
    version: 1,
    playerId,
    round: state.round,
    victory: clone(civilizationState.victory),
    sanctuaries: clone(visibleSanctuaries.map(sanctuaryView)),
    tabletOwners: clone(Object.fromEntries(visibleSanctuaries
      .filter(site => tabletClaimed(civilizationState, site.tabletId))
      .map(site => [site.tabletId, civilizationState.tabletOwners[site.tabletId]]))),
    player: clone(civilizationState.players[playerId] ?? defaultPlayer),
    championship: {
      nextSeason: civilizationState.championship.nextSeason,
      nextRound: civilizationState.championship.nextRound,
      intervalRounds: civilizationState.championship.intervalRounds,
      registration: clone(civilizationState.championship.registrations[playerId] ?? null),
      history: clone(civilizationState.championship.history),
      titlesByPlayer: clone(civilizationState.championship.titlesByPlayer),
      victory: clone(civilizationState.championship.victory),
      registrationCount: Object.keys(civilizationState.championship.registrations).length,
    },
    relations: Object.entries(civilizationState.relations)
      .filter(([key]) => key.split(':').map(Number).includes(playerId))
      .map(([key, relation]) => {
        const otherId = key.split(':').map(Number).find(id => id !== playerId)!;
        return {
          ...clone(relation),
          targetPlayerId: otherId,
          atPeace: baseRelation(state, playerId, otherId)?.status === 'peace',
          targetEliminated: state.players[otherId]?.eliminated ?? true,
        };
      }).sort((a, b) => a.targetPlayerId - b.targetPlayerId),
    planning: {
      playerId,
      gold: state.players[playerId]?.gold ?? 0,
      activeResearchTechId: state.players[playerId]?.research.techId ?? null,
      atPeaceWithAll: atPeaceWithAll(state, playerId),
      canOffer: civilizationState.sanctuaries.some(site => site.ownerId === playerId),
      cities: Object.values(state.cities).filter(city => city.ownerId === playerId).sort((a, b) => a.id - b.id)
        .map(city => ({ id: city.id, food: city.food, hasProduction: city.queue.length > 0 })),
      units: ownedUnits.filter(unit => unit.kind === 'pokemon').map(unit => ({
        id: unit.id,
        speciesId: unit.speciesId,
        position: unit.location === 'map' ? clone(unit.position) : null,
        actionLeft: unit.actionLeft,
        power: unitBattlePower(unit, content),
      })),
    },
  };
}

export function planCivilizationAction(view: CivilizationView, content: CivilizationContent = CIVILIZATION_CONTENT,
  policy?: CivilizationPlanningPolicy, map: MapShape = { width: 0 }): CivilizationAction | null {
  const own = view.planning;
  const freeSanctuary = view.sanctuaries.find(site => site.ownerId === null);
  if (freeSanctuary) {
    const establisher = own.units
      .filter(unit => unit.position !== null && unit.position.q === freeSanctuary.position.q && unit.position.r === freeSanctuary.position.r)
      .sort((a, b) => a.id - b.id)[0];
    if (establisher && own.gold >= content.sanctuaries.establishmentCost) {
      return { type: 'EstablishSanctuary', siteId: freeSanctuary.id, unitId: establisher.id };
    }
  }

  const summoned = new Set([...view.player.summonedPhantomIds, ...view.player.hallOfFame]);
  const allPhantomsSummoned = content.phantoms.definitions.every(definition => summoned.has(definition.id));
  const offeringCity = own.cities.find(city => city.food >= content.offering.foodCost
      && view.player.offeredThisRoundByCity[city.id] === undefined)
    ?? own.cities.find(city => own.gold >= content.offering.goldCost + 100
      && view.player.offeredThisRoundByCity[city.id] === undefined);
  if (own.canOffer && !allPhantomsSummoned && offeringCity) {
    return {
      type: 'MakeOffering',
      cityId: offeringCity.id,
      resource: offeringCity.food >= content.offering.foodCost ? 'food' : 'gold',
    };
  }

  const category = content.phantoms.definitions.map(definition => definition.id).find(id => !summoned.has(id));
  if (category && view.player.offeringPoints >= content.phantoms.firstSummonCost
    + content.phantoms.summonCostStep * view.player.summonedPhantomIds.length) return { type: 'SummonPhantom', category };
  const active = view.player.activePhantoms[0];
  if (active === 'scientist' && own.activeResearchTechId !== null) return { type: 'ActivatePhantom', phantomId: active };
  if (active === 'engineer') {
    const city = own.cities.find(candidate => candidate.hasProduction);
    if (city) return { type: 'ActivatePhantom', phantomId: active, cityId: city.id };
  }
  if (active === 'merchant') return { type: 'ActivatePhantom', phantomId: active };
  if (active === 'general') {
    const units = own.units.slice(0, content.phantoms.maximumGeneralUnits);
    if (units.length) return { type: 'ActivatePhantom', phantomId: active, unitIds: units.map(unit => unit.id) };
  }
  if (active === 'artist') {
    const city = own.cities[0];
    if (city) return { type: 'ActivatePhantom', phantomId: active, cityId: city.id };
  }

  const relationEligible = (relation: CivilizationRelationView) => relation.atPeace && !relation.targetEliminated;
  const proposalRoundAvailable = (round: number | null) =>
    view.round > (round === null ? -Infinity : round + content.diplomacy.rejectionCooldownRounds);
  const activeAlliances = view.relations.filter(relation => !relation.targetEliminated && relation.allianceSinceRound !== null);
  if (policy && policy.maximumAllies === 0 && view.relations.filter(relation => !relation.targetEliminated).length === 1) {
    const lastAlliance = activeAlliances[0];
    if (lastAlliance) return { type: 'DissolveAlliance', targetPlayerId: lastAlliance.targetPlayerId };
  }
  const allianceResponse = view.relations.find(relation => relationEligible(relation)
    && relation.allianceProposal?.proposerId === relation.targetPlayerId);
  if (allianceResponse) {
    const policyRejects = policy !== undefined
      && (activeAlliances.length >= policy.maximumAllies
        || policy.blockedAllianceTargetPlayerIds.includes(allianceResponse.targetPlayerId));
    return { type: 'RespondAlliance', targetPlayerId: allianceResponse.targetPlayerId, accept: !policyRejects };
  }
  const tradeResponse = view.relations.find(relation => relationEligible(relation)
    && relation.tradeProposal?.proposerId === relation.targetPlayerId);
  if (tradeResponse) return { type: 'RespondTrade', targetPlayerId: tradeResponse.targetPlayerId, accept: true };

  const site = view.sanctuaries.find(candidate => candidate.ownerId === own.playerId && !candidate.guardianDefeated);
  if (site) {
    const eligible = own.units.filter(unit => unit.actionLeft === 1 && unit.position !== null
        && hexDistance(unit.position, site.position, map) <= 2).sort((a, b) => b.power - a.power || a.id - b.id);
    const atSite = eligible.find(unit => unit.position!.q === site.position.q && unit.position!.r === site.position.r);
    if (atSite) {
      const team = [atSite, ...eligible.filter(unit => unit.id !== atSite.id)]
        .slice(0, content.sanctuaries.maximumChallengeUnits);
      if (team.reduce((total, unit) => total + unit.power, 0) >= site.challengePower) {
        return { type: 'ChallengeGuardian', siteId: site.id, unitIds: team.map(unit => unit.id) };
      }
    }
  }

  const pokemon = own.units.filter(unit => unit.power > 0);
  if (own.atPeaceWithAll && view.championship.nextRound - view.round <= 5
    && pokemon.length >= content.championship.teamSize && !view.championship.registration) {
    return { type: 'RegisterChampionshipTeam', unitIds: pokemon.slice(0, content.championship.teamSize).map(unit => unit.id) };
  }

  const allianceTarget = view.relations.find(relation => relationEligible(relation)
    && relation.allianceSinceRound === null
    && relation.allianceProposal === null
    && proposalRoundAvailable(relation.allianceLastProposalRound)
    && proposalRoundAvailable(relation.allianceLastRejectedRound)
    && view.round >= relation.betrayalCooldownUntilRound
    && relation.trust >= 0
    && (policy === undefined
      || (activeAlliances.length < policy.maximumAllies
        && !policy.blockedAllianceTargetPlayerIds.includes(relation.targetPlayerId))));
  if (allianceTarget) return { type: 'ProposeAlliance', targetPlayerId: allianceTarget.targetPlayerId };
  const tradeTarget = view.relations.find(relation => relationEligible(relation)
    && relation.tradeSinceRound === null
    && relation.tradeProposal === null
    && proposalRoundAvailable(relation.tradeLastProposalRound)
    && proposalRoundAvailable(relation.tradeLastRejectedRound)
    && relation.trust >= -10);
  if (tradeTarget) return { type: 'ProposeTrade', targetPlayerId: tradeTarget.targetPlayerId };
  return null;
}
