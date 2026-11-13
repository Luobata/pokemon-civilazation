import type { BaseSpeciesId, SpeciesId } from '../content/species.ts';
import { ROSTER_V14_SPECIES } from '../content/roster-v14-data.ts';
import { ROSTER_V26_SPECIES } from '../content/roster-v26-data.ts';
import type { BuildingId } from '../content/economy.ts';
import { buildingArtPath } from './building-art.ts';

const BASE_POKEDEX: Record<BaseSpeciesId, number> = {
  clefable: 36, sandshrew: 27, ekans: 23, caterpie: 10, swinub: 220, magnemite: 81, umbreon: 197, clefairy: 35,
  bulbasaur: 1, ivysaur: 2, venusaur: 3, charmander: 4, charmeleon: 5, charizard: 6,
  squirtle: 7, wartortle: 8, blastoise: 9, pikachu: 25, raichu: 26,
  rattata: 19, raticate: 20, meowth: 52, snorlax: 143, machop: 66, machoke: 67, machamp: 68,
  pidgey: 16, pidgeotto: 17, pidgeot: 18, geodude: 74, graveler: 75, golem: 76, onix: 95,
  ponyta: 77, rapidash: 78, magikarp: 129, gyarados: 130, lapras: 131,
  abra: 63, kadabra: 64, alakazam: 65, gastly: 92, haunter: 93, gengar: 94,
  dratini: 147, dragonair: 148, dragonite: 149,
};

const POKEDEX = { ...BASE_POKEDEX, ...Object.fromEntries([...Object.entries(ROSTER_V14_SPECIES), ...Object.entries(ROSTER_V26_SPECIES)].map(([id, species]) => [id, species.dex!])) } as Record<SpeciesId, number>;
/** Sprite folder per Pokédex number (generations 1–3 share the Emerald set). */
// Sources (public/sprites/<folder>/manifest.json): Emerald, Platinum, Black/White, X/Y renders, Scarlet/Violet art for gens 7–9.
const spriteFolder = (dex: number) => dex <= 386 ? 'gen3' : dex <= 493 ? 'gen4' : dex <= 649 ? 'gen5' : dex <= 721 ? 'gen6' : dex <= 809 ? 'gen7' : dex <= 905 ? 'gen8' : 'gen9';
/** Gens 6–9 come as tightly cropped, non-square images: fit by the long side at Emerald's typical fill (~0.77). */
const isTightSprite = (dex: number) => dex > 649;
export const pokemonSpritePath = (id: SpeciesId) => `/sprites/${spriteFolder(POKEDEX[id])}/${POKEDEX[id]}.png`;
const images = new Map<SpeciesId, HTMLImageElement>();

const buildingImages = new Map<BuildingId, HTMLImageElement>();
const MAP_BUILDINGS: readonly BuildingId[] = ['pasture', 'workshop', 'meetingHall', 'observatory', 'trainingGround'];

/** Loads Pokémon sprites and the building art drawn inside city tiles; `onLoad` redraws the map. */
let redraw: () => void = () => undefined;
export function loadPokemonSprites(onLoad: () => void): void {
  redraw = onLoad;
  for (const id of Object.keys(POKEDEX) as SpeciesId[]) {
    const image = new Image();
    image.onload = onLoad;
    image.src = pokemonSpritePath(id);
    images.set(id, image);
  }
  for (const id of MAP_BUILDINGS) {
    const image = new Image();
    image.onload = onLoad;
    image.src = buildingArtPath(id);
    buildingImages.set(id, image);
  }
}

export function buildingSprite(id: BuildingId): HTMLImageElement | null {
  const image = buildingImages.get(id);
  return image?.complete && image.naturalWidth ? image : null;
}

const pathImages = new Map<string, HTMLImageElement>();
/** Draws any sprite file (e.g. a legendary for v15) lazily; gens 6–9 keep their aspect ratio like Pokémon sprites. */
export function drawSpritePath(context: CanvasRenderingContext2D, path: string, x: number, y: number, box: number): boolean {
  let image = pathImages.get(path);
  if (!image) { image = new Image(); image.onload = () => redraw(); image.src = path; pathImages.set(path, image); }
  if (!image.complete || !image.naturalWidth) return false;
  const dex = Number(/(\d+)\.png$/.exec(path)?.[1] ?? 0);
  if (!isTightSprite(dex)) { context.drawImage(image, x, y, box, box); return true; }
  const scale = box * .77 / Math.max(image.naturalWidth, image.naturalHeight);
  const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale), smoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = true;
  context.drawImage(image, Math.round(x + (box - width) / 2), Math.round(y + box * .92 - height), width, height);
  context.imageSmoothingEnabled = smoothing;
  return true;
}
/** Draws a Pokémon sprite into the square box at (x, y); fixed-canvas sets fill the box as before, cropped sets keep their aspect. */
export function drawPokemonSprite(context: CanvasRenderingContext2D, id: SpeciesId, x: number, y: number, box: number): boolean {
  const image = pokemonSprite(id);
  if (!image) return false;
  fitSprite(context, image, image.naturalWidth, image.naturalHeight, isTightSprite(POKEDEX[id]), x, y, box);
  return true;
}
function fitSprite(context: CanvasRenderingContext2D, source: CanvasImageSource, naturalWidth: number, naturalHeight: number, tight: boolean, x: number, y: number, box: number) {
  if (!tight) { context.drawImage(source, x, y, box, box); return; }
  const scale = box * .77 / Math.max(naturalWidth, naturalHeight);
  const width = Math.round(naturalWidth * scale), height = Math.round(naturalHeight * scale);
  const smoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = true; // anti-aliased art downscales cleanly only with smoothing
  context.drawImage(source, Math.round(x + (box - width) / 2), Math.round(y + box * .92 - height), width, height);
  context.imageSmoothingEnabled = smoothing;
}
const silhouettes = new Map<string, HTMLCanvasElement>();
/**
 * A sprite's one-colour silhouette (white for the evolution flash, red for a recall beam), cached per species and colour:
 * the sprite is drawn once into a small canvas and filled with `source-in`, so later frames cost one drawImage.
 */
export function drawPokemonSilhouette(context: CanvasRenderingContext2D, id: SpeciesId, x: number, y: number, box: number, color = '#FFFFFF'): boolean {
  const image = pokemonSprite(id);
  if (!image) return false;
  const key = `${id}:${color}`;
  let mask = silhouettes.get(key);
  if (!mask) {
    mask = document.createElement('canvas');
    mask.width = image.naturalWidth; mask.height = image.naturalHeight;
    const paint = mask.getContext('2d');
    if (!paint) return false;
    paint.drawImage(image, 0, 0);
    paint.globalCompositeOperation = 'source-in';
    paint.fillStyle = color; paint.fillRect(0, 0, mask.width, mask.height);
    silhouettes.set(key, mask);
  }
  fitSprite(context, mask, image.naturalWidth, image.naturalHeight, isTightSprite(POKEDEX[id]), x, y, box);
  return true;
}
export function pokemonSprite(id: SpeciesId): HTMLImageElement | null {
  const image = images.get(id);
  return image?.complete && image.naturalWidth ? image : null;
}
