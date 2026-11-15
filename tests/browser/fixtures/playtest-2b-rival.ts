// Playtest 2026-11b batches C and D: saves of real v26 games. The rival save is the playtest's own opening (seed 21, 小刚 + 小火龙, the
// human seat only ends its turns), saved one round before the rival's first visit arrives in fog at (33, 17); the AI plays the rest.
import { GameSession } from '../../../src/app/session.ts';
import { serializeSave } from '../../../src/app/save.ts';
import { LEADER_IDS } from '../../../src/content/leaders.ts';
import type { GameSetup } from '../../../src/core/model.ts';

const seed = 21, human = 'brock' as const;
const ai = LEADER_IDS.filter(id => id !== human).map((id, index) => ({ id, key: (Math.imul(seed + 1, 2654435761) ^ Math.imul(index + 7, 40503)) >>> 0 }))
  .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id)).map(item => item.id);
export const RIVAL_SETUP: GameSetup = { expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 26, seed, width: 40, height: 26, roundLimit: 200,
  players: [{ id: 0, controller: 'human', starterId: 'charmander', leaderId: human }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'expansion' as const, leaderId: ai[id - 1] }))] };
/** The warned arrival tile of the first visit, as (column, row). */
export const RIVAL_ARRIVAL = { col: 33, row: 17 } as const;
let cached: string | null = null;
/** Round 7: the warning is on the map, no research chosen yet (the human seat only ended turns). */
export function rivalEveSave(): string {
  if (cached) return cached;
  const session = new GameSession(RIVAL_SETUP);
  while (session.getView().round < 7) session.issue({ type: 'EndTurn' });
  return cached = serializeSave(session.getState(), session.exportLog());
}
