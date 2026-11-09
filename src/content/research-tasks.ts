// Gameplay v24 D (docs/design/world-v24.md §5): Pokédex research tasks per species and their small rewards.
import { WEATHERS } from './era-abilities.ts';
import type { WeatherId } from './era-abilities.ts';
import type { TypeId } from './species.ts';

export type ResearchTaskId = 'seen' | 'knockouts' | 'captured' | 'evolution' | 'special';
/** Bit i of a card's `tasks` mask is RESEARCH_TASK_IDS[i]. */
export const RESEARCH_TASK_IDS: readonly ResearchTaskId[] = ['seen', 'knockouts', 'captured', 'evolution', 'special'];
export const RESEARCH_TASK_RULES_V24 = {
  knockoutsNeeded: 2,
  /** Rewards by tasks completed on one card. */
  notesAt: 2, notesResearch: 4, captureAt: 4, captureBonus: 10, completeAt: 5, completeGold: 15, completeEraScore: 1, eraScoreCapPerEra: 3,
  /** AI: extra capture score when the capture completes task 3 (capture) or 5 (habitat). */
  aiCaptureScore: 15,
} as const;

/** Task 5 by the species' first type: dark / ghost → knock out at night; water / fire / rock / ground / steel → knock out in the
 *  matching weather; everything else → capture in its habitat. */
export type ResearchSpecial = { kind: 'night' } | { kind: 'weather'; weather: WeatherId } | { kind: 'habitat' };
const SPECIAL_WEATHER: Partial<Record<TypeId, WeatherId>> = { water: 'rain', fire: 'sun', rock: 'sand', ground: 'sand', steel: 'sand' };
export function researchSpecialFor(typeId: TypeId): ResearchSpecial {
  if (typeId === 'dark' || typeId === 'ghost') return { kind: 'night' };
  const weather = SPECIAL_WEATHER[typeId];
  return weather ? { kind: 'weather', weather } : { kind: 'habitat' };
}

export const RESEARCH_TASK_NAMES: Record<ResearchTaskId, string> = {
  seen: '看到', knockouts: '击倒 2 只', captured: '收服', evolution: '看到进化', special: '特别条件',
};
/** Short label of task 5 for one species' first type. */
export function researchSpecialLabel(typeId: TypeId): string {
  const special = researchSpecialFor(typeId);
  return special.kind === 'night' ? '夜里击倒' : special.kind === 'weather' ? `${WEATHERS[special.weather].name}里击倒` : '在栖息地收服';
}
