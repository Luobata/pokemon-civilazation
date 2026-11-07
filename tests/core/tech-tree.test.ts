import { expect, test } from 'vitest';
import { DISCOVERIES } from '../../src/content/discoveries.ts';
import { TECHS } from '../../src/content/economy.ts';
import type { TechId } from '../../src/content/economy.ts';
import { eraState, ERA_DEFINITIONS } from '../../src/content/eras.ts';
import { TECH_LINE_IDS, TREE_COLUMNS, TREE_NEW_TECH_IDS, TREE_TECHS, TREE_ERA_THRESHOLDS } from '../../src/content/tech-tree.ts';
import { OPENING_CONTENT, WORLD_CONTENT, contentFor } from '../../src/content/units.ts';
import { canResearch } from '../../src/core/economy-commands.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { playerPolicyEffects, viewPolicyEffects } from '../../src/core/policies.ts';
import { recordDiscoveries } from '../../src/core/discoveries.ts';
import { classTrainingBlocker } from '../../src/core/unit-classes.ts';
import { validateEssenceAction } from '../../src/core/essences.ts';
import { validateContestAction } from '../../src/core/contests.ts';
import { scorePlayer } from '../../src/core/victory.ts';
import { districtTech } from '../../src/content/districts.ts';
import { techUnlocks } from '../../src/browser/tech-info.ts';
import { treeResearchBenefit } from '../../src/ai/role-plan.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

const setup = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 4242, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
  gameplayVersion, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
    { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
  ] });
const ids = Object.keys(WORLD_CONTENT.techs) as TechId[];
const research = (state: GameState, techId: TechId) => step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'SetResearch', techId } }, WORLD_CONTENT);
const learn = (state: GameState, ...techs: TechId[]) => { state.players[0].research.unlockedIds.push(...techs); state.players[0].research.unlockedIds.sort(); return state; };

