// Pure read-only legendary wonder yield and empire-effect aggregators (leaf module).
import type { Yield } from '../content/economy.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { PolicyEffects } from '../content/policies.ts';
import type { GameState } from './model.ts';
import type { LegendView, LegendWonderRecord } from './legends.ts';

/** City yield bonus of the wonders standing in this city. */
export function legendCityYield(state: Pick<GameState, 'expansion'>, cityId: number): Partial<Yield> {
  const total: Partial<Yield> = {};
  for (const [id, record] of Object.entries(state.expansion?.legends?.wonders ?? {}) as [LegendWonderId, LegendWonderRecord][]) {
    if (record.cityId !== cityId) continue;
    for (const [key, value] of Object.entries(LEGEND_WONDERS[id].cityYield) as [keyof Yield, number][]) total[key] = (total[key] ?? 0) + value;
  }
  return total;
}

const addEffects = (into: PolicyEffects, effects: PolicyEffects) => {
  for (const [key, value] of Object.entries(effects) as [keyof PolicyEffects, number][]) into[key] = (into[key] ?? 0) + value;
  return into;
};

/** Empire-wide effects of the wonders in the player's cities (summed with the other policy effects). */
export function legendEffects(state: Pick<GameState, 'expansion' | 'cities'>, playerId: number): PolicyEffects {
  const total: PolicyEffects = {};
  for (const [id, record] of Object.entries(state.expansion?.legends?.wonders ?? {}) as [LegendWonderId, LegendWonderRecord][]) {
    if (state.cities[record.cityId]?.ownerId === playerId) addEffects(total, LEGEND_WONDERS[id].effects);
  }
  return total;
}

export function viewLegendEffects(view: { playerId: number; expansion?: { legends?: LegendView } }): PolicyEffects {
  const total: PolicyEffects = {};
  for (const wonder of view.expansion?.legends?.wonders ?? []) if (wonder.ownerId === view.playerId) addEffects(total, LEGEND_WONDERS[wonder.legendId].effects);
  return total;
}

export const mergeEffects = (a: PolicyEffects, b: PolicyEffects): PolicyEffects => addEffects({ ...a }, b);
