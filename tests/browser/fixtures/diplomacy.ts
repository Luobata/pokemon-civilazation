import type { GameOutcome } from '../../../src/core/model.ts';
import { reachableFixture } from './reachable.ts';

export function diplomacySave(): string { return reachableFixture('diplomacy').save; }
export function incomingPeaceSave(): string { return reachableFixture('incoming-peace').save; }
export function outcomeSave(kind: GameOutcome['kind'] = 'score'): string { return reachableFixture(kind).save; }
export function neutralSave(): string { return reachableFixture('neutral').save; }
export function visibleAiSave(): string { return reachableFixture('visible-ai').save; }
