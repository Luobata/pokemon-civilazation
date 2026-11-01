import type { TypeId } from './species.ts';

// Stored in permille; combat-math exposes the GDD formula percentage units.
export const TYPE_CHART: Partial<Record<TypeId, Partial<Record<TypeId, number>>>> = {
  fire: { grass: 2000, fire: 500, water: 500, rock: 500, dragon: 500 },
  water: { fire: 2000, rock: 2000, water: 500, grass: 500, dragon: 500 },
  grass: { water: 2000, rock: 2000, fire: 500, grass: 500, flying: 500, dragon: 500 },
  electric: { water: 2000, flying: 2000, electric: 500, grass: 500, dragon: 500 },
  fighting: { normal: 2000, rock: 2000, flying: 500, psychic: 500, ghost: 0 },
  flying: { grass: 2000, fighting: 2000, electric: 500, rock: 500 },
  rock: { fire: 2000, flying: 2000, fighting: 500 },
  normal: { rock: 500, ghost: 0 }, psychic: { fighting: 2000, psychic: 500 },
  ghost: { psychic: 2000, ghost: 2000, normal: 0 }, dragon: { dragon: 2000 },
};

/** Complete 18-type rules; legacy games retain TYPE_CHART above. */
export const FULL_TYPE_CHART: Record<TypeId, Partial<Record<TypeId, number>>> = {
  normal: { rock: 500, steel: 500, ghost: 0 },
  fire: { grass: 2000, ice: 2000, bug: 2000, steel: 2000, fire: 500, water: 500, rock: 500, dragon: 500 },
  water: { fire: 2000, ground: 2000, rock: 2000, water: 500, grass: 500, dragon: 500 },
  electric: { water: 2000, flying: 2000, electric: 500, grass: 500, dragon: 500, ground: 0 },
  grass: { water: 2000, ground: 2000, rock: 2000, fire: 500, grass: 500, poison: 500, flying: 500, bug: 500, dragon: 500, steel: 500 },
  ice: { grass: 2000, ground: 2000, flying: 2000, dragon: 2000, fire: 500, water: 500, ice: 500, steel: 500 },
  fighting: { normal: 2000, ice: 2000, rock: 2000, dark: 2000, steel: 2000, poison: 500, flying: 500, psychic: 500, bug: 500, fairy: 500, ghost: 0 },
  poison: { grass: 2000, fairy: 2000, poison: 500, ground: 500, rock: 500, ghost: 500, steel: 0 },
  ground: { fire: 2000, electric: 2000, poison: 2000, rock: 2000, steel: 2000, grass: 500, bug: 500, flying: 0 },
  flying: { grass: 2000, fighting: 2000, bug: 2000, electric: 500, rock: 500, steel: 500 },
  psychic: { fighting: 2000, poison: 2000, psychic: 500, steel: 500, dark: 0 },
  bug: { grass: 2000, psychic: 2000, dark: 2000, fire: 500, fighting: 500, poison: 500, flying: 500, ghost: 500, steel: 500, fairy: 500 },
  rock: { fire: 2000, ice: 2000, flying: 2000, bug: 2000, fighting: 500, ground: 500, steel: 500 },
  ghost: { psychic: 2000, ghost: 2000, dark: 500, normal: 0 },
  dragon: { dragon: 2000, steel: 500, fairy: 0 },
  dark: { psychic: 2000, ghost: 2000, fighting: 500, dark: 500, fairy: 500 },
  steel: { ice: 2000, rock: 2000, fairy: 2000, fire: 500, water: 500, electric: 500, steel: 500 },
  fairy: { fighting: 2000, dragon: 2000, dark: 2000, fire: 500, poison: 500, steel: 500 },
};
