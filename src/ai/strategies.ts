import type { AiPersonality } from '../core/model.ts';

export type Goal = 'diplomacy' | 'found' | 'economy' | 'capture' | 'military' | 'research' | 'explore' | 'end';
type Strategy = Readonly<{
  priorities: readonly Goal[];
  settlerMinCities: 'aggressiveSettlerCities' | null;
  settlerPeaceOnly: boolean;
  settlerInterval: 'conservativeSettlerInterval' | null;
  declareWar: Readonly<{ enabled: 'conservativeMayDeclareWar' | null;
    strength: 'aggressiveWarStrength' | 'conservativeDeclareStrength';
    borderDistance: 'aggressiveBorderDistance' | 'conservativeBorderDistance' }> | null;
  seekUnknownHq: 'aggressiveSeekUnknownHq' | 'conservativeSeekUnknownHq' | null;
  siegeCaptureBonus: 'aggressiveSiegeCaptureBonus' | null;
  siegeTrainingBonus: 'aggressiveSiegeTrainingBonus' | null;
  siege: Readonly<{ kind: 'never' } | { kind: 'minimum'; units: 'aggressiveSiegeUnits' }
    | { kind: 'counteroffensive'; strength: 'conservativeStrength'; allowOffensiveWar: 'conservativeMayDeclareWar' }>;
  peaceCitiesLost: 'peaceCitiesLost' | null;
  captureHpPercent: 'expansionCaptureHpPercent' | null;
  captureTerritoryOnly: 'conservativeCaptureTerritoryOnly' | null;
  capturePriorityRadius: 'aggressiveCaptureRadius' | null;
  capturePriorityBonus: number;
  wildAttackGoal: 'capture' | 'military';
  defendTerritoryOnly: boolean;
}>;

// GDD §3.14; numeric/boolean references resolve against AI_THRESHOLDS or the run's ai patch.
// null means no restriction/bonus (peace: always accept). Defense uses the city's work radius.
// Full goal order and the +100 nearby-capture bonus preserve the existing planner tie-breaks.
export const AI_STRATEGIES: Readonly<Record<AiPersonality, Strategy>> = {
  expansion: {
    priorities: ['diplomacy', 'found', 'economy', 'capture', 'military', 'research', 'explore', 'end'],
    settlerMinCities: null, settlerPeaceOnly: false, settlerInterval: null,
    siegeCaptureBonus: null, siegeTrainingBonus: null,
    declareWar: null, seekUnknownHq: null, siege: { kind: 'never' }, peaceCitiesLost: 'peaceCitiesLost',
    captureHpPercent: 'expansionCaptureHpPercent', captureTerritoryOnly: null,
    capturePriorityRadius: null, capturePriorityBonus: 0,
    wildAttackGoal: 'military', defendTerritoryOnly: false,
  },
  aggressive: {
    priorities: ['diplomacy', 'military', 'capture', 'found', 'research', 'economy', 'explore', 'end'],
    settlerMinCities: 'aggressiveSettlerCities', settlerPeaceOnly: false, settlerInterval: null,
    declareWar: { enabled: null, strength: 'aggressiveWarStrength', borderDistance: 'aggressiveBorderDistance' },
    seekUnknownHq: 'aggressiveSeekUnknownHq',
    siegeCaptureBonus: 'aggressiveSiegeCaptureBonus', siegeTrainingBonus: 'aggressiveSiegeTrainingBonus',
    siege: { kind: 'minimum', units: 'aggressiveSiegeUnits' }, peaceCitiesLost: 'peaceCitiesLost',
    captureHpPercent: null, captureTerritoryOnly: null,
    capturePriorityRadius: 'aggressiveCaptureRadius', capturePriorityBonus: 100,
    wildAttackGoal: 'capture', defendTerritoryOnly: false,
  },
  conservative: {
    priorities: ['diplomacy', 'research', 'economy', 'military', 'capture', 'found', 'explore', 'end'],
    settlerMinCities: null, settlerPeaceOnly: true, settlerInterval: 'conservativeSettlerInterval',
    declareWar: { enabled: 'conservativeMayDeclareWar', strength: 'conservativeDeclareStrength', borderDistance: 'conservativeBorderDistance' },
    siegeCaptureBonus: null, siegeTrainingBonus: null,
    seekUnknownHq: 'conservativeSeekUnknownHq', siege: { kind: 'counteroffensive', strength: 'conservativeStrength', allowOffensiveWar: 'conservativeMayDeclareWar' }, peaceCitiesLost: null,
    captureHpPercent: null, captureTerritoryOnly: 'conservativeCaptureTerritoryOnly',
    capturePriorityRadius: null, capturePriorityBonus: 0,
    wildAttackGoal: 'capture', defendTerritoryOnly: true,
  },
} as const;
