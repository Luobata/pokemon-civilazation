import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { deriveRosterTables, drawRegionalDex, evolutionLines, dexMaxGeneration, unmetConstraints, REGIONAL_DEX_RULES } from '../../src/content/regional-dex.ts';
import type { RegionalDexDraw } from '../../src/content/regional-dex.ts';
import { RECRUIT_SLOTS } from '../../src/content/recruit-slots.ts';
import { SPECIES_TAGS } from '../../src/content/species-tags.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import type { LeaderId } from '../../src/content/leaders.ts';

const species = WORLD24_CONTENT.species;
const MODES: readonly EraProgression[] = ['simple-v1', 'full-v1'];
const seated = (seed: number): LeaderId[] => [0, 1, 2, 3].map(index => LEADER_IDS[(seed + index) % LEADER_IDS.length]);
const GOLDEN = new URL('./__golden__/regional-dex-v25.json', import.meta.url);

test.each(MODES)('%s: seeds 1–150 meet every coverage constraint with whole lines, anchors and regional recruits', mode => {
  const lines = evolutionLines(species, dexMaxGeneration(mode));
  for (let seed = 1; seed <= 150; seed++) {
    const leaders = seated(seed), draw = drawRegionalDex({ species, mode, dexSeed: seed, leaders });
    const dex = new Set(draw.speciesIds);
    expect(draw.unmet, `seed ${seed}`).toEqual([]);
    expect(draw.size).toBe(draw.speciesIds.length);
    for (const line of lines) expect(line.speciesIds.every(id => dex.has(id)) || line.speciesIds.every(id => !dex.has(id)), `${mode} ${seed} ${line.id}`).toBe(true);
    for (const anchor of ['bulbasaur', 'charmander', 'squirtle', 'pikachu'] as SpeciesId[]) expect(dex.has(anchor)).toBe(true);
    const tables = deriveRosterTables(species, draw.speciesIds, mode);
    for (const leader of leaders) expect(dex.has(tables.leaderUnits[leader]!), `${seed} ${leader}`).toBe(true);
    for (const item of tables.recruitSlots) if (item.speciesId) expect(dex.has(item.speciesId)).toBe(true);
    for (const slot of RECRUIT_SLOTS.filter(slot => slot.core && (slot.generation ?? 0) <= dexMaxGeneration(mode))) {
      expect(tables.recruitSlots.find(item => item.slot === slot.id)?.speciesId, `${mode} ${seed} ${slot.id}`).toBeTruthy();
    }
    for (const [biome, weights] of Object.entries(tables.spawnWeights)) {
      expect(Object.keys(weights).every(id => dex.has(id as SpeciesId))).toBe(true);
      expect(Object.keys(weights).filter(id => (species[id].generation ?? 1) === 1 && species[id].terrain.includes(biome as never)).length, `${seed} ${biome}`)
        .toBeGreaterThanOrEqual(REGIONAL_DEX_RULES.biomeSpawns);
    }
    expect(draw.speciesIds.filter(id => species[id].rare).length).toBeGreaterThanOrEqual(REGIONAL_DEX_RULES.rareMin);
  }
}, 120_000);

test('the draw is a pure function of its public inputs (no game state, stable across calls and leader order)', () => {
  const input = { species, mode: 'simple-v1' as const, dexSeed: 77, leaders: ['misty', 'brock'] as LeaderId[] };
  const first = drawRegionalDex(input), again = drawRegionalDex({ ...input, leaders: ['brock', 'misty'] });
  expect(again).toEqual(first);
  expect(drawRegionalDex({ ...input, dexSeed: 78 }).speciesIds).not.toEqual(first.speciesIds);
  expect(unmetConstraints(species, first.speciesIds, 'simple-v1')).toEqual([]);
  // Removing a starter line breaks nothing structural, but dropping every naval line breaks C9.
  expect(unmetConstraints(species, first.speciesIds.filter(id => species[id].role !== 'naval'), 'simple-v1')).toContain('C9:naval');
});

test('tags cover the regional pool: every regional species has a tag row', () => {
  for (const mode of MODES) for (const line of evolutionLines(species, dexMaxGeneration(mode))) for (const id of line.speciesIds) expect(SPECIES_TAGS[id], id).toBeDefined();
});

/** Golden draws: a change here changes existing v25 saves and must ship as a new gameplay version (roster-v25 §4.1). */
function golden(): Record<string, Pick<RegionalDexDraw, 'speciesIds'> & { lines: string[]; recruits: string[] }> {
  const out: Record<string, Pick<RegionalDexDraw, 'speciesIds'> & { lines: string[]; recruits: string[] }> = {};
  for (const mode of MODES) for (let seed = 31; seed <= 38; seed++) for (const leaders of [seated(seed), ['oak', 'misty'] as LeaderId[]]) {
    const draw = drawRegionalDex({ species, mode, dexSeed: seed, leaders });
    out[`${mode}:${seed}:${leaders.join(',')}`] = { speciesIds: draw.speciesIds, lines: draw.lines.map(line => `${line.id}:${line.source}`),
      recruits: deriveRosterTables(species, draw.speciesIds, mode).recruitSlots.map(item => `${item.slot}:${item.speciesId ?? '-'}:${item.level}`) };
  }
  return out;
}
test('golden regional Pokédexes (seeds 31–38, both modes, two leader sets)', () => {
  const actual = golden();
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
  expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
}, 60_000);
