import { expect, test } from 'vitest';
import { GAME_CONTENT, contentFor, contentForView } from '../../src/content/units.ts';
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
  const state = createGame(duel(27, mode));
  state.map.tiles.fill('grassland'); state.units = {};
  state.players[0].research.unlockedIds = [...techs(techCount), 'training'];
  state.players[0].gold = 500;
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId }, 9000, 0, { q: 9, r: 6 }, GAME_CONTENT, 400, 1);
  refreshKnowledge(state);
  return state;
}
const evolves = (state: GameState, into: SpeciesId) => act(state, { type: 'Evolve', unitId: 9000, intoSpeciesId: into }).ok;

test('v27 uses the full 115-species pool and unified envelope', () => {
  expect(Object.keys(GAME_CONTENT.species)).toHaveLength(115);
  expect(GAME_CONTENT.roster).toBeDefined();
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 27 })).toBe(GAME_CONTENT);
  expect(contentFor({})).toBe(GAME_CONTENT);
  expect(contentForView({})).toBe(GAME_CONTENT);
  const state = createGame(duel(27));
  expect(state.contentVersion).toBe('pace-v27');
  expect(gameVersions(state.setup)).toEqual({ schemaVersion: 22, rulesVersion: 'pace-v27' });
  expect(Object.keys(state.expansion!.world.players[0].pokedex)).toHaveLength(115);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands: [] };
  expect(deserializeSave(serializeSave(state, log)).state.contentVersion).toBe('pace-v27');
});

test('evolution follows the player’s own generation; Eevee branches by day, night, terrain and generation', () => {
  // Onix → Steelix (generation 2): locked in generation 1, open once the player reaches generation 2.
  // Simple eras on the 30-tech tree: 1 tech (特训法) is generation 1; 7 techs reach generation 2.
  expect(evolves(evolver('onix', 0, 'simple-v1'), 'steelix')).toBe(false);
  const reached = evolver('onix', 6, 'simple-v1');
  expect(playerGeneration(reached.players[0], 'simple-v1')).toBe(2);
  expect(evolves(reached, 'steelix')).toBe(true);
  expect(evolutionOptions(GAME_CONTENT, 'eevee').map(option => option.speciesId)).toEqual(['espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon']);
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
});

test('generation recruits, new tech recruits and the upgraded leader units', () => {
  const player = { registeredSpeciesIds: [] as SpeciesId[], research: { unlockedIds: [] as TechId[] } };
  expect(trainableSpeciesIds(player, 27, GAME_CONTENT, 'full-v1')).not.toContain('sneasel');
  player.research.unlockedIds = techs(2);
  expect(playerGeneration(player, 'full-v1')).toBeGreaterThanOrEqual(2);
  expect(trainableSpeciesIds(player, 27, GAME_CONTENT, 'full-v1')).toContain('sneasel');
  expect(trainableSpeciesIds({ ...player, research: { unlockedIds: ['typeResearch'] } }, 27, GAME_CONTENT, 'simple-v1')).toContain('magnemite');
  const state = createGame(duel(27));
  state.players[0].gold = 500; state.players[0].research.unlockedIds = [...state.players[0].research.unlockedIds, 'training'];
  const recruited = act(state, { type: 'RecruitLeaderUnit', cityId: state.players[0].headquartersCityId });
  expect(recruited.ok).toBe(true);
  if (!recruited.ok) return;
  const unit = Object.values(recruited.state.units).find(candidate => candidate.kind === 'pokemon' && candidate.uniqueLeader === 'jasmine');
  expect(unit && unit.kind === 'pokemon' ? unit.speciesId : null).toBe('magneton');
});

test('wild spawns only draw species of the nearest civilization’s generation', () => {
  const later = new Set((Object.keys(GAME_CONTENT.species) as SpeciesId[]).filter(id => (GAME_CONTENT.species[id].generation ?? 1) > 1));
  const spawned = (generationTechs: number) => {
    const state = createGame(duel(27, 'full-v1'));
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
  const state = createGame(duel(27));
  state.diplomacy[0].status = 'war';
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'squirtle' }, 9001, 1, state.cities[state.players[0].headquartersCityId].position, GAME_CONTENT);
  state.units[9001].position = { ...state.cities[state.players[0].headquartersCityId].position, q: state.cities[state.players[0].headquartersCityId].position.q + 1 };
  refreshKnowledge(state);
  const view = observe(state, 0);
  expect(typeCounterBonus(view, 'magnemite', GAME_CONTENT)).toBeGreaterThan(0); // electric hits water
  expect(typeCounterBonus(view, 'geodude', GAME_CONTENT)).toBeLessThan(0); // water hits rock/ground ×4
});

test('a real v27 AI game uses roster species and replays exactly', () => {
  const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'full-v1', gameplayVersion: 27, players: [
    { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'jasmine' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'giovanni' },
    { id: 2, controller: 'ai', personality: 'conservative', leaderId: 'oak' }] };
  let state = createGame(setup);
  const commands: Command[] = [], memory: RejectedCitySite[] = [], seen = new Set<string>();
  while (!state.outcome && state.round < 70) {
    const view = observe(state, state.activePlayerId);
    let command = planNext(view, { ...RULE_QUERIES, content: GAME_CONTENT }, memory);
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
  expect([...seen].filter(id => GAME_CONTENT.species[id as SpeciesId].generation !== undefined).length).toBeGreaterThan(2);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(22);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);
