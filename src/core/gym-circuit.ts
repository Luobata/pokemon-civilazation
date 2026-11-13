// Gameplay v24 B (docs/design/world-v24.md §3): neutral gym circuit — placement, ChallengeGym / ChallengeEliteFour, badges, view.
// Placement and battles use stableSeed only (never state.rng), so the rest of the world is the same as without the circuit.
import { ELITE_FOUR, GYM_LEADERS, GYM_LEADER_ORDER, GYM_RULES_V24, GYM_TYPES, HOME_GYMS } from '../content/gym-circuit.ts';
import type { GymLeaderId } from '../content/gym-circuit.ts';
import { TYPE_ESSENCE } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import type { Content, StarterId } from '../content/units.ts';
import { regionalSpeciesIds } from '../content/roster.ts';
import { gymTeamPower, world24Tuning } from '../content/world24-tuning.ts';
import { grantChampionshipTitle, simulateBattle, stableSeed } from './civilization-systems.ts';
import type { BattleCombatant, BattleTrace } from './civilization-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { GridSize, Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit, PlayerView, UnitState } from './model.ts';
import { landRule, routeCosts, routeDistances } from './reach.ts';
import type { FeatureMap } from './terrain.ts';
import type { StandRule } from './reach.ts';

export type GymCircuitAction = { type: 'ChallengeGym'; gymId: number; unitIds: number[] } | { type: 'ChallengeEliteFour'; unitIds: number[] };
/** `homeOf`: the civilization this gym was placed for (public); `overseas`: no capital reaches it over land at the start. */
export type GymSite = { id: number; tileIndex: number; position: Hex; leader: GymLeaderId; essence: EssenceId; typeId: TypeId; homeOf?: number; overseas?: true };
/** `badges`: per player, ids of the circuit gyms won (in winning order); `challengedAt`: per player, gym id -> last round. */
export type GymCircuitState = { gyms: GymSite[]; badges: Record<number, number[]>; challengedAt: Record<number, Record<number, number>>;
  eliteFour: Record<number, { lastRound: number; won: boolean }> };
/** Gyms on explored tiles; everyone's badges and Elite Four wins are public; `readyAt` / `eliteFourReadyAt` are the viewer's own cooldowns. */
export type GymCircuitView = { gyms: GymSite[]; badges: Record<number, number[]>; eliteFour: Record<number, { won: boolean }>;
  readyAt: Record<number, number>; eliteFourReadyAt: number };
export type GymCircuitEvent =
  | { type: 'GymChallenged'; public: true; playerId: number; gymId: number; victory: boolean; badges: number; teamPower: number; leaderPower: number; battle: BattleTrace }
  | { type: 'EliteFourChallenged'; public: true; playerId: number; victory: boolean; reached: number; battles: BattleTrace[] };

export const isGymCircuitAction = (action: { type: unknown }): action is GymCircuitAction => action.type === 'ChallengeGym' || action.type === 'ChallengeEliteFour';
const RULES = GYM_RULES_V24;

// ---------- placement (§3.1) ----------

type Capital = { playerId: number; starterId: StarterId; tileIndex: number };
/**
 * Places the circuit: one home gym per civilization 5–8 land travel cost from its capital (a type its starter beats; when no tile
 * qualifies, 5–8 land steps, then the nearest reachable tile), then the missing essences and the dragon gym. The first two of those go
 * across water when the map has such land (islands first); the rest follow the per-continent quota, the continent with the fewest gyms
 * per civilization first. `canStand` is the land passage rule (`landRule`); `content` with a v24 map enables travel costs.
 */
