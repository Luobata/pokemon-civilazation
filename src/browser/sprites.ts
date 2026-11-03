import type { SpeciesId } from '../content/species.ts';
import type { BuildingId } from '../content/economy.ts';
import { buildingArtPath } from './building-art.ts';

const POKEDEX: Record<SpeciesId, number> = {
  clefable: 36, sandshrew: 27, ekans: 23, caterpie: 10, swinub: 220, magnemite: 81, umbreon: 197, clefairy: 35,
  bulbasaur: 1, ivysaur: 2, venusaur: 3, charmander: 4, charmeleon: 5, charizard: 6,
  squirtle: 7, wartortle: 8, blastoise: 9, pikachu: 25, raichu: 26,
  rattata: 19, raticate: 20, meowth: 52, snorlax: 143, machop: 66, machoke: 67, machamp: 68,
  pidgey: 16, pidgeotto: 17, pidgeot: 18, geodude: 74, graveler: 75, golem: 76, onix: 95,
  ponyta: 77, rapidash: 78, magikarp: 129, gyarados: 130, lapras: 131,
  abra: 63, kadabra: 64, alakazam: 65, gastly: 92, haunter: 93, gengar: 94,
  dratini: 147, dragonair: 148, dragonite: 149,
};

export const pokemonSpritePath = (id: SpeciesId) => `/sprites/gen3/${POKEDEX[id]}.png`;
const images = new Map<SpeciesId, HTMLImageElement>();

const buildingImages = new Map<BuildingId, HTMLImageElement>();
const MAP_BUILDINGS: readonly BuildingId[] = ['pasture', 'workshop', 'meetingHall', 'observatory', 'trainingGround'];

/** Loads Pokémon sprites and the building art drawn inside city tiles; `onLoad` redraws the map. */
export function loadPokemonSprites(onLoad: () => void): void {
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

export function pokemonSprite(id: SpeciesId): HTMLImageElement | null {
  const image = images.get(id);
  return image?.complete && image.naturalWidth ? image : null;
}
