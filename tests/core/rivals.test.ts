import { describe, expect, test } from 'vitest';
import { RIVAL_COUNTERS, RIVAL_RULES_V24 } from '../../src/content/rivals.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameState, MapUnit, VisibleEvent } from '../../src/core/model.ts';
import { previewAttack, previewCapture } from '../../src/core/preview.ts';
import { resolveRivalRound, rivalSpirit, spiritFor } from '../../src/core/rivals.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, projectEvents, refreshKnowledge } from '../../src/core/vision.ts';

const content = WORLD24_CONTENT;
const setup = (gameplayVersion: 23 | 24) => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const }, { id: 2, controller: 'ai' as const },
  ] });
/** Ends every player's turn until `round` begins; returns the state and the projected events per player. */
function playTo(state: GameState, round: number) {
  const seen: Record<number, VisibleEvent[]> = { 0: [], 1: [], 2: [] };
  while (state.round < round && !state.outcome) {
    const command: Command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action: { type: 'EndTurn' } };
    const result = step(state, command, content);
    if (!result.ok) throw new Error(result.reason);
    for (const id of state.turnOrder) seen[id].push(...projectEvents(state, result.state, result.events, id, content));
    state = result.state;
  }
  return { state, seen };
}
const rivalUnits = (state: GameState, target: number) => state.expansion!.rivals!.byPlayer[target].activeUnitIds.map(id => state.units[id] as MapUnit);

