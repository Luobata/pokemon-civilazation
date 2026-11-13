import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { leadersFor, parseRegionalDexArgs, poolMatrix, regionalDexReport, showDraw } from '../../tools/regional-dex.ts';
import { balanceCases, createObserver, parseBalanceArgs, PRESETS, playJob, readGameRecord } from '../../tools/balance-run.ts';
import type { BalanceConfig } from '../../tools/balance-run.ts';
import { gameMetrics, speciesPeakShares, speciesTable, lineWinDeltas, estimate } from '../../tools/balance-metrics.ts';
import { stableSeed } from '../../src/core/civilization-systems.ts';
import { contentFor } from '../../src/content/units.ts';

const scratch = mkdtempSync(join(tmpdir(), 'regional-dex-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test('regional-dex tool: 50 seeds, every constraint met, gaps and single-candidate cells listed, --show prints a seed', () => {
  const report = regionalDexReport({ mode: 'simple-v1', seeds: Array.from({ length: 50 }, (_, index) => index + 1), leaders: 'rotation' });
  expect(report.json.met).toBe(50);
  expect(report.json.gaps).toEqual(['快速3阶', '侦察3阶', '飞行1阶']);
  expect(report.markdown).toContain('## 6. 招募槽');
  expect((report.json.jaccard as { median: number }).median).toBeLessThan(0.8);
  expect(poolMatrix('full-v1').find(row => row.role === 'fast')!.stages[2].any).toEqual(['dragapult', 'weavile']);
  expect(showDraw({ mode: 'simple-v1', seeds: [], leaders: ['oak', 'misty'] }, 31)).toContain('## 种子 31');
  expect(leadersFor('rotation', 31)).toHaveLength(4);
  expect(parseRegionalDexArgs(['--eras', 'full', '--seeds', '1-1000', '--leaders', 'oak,misty', '--gaps'])).toMatchObject({ mode: 'full-v1', leaders: ['oak', 'misty'], gapsOnly: true });
  expect(() => parseRegionalDexArgs(['--leaders', 'ash'])).toThrow();
}, 120_000);

test('balance-run --dex-mode rotation gives every seed × rotation its own dexSeed; v<25 refuses it', () => {
  const parsed = parseBalanceArgs(['--gameplay', '25', '--dex-mode', 'rotation', '--out', '/tmp/x'], 64);
  expect(parsed.config.dexMode).toBe('rotation');
  expect(() => parseBalanceArgs(['--gameplay', '24', '--dex-mode', 'rotation', '--out', '/tmp/x'], 64)).toThrow();
  const cases = balanceCases({ ...PRESETS.gate, gameplay: 25, dexMode: 'rotation' });
  expect(cases).toHaveLength(216);
  expect(cases[0].setup.dexSeed).toBe(stableSeed(31, 0, 'gate-dex'));
  expect(new Set(cases.map(item => item.setup.dexSeed)).size).toBe(72);
  expect(balanceCases({ ...PRESETS.gate, gameplay: 25 })[0].setup.dexSeed).toBeUndefined();
});

test('a v25 game record carries the regional Pokédex, species peaks and appeal; metrics read them', () => {
  const tiny: BalanceConfig = { ...PRESETS.gate, gameplay: 25, width: 16, height: 12, rounds: 100, players: 2, seeds: [1], dexMode: 'rotation' };
  const job = balanceCases(tiny).find(item => item.id === 's1-aggressive-r0')!;
  const file = join(scratch, 'v25.json');
  expect(playJob({ case: job, patch: null, file }).status).toBe('completed');
  const record = readGameRecord(file);
  expect(record.roster25!.dex).toEqual([...contentFor(job.setup).regionalDex!.speciesIds]);
  expect(record.roster25!.peakSpecies).toHaveLength(2);
  const metrics = gameMetrics(record);
  expect(metrics.roster!.dex.length).toBeGreaterThan(40);
  expect(metrics.seats[0].peakSpecies).toBeDefined();
  expect(metrics.rivals).toHaveLength(2);
  expect(speciesPeakShares([metrics]).length).toBeGreaterThan(0);
  expect(speciesTable([metrics]).length).toBe(metrics.roster!.dex.length);
  expect(lineWinDeltas([metrics], [{ id: 'bulbasaur', speciesIds: ['bulbasaur'] }])[0].outSeats).toBe(0);
  expect(estimate([metrics], 'topSpeciesShare').value).toBeGreaterThan(0);
  // v24 observers record no species data.
  expect(createObserver(contentFor({ ...job.setup, gameplayVersion: 24, dexSeed: undefined })).roster25()).toBeUndefined();
}, 300_000);
