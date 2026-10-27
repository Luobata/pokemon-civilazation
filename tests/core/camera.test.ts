import { expect, test } from 'vitest';
import { hexToWorld, worldToHex, toWorld, toScreen, zoomAt } from '../../src/browser/camera.ts';

test('hex center round trips across positive and negative coordinates', () => {
  for (let q = -10; q < 10; q++) for (let r = -10; r < 10; r++) {
    expect(worldToHex(hexToWorld({ q, r }))).toEqual({ q, r });
  }
});
test('edge/vertex ties use r then q', () => {
  const a = hexToWorld({ q: 0, r: 0 }), b = hexToWorld({ q: 1, r: 0 }), c = hexToWorld({ q: 1, r: -1 });
  expect(worldToHex({ x: (a.x + b.x) / 2, y: 0 })).toEqual({ q: 0, r: 0 });
  expect(worldToHex({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 })).toEqual({ q: 1, r: -1 });
});
test('zoom keeps pointer anchored and clamps zoom', () => {
  const camera = { x: 20, y: 40, zoom: 1 }; const point = { x: 100, y: 200 };
  const world = toWorld(point, camera); zoomAt(camera, point, 2);
  expect(toScreen(world, camera)).toEqual(point);
  zoomAt(camera, point, 100); expect(camera.zoom).toBe(4);
  zoomAt(camera, point, .0001); expect(camera.zoom).toBe(.25);
});
