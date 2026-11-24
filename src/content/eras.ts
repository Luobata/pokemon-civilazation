import { TREE_ERA_THRESHOLDS } from './tech-tree.ts';

export type EraProgression = 'simple-v1' | 'full-v1';
export type DoctrinePhase = 'early' | 'middle' | 'late';

export type EraDefinition = {
  id: string;
  name: string;
  threshold: number;
};

export type EraState = {
  mode: EraProgression;
  index: number;
  phase: DoctrinePhase;
  completedTechs: number;
  current: EraDefinition;
  next: EraDefinition | null;
  techsToNextEra: number | null;
  eraProgressPercent: number;
  overallProgressPercent: number;
};

export type EraPlayer = { research: { unlockedIds: readonly string[]; tree?: true } };

const SIMPLE_ERAS: readonly EraDefinition[] = [
  { id: 'generation-1', name: '初代（红／绿／蓝／黄）', threshold: TREE_ERA_THRESHOLDS['simple-v1'][0] },
  { id: 'generation-2', name: '金银世代', threshold: TREE_ERA_THRESHOLDS['simple-v1'][1] },
  { id: 'generation-3', name: '宝石世代', threshold: TREE_ERA_THRESHOLDS['simple-v1'][2] },
];

const FULL_ERAS: readonly EraDefinition[] = [
  { id: 'generation-1', name: '初代（红／绿／蓝／黄）', threshold: TREE_ERA_THRESHOLDS['full-v1'][0] },
  { id: 'generation-2', name: '金银世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][1] },
  { id: 'generation-3', name: '宝石世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][2] },
  { id: 'generation-4', name: '钻石珍珠世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][3] },
  { id: 'generation-5', name: '黑白世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][4] },
  { id: 'generation-6', name: 'ＸＹ世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][5] },
  { id: 'generation-7', name: '日月世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][6] },
  { id: 'generation-8', name: '剑盾世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][7] },
  { id: 'generation-9', name: '朱紫世代', threshold: TREE_ERA_THRESHOLDS['full-v1'][8] },
];

export const ERA_DEFINITIONS: Record<EraProgression, readonly EraDefinition[]> = {
  'simple-v1': SIMPLE_ERAS,
  'full-v1': FULL_ERAS,
};

export function isEraProgression(value: unknown): value is EraProgression {
  return value === 'simple-v1' || value === 'full-v1';
}

function phaseFor(index: number, eras: readonly EraDefinition[]): DoctrinePhase {
  const position = index / (eras.length - 1);
  if (position < 1 / 3) return 'early';
  if (position < 2 / 3) return 'middle';
  return 'late';
}

export function eraDefinitions(mode: EraProgression): readonly EraDefinition[] {
  return ERA_DEFINITIONS[mode];
}

export function eraState(player: EraPlayer, mode: EraProgression = 'simple-v1'): EraState {
  const eras = ERA_DEFINITIONS[mode];
  const completedTechs = player.research.unlockedIds.length;
  let index = 0;
  for (let i = 0; i < eras.length; i += 1) {
    if (completedTechs >= eras[i].threshold) index = i;
  }
  const current = eras[index];
  const next = eras[index + 1] ?? null;
  const currentSpan = next === null ? 1 : Math.max(1, next.threshold - current.threshold);
  const eraProgress = completedTechs - current.threshold;
  return {
    mode,
    index,
    phase: phaseFor(index, eras),
    completedTechs,
    current,
    next,
    techsToNextEra: next === null ? null : next.threshold - completedTechs,
    eraProgressPercent: next === null ? 100 : Math.max(0, Math.min(100, Math.round(eraProgress / currentSpan * 100))),
    overallProgressPercent: Math.max(0, Math.min(100, Math.round(completedTechs / eras[eras.length - 1].threshold * 100))),
  };
}

/** Converged single gameplay baseline (v27 / pace-v27; legacy v0–v26 archived at tag archive/v0-v27-legacy). */
export type GameplayVersion = 27;
export const LATEST_GAMEPLAY_VERSION: GameplayVersion = 27;
export function isGameplayVersion(value: unknown): value is GameplayVersion {
  return value === 27;
}
