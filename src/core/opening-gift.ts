// Gameplay v26 O (docs/design/depth-v26.md §8, option 8A): the professor's gift — three Poké Balls when domestication is researched,
// so the first catch comes right after the first technology instead of after a trip to buy balls. Once per civilization (the tech
// completes once). Nothing before v26.
import { lateTuning } from '../content/depth-v26.ts';
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type OpeningGiftEvent = { type: 'OpeningGiftReceived'; playerId: number; ballId: 'pokeBall'; quantity: number };
export function recordOpeningGift(before: GameState, after: GameState, events: readonly EventPayload[], content: Content): EventPayload[] {
  if (!content.openingGift) return [];
  const quantity = lateTuning(content).giftBalls, output: EventPayload[] = [];
  for (const event of events) {
    if (event.type !== 'TechCompleted' || event.techId !== 'domestication' || before.players[event.playerId]?.research.unlockedIds.includes('domestication')) continue;
    const player = after.players[event.playerId];
    if (!player || player.eliminated || quantity <= 0) continue;
    player.ballInventory.pokeBall += quantity;
    output.push({ type: 'OpeningGiftReceived', playerId: event.playerId, ballId: 'pokeBall', quantity });
  }
  return output;
}
