// Gameplay v22 era dedications (docs/design/world-v22.md §C). Everything here is a no-op unless the era-honor record
// carries a `dedication` ledger, which only v22 era games create, so v<=21 games, logs and replays are unchanged.
import { DEDICATION_IDS, DEDICATION_RULES, DEDICATIONS, EXPLORATION_TILES } from '../content/dedications.ts';
import type { DedicationId, DedicationTrigger } from '../content/dedications.ts';
import type { EraAge, EraMilestone } from '../content/era-honors.ts';
import type { PolicyEffects } from '../content/policies.ts';
import { contentFor } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

/** Per player: cards still to choose this era, whether the era is heroic, chosen cards and the extra score each earned. */
export type DedicationLedger = { pending: number; heroic: boolean; chosen: DedicationId[]; progress: Partial<Record<DedicationId, number>> };
export type DedicationAction = { type: 'ChooseDedication'; dedicationIds: DedicationId[] };
/** Private to the chooser (events with a `playerId` are only shown to that player). */
export type DedicationEvent = { type: 'DedicationChosen'; playerId: number; eraIndex: number; dedicationIds: DedicationId[] };
type HonorRecord = { eraIndex: number; age: EraAge; dedication?: DedicationLedger };

export const usesDedications = (state: Pick<GameState, 'setup'>) => contentFor(state.setup).dedications === true;
export const blankDedication = (): DedicationLedger => ({ pending: 0, heroic: false, chosen: [], progress: {} });
export const isHeroic = (previous: EraAge, next: EraAge) => previous === 'dark' && next === 'golden';
export const dedicationPicks = (age: EraAge, heroic: boolean): number => heroic ? DEDICATION_RULES.picks.heroic : DEDICATION_RULES.picks[age];
export function isDedicationAction(action: { type: unknown }): action is DedicationAction { return action.type === 'ChooseDedication'; }

export function validateDedicationAction(state: GameState, actorId: number, action: DedicationAction): string | null {
  const ledger = state.expansion?.eraHonors?.players[actorId]?.dedication;
  if (!ledger || state.players[actorId].eliminated) return 'dedications-unavailable';
  if (ledger.pending === 0) return 'dedication-not-pending';
  const ids = action.dedicationIds;
  if (!Array.isArray(ids) || ids.some(id => !Object.hasOwn(DEDICATIONS, id))) return 'dedication-unknown';
  if (new Set(ids).size !== ids.length) return 'dedication-duplicate';
  return ids.length === ledger.pending ? null : 'dedication-count';
}
export function applyDedicationAction(state: GameState, actorId: number, action: DedicationAction): EventPayload[] {
  const record = state.expansion!.eraHonors!.players[actorId], ledger = record.dedication!;
  // Canonical order (table order), whatever order the command listed them in.
  ledger.chosen = DEDICATION_IDS.filter(id => action.dedicationIds.includes(id));
  ledger.pending = 0;
  return [{ type: 'DedicationChosen', playerId: actorId, eraIndex: record.eraIndex, dedicationIds: [...ledger.chosen] }];
}

/** Deeds in one transaction that only dedications count (era milestones are passed in by the caller). */
export function dedicationDeeds(before: GameState, after: GameState, events: readonly EventPayload[], milestones: readonly [number, EraMilestone][]): [number, DedicationTrigger][] {
  const found: [number, DedicationTrigger][] = [...milestones];
  for (const event of events) {
    switch (event.type) {
      case 'BuildingCompleted': found.push([event.playerId, 'buildingCompleted']); break;
      case 'ContestHeld': found.push([event.playerId, 'contestHeld']); break;
      case 'CityConverted': found.push([event.playerId, 'cityConverted']); break;
      case 'TradeRouteEstablished': found.push([event.playerId, 'tradeRoute']); break;
      case 'BattleResolved':
        for (const record of event.knockdowns ?? []) {
          if (record.source.ownerId !== null && record.target.ownerId !== null && record.target.ownerId !== record.source.ownerId
            && record.target.kind !== 'city') found.push([record.source.ownerId, 'enemyDefeated']);
        }
        break;
      default: break;
    }
  }
  for (const playerId of after.turnOrder) {
    // Techs from any source (round research, phantoms, discoveries) and newly explored tiles, by difference.
    const techs = after.players[playerId].research.unlockedIds.length - before.players[playerId].research.unlockedIds.length;
    for (let index = 0; index < techs; index++) found.push([playerId, 'techCompleted']);
    const explored = Math.floor((after.knowledge[playerId]?.exploredTileIds.length ?? 0) / EXPLORATION_TILES)
      - Math.floor((before.knowledge[playerId]?.exploredTileIds.length ?? 0) / EXPLORATION_TILES);
    for (let index = 0; index < explored; index++) found.push([playerId, 'exploration']);
  }
  return found;
}
/** Extra era score a deed earns through the chosen cards (promises hold in normal and dark ages only). */
export function promisePoints(record: HonorRecord, trigger: DedicationTrigger): [DedicationId, number][] {
  const ledger = record.dedication;
  if (!ledger || record.age === 'golden') return [];
  return ledger.chosen.flatMap(id => DEDICATIONS[id].promise.filter(item => item.trigger === trigger).map(item => [id, item.points] as [DedicationId, number]));
}

const addEffects = (total: PolicyEffects, extra: PolicyEffects): PolicyEffects => {
  for (const [key, value] of Object.entries(extra) as [keyof PolicyEffects, number][]) total[key] = (total[key] ?? 0) + value;
  return total;
};
/** Golden effects of the chosen cards (only in a golden or heroic age). */
export function goldenDedicationEffects(record: { age: EraAge; dedication?: DedicationLedger } | undefined): { policy: PolicyEffects; leaguePoints: number; satisfaction: number } {
  const total = { policy: {} as PolicyEffects, leaguePoints: 0, satisfaction: 0 };
  if (!record?.dedication || record.age !== 'golden') return total;
  for (const id of record.dedication.chosen) {
    const golden = DEDICATIONS[id].golden;
    addEffects(total.policy, golden.policy);
    total.leaguePoints += golden.leaguePoints ?? 0; total.satisfaction += golden.satisfaction ?? 0;
  }
  return total;
}
