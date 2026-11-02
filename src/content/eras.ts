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

export type EraPlayer = { research: { unlockedIds: readonly string[] } };

const SIMPLE_ERAS: readonly EraDefinition[] = [
  { id: 'generation-1', name: '初代（红／绿／蓝／黄）', threshold: 0 },
  { id: 'generation-2', name: '金银时代', threshold: 3 },
  { id: 'generation-3', name: '宝石时代', threshold: 7 },
];

const FULL_ERAS: readonly EraDefinition[] = [
  { id: 'generation-1', name: '初代（红／绿／蓝／黄）', threshold: 0 },
  { id: 'generation-2', name: '金银时代', threshold: 1 },
  { id: 'generation-3', name: '宝石时代', threshold: 2 },
  { id: 'generation-4', name: '钻石珍珠时代', threshold: 3 },
  { id: 'generation-5', name: '黑白时代', threshold: 5 },
  { id: 'generation-6', name: 'ＸＹ时代', threshold: 7 },
  { id: 'generation-7', name: '日月时代', threshold: 9 },
  { id: 'generation-8', name: '剑盾时代', threshold: 11 },
  { id: 'generation-9', name: '朱紫时代', threshold: 12 },
];

export const ERA_DEFINITIONS: Record<EraProgression, readonly EraDefinition[]> = {
  'simple-v1': SIMPLE_ERAS,
  'full-v1': FULL_ERAS,
};

export function isEraProgression(value: unknown): value is EraProgression {
  return value === 'simple-v1' || value === 'full-v1';
}

function phaseFor(index: number, eras: readonly EraDefinition[]): DoctrinePhase {
  // Normalize the full nine-era track to thirds. The compact track has one era per phase.
  const position = index / (eras.length - 1);
  if (position < 1 / 3) return 'early';
  if (position < 2 / 3) return 'middle';
  return 'late';
}

export function eraState(player: EraPlayer, mode?: EraProgression): EraState | null {
  if (mode === undefined) return null;
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

/**
 * Additive gameplay packs inside era games. Absent = the original c8a830c era rules,
 * so era saves and replays recorded before a pack existed keep their exact results.
 * 1: role-based city assault and garrison recruits. 2: adds work Pokémon and tile improvements.
 */
export type GameplayVersion = 1 | 2;
export const LATEST_GAMEPLAY_VERSION: GameplayVersion = 2;
export function isGameplayVersion(value: unknown): value is GameplayVersion {
  return value === 1 || value === 2;
}
export function gameplayAtLeast(source: { gameplayVersion?: GameplayVersion }, version: GameplayVersion): boolean {
  return (source.gameplayVersion ?? 0) >= version;
}
