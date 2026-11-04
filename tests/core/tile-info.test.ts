import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import { describeTile, tileSummary } from '../../src/browser/tile-info.ts';

function played(rounds: number): GameState {
  const setup: GameSetup = { seed: 7, width: 30, height: 20, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 10, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'brock' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'misty' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < rounds) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, memory);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}

test('tile descriptions use only what the player knows', () => {
  const state = played(50);
  const kinds = new Set<string>();
  for (const playerId of state.turnOrder) {
    const view = observe(state, playerId, EXPANSION_CONTENT), visible = new Set(view.visibleTileIds);
    let units = 0;
    for (let index = 0; index < view.map.tiles.length; index++) {
      const info = describeTile(view, index);
      expect(tileSummary(info).length).toBeGreaterThan(0);
      if (view.map.tiles[index] === null) { expect(info.terrain).toBeNull(); expect(info.entities).toEqual([]); continue; }
      for (const entity of info.entities) {
        kinds.add(entity.kind);
        if (entity.kind === 'unit') { expect(visible.has(index), `unit on hidden tile ${index}`).toBe(true); units++; }
        if (entity.tone === 'wild') expect(['unit', 'nest']).toContain(entity.kind);
      }
    }
    // Every unit the view lists is described, and nothing more.
    expect(units).toBe(view.units.length);
    for (const unit of view.units) {
      const entity = describeTile(view, hexToIndex(unit.position, view.map)!).entities.find(item => item.unitId === unit.id)!;
      expect(entity.tone).toBe(unit.ownerId === null ? 'wild' : unit.ownerId === playerId ? 'own' : expect.stringMatching(/peace|enemy/));
    }
  }
  expect([...kinds]).toEqual(expect.arrayContaining(['city', 'unit', 'resource', 'improvement']));
}, 60_000);
