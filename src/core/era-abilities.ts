import { ERA_ABILITIES, ERA_ABILITY_RULES, WEATHERS, isNight } from '../content/era-abilities.ts';
import type { EraAbilityId, WeatherId } from '../content/era-abilities.ts';
import { TYPE_ESSENCE } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import { eraState, gameplayAtLeast } from '../content/eras.ts';
import type { EraProgression } from '../content/eras.ts';
import type { TypeId } from '../content/species.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance } from './hex.ts';
import type { Hex } from './hex.ts';
import { workRadius } from './city.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit, PlayerView } from './model.ts';

/** Gameplay v5 only. Unit statuses are keyed by unit ID and dropped when the unit no longer exists. */
export type WeatherField = { ownerId: number; weather: WeatherId; center: Hex; untilRound: number };
export type EraAbilityPlayer = { weatherReadyAtRound: number; zReadyAtRound: number; dynamaxReadyAtRound: number; megaUnitId: number | null; teraUnitId: number | null };
export type UnitStatus = { mega?: true; zPrimed?: true; dynamaxUntilRound?: number; tera?: TypeId };
export type EraAbilityState = { players: Record<number, EraAbilityPlayer>; fields: WeatherField[]; units: Record<number, UnitStatus> };
export type EraAbilityAction =
  | { type: 'SummonWeather'; cityId: number; weather: WeatherId }
  | { type: 'MegaEvolve'; unitId: number }
  | { type: 'PrimeZMove'; unitId: number }
  | { type: 'Dynamax'; unitId: number }
  | { type: 'Terastallize'; unitId: number; typeId: TypeId };
export type EraAbilityEvent =
  | { type: 'WeatherSummoned'; playerId: number; public: true; weather: WeatherId; center: Hex; untilRound: number }
  | { type: 'EraAbilityUsed'; playerId: number; public: true; ability: Exclude<EraAbilityId, 'dayNight' | 'weather'>; unitId: number; typeId?: TypeId };
/** Visible part: every public weather field, and statuses of units the viewer can see; own ledger. */
export type EraAbilityView = { generation: number; unlocked: EraAbilityId[]; night: boolean; fields: WeatherField[]; units: Record<number, UnitStatus>; own: EraAbilityPlayer };

export const usesEraAbilities = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 5);
const ACTIONS = ['SummonWeather', 'MegaEvolve', 'PrimeZMove', 'Dynamax', 'Terastallize'];
export function isEraAbilityAction(action: { type: unknown }): action is EraAbilityAction { return ACTIONS.includes(action.type as string); }
const blank = (): EraAbilityPlayer => ({ weatherReadyAtRound: 1, zReadyAtRound: 1, dynamaxReadyAtRound: 1, megaUnitId: null, teraUnitId: null });
export function initializeEraAbilities(state: GameState): void {
  if (usesEraAbilities(state)) state.expansion!.eraAbilities = { players: Object.fromEntries(state.turnOrder.map(id => [id, blank()])), fields: [], units: {} };
}
/** Pokémon generation reached by a player (1 = Red/Green/Blue/Yellow). */
export function generationOf(player: { research: { unlockedIds: readonly string[] } }, mode: EraProgression | undefined): number {
  const era = eraState(player, mode);
  return era ? Number(era.current.id.replace('generation-', '')) : 1;
}
export function unlockedAbilities(generation: number): EraAbilityId[] {
  return (Object.keys(ERA_ABILITIES) as EraAbilityId[]).filter(id => ERA_ABILITIES[id].generation <= generation);
}
export const primaryEssence = (identity: UnitIdentity, content: Content): EssenceId | null =>
  identity.kind === 'pokemon' ? TYPE_ESSENCE[content.species[identity.speciesId].typeId] : null;
