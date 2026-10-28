// GDD §3.14. Ratios use integer thousandths, like existing core multipliers.
const defaults = {
  aggressiveSettlerCities: 3,
  aggressiveWarStrength: 1500,
  aggressiveBorderDistance: 5,
  aggressiveSiegeUnits: 4,
  aggressiveCaptureRadius: 6,
  conservativeStrength: 2000,
  conservativeSettlerInterval: 15,
  conservativeCaptureTerritoryOnly: true,
  peaceCitiesLost: 1,
  expansionCaptureHpPercent: 50,
};
export const AI_THRESHOLDS = Object.freeze(defaults);
export type AiThresholds = typeof AI_THRESHOLDS;