export function placeGyms(input: { map: GridSize & Partial<FeatureMap>; seed: number; capitals: readonly Capital[]; taken: ReadonlySet<number>; canStand: StandRule;
  content?: Content }): GymSite[] {
  const { map, seed, canStand } = input;
  const capitals = [...input.capitals].sort((a, b) => a.playerId - b.playerId);
  const routes = capitals.map(capital => routeDistances(map, capital.tileIndex, canStand));
  // v24 maps: land travel cost (move costs, hills, river crossings); otherwise the step count.
  const travel = input.content && map.tiles && map.features
    ? capitals.map(capital => routeCosts(map as FeatureMap, capital.tileIndex, canStand, input.content!)) : routes;
  const hex = (index: number) => indexToHex(index, map);
  const hash = (index: number, tag: string) => stableSeed(seed, index, tag);
  const chosen: number[] = [];
  const free = (index: number, capitalDistance: number, spacing: number) => canStand(index) && !input.taken.has(index) && !chosen.includes(index)
    && capitals.every(capital => hexDistance(hex(capital.tileIndex), hex(index), map) >= capitalDistance)
    && chosen.every(other => hexDistance(hex(other), hex(index), map) >= spacing);
  const tiles = Array.from({ length: map.width * map.height }, (_, index) => index);
  const pick = (order: (a: number, b: number) => number, accept: (index: number) => boolean): number | undefined => {
    for (const [capitalDistance, spacing] of [[RULES.minCapitalDistance, RULES.minSpacing], [RULES.minCapitalDistance, 3], [RULES.minCapitalDistance, 2], [3, 1]] as const) {
      const found = tiles.filter(index => accept(index) && free(index, capitalDistance, spacing)).sort(order)[0];
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const sites: GymSite[] = [];
  const site = (index: number, leader: GymLeaderId, typeId: TypeId, homeOf?: number): GymSite => ({ id: sites.length + 1, tileIndex: index, position: hex(index), leader,
    essence: leader === 'dragon' ? TYPE_ESSENCE.dragon : leader, typeId, ...(homeOf === undefined ? {} : { homeOf }),
    ...(routes.every(route => !route.has(index)) ? { overseas: true as const } : {}) });
  for (const [seat, capital] of capitals.entries()) {
    const [low, high] = RULES.homeGymDistance;
    const cost = (index: number) => (travel[seat].get(index) ?? Infinity), steps = (index: number) => (routes[seat].get(index) ?? Infinity);
    const index = pick((a, b) => cost(a) - cost(b) || hash(a, 'gym-home') - hash(b, 'gym-home') || a - b, i => cost(i) >= low && cost(i) <= high)
      ?? (travel === routes ? undefined : pick((a, b) => steps(a) - steps(b) || hash(a, 'gym-home') - hash(b, 'gym-home') || a - b, i => steps(i) >= low && steps(i) <= high))
      ?? pick((a, b) => steps(a) - steps(b) || a - b, i => steps(i) >= 3 && steps(i) < Infinity);
    if (index === undefined) continue;
    chosen.push(index);
    const home = HOME_GYMS[capital.starterId];
    sites.push(site(index, home.leader, home.typeId, capital.playerId));
  }
  // Every essence gets a gym (final forms need its badge); the dragon gym fills the eighth slot when one is left.
  const present = new Set(sites.map(gym => gym.leader));
  const missing = GYM_LEADER_ORDER.filter(leader => leader !== 'dragon' && !present.has(leader));
  const slots = Math.max(RULES.gymCount - sites.length, missing.length);
  const leaders = [...missing, 'dragon' as const].slice(0, slots).sort((a, b) => stableSeed(seed, a, 'gym-leader') - stableSeed(seed, b, 'gym-leader') || (a < b ? -1 : 1));
  const reached = (index: number) => routes.filter(route => route.has(index)).length;
  const spread = (index: number) => {
    const distances = capitals.map(capital => hexDistance(hex(capital.tileIndex), hex(index), map));
    return Math.max(...distances) - Math.min(...distances);
  };
  // Continents with civilizations: capitals that reach each other over land share one (keyed by the lowest seat).
  const continentOf = capitals.map((_, seat) => capitals.findIndex((other, j) => j === seat || routes[seat].has(other.tileIndex)));
  const continents = [...new Set(continentOf)];
  const civsOn = (group: number) => continentOf.filter(item => item === group).length;
  const gymsOn = (group: number) => chosen.filter(index => routes[group].has(index)).length;
  for (const [slot, leader] of leaders.entries()) {
    // The first two: across water (no capital reaches them, else not every capital), when the map has such land.
    const overseas = slot < RULES.minOverseas ? pick((a, b) => reached(a) - reached(b) || hash(a, 'gym-sea') - hash(b, 'gym-sea') || a - b, i => reached(i) < capitals.length) : undefined;
    // The rest: per-continent quota (fewest gyms per civilization first), between that continent's capitals.
    const group = continents.length > 1
      ? [...continents].sort((a, b) => gymsOn(a) * civsOn(b) - gymsOn(b) * civsOn(a) || a - b)[0] : undefined;
    const middle = (accept: (index: number) => boolean) => pick((a, b) => spread(a) - spread(b) || hash(a, 'gym-mid') - hash(b, 'gym-mid') || a - b, accept);
    const index = overseas ?? (group === undefined ? undefined : middle(i => routes[group].has(i))) ?? middle(() => true);
    if (index === undefined) continue;
    chosen.push(index);
    // v25 (roster-v25 §2.4): only types with at least one regional species (all types when none has one).
    const content = input.content, regional = content?.regionalDex ? GYM_TYPES[leader].filter(type => regionalSpeciesIds(content)
      .some(id => content.species[id].typeId === type || content.species[id].secondaryTypeId === type)) : [];
    const types = regional.length ? regional : GYM_TYPES[leader];
    sites.push(site(index, leader, types[stableSeed(seed, leader, 'gym-type') % types.length]));
  }
  return sites;
}

/** Places the eight gyms (§3.1) when the content has the circuit; nests, sanctuaries, resources, item balls and the like keep their tiles. */
export function initializeGymCircuit(state: GameState, content: Content, canStand: StandRule = landRule(state.map)): void {
  if (!content.gymCircuit || !state.expansion) return;
  const expansion = state.expansion, world = expansion.world;
  const taken = new Set<number>([...Object.values(state.cities).map(city => hexToIndex(city.position, state.map)!),
    ...Object.values(world.nests).map(site => site.tileIndex), ...Object.values(world.overlords).map(site => site.tileIndex),
    ...Object.values(world.resources).map(site => site.tileIndex), ...Object.keys(expansion.rareBerries?.deposits ?? {}).map(Number),
    ...expansion.civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!),
    ...Object.values(expansion.legends?.sites ?? {}) as number[], ...Object.keys(expansion.opening?.itemBalls ?? {}).map(Number)]);
  const capitals = state.turnOrder.map(playerId => ({ playerId, starterId: state.players[playerId].starterId,
    tileIndex: hexToIndex(state.cities[state.players[playerId].headquartersCityId].position, state.map)! }));
  expansion.gymCircuit = { gyms: placeGyms({ map: state.map, seed: state.setup.seed, capitals, taken, canStand, content }),
    badges: Object.fromEntries(state.turnOrder.map(id => [id, []])), challengedAt: Object.fromEntries(state.turnOrder.map(id => [id, {}])), eliteFour: {} };
}

// ---------- teams (§3.1, §3.2) ----------

/** The leader's team row for a challenger holding `badges` badges (clamped to the table); the power follows the content's v24 tuning. */
export const leaderTeamFor = (badges: number, content?: Content) => {
  const row = RULES.teams[Math.max(0, Math.min(RULES.teams.length - 1, badges))];
  return { members: row.members, stage: row.stage, power: gymTeamPower(content, badges) };
};
/** Species of a type at a stage (primary type first, then secondary, then the nearest stage), sorted by id. */
function speciesPool(typeId: TypeId, stage: number, content: Content): SpeciesId[] {
  // v25: leaders' teams come from the regional Pokédex only (power is scaled to the table, so strength is unchanged).
  const ids = [...regionalSpeciesIds(content)].sort() as SpeciesId[];
  for (const offset of [0, -1, 1, -2, 2]) for (const key of ['typeId', 'secondaryTypeId'] as const) {
    const found = ids.filter(id => content.species[id][key] === typeId && content.species[id].stage === stage + offset);
    if (found.length) return found;
  }
  return ids.filter(id => content.species[id].stage === stage);
}
/** A scripted Pokémon whose maxHp + attack + defense is scaled (integer) to `power`. */
function npc(speciesId: SpeciesId, id: string, power: number, content: Content): BattleCombatant {
  const species = content.species[speciesId], base = species.maxHp + species.attack + species.defense;
  const scale = (stat: number) => Math.max(1, Math.floor(stat * power / base));
  return { id, unitId: null, side: 'away', speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: scale(species.maxHp), maxHp: scale(species.maxHp), attack: scale(species.attack), defense: scale(species.defense), power: species.power };
}
function team(typeIds: readonly TypeId[], stage: number, members: number, power: number, seed: number, tag: string, content: Content): BattleCombatant[] {
  const share = Math.floor(power / members);
  return Array.from({ length: members }, (_, index) => {
    const pool = speciesPool(typeIds[index % typeIds.length], stage, content);
    const speciesId = pool[(stableSeed(seed, tag, 'member') + index) % pool.length];
    return npc(speciesId, `${tag}-${index}`, share + (index === 0 ? power - share * members : 0), content);
  });
}
/** The leader's Pokémon a challenger with `badges` badges faces at this gym (the same team in the preview and the battle). */
export const leaderTeam = (gym: GymSite, badges: number, seed: number, content: Content): BattleCombatant[] => {
  const row = leaderTeamFor(badges, content);
  return team([gym.typeId], row.stage, row.members, row.power, seed, `gym-${gym.id}-${badges}`, content);
};
export const eliteFourTeam = (stage: number, seed: number, content: Content): BattleCombatant[] =>
  team(ELITE_FOUR[stage].typeIds, 3, ELITE_FOUR[stage].members, world24Tuning(content).eliteFourPower[stage] ?? ELITE_FOUR[stage].power, seed, `elite-${stage}`, content);
const challenger = (unit: UnitState, id: string, content: Content): BattleCombatant => {
  const speciesId = unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur', species = content.species[speciesId];
  return { id, unitId: unit.id, side: 'home', speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])],
    hp: unit.hp, maxHp: species.maxHp, attack: species.attack, defense: species.defense, power: species.power };
};
/** Team power as the championship counts it (maxHp + attack + defense + XP / 10). */
export const unitPower = (unit: { kind: string; speciesId?: SpeciesId; xp: number }, content: Content) => {
  if (unit.kind !== 'pokemon' || !unit.speciesId) return 0;
  const species = content.species[unit.speciesId];
  return species.maxHp + species.attack + species.defense + Math.floor(unit.xp / 10);
};

