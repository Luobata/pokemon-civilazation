// depth-v26 §2.5 (presentation only): replays of the auto-battles the authority has already resolved — gym, sanctuary
// guardian, Elite Four and league conference. The battle traces (`BattleTrace`: rounds of strikes with damage,
// matchup and HP after) come from the events and the season history; the line-ups are rebuilt from public rules
// (leader / Elite Four / guardian teams) and, for the viewer's own challenges, from a snapshot of the team taken when the
// command was issued. Every HP step is checked against the trace: a replay that does not add up is not offered. Pure
// (no DOM): the viewer is battle-viewer.ts.
import type { BattleCombatant, BattleTrace, ChampionshipMatch, ChampionshipSeason } from '../core/civilization-systems.ts';
import { guardianCombatant } from '../core/civilization-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { eliteFourTeam, leaderTeam } from '../core/gym-circuit.ts';
import { ELITE_FOUR, GYM_LEADERS, GYM_RULES_V24 } from '../content/gym-circuit.ts';
import { ESSENCES } from '../content/essences.ts';
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { SpeciesId, TypeId } from '../content/species.ts';
import type { Command, MapUnit, PlayerView, VisibleEvent } from '../core/model.ts';

/** The arena drawn behind a battle: the gym tile's biome, the league stadium, or the sanctuary altar. */
export type ArenaId = BiomeId | 'league' | 'altar';
export type ReplaySide = 'home' | 'away';
export type ReplayFighter = { id: string; speciesId: SpeciesId; typeIds: readonly TypeId[]; side: ReplaySide; hp: number; maxHp: number; ranged: boolean };
/** One strike as the trace recorded it, with the defender's HP before (rebuilt) and after (recorded). */
export type ReplayStrike = { round: number; attackerId: string; defenderId: string; damage: number; effectiveness: number; hpBefore: number; hpAfter: number;
  /** The attack's type: the attacker's primary type (the auto-battle's matchup rule). */
  typeId: TypeId; fainted: boolean };
export type ReplayBattle = { title: string; arena: ArenaId; homeName: string; awayName: string; home: ReplayFighter[]; away: ReplayFighter[];
  strikes: ReplayStrike[]; rounds: number; winner: ReplaySide;
  /** Elite Four: the share of lost HP the challengers recovered before this battle (percent). */
  healed?: number };
export type BattleKind = 'gym' | 'guardian' | 'elite' | 'league';
export type BattleReplay = { key: string; kind: BattleKind; title: string; battles: ReplayBattle[]; victory: boolean; outcome: string };

type Starter = { id: string; speciesId: SpeciesId; typeIds: readonly TypeId[]; hp: number; maxHp: number };
export type EffectTone = 'super' | 'weak' | 'none' | 'normal';
/** The matchup of a recorded multiplier (percent; ×2.2 with type research, ×0.5, ×0). */
export const effectTone = (effectiveness: number): EffectTone => effectiveness === 0 ? 'none' : effectiveness > 100 ? 'super' : effectiveness < 100 ? 'weak' : 'normal';
export const EFFECT_TEXT: Record<EffectTone, string> = { super: '效果拔群！', weak: '效果不太好……', none: '好像没有效果……', normal: '' };
/** "×2.2" from a percent multiplier. */
export const multiplierText = (effectiveness: number) => `×${(effectiveness / 100).toFixed(2).replace(/\.?0+$/, '')}`;

const fighter = (starter: Starter, side: ReplaySide, content: Content): ReplayFighter => {
  const role = content.species[starter.speciesId]?.role;
  return { id: starter.id, speciesId: starter.speciesId, typeIds: [...starter.typeIds], side, hp: starter.hp, maxHp: starter.maxHp, ranged: role === 'ranged' || role === 'siege' };
};
const starterOf = (combatant: BattleCombatant, hp = combatant.hp): Starter =>
  ({ id: combatant.id, speciesId: combatant.speciesId, typeIds: combatant.typeIds, hp, maxHp: combatant.maxHp });

