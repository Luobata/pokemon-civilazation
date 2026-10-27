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
