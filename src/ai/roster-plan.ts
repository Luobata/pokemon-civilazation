// Gameplay v14 AI helpers for the roster pack: evolution branches and type-counter training (PlayerView only).
import { stoneEvolutionsFor } from '../content/roster.ts';
import type { EvolutionOption, TypeId } from '../content/species.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { evolutionBlocker, evolutionOptions, playerGeneration, tileBiome } from '../core/roster.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';

/** First evolution option whose conditions hold now (data order decides between branches); stone-only paths excluded. */
export function rosterEvolution(view: PlayerView, unit: MapUnit & { kind: 'pokemon' }, content: Content): EvolutionOption | null {
  const stones = stoneEvolutionsFor(content);
  const context = { generation: playerGeneration(view.economy.player, view.eraProgression), round: view.round, biome: tileBiome(view, unit.position) };
  return evolutionOptions(content, unit.speciesId).find(option => !stones.some(path => path.fromSpeciesId === unit.speciesId && path.intoSpeciesId === option.speciesId)
    && evolutionBlocker(content, option, context) === null) ?? null;
}

const typesOf = (content: Content, speciesId: SpeciesId): TypeId[] => {
  const species = content.species[speciesId];
  return [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
};
/**
 * Training bonus for species that hit visible enemy Pokémon super-effectively (+5 each) minus those that would hit it
 * super-effectively (−5 each), capped at ±30. Only rivals at war and only units in the view count.
 */
export function typeCounterBonus(view: PlayerView, speciesId: SpeciesId, content: Content): number {
  if (!content.roster) return 0;
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  const mine = content.species[speciesId];
  let score = 0;
  for (const unit of view.units) {
    if (unit.kind !== 'pokemon' || unit.ownerId === null || !enemies.has(unit.ownerId)) continue;
    if (dualEffectiveness(mine.typeId, typesOf(content, unit.speciesId)) >= 200) score += 5;
    if (dualEffectiveness(content.species[unit.speciesId].typeId, typesOf(content, speciesId)) >= 200) score -= 5;
  }
  return Math.max(-30, Math.min(30, score));
}
