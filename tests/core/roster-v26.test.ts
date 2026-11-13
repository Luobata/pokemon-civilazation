import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ROSTER_V26_EVOLUTIONS, ROSTER_V26_SPECIES, ROSTER_V26_TAGS, ROSTER_V26_VERSION } from '../../src/content/roster-v26-data.ts';
import { ROSTER_V26_SPECIES_NAMES, validateSpecies } from '../../src/content/species.ts';
import type { SpeciesDefinition, SpeciesId } from '../../src/content/species.ts';
import { ALL_SPECIES_TAGS, deriveRosterTables, dexConstraintIds, dexMaxGeneration, drawRegionalDex, evolutionLines, unmetConstraints } from '../../src/content/regional-dex.ts';
import type { RegionalDexDraw } from '../../src/content/regional-dex.ts';
import { RECRUIT_SLOTS, resolveRecruits } from '../../src/content/recruit-slots.ts';
import { DEPTH_CONTENT, REGIONAL_CONTENT, STOCK_CONTENTS, WORLD24_CONTENT, contentFor, contentForView, depthContentFor, depthDexDraw, isStockContent,
  regionalContentFor, regionalDexDraw, regionalPoolSize } from '../../src/content/units.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import type { GameSetup } from '../../src/core/model.ts';
import { parseRegionalDexArgs, regionalDexReport } from '../../tools/regional-dex.ts';

const NEW_IDS = Object.keys(ROSTER_V26_SPECIES) as SpeciesId[];
const species = DEPTH_CONTENT.species;
const MODES: readonly EraProgression[] = ['simple-v1', 'full-v1'];
const seated = (seed: number): LeaderId[] => [0, 1, 2, 3].map(index => LEADER_IDS[(seed + index) % LEADER_IDS.length]);
const GOLDEN = new URL('./__golden__/regional-dex-v26.json', import.meta.url);
const setup = (gameplayVersion: 25 | 26, seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });

/** The pre-v20 stats a v20 species stands for (attack / defense = round(x × 0.4) + 15, trainCost = floor(sum / 8)), on the stage budget. */
function legacyEquivalent(definition: SpeciesDefinition): SpeciesDefinition {
  const inverse = (strength: number) => {
    const value = Array.from({ length: 200 }, (_, index) => index + 1).find(raw => Math.round(raw * 0.4) + 15 === strength);
    if (value === undefined) throw new Error(`no pre-v20 value for ${strength}`);
    return value;
  };
  const attack = inverse(definition.attack), defense = inverse(definition.defense);
  const budget = ([[150, 170], [210, 240], [280, 320]] as const)[definition.stage - 1];
  const sum = Math.max(budget[0], definition.trainCost * 8);
  return { ...definition, maxHp: sum - attack - defense, attack, defense };
}

test('the 10 new species: §4.3 stats on the v20 scale, names, dex numbers, and a pre-v20 equivalent on the validateSpecies curves', () => {
  expect(NEW_IDS.sort()).toEqual(Object.keys(ROSTER_V26_SPECIES_NAMES).sort());
  const table: Record<string, [number, 1 | 2 | 3, SpeciesDefinition['role'], string, number, number]> = {
    metapod: [11, 2, 'melee', 'bug', 28, 60], butterfree: [12, 3, 'scout', 'bug/flying', 48, 50],
    weedle: [13, 1, 'scout', 'bug/poison', 36, 33], kakuna: [14, 2, 'melee', 'bug/poison', 30, 58], beedrill: [15, 3, 'fast', 'bug/poison', 55, 45],
    persian: [53, 2, 'fast', 'normal', 49, 42], spearow: [21, 1, 'air', 'normal/flying', 38, 32], fearow: [22, 2, 'air', 'normal/flying', 48, 42],
    doduo: [84, 1, 'fast', 'normal/flying', 41, 34], dodrio: [85, 2, 'fast', 'normal/flying', 52, 41],
  };
  for (const id of NEW_IDS) {
    const definition = ROSTER_V26_SPECIES[id as keyof typeof ROSTER_V26_SPECIES], [dex, stage, role, types, attack, defense] = table[id];
    expect([definition.dex, definition.stage, definition.role, [definition.typeId, definition.secondaryTypeId].filter(Boolean).join('/'), definition.attack, definition.defense], id)
      .toEqual([dex, stage, role, types, attack, defense]);
    expect([definition.maxHp, definition.power, definition.generation, definition.upkeep, definition.range, definition.rare], id).toEqual([100, 10, 1, stage, 1, false]);
    expect(definition.name).toBe(ROSTER_V26_SPECIES_NAMES[id as keyof typeof ROSTER_V26_SPECIES_NAMES]);
    expect(() => validateSpecies({ [id]: legacyEquivalent(definition) }), id).not.toThrow();
    const legacy = legacyEquivalent(definition);
    expect(legacy.maxHp, id).toBeGreaterThanOrEqual(45);
    expect(legacy.maxHp, id).toBeLessThanOrEqual(115);
  }
  // The two existing species keep their v25 numbers (§4.3: 100 / 33 / 37 and 100 / 37 / 34).
  expect([species.caterpie.attack, species.caterpie.defense, species.meowth.attack, species.meowth.defense]).toEqual([33, 37, 37, 34]);
});

