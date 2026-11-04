import type { ExpansionAction } from './expansion-model.ts';
import { ROSTER_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { IMPROVEMENT_IDS } from '../content/improvements.ts';
import { CHARTER_IDS, GOVERNMENT_IDS, POLICY_IDS } from '../content/policies.ts';
import { ESSENCE_IDS, TYPE_ESSENCE } from '../content/essences.ts';
import { WEATHER_IDS } from '../content/era-abilities.ts';
import { RARE_BERRY_IDS } from '../content/rare-berries.ts';
import { LEGEND_IDS, TENET_IDS } from '../content/faith-legends.ts';
import { PROMOTION_TRAIT_IDS } from '../content/promotions.ts';

type Fields = Record<string, 'id' | 'ids' | 'string' | 'boolean' | 'policyIds' | 'tenets' | readonly string[]>;
export function expansionActionFields(content: Content = ROSTER_CONTENT): Record<ExpansionAction['type'], Fields> {
  return {
  UseLeaderAbility: {}, RecruitLeaderUnit: { cityId: 'id' }, BuildLeaderBuilding: { cityId: 'id' },
  ClearNest: { unitId: 'id', nestId: 'id' },
  OfferToOverlord: { overlordId: 'id', cityId: 'id', currency: ['food', 'gold'] },
  HarvestResource: { unitId: 'id', tileIndex: 'id' },
  UseEvolutionStone: { unitId: 'id', intoSpeciesId: Object.keys(content.species), stoneId: ['fireStone', 'waterStone', 'leafStone', 'thunderStone', 'moonStone'] },
  MakeOffering: { cityId: 'id', resource: ['food', 'gold'] },
  SummonPhantom: { category: ['scientist', 'engineer', 'merchant', 'general', 'artist'] },
  ActivatePhantom: { phantomId: 'string', cityId: 'id', techId: Object.keys(content.techs), unitIds: 'ids' },
  EstablishSanctuary: { siteId: 'string', unitId: 'id' },
  ChallengeGuardian: { siteId: 'string', unitIds: 'ids' },
  RegisterChampionshipTeam: { unitIds: 'ids' },
  ProposeAlliance: { targetPlayerId: 'id' }, RespondAlliance: { targetPlayerId: 'id', accept: 'boolean' },
  DissolveAlliance: { targetPlayerId: 'id' }, BetrayAlliance: { targetPlayerId: 'id' },
    ProposeTrade: { targetPlayerId: 'id' }, RespondTrade: { targetPlayerId: 'id', accept: 'boolean' },
  ImproveTile: { unitId: 'id', tileIndex: 'id', kind: IMPROVEMENT_IDS },
  SetCharter: { charterId: CHARTER_IDS },
  SetPolicies: { policyIds: 'policyIds' },
  SetGovernment: { governmentId: GOVERNMENT_IDS },
  BuildGym: { cityId: 'id', essence: ESSENCE_IDS },
  SummonWeather: { cityId: 'id', weather: WEATHER_IDS },
  MegaEvolve: { unitId: 'id' }, PrimeZMove: { unitId: 'id' }, Dynamax: { unitId: 'id' },
  Terastallize: { unitId: 'id', typeId: Object.keys(TYPE_ESSENCE) },
  ReclaimCity: { cityId: 'id' },
  GiftBerry: { targetPlayerId: 'id', berry: RARE_BERRY_IDS },
  BuildContestHall: { cityId: 'id' }, HoldContest: {},
  FoundFaith: { legend: LEGEND_IDS, tenets: 'tenets' }, SpreadFaith: { cityId: 'id' },
  PromoteUnit: { unitId: 'id', trait: PROMOTION_TRAIT_IDS },
  EstablishTradeRoute: { unitId: 'id', toCityId: 'id' },
  };
}
export const EXPANSION_ACTION_FIELDS: Record<ExpansionAction['type'], Fields> = expansionActionFields();
export function expansionActionType(type: unknown): type is ExpansionAction['type'] {
  return typeof type === 'string' && Object.hasOwn(EXPANSION_ACTION_FIELDS, type);
}
export function isExpansionAction(action: { type: unknown }): action is ExpansionAction {
  return expansionActionType(action.type);
}
export function parseExpansionAction(input: unknown, content: Content = ROSTER_CONTENT): ExpansionAction {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('type' in input) || !expansionActionType(input.type)) throw new Error('Unknown expansion action');
  const value = input as Record<string, unknown>, fields = expansionActionFields(content)[input.type];
  const output: Record<string, unknown> = { type: input.type };
  for (const [key, rule] of Object.entries(fields)) {
    const item = value[key];
    if (input.type === 'ActivatePhantom' && key !== 'phantomId' && item === undefined) continue;
    const id = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    const valid = rule === 'id' ? id(item) : rule === 'ids' ? Array.isArray(item) && item.length <= 6 && item.every(id) && new Set(item).size === item.length
      : rule === 'string' ? typeof item === 'string' && item.length > 0 && item.length <= 100
      : rule === 'boolean' ? typeof item === 'boolean'
      : rule === 'tenets' ? Array.isArray(item) && item.length === 2 && item.every(value => typeof value === 'string' && (TENET_IDS as readonly string[]).includes(value)) && new Set(item).size === 2
      : rule === 'policyIds' ? Array.isArray(item) && item.length <= 12 && item.every(value => typeof value === 'string' && (POLICY_IDS as readonly string[]).includes(value)) && new Set(item).size === item.length
      : typeof item === 'string' && rule.includes(item);
    if (!valid) throw new Error(`Invalid expansion action field: ${key}`);
    output[key] = item;
  }
  return JSON.parse(JSON.stringify(output)) as ExpansionAction;
}