export function canMega(identity: UnitIdentity, content: Content): boolean {
  if (identity.kind !== 'pokemon') return false;
  const species = content.species[identity.speciesId];
  return species.evolution === null && species.stage >= 2;
}
function stockOf(state: GameState, playerId: number) { return state.expansion!.essences!.stock[playerId]; }
function ownUnit(state: GameState, actorId: number, unitId: number): (MapUnit & { kind: 'pokemon' }) | null {
  const unit = state.units[unitId];
  return unit && unit.ownerId === actorId && isMapUnit(unit) && unit.kind === 'pokemon' ? unit as MapUnit & { kind: 'pokemon' } : null;
}
export function validateEraAbilityAction(state: GameState, actorId: number, action: EraAbilityAction, content: Content): string | null {
  const ledger = state.expansion?.eraAbilities, essences = state.expansion?.essences;
  if (!usesEraAbilities(state) || !ledger || !essences) return 'era-abilities-unavailable';
  const player = state.players[actorId], mine = ledger.players[actorId];
  const unlocked = unlockedAbilities(generationOf(player, state.setup.eraProgression));
  if (action.type === 'SummonWeather') {
    const city = state.cities[action.cityId];
    if (!unlocked.includes('weather') || !Object.hasOwn(WEATHERS, action.weather)) return 'ability-locked';
    if (!city || city.ownerId !== actorId) return 'city-unavailable';
    if (state.round < mine.weatherReadyAtRound) return 'ability-cooldown';
    return stockOf(state, actorId)[WEATHERS[action.weather].essence] >= ERA_ABILITY_RULES.weatherCost ? null : 'essence-short';
  }
  const unit = ownUnit(state, actorId, action.unitId);
  if (!unit) return 'unit-unavailable';
  const essence = primaryEssence(unit, content)!, status = ledger.units[unit.id] ?? {};
  if (action.type === 'MegaEvolve') {
    if (!unlocked.includes('mega') || !canMega(unit, content) || status.mega) return 'ability-locked';
    if (mine.megaUnitId !== null && state.units[mine.megaUnitId]) return 'ability-cooldown';
    return stockOf(state, actorId)[essence] >= ERA_ABILITY_RULES.megaCost ? null : 'essence-short';
  }
  if (action.type === 'PrimeZMove') {
    if (!unlocked.includes('zMove') || status.zPrimed) return 'ability-locked';
    if (state.round < mine.zReadyAtRound) return 'ability-cooldown';
    return stockOf(state, actorId)[essence] >= ERA_ABILITY_RULES.zCost ? null : 'essence-short';
  }
  if (action.type === 'Dynamax') {
    if (!unlocked.includes('dynamax') || (status.dynamaxUntilRound ?? 0) >= state.round) return 'ability-locked';
    if (state.round < mine.dynamaxReadyAtRound) return 'ability-cooldown';
    return stockOf(state, actorId)[essence] >= ERA_ABILITY_RULES.dynamaxCost ? null : 'essence-short';
  }
  if (!unlocked.includes('tera') || !Object.hasOwn(TYPE_ESSENCE, action.typeId) || status.tera) return 'ability-locked';
  if (mine.teraUnitId !== null && state.units[mine.teraUnitId]) return 'ability-cooldown';
  return stockOf(state, actorId)[TYPE_ESSENCE[action.typeId]] >= ERA_ABILITY_RULES.teraCost ? null : 'essence-short';
}
export function applyEraAbilityAction(state: GameState, actorId: number, action: EraAbilityAction, content: Content): EventPayload[] {
  const ledger = state.expansion!.eraAbilities!, mine = ledger.players[actorId], stock = stockOf(state, actorId);
  if (action.type === 'SummonWeather') {
    const city = state.cities[action.cityId];
    stock[WEATHERS[action.weather].essence] -= ERA_ABILITY_RULES.weatherCost;
    mine.weatherReadyAtRound = state.round + ERA_ABILITY_RULES.weatherCooldown;
    const field: WeatherField = { ownerId: actorId, weather: action.weather, center: { ...city.position }, untilRound: state.round + ERA_ABILITY_RULES.weatherRounds - 1 };
    ledger.fields = [...ledger.fields.filter(item => hexDistance(item.center, city.position) > 0), field];
    return [{ type: 'WeatherSummoned', playerId: actorId, public: true, weather: field.weather, center: { ...field.center }, untilRound: field.untilRound }];
  }
  const unit = ownUnit(state, actorId, action.unitId)!, essence = primaryEssence(unit, content)!;
  const status = ledger.units[unit.id] = { ...(ledger.units[unit.id] ?? {}) };
  if (action.type === 'MegaEvolve') { stock[essence] -= ERA_ABILITY_RULES.megaCost; status.mega = true; mine.megaUnitId = unit.id; }
  else if (action.type === 'PrimeZMove') { stock[essence] -= ERA_ABILITY_RULES.zCost; status.zPrimed = true; mine.zReadyAtRound = state.round + ERA_ABILITY_RULES.zCooldown; }
  else if (action.type === 'Dynamax') {
    stock[essence] -= ERA_ABILITY_RULES.dynamaxCost; status.dynamaxUntilRound = state.round + ERA_ABILITY_RULES.dynamaxRounds - 1;
    mine.dynamaxReadyAtRound = state.round + ERA_ABILITY_RULES.dynamaxCooldown;
  } else { stock[TYPE_ESSENCE[action.typeId]] -= ERA_ABILITY_RULES.teraCost; status.tera = action.typeId; mine.teraUnitId = unit.id; }
  const ability = action.type === 'MegaEvolve' ? 'mega' : action.type === 'PrimeZMove' ? 'zMove' : action.type === 'Dynamax' ? 'dynamax' : 'tera';
  return [{ type: 'EraAbilityUsed', playerId: actorId, public: true, ability, unitId: unit.id, ...(action.type === 'Terastallize' ? { typeId: action.typeId } : {}) }];
}

