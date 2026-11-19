import { afterEach, describe, expect, it } from 'vitest';
import { HEX_RADIUS, fitCamera, hexToWorld, mapTilt, setMapTilt, toScreen, toWorld, worldToHex } from '../../src/browser/camera.ts';
import { hexToIndex, indexToHex } from '../../src/core/hex.ts';
import type { GridSize } from '../../src/core/hex.ts';
import { ELEVATION, TILT_25D, applyRenderMode, liftAtWorld, neighbourLift, pickHex, requestedRenderMode, sceneLifts, tileLift, topCentre } from '../../src/browser/render/projection.ts';

afterEach(() => setMapTilt(1));
/** Cube rounding can return −0. */
const plain = (hex: { q: number; r: number }) => ({ q: hex.q || 0, r: hex.r || 0 });

function lifts(size: GridSize, seed: number): Float32Array {
  const values = [ELEVATION.unknown, ELEVATION.water, 0, 0, 0, ELEVATION.snow, ELEVATION.hill, ELEVATION.mountain, ELEVATION.mountain + ELEVATION.hill + ELEVATION.peak];
  return Float32Array.from({ length: size.width * size.height }, (_, index) => values[(index * 7 + seed * 13 + (index >> 3)) % values.length]);
}

describe('ui-25d projection', () => {
  it('reads the mode from the URL first, then the saved setting; flat by default', () => {
    expect(requestedRenderMode('?render=25d', null)).toBe('25d');
    expect(requestedRenderMode('?render=flat', '25d')).toBe('flat');
    expect(requestedRenderMode('', '25d')).toBe('25d');
    expect(requestedRenderMode('?dev=1', null)).toBe('flat');
    applyRenderMode('25d');
    expect(mapTilt()).toBe(TILT_25D);
    applyRenderMode('flat');
    expect(mapTilt()).toBe(1);
  });

  it('keeps the flat world untouched at tilt 1 and squashes only y at 2.5D', () => {
    const hex = { q: 3, r: 5 }, flat = hexToWorld(hex);
    setMapTilt(TILT_25D);
    expect(hexToWorld(hex)).toEqual({ x: flat.x, y: flat.y * TILT_25D });
    // worldToHex inverts the squash: every tile centre and points well inside its face round-trip.
    for (let q = -3; q < 9; q++) for (let r = 0; r < 9; r++) {
      const centre = hexToWorld({ q, r });
      for (const [dx, dy] of [[0, 0], [.6, 0], [-.6, 0], [0, .6], [0, -.6], [.4, .4]])
        expect(plain(worldToHex({ x: centre.x + dx * HEX_RADIUS * .8, y: centre.y + dy * HEX_RADIUS * TILT_25D * .8 }))).toEqual({ q, r });
    }
    const camera = fitCamera({ width: 30, height: 20 }, 1000, 700);
    setMapTilt(1);
    expect(fitCamera({ width: 30, height: 20 }, 1000, 700).zoom).toBeLessThanOrEqual(camera.zoom);
  });

  it('gives water, land, hills, mountains and peaks rising lifts', () => {
    expect(tileLift(null, false, false)).toBeLessThan(tileLift('ocean', false, false));
    expect(tileLift('ocean', false, false)).toBeLessThan(tileLift('grassland', false, false));
    expect(tileLift('grassland', false, false)).toBeLessThan(tileLift('grassland', true, false));
    expect(tileLift('grassland', true, false)).toBeLessThan(tileLift('mountain', false, false));
    expect(tileLift('mountain', false, false)).toBeLessThan(tileLift('mountain', false, true));
    const scene = sceneLifts([{ biome: 'grassland' }, { biome: 'grassland' }, { biome: 'ocean' }], { hills: [1], peaks: [], deep: [], lakes: [], rivers: [], landmarks: [] });
    expect([...scene]).toEqual([0, ELEVATION.hill, ELEVATION.water]);
  });

  for (const wrap of [false, true]) it(`picks the frontmost column under the pointer (${wrap ? 'wrapping' : 'flat'} map)`, () => {
    setMapTilt(TILT_25D);
    const size: GridSize = { width: 12, height: 10, ...(wrap ? { wrap: true } : {}) };
    for (const [seed, camera] of [[1, { x: 40, y: 60, zoom: 1 }], [2, { x: -130, y: 20, zoom: 2.3 }], [3, { x: 300, y: 90, zoom: .55 }]] as const) {
      const heights = lifts(size, seed);
      let exact = 0;
      for (let index = 0; index < size.width * size.height; index++) {
        const hex = indexToHex(index, size), centre = topCentre(hex, camera, heights[index]);
        const picked = hexToIndex(pickHex(centre, camera, size, heights), size)!;
        // Either the tile itself, or a taller column in a nearer row that really covers its centre.
        if (picked === index) exact++;
        else {
          expect(Math.floor(picked / size.width)).toBeGreaterThan(Math.floor(index / size.width));
          expect(heights[picked]).toBeGreaterThan(heights[index] + 8);
        }
        // The middle of a visible front cliff picks the column it belongs to.
        const drop = heights[index] - neighbourLift(hex, 5, size, heights);
        if (drop * camera.zoom > 4 && picked === index) {
          const radius = HEX_RADIUS * camera.zoom, edge = { x: centre.x + radius * .45, y: centre.y + radius * TILT_25D * (1 - .45 / Math.sqrt(3)) };
          expect(hexToIndex(pickHex({ x: edge.x, y: edge.y + drop * camera.zoom / 2 }, camera, size, heights), size)).toBe(index);
        }
      }
      expect(exact / heights.length).toBeGreaterThan(.8);
      if (wrap) {
        // A copy one map-width to the east picks the same tile.
        const hex = indexToHex(5, size), copy = { q: hex.q + size.width, r: hex.r };
        expect(hexToIndex(pickHex(topCentre(copy, camera, heights[5]), camera, size, heights), size)).toBe(5);
      }
    }
  });

  it('flat picking is unchanged at tilt 1', () => {
    const camera = { x: 17, y: 9, zoom: 1.4 };
    for (let q = 0; q < 6; q++) for (let r = 0; r < 6; r++) expect(plain(worldToHex(toWorld(toScreen(hexToWorld({ q, r }), camera), camera)))).toEqual({ q, r });
  });

  it('blends the lift between tile centres so animated units glide over steps', () => {
    setMapTilt(TILT_25D);
    const size: GridSize = { width: 4, height: 3 }, heights = new Float32Array(12);
    heights[hexToIndex({ q: 1, r: 1 }, size)!] = 10;
    const a = hexToWorld({ q: 0, r: 1 }), b = hexToWorld({ q: 1, r: 1 });
    expect(liftAtWorld(a, size, heights)).toBeCloseTo(0);
    expect(liftAtWorld(b, size, heights)).toBeCloseTo(10);
    const mid = liftAtWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, size, heights);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(8);
  });
});
