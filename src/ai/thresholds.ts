// GDD §3.14. Ratios use integer thousandths, like existing core multipliers.
export const AI_THRESHOLDS = {
  aggressiveSettlerCities: 3,
  aggressiveWarStrength: 1500,
  aggressiveBorderDistance: 5,
  aggressiveSiegeUnits: 4,
  aggressiveCaptureRadius: 6,
  conservativeStrength: 2000,
  conservativeSettlerInterval: 15,
  peaceCitiesLost: 1,
  expansionCaptureHpPercent: 50,
};
export type AiThresholds = typeof AI_THRESHOLDS;