// ---------- commands ----------

type TeamUnit = Pick<MapUnit, 'id' | 'ownerId' | 'kind' | 'actionLeft' | 'position'>;
/** Shared by the authority and the view: is this a 1–3 Pokémon team with actions, all within 2 tiles and one on the gym? */
function teamBlocker(units: readonly (TeamUnit | undefined)[], ids: readonly number[], actorId: number, gym: GymSite, map: GridSize): string | null {
  if (ids.length < 1 || ids.length > RULES.maxTeam || new Set(ids).size !== ids.length) return 'invalid-team';
  const team = ids.map(id => units.find(unit => unit?.id === id));
  if (!team.every(unit => unit && unit.ownerId === actorId && unit.kind === 'pokemon' && unit.actionLeft === 1
    && hexDistance(unit.position, gym.position, map) <= RULES.siteRange)) return 'unit-not-local';
  return team.some(unit => hexDistance(unit!.position, gym.position, map) === 0) ? null : 'unit-not-on-site';
}
function gymBlocker(circuit: { gyms: readonly GymSite[]; badges: Record<number, readonly number[]> }, readyAt: number | undefined, round: number, actorId: number, gymId: number): string | null {
  const gym = circuit.gyms.find(item => item.id === gymId);
  if (!gym) return 'gym-unavailable';
  if ((circuit.badges[actorId] ?? []).includes(gymId)) return 'gym-won';
  return readyAt !== undefined && round < readyAt ? 'gym-cooldown' : null;
}
function eliteBlocker(badges: number, won: boolean, readyAt: number, round: number, ids: readonly number[], units: readonly (TeamUnit | undefined)[], actorId: number): string | null {
  if (badges < RULES.gymCount) return 'elite-locked';
  if (won) return 'elite-won';
  if (round < readyAt) return 'elite-cooldown';
  if (ids.length !== RULES.eliteFour.team || new Set(ids).size !== ids.length) return 'invalid-team';
  return ids.every(id => units.some(unit => unit?.id === id && unit.ownerId === actorId && unit.kind === 'pokemon' && unit.actionLeft === 1)) ? null : 'unit-unavailable';
}
const mapUnits = (state: GameState) => Object.values(state.units).filter(isMapUnit);
const cooldownEnd = (last: number | undefined, rounds: number) => last === undefined ? undefined : last + rounds;

