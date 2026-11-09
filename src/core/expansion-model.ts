import type { DistrictState, DistrictView } from './districts.ts';
import type { WorldAction, WorldEvent, WorldState, WorldView } from './world-systems.ts';
import type { CivilizationAction, CivilizationEvent, CivilizationState, CivilizationView } from './civilization-systems.ts';
import type { LeaderAction, LeaderEvent, LeaderSystemsState, LeaderSystemsView } from './leader-systems.ts';
import type { ImprovementAction, ImprovementEvent, ImprovementState, ImprovementView } from './improvements.ts';
import type { DiscoveryEvent, DiscoveryState } from './discoveries.ts';
import type { PolicyAction, PolicyEvent, PolicyState, PolicyView } from './policies.ts';
import type { EssenceAction, EssenceEvent, EssenceState, EssenceView } from './essences.ts';
import type { EraAbilityAction, EraAbilityEvent, EraAbilityState, EraAbilityView } from './era-abilities.ts';
import type { BondAction, BondBreakdown, BondEvent, BondState } from './bonds.ts';
import type { RareBerryAction, RareBerryEvent, RareBerryState, RareBerryView } from './rare-berries.ts';
import type { ContestAction, ContestEvent, ContestState, ContestView } from './contests.ts';
import type { FaithAction, FaithEvent, FaithState, FaithView } from './faith-legends.ts';
import type { TechId } from '../content/economy.ts';
import type { EraHonorEvent, EraHonorState, EraHonorView } from './era-honors.ts';
import type { PromotionAction, PromotionEvent, PromotionState, PromotionView } from './promotions.ts';
import type { LegendEvent, LegendState, LegendView } from './legends.ts';
import type { CityNetworkAction, CityNetworkEvent, CityNetworkState, CityNetworkView } from './city-network.ts';
import type { OpeningEvent, OpeningState, OpeningView } from './opening.ts';
import type { DedicationAction, DedicationEvent } from './dedications.ts';
import type { PillageAction, PillageEvent } from './pillage.ts';

/** Opt-in rules pack. Absence preserves the legacy m5-v1 game and replay. */
export type ExpansionState = {
  version: 1;
  world: WorldState;
  civilization: CivilizationState;
  leaders: LeaderSystemsState;
  /** gameplayVersion >= 2 only. */
  improvements?: ImprovementState;
  /** gameplayVersion >= 2 only. */
  discoveries?: DiscoveryState;
  /** gameplayVersion >= 3 only. */
  policies?: PolicyState;
  /** gameplayVersion >= 4 only. */
  essences?: EssenceState;
  /** gameplayVersion >= 5 only. */
  eraAbilities?: EraAbilityState;
  /** gameplayVersion >= 6 only: cityId -> bond. */
  bonds?: BondState;
  /** gameplayVersion >= 7 only. */
  rareBerries?: RareBerryState;
  /** gameplayVersion >= 8 only. */
  contests?: ContestState;
  /** gameplayVersion >= 9 only. */
  faith?: FaithState;
  /** gameplayVersion >= 10 only. */
  districts?: DistrictState;
  /** gameplayVersion >= 12 only (era games). */
  eraHonors?: EraHonorState;
  /** gameplayVersion >= 13 only. */
  promotions?: PromotionState;
  /** gameplayVersion >= 15 only (era games). */
  legends?: LegendState;
  /** gameplayVersion >= 17 only. */
  cityNetwork?: CityNetworkState;
  /** gameplayVersion >= 21 only. */
  opening?: OpeningState;
};
export type ExpansionView = { version: 1; world: WorldView; civilization: CivilizationView; leaders: LeaderSystemsView; improvements?: ImprovementView; discoveries?: TechId[]; policies?: PolicyView; essences?: EssenceView; eraAbilities?: EraAbilityView; bonds?: Record<number, { bond: number; pressure: BondBreakdown }>; rareBerries?: RareBerryView; contests?: ContestView; faith?: FaithView; districts?: DistrictView; eraHonors?: EraHonorView; promotions?: PromotionView; legends?: LegendView; cityNetwork?: CityNetworkView; opening?: OpeningView };
export type ExpansionAction = WorldAction | CivilizationAction | LeaderAction | ImprovementAction | PolicyAction | EssenceAction | EraAbilityAction | BondAction | RareBerryAction | ContestAction | FaithAction | PromotionAction | CityNetworkAction | DedicationAction | PillageAction;
export type ExpansionEvent = WorldEvent | CivilizationEvent | LeaderEvent | ImprovementEvent | DiscoveryEvent | PolicyEvent | EssenceEvent | EraAbilityEvent | BondEvent | RareBerryEvent | ContestEvent | FaithEvent | EraHonorEvent | PromotionEvent | LegendEvent | CityNetworkEvent | OpeningEvent | DedicationEvent | PillageEvent;
