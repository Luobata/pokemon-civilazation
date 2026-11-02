import type { WorldAction, WorldEvent, WorldState, WorldView } from './world-systems.ts';
import type { CivilizationAction, CivilizationEvent, CivilizationState, CivilizationView } from './civilization-systems.ts';
import type { LeaderAction, LeaderEvent, LeaderSystemsState, LeaderSystemsView } from './leader-systems.ts';
import type { ImprovementAction, ImprovementEvent, ImprovementState, ImprovementView } from './improvements.ts';
import type { DiscoveryEvent, DiscoveryState } from './discoveries.ts';
import type { PolicyAction, PolicyEvent, PolicyState, PolicyView } from './policies.ts';
import type { TechId } from '../content/economy.ts';

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
};
export type ExpansionView = { version: 1; world: WorldView; civilization: CivilizationView; leaders: LeaderSystemsView; improvements?: ImprovementView; discoveries?: TechId[]; policies?: PolicyView };
export type ExpansionAction = WorldAction | CivilizationAction | LeaderAction | ImprovementAction | PolicyAction;
export type ExpansionEvent = WorldEvent | CivilizationEvent | LeaderEvent | ImprovementEvent | DiscoveryEvent | PolicyEvent;
