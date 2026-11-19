// Gameplay v27 ⑤ (docs/design/pace-v27.md §6): Max raids — shields, phases, the den Dynamax, roles, support, contribution, catch chances
// in id order, the reward preview = the settlement, fog and v26 neutrality; the AI's Dynamax, team and attack scores.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import { EVENTS_TUNING } from '../../src/content/pace-v27.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { raidCatchSpecies, raidContribution, raidPreview, raidRole, shieldStrike, viewRaidDynamaxBlocker } from '../../src/core/max-raids.ts';
import { planMaxRaidAction, maxRaidAttackScore } from '../../src/ai/max-raid-plan.ts';
import { raidMoveTargets } from '../../src/ai/raid-plan.ts';
import { depthWorldCards } from '../../src/browser/late-game-ui.ts';
import { maxRaidPanelMarkup } from '../../src/browser/max-raid-ui.ts';
import { buildScene } from '../../src/browser/render/scene.ts';

type Version = 26 | 27;
const setup = (gameplayVersion: Version, players = 2): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, ...Array.from({ length: players - 1 }, (_, index) => ({ id: index + 1, controller: 'ai' as const })),
  ] });
const order = (state: GameState, action: Command['action'], content: Content, actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
const ok = (result: ReturnType<typeof step>) => { if (!result.ok) throw new Error(result.reason); return result; };
const endRound = (state: GameState, content: Content) => { let next = state; for (const actor of next.turnOrder) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state; return next; };
function place(state: GameState, content: Content, speciesId: string, at: Hex, owner: number | null = 0): number {
  const id = state.nextEntityId++;
  state.units[id] = createMapUnit({ kind: 'pokemon', speciesId } as Parameters<typeof createMapUnit>[0], id, owner, at, content, 0, 1);
  refreshKnowledge(state, content);
  return id;
}
/** A free land tile at exactly `distance` from `around`. */
function freeAt(state: GameState, around: Hex, distance: number, content: Content, skip = 0): Hex {
  const taken = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(item => hexToIndex(item.position, state.map)));
  const ring = [...neighbors(around, state.map), ...neighbors(around, state.map).flatMap(hex => neighbors(hex, state.map)), ...neighbors(around, state.map).flatMap(hex => neighbors(hex, state.map)).flatMap(hex => neighbors(hex, state.map))];
  const fits = ring.filter(hex => { const index = hexToIndex(hex, state.map); return index !== null && !taken.has(index) && state.map.tiles[index] !== 'ocean' && content.moveCosts[state.map.tiles[index]] < 3
    && hexDistance(hex, around, state.map) === distance; });
  const unique = fits.filter((hex, index) => fits.findIndex(other => other.q === hex.q && other.r === hex.r) === index);
  return unique[skip]!;
}
/** A game with an open raid den at round 90 (every civilization has explored it, unless `explore` is false). */
function openRaid(version: Version, players = 2, explore = true) {
  const state0 = createGame(setup(version, players)), content = contentFor(state0.setup);
  state0.round = 84;
  let state = endRound(state0, content);
  state.round = 89;
  state = endRound(state, content);
  const raid = state.expansion!.raids!.active!;
  if (explore) for (const id of state.turnOrder) if (!state.knowledge[id].exploredTileIds.includes(raid.tileIndex)) state.knowledge[id].exploredTileIds.push(raid.tileIndex);
  return { state, content, raid, boss: state.units[raid.unitId] as Extract<GameState['units'][number], { location: 'map' }> };
}