/** Walks a trace from known starting HP; null when any strike names an unknown fighter or its HP does not add up. */
export function replayBattle(home: readonly Starter[], away: readonly Starter[], trace: BattleTrace, info: Pick<ReplayBattle, 'title' | 'arena' | 'homeName' | 'awayName' | 'healed'>,
  content: Content): ReplayBattle | null {
  const fighters = [...home.map(item => fighter(item, 'home', content)), ...away.map(item => fighter(item, 'away', content))];
  const hp = new Map(fighters.map(item => [item.id, item.hp]));
  const byId = new Map(fighters.map(item => [item.id, item]));
  const strikes: ReplayStrike[] = [];
  for (const round of trace.rounds) for (const strike of round.strikes) {
    const attacker = byId.get(strike.attackerId), before = hp.get(strike.defenderId);
    if (!attacker || before === undefined || Math.max(0, before - strike.damage) !== strike.defenderHpAfter) return null;
    hp.set(strike.defenderId, strike.defenderHpAfter);
    strikes.push({ round: round.round, attackerId: strike.attackerId, defenderId: strike.defenderId, damage: strike.damage, effectiveness: strike.effectiveness,
      hpBefore: before, hpAfter: strike.defenderHpAfter, typeId: attacker.typeIds[0]!, fainted: strike.defenderHpAfter === 0 });
  }
  const winner: ReplaySide = trace.winnerSide === 'home' || trace.winnerSide === 'challenger' ? 'home' : 'away';
  return { ...info, home: fighters.filter(item => item.side === 'home'), away: fighters.filter(item => item.side === 'away'),
    strikes, rounds: trace.rounds.length, winner };
}
/** HP of every fighter after the battle (for the next Elite Four stage). */
export function finalHp(battle: ReplayBattle): Map<string, number> {
  const hp = new Map([...battle.home, ...battle.away].map(item => [item.id, item.hp]));
  for (const strike of battle.strikes) hp.set(strike.defenderId, strike.hpAfter);
  return hp;
}

// ---------- the viewer's own challenges (snapshot when the command is issued) ----------

export type ChallengeAction = Extract<Command['action'], { type: 'ChallengeGym' | 'ChallengeGuardian' | 'ChallengeEliteFour' }>;
export const isChallengeAction = (action: Command['action']): action is ChallengeAction =>
  action.type === 'ChallengeGym' || action.type === 'ChallengeGuardian' || action.type === 'ChallengeEliteFour';
/** The team the viewer sends, as the authority builds it (id prefix, current HP, the species' max HP). */
export type ChallengeSnapshot = { action: ChallengeAction; playerId: number; team: { unitId: number; speciesId: SpeciesId; typeIds: TypeId[]; hp: number; maxHp: number }[] };
export function snapshotChallenge(view: PlayerView, action: ChallengeAction): ChallengeSnapshot | null {
  const content = contentForView(view);
  const team = action.unitIds.map(id => view.units.find((unit): unit is Extract<MapUnit, { kind: 'pokemon' }> => unit.id === id && unit.kind === 'pokemon'));
  if (!team.every(Boolean)) return null;
  return { action, playerId: view.playerId, team: team.map(unit => {
    const species = content.species[unit!.speciesId];
    return { unitId: unit!.id, speciesId: unit!.speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])], hp: unit!.hp, maxHp: species.maxHp };
  }) };
}
type ChallengePayload = Extract<VisibleEvent['payload'], { type: 'GymChallenged' | 'GuardianChallenged' | 'EliteFourChallenged' }>;
export const isChallengeEvent = (payload: VisibleEvent['payload']): payload is ChallengePayload =>
  payload.type === 'GymChallenged' || payload.type === 'GuardianChallenged' || payload.type === 'EliteFourChallenged';