/** Read-only context shared by authority and previews. */
export type EraCombatContext = { enabled: boolean; round: number; fields: readonly WeatherField[]; units: Readonly<Record<number, UnitStatus>> };
export function combatContext(state: GameState): EraCombatContext {
  const ledger = state.expansion?.eraAbilities;
  return { enabled: Boolean(ledger), round: state.round, fields: ledger?.fields ?? [], units: ledger?.units ?? {} };
}
export function viewCombatContext(view: PlayerView): EraCombatContext {
  const era = view.expansion?.eraAbilities;
  return { enabled: Boolean(era), round: view.round, fields: era?.fields ?? [], units: era?.units ?? {} };
}
function typesOf(identity: UnitIdentity, content: Content): TypeId[] {
  if (identity.kind !== 'pokemon') return [];
  const species = content.species[identity.speciesId];
  return [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
}
export function weatherAt(ctx: EraCombatContext, position: Hex): WeatherField | null {
  return [...ctx.fields].filter(field => field.untilRound >= ctx.round && hexDistance(field.center, position) <= ERA_ABILITY_RULES.weatherRadius)
    .sort((a, b) => b.untilRound - a.untilRound || a.ownerId - b.ownerId)[0] ?? null;
}
/** Defensive type override from Terastallization, or null. */
export function teraTypes(ctx: EraCombatContext, unitId: number): TypeId[] | null {
  const tera = ctx.enabled ? ctx.units[unitId]?.tera : undefined;
  return tera ? [tera] : null;
}
/** Attack-side permille for a strike from `attacker` (unit or city target). */
export function eraAttackMultiplier(ctx: EraCombatContext, attacker: MapUnit, content: Content, cityTarget: boolean, counter: boolean): number {
  if (!ctx.enabled || attacker.kind !== 'pokemon') return 1000;
  const types = typesOf(attacker, content), status = ctx.units[attacker.id] ?? {};
  let value = 1000;
  if (isNight(ctx.round) && types.some(type => type === 'dark' || type === 'ghost')) value = value * ERA_ABILITY_RULES.nightAttack / 1000;
  const field = weatherAt(ctx, attacker.position);
  if (field) {
    const weather = WEATHERS[field.weather], attackType = content.species[attacker.speciesId].typeId;
    if (weather.boost.includes(attackType)) value = value * weather.boostPermille / 1000;
    else if (weather.weaken.includes(attackType)) value = value * (2000 - weather.boostPermille) / 1000;
  }
  if (status.mega) value = value * ERA_ABILITY_RULES.megaAttack / 1000;
  if ((status.dynamaxUntilRound ?? 0) >= ctx.round) value = value * (cityTarget ? ERA_ABILITY_RULES.dynamaxCity : ERA_ABILITY_RULES.dynamaxAttack) / 1000;
  if (status.tera && status.tera === content.species[attacker.speciesId].typeId) value = value * ERA_ABILITY_RULES.teraStab / 1000;
  if (status.zPrimed && !counter) value = value * ERA_ABILITY_RULES.zAttack / 1000;
  return Math.floor(value);
}
/** Defense-side permille applied to damage received by `defender`. */
export function eraDefenseMultiplier(ctx: EraCombatContext, defender: MapUnit): number {
  if (!ctx.enabled || defender.kind !== 'pokemon') return 1000;
  const status = ctx.units[defender.id] ?? {};
  let value = 1000;
  if (status.mega) value = value * ERA_ABILITY_RULES.megaDefense / 1000;
  if ((status.dynamaxUntilRound ?? 0) >= ctx.round) value = value * ERA_ABILITY_RULES.dynamaxDefense / 1000;
  return Math.floor(value);
}
/** Consumes a primed Z-Move after the attacker's own strike. */
export function consumeZMove(state: GameState, unitId: number): void {
  const status = state.expansion?.eraAbilities?.units[unitId];
  if (status?.zPrimed) delete status.zPrimed;
}
/** Round settlement: expire fields, drop statuses of gone units, apply friendship XP. */
export function resolveEraAbilityRound(state: GameState): EventPayload[] {
  const ledger = state.expansion?.eraAbilities;
  if (!ledger) return [];
  ledger.fields = ledger.fields.filter(field => field.untilRound > state.round);
  for (const id of Object.keys(ledger.units).map(Number)) if (!state.units[id]) delete ledger.units[id];
  for (const mine of Object.values(ledger.players)) {
    if (mine.megaUnitId !== null && !state.units[mine.megaUnitId]) mine.megaUnitId = null;
    if (mine.teraUnitId !== null && !state.units[mine.teraUnitId]) mine.teraUnitId = null;
  }
  for (const unit of Object.values(state.units).filter(isMapUnit)) {
    if (unit.ownerId === null || unit.kind !== 'pokemon') continue;
    if (generationOf(state.players[unit.ownerId], state.setup.eraProgression) < ERA_ABILITIES.dayNight.generation) continue;
    if (Object.values(state.cities).some(city => city.ownerId === unit.ownerId && hexDistance(city.position, unit.position) <= workRadius(city))) unit.xp += ERA_ABILITY_RULES.friendshipXp;
  }
  return [];
}
export function observeEraAbilities(state: GameState, playerId: number, visible: ReadonlySet<number>, indexOf: (hex: Hex) => number | null): EraAbilityView | undefined {
  const ledger = state.expansion?.eraAbilities;
  if (!ledger) return undefined;
  const generation = generationOf(state.players[playerId], state.setup.eraProgression);
  const units: Record<number, UnitStatus> = {};
  for (const [id, status] of Object.entries(ledger.units)) {
    const unit = state.units[Number(id)];
    if (!unit || !isMapUnit(unit)) continue;
    const index = indexOf(unit.position);
    if (unit.ownerId !== playerId && (index === null || !visible.has(index))) continue;
    const shown: UnitStatus = { ...status };
    if (unit.ownerId !== playerId) delete shown.zPrimed;
    units[Number(id)] = shown;
  }
  return { generation, unlocked: unlockedAbilities(generation), night: isNight(state.round), fields: ledger.fields.map(field => ({ ...field, center: { ...field.center } })), units, own: { ...ledger.players[playerId] } };
}