export function validateGymCircuitAction(state: GameState, actorId: number, action: GymCircuitAction, content: Content): string | null {
  const circuit = state.expansion?.gymCircuit;
  if (!circuit || !content.gymCircuit) return 'gyms-unavailable';
  if (action.type === 'ChallengeEliteFour') {
    const record = circuit.eliteFour[actorId];
    return eliteBlocker((circuit.badges[actorId] ?? []).length, record?.won ?? false, cooldownEnd(record?.lastRound, RULES.eliteFour.cooldownRounds) ?? 0,
      state.round, action.unitIds, mapUnits(state), actorId);
  }
  const blocked = gymBlocker(circuit, cooldownEnd(circuit.challengedAt[actorId]?.[action.gymId], RULES.cooldownRounds), state.round, actorId, action.gymId);
  return blocked ?? teamBlocker(mapUnits(state), action.unitIds, actorId, circuit.gyms.find(gym => gym.id === action.gymId)!, state.map);
}

export function applyGymCircuitAction(state: GameState, actorId: number, action: GymCircuitAction, content: Content): EventPayload[] {
  const reason = validateGymCircuitAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const circuit = state.expansion!.gymCircuit!, seed = state.setup.seed;
  const roster = action.unitIds.map((id, index) => challenger(state.units[id]!, `challenger-${actorId}-${index}`, content));
  const settle = () => roster.forEach((combatant, index) => {
    const unit = state.units[action.unitIds[index]!]!;
    unit.hp = Math.max(1, combatant.hp);
    unit.actionLeft = 0;
  });
  const player = state.players[actorId];
  if (action.type === 'ChallengeGym') {
    const gym = circuit.gyms.find(item => item.id === action.gymId)!, held = (circuit.badges[actorId] ??= []).length;
    const leader = leaderTeam(gym, held, seed, content);
    const teamPower = action.unitIds.reduce((sum, id) => sum + unitPower(state.units[id]!, content), 0);
    const battle = simulateBattle(roster, leader, stableSeed(seed, state.round, actorId, gym.id, 'gym'), state.map.tiles[gym.tileIndex]);
    settle();
    (circuit.challengedAt[actorId] ??= {})[gym.id] = state.round;
    const victory = battle.winnerSide === 'home';
    if (victory) {
      circuit.badges[actorId].push(gym.id);
      const count = circuit.badges[actorId].length;
      player.gold += RULES.reward.goldPerBadge * count;
      const stock = state.expansion!.essences?.stock[actorId];
      if (stock) stock[gym.essence] = (stock[gym.essence] ?? 0) + RULES.reward.essence;
      for (const id of action.unitIds) state.units[id]!.xp += RULES.reward.xp;
    }
    return [{ type: 'GymChallenged', public: true, playerId: actorId, gymId: gym.id, victory, badges: circuit.badges[actorId].length,
      teamPower, leaderPower: leaderTeamFor(held, content).power, battle }];
  }
  const battles: BattleTrace[] = [];
  let reached = 0;
  for (let stage = 0; stage < ELITE_FOUR.length; stage++) {
    if (stage > 0) for (const combatant of roster) if (combatant.hp > 0) {
      combatant.hp += Math.floor((combatant.maxHp - combatant.hp) * RULES.eliteFour.healPercentBetween / 100);
    }
    const battle = simulateBattle(roster, eliteFourTeam(stage, seed, content), stableSeed(seed, state.round, actorId, stage, 'elite-four'), 'grassland');
    battles.push(battle);
    if (battle.winnerSide !== 'home') break;
    reached = stage + 1;
  }
  settle();
  const victory = reached === ELITE_FOUR.length;
  circuit.eliteFour[actorId] = { lastRound: state.round, won: victory };
  const events: EventPayload[] = [{ type: 'EliteFourChallenged', public: true, playerId: actorId, victory, reached, battles }];
  if (victory) {
    player.gold += RULES.eliteFour.gold;
    events.push(...grantChampionshipTitle(state, actorId, { ...CIVILIZATION_CONTENT, world: content }));
  }
  return events;
}