describe('v24 C rival trainers', () => {
  test('warning two rounds ahead, seen only by its target; arrival at round 8 with counters to the starter', () => {
    const start = createGame(setup(24));
    expect(createGame(setup(23)).expansion!.rivals).toBeUndefined();
    const names = Object.values(start.expansion!.rivals!.byPlayer).map(ledger => ledger.name);
    expect(new Set(names).size).toBe(names.length);
    const { state: warned, seen } = playTo(start, RIVAL_RULES_V24.arrivals[0] - RIVAL_RULES_V24.warningRounds);
    for (const id of warned.turnOrder) {
      const view = observe(warned, id, content).expansion!.rivals!;
      expect(view.pending?.round).toBe(RIVAL_RULES_V24.arrivals[0]);
      expect(view.pending?.cityId).toBe(warned.players[id].headquartersCityId);
      const city = warned.cities[view.pending!.cityId];
      const distance = hexDistance(city.position, indexToHex(view.pending!.tileIndex, warned.map), warned.map);
      expect(distance).toBeGreaterThanOrEqual(RIVAL_RULES_V24.spawnDistance[0]);
      expect(distance).toBeLessThanOrEqual(RIVAL_RULES_V24.spawnDistance[1]);
      // Fog: the warning reaches only its target.
      expect(seen[id].filter(event => event.payload.type === 'RivalAnnounced').map(event => 'playerId' in event.payload && event.payload.playerId)).toEqual([id]);
    }
    const { state: arrived } = playTo(warned, RIVAL_RULES_V24.arrivals[0]);
    for (const id of arrived.turnOrder) {
      const units = rivalUnits(arrived, id);
      expect(units).toHaveLength(1);
      const unit = units[0] as Extract<MapUnit, { kind: 'pokemon' }>;
      expect(unit.ownerId).toBeNull();
      expect(RIVAL_COUNTERS[arrived.players[id].starterId].primary).toContain(unit.speciesId);
      expect(content.species[unit.speciesId].stage).toBe(1);
      expect(Math.abs(rivalSpirit(arrived, unit.id))).toBeLessThanOrEqual(RIVAL_RULES_V24.strengthCap);
    }
  });

  test('劲敌气势 = clamp(second-strongest attack + offset − species attack, ±12)', () => {
    const state = createGame(setup(24));
    const attacks = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === 0 && unit.kind === 'pokemon')
      .map(unit => content.species[(unit as Extract<MapUnit, { kind: 'pokemon' }>).speciesId].attack).sort((a, b) => b - a);
    const strength = attacks[1] ?? attacks[0];
    expect(spiritFor(state, 0, 0, 'charmander', content)).toBe(Math.max(-12, Math.min(12, strength - 6 - content.species.charmander.attack)));
    expect(spiritFor(state, 0, 2, 'caterpie', content)).toBeLessThanOrEqual(12);
  });

  test('rivals strike their target’s Pokémon and cities (never below 1 HP), never logistics units, and leave after six rounds', () => {
    let { state } = playTo(createGame(setup(24)), RIVAL_RULES_V24.arrivals[0]);
    const rival = rivalUnits(state, 0)[0];
    // Only a settler next to the rival, the capital in reach: the rival ignores the settler and strikes the city, never below 1 HP.
    for (const unit of Object.values(state.units)) if (isMapUnit(unit) && unit.ownerId === 0 && unit.kind === 'pokemon') delete state.units[unit.id];
    const capital = state.cities[state.players[0].headquartersCityId];
    const spot = neighbors(capital.position, state.map).find(hex => { const index = hexToIndex(hex, state.map);
      return index !== null && state.map.tiles[index] !== 'ocean' && !Object.values(state.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, state.map) === 0); })!;
    rival.position = { ...spot };
    const settler = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics') as MapUnit;
    const next = neighbors(spot, state.map).find(hex => { const index = hexToIndex(hex, state.map);
      return index !== null && state.map.tiles[index] !== 'ocean' && hexDistance(hex, capital.position, state.map) > 0 && !Object.values(state.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, state.map) === 0); })!;
    settler.position = { ...next };
    capital.hp = 3;
    for (let round = 0; round < 3; round++) resolveRivalRound(state, content);
    expect(capital.hp).toBe(1);
    expect(state.units[settler.id]).toBeDefined();
    ({ state } = playTo(state, RIVAL_RULES_V24.arrivals[0] + RIVAL_RULES_V24.staysRounds));
    expect(state.units[rival.id]).toBeUndefined();
    expect(state.expansion!.rivals!.byPlayer[0].outcomes).toEqual(['departed']);
  });

  test('cannot be captured; the attack preview shows 劲敌气势 and matches the authority; knocking out a visit pays the reward', () => {
    let { state } = playTo(createGame(setup(24)), RIVAL_RULES_V24.arrivals[0]);
    const rival = rivalUnits(state, 0)[0];
    state.expansion!.rivals!.spirit[rival.id] = 7;
    const spot = neighbors(rival.position, state.map).find(hex => { const index = hexToIndex(hex, state.map);
      return index !== null && state.map.tiles[index] !== 'ocean' && !Object.values(state.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, state.map) === 0)
        && !Object.values(state.cities).some(city => hexDistance(city.position, hex, state.map) === 0); })!;
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId: 'machamp' }, id, 0, spot, content, 0, 1);
    state.players[0].research.unlockedIds.push('domestication');
    state.players[0].ballInventory.pokeBall = 3;
    refreshKnowledge(state, content);
    const view = observe(state, 0, content);
    expect(view.expansion!.rivals!.sightings.find(item => item.unitId === rival.id)).toMatchObject({ targetPlayerId: 0, spirit: 7 });
    expect(previewCapture(view, id, rival.id, 'pokeBall', content)).toEqual({ ok: false, reason: 'capture-rival' });
    expect(step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Capture', unitId: id, targetUnitId: rival.id, ballId: 'pokeBall' } }, content))
      .toEqual({ ok: false, reason: 'capture-rival' });
    const preview = previewAttack(view, id, { kind: 'unit', id: rival.id }, content);
    expect(preview.ok && preview.strength?.factors).toContainEqual({ side: 'defense', label: '劲敌气势', value: 7 });
    // Another civilization sees the same rival Pokémon (it is a physical unit) but no warning of ours.
    rival.hp = 1;
    const gold = state.players[0].gold, balls = state.players[0].ballInventory.pokeBall;
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Attack', unitId: id, target: { kind: 'unit', id: rival.id } } }, content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(result.events.map(event => event.payload).find(payload => payload.type === 'RivalDefeated')).toMatchObject({ playerId: 0, encounter: 1, gold: 25, pokeBalls: 2, xpUnitIds: [] });
    // +25 for the rival (other systems may add their own gold in the same command, e.g. an opening objective).
    expect(state.players[0].gold).toBeGreaterThanOrEqual(gold + 25);
    expect(state.players[0].ballInventory.pokeBall).toBe(balls + 2);
    expect(state.expansion!.rivals!.byPlayer[0].outcomes).toEqual(['defeated']);
    expect(state.expansion!.eraHonors!.players[0].byMilestone.rivalDefeated).toBe(1);
  });
});
