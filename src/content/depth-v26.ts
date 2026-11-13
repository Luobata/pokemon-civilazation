// Gameplay v26 (docs/design/depth-v26.md): the feature flags and the balance knobs of the depth upgrade. The knobs ride on the v26
// `Content` only (`content.depth26`), so `tools/patch.ts` can vary them and older contents are untouched; `depth26Tuning(content)`
// falls back to the stock values. Each rule module keeps its own tables; this block only repeats the tunable numbers.

/** One flag per v26 lane (§1). All are absent before v26; the v26 content sets every one of them. */
export type DepthFlags = {
  /** P1 §2: singles relay battles, equal-size gyms, beatable guardians, lineups and win estimates. */
  teamBattles?: true;
  /** P3 §3: the ChallengeRival duel (friendly / serious stakes), the doorstep duel, the rival at the conference. */
  rivalDuels?: true;
  /** P2 §4.2: candy evolutions score less, a "final evolution" era milestone. */
  evolutionGoals?: true;
  /** D §5.1: rush production, Pokémon Center, special training, TMs. */
  goldSinks?: true;
  /** D §5.2: contest seasons and the AI's cultural defence. */
  contestSeasons?: true;
  /** D §5.3: the legend-wonder race in the view. */
  legendRace?: true;
  /** D §5.4: Max Raid dens. */
  raids?: true;
  /** C2 §7.2: one Pokémon and one logistics unit may share a tile. */
  stacking?: true;
  /** O §8: three Poké Balls when domestication is researched. */
  openingGift?: true;
};
export const DEPTH_FLAGS: Required<DepthFlags> = {
  teamBattles: true, rivalDuels: true, evolutionGoals: true, goldSinks: true, contestSeasons: true, legendRace: true, raids: true, stacking: true, openingGift: true,
};

// ---------- Lane 2: late game (§5), tile sharing (§7.2), the opening gift (§8) ----------
export type LateGameTuning = {
  /** §5.1 RushProduction: gold per production point left (buildings / units), percent while at war. */
  rushBuildingGold: number; rushUnitGold: number; rushWarPercent: number;
  /** §5.1 RushRecovery: gold per recovery round left, at most `recoveryMaxGold`. */
  recoveryGold: number; recoveryMaxGold: number;
  /** §5.1 SpecialTraining: gold, XP gained, rounds between two trainings of one Pokémon. */
  trainingGold: number; trainingXp: number; trainingCooldown: number;
  /** §5.1 TeachMove: price for stage 1–2 and stage 3. */
  tmGold: number; tmFinalGold: number;
  /** §5.2 contest seasons: first round, interval, announcement lead, placing rewards (1st, 2nd, 3rd), every other entrant. */
  seasonFirstRound: number; seasonInterval: number; seasonAnnounce: number; seasonRewards: [number, number, number]; seasonEntryAppeal: number;
  /** §5.2 entry score: per matching type (at most two), per stage, per hall (at most `seasonHallCap`). */
  seasonTypePoints: number; seasonStagePoints: number; seasonHallPoints: number; seasonHallCap: number;
  /** §5.2 AI cultural defence: a rival at this percent of its contest target. */
  defencePercent: number;
  /** §5.4 raids: first round, interval, rounds a den stays, boss HP (base + per living civilization), minimum distance to capitals. */
  raidFirstRound: number; raidInterval: number; raidRounds: number; raidBaseHp: number; raidHpPerCiv: number; raidCapitalDistance: number;
  /** §5.4 raid rewards: gold per 10% share (at most `raidMaxGold`) to each civilization with at least `raidMinSharePercent`. */
  raidShareGold: number; raidMaxGold: number; raidMinSharePercent: number;
  /** §5.5 the near-victory warning threshold (percent of a victory route). */
  watchPercent: number;
  /** §7.2 the AI escorts settlers while it has fewer cities than this. */
  escortMaxCities: number;
  /** §8 Poké Balls given when domestication is researched. */
  giftBalls: number;
};
export const LATE_GAME_TUNING: LateGameTuning = {
  rushBuildingGold: 4, rushUnitGold: 3, rushWarPercent: 100,
  recoveryGold: 15, recoveryMaxGold: 45,
  trainingGold: 40, trainingXp: 40, trainingCooldown: 8,
  tmGold: 60, tmFinalGold: 100,
  seasonFirstRound: 45, seasonInterval: 15, seasonAnnounce: 5, seasonRewards: [60, 30, 15], seasonEntryAppeal: 5,
  seasonTypePoints: 20, seasonStagePoints: 10, seasonHallPoints: 5, seasonHallCap: 4,
  defencePercent: 60,
  raidFirstRound: 90, raidInterval: 20, raidRounds: 3, raidBaseHp: 250, raidHpPerCiv: 25, raidCapitalDistance: 5,
  raidShareGold: 60, raidMaxGold: 180, raidMinSharePercent: 10,
  watchPercent: 75,
  escortMaxCities: 4,
  giftBalls: 3,
};

export type Depth26Tuning = {
  /** §2.2 gym leader team power in percent of the v24 / v25 table (equal-size relay battles). */
  gymPowerPercent: number;
  /** §2.2 guardian HP in percent of its species' HP at the lowest and highest sanctuary challenge power (linear in between). */
  guardianHpPercent: [number, number];
  /** §2.2 Elite Four and champion team power in percent of the v24 / v25 table (relay battles). */
  eliteFourPowerPercent: number;
  /** §2.2 conference NPC power: base, per season and per slot (the v24 table is 500 / 40 / 20). */
  npcBasePower: number; npcSeasonPower: number; npcSlotPower: number;
  /** §2.1 veteran bonus (历练): +1 attack and defence per `veteranXp` XP, at most `veteranCap`. */
  veteranXp: number; veteranCap: number;
  /** §3.1 rival duels: reward share of a friendly win (percent), the serious-loss prize (percent of the treasury, cap per visit). */
  sparRewardPercent: number; prizePercent: number; prizePerVisit: number;
  /** §3.1 the rival at the conference (4th visit): power over the season's NPC power. */
  conferenceRivalPower: number;
  /** §5, §7.2, §8 the late-game, tile-sharing and opening-gift knobs (lane 2). */
  late: LateGameTuning;
};
export const DEPTH26_TUNING: Depth26Tuning = {
  gymPowerPercent: 80, guardianHpPercent: [150, 200], eliteFourPowerPercent: 100,
  npcBasePower: 500, npcSeasonPower: 40, npcSlotPower: 20,
  veteranXp: 50, veteranCap: 5,
  sparRewardPercent: 50, prizePercent: 20, prizePerVisit: 30,
  conferenceRivalPower: 60,
  late: LATE_GAME_TUNING,
};
/** The tuning a content carries (the stock values when it has none). */
export const depth26Tuning = (content: { depth26?: Depth26Tuning } | undefined): Depth26Tuning => content?.depth26 ?? DEPTH26_TUNING;
/** The lane-2 knobs of a content (the stock values when it has none). */
export const lateTuning = (content: { depth26?: Depth26Tuning } | undefined): LateGameTuning => content?.depth26?.late ?? LATE_GAME_TUNING;
