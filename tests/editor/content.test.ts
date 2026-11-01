import { describe, expect, test } from 'vitest';
import { CONTENT, EXPANSION_CONTENT } from '../../src/content/units.ts';
import { canonicalSerialize, type JsonValue } from '../../src/core/snapshot.ts';
import { cloneContent, importEditorContent, validateD15, validateEditorContent } from '../../src/editor/content.ts';
import { maxUnitHp } from '../../src/core/unit.ts';
import { EditorSandbox, runIsolatedSimulation } from '../../src/editor/sandbox.ts';

describe('content editor engine', () => {
  test('starts from a deep expansion clone and never mutates the shared baseline', () => {
  const before = canonicalSerialize(structuredClone(EXPANSION_CONTENT) as unknown as JsonValue);
  expect(CONTENT.version).toBe('m3-v1');
  expect(EXPANSION_CONTENT.version).toBe('expansion-v1');
    const content = cloneContent();
    content.species.bulbasaur.maxHp += 1;
    expect(content.species.bulbasaur).not.toEqual(EXPANSION_CONTENT.species.bulbasaur);
    const sandbox = new EditorSandbox(content);
    sandbox.issue({ type: 'EndTurn' });
    sandbox.issue({ type: 'EndTurn' });
    expect(sandbox.seq).toBe(2);
    expect(sandbox.getView().round).toBe(2);
    expect(canonicalSerialize(structuredClone(EXPANSION_CONTENT) as unknown as JsonValue)).toBe(before);
  });

  test('rejects invalid JSON, shapes, budgets, and D15 violations', () => {
    expect(() => importEditorContent('{')).toThrow(/Invalid JSON/u);
    expect(() => validateEditorContent({})).toThrow(/content/u);
    const badBudget = cloneContent();
    badBudget.species.bulbasaur.maxHp += 16;
    expect(() => validateEditorContent(badBudget)).toThrow(/budget|trainCost|unit projection/u);

    const d15 = cloneContent();
    const defender = d15.species.geodude;
    defender.maxHp = 120;
    defender.defense = 30;
    expect(() => validateEditorContent(d15)).toThrow(/D15/u);
    expect(() => validateD15(d15.species)).toThrow(/D15/u);
  });

  test('rejects pokemon unit definitions that drift from their species definition', () => {
    const content = cloneContent();
    content.units.bulbasaur = { ...content.units.bulbasaur, name: ' drifted bulbasaur' };
    expect(() => validateEditorContent(content)).toThrow(/unit definition must exactly match its species/u);
  });

  test('a valid patch affects a real isolated simulation', () => {
    const content = cloneContent();
    const bulbasaur = content.species.bulbasaur;
    bulbasaur.maxHp += 10;
    bulbasaur.attack -= 10;
    const valid = validateEditorContent(content);
    expect(valid.species.bulbasaur.maxHp).toBe(EXPANSION_CONTENT.species.bulbasaur.maxHp + 10);
    const results = runIsolatedSimulation(valid);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.ok)).toBe(true);
    const starter = results.flatMap(result => result.view.units).find(unit => unit.kind === 'pokemon' && unit.speciesId === 'bulbasaur');
    expect(starter && maxUnitHp(starter, valid)).toBe(EXPANSION_CONTENT.species.bulbasaur.maxHp + 10);
  });
});
