import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import { DISTRICTS } from '../content/districts.ts';
import { expansionActionType, parseExpansionAction } from '../core/expansion-commands.ts';
import { ROSTER_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { Command } from '../core/model.ts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value);
const member = (value: unknown, table: object) => typeof value === 'string' && Object.hasOwn(table, value);
const integers = (value: unknown) => Array.isArray(value) && value.every(integer);
const ACTION_KEYS: Partial<Record<Command['action']['type'], string[]>> = {
  EndTurn: ['type'], Move: ['type', 'unitId', 'to'], FoundCity: ['type', 'unitId'],
  SetResearch: ['type', 'techId'], BuyBall: ['type', 'cityId', 'quantity', 'ballId'],
  AssignWork: ['type', 'cityId', 'workedTileIds', 'lockedTileIds'], SetProductionQueue: ['type', 'cityId', 'orders'],
  Attack: ['type', 'unitId', 'target'], Capture: ['type', 'unitId', 'targetUnitId', 'ballId'],
  Evolve: ['type', 'unitId', 'intoSpeciesId'], DeclareWar: ['type', 'targetPlayerId'],
  MakePeace: ['type', 'targetPlayerId'], RespondPeace: ['type', 'targetPlayerId', 'accept'],
};
const pick = (value: RecordValue, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
function production(value: unknown, content: Content): boolean {
  if (!record(value) || !record(value.item) || (value.orderId !== undefined && !integer(value.orderId))) return false;
  return value.item.kind === 'building' ? member(value.item.defId, content.buildings)
    : value.item.kind === 'pokemon' ? member(value.item.defId, content.species)
    : value.item.kind === 'district' ? member(value.item.defId, DISTRICTS) && integer(value.item.tileIndex)
    : value.item.kind === 'legend' ? member(value.item.defId, LEGEND_WONDERS)
    : value.item.kind === 'logistics' && (value.item.defId === 'settler' || value.item.defId === 'trader' || value.item.defId === 'builder') && (value.item.escortId === undefined || member(value.item.escortId, content.species));
}

/** Validate input shape; gameplay eligibility remains the engine's responsibility. */
export function parseAuditAction(value: unknown, content: Content = ROSTER_CONTENT): Command['action'] {
  if (!record(value)) throw new Error('命令需要 action 对象');
  if (expansionActionType(value.type)) return parseExpansionAction(value, content);
  let valid = false;
  switch (value.type) {
    case 'EndTurn': valid = true; break;
    case 'Move': valid = integer(value.unitId) && record(value.to) && integer(value.to.q) && integer(value.to.r); break;
    case 'FoundCity': valid = integer(value.unitId); break;
    case 'SetResearch': valid = member(value.techId, content.techs); break;
    case 'BuyBall': valid = integer(value.cityId) && integer(value.quantity) && member(value.ballId, content.balls); break;
    case 'AssignWork': valid = integer(value.cityId) && integers(value.workedTileIds) && integers(value.lockedTileIds); break;
    case 'SetProductionQueue': valid = integer(value.cityId) && Array.isArray(value.orders) && value.orders.every(order => production(order, content)); break;
    case 'Attack': valid = integer(value.unitId) && record(value.target) && (value.target.kind === 'unit' || value.target.kind === 'city') && integer(value.target.id); break;
    case 'Capture': valid = integer(value.unitId) && integer(value.targetUnitId) && member(value.ballId, content.balls); break;
    case 'Evolve': valid = integer(value.unitId) && member(value.intoSpeciesId, content.species); break;
    case 'DeclareWar': case 'MakePeace': valid = integer(value.targetPlayerId); break;
    case 'RespondPeace': valid = integer(value.targetPlayerId) && typeof value.accept === 'boolean'; break;
  }
  if (!valid) throw new Error('命令字段无效：请检查整数 ID、坐标、枚举值和布尔值');
  const clean = pick(value, ACTION_KEYS[value.type as Command['action']['type']]!);
  if (record(clean.to)) clean.to = pick(clean.to, ['q', 'r']);
  if (record(clean.target)) clean.target = pick(clean.target, ['kind', 'id']);
  if (Array.isArray(clean.orders)) clean.orders = clean.orders.map((order: RecordValue) => ({
    ...pick(order, ['orderId']), item: pick(order.item as RecordValue, (order.item as RecordValue).kind === 'district' ? ['kind', 'defId', 'tileIndex'] : (order.item as RecordValue).kind === 'logistics' ? ['kind', 'defId', 'escortId'] : ['kind', 'defId']),
  }));
  return structuredClone(clean) as Command['action'];
}
