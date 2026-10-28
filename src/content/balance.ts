// Existing rule constants, injected per simulation; defaults are the production rules.
export const BALANCE = {
  city: { baseHp: 50, capturedHp: 50, buildingHp: 20, defense: 50, counterAttack: 30, squirtleCounterAttack: 34 },
  effects: { siegeMultiplier: 1750, leagueScoreMultiplier: 1200, meteorologyResearch: 1 },
  score: { cities: 80, population: 10, species: 5, techs: 20, knockdowns: 2 },
};
export type Balance = typeof BALANCE;