test('evolution chains: early lines at 60 / 150 XP without training, the others at 100 / 30', () => {
  const edge = (id: SpeciesId) => species[id].evolution && [species[id].evolution!.speciesId, species[id].evolution!.xp, species[id].evolution!.gold, species[id].evolution!.requiresTraining];
  expect(edge('caterpie')).toEqual(['metapod', 60, 20, false]);
  expect(edge('metapod')).toEqual(['butterfree', 150, 50, false]);
  expect(edge('weedle')).toEqual(['kakuna', 60, 20, false]);
  expect(edge('kakuna')).toEqual(['beedrill', 150, 50, false]);
  expect(edge('meowth')).toEqual(['persian', 100, 30, false]);
  expect(edge('spearow')).toEqual(['fearow', 100, 30, false]);
  expect(edge('doduo')).toEqual(['dodrio', 100, 30, false]);
  for (const id of ['butterfree', 'beedrill', 'persian', 'fearow', 'dodrio'] as SpeciesId[]) expect(species[id].evolution).toBeNull();
  for (const mode of MODES) {
    const lines = evolutionLines(species, dexMaxGeneration(mode));
    for (const ids of [['butterfree', 'caterpie', 'metapod'], ['beedrill', 'kakuna', 'weedle'], ['meowth', 'persian'], ['fearow', 'spearow'], ['dodrio', 'doduo']]) {
      expect(lines.find(line => line.id === ids.find(id => species[id].stage === 1))?.speciesIds).toEqual(ids);
    }
  }
  // Tagged wild habitats are spawn biomes, as in v25; metapod and kakuna never spawn.
  expect(species.spearow.spawnBiomes).toEqual(['grassland', 'desert']);
  expect(species.weedle.spawnBiomes).toEqual(['grassland', 'forest']);
  expect(species.metapod.spawnBiomes).toEqual([]);
  expect(Object.keys(ROSTER_V26_EVOLUTIONS).sort()).toEqual(['caterpie', 'meowth']);
});

test('v<=25 contents are unchanged: no new species, no new evolutions, the same pool sizes and recruit first choices', () => {
  for (const content of STOCK_CONTENTS.filter(content => content !== DEPTH_CONTENT)) {
    for (const id of NEW_IDS) expect(content.species[id], `${content.version} ${id}`).toBeUndefined();
    if (content.species.caterpie) expect(content.species.caterpie.evolution).toBeNull();
    if (content.species.meowth) expect(content.species.meowth.evolution).toBeNull();
  }
  expect(regionalContentFor(setup(25)).regionalDex!.speciesIds.some(id => NEW_IDS.includes(id))).toBe(false);
  expect([regionalPoolSize('simple-v1'), regionalPoolSize('full-v1')]).toEqual([71, 105]);
  expect(regionalContentFor(setup(25)).version).toBe('roster-v25');
  // v25 pools do not define spearow / doduo, so pidgey and ponyta stay level-1 first choices.
  const v25 = resolveRecruits(REGIONAL_CONTENT.species, Object.keys(REGIONAL_CONTENT.species) as SpeciesId[], 3, new Set());
  expect(v25.find(item => item.slot === 'aviation')).toEqual({ slot: 'aviation', speciesId: 'pidgey', level: 1 });
  expect(v25.find(item => item.slot === 'riding')).toEqual({ slot: 'riding', speciesId: 'ponyta', level: 1 });
  expect(WORLD24_CONTENT.species.caterpie.evolution).toBeNull();
});

