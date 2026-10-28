// GDD §3.14. Ratios use integer thousandths, like existing core multipliers.
const defaults = {
  aggressiveSettlerCities: 4,
  aggressiveWarStrength: 1250,
  aggressiveBorderDistance: 5,
  aggressiveSiegeUnits: 4,
  aggressiveCaptureRadius: 6,
  aggressiveSeekUnknownHq: true,
  aggressiveSiegeCaptureBonus: 0,
  aggressiveSiegeTrainingBonus: 0,
  conservativeSeekUnknownHq: false,
  conservativeStrength: 1500,
  conservativeMayDeclareWar: true,
  conservativeDeclareStrength: 2000,
  conservativeBorderDistance: 5,
  conservativeSettlerInterval: 8,
  conservativeCaptureTerritoryOnly: true,
  peaceCitiesLost: 1,
  expansionCaptureHpPercent: 50,
  expansionMaySiege: true,
  expansionSiegeStrength: 2000,
  expansionBorderDistance: 5,
};
export const AI_THRESHOLDS = Object.freeze(defaults);
export type AiThresholds = typeof AI_THRESHOLDS;
