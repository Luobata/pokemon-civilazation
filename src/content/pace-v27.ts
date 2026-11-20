// Gameplay v27 (docs/design/pace-v27.md): the feature flags and the balance knobs of the pace upgrade. The knobs ride on the v27 `Content`
// only (`content.pace27`), so `tools/patch.ts` can vary them (and `balance-sweep` sweep them) and older contents are untouched;
// `pace27Tuning(content)` falls back to the stock values. One block per lane, so the parallel lanes each edit their own block.

/** One flag per v27 item (§1). All are absent before v27; the v27 content sets every one of them. */
export type PaceFlags = {
  /** ① §2: civilians flee from wild Pokémon instead of being knocked out; the AI's near city sites (radius 2); faith needs 70%. */
  openingSafety?: true;
  /** ② §3: exhausted wild Pokémon, newbie protection before round 30, the first-encounter reward, the guaranteed first ball. */
  wildEncounters?: true;
  /** ③ §4: repeatable city projects (cost +20% per completion, buyable with gold). */
  cityProjects?: true;
  /** ④ §5: legend wonders cost +15% per legend already owned. */
  legendFavor?: true;
  /** ⑤ §6: Max raids — shields, two phases, the den Dynamax, roles, catch chances, the reward preview. */
  maxRaids?: true;
  /** ⑥ §7: the fixed roster of 8 original league trainers (themes, signature Pokémon, growth per season, records, nemesis). */
  leagueTrainers?: true;
  /** ⑦ §8: contest entry from any own city, placing prizes. */
  contestCircuit?: true;
};
export const PACE_FLAGS: Required<PaceFlags> = {
  openingSafety: true, wildEncounters: true, cityProjects: true, legendFavor: true, maxRaids: true, leagueTrainers: true, contestCircuit: true,
};

// ---------- Opening lane (① ②) ----------
export type OpeningTuning = {
  /** ① §2.2 R4: faith victory needs this percent of the counted cities (v26 `FAITH_RULES.winShare` = 60). */
  faithWinSharePercent: number;
  /** ① §2.2 R2: the AI's city sites need every tile within this radius explored (v26: 3). */
  aiSiteRadius: number;
  /** ② §3.1 R1: a wild Pokémon hit to at most this percent of its max HP is exhausted for `exhaustRounds` rounds. */
  exhaustHpPercent: number; exhaustRounds: number;
  /** ② §3.1 R1: when exhaustion ends with HP still at most `exhaustHpPercent`, HP returns to this percent. */
  exhaustRecoverPercent: number;
  /** ② §3.1 R1: capture chance bonus (percentage points) on an exhausted target, and the cap with it. */
  exhaustCaptureBonus: number; exhaustCaptureCap: number;
  /** ② §3.1 R2: up to this round, a Pokémon knocked out by a wild one recovers for `protectionRounds` and returns at `protectionHpPercent`. */
  protectionLastRound: number; protectionRounds: number; protectionHpPercent: number;
  /** ② §3.1 R4: the first exhaustion of a species (per civilization, before round `encounterBeforeRound`): XP to the attacker, science. */
  encounterBeforeRound: number; encounterXp: number; encounterScience: number;
  /** ② §3.3 AI: attack score for a hit that leaves a wild target exhausted with an own ball carrier within 2. */
  aiExhaustAttackBonus: number;
  /** Integration (pace-v27 §13.8): more documented species for the Pokédex victory, on top of v26's `depth26.pokedexTargetBonus`
   *  (the early captures of ① ② fill the Pokédex sooner). Read once, when the world is created. */
  pokedexTargetBonus: number;
};
export const OPENING_TUNING: OpeningTuning = {
  faithWinSharePercent: 65, aiSiteRadius: 2,
  exhaustHpPercent: 40, exhaustRounds: 2, exhaustRecoverPercent: 41, exhaustCaptureBonus: 25, exhaustCaptureCap: 95,
  protectionLastRound: 30, protectionRounds: 1, protectionHpPercent: 50,
  encounterBeforeRound: 40, encounterXp: 15, encounterScience: 5,
  aiExhaustAttackBonus: 30, pokedexTargetBonus: 3,
};