describe('shield arithmetic (pure, shared by authority and preview)', () => {
  const T = EVENTS_TUNING, boss = { shields: 4, phase: 1 as const, hp: 120, maxHp: 120 };
  test('through the shields 25%; a hit breaks 1, a breaker or a super-effective hit 2', () => {
    expect(shieldStrike(boss, 'dealer', false, 40, T)).toEqual({ damage: 10, broken: 1, phaseTwo: false });
    expect(shieldStrike(boss, 'breaker', false, 40, T)).toEqual({ damage: 10, broken: 2, phaseTwo: false });
    expect(shieldStrike(boss, 'support', true, 40, T)).toEqual({ damage: 10, broken: 2, phaseTwo: false });
    expect(shieldStrike({ ...boss, shields: 1 }, 'breaker', false, 40, T).broken).toBe(1);
  });
  test('shields down: damage dealers ×1.25, the others unchanged; reaching the 50% line starts phase two (the damage is kept)', () => {
    expect(shieldStrike({ ...boss, shields: 0 }, 'dealer', false, 40, T).damage).toBe(50);
    expect(shieldStrike({ ...boss, shields: 0 }, 'breaker', false, 40, T).damage).toBe(40);
    expect(shieldStrike({ ...boss, shields: 0, hp: 70 }, 'breaker', false, 40, T)).toEqual({ damage: 40, broken: 0, phaseTwo: true });
    expect(shieldStrike({ ...boss, shields: 0, phase: 2, hp: 30 }, 'dealer', false, 40, T)).toEqual({ damage: 30, broken: 0, phaseTwo: false });
  });
  test('roles by class; contribution = damage + 15 × shields + healing', () => {
    expect(['melee', 'fast', 'siege'].map(role => raidRole(role as never))).toEqual(['breaker', 'breaker', 'breaker']);
    expect(['ranged', 'air', 'naval'].map(role => raidRole(role as never))).toEqual(['dealer', 'dealer', 'dealer']);
    expect(raidRole('scout')).toBe('support');
    expect(raidContribution({ 0: 30, 1: 5 }, { broken: { 1: 2, 2: 1 }, healed: { 2: 10 } }, contentFor(setup(27)))).toEqual({ 0: 30, 1: 35, 2: 25 });
  });
});

