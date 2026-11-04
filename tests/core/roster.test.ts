import { expect, test } from 'vitest';
import { CONTENT, EXPANSION_CONTENT, ROSTER_CONTENT, contentFor, contentForView } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { TECHS } from '../../src/content/economy.ts';
import type { TechId } from '../../src/content/economy.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { isNight } from '../../src/content/era-abilities.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { typeCounterBonus } from '../../src/ai/roster-plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { deserializeSave, serializeSave } from '../../src/app/save.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { evolutionOptions, maxGeneration, playerGeneration } from '../../src/core/roster.ts';
import { trainableSpeciesIds } from '../../src/core/role-tactics.ts';
import { spawnWild } from '../../src/core/wild.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion, eraProgression: 'simple-v1' | 'full-v1' = 'simple-v1'): GameSetup => ({ seed: 12345, width: 24, height: 16,
  expansionVersion: 1, multiplayer: true, eraProgression, gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'jasmine' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'giovanni' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
const techs = (count: number) => Object.keys(TECHS).slice(0, count) as TechId[];
/** A v14 state with one of player 0's Pokémon at (9,6) on open terrain, ready to evolve. */
function evolver(speciesId: SpeciesId, techCount: number, mode: 'simple-v1' | 'full-v1' = 'full-v1'): GameState {
  const state = createGame(duel(14, mode));
  state.map.tiles.fill('grassland'); state.units = {};
  state.players[0].research.unlockedIds = [...techs(techCount), 'training'];
  state.players[0].gold = 500;
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId }, 9000, 0, { q: 9, r: 6 }, ROSTER_CONTENT, 400, 1);
  refreshKnowledge(state);
  return state;
}
const evolves = (state: GameState, into: SpeciesId) => act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: into }).ok;

test('content is chosen per version: v≤13 keep the frozen 47 species, v14 adds the roster', () => {
  expect(Object.keys(EXPANSION_CONTENT.species)).toHaveLength(47);
  expect(EXPANSION_CONTENT.roster).toBeUndefined();
  expect(Object.keys(ROSTER_CONTENT.species)).toHaveLength(105);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 13 })).toBe(EXPANSION_CONTENT);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 14 })).toBe(ROSTER_CONTENT);
  expect(contentFor({})).toBe(CONTENT);
  expect(contentForView({ expansion: {}, gameplayVersion: 14 })).toBe(ROSTER_CONTENT);
  const state = createGame(duel(14));
  expect(state.contentVersion).toBe('roster-v14');
  expect(gameVersions(state.setup)).toEqual({ schemaVersion: 9, rulesVersion: 'roster-v14' });
  expect(Object.keys(state.expansion!.world.players[0].pokedex)).toHaveLength(105);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands: [] };
  expect(deserializeSave(serializeSave(state, log)).state.contentVersion).toBe('roster-v14');
  expect(Object.keys(createGame(duel(13)).expansion!.world.players[0].pokedex)).toHaveLength(47);
});

test('evolution follows the player’s own generation; Eevee branches by day, night, terrain and generation', () => {
  // Onix → Steelix (generation 2): locked in generation 1, open once the player reaches generation 2.
  // Simple eras: one technology (特训法) is still generation 1; four reach generation 2.
  expect(evolves(evolver('onix', 0, 'simple-v1'), 'steelix')).toBe(false);
  const reached = evolver('onix', 3, 'simple-v1');
  expect(playerGeneration(reached.players[0], 'simple-v1')).toBe(2);
  expect(evolves(reached, 'steelix')).toBe(true);
  expect(evolutionOptions(ROSTER_CONTENT, 'eevee').map(option => option.speciesId)).toEqual(['espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon']);
  const eevee = (round: number, biome: 'grassland' | 'forest' | 'snow', techCount: number) => {
    const state = evolver('eevee', techCount); state.round = round; state.map.tiles.fill(biome); refreshKnowledge(state); return state;
  };
  const day = [1, 2, 3, 4, 5].find(round => !isNight(round))!, night = [1, 2, 3, 4, 5].find(round => isNight(round))!;
  expect(evolves(eevee(day, 'grassland', 4), 'espeon')).toBe(true);
  expect(evolves(eevee(night, 'grassland', 4), 'espeon')).toBe(false);
  expect(evolves(eevee(night, 'grassland', 4), 'umbreon')).toBe(true);
  expect(evolves(eevee(day, 'forest', 1), 'leafeon')).toBe(false); // generation 4 needed
  expect(evolves(eevee(day, 'forest', 12), 'leafeon')).toBe(true);
  expect(evolves(eevee(day, 'grassland', 12), 'leafeon')).toBe(false); // wrong terrain
  // Simple eras stop at generation 3, so generation-4 forms never unlock there.
  expect(maxGeneration('simple-v1')).toBe(3);
  expect(evolves(evolver('magneton', 12, 'simple-v1'), 'magnezone')).toBe(false);
  // v13 is untouched: Onix has no evolution there.
  const legacy = createGame(duel(13)); legacy.units = {};
  legacy.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'onix' }, 9000, 0, { q: 9, r: 6 }, EXPANSION_CONTENT, 400, 1);
  expect(act(legacy, { type: 'Evolve', unitId: 9000, intoSpeciesId: 'steelix' }).ok).toBe(false);
});