// ---------- Economy lane (③ ④) ----------
export type CityProjectId = 'hatchEgg' | 'gymDrill' | 'fieldReport' | 'contestRehearsal' | 'festival';
export const CITY_PROJECT_IDS: readonly CityProjectId[] = ['hatchEgg', 'gymDrill', 'fieldReport', 'contestRehearsal', 'festival'];
export type EconomyTuning = {
  /** ③ §4.1 base production cost per project, and the increase per completion of the same project (percent). */
  projectCost: Record<CityProjectId, number>; projectStepPercent: number;
  /** ③ §4.1 effects: hatched XP; drill XP and Pokémon count; report science; rehearsal appeal and season score; festival satisfaction, era-score interval. */
  hatchXp: number; drillXp: number; drillUnits: number; reportScience: number; rehearsalAppeal: number; rehearsalScore: number;
  festivalSatisfaction: number; festivalEraInterval: number;
  /** ④ §5.1 legend cost +`legendFavorPercent`% per legend already built; `legendTrailPercent`% of the lost race's production carries over. */
  legendFavorPercent: number; legendTrailPercent: number;
};
export const ECONOMY_TUNING: EconomyTuning = {
  projectCost: { hatchEgg: 90, gymDrill: 60, fieldReport: 70, contestRehearsal: 60, festival: 60 }, projectStepPercent: 20,
  hatchXp: 50, drillXp: 20, drillUnits: 6, reportScience: 35, rehearsalAppeal: 15, rehearsalScore: 10,
  festivalSatisfaction: 10, festivalEraInterval: 10,
  legendFavorPercent: 15, legendTrailPercent: 25,
};
/** ③ §4.1: the five projects' names and what each needs (the requirement text shown on the card when it is missing). */
export const CITY_PROJECT_INFO: Record<CityProjectId, { name: string; needs: string }> = {
  hatchEgg: { name: '培育屋孵蛋', needs: '花园' },
  gymDrill: { name: '道馆特训', needs: '宝可梦中心或道馆区' },
  fieldReport: { name: '图鉴调查报告', needs: '研究所区' },
  contestRehearsal: { name: '华丽大赛彩排', needs: '华丽大赛馆' },
  festival: { name: '宝可梦嘉年华', needs: '任意城市' },
};
/** ③ §4.1: production cost of a project after `done` completions of the same project by the civilization: base × (100 + step × done) / 100, floored. */
export function cityProjectCost(content: { pace27?: Pace27Tuning } | undefined, id: CityProjectId, done: number): number {
  const tuning = economyTuning(content);
  return Math.floor(tuning.projectCost[id] * (100 + tuning.projectStepPercent * done) / 100);
}
/** ④ §5.1: a legend's cost percent when the civilization already owns `owned` legends (100 + favour × owned). */
export const legendFavorCostPercent = (content: { pace27?: Pace27Tuning } | undefined, owned: number): number => 100 + economyTuning(content).legendFavorPercent * owned;

// ---------- Events lane (⑤ ⑦) ----------
export type EventsTuning = {
  /** ⑤ §6.1 shields: `shieldBase + ⌈living / 2⌉` at the start (spec 2, sweep-tuned to 1), `shieldPhaseTwo` again in phase two; damage through shields (permille). */
  shieldBase: number; shieldPhaseTwo: number; shieldDamagePermille: number;
  /** ⑤ §6.1 phase two below this HP percent; the Max wave's range in phase two. */
  phaseTwoPercent: number; phaseTwoRange: number;
  /** ⑤ §6.1 roles: shields per breaker hit, damage multiplier of damage dealers after the shields (permille), support heal per round. */
  breakerShields: number; dealerPermille: number; supportHeal: number;
  /** ⑤ §6.1 contribution points per shield; the den Dynamax range. */
  shieldPoints: number; dynamaxRange: number;
  /** ⑤ §6.1 catch chance = base + share percent (at most `catchMaxPercent`); gold for a share of at least 10% when the boss leaves. */
  catchBasePercent: number; catchMaxPercent: number; participationGold: number;
  /** ⑦ §8.1 placing prizes: gold for 2nd and 3rd, XP for every other entrant. */
  circuitGold: [number, number]; circuitEntrantXp: number;
};
export const EVENTS_TUNING: EventsTuning = {
  shieldBase: 1, shieldPhaseTwo: 2, shieldDamagePermille: 250,
  phaseTwoPercent: 50, phaseTwoRange: 2,
  breakerShields: 2, dealerPermille: 1250, supportHeal: 10,
  shieldPoints: 15, dynamaxRange: 2,
  catchBasePercent: 30, catchMaxPercent: 80, participationGold: 30,
  circuitGold: [30, 15], circuitEntrantXp: 20,
};

// ---------- Trainers lane (⑥) ----------
export type TrainersTuning = {
  /** ⑥ §7.1 roster size; stage weights (stage 1, 2, 3) for splitting the team power; the signature Pokémon's weight (percent). */
  rosterSize: number; stageWeights: [number, number, number]; signaturePercent: number;
  /** ⑥ §7.7: a roster team's power is `npcBasePower + season × npcSeasonPower + slot × npcSlotPower` with this base (the v26 base is
   * `depth26.npcBasePower`; the season and slot steps stay v26's). Calibrated so the championship share stays near v26's. */
  npcBasePower: number;
};
export const TRAINERS_TUNING: TrainersTuning = { rosterSize: 8, stageWeights: [8, 10, 13], signaturePercent: 120, npcBasePower: 1100 };

export type Pace27Tuning = { opening: OpeningTuning; economy: EconomyTuning; events: EventsTuning; trainers: TrainersTuning };
export const PACE27_TUNING: Pace27Tuning = { opening: OPENING_TUNING, economy: ECONOMY_TUNING, events: EVENTS_TUNING, trainers: TRAINERS_TUNING };
/** The tuning a content carries (the stock values when it has none). */
export const pace27Tuning = (content: { pace27?: Pace27Tuning } | undefined): Pace27Tuning => content?.pace27 ?? PACE27_TUNING;
export const openingTuning = (content: { pace27?: Pace27Tuning } | undefined): OpeningTuning => content?.pace27?.opening ?? OPENING_TUNING;
export const economyTuning = (content: { pace27?: Pace27Tuning } | undefined): EconomyTuning => content?.pace27?.economy ?? ECONOMY_TUNING;
export const eventsTuning = (content: { pace27?: Pace27Tuning } | undefined): EventsTuning => content?.pace27?.events ?? EVENTS_TUNING;
export const trainersTuning = (content: { pace27?: Pace27Tuning } | undefined): TrainersTuning => content?.pace27?.trainers ?? TRAINERS_TUNING;
