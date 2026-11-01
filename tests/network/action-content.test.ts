import { describe, expect, test } from 'vitest';
import { parseAuditAction } from '../../src/audit/commands.ts';
import { CONTENT, EXPANSION_CONTENT } from '../../src/content/units.ts';
import { EXPANSION_ACTION_FIELDS, expansionActionFields, parseExpansionAction } from '../../src/core/expansion-commands.ts';
import { isCommandAction, validateCommandRequest } from '../../src/network/contract.ts';

describe('content-aware action parsing', () => {
  test('new species and stone evolution parse in expansion content only', () => {
    const queue = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'pokemon' as const, defId: 'magnemite' } }] };
    expect(parseAuditAction(queue, EXPANSION_CONTENT)).toEqual(queue);
    expect(() => parseAuditAction(queue, CONTENT)).toThrow(/命令字段无效/u);

    const stone = { type: 'UseEvolutionStone', unitId: 2, intoSpeciesId: 'clefable', stoneId: 'moonStone' };
    expect(parseAuditAction(stone, EXPANSION_CONTENT)).toEqual(stone);
    expect(parseExpansionAction(stone, EXPANSION_CONTENT)).toEqual(stone);
    expect(() => parseAuditAction(stone, CONTENT)).toThrow(/Invalid expansion action field/u);
    expect(EXPANSION_ACTION_FIELDS.UseEvolutionStone.intoSpeciesId).toContain('clefable');
    expect(expansionActionFields(CONTENT).UseEvolutionStone.intoSpeciesId).not.toContain('clefable');
  });

  test('parsers default to expansion content and still reject unknown canonical fields', () => {
    const queue = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'pokemon' as const, defId: 'clefairy' } }] };
    expect(parseAuditAction(queue)).toEqual(queue);
    expect(isCommandAction(queue)).toBe(true);

    const extra = { ...queue, unknown: true };
    expect(isCommandAction(extra)).toBe(false);
    expect(validateCommandRequest({ expectedSeq: 3, action: extra })).toBeNull();
    expect(validateCommandRequest({ expectedSeq: 3, action: queue })).toEqual({ expectedSeq: 3, action: queue });
    expect(validateCommandRequest({ expectedSeq: 3, action: queue }, CONTENT)).toBeNull();
  });
});