// ---------- view (§3.6) ----------

/** Gym sites on explored tiles; badges and Elite Four results are public (§3.6). */
export function observeGymCircuit(state: GameState, playerId: number): GymCircuitView | undefined {
  const circuit = state.expansion?.gymCircuit;
  if (!circuit) return undefined;
  const explored = new Set(state.knowledge[playerId]?.exploredTileIds ?? []);
  const own = circuit.challengedAt[playerId] ?? {};
  return {
    gyms: circuit.gyms.filter(gym => explored.has(gym.tileIndex)).map(gym => JSON.parse(JSON.stringify(gym)) as GymSite),
    badges: Object.fromEntries(Object.entries(circuit.badges).map(([id, list]) => [id, [...list]])),
    eliteFour: Object.fromEntries(Object.entries(circuit.eliteFour).map(([id, record]) => [id, { won: record.won }])),
    readyAt: Object.fromEntries(Object.entries(own).map(([gymId, round]) => [gymId, round + RULES.cooldownRounds])),
    eliteFourReadyAt: cooldownEnd(circuit.eliteFour[playerId]?.lastRound, RULES.eliteFour.cooldownRounds) ?? 0,
  };
}
/** Why the viewer cannot challenge this gym with this team now (null = the authority accepts it). */
export function viewGymBlocker(view: PlayerView, gymId: number, unitIds: readonly number[]): string | null {
  const circuit = view.expansion?.gymCircuit;
  if (!circuit) return 'gyms-unavailable';
  if (view.outcome || view.activePlayerId !== view.playerId) return 'not-your-turn';
  const blocked = gymBlocker(circuit, circuit.readyAt[gymId], view.round, view.playerId, gymId);
  return blocked ?? teamBlocker(view.units, unitIds, view.playerId, circuit.gyms.find(gym => gym.id === gymId)!, view.map);
}
export function viewEliteFourBlocker(view: PlayerView, unitIds: readonly number[]): string | null {
  const circuit = view.expansion?.gymCircuit;
  if (!circuit) return 'gyms-unavailable';
  if (view.outcome || view.activePlayerId !== view.playerId) return 'not-your-turn';
  return eliteBlocker((circuit.badges[view.playerId] ?? []).length, circuit.eliteFour[view.playerId]?.won ?? false, circuit.eliteFourReadyAt, view.round, unitIds, view.units, view.playerId);
}
/** The team the viewer would send: the Pokémon on the gym plus up to two more within 2 tiles, strongest first. */
export function viewGymTeam(view: PlayerView, gymId: number, content: Content): number[] {
  const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === gymId);
  if (!gym) return [];
  const ready = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1
    && hexDistance(unit.position, gym.position, view.map) <= RULES.siteRange);
  const onSite = ready.find(unit => hexDistance(unit.position, gym.position, view.map) === 0);
  if (!onSite) return [];
  const rest = ready.filter(unit => unit.id !== onSite.id).sort((a, b) => unitPower(b, content) * b.hp - unitPower(a, content) * a.hp || a.id - b.id);
  return [onSite.id, ...rest.slice(0, RULES.maxTeam - 1).map(unit => unit.id)];
}
/** The gym standing on a tile (view: only explored gyms). */
export const gymAt = (circuit: { gyms: readonly GymSite[] } | undefined, tileIndex: number) => circuit?.gyms.find(gym => gym.tileIndex === tileIndex);
/** No city may be founded on a gym tile (the gym must stay open to every civilization). */
export const gymBlocksCity = (state: Pick<GameState, 'expansion'>, tileIndex: number) => gymAt(state.expansion?.gymCircuit, tileIndex) !== undefined;
export const viewGymBlocksCity = (view: Pick<PlayerView, 'expansion'>, tileIndex: number) => gymAt(view.expansion?.gymCircuit, tileIndex) !== undefined;
export const gymLeaderName = (gym: Pick<GymSite, 'leader'>) => GYM_LEADERS[gym.leader].name;

type CircuitSource = { gyms: readonly GymSite[]; badges: Record<number, readonly number[]> } | undefined;
const essencesOf = (circuit: CircuitSource, playerId: number): EssenceId[] =>
  circuit ? (circuit.badges[playerId] ?? []).flatMap(gymId => circuit.gyms.filter(gym => gym.id === gymId).map(gym => gym.essence)) : [];
/** Essences of the circuit badges a player holds (v19 final-form gate, §3.1); [] without the circuit. */
export const stateCircuitBadges = (state: { expansion?: { gymCircuit?: GymCircuitState } }, playerId: number): EssenceId[] =>
  essencesOf(state.expansion?.gymCircuit, playerId);
/** A won gym is always explored, so the view's gym list holds every own badge. */
export const viewCircuitBadges = (view: { playerId: number; expansion?: { gymCircuit?: GymCircuitView } }): EssenceId[] =>
  essencesOf(view.expansion?.gymCircuit, view.playerId);