test('v22 has 30 techs in 6 era columns and 6 lines, keeping the 12 older ids', () => {
  expect(WORLD_CONTENT.techTree).toBe(true);
  expect(ids).toHaveLength(30);
  expect(TREE_NEW_TECH_IDS).toHaveLength(18);
  for (const id of Object.keys(TECHS)) expect(ids).toContain(id);
  expect(new Set(ids.map(id => WORLD_CONTENT.techs[id]!.tier))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  expect(TREE_COLUMNS).toBe(6);
  expect(new Set(ids.map(id => WORLD_CONTENT.techs[id]!.line))).toEqual(new Set(TECH_LINE_IDS));
  expect(TECH_LINE_IDS).toHaveLength(6);
  // Costs grow by column.
  for (const id of ids) for (const other of ids) if (WORLD_CONTENT.techs[id]!.tier < WORLD_CONTENT.techs[other]!.tier) expect(WORLD_CONTENT.techs[id]!.cost).toBeLessThan(WORLD_CONTENT.techs[other]!.cost);
});

test('prerequisites exist, sit in earlier columns, the graph is acyclic and every tech is reachable from the roots', () => {
  for (const id of ids) {
    const requires = TREE_TECHS[id].requires;
    expect(requires.length, id).toBeLessThanOrEqual(2);
    if (TREE_TECHS[id].tier > 1) expect(requires.length, id).toBeGreaterThanOrEqual(1);
    else expect(requires, id).toEqual([]);
    for (const requirement of requires) {
      expect(ids, `${id} needs ${requirement}`).toContain(requirement);
      expect(TREE_TECHS[requirement].tier, `${id} after ${requirement}`).toBeLessThan(TREE_TECHS[id].tier);
    }
  }
  // Research in waves from nothing: everything opens eventually (reachable, no cycles).
  const done = new Set<TechId>();
  for (let wave = 0; wave < 30 && done.size < ids.length; wave++) {
    const open = ids.filter(id => !done.has(id) && TREE_TECHS[id].requires.every(requirement => done.has(requirement)));
    expect(open.length, `wave ${wave}`).toBeGreaterThan(0);
    for (const id of open) done.add(id);
  }
  expect(done.size).toBe(ids.length);
  // Cross-links: several techs join two different lines.
  expect(ids.filter(id => new Set(TREE_TECHS[id].requires.map(requirement => TREE_TECHS[requirement].line)).size === 2).length).toBeGreaterThanOrEqual(8);
});

test('every v22 tech unlocks something concrete and has exactly one discovery', () => {
  for (const id of ids) {
    expect(techUnlocks(id, WORLD_CONTENT, 22).length, id).toBeGreaterThan(0);
    expect(DISCOVERIES[id], id).toBeDefined();
  }
  expect(Object.keys(DISCOVERIES).sort()).toEqual([...ids].sort());
  // Rewired unlocks hang off existing systems.
  expect(WORLD_CONTENT.buildings.meetingHall.requiredTech).toBe('commerce');
  expect(WORLD_CONTENT.buildings.observatory.requiredTech).toBe('laboratory');
  expect(OPENING_CONTENT.buildings.meetingHall.requiredTech).toBeUndefined();
  expect(districtTech('harborDistrict', true)).toBe('seafaring');
  expect(districtTech('harborDistrict', false)).toBe('domestication');
  expect(WORLD_CONTENT.roster!.techRecruits.dragonLore).toBe('dratini');
});

test('research is refused without all prerequisites and accepted with them', () => {
  const state = createGame(setup(22));
  expect(state.players[0].research.tree).toBe(true);
  expect(Object.keys(state.players[0].research.progressByTech)).toHaveLength(30);
  expect(research(state, 'typeResearch')).toMatchObject({ ok: false, reason: 'research-unavailable' });
  learn(state, 'domestication');
  // One of two prerequisites is not enough (the old tier rule would have allowed it).
  expect(research(state, 'typeResearch')).toMatchObject({ ok: false, reason: 'research-unavailable' });
  expect(research(state, 'seafaring').ok).toBe(true);
  learn(state, 'stoneCraft');
  const accepted = research(state, 'typeResearch');
  expect(accepted.ok).toBe(true);
  // A column-3 tech stays locked until its own prerequisites are done, even with every column-2 tech of another line.
  learn(state, 'riding', 'ballCraft');
  expect(canResearch(state.players[0], 'electricity', WORLD_CONTENT)).toBe(false);
  learn(state, 'typeResearch', 'masonry');
  expect(canResearch(state.players[0], 'electricity', WORLD_CONTENT)).toBe(true);
});

test('v21 keeps the tier rule, 12 techs and no tree marker', () => {
  const state = createGame(setup(21)), content = contentFor(state.setup);
  expect(content.techTree).toBeUndefined();
  expect(state.players[0].research).not.toHaveProperty('tree');
  expect(Object.keys(state.players[0].research.progressByTech)).toHaveLength(12);
  state.players[0].research.unlockedIds.push('domestication');
  expect(canResearch(state.players[0], 'typeResearch', content)).toBe(true);
  expect(canResearch(state.players[0], 'seafaring', content)).toBe(false);
  expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'SetResearch', techId: 'seafaring' } }, content)).toMatchObject({ ok: false, reason: 'research-unavailable' });
});

test('v22 era thresholds: same era order, spread over 30 techs', () => {
  const player = (count: number, tree?: true) => ({ research: { unlockedIds: ids.slice(0, count), ...(tree ? { tree } : {}) } });
  expect(TREE_ERA_THRESHOLDS['simple-v1']).toHaveLength(ERA_DEFINITIONS['simple-v1'].length);
  expect(TREE_ERA_THRESHOLDS['full-v1']).toHaveLength(ERA_DEFINITIONS['full-v1'].length);
  expect(eraState(player(3, true), 'simple-v1')?.index).toBe(0);
  expect(eraState(player(3), 'simple-v1')?.index).toBe(1);
  expect(eraState(player(7, true), 'simple-v1')).toMatchObject({ index: 1, current: { id: 'generation-2', threshold: 7 } });
  expect(eraState(player(16, true), 'simple-v1')).toMatchObject({ index: 2, next: null });
  expect(eraState(player(28, true), 'full-v1')).toMatchObject({ index: 8 });
  expect(eraState(player(27, true), 'full-v1')?.index).toBe(7);
  for (const mode of ['simple-v1', 'full-v1'] as const) {
    const thresholds = TREE_ERA_THRESHOLDS[mode];
    expect([...thresholds].sort((a, b) => a - b)).toEqual([...thresholds]);
    expect(thresholds[thresholds.length - 1]).toBeLessThanOrEqual(30);
  }
});

