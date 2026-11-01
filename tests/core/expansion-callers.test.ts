import { describe, expect, it } from 'vitest';
import { CONTENT, EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { Content, SpeciesId } from '../../src/content/units.ts';
import { canEnter, initialUnitPosition, reachablePaths } from '../../src/core/movement.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, indexToHex } from '../../src/core/hex.ts';
import type { GameSetup, GameState, MapUnit } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit, registerSpecies } from '../../src/core/unit.ts';
import { observe } from '../../src/core/vision.ts';
import { canCaptureByPersonality } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { applyLeaderAction, planLeaderAction, validateLeaderAction } from '../../src/core/leader-systems.ts';

const expansionSetup: GameSetup = {
  seed: 77, width: 16, height: 12, roundLimit: 100, expansionVersion: 1,
  players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
    { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'lance' },
  ],
};

function expansionState(): GameState {
  return createGame(expansionSetup);
}

function insertPokemon(state: GameState, speciesId: SpeciesId, ownerId: number | null): MapUnit {
  const city = state.cities[state.players[0].headquartersCityId];
  const id = state.nextEntityId++;
  const unit = createMapUnit({ kind: 'pokemon', speciesId }, id, ownerId, city.position, EXPANSION_CONTENT, 0, 1);
  state.units[id] = unit;
  if (ownerId !== null) registerSpecies(state.players[ownerId], unit);
  return unit;
}

function moveFirstReachable(state: GameState, unitId: number) {
  const view = observe(state, 0);
  const entry = Object.entries(reachablePaths(view, unitId))[0];
  if (!entry) throw new Error('Expected at least one reachable tile');
  const to = indexToHex(Number(entry[0]), state.map);
  return { result: step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId, to } }), path: entry[1], to };
}

describe('version-aware default content callers', () => {
  it('moves an expansion-only unit through reachablePaths and the Move command', () => {
    const state = expansionState();
    const unit = insertPokemon(state, 'magnemite', 0);
    expect(CONTENT.units.magnemite).toBeUndefined();

    const { result, path, to } = moveFirstReachable(state, unit.id);
    if (!result.ok) throw new Error(result.reason);
    expect(path[0]).toEqual(unit.position);
    expect(path.at(-1)).toEqual(to);
    expect(result.state.units[unit.id]).toMatchObject({ position: to, actionLeft: 0 });
    expect(result.events[0].payload).toEqual({ type: 'Moved', unitId: unit.id, path });
  });

  it('keeps an explicit custom Content override authoritative', () => {
    const state = expansionState();
    const unit = insertPokemon(state, 'magnemite', 0);
    const view = observe(state, 0);
    const defaultDistances = Object.values(reachablePaths(view, unit.id))
      .map(path => hexDistance(unit.position, path.at(-1)!));
    const oneMoveContent: Content = {
      ...EXPANSION_CONTENT,
      units: { ...EXPANSION_CONTENT.units, magnemite: { ...EXPANSION_CONTENT.units.magnemite!, move: 1 } },
    };
    const customDistances = Object.values(reachablePaths(view, unit.id, oneMoveContent))
      .map(path => hexDistance(unit.position, path.at(-1)!));

    expect(Math.max(...defaultDistances)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...customDistances)).toBeLessThanOrEqual(1);
  });

  it('keeps legacy movement on classic content', () => {
    const legacySetup = { ...expansionSetup };
    delete legacySetup.expansionVersion;
    const state = createGame(legacySetup);
    const unit = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon');
    if (!unit?.position) throw new Error('Expected a deployed legacy pokemon');
    const view = observe(state, 0);
    const paths = reachablePaths(view, unit.id);

    expect(Object.keys(paths).length).toBeGreaterThan(0);
    expect(reachablePaths(view, unit.id, CONTENT)).toEqual(paths);
  });

  it('uses expansion content for initial placement without overriding an explicit content pack', () => {
    const state = expansionState();
    const city = state.cities[state.players[0].headquartersCityId];
    const identity = { kind: 'pokemon' as const, speciesId: 'magnemite' as const };

    const placed = initialUnitPosition(state, city.position, identity);
    expect(canEnter(identity, state.map.tiles[hexToIndex(placed, state.map)!]!, EXPANSION_CONTENT)).toBe(true);
    expect(initialUnitPosition(state, city.position, identity, EXPANSION_CONTENT)).toEqual(placed);
  });

  it('uses the expanded query for personality capture and preserves custom content', () => {
    const state = expansionState();
    state.players[0].personality = 'expansion';
    const wild = insertPokemon(state, 'magnemite', null);
    wild.hp = 1;
    wild.position = { q: wild.position.q, r: wild.position.r - 1 };
    const view = observe(state, 0);
    const target = view.units.find(unit => unit.id === wild.id);
    if (!target) throw new Error('Expected the expansion-only wild pokemon to be visible');

    expect(canCaptureByPersonality(view, target)).toBe(true);
    expect(canCaptureByPersonality(view, target, { ...RULE_QUERIES, content: EXPANSION_CONTENT })).toBe(true);
    const custom: Content = {
      ...EXPANSION_CONTENT,
      species: { ...EXPANSION_CONTENT.species, magnemite: { ...EXPANSION_CONTENT.species.magnemite!, maxHp: 1 } },
    };
    expect(canCaptureByPersonality(view, target, { ...RULE_QUERIES, content: custom })).toBe(false);
  });

  it('keeps leader-system defaults equivalent to their explicit expansion content', () => {
    const state = expansionState();
    state.players[0].gold = 200;
    state.players[0].research.unlockedIds.push('training');
    const action = planLeaderAction(observe(state, 0));
    if (!action) throw new Error('Expected a recruitable leader action');

    expect(planLeaderAction(observe(state, 0))).toEqual(planLeaderAction(observe(state, 0), EXPANSION_CONTENT));
    expect(validateLeaderAction(state, 0, action)).toBe(validateLeaderAction(state, 0, action, EXPANSION_CONTENT));
    expect(applyLeaderAction(structuredClone(state), 0, action))
      .toEqual(applyLeaderAction(structuredClone(state), 0, action, EXPANSION_CONTENT));
  });
});
