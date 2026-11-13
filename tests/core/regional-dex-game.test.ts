import { expect, test } from 'vitest';
import { REGIONAL_CONTENT, STOCK_CONTENTS, WORLD24_CONTENT, contentFor, contentForView, isStockContent, regionalDexDraw } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameState } from '../../src/core/model.ts';
import { rivalCounters } from '../../src/core/rivals.ts';
import { leaderBalanceCases, simulateLeaderCase } from '../../tools/leader-balance.ts';

const setup = (gameplayVersion: 22 | 23 | 24 | 25, extra: { dexSeed?: number } = {}) => ({ seed: 33, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, ...extra, players: [
    { id: 0, controller: 'ai' as const, leaderId: 'misty' as const }, { id: 1, controller: 'ai' as const, leaderId: 'brock' as const },
  ] });

test('v<=24 setups keep their stock content objects; v25 derives one shared, memoized regional content', () => {
  for (const version of [22, 23, 24] as const) expect(STOCK_CONTENTS).toContain(contentFor(setup(version)));
  expect(contentFor(setup(24))).toBe(WORLD24_CONTENT);
  const content = contentFor(setup(25));
  expect(content).not.toBe(REGIONAL_CONTENT);
  expect(content).toBe(contentFor(JSON.parse(JSON.stringify(setup(25)))));
  expect(isStockContent(content)).toBe(true);
  expect(content.regionalDex!.speciesIds).toEqual(regionalDexDraw(setup(25)).speciesIds);
  expect(content.regionalDex!.pool).toBe(71);
  // The seated leaders' lines are anchored: misty's gyarados and brock's onix.
  expect(content.regionalDex!.speciesIds).toEqual(expect.arrayContaining(['magikarp', 'gyarados', 'onix', 'steelix']));
  expect(contentFor(setup(25, { dexSeed: 33 }))).toBe(content);
  expect(contentFor(setup(25, { dexSeed: 34 })).regionalDex!.speciesIds).not.toEqual(content.regionalDex!.speciesIds);
});

test('views: v25 carries the public regional Pokédex and maps to the authority content; v24 views carry none', () => {
  const state = createGame(setup(25)), view = observe(state, 0), content = contentFor(state.setup);
  expect(view.regionalDex).toEqual([...content.regionalDex!.speciesIds]);
  expect(contentForView(view)).toBe(content);
  expect(observe(createGame(setup(24)), 0).regionalDex).toBeUndefined();
  // Pokédex target: at 100 rounds the base is 26, scaled by half the regional share of the pool (1/2 + N / 142).
  expect(state.expansion!.world.victory.targetDocumentedSpecies).toBe(Math.max(12, Math.round(26 * (0.5 + content.regionalDex!.size / 142))));
  for (const nest of Object.values(state.expansion!.world.nests)) expect(content.regionalDex!.speciesIds).toContain(nest.speciesId);
  for (const overlord of Object.values(state.expansion!.world.overlords)) expect(content.regionalDex!.speciesIds).toContain(overlord.speciesId);
  for (const starter of ['bulbasaur', 'charmander', 'squirtle'] as const) for (const list of ['primary', 'secondary'] as const) {
    const counters = rivalCounters(content, starter, list);
    expect(counters.length, `${starter} ${list}`).toBeGreaterThan(0);
    for (const id of counters) expect(content.regionalDex!.speciesIds).toContain(id);
  }
});

test('a real v25 AI game only ever shows regional species and never has a training command refused', () => {
  const [match] = leaderBalanceCases({ seeds: 1, seedStart: 31, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 25, roundLimit: 100, width: 24, height: 16 });
  const regional = new Set(contentFor(match.setup).regionalDex!.speciesIds), seen = new Set<SpeciesId>();
  let last: GameState | null = null;
  const result = simulateLeaderCase(match, state => {
    last = state;
    for (const unit of Object.values(state.units)) if (unit.kind === 'pokemon' && (unit.ownerId !== null || isMapUnit(unit))) seen.add(unit.speciesId);
  });
  expect(result.status).toBe('completed');
  expect(result.exception).toBeNull();
  expect([...seen].filter(id => !regional.has(id))).toEqual([]);
  expect(result.rejections.examples.filter(item => item.actionType === 'SetProductionQueue')).toEqual([]);
  const world = (last as GameState | null)!.expansion!.world;
  for (const nest of Object.values(world.nests)) expect(regional.has(nest.speciesId)).toBe(true);
  for (const card of Object.values((last as GameState | null)!.expansion!.researchTasks ?? {})) for (const id of Object.keys(card)) expect(regional.has(id as SpeciesId), id).toBe(true);
}, 300_000);