test('v22 gates: gyms, contest halls and final-stage training wait for their techs; bonuses match in state and view', () => {
  const state = createGame(setup(22));
  const city = Object.values(state.cities).find(item => item.ownerId === 0)!;
  state.players[0].gold = 500;
  state.expansion!.essences!.stock[0].life = 99;
  expect(validateEssenceAction(state, 0, { type: 'BuildGym', cityId: city.id, essence: 'life' })).toBe('gym-tech-locked');
  expect(validateContestAction(state, 0, { type: 'BuildContestHall', cityId: city.id })).toBe('hall-tech-locked');
  const finalStage = Object.keys(WORLD_CONTENT.species).find(id => WORLD_CONTENT.species[id].stage === 3 && WORLD_CONTENT.species[id].role === 'melee')!;
  expect(classTrainingBlocker(state, state.players[0], 'simple-v1', new Set(), finalStage as never, WORLD_CONTENT)?.kind).toBe('tech');
  learn(state, 'typeResearch', 'contestArts', 'eliteTraining', 'lureCraft', 'steelworks');
  expect(validateEssenceAction(state, 0, { type: 'BuildGym', cityId: city.id, essence: 'life' })).toBeNull();
  expect(validateContestAction(state, 0, { type: 'BuildContestHall', cityId: city.id })).toBeNull();
  expect(classTrainingBlocker(state, state.players[0], 'simple-v1', new Set(), finalStage as never, WORLD_CONTENT)?.kind).not.toBe('tech');
  const effects = playerPolicyEffects(state, 0);
  expect(effects).toMatchObject({ captureBonus: 10, cityProduction: 1, trainedXp: 10 });
  expect(viewPolicyEffects(observe(state, 0))).toEqual(effects);
  expect(playerPolicyEffects(state, 1)).toMatchObject({ captureBonus: 0, cityProduction: 0 });
  // Older games: none of this exists.
  const old = createGame(setup(21)), oldCity = Object.values(old.cities).find(item => item.ownerId === 0)!;
  old.players[0].gold = 500; old.expansion!.essences!.stock[0].life = 99;
  expect(validateEssenceAction(old, 0, { type: 'BuildGym', cityId: oldCity.id, essence: 'life' })).toBeNull();
  old.players[0].research.unlockedIds.push('lureCraft' as TechId);
  expect(playerPolicyEffects(old, 0).captureBonus).toBe(0);
});

test('冠军联盟 multiplies the score only in v22', () => {
  const state = learn(createGame(setup(22)), 'championLeague');
  const withMultiplier = scorePlayer(state, 0).total;
  delete state.players[0].research.tree;
  const plain = scorePlayer(state, 0).total;
  expect(withMultiplier).toBe(Math.floor(plain * 1100 / 1000));
  expect(withMultiplier).toBeGreaterThan(plain);
});

test('new-tech discoveries fire only on the v22 tree', () => {
  const before = createGame(setup(22)), next = structuredClone(before);
  next.players[0].gold = 150;
  const events = recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [], WORLD_CONTENT);
  expect(events).toContainEqual(expect.objectContaining({ type: 'DiscoveryMade', playerId: 0, techId: 'commerce', bonus: 20 }));
  const old = createGame(setup(21)), oldNext = structuredClone(old);
  oldNext.players[0].gold = 150;
  expect(recordDiscoveries(old, oldNext, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [], contentFor(old.setup))
    .some(event => event.type === 'DiscoveryMade' && (TREE_NEW_TECH_IDS as readonly string[]).includes(event.techId))).toBe(false);
});

test('the AI prefers its leader line among researchable techs', () => {
  const state = createGame(setup(22));
  learn(state, 'domestication', 'berryCultivation', 'stoneCraft', 'seafaring');
  const view = observe(state, 0);
  const open = ids.filter(id => canResearch(state.players[0], id, WORLD_CONTENT));
  const best = [...open].sort((a, b) => treeResearchBenefit(view, b, WORLD_CONTENT) - treeResearchBenefit(view, a, WORLD_CONTENT))[0];
  // Oak leans on science.
  expect(WORLD_CONTENT.techs[best]!.line).toBe('science');
});
