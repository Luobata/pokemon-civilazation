import { expect, test } from 'vitest';
import { ERA_DEFINITIONS, eraState, isEraProgression } from '../../src/content/eras.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId, UnitIdentity } from '../../src/content/units.ts';
import { LEADER_DOCTRINES, doctrineEffects } from '../../src/core/leader-doctrines.ts';
import type { DoctrinePlayer } from '../../src/core/leader-doctrines.ts';
import { renderEraPanel } from '../../src/browser/era-panel.ts';
import type { PlayerView } from '../../src/core/model.ts';
import type { LeaderId } from '../../src/content/leaders.ts';

function player(leaderId: LeaderId | undefined, techs: number): DoctrinePlayer {
  const unlocked = Object.keys(EXPANSION_CONTENT.techs).slice(0, techs);
  return { leaderId, research: { unlockedIds: unlocked as DoctrinePlayer['research']['unlockedIds'] } };
}

function identity(speciesId: SpeciesId): UnitIdentity {
  return { kind: 'pokemon', speciesId };
}

function view(leaderId: LeaderId | undefined, techs: number, mode?: EraProgression): PlayerView {
  return {
    eraProgression: mode,
    playerId: 0, seed: 1, round: 1, activePlayerId: 0, commandSeq: 0,
    map: { width: 1, height: 1, tiles: ['grassland'] }, territoryOwnerIds: [[]], visibleTileIds: [0],
    knowledge: { exploredTileIds: [], rememberedTiles: {}, lastKnownUnits: {}, lastKnownCities: {} },
    units: [], recoveringUnits: [], cities: [], combat: { units: {}, cities: {} }, diplomacy: [],
    outcome: null, roundLimit: 100, civilizations: [{ id: 0, eliminated: false, ...(leaderId ? { leaderId } : {}) }],
    economy: { player: player(leaderId, techs) as never, cities: [] },
  };
}

test('era progression validates and derives compact and full endpoints from completed technologies', () => {
  expect(isEraProgression('simple-v1')).toBe(true);
  expect(isEraProgression('full-v1')).toBe(true);
  expect(isEraProgression('complete-v1')).toBe(false);
  expect(eraState(player(undefined, 0), 'simple-v1')).toMatchObject({ current: ERA_DEFINITIONS['simple-v1'][0], next: ERA_DEFINITIONS['simple-v1'][1], techsToNextEra: 3 });
  expect(eraState(player(undefined, 3), 'simple-v1')).toMatchObject({ index: 1, current: ERA_DEFINITIONS['simple-v1'][1], phase: 'middle' });
  expect(eraState(player(undefined, 7), 'simple-v1')).toMatchObject({ index: 2, next: null, techsToNextEra: null, phase: 'late' });
  expect(eraState(player(undefined, 12), 'full-v1')).toMatchObject({ index: 8, next: null, phase: 'late' });
  for (const [expectedIndex, era] of ERA_DEFINITIONS['full-v1'].entries()) {
    expect(eraState(player(undefined, era.threshold), 'full-v1')).toMatchObject({ index: expectedIndex, current: era });
  }
  expect(eraState(player(undefined, 3), 'full-v1')?.phase).toBe('middle');
  expect(eraState(player(undefined, 0), undefined)).toBe(null);
});

test('undefined progression and missing leaders leave all doctrine effects inactive', () => {
  expect(doctrineEffects(player('oak', 2), undefined, identity('rattata'), EXPANSION_CONTENT))
    .toEqual({ researchBonus: 0, movementBonus: 0, trainedXpBonus: 0, territoryHealingBonus: 0, fieldHealing: 0, cityDamageBonus: 0 });
  expect(doctrineEffects(player(undefined, 0), 'simple-v1', identity('rattata'), EXPANSION_CONTENT))
    .toEqual({ researchBonus: 0, movementBonus: 0, trainedXpBonus: 0, territoryHealingBonus: 0, fieldHealing: 0, cityDamageBonus: 0 });
});

test('leaders have bounded phase windows and match actual roles or either species type', () => {
  for (const [leaderId, phases] of Object.entries(LEADER_DOCTRINES)) {
    for (const definition of Object.values(phases)) {
      expect(definition.movementBonus).toBeLessThanOrEqual(1);
      expect(definition.trainedXpBonus).toBeLessThanOrEqual(30);
      expect(definition.fieldHealing).toBeLessThanOrEqual(6);
    }
    expect(new Set(['early', 'middle', 'late'])).toEqual(new Set(Object.keys(phases)));
    expect(leaderId).toBeTruthy();
  }

  expect(doctrineEffects(player('oak', 0), 'simple-v1', identity('rattata'), EXPANSION_CONTENT))
    .toMatchObject({ researchBonus: 1, movementBonus: 1 });
  expect(doctrineEffects(player('oak', 0), 'simple-v1', undefined, EXPANSION_CONTENT)).toMatchObject({ researchBonus: 1, movementBonus: 0 });
  expect(doctrineEffects(player('oak', 3), 'simple-v1', identity('bulbasaur'), EXPANSION_CONTENT))
    .toMatchObject({ trainedXpBonus: 15 });
  expect(doctrineEffects(player('lance', 3), 'simple-v1', identity('dratini'), EXPANSION_CONTENT))
    .toMatchObject({ movementBonus: 1, trainedXpBonus: 15 });
  expect(doctrineEffects(player('lance', 3), 'simple-v1', identity('charizard'), EXPANSION_CONTENT))
    .toMatchObject({ movementBonus: 1 });
  expect(doctrineEffects(player('jenny', 0), 'simple-v1', identity('machop'), EXPANSION_CONTENT))
    .toMatchObject({ trainedXpBonus: 10, territoryHealingBonus: 2 });
  expect(doctrineEffects(player('joy', 3), 'simple-v1', identity('squirtle'), EXPANSION_CONTENT))
    .toMatchObject({ fieldHealing: 4 });
  expect(doctrineEffects(player('joy', 3), 'simple-v1', identity('charmander'), EXPANSION_CONTENT).fieldHealing).toBe(0);
  expect(doctrineEffects(player('joy', 7), 'simple-v1', identity('bulbasaur'), EXPANSION_CONTENT).fieldHealing).toBe(6);
});

test('era panel uses own player progress and actual expansion examples', () => {
  const compact = renderEraPanel(view('joy', 4, 'simple-v1'));
  expect(compact).toContain('金银时代');
  expect(compact).not.toContain('Doctrine');
  expect(compact).toContain('还需 3 项科技');
  expect(compact).toContain('野外恢复 +4');
  expect(compact).toContain('杰尼龟');
  expect(renderEraPanel(view('oak', 0, undefined))).toBe('');
  expect(renderEraPanel(view(undefined, 0, 'simple-v1'))).toContain('此局未选择领袖');
  expect(renderEraPanel(view('oak', 0, 'simple-v1'))).toContain('<dt>每座城市</dt><dd>科研 +1</dd><dt>侦察</dt><dd>移动力 +1</dd>');
});
