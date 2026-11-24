import { expect, test } from 'vitest';
import { GAME_CONTENT, STOCK_CONTENTS, contentFor, contentForView, isStockContent, regionalDexDraw } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameState } from '../../src/core/model.ts';
import { rivalCounters } from '../../src/core/rivals.ts';
import { leaderBalanceCases, simulateLeaderCase } from '../../tools/leader-balance.ts';

const setup = (gameplayVersion: 27, extra: { dexSeed?: number } = {}) => ({ seed: 33, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, ...extra, players: [
    { id: 0, controller: 'ai' as const, leaderId: 'misty' as const }, { id: 1, controller: 'ai' as const, leaderId: 'brock' as const },
  ] });

test('v27 derives one shared, memoized regional content per setup', () => {
  expect(STOCK_CONTENTS).toEqual([GAME_CONTENT]);
  const content = contentFor(setup(27));
  expect(content).not.toBe(GAME_CONTENT);
  expect(content).toBe(contentFor(JSON.parse(JSON.stringify(setup(27)))));
  expect(isStockContent(content)).toBe(true);
  expect(content.regionalDex!.speciesIds).toEqual(regionalDexDraw(setup(27)).speciesIds);
  expect(content.regionalDex!.pool).toBe(71);
  // The seated leaders' lines are anchored: misty's gyarados and brock's onix.
  expect(content.regionalDex!.speciesIds).toEqual(expect.arrayContaining(['magikarp', 'gyarados', 'onix', 'steelix']));
  expect(contentFor(setup(27, { dexSeed: 33 }))).toBe(content);
  expect(contentFor(setup(27, { dexSeed: 34 })).regionalDex!.speciesIds).not.toEqual(content.regionalDex!.speciesIds);
});

test('views carry the public regional Pokédex and map to the authority content', () => {
  const state = createGame(setup(27)), view = observe(state, 0), content = contentFor(state.setup);
  expect(view.regionalDex).toEqual([...content.regionalDex!.speciesIds]);
  expect(contentForView(view)).toBe(content);
  // Pokédex target: at 100 rounds the base is 26, scaled by half the regional share of the pool (1/2 + N / 142), plus v26/v27 bonuses.
  expect(state.expansion!.world.victory.targetDocumentedSpecies).toBe(Math.max(12, Math.round(26 * (0.5 + content.regionalDex!.size / 142)))
    + content.depth26.pokedexTargetBonus + content.pace27.opening.pokedexTargetBonus);
  for (const nest of Object.values(state.expansion!.world.nests)) expect(content.regionalDex!.speciesIds).toContain(nest.speciesId);
  for (const overlord of Object.values(state.expansion!.world.overlords)) expect(content.regionalDex!.speciesIds).toContain(overlord.speciesId);
  for (const starter of ['bulbasaur', 'charmander', 'squirtle'] as const) for (const list of ['primary', 'secondary'] as const) {
    const counters = rivalCounters(content, starter, list);
    expect(counters.length, `${starter} ${list}`).toBeGreaterThan(0);
    for (const id of counters) expect(content.regionalDex!.speciesIds).toContain(id);
  }
});

test('a real v25 AI game only ever shows regional species and never has a training command refused', () => {
  const [match] = leaderBalanceCases({ seeds: 1, seedStart: 31, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27, roundLimit: 100, width: 24, height: 16 });
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
