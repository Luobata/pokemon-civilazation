import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/core/game.ts';
import { neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { observe, projectEvents } from '../../src/core/vision.ts';
import { resolveCivilizationRound } from '../../src/core/civilization-systems.ts';
import { planLeaderAction } from '../../src/core/leader-systems.ts';
import { dualEffectiveness, effectiveness } from '../../src/core/combat-math.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { CLASSIC_LEADER_IDS, LEADER_IDS } from '../../src/content/leaders.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { FULL_TYPE_CHART } from '../../src/content/combat.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import { deserializeSave } from '../../src/app/save.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';

const setup: GameSetup = { seed: 77, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' }] };
/** Classic leaders keep the plain expansion setup; newer leaders need gameplay v4. */
const leaderSetup = (leaderId: LeaderId): GameSetup => (CLASSIC_LEADER_IDS as readonly string[]).includes(leaderId) ? setup : { ...setup, eraProgression: 'simple-v1', gameplayVersion: 4 };
function apply(state: GameState, action: Command['action']): GameState {
  const result = step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
  if (!result.ok) throw new Error(`Rejected ${action.type}: ${result.reason}`);
  return result.state;
}
describe('versioned expansion integration', () => {
  it('cancels the original owner engineer bonus through actual capture and full round resolution', () => {
    let state = createGame({ ...setup, players: [...setup.players, { id: 2, controller: 'human', starterId: 'squirtle' }] });
    const cityId = state.players[0].headquartersCityId, city = state.cities[cityId];
    city.queue = [{ id: 77, progress: 0, item: { kind: 'building', defId: 'meetingHall' } }];
    state.expansion!.civilization.players[0].activePhantoms.push('engineer');
    state = apply(state, { type: 'ActivatePhantom', phantomId: 'engineer', cityId });
    expect(state.expansion!.civilization.pendingProductionByCity[cityId]).toEqual({ playerId: 0, amount: 40 });
    state.activePlayerId = 1;
    const attacker = Object.values(state.units).find(unit => unit.ownerId === 1 && unit.kind === 'pokemon' && isMapUnit(unit))!;
    if (!isMapUnit(attacker)) throw new Error('Expected deployed attacker');
    attacker.position = neighbors(state.cities[cityId].position, state.map)[0]; attacker.actionLeft = 1;
    state.cities[cityId].hp = 1;
    state = apply(state, { type: 'DeclareWar', targetPlayerId: 0 });
    state = apply(state, { type: 'Attack', unitId: attacker.id, target: { kind: 'city', id: cityId } });
    expect(state.cities[cityId].ownerId).toBe(1);
    expect(state.expansion!.civilization.pendingProductionByCity[cityId]).toBeUndefined();
    state = apply(state, { type: 'EndTurn' });
    state = apply(state, { type: 'EndTurn' });
    expect(state.round).toBe(2);
    expect(state.cities[cityId].queue[0].progress).toBe(0);
    state = apply(state, { type: 'EndTurn' });
    state = apply(state, { type: 'EndTurn' });
    expect(state.cities[cityId].queue[0].progress).toBeLessThan(40);
  });
  it.each(LEADER_IDS)('prioritizes a legal first %s unique recruit over optional spending', leaderId => {
    const state = createGame({ ...leaderSetup(leaderId), players: [{ ...setup.players[0], leaderId }, setup.players[1]] });
    state.players[0].gold = 100; state.players[0].research.unlockedIds.push('training');
    const action = planLeaderAction(observe(state, 0));
    expect(action?.type).toBe('RecruitLeaderUnit');
    expect(step(state, { actorId: 0, expectedSeq: 0, action: action! }).ok).toBe(true);
  });
  it.each(['Alliance', 'Trade'] as const)('keeps private %s proposal rejection and expiry between participants', protocol => {
    const state = createGame({ ...setup, players: [...setup.players, { id: 2, controller: 'human', starterId: 'squirtle' }] });
    const proposed = step(state, { actorId: 0, expectedSeq: 0, action: { type: protocol === 'Alliance' ? 'ProposeAlliance' : 'ProposeTrade', targetPlayerId: 1 } });
    if (!proposed.ok) throw new Error(proposed.reason);
    expect(projectEvents(state, proposed.state, proposed.events, 2)).toEqual([]);
    const nextTurn = apply(proposed.state, { type: 'EndTurn' });
    const rejected = step(nextTurn, { actorId: 1, expectedSeq: nextTurn.commandSeq,
      action: { type: protocol === 'Alliance' ? 'RespondAlliance' : 'RespondTrade', targetPlayerId: 0, accept: false } });
    if (!rejected.ok) throw new Error(rejected.reason);
    expect(projectEvents(nextTurn, rejected.state, rejected.events, 2)).toEqual([]);
    expect(projectEvents(nextTurn, rejected.state, rejected.events, 0)).toHaveLength(1);
    const expired = structuredClone(proposed.state); expired.round += 5;
    const payloads = resolveCivilizationRound(expired);
    const events = payloads.map((payload, index) => ({ seq: 2, index, payload }));
    const thirdParty = projectEvents(proposed.state, expired, events, 2);
    expect(thirdParty.some(event => event.payload.type === `${protocol}Changed`)).toBe(false);
    expect(projectEvents(proposed.state, expired, events, 0).some(event => event.payload.type === `${protocol}Changed`)).toBe(true);
  });
  it('requires a harvested stone on expansion evolution routes while retaining legacy evolution', () => {
    const legacySetup = { ...setup }; delete legacySetup.expansionVersion;
    for (const config of [setup, legacySetup]) {
      const state = createGame(config);
      const unit = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
      if (unit.kind !== 'pokemon') throw new Error('Expected pokemon');
      unit.speciesId = 'ivysaur'; unit.xp = 999; unit.actionLeft = 1;
      state.players[0].gold = 999; state.players[0].research.unlockedIds.push('training');
      const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'Evolve', unitId: unit.id, intoSpeciesId: 'venusaur' } });
      expect(result.ok).toBe(!config.expansionVersion);
      if (config.expansionVersion) expect(state.expansion!.world.players[0].stoneInventory.leafStone).toBe(0);
    }
  });
  it('preserves legacy state and rejects inconsistent rule versions', () => {
    const legacy = { ...setup }; delete legacy.expansionVersion;
    expect(createGame(legacy).expansion).toBeUndefined();
    expect(createGame(setup).expansion?.version).toBe(1);
    expect(() => createGame({ ...setup, expansionVersion: 2 } as unknown as GameSetup)).toThrow();
    expect(step(createGame(legacy), { actorId: 0, expectedSeq: 0, action: { type: 'UseLeaderAbility' } })).toEqual({ ok: false, reason: 'invalid-command' });
  });
  it('replays every initialized expansion ledger and rejects tampered save state', () => {
    const session = new GameSession(setup);
    expect(session.issue({ type: 'UseLeaderAbility' }).ok).toBe(true);
    expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
    expect(session.submit({ actorId: 1, expectedSeq: 2, action: { type: 'EndTurn' } }).ok).toBe(true);
    const state = session.getState();
    expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(state));
    expect(deserializeSave(session.save()).state).toEqual(state);
    const corrupt = JSON.parse(session.save()); corrupt.state.expansion.leaders.players[0].readyAtRound = 1;
    expect(() => deserializeSave(JSON.stringify(corrupt))).toThrow('重放');
    const view = session.getView(); view.economy.player.gold = 99999;
    expect(session.getView().economy.player.gold).toBe(state.players[0].gold);
  });
  it.each(LEADER_IDS)('executes %s ability once per cooldown and rejects without mutation', leaderId => {
    let state = createGame({ ...leaderSetup(leaderId), players: [{ ...setup.players[0], leaderId }, setup.players[1]] });
    const before = canonicalSerialize(state), gold = state.players[0].gold;
    state = apply(state, { type: 'UseLeaderAbility' });
    // Jasmine's lighthouse refunds 8 gold per city on top of the 20-gold cost.
    expect(state.players[0].gold).toBe(gold - 20 + (leaderId === 'jasmine' ? 8 : 0));
    expect(state.expansion!.leaders.players[0]).toMatchObject({ readyAtRound: 9, activeUntilRound: 2 });
    expect(canonicalSerialize(createGame({ ...leaderSetup(leaderId), players: [{ ...setup.players[0], leaderId }, setup.players[1]] }))).toBe(before);
    const once = canonicalSerialize(state);
    expect(step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'UseLeaderAbility' } }).ok).toBe(false);
    expect(canonicalSerialize(state)).toBe(once);
  });
  it('builds and recruits actual unique content with ownership, cost and lifetime caps', () => {
    let state = createGame(setup); state.players[0].gold = 1000; state.players[0].research.unlockedIds.push('training');
    const cityId = state.players[0].headquartersCityId, oldYield = observe(state, 0).economy.cities[0].yields.research;
    state = apply(state, { type: 'BuildLeaderBuilding', cityId });
    expect(observe(state, 0).economy.cities[0].yields.research).toBe(oldYield + 2);
    expect(state.players[0].gold).toBe(910);
    expect(step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'BuildLeaderBuilding', cityId } }).ok).toBe(false);
    for (let i = 0; i < 3; i++) state = apply(state, { type: 'RecruitLeaderUnit', cityId });
    expect(Object.values(state.units).filter(unit => unit.kind === 'pokemon' && unit.uniqueLeader === 'oak')).toHaveLength(3);
    expect(step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'RecruitLeaderUnit', cityId } }).ok).toBe(false);
  });
  it('validates complete expansion action shapes before transaction execution', () => {
    const state = createGame(setup), before = canonicalSerialize(state);
    for (const value of [{ type: 'UseEvolutionStone', unitId: 1, intoSpeciesId: '__proto__', stoneId: 'moonStone' },
      { type: 'ChallengeGuardian', siteId: 'x', unitIds: [1, 1] }, { type: 'RespondAlliance', targetPlayerId: 1, accept: 'yes' }]) {
      expect(() => parseAuditAction(value)).toThrow();
      expect(step(state, { actorId: 0, expectedSeq: 0, action: value as Command['action'] }).ok).toBe(false);
      expect(canonicalSerialize(state)).toBe(before);
    }
  });
});
describe('full type chart and dual defenses', () => {
  it('supports all 18 types with stacking, cancellation, immunity and one final floor', () => {
    expect(Object.keys(FULL_TYPE_CHART)).toHaveLength(18);
    expect(dualEffectiveness('ice', ['dragon', 'flying'])).toBe(400);
    expect(dualEffectiveness('ice', ['dragon', 'flying'], true)).toBe(484);
    expect(dualEffectiveness('fire', ['grass', 'water'])).toBe(100);
    expect(dualEffectiveness('electric', ['water', 'ground'])).toBe(0);
    expect(dualEffectiveness('dragon', ['fairy', 'dragon'])).toBe(0);
    expect(effectiveness('electric', 'rock')).toBe(100);
  });
  it('keeps actual expanded combat inside the projected preview range', () => {
    let state = createGame(setup);
    const city = state.cities[state.players[0].headquartersCityId], from = city.position;
    state.units = {
      901: createMapUnit({ kind: 'pokemon', speciesId: 'magnemite', uniqueLeader: 'oak' }, 901, 0, { q: from.q, r: from.r }, EXPANSION_CONTENT, 0, 1),
      902: createMapUnit({ kind: 'pokemon', speciesId: 'gyarados' }, 902, null, { q: from.q + 1, r: from.r }, EXPANSION_CONTENT, 0, 1),
    };
    const preview = previewAttack(observe(state, 0), 901, { kind: 'unit', id: 902 });
    expect(preview.ok).toBe(true);
    const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'Attack', unitId: 901, target: { kind: 'unit', id: 902 } } });
    expect(result.ok).toBe(true);
    if (result.ok && preview.ok) {
      const battle = result.events.find(event => event.payload.type === 'BattleResolved')!;
      if (battle.payload.type !== 'BattleResolved') throw new Error('Missing battle');
      expect(battle.payload.damage).toBeGreaterThanOrEqual(preview.damage.min);
      expect(battle.payload.damage).toBeLessThanOrEqual(preview.damage.max);
    }
    state = apply(state, { type: 'Attack', unitId: 901, target: { kind: 'unit', id: 902 } });
    expect(state.commandSeq).toBe(1);
  });
});
