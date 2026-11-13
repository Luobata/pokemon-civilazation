// Gameplay v26 P1 (docs/design/depth-v26.md §2.1, option 1A): singles relay battles. Each side sends its lineup in order; the faster class
// strikes first; every strike uses the attacker's best type against the current opponent; one automatic, public switch per side. The
// same integer damage formula as the map and the v24 auto-battle. The authority draws one seed per battle from `state.rng` (option 2A);
// previews and the AI only ever run fixed estimate seeds, so neither foresees a result. Pure: no state, no content lookups at fight time.
import type { SpeciesDefinition, SpeciesId, TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { depth26Tuning } from '../content/depth-v26.ts';
import type { BiomeId } from '../content/rules.ts';
import { stableSeed } from '../content/stable-seed.ts';
import { damage, dualEffectiveness, terrainMultiplier } from './combat-math.ts';
import { createRng, randomBelow } from './rng.ts';
import type { RngState } from './rng.ts';
import type { BattleCombatant } from './civilization-systems.ts';

export type RelaySide = 'home' | 'away';
/** One Pokémon in a relay. `typeIds`: the species' types, then a taught TM type (§5.1); `veteran` (历练) is added to attack and defence. */
export type RelayFighter = {
  id: string; unitId: number | null; speciesId: SpeciesId; typeIds: TypeId[];
  hp: number; maxHp: number; attack: number; defense: number; power: number;
  speed: number; veteran: number;
};
export type RelayAct =
  | { kind: 'send' | 'switch' | 'faint'; side: RelaySide; id: string }
  | { kind: 'strike'; side: RelaySide; attackerId: string; defenderId: string; typeId: TypeId; effectiveness: number; damage: number; roll: number; hpAfter: number };
/** §2.6 replay record (the v24 `BattleTrace` stays as it was; viewers branch on `format`). */
export type BattleTraceV26 = { seed: number; format: 'relay'; lineups: { home: string[]; away: string[] }; turns: { turn: number; acts: RelayAct[] }[];
  winnerSide: RelaySide };

export const RELAY_RULES = {
  maxTurns: 60,
  /** Switch when the opponent hits the active Pokémon at ≥ ×2 and it hits back at ≤ ×1, into a bench member taking ≤ ×0.5. */
  switchWhenTaking: 200, switchWhenDealing: 100, switchIntoTaking: 50,
  /** Estimates: wins out of this many fixed seeds, rounded to 5%. */
  estimateSeeds: 16,
} as const;
/** §2.1 speed tiers: fast 4 · scout / air 3 · ranged 2 · melee / naval 1 · siege 0. */
export const SPEED_TIERS: Record<SpeciesDefinition['role'], number> = { fast: 4, scout: 3, air: 3, ranged: 2, melee: 1, naval: 1, siege: 0 };

/** The attacker's best type against this defender (the earlier type wins ties) and its multiplier (×100, type research ×2.2 as in v24). */
export function bestAttack(attacker: Pick<RelayFighter, 'typeIds'>, defender: Pick<RelayFighter, 'typeIds'>): { typeId: TypeId; effectiveness: number } {
  let best = { typeId: attacker.typeIds[0], effectiveness: -1 };
  for (const typeId of attacker.typeIds) {
    const effectiveness = dualEffectiveness(typeId, defender.typeIds.slice(0, 2), true);
    if (effectiveness > best.effectiveness) best = { typeId, effectiveness };
  }
  return best;
}

const clone = (team: readonly RelayFighter[]) => team.map(fighter => ({ ...fighter, typeIds: [...fighter.typeIds] }));
const firstAlive = (team: readonly RelayFighter[]) => team.find(fighter => fighter.hp > 0);
const healthScore = (team: readonly RelayFighter[]) => team.reduce((sum, fighter) => sum + Math.floor(fighter.hp * 1000 / Math.max(1, fighter.maxHp)), 0);

/**
 * One relay battle (§2.1). `home` is the challenger (it moves first on a full tie). The fighters' `hp` is written back like the v24
 * auto-battle; everything else is left as passed. 60 turns at most, then the larger sum of remaining HP shares wins (ties: the larger
 * attack + defence total, then home).
 */
export function resolveTeamBattle(home: RelayFighter[], away: RelayFighter[], seed: number, terrain: BiomeId): BattleTraceV26 {
  const rng: RngState = createRng((seed >>> 0) || 1), sides = { home: clone(home), away: clone(away) };
  const active: Record<RelaySide, RelayFighter | undefined> = { home: firstAlive(sides.home), away: firstAlive(sides.away) };
  const switched: Record<RelaySide, boolean> = { home: false, away: false };
  const other = (side: RelaySide): RelaySide => side === 'home' ? 'away' : 'home';
  const ground = terrainMultiplier(terrain, terrain);
  const turns: BattleTraceV26['turns'] = [{ turn: 0, acts: (['home', 'away'] as const).flatMap(side => active[side] ? [{ kind: 'send' as const, side, id: active[side]!.id }] : []) }];
  for (let turn = 1; turn <= RELAY_RULES.maxTurns && active.home && active.away; turn++) {
    const acts: RelayAct[] = [], resting = new Set<RelaySide>();
    for (const side of ['home', 'away'] as const) {
      const me = active[side]!, foe = active[other(side)]!;
      if (switched[side] || bestAttack(foe, me).effectiveness < RELAY_RULES.switchWhenTaking || bestAttack(me, foe).effectiveness > RELAY_RULES.switchWhenDealing) continue;
      const bench = sides[side].find(fighter => fighter !== me && fighter.hp > 0 && bestAttack(foe, fighter).effectiveness <= RELAY_RULES.switchIntoTaking);
      if (!bench) continue;
      active[side] = bench; switched[side] = true; resting.add(side);
      acts.push({ kind: 'switch', side, id: bench.id });
    }
    const h = active.home!, a = active.away!;
    const homeFirst = h.speed !== a.speed ? h.speed > a.speed : h.attack + h.veteran >= a.attack + a.veteran;
    const strikers = { home: h, away: a };
    for (const side of homeFirst ? ['home', 'away'] as const : ['away', 'home'] as const) {
      const me = strikers[side], foe = active[other(side)];
      if (resting.has(side) || me.hp <= 0 || active[side] !== me || !foe) continue;
      const { typeId, effectiveness } = bestAttack(me, foe), roll = 85 + randomBelow(rng, 16);
      const hit = damage(me.attack + me.veteran, Math.max(1, foe.defense + foe.veteran), me.power, effectiveness, ground, roll);
      foe.hp = Math.max(0, foe.hp - hit);
      acts.push({ kind: 'strike', side, attackerId: me.id, defenderId: foe.id, typeId, effectiveness, damage: hit, roll, hpAfter: foe.hp });
      if (foe.hp > 0) continue;
      acts.push({ kind: 'faint', side: other(side), id: foe.id });
      active[other(side)] = firstAlive(sides[other(side)]);
      if (active[other(side)]) acts.push({ kind: 'send', side: other(side), id: active[other(side)]!.id });
    }
    turns.push({ turn, acts });
  }
  const homeAlive = Boolean(firstAlive(sides.home)), awayAlive = Boolean(firstAlive(sides.away));
  const strength = (team: readonly RelayFighter[]) => team.reduce((sum, fighter) => sum + fighter.attack + fighter.defense, 0);
  const winnerSide: RelaySide = homeAlive !== awayAlive ? (homeAlive ? 'home' : 'away')
    : healthScore(sides.home) !== healthScore(sides.away) ? (healthScore(sides.home) > healthScore(sides.away) ? 'home' : 'away')
      : strength(sides.home) >= strength(sides.away) ? 'home' : 'away';
  for (const [index, fighter] of home.entries()) fighter.hp = sides.home[index].hp;
  for (const [index, fighter] of away.entries()) fighter.hp = sides.away[index].hp;
  return { seed, format: 'relay', lineups: { home: home.map(fighter => fighter.id), away: away.map(fighter => fighter.id) }, turns, winnerSide };
}

/** Battles that heal half the lost HP in between (Elite Four, conference: §2.1 写回). Mutates `team`. */
export function healBetween(team: RelayFighter[], percent = 50): void {
  for (const fighter of team) if (fighter.hp > 0) fighter.hp += Math.floor((fighter.maxHp - fighter.hp) * percent / 100);
}
/** The authority's battle seed (§2.1 option 2A): one 31-bit draw from the game RNG per battle. */
export const battleSeed = (rng: RngState) => randomBelow(rng, 2 ** 31);
/** A fixed estimate seed (never the authority's). */
export const estimateSeed = (tag: string, trial: number) => stableSeed(tag, trial);
/**
 * Estimated win percent of `home` (§2.1): wins over `seeds` fixed estimate seeds, rounded to 5%. `run` plays one battle (or a run of
 * battles, e.g. the Elite Four) on fresh copies and returns whether home won. The inputs are never changed.
 */
export function estimateWins(run: (seed: number) => boolean, seeds: number = RELAY_RULES.estimateSeeds, tag = 'team-estimate'): number {
  let wins = 0;
  for (let trial = 0; trial < seeds; trial++) if (run(estimateSeed(tag, trial))) wins++;
  return Math.round(wins * 20 / seeds) * 5;
}
export function estimateTeamBattle(home: readonly RelayFighter[], away: readonly RelayFighter[], terrain: BiomeId, seeds: number = RELAY_RULES.estimateSeeds): number {
  return estimateWins(seed => resolveTeamBattle(clone(home), clone(away), seed, terrain).winnerSide === 'home', seeds);
}
/** Elite Four style run: the same lineup through every team, healing in between; true when every battle is won. */
export function runGauntlet(home: RelayFighter[], teams: readonly (readonly RelayFighter[])[], seeds: readonly number[], terrain: BiomeId, healPercent = 50):
  { traces: BattleTraceV26[]; reached: number } {
  const traces: BattleTraceV26[] = [];
  let reached = 0;
  for (const [stage, team] of teams.entries()) {
    if (stage > 0) healBetween(home, healPercent);
    const trace = resolveTeamBattle(home, clone(team), seeds[stage] ?? 0, terrain);
    traces.push(trace);
    if (trace.winnerSide !== 'home') break;
    reached = stage + 1;
  }
  return { traces, reached };
}

// ---------- fighters ----------

const typesOf = (species: SpeciesDefinition) => [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
/** 历练 (§2.1): +1 attack / defence per `veteranXp` XP, at most `veteranCap`; 0 before v26. */
export const veteranBonus = (xp: number, content: Content) => content.teamBattles ? Math.min(depth26Tuning(content).veteranCap, Math.floor(Math.max(0, xp) / depth26Tuning(content).veteranXp)) : 0;
/** A player's Pokémon (current HP, its XP as 历练, an optional TM type and a strength bonus such as 劲敌气势 for rivals). */
export function fighterFromUnit(unit: { id: number; speciesId: SpeciesId; hp: number; xp: number }, id: string, content: Content,
  extra: { taughtTypeId?: TypeId; spirit?: number } = {}): RelayFighter {
  const species = content.species[unit.speciesId], types = typesOf(species), spirit = extra.spirit ?? 0;
  return { id, unitId: unit.id, speciesId: unit.speciesId, typeIds: extra.taughtTypeId && !types.includes(extra.taughtTypeId) ? [...types, extra.taughtTypeId] : types,
    hp: unit.hp, maxHp: species.maxHp, attack: Math.max(1, species.attack + spirit), defense: Math.max(1, species.defense + spirit), power: species.power,
    speed: SPEED_TIERS[species.role], veteran: veteranBonus(unit.xp, content) };
}
/** A scripted combatant (gym leader, Elite Four, NPC, guardian) as a relay fighter (no 历练). */
export function fighterFromCombatant(combatant: BattleCombatant, content: Content): RelayFighter {
  return { id: combatant.id, unitId: combatant.unitId, speciesId: combatant.speciesId, typeIds: [...combatant.typeIds], hp: combatant.hp, maxHp: combatant.maxHp,
    attack: combatant.attack, defense: combatant.defense, power: combatant.power, speed: SPEED_TIERS[content.species[combatant.speciesId]?.role ?? 'melee'], veteran: 0 };
}
/** Every strike of a trace in order (either format): who hit whom for how much. */
export function traceStrikes(trace: { rounds?: { strikes: { attackerId: string; defenderId: string; damage: number }[] }[]; turns?: { acts: RelayAct[] }[] }):
  { attackerId: string; defenderId: string; damage: number }[] {
  if (trace.turns) return trace.turns.flatMap(turn => turn.acts.flatMap(act => act.kind === 'strike' ? [{ attackerId: act.attackerId, defenderId: act.defenderId, damage: act.damage }] : []));
  return (trace.rounds ?? []).flatMap(round => round.strikes.map(strike => ({ attackerId: strike.attackerId, defenderId: strike.defenderId, damage: strike.damage })));
}
/** Number of turns a trace lasted (either format). */
export const traceTurns = (trace: { rounds?: unknown[]; turns?: unknown[] }) => trace.turns ? Math.max(0, trace.turns.length - 1) : trace.rounds?.length ?? 0;
