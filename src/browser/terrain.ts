import type { BiomeId } from '../content/rules.ts';
import type { Point } from './camera.ts';

const RADIUS = 48;
const WIDTH = 88;
const HEIGHT = 100;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const BIOME_ORDER: BiomeId[] = ['grassland', 'forest', 'mountain', 'ocean', 'desert', 'snow', 'volcano'];
const tiles = new Map<string, HTMLCanvasElement>();

function noise(seed: number, index: number): number {
  let value = Math.imul(seed + index * 374761393, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

function hexPath(context: CanvasRenderingContext2D, radius = RADIUS): void {
  context.beginPath();
  for (let corner = 0; corner < 6; corner++) {
    const angle = (corner * 60 - 30) * Math.PI / 180;
    const x = CENTER.x + radius * Math.cos(angle), y = CENTER.y + radius * Math.sin(angle);
    if (corner === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.closePath();
}

function polygon(context: CanvasRenderingContext2D, color: string, points: readonly [number, number][]): void {
  context.fillStyle = color;
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(CENTER.x + x, CENTER.y + y);
    else context.lineTo(CENTER.x + x, CENTER.y + y);
  });
  context.closePath();
  context.fill();
}

function rect(context: CanvasRenderingContext2D, color: string, x: number, y: number, width: number, height: number): void {
  context.fillStyle = color;
  context.fillRect(Math.round(CENTER.x + x), Math.round(CENTER.y + y), Math.round(width), Math.round(height));
}

function scatter(context: CanvasRenderingContext2D, seed: number, count: number,
  draw: (x: number, y: number, index: number) => void): void {
  for (let index = 0; index < count; index++) {
    draw(Math.round((noise(seed, index * 3) - .5) * 66), Math.round((noise(seed, index * 3 + 1) - .5) * 66), index);
  }
}

function tree(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  rect(context, '#203d35', x - size * .55, y + size * .45, size * 1.25, size * .28);
  rect(context, '#72573b', x - size * .1, y + size * .05, size * .22, size * .55);
  polygon(context, '#254b3b', [[x, y - size], [x - size * .72, y + size * .2], [x + size * .72, y + size * .2]]);
  polygon(context, '#397052', [[x, y - size * .82], [x - size * .5, y + size * .05], [x + size * .15, y - size * .04]]);
  rect(context, '#669264', x - size * .18, y - size * .58, size * .24, size * .24);
  rect(context, '#2d5b44', x - size * .62, y + size * .08, size * 1.25, size * .18);
}

function mountain(context: CanvasRenderingContext2D, x: number, y: number, size: number, snowy: boolean): void {
  polygon(context, '#3c4846', [[x - size, y + size * .65], [x, y - size], [x + size, y + size * .65]]);
  polygon(context, '#89918a', [[x - size * .82, y + size * .48], [x, y - size], [x - size * .05, y + size * .48]]);
  polygon(context, '#5d6965', [[x, y - size], [x + size * .8, y + size * .48], [x + size * .12, y + size * .18]]);
  polygon(context, snowy ? '#edf3e8' : '#b8b8a5', [[x, y - size], [x - size * .33, y - size * .3], [x - size * .08, y - size * .38], [x + size * .12, y - size * .12], [x + size * .34, y - size * .28]]);
  rect(context, '#c4c5b4', x - size * .62, y + size * .42, size * .36, size * .12);
}

function createTile(biome: BiomeId, variant: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  const seed = (BIOME_ORDER.indexOf(biome) + 1) * 1009 + variant * 7919;
  hexPath(context);
  context.clip();

  if (biome === 'grassland') {
    context.fillStyle = '#76975d'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#82a367', [[-48, -34], [10, -48], [42, -20], [20, -5], [-24, -10]]);
    polygon(context, '#6b8955', [[-46, 25], [-5, 8], [48, 20], [48, 52], [-48, 52]]);
    scatter(context, seed, 19, (x, y, index) => {
      const color = index % 3 === 0 ? '#a2b77b' : '#557749';
      rect(context, color, x, y, 2, 4);
      if (index % 4 === 0) rect(context, color, x + 3, y - 2, 2, 3);
    });
    scatter(context, seed + 71, 3, (x, y) => {
      rect(context, '#d8cf8b', x, y, 3, 3);
      rect(context, '#617e50', x + 1, y + 3, 1, 3);
    });
  } else if (biome === 'forest') {
    context.fillStyle = '#3f684e'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#4c7555', [[-48, -30], [12, -48], [48, -10], [15, 5], [-30, 0]]);
    polygon(context, '#355b46', [[-48, 22], [2, 5], [48, 22], [48, 52], [-48, 52]]);
    scatter(context, seed, 7, (x, y, index) => tree(context, x, y, 10 + noise(seed + 9, index) * 6));
    scatter(context, seed + 31, 9, (x, y) => rect(context, '#71906a', x, y, 3, 2));
  } else if (biome === 'mountain') {
    context.fillStyle = '#737b70'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#858b7b', [[-48, -35], [15, -48], [48, -5], [10, 8], [-35, 2]]);
    mountain(context, -15, -5, 22, variant % 2 === 0);
    mountain(context, 18, 13, 20, variant % 2 !== 0);
    mountain(context, 22, -22, 12, false);
    scatter(context, seed, 8, (x, y) => rect(context, '#a4a58f', x, y + 20, 4, 3));
  } else if (biome === 'ocean') {
    context.fillStyle = '#397b92'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#448ba0', [[-48, -42], [48, -42], [48, -4], [5, 8], [-48, -5]]);
    polygon(context, '#326d87', [[-48, 25], [5, 8], [48, 20], [48, 52], [-48, 52]]);
    scatter(context, seed, 12, (x, y, index) => {
      const width = 6 + Math.round(noise(seed + 17, index) * 7);
      rect(context, index % 3 ? '#75b2b7' : '#a0ccca', x, y, width, 2);
      if (index % 4 === 0) rect(context, '#2e637e', x + 3, y + 4, width + 4, 2);
    });
  } else if (biome === 'desert') {
    context.fillStyle = '#c5a364'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#d8b875', [[-48, -12], [-12, -30], [45, -16], [48, 2], [-8, -6], [-48, 10]]);
    polygon(context, '#b58f54', [[-48, 29], [-5, 12], [48, 27], [48, 50], [-48, 50]]);
    polygon(context, '#e2c382', [[-42, 24], [-4, 7], [37, 19], [12, 18], [-8, 15]]);
    scatter(context, seed, 12, (x, y, index) => rect(context, index % 2 ? '#9f804e' : '#ecd091', x, y, 3, 2));
    if (variant === 2) {
      rect(context, '#56704a', 20, -5, 4, 15);
      rect(context, '#56704a', 16, -1, 5, 4);
      rect(context, '#56704a', 15, -5, 3, 6);
      rect(context, '#7d9158', 21, -4, 1, 11);
    }
  } else if (biome === 'snow') {
    context.fillStyle = '#bfd5d5'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#dce8e2', [[-48, -35], [5, -46], [48, -22], [22, -2], [-28, -9]]);
    polygon(context, '#a8c4c9', [[-48, 29], [-4, 10], [48, 26], [48, 52], [-48, 52]]);
    polygon(context, '#e7eee6', [[-42, 21], [-6, 4], [36, 17], [9, 17], [-14, 12]]);
    scatter(context, seed, 11, (x, y, index) => {
      rect(context, index % 2 ? '#eff4eb' : '#91b2bb', x, y, 4, 2);
      if (index % 4 === 0) rect(context, '#789ca6', x + 1, y + 3, 2, 2);
    });
  } else {
    context.fillStyle = '#594944'; context.fillRect(0, 0, WIDTH, HEIGHT);
    polygon(context, '#70564a', [[-48, -34], [5, -48], [48, -18], [22, 0], [-30, -4]]);
    polygon(context, '#423c3a', [[-48, 24], [0, 7], [48, 20], [48, 52], [-48, 52]]);
    polygon(context, '#7d6050', [[-28, 12], [-10, -22], [8, -28], [30, 13], [10, 6], [-5, 12]]);
    polygon(context, '#322f30', [[-10, -22], [8, -28], [18, -10], [1, -14]]);
    polygon(context, '#e06f3f', [[-4, -17], [4, -20], [9, -9], [4, 2], [12, 15], [7, 19], [-2, 4]]);
    polygon(context, '#ffc35b', [[0, -15], [4, -16], [5, -8], [1, 1], [5, 9], [2, 10], [-2, 1]]);
    scatter(context, seed, 7, (x, y) => rect(context, '#a46b4d', x, y + 15, 4, 3));
  }

  hexPath(context, RADIUS - 1);
  context.strokeStyle = '#f5f0d510';
  context.lineWidth = 2;
  context.stroke();
  return canvas;
}

export function drawTerrain(context: CanvasRenderingContext2D, biome: BiomeId, index: number,
  center: Point, radius: number): void {
  const variant = Math.floor(noise(index + 137, BIOME_ORDER.indexOf(biome)) * 4);
  const key = `${biome}:${variant}`;
  let tile = tiles.get(key);
  if (!tile) {
    tile = createTile(biome, variant);
    tiles.set(key, tile);
  }
  const scale = radius / RADIUS;
  context.drawImage(tile, center.x - CENTER.x * scale, center.y - CENTER.y * scale, WIDTH * scale, HEIGHT * scale);
}
