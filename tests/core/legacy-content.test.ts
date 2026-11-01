import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { CONTENT, EXPANSION_CONTENT } from '../../src/content/units.ts';
import { LEGACY_SPECIES, type LegacySpeciesId } from '../../src/content/legacy-species.ts';
import { SPECIES } from '../../src/content/species.ts';
import { WORLD_CONTENT } from '../../src/content/world-systems.ts';
import { CIVILIZATION_CONTENT } from '../../src/content/civilization-systems.ts';
import { canonicalSerialize, type JsonValue } from '../../src/core/snapshot.ts';
import { validateSpecies } from '../../src/content/species.ts';

const contentHash = (value: unknown) => createHash('sha256')
  .update(canonicalSerialize(JSON.parse(JSON.stringify(value)) as JsonValue))
  .digest('hex');

describe('pinned legacy content', () => {
  test('m3-v1 keeps the immutable 39-species table from adb8ac1', () => {
    const ids = Object.keys(LEGACY_SPECIES) as LegacySpeciesId[];
    expect(ids).toHaveLength(39);
    expect(ids[0]).toBe('bulbasaur');
    expect(ids.at(-1)).toBe('dragonite');
    expect(ids).not.toContain('clefairy');
    expect(Object.values(LEGACY_SPECIES).every(species => !('secondaryTypeId' in species))).toBe(true);
    expect(contentHash(LEGACY_SPECIES)).toBe('51f734c6cdf29e822c2b958d6272d2bf4ea41a27569a11ce8ddbc1ce739bfee8');
    expect(CONTENT.version).toBe('m3-v1');
    expect(CONTENT.species).toBe(LEGACY_SPECIES);
    expect(Object.keys(CONTENT.units)).toHaveLength(40);
    expect(WORLD_CONTENT.base).toBe(EXPANSION_CONTENT);
    expect(CIVILIZATION_CONTENT.world).toBe(EXPANSION_CONTENT);
  });

  test('expansion-v1 keeps all 47 species and its audited content hash', () => {
    expect(Object.keys(EXPANSION_CONTENT.species)).toHaveLength(47);
    expect(Object.keys(EXPANSION_CONTENT.species)).toEqual(Object.keys(SPECIES));
    expect(EXPANSION_CONTENT.species.geodude).toMatchObject({ maxHp: 60, attack: 20, defense: 90 });
    expect(contentHash(EXPANSION_CONTENT)).toBe('68224504087ac1c0e9d5214161754e6744374c367b547a17b3b7e796fad781b9');
    validateSpecies(SPECIES);
  });
});
