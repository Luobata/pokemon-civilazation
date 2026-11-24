import { describe, expect, test } from 'vitest';
import { parseAuditAction } from '../../src/audit/commands.ts';
import { GAME_CONTENT } from '../../src/content/units.ts';
import { EXPANSION_ACTION_FIELDS, expansionActionFields, parseExpansionAction } from '../../src/core/expansion-commands.ts';
import { isCommandAction, validateCommandRequest } from '../../src/network/contract.ts';

describe('content-aware action parsing', () => {
  test('species and stone evolution parse according to the active content table', () => {
    const restricted = structuredClone(GAME_CONTENT);
    delete restricted.species.magnemite;
    delete restricted.species.clefable;
    const queue = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'pokemon' as const, defId: 'magnemite' } }] };
    expect(parseAuditAction(queue, GAME_CONTENT)).toEqual(queue);
    expect(() => parseAuditAction(queue, restricted)).toThrow(/命令字段无效/u);

    const stone = { type: 'UseEvolutionStone', unitId: 2, intoSpeciesId: 'clefable', stoneId: 'moonStone' };
    expect(parseAuditAction(stone, GAME_CONTENT)).toEqual(stone);
    expect(parseExpansionAction(stone, GAME_CONTENT)).toEqual(stone);
    expect(() => parseAuditAction(stone, restricted)).toThrow(/Invalid expansion action field/u);
    expect(EXPANSION_ACTION_FIELDS.UseEvolutionStone.intoSpeciesId).toContain('clefable');
    expect(expansionActionFields(restricted).UseEvolutionStone.intoSpeciesId).not.toContain('clefable');
  });

  test('district commands keep their tile index and reject malformed fields', () => {
    const action = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: 42 } }] };
    expect(validateCommandRequest({ expectedSeq: 3, action })).toEqual({ expectedSeq: 3, action });
    expect(isCommandAction({ ...action, orders: [{ item: { kind: 'district', defId: 'unknown', tileIndex: 42 } }] })).toBe(false);
    expect(isCommandAction({ ...action, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: 0.5 } }] })).toBe(false);
  });

  test('parsers default to GAME_CONTENT and still reject unknown canonical fields or missing species', () => {
    const queue = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'pokemon' as const, defId: 'clefairy' } }] };
    expect(parseAuditAction(queue)).toEqual(queue);
    expect(isCommandAction(queue)).toBe(true);

    const extra = { ...queue, unknown: true };
    expect(isCommandAction(extra)).toBe(false);
    expect(validateCommandRequest({ expectedSeq: 3, action: extra })).toBeNull();
    expect(validateCommandRequest({ expectedSeq: 3, action: queue })).toEqual({ expectedSeq: 3, action: queue });
    const withoutClefairy = structuredClone(GAME_CONTENT);
    delete withoutClefairy.species.clefairy;
    expect(validateCommandRequest({ expectedSeq: 3, action: queue }, withoutClefairy)).toBeNull();
  });
});
