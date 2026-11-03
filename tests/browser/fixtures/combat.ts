import { reachableFixture } from './reachable.ts';

export type CombatScenario = 'attack' | 'capture-success' | 'capture-failure' | 'evolve' | 'recovering';
export function combatFixture(scenario: CombatScenario = 'attack') {
  return reachableFixture(scenario);
}
