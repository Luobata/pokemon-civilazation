import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { artFit, pixelSpriteSide } from '../../src/browser/ui-icons.ts';
import { pokedexNumber, pokemonArtPath, pokemonPortrait, SPRITE_SPECIES, spriteImage } from '../../src/browser/sprites.ts';

// docs/design/fidelity/README.md: pixel sprites at integer device scales; official artwork for the 绘卷 theme's portraits.
describe('integer-scale sprite sizing', () => {
  test('fixed-canvas pixel sets are recognised; tight renders, artwork and SVG scale smoothly', () => {
    expect(pixelSpriteSide('/sprites/gen3/1.png')).toBe(64);
    expect(pixelSpriteSide('/sprites/gen4/448.png')).toBe(80);
    expect(pixelSpriteSide('/sprites/gen5/530.png')).toBe(96);
    for (const src of ['/sprites/gen6/663.png', '/sprites/gen9/959.png', '/sprites/art/1.webp', '/trainers/forgeSmith.svg']) expect(pixelSpriteSide(src)).toBeNull();
  });
  test('the largest whole device scale that fits, centred on whole device pixels', () => {
    expect(artFit('/sprites/gen3/1.png', 64, 2)).toEqual({ size: 64, inset: 0, pixelated: true });
    expect(artFit('/sprites/gen3/1.png', 40, 2)).toEqual({ size: 32, inset: 4, pixelated: true });
    expect(artFit('/sprites/gen3/1.png', 80, 2)).toEqual({ size: 64, inset: 8, pixelated: true });
    expect(artFit('/sprites/gen3/1.png', 96, 2)).toEqual({ size: 96, inset: 0, pixelated: true });
    expect(artFit('/sprites/gen3/1.png', 64, 1)).toEqual({ size: 64, inset: 0, pixelated: true });
    expect(artFit('/sprites/gen4/448.png', 64, 2)).toEqual({ size: 40, inset: 12, pixelated: true });
    // DPR 1.5: 3 device pixels per 2 sprite pixels is not whole, so 64 CSS px takes ×1 (42.67 CSS px) rather than blur.
    const fit = artFit('/sprites/gen3/1.png', 64, 1.5);
    expect(fit.size * 1.5).toBeCloseTo(64);
    expect((fit.inset * 1.5) % 1).toBeCloseTo(0);
    // Smaller than one device pixel per sprite pixel: keep the box and downscale smoothly.
    expect(artFit('/sprites/gen5/530.png', 40, 2)).toEqual({ size: 40, inset: 0, pixelated: false });
    expect(artFit('/sprites/gen8/887.png', 40, 2)).toEqual({ size: 40, inset: 0, pixelated: false });
  });
  test('portrait markup in the pixel looks: the sprite at its fitted size, named when asked', () => {
    expect(spriteImage('/sprites/gen3/25.png', 64, { alt: '皮卡丘' })).toMatch(/class="portrait-px px-art-pixel" src="\/sprites\/gen3\/25\.png" width="64" height="64" alt="皮卡丘"/);
    // Node has no document: the theme check falls back to the pixel sprite.
    expect(pokemonPortrait('pikachu', 64)).toContain('/sprites/gen3/25.png');
  });
});

describe('official artwork (public/sprites/art)', () => {
  type Entry = { id: number; file: string; sha256: string; bytes: number; sourceSha256: string };
  const manifest = JSON.parse(readFileSync(new URL('../../public/sprites/art/manifest.json', import.meta.url), 'utf8')) as { source: string; commit: string; path: string; files: Entry[] };
  test('records its source like the sprite folders', () => {
    expect(manifest).toMatchObject({ source: 'PokeAPI/sprites', commit: '1dd55c0436d2a5b6e324c0b780e1b1b416fbfb64', path: 'sprites/pokemon/other/official-artwork' });
  });
  test('every species with a sprite has artwork whose bytes match the manifest', () => {
    const missing: string[] = [];
    for (const id of SPRITE_SPECIES) {
      const dex = pokedexNumber(id), entry = manifest.files.find(item => item.id === dex);
      expect(pokemonArtPath(id)).toBe(`/sprites/art/${dex}.webp`);
      if (!entry) { missing.push(`${id} #${dex}`); continue; }
      const bytes = readFileSync(new URL(`../../public/sprites/art/${entry.file}`, import.meta.url));
      expect(bytes.subarray(0, 4).toString('latin1') + bytes.subarray(8, 12).toString('latin1')).toBe('RIFFWEBP');
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
    expect(missing).toEqual([]);
  });
});
