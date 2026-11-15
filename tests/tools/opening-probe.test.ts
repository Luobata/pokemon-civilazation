import { expect, test } from 'vitest';
import { PRESETS, balanceCases } from '../../tools/balance-run.ts';
import { probeOpening, summarizeOpenings } from '../../tools/opening-probe.ts';

test('opening probe: one gate opening, deterministic, summarized and paired', () => {
  const match = balanceCases({ ...PRESETS.gate, gameplay: 27, seeds: [31], dexMode: 'rotation' })[0];
  const game = probeOpening(match, 6);
  expect(probeOpening(match, 6)).toEqual(game);
  expect(game.civs).toHaveLength(4);
  for (const civ of game.civs) expect(civ.group).toBe(match.group);
  const lines = summarizeOpenings([game], [game]);
  expect(lines[0]).toBe('1 games, 4 civilizations');
  expect(lines.at(-1)).toBe('paired with the baseline: third city earlier 0, later 0');
}, 120_000);
