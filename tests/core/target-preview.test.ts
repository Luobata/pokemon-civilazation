import { expect, test } from 'vitest';
import { CONTENT, EXPANSION_CONTENT } from '../../src/content/units.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameState } from '../../src/core/model.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { targetPreviews } from '../../src/browser/target-preview.ts';
import { reachableFixture } from '../browser/fixtures/reachable.ts';

const contentOf = (state: GameState) => state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT;

test.each(['attack', 'capture-success', 'capture-failure'])('the %s fixture command is offered on the target tile and accepted by the rules', name => {
  const fixture = reachableFixture(name), state = fixture.state, action = fixture.action!;
  const view = observe(state, state.activePlayerId, contentOf(state));
  const targetId = action.type === 'Attack' ? action.target.id : action.type === 'Capture' ? action.targetUnitId : -1;
  const target = state.units[targetId];
  if (!target || !isMapUnit(target)) throw new Error('fixture target must be on the map');
  const unitId = 'unitId' in action ? action.unitId : -1;
  const options = targetPreviews(view, unitId, hexToIndex(target.position, view.map)!).flatMap(preview => preview.options);
  const offered = options.find(option => option.ok && JSON.stringify(option.action) === JSON.stringify(action));
  expect(offered, JSON.stringify(options)).toBeDefined();
  const result = step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action: offered!.action! }, contentOf(state));
  expect(result.ok).toBe(true);
  if (action.type === 'Attack') {
    const preview = previewAttack(view, unitId, action.target);
    expect(preview.ok && offered!.text).toContain(`伤害 ${preview.ok ? preview.damage.min : 0}–${preview.ok ? preview.damage.max : 0}`);
  } else expect(offered!.text).toMatch(/成功率 \d+%/);
});

test('targets of a civilization at peace explain how to attack instead of offering it', () => {
  const fixture = reachableFixture('visible-ai'), state = fixture.state;
  const view = observe(state, 0, contentOf(state));
  const mine = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
  const foreign = view.units.find(unit => unit.ownerId !== null && unit.ownerId !== 0)!;
  expect(view.diplomacy.find(pair => [pair.a, pair.b].includes(foreign.ownerId!))?.status).toBe('peace');
  const [preview] = targetPreviews(view, mine.id, hexToIndex(foreign.position, view.map)!);
  expect(preview.options).toHaveLength(1);
  expect(preview.options[0]).toMatchObject({ ok: false });
  expect(preview.options[0].text).toMatch(/和平中|已行动/);
  expect(targetPreviews(view, null, hexToIndex(foreign.position, view.map)!)).toEqual([]);
});
