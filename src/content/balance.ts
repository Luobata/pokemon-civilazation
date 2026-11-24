// Production balance constants, injected per simulation.
export const BALANCE = {
  city: { baseHp: 100, capturedHp: 50, buildingHp: 20, defense: 50, counterAttack: 30, squirtleCounterAttack: 34 },
  effects: { siegeMultiplier: 1750, leagueScoreMultiplier: 1200, meteorologyResearch: 1 },
  score: { cities: 80, population: 10, species: 5, techs: 20, knockdowns: 2 },
};
export type Balance = typeof BALANCE;