/** A stable key for a challenge result (also the toast's target). */
export function replayKey(payload: ChallengePayload): string {
  if (payload.type === 'GymChallenged') return `gym:${payload.playerId}:${payload.gymId}:${payload.battle.seed}`;
  if (payload.type === 'GuardianChallenged') return `guardian:${payload.playerId}:${payload.siteId}:${payload.battle.seed}`;
  return `elite:${payload.playerId}:${payload.battles[0]?.seed ?? 0}`;
}
const OWN = '你的队伍';
/** Builds the replay of the viewer's own challenge from the snapshot taken when it was issued (null when they do not match). */
export function challengeReplay(view: PlayerView, snapshot: ChallengeSnapshot, payload: ChallengePayload): BattleReplay | null {
  const content = contentForView(view), me = snapshot.playerId;
  if (payload.playerId !== me || snapshot.action.type !== ({ GymChallenged: 'ChallengeGym', GuardianChallenged: 'ChallengeGuardian', EliteFourChallenged: 'ChallengeEliteFour' } as const)[payload.type]) return null;
  const starters = (prefix: string, hp?: Map<string, number>) => snapshot.team.map((member, index) => {
    const id = `${prefix}-${index}`;
    return { id, speciesId: member.speciesId, typeIds: member.typeIds, hp: hp?.get(id) ?? member.hp, maxHp: member.maxHp };
  });
  const key = replayKey(payload);
  if (payload.type === 'GymChallenged') {
    const gym = view.expansion?.gymCircuit?.gyms.find(item => item.id === payload.gymId);
    if (!gym) return null;
    const held = payload.victory ? payload.badges - 1 : payload.badges, leader = GYM_LEADERS[gym.leader].name;
    const battle = replayBattle(starters(`challenger-${me}`), leaderTeam(gym, held, view.seed, content).map(item => starterOf(item)), payload.battle,
      { title: `道馆挑战 · ${leader}`, arena: view.map.tiles[gym.tileIndex] ?? 'grassland', homeName: OWN, awayName: `馆主${leader}` }, content);
    return battle && { key, kind: 'gym', title: `${leader}的${ESSENCES[gym.essence].name}道馆`, battles: [battle], victory: payload.victory,
      outcome: payload.victory ? `赢得${ESSENCES[gym.essence].name}徽章（第 ${payload.badges} 枚）` : '挑战失败：宝可梦恢复后 3 轮可再挑战' };
  }
  if (payload.type === 'GuardianChallenged') {
    const site = view.expansion?.civilization?.sanctuaries.find(item => item.id === payload.siteId);
    if (!site) return null;
    const guardian = guardianCombatant(site, { ...CIVILIZATION_CONTENT, world: content });
    const battle = replayBattle(starters(`challenge-${me}-${site.id}`), [starterOf(guardian)], payload.battle,
      { title: `圣所守卫 · ${site.guardianName}`, arena: 'altar', homeName: OWN, awayName: `守卫${site.guardianName}` }, content);
    return battle && { key, kind: 'guardian', title: `${site.name} · 守卫${site.guardianName}`, battles: [battle], victory: payload.victory,
      outcome: payload.victory ? `获得石板「${site.tabletName}」` : '守卫依然屹立' };
  }
  const battles: ReplayBattle[] = [];
  let hp: Map<string, number> | undefined;
  for (const [stage, trace] of payload.battles.entries()) {
    const heal = GYM_RULES_V24.eliteFour.healPercentBetween;
    const home = starters(`challenger-${me}`, hp).map(item => stage > 0 && item.hp > 0 ? { ...item, hp: item.hp + Math.floor((item.maxHp - item.hp) * heal / 100) } : item);
    const member = ELITE_FOUR[stage]!;
    const battle = replayBattle(home, eliteFourTeam(stage, view.seed, content).map(item => starterOf(item)), trace,
      { title: `第 ${stage + 1} 场 · ${member.title}${member.name}`, arena: 'league', homeName: OWN, awayName: `${member.title}${member.name}`, ...(stage > 0 ? { healed: heal } : {}) }, content);
    if (!battle) return null;
    battles.push(battle); hp = finalHp(battle);
  }
  return { key, kind: 'elite', title: '四天王与冠军', battles, victory: payload.victory,
    outcome: payload.victory ? '战胜四天王与冠军！冠军赛头衔 +1' : `止步第 ${payload.reached + 1} 场` };
}