test('v26 recruit slots: spearow first for flight training (pidgey its fallback), doduo the riding fallback', () => {
  const all = Object.keys(species) as SpeciesId[], resolve = (ids: SpeciesId[]) => resolveRecruits(species, ids, 3, new Set());
  const slot = (ids: SpeciesId[], id: string) => resolve(ids).find(item => item.slot === id);
  expect(slot(all, 'aviation')).toEqual({ slot: 'aviation', speciesId: 'spearow', level: 1 });
  expect(slot(all.filter(id => id !== 'spearow' && id !== 'fearow'), 'aviation')).toEqual({ slot: 'aviation', speciesId: 'pidgey', level: 2 });
  // Without spearow, pidgey stays reserved for flight training: field observation (resolved earlier) does not take it when zubat is missing.
  const noSpearowNoZubat = all.filter(id => !['spearow', 'fearow', 'zubat', 'golbat', 'crobat'].includes(id));
  expect(slot(noSpearowNoZubat, 'aviation')).toEqual({ slot: 'aviation', speciesId: 'pidgey', level: 2 });
  expect(slot(noSpearowNoZubat, 'fieldObservation')!.speciesId).not.toBe('pidgey');
  expect(slot(all, 'riding')).toEqual({ slot: 'riding', speciesId: 'ponyta', level: 1 });
  expect(slot(all.filter(id => id !== 'ponyta' && id !== 'rapidash'), 'riding')).toEqual({ slot: 'riding', speciesId: 'doduo', level: 2 });
  expect(RECRUIT_SLOTS.find(item => item.id === 'aviation')).toMatchObject({ preferred: 'pidgey', upgrade: 'spearow' });
  expect(ALL_SPECIES_TAGS.spearow.recruit).toEqual(['aviation']);
  for (const id of NEW_IDS) expect(ALL_SPECIES_TAGS[id]).toEqual(ROSTER_V26_TAGS[id as keyof typeof ROSTER_V26_TAGS]);
});

test.each(MODES)('%s: the batch makes no class × stage cell required (v26 C1 / C2 = v25 C1 / C2)', mode => {
  const cells = (table: typeof species) => dexConstraintIds(table, mode).filter(id => id.startsWith('C1:') || id.startsWith('C2:'));
  expect(cells(species)).toEqual(cells(REGIONAL_CONTENT.species));
  expect(cells(species)).not.toContain('C2:scout:3');
  expect(cells(species)).not.toContain('C2:air:1');
});

test.each(MODES)('%s v26 draw: seeds 1–100 meet every constraint with whole lines; the new lines are drawn; the draw is deterministic', mode => {
  const lines = evolutionLines(species, dexMaxGeneration(mode)), drawn = new Map<string, number>();
  for (let seed = 1; seed <= 100; seed++) {
    const draw = drawRegionalDex({ species, mode, dexSeed: seed, leaders: seated(seed) }), dex = new Set(draw.speciesIds);
    expect(draw.unmet, `seed ${seed}`).toEqual([]);
    for (const line of lines) expect(line.speciesIds.every(id => dex.has(id)) || line.speciesIds.every(id => !dex.has(id)), `${mode} ${seed} ${line.id}`).toBe(true);
    for (const line of draw.lines) drawn.set(line.id, (drawn.get(line.id) ?? 0) + 1);
    const tables = deriveRosterTables(species, draw.speciesIds, mode);
    for (const item of tables.recruitSlots) if (item.speciesId) expect(dex.has(item.speciesId)).toBe(true);
    if (dex.has('spearow')) expect(tables.recruitSlots.find(item => item.slot === 'aviation')!.speciesId).toBe('spearow');
  }
  // The batch's cells (scout 3, air 1, fast 3 in simple mode) are optional, so every new line enters by the normal draw: sometimes, never always.
  for (const line of ['caterpie', 'weedle', 'meowth', 'spearow', 'doduo']) {
    expect(drawn.get(line) ?? 0, `${mode} ${line}`).toBeGreaterThan(0);
    expect(drawn.get(line) ?? 0, `${mode} ${line}`).toBeLessThan(100);
  }
  const input = { seed: 77, eraProgression: mode, players: [{ leaderId: 'misty' as LeaderId }, { leaderId: 'brock' as LeaderId }] };
  expect(depthDexDraw(input)).toBe(depthDexDraw({ ...input, players: [...input.players].reverse() }));
  expect(drawRegionalDex({ species, mode, dexSeed: 77, leaders: ['brock', 'misty'] })).toEqual(depthDexDraw(input));
  expect(regionalDexDraw({ ...input, gameplayVersion: 26 })).toBe(depthDexDraw(input));
  expect(unmetConstraints(species, depthDexDraw(input).speciesIds, mode)).toEqual([]);
}, 120_000);

