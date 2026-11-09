import type { TypeId } from './species.ts';

/** One colour per Pokémon type: guide chips, attack projectiles and impact particles on the map. */
export const TYPE_COLORS: Record<TypeId, string> = {
  normal: '#C6C2A8', fire: '#F08A4B', water: '#6FA5EE', electric: '#F5D04A', grass: '#7FCB5C', ice: '#9ADBD8',
  fighting: '#D2614E', poison: '#B979C2', ground: '#DDB868', flying: '#A99AF0', psychic: '#F47FA0', bug: '#B3C341',
  rock: '#C3AE5C', ghost: '#8C7CB8', dragon: '#8E6EF5', dark: '#8F7B6D', steel: '#BFC3D6', fairy: '#F0A8C8',
};
