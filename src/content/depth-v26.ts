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
};
export const DEPTH26_TUNING: Depth26Tuning = {
  gymPowerPercent: 80, guardianHpPercent: [150, 200], eliteFourPowerPercent: 100,
  npcBasePower: 500, npcSeasonPower: 40, npcSlotPower: 20,
  veteranXp: 50, veteranCap: 5,
  sparRewardPercent: 50, prizePercent: 20, prizePerVisit: 30,
  conferenceRivalPower: 60,
};
/** The tuning a content carries (the stock values when it has none). */
export const depth26Tuning = (content: { depth26?: Depth26Tuning } | undefined): Depth26Tuning => content?.depth26 ?? DEPTH26_TUNING;