test('a v26 game draws from the v26 species; authority and view share one content object', () => {
  const content = contentFor(setup(26)), v25 = regionalContentFor(setup(25));
  expect(content).toBe(depthContentFor(setup(26)));
  expect(content.version).toBe('depth-v26');
  expect(DEPTH_CONTENT.species).toBe(content.species);
  expect(content.regionalDex!.pool).toBe(regionalPoolSize('simple-v1') + 10);
  expect(content.regionalDex!.speciesIds).not.toEqual(v25.regionalDex!.speciesIds);
  expect(isStockContent(content)).toBe(true);
  expect(Object.keys(DEPTH_CONTENT.species).length).toBe(Object.keys(REGIONAL_CONTENT.species).length + 10);
  expect(ROSTER_V26_VERSION).toBe('roster-v26');
  // Some seed includes a new line; its game view re-derives the same object.
  const seed = [31, 32, 33, 34, 35, 36, 37, 38].find(value => contentFor(setup(26, value)).regionalDex!.speciesIds.some(id => NEW_IDS.includes(id)))!;
  expect(seed).toBeDefined();
  const state = createGame(setup(26, seed)), own = contentFor(state.setup);
  expect(contentForView(observe(state, 0, own))).toBe(own);
  for (const id of own.regionalDex!.speciesIds) expect(own.units[id], id).toBe(own.species[id]);
});

test('sprites: every new species has an Emerald sprite in public/sprites/gen3 recorded in the manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/sprites/gen3/manifest.json', import.meta.url), 'utf8')) as { files: { id: number; file: string; sha256: string; bytes: number }[] };
  const ids = manifest.files.map(entry => entry.id);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  for (const id of NEW_IDS) {
    const dex = ROSTER_V26_SPECIES[id as keyof typeof ROSTER_V26_SPECIES].dex!, file = new URL(`../../public/sprites/gen3/${dex}.png`, import.meta.url);
    expect(existsSync(file), `${id} ${dex}`).toBe(true);
    const bytes = readFileSync(file), entry = manifest.files.find(item => item.id === dex)!;
    expect(entry).toEqual({ id: dex, file: `${dex}.png`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
});

/** Golden v26 draws (roster-v25 §5.2: one batch = one content version with new golden files; the v25 golden stays untouched). */
function golden(): Record<string, Pick<RegionalDexDraw, 'speciesIds'> & { lines: string[]; recruits: string[] }> {
  const out: Record<string, Pick<RegionalDexDraw, 'speciesIds'> & { lines: string[]; recruits: string[] }> = {};
  for (const mode of MODES) for (let seed = 31; seed <= 38; seed++) for (const leaders of [seated(seed), ['oak', 'misty'] as LeaderId[]]) {
    const draw = drawRegionalDex({ species, mode, dexSeed: seed, leaders });
    out[`${mode}:${seed}:${leaders.join(',')}`] = { speciesIds: draw.speciesIds, lines: draw.lines.map(line => `${line.id}:${line.source}`),
      recruits: deriveRosterTables(species, draw.speciesIds, mode).recruitSlots.map(item => `${item.slot}:${item.speciesId ?? '-'}:${item.level}`) };
  }
  return out;
}
test('golden v26 regional Pokédexes (seeds 31–38, both modes, two leader sets)', () => {
  const actual = golden();
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
  expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
}, 60_000);

test('regional-dex tool: --roster v26 reports no structural gaps (v25 keeps its three)', () => {
  expect(parseRegionalDexArgs(['--roster', 'v26', '--gaps'])).toMatchObject({ roster: 'v26', gapsOnly: true });
  expect(() => parseRegionalDexArgs(['--roster', 'v27'])).toThrow();
  expect(regionalDexReport({ mode: 'simple-v1', seeds: [1], leaders: 'rotation', roster: 'v26', gapsOnly: true }).json.gaps).toEqual([]);
  expect(regionalDexReport({ mode: 'simple-v1', seeds: [1], leaders: 'rotation', gapsOnly: true }).json.gaps).toEqual(['快速3阶', '侦察3阶', '飞行1阶']);
});
