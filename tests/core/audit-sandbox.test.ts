import { describe, expect, it } from 'vitest';
import { AuditSandbox } from '../../src/audit/sandbox.ts';
import { deserializeSave } from '../../src/app/save.ts';
import { replay } from '../../src/app/session.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import { inspectSystem } from '../../src/audit/inspect.ts';
import { AUDIT_SYSTEMS } from '../../src/audit/catalog.ts';
import { CONTENT, unitDefinition } from '../../src/content/units.ts';

describe('isolated audit sandbox', () => {
  it('reports charged upkeep and executable evolution candidates with the engine conditions', () => {
    const state = new AuditSandbox().getState();
    expect(Object.values(state.units).some(unit => unit.ownerId === null)).toBe(true);
    const chargedUpkeep = Object.values(state.units).filter(unit => unit.ownerId !== null)
      .reduce((total, unit) => total + unitDefinition(unit).upkeep, 0);
    expect(inspectSystem('s5-economy', state).metrics.find(metric => metric.label === '单位维护')?.value).toBe(chargedUpkeep);
    const unit = Object.values(state.units).find(unit => unit.ownerId === state.activePlayerId && unit.kind === 'pokemon')!;
    if (unit.kind !== 'pokemon') throw new Error('Expected starter');
    const evolution = CONTENT.species[unit.speciesId].evolution!;
    unit.xp = evolution.xp; state.players[state.activePlayerId].gold = evolution.gold;
    unit.actionLeft = 0;
    expect(inspectSystem('s11-evolution', state).metrics.find(metric => metric.label === '当前可进化')?.value).toBe(0);
    unit.actionLeft = 1;
    expect(inspectSystem('s11-evolution', state).metrics.find(metric => metric.label === '当前可进化')?.value).toBe(1);
  });
  it('every system inspector preserves the complete authority state before and after the game ends', () => {
    const sandbox = new AuditSandbox();
    for (const completed of [false, true]) {
      if (completed) for (let turn = 0; turn < 400 && !sandbox.getState().outcome; turn++) sandbox.execute({ type: 'EndTurn' });
      const state = sandbox.getState(), before = canonicalSerialize(state);
      if (completed) expect(state.outcome).not.toBeNull();
      for (const system of AUDIT_SYSTEMS) {
        const inspection = inspectSystem(system.id, state);
        expect(inspection.metrics.length).toBeGreaterThan(0);
        expect(JSON.stringify(inspection.data)).not.toContain('No state inspector is registered');
        expect(canonicalSerialize(state)).toBe(before);
      }
    }
  });
  it('rejects malformed debug payloads before they can reach engine mutations', () => {
    for (const action of [null, { type: 'Move' }, { type: 'RespondPeace', targetPlayerId: 1, accept: 'false' },
      { type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: NaN }, { type: 'SetResearch', techId: '__proto__' },
      { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'pokemon', defId: 'unknown' } }] }]) {
      expect(() => parseAuditAction(action)).toThrow();
    }
    expect(parseAuditAction({ type: 'RespondPeace', targetPlayerId: 1, accept: false })).toEqual({ type: 'RespondPeace', targetPlayerId: 1, accept: false });
    expect(parseAuditAction({ type: 'Move', unitId: 1, to: { q: 2, r: 3, extra: 'discard' }, actorId: 99 })).toEqual({ type: 'Move', unitId: 1, to: { q: 2, r: 3 } });
  });
  it('previews a transaction without consuming RNG, commands, state or undo history', () => {
    const sandbox = new AuditSandbox();
    const before = sandbox.save();
    expect(sandbox.execute({ type: 'EndTurn' }, true).ok).toBe(true);
    expect(sandbox.save()).toBe(before);
    expect(sandbox.trace).toEqual([]);
    expect(sandbox.canUndo).toBe(false);
  });
  it('exports replayable commands for all civilizations and undoes exactly', () => {
    const sandbox = new AuditSandbox();
    const before = sandbox.save();
    sandbox.execute({ type: 'EndTurn' });
    expect(sandbox.getState().activePlayerId).toBe(1);
    sandbox.aiStep();
    expect(canonicalSerialize(replay(sandbox.getLog()))).toBe(canonicalSerialize(sandbox.getState()));
    sandbox.undo(); sandbox.undo();
    expect(sandbox.save()).toBe(before);
    expect(sandbox.trace).toEqual([]);
  });
  it('records a rejection without changing authoritative state or accepted commands', () => {
    const sandbox = new AuditSandbox();
    const before = sandbox.save();
    expect(sandbox.execute({ type: 'FoundCity', unitId: -1 })).toEqual({ ok: false, reason: 'unit-unavailable' });
    expect(sandbox.save()).toBe(before);
    expect(sandbox.trace[0]).toMatchObject({ accepted: false, reason: 'unit-unavailable' });
    sandbox.undo(); expect(sandbox.trace).toEqual([]);
  });
  it('imports, clones, resets, and preserves the original save independently', () => {
    const original = new AuditSandbox();
    original.execute({ type: 'EndTurn' });
    const text = original.save();
    const sandbox = new AuditSandbox(text);
    const exposed = sandbox.getState(); exposed.round = 99;
    sandbox.aiStep(); sandbox.reset();
    expect(sandbox.save()).toBe(text);
    expect(original.save()).toBe(text);
    expect(deserializeSave(sandbox.save()).state.round).toBe(1);
    expect(sandbox.canUndo).toBe(false);
  });
});