// ---------- league conference (public season history) ----------

export const LEAGUE_MATCH_NAMES: Record<ChampionshipMatch['label'], string> = {
  'preliminary-1': '预选赛 1', 'preliminary-2': '预选赛 2', 'semifinal-1': '半决赛 1', 'semifinal-2': '半决赛 2', final: '决赛',
};
/**
 * One match of a season. The season keeps each roster's HP after the whole season and damage carries over between
 * matches, so a Pokémon's HP before a match is read off its next recorded hit (HP after + damage); one knocked out by
 * that hit started at most at that damage (shown as min(max HP, damage)); one never hit again kept its final HP.
 */
export function leagueMatchReplay(view: PlayerView, season: ChampionshipSeason, label: ChampionshipMatch['label'], names: (entrant: ChampionshipSeason['entrants'][number]) => string): BattleReplay | null {
  const content = contentForView(view), index = season.matches.findIndex(match => match.label === label), match = season.matches[index];
  if (!match) return null;
  const [first, second] = match.entrantIds.map(id => season.entrants.find(entrant => entrant.entrantId === id));
  if (!first || !second) return null;
  const startHp = (combatant: BattleCombatant) => {
    for (const later of season.matches.slice(index)) for (const round of later.battle.rounds) for (const strike of round.strikes) {
      if (strike.defenderId !== combatant.id) continue;
      return strike.defenderHpAfter > 0 ? strike.defenderHpAfter + strike.damage : Math.min(combatant.maxHp, strike.damage);
    }
    return combatant.hp;
  };
  const battle = replayBattle(first.roster.map(item => starterOf(item, startHp(item))), second.roster.map(item => starterOf(item, startHp(item))), match.battle,
    { title: `第 ${season.season} 届联盟大会 · ${LEAGUE_MATCH_NAMES[label]}`, arena: 'league', homeName: names(first), awayName: names(second) }, content);
  const winner = match.winnerEntrantId === first.entrantId ? first : second;
  return battle && { key: `league:${season.season}:${label}`, kind: 'league', title: `${LEAGUE_MATCH_NAMES[label]} · ${names(first)} 对 ${names(second)}`, battles: [battle],
    victory: winner.playerId === view.playerId, outcome: `${names(winner)}胜出${label === 'final' ? '，夺得冠军' : ''}` };
}

// ---------- the client's store (recent own replays) ----------

const LIMIT = 12;
const store = new Map<string, BattleReplay>();
let pending: ChallengeSnapshot | null = null;
/** Called by the client right before it issues a challenge command. */
export function rememberChallenge(view: PlayerView, action: Command['action']): void {
  if (isChallengeAction(action)) pending = snapshotChallenge(view, action);
}
/** Called when a challenge result is presented: keeps the replay of the viewer's own challenge (returns its key, or null). */
export function recordChallengeResult(view: PlayerView, payload: VisibleEvent['payload']): string | null {
  if (!isChallengeEvent(payload) || payload.playerId !== view.playerId || !pending) return null;
  const replay = challengeReplay(view, pending, payload);
  pending = null;
  if (!replay) return null;
  store.delete(replay.key); store.set(replay.key, replay);
  while (store.size > LIMIT) store.delete(store.keys().next().value!);
  return replay.key;
}
export const storedReplay = (key: string) => store.get(key) ?? null;
export function clearReplays(): void { store.clear(); pending = null; }
