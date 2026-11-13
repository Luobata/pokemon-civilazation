import { expect, test } from 'vitest';
import { SPECIES_TAGS } from '../../src/content/species-tags.ts';
import { RECRUIT_SLOTS } from '../../src/content/recruit-slots.ts';
import { deriveRosterTables, evolutionLines } from '../../src/content/regional-dex.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { GENERATION_RECRUITS_V14, NEST_PRIORITY_V14, NEST_WEIGHTS_V14, SPAWN_WEIGHTS_V14, STONE_EVOLUTIONS_V14_ADDITIONS, WANDERERS_V14 } from '../../src/content/roster-v14-data.ts';
import { TREE_RECRUITS } from '../../src/content/tech-tree.ts';
import { DEEP_WATER_HABITAT_V24, HABITAT_OVERLAYS_V24, LANDMARKS, LANDMARK_IDS } from '../../src/content/terrain.ts';
import { ROLE_POKEMON } from '../../src/content/roles.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import { LEADER_KITS } from '../../src/core/leader-systems.ts';
import { leaderUnitFor } from '../../src/content/roster.ts';
import { BASE_STONE_EVOLUTIONS } from '../../src/content/stone-evolutions.ts';
import { WORLD_DEFINITIONS } from '../../src/content/world-systems.ts';

const species = WORLD24_CONTENT.species, ids = Object.keys(species).sort() as SpeciesId[];
const full = deriveRosterTables(species, ids, 'full-v1');
/** Role Pokémon (src/content/roles.ts): Tauros, Timburr, Kecleon — presentation only, never species. */
const ROLE_SPECIES = ['tauros', 'timburr', 'kecleon'];

test('every species has exactly one tag row; role Pokémon have none', () => {
  expect(Object.keys(SPECIES_TAGS).sort()).toEqual(ids);
  for (const id of ROLE_SPECIES) { expect(SPECIES_TAGS).not.toHaveProperty(id); expect(species).not.toHaveProperty(id); }
  expect(Object.values(ROLE_POKEMON).map(role => role.dex).sort()).toEqual([128, 352, 532]);
  for (const [id, tags] of Object.entries(SPECIES_TAGS)) expect(tags.rarity === 'rare', id).toBe(species[id].rare);
});

test('C10: the base form of every evolution line can be met in the wild', () => {
  for (const line of evolutionLines(species, 9)) {
    const weights = Object.values(SPECIES_TAGS[line.id].habitat ?? {});
    expect(weights.some(weight => weight > 0), line.id).toBe(true);
  }
});

test('recruit slots: first choices exist, carry the slot tag, and are not starters', () => {
  for (const slot of RECRUIT_SLOTS) {
    expect(species[slot.preferred], slot.id).toBeDefined();
    expect(SPECIES_TAGS[slot.preferred].recruit, slot.id).toContain(slot.id);
  }
  const tagged = Object.entries(SPECIES_TAGS).flatMap(([id, tags]) => (tags.recruit ?? []).map(slot => `${slot}:${id}`)).sort();
  expect(tagged).toEqual(RECRUIT_SLOTS.map(slot => `${slot.id}:${slot.preferred}`).sort());
});

test('the full-pool derivation equals the hand-written v14 / v22 / v24 tables (known additions: sneasel snow 8, clefairy mountain 8)', () => {
  const expected = JSON.parse(JSON.stringify(SPAWN_WEIGHTS_V14)) as typeof SPAWN_WEIGHTS_V14;
  expected.snow.sneasel = 8; expected.mountain.clefairy = 8;
  expect(full.spawnWeights).toEqual(expected);
  expect([...full.wanderers].sort()).toEqual([...WANDERERS_V14].sort());
  expect(full.techRecruits).toEqual(TREE_RECRUITS);
  expect(full.generationRecruits).toEqual(GENERATION_RECRUITS_V14);
  expect(full.recruitSlots.every(item => item.level === 1)).toBe(true);
  expect(deriveRosterTables(species, ids, 'simple-v1').generationRecruits).toEqual({ 2: 'sneasel', 3: 'vibrava' });
  for (const leader of LEADER_IDS) expect(full.leaderUnits[leader], leader).toBe(leaderUnitFor(WORLD24_CONTENT, leader, LEADER_KITS[leader].unit));
  expect(full.stoneEvolutions).toEqual(STONE_EVOLUTIONS_V14_ADDITIONS);
  expect(BASE_STONE_EVOLUTIONS).toEqual(WORLD_DEFINITIONS.stoneEvolutions);
  expect([...full.nestPriority].sort()).toEqual([...NEST_PRIORITY_V14].sort());
  expect(full.nestWeights).toEqual(NEST_WEIGHTS_V14);
  expect(full.habitatOverlays).toEqual(HABITAT_OVERLAYS_V24);
  expect(full.deepWater).toEqual({ multiply: DEEP_WATER_HABITAT_V24.multiply, remove: [...DEEP_WATER_HABITAT_V24.remove] });
  for (const landmark of LANDMARK_IDS) expect(full.residents[landmark], landmark).toEqual([...LANDMARKS[landmark].residents].sort());
});

test('role Pokémon never enter a derived table', () => {
  const text = JSON.stringify(full);
  for (const id of ROLE_SPECIES) expect(text.includes(`"${id}"`), id).toBe(false);
});