describe('v27 Max raid in a game', () => {
  test('the boss starts with shieldBase + ⌈living / 2⌉ shields in phase one; v26 has no Max ledger; the view hides shields from non-explorers', () => {
    const { raid, state, content } = openRaid(27), shields = EVENTS_TUNING.shieldBase + 1;
    expect(raid.max).toEqual({ shields, shieldMax: shields, phase: 1, broken: {}, healed: {}, dynamax: {} });
    expect(observe(state, 0, content).expansion!.raids!.active!.max).toMatchObject({ shields, shieldMax: shields, phase: 1, dynamaxUsed: false });
    expect(openRaid(26).raid.max).toBeUndefined();
    expect(observe(openRaid(26).state, 0, contentFor(setup(26))).expansion!.raids!.active!.max).toBeUndefined();
    const hidden = openRaid(27, 2, false);
    for (const id of [0, 1]) if (!hidden.state.knowledge[id].exploredTileIds.includes(hidden.raid.tileIndex)) {
      expect(observe(hidden.state, id, hidden.content).expansion!.raids!.active!.max).toMatchObject({ shields: null, shieldMax: null, phase: null });
    }
  });
  test('an attack breaks shields and deals the previewed damage; the ledger and the preview card follow', () => {
    const { state, content, raid, boss } = openRaid(27);
    const hitter = place(state, content, 'machamp', freeAt(state, boss.position, 1, content));
    const preview = previewAttack(observe(state, 0, content), hitter, { kind: 'unit', id: raid.unitId }, content);
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.maxRaid).toEqual({ shields: 2, phaseTwo: false });
    const hpBefore = boss.hp;
    const next = ok(order(state, { type: 'Attack', unitId: hitter, target: { kind: 'unit', id: raid.unitId } }, content));
    const dealt = hpBefore - next.state.units[raid.unitId].hp;
    expect(dealt).toBeGreaterThanOrEqual(preview.damage.min);
    expect(dealt).toBeLessThanOrEqual(preview.damage.max);
    const after = next.state.expansion!.raids!.active!;
    expect(after.max!.shields).toBe(Math.max(0, EVENTS_TUNING.shieldBase + 1 - 2));
    expect(after.max!.broken[0]).toBe(2);
    expect(next.events.map(event => event.payload.type)).toContain('RaidShieldsBroken');
    const view = observe(next.state, 0, content);
    expect(view.expansion!.raids!.active!.max!.contribution[0]).toBe((after.damage[0] ?? 0) + 2 * EVENTS_TUNING.shieldPoints);
    const card = depthWorldCards(view, content).find(item => item.id === 'raid')!;
    expect(card.title).toContain('极巨团体战');
    expect(card.status).toContain(`护盾 ${after.max!.shields}/${EVENTS_TUNING.shieldBase + 1}`);
    expect(card.tip).toContain('奖励预览');
    expect(maxRaidPanelMarkup(view, (label: string) => `<button>${label}</button>`, content)).toContain(`极巨护盾 ${after.max!.shields}/${EVENTS_TUNING.shieldBase + 1}`);
    const scene = buildScene({ view, camera: { x: 0, y: 0, zoom: 1 } } as never);
    expect(scene.units.find(item => item.unit.id === raid.unitId)?.max).toEqual({ shields: after.max!.shields, shieldMax: EVENTS_TUNING.shieldBase + 1, phase: 1 });
  });
  test('RaidDynamax: once per civilization per raid, within 2 tiles, free, until the raid ends', () => {
    const { state, content, raid, boss } = openRaid(27);
    const far = place(state, content, 'pidgeot', freeAt(state, boss.position, 3, content));
    const near = place(state, content, 'pidgeot', freeAt(state, boss.position, 2, content));
    const stock = JSON.stringify(state.expansion!.essences!.stock[0]);
    expect(order(state, { type: 'RaidDynamax', unitId: far }, content).ok).toBe(false);
    expect(viewRaidDynamaxBlocker(observe(state, 0, content), far, content)).toBe('raid-dynamax-range');
    expect(planMaxRaidAction(observe(state, 0, content), content)).toEqual({ type: 'RaidDynamax', unitId: near });
    const used = ok(order(state, { type: 'RaidDynamax', unitId: near }, content));
    expect(used.state.expansion!.eraAbilities!.units[near].dynamaxUntilRound).toBe(raid.endsAtRound);
    expect(JSON.stringify(used.state.expansion!.essences!.stock[0])).toBe(stock);
    expect(used.events.map(event => event.payload.type)).toContain('RaidDynamaxed');
    const second = place(used.state, content, 'pidgeot', freeAt(used.state, boss.position, 1, content));
    expect(order(used.state, { type: 'RaidDynamax', unitId: second }, content).ok).toBe(false);
    expect(viewRaidDynamaxBlocker(observe(used.state, 0, content), second, content)).toBe('raid-dynamax-used');
    expect(planMaxRaidAction(observe(used.state, 0, content), content)).toBeNull();
    // v26: the command does not exist for the den.
    const old = openRaid(26), unit = place(old.state, old.content, 'pidgeot', freeAt(old.state, old.boss.position, 1, old.content));
    expect(order(old.state, { type: 'RaidDynamax', unitId: unit }, old.content).ok).toBe(false);
  });
  test('round end: phase two strikes 2 tiles away; support heals neighbours and counts as contribution', () => {
    const { state, content, raid, boss } = openRaid(27);
    raid.max!.phase = 2; raid.max!.shields = 2;
    const two = place(state, content, 'machamp', freeAt(state, boss.position, 2, content), 1);
    const scout = place(state, content, 'pidgeotto', freeAt(state, boss.position, 2, content, 1));
    const friend = place(state, content, 'machamp', neighbors(state.units[scout].position!, state.map).find(hex => { const index = hexToIndex(hex, state.map);
      return index !== null && state.map.tiles[index] !== 'ocean' && !Object.values(state.units).some(unit => isMapUnit(unit) && unit.position.q === hex.q && unit.position.r === hex.r) && !Object.values(state.cities).some(city => city.position.q === hex.q && city.position.r === hex.r); })!);
    (state.units[friend] as { hp: number }).hp = 20;
    const hp = state.units[two].hp;
    const next = endRound(state, content);
    expect(next.units[two].hp).toBeLessThan(hp);
    expect(next.units[friend]).toBeDefined();
    expect(next.expansion!.raids!.active!.max!.healed[0]).toBeGreaterThanOrEqual(EVENTS_TUNING.supportHeal);
  });
  test('knocked out: the top contributor gets the boss, the others with ≥ 10% roll catch chances in id order from state.rng', () => {
    const { state, content, raid, boss } = openRaid(27, 4);
    raid.damage = { 1: 40, 2: 25, 3: 2 }; raid.max!.broken = { 2: 2 };
    raid.max!.shields = 0; raid.max!.phase = 2;
    (state.units[raid.unitId] as { hp: number }).hp = 1;
    const hitter = place(state, content, 'machamp', freeAt(state, boss.position, 1, content));
    const result = ok(order(state, { type: 'Attack', unitId: hitter, target: { kind: 'unit', id: raid.unitId } }, content));
    const events = result.events.map(event => event.payload);
    const defeated = events.find(event => event.type === 'RaidDefeated')!;
    if (defeated.type !== 'RaidDefeated') throw new Error('no award');
    const contribution = defeated.contribution!, total = Object.values(contribution).reduce((sum, value) => sum + value, 0);
    expect(defeated.playerId).toBe(Number(Object.entries(contribution).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]));
    const rolls = events.filter(event => event.type === 'RaidCaptureRolled');
    const expected = Object.entries(contribution).map(([id, value]) => ({ id: Number(id), value })).filter(item => item.id !== defeated.playerId && item.value * 100 >= 10 * total).sort((a, b) => a.id - b.id);
    expect(rolls.map(event => event.type === 'RaidCaptureRolled' && event.playerId)).toEqual(expected.map(item => item.id));
    expect(rolls.length).toBeGreaterThan(0);
    for (const event of rolls) if (event.type === 'RaidCaptureRolled') {
      const share = Math.floor(contribution[event.playerId] * 100 / total);
      expect(event.chance).toBe(Math.min(EVENTS_TUNING.catchMaxPercent, EVENTS_TUNING.catchBasePercent + share));
      expect(event.speciesId).toBe(raidCatchSpecies(content, raid.speciesId));
      if (event.success) expect(result.state.units[event.unitId!]?.ownerId).toBe(event.playerId);
    }
    expect(contribution[3]).toBe(2);
    expect(rolls.some(event => event.type === 'RaidCaptureRolled' && event.playerId === 3)).toBe(false);
    // Same command, same result (determinism).
    expect(JSON.stringify(ok(order(state, { type: 'Attack', unitId: hitter, target: { kind: 'unit', id: raid.unitId } }, content)).events)).toBe(JSON.stringify(result.events));
  });
  test('a boss that leaves pays the participation gold to every share of at least 10%', () => {
    const { state, content, raid } = openRaid(27);
    raid.damage = { 0: 30, 1: 2 };
    const gold = [state.players[0].gold, state.players[1].gold];
    state.round = raid.endsAtRound;
    const next = endRound(state, content);
    expect(next.expansion!.raids!.active).toBeNull();
    expect(next.players[0].gold - gold[0]).toBeGreaterThanOrEqual(EVENTS_TUNING.participationGold);
  });
  test('reward preview: the viewer\'s share, catch chance and gold from the public ledger', () => {
    const { state, content, raid } = openRaid(27);
    raid.damage = { 0: 22, 1: 78 };
    const preview = raidPreview(observe(state, 0, content), content)!;
    expect(preview).toMatchObject({ own: 22, total: 100, sharePercent: 22, leading: false, catchChance: 52, gold: 132 });
    expect(raidPreview(observe(state, 1, content), content)).toMatchObject({ leading: true, catchChance: null });
  });
  test('AI: a lone healthy Pokémon walks to the den; attacks on the boss are military work with the role bonus', () => {
    const { state, content, raid, boss } = openRaid(27);
    const walker = place(state, content, 'machamp', freeAt(state, boss.position, 3, content));
    const view = observe(state, 0, content);
    expect(raidMoveTargets(view).get(walker)).toEqual(boss.position);
    const hitter = place(state, content, 'machamp', freeAt(state, boss.position, 1, content));
    const next = observe(state, 0, content), preview = previewAttack(next, hitter, { kind: 'unit', id: raid.unitId }, content);
    const unit = next.units.find(item => item.id === hitter)!, target = next.units.find(item => item.id === raid.unitId)!;
    expect(maxRaidAttackScore(next, unit, target, preview, content)).toBeGreaterThan(300);
  });
});