test('generation recruits, new tech recruits and the upgraded leader units', () => {
  const player = { registeredSpeciesIds: [] as SpeciesId[], research: { unlockedIds: [] as TechId[] } };
  expect(trainableSpeciesIds(player, 14, ROSTER_CONTENT, 'full-v1')).not.toContain('sneasel');
  player.research.unlockedIds = techs(2);
  expect(playerGeneration(player, 'full-v1')).toBeGreaterThanOrEqual(2);
  expect(trainableSpeciesIds(player, 14, ROSTER_CONTENT, 'full-v1')).toContain('sneasel');
  expect(trainableSpeciesIds({ ...player, research: { unlockedIds: ['typeResearch'] } }, 14, ROSTER_CONTENT, 'simple-v1')).toContain('magnemite');
  expect(trainableSpeciesIds({ ...player, research: { unlockedIds: ['typeResearch'] } }, 13, EXPANSION_CONTENT, 'simple-v1')).not.toContain('magnemite');
  const state = createGame(duel(14));
  state.players[0].gold = 500; state.players[0].research.unlockedIds = [...state.players[0].research.unlockedIds, 'training'];
  const recruited = act(state, { type: 'RecruitLeaderUnit', cityId: state.players[0].headquartersCityId });
  expect(recruited.ok).toBe(true);
  if (!recruited.ok) return;
  const unit = Object.values(recruited.state.units).find(candidate => candidate.kind === 'pokemon' && candidate.uniqueLeader === 'jasmine');
  expect(unit && unit.kind === 'pokemon' ? unit.speciesId : null).toBe('magneton');
});

test('wild spawns only draw species of the nearest civilization’s generation', () => {
  const later = new Set((Object.keys(ROSTER_CONTENT.species) as SpeciesId[]).filter(id => (ROSTER_CONTENT.species[id].generation ?? 1) > 1));
  const spawned = (generationTechs: number) => {
    const state = createGame(duel(14, 'full-v1'));
    for (const player of Object.values(state.players)) player.research.unlockedIds = techs(generationTechs);
    const species = new Set<string>();
    for (let round = 0; round < 60; round++) {
      for (const id of Object.keys(state.units)) if (state.units[Number(id)].ownerId === null) delete state.units[Number(id)];
      spawnWild(state, true);
      for (const unit of Object.values(state.units)) if (unit.ownerId === null && unit.kind === 'pokemon') species.add(unit.speciesId);
    }
    return species;
  };
  expect([...spawned(0)].filter(id => later.has(id as SpeciesId))).toEqual([]);
  expect([...spawned(12)].some(id => later.has(id as SpeciesId))).toBe(true);
});

test('the AI favours species that hit visible enemies super-effectively (v14 only)', () => {
  const state = createGame(duel(14));
  state.diplomacy[0].status = 'war';
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'squirtle' }, 9001, 1, state.cities[state.players[0].headquartersCityId].position, ROSTER_CONTENT);
  state.units[9001].position = { ...state.cities[state.players[0].headquartersCityId].position, q: state.cities[state.players[0].headquartersCityId].position.q + 1 };
  refreshKnowledge(state);
  const view = observe(state, 0);
  expect(typeCounterBonus(view, 'magnemite', ROSTER_CONTENT)).toBeGreaterThan(0); // electric hits water
  expect(typeCounterBonus(view, 'geodude', ROSTER_CONTENT)).toBeLessThan(0); // water hits rock/ground ×4
  expect(typeCounterBonus(view, 'magnemite', EXPANSION_CONTENT)).toBe(0);
});

test('a real v14 AI game uses roster species and replays exactly', () => {
  const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'full-v1', gameplayVersion: 14, players: [
    { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'jasmine' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'giovanni' },
    { id: 2, controller: 'ai', personality: 'conservative', leaderId: 'oak' }] };
  let state = createGame(setup);
  const commands: Command[] = [], memory: RejectedCitySite[] = [], seen = new Set<string>();
  while (!state.outcome && state.round < 70) {
    const view = observe(state, state.activePlayerId);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command);
    }
    if (!result.ok) throw new Error(result.reason);
    state = result.state; commands.push(command);
    for (const unit of Object.values(state.units)) if (unit.ownerId !== null && unit.kind === 'pokemon') seen.add(unit.speciesId);
  }
  expect([...seen].filter(id => ROSTER_CONTENT.species[id as SpeciesId].generation !== undefined).length).toBeGreaterThan(2);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(9);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);
