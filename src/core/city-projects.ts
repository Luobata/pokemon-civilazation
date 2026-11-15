// Gameplay v27 ③ (docs/design/pace-v27.md §4, option 3A): repeatable city projects — hatch an egg, gym drill, field report, contest
// rehearsal, festival — costing base × (100 + 20 × completions) / 100, buyable with RushProduction. Stub (scaffold, §10 batch 1 step 1):
// the economy lane adds the `project` production item and fills these in. `completeCityProject` is wired once in resolveEconomy
// (src/core/economy.ts, before the district branch); null = not a project, so every older order completes as before.
import type { Content } from '../content/units.ts';
import type { CityState, EconomyEvent, GameState, ProductionOrder } from './model.ts';

/** Completes a finished project order (the order has already left the queue); null when the order is not a project. */
export function completeCityProject(_state: GameState, _city: CityState & { ownerId: number }, _order: ProductionOrder, content: Content): EconomyEvent[] | null {
  if (!content.cityProjects) return null;
  return null;
}
