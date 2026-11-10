/**
 * Sensitivity sweep (docs/design/review-2026-11/4-balance.md §3.2): one balance run per parameter combination (plus the stock
 * rules), all on the same games, then a response table "value → conquest / median end / round-60 leader …".
 *
 *   node tools/balance-sweep.ts --param balance.city.defense=50,60,70 --param ai.aggressiveWarStrength=1250,1500 --out /tmp/balance/sweep-defense
 *
 * Parameters are `tools/patch.ts` leaves (validated against the gameplay version's content). Default games: preset `sweep`
 * (2 seeds × 9 rotations × 3 personalities = 54 on 40×26 / 200); any `balance-run` flag overrides it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentFor } from '../src/content/units.ts';
import type { JsonValue } from '../src/core/snapshot.ts';
import { balanceCases, finalizeRun, formatSeeds, parseWorkers, prepareRun, resolveConfig, runJobs, splitFlags } from './balance-run.ts';
import type { BalanceConfig, BalanceJob, BalanceManifest } from './balance-run.ts';
import { acceptance, delta, estimate, measure } from './balance-metrics.ts';
import { formatDelta, formatValue, loadBalance } from './balance-report.ts';
import type { BalanceData } from './balance-report.ts';
import { parsePatch } from './patch.ts';

export type SweepParam = { path: string; values: (number | boolean)[] };
const SWEEP_USAGE = 'Usage: node tools/balance-sweep.ts --param <patch.path>=v1,v2[,…] [--param …] [balance-run flags: --preset --gameplay --size --rounds --eras --seeds --players --mix --workers] --out <new-directory>';
const SWEEP_FLAGS = ['--param', '--preset', '--gameplay', '--size', '--rounds', '--eras', '--seeds', '--players', '--mix', '--workers', '--out'];
const MAX_CELLS = 24;

export function parseParam(text: string): SweepParam {
  const match = /^([A-Za-z0-9_.]+)=(.+)$/.exec(text);
  if (!match) throw new Error(`--param: expected path=v1,v2, got "${text}"`);
  const values = match[2].split(',').map(item => {
    if (item === 'true' || item === 'false') return item === 'true';
    if (!/^-?\d+$/.test(item)) throw new Error(`--param ${match[1]}: values are integers or true/false, got "${item}"`);
    return Number(item);
  });
  if (new Set(values).size !== values.length) throw new Error(`--param ${match[1]}: duplicate value`);
  return { path: match[1], values };
}
/** Nested patch object for `path = value`. */
export function patchFor(path: string, value: number | boolean): Record<string, JsonValue> {
  return path.split('.').reduceRight<JsonValue>((inner, key) => ({ [key]: inner }), value) as Record<string, JsonValue>;
}
function mergePatch(target: Record<string, JsonValue>, source: Record<string, JsonValue>): Record<string, JsonValue> {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) target[key] = mergePatch((target[key] ?? {}) as Record<string, JsonValue>, value as Record<string, JsonValue>);
    else target[key] = value;
  }
  return target;
}
/** The value a path has in the stock rules of this setup (`ai.*` from the AI thresholds, `settler.*` from the settler unit). */
export function stockValue(config: BalanceConfig, path: string): number | boolean {
  const { content, ai } = parsePatch({}, contentFor(balanceCases(config)[0].setup));
  const [head, ...rest] = path.split('.');
  let node: unknown = head === 'ai' ? ai : head === 'settler' ? content.units.settler : (content as unknown as Record<string, unknown>)[head];
  for (const key of rest) node = (node as Record<string, unknown> | undefined)?.[key];
  if (typeof node !== 'number' && typeof node !== 'boolean') throw new Error(`--param ${path}: not a patchable number or boolean`);
  return node;
}
export type SweepCell = { name: string; values: Record<string, number | boolean>; patch: Record<string, JsonValue> | null; stock: boolean };
/** Cartesian product of the parameter values; a combination equal to the stock rules is the `stock` cell (always run). */
export function sweepCells(config: BalanceConfig, params: readonly SweepParam[]): SweepCell[] {
  const stock = Object.fromEntries(params.map(param => [param.path, stockValue(config, param.path)]));
  const base = contentFor(balanceCases(config)[0].setup);
  let combos: Record<string, number | boolean>[] = [{}];
  for (const param of params) combos = combos.flatMap(combo => param.values.map(value => ({ ...combo, [param.path]: value })));
  const cells: SweepCell[] = [{ name: 'stock', values: stock, patch: null, stock: true }];
  for (const values of combos) {
    if (params.every(param => values[param.path] === stock[param.path])) continue;
    const patch = params.reduce<Record<string, JsonValue>>((merged, param) => mergePatch(merged, patchFor(param.path, values[param.path])), {});
    parsePatch(patch, base); // validates path and range against this version's content
    cells.push({ name: params.map(param => `${param.path}=${String(values[param.path])}`).join('+'), values, patch, stock: false });
  }
  if (cells.length > MAX_CELLS) throw new Error(`--param: ${cells.length} cells; at most ${MAX_CELLS}`);
  return cells;
}
export function parseSweepArgs(args: readonly string[], cores?: number) {
  const { flags, repeated } = splitFlags(args, SWEEP_FLAGS, SWEEP_USAGE, ['--param']);
  if (!flags['--out'] || !repeated['--param']?.length) throw new Error(SWEEP_USAGE);
  const params = repeated['--param'].map(parseParam);
  if (new Set(params.map(param => param.path)).size !== params.length) throw new Error('--param: each path once');
  const { preset, config } = resolveConfig({ ...flags, '--preset': flags['--preset'] ?? 'sweep' });
  return { preset, config, params, workers: parseWorkers(flags['--workers'], cores), out: flags['--out'] };
}

function identicalGames(directory: string, stockDirectory: string): number {
  const names = readdirSync(resolve(directory, 'games')).filter(name => name.endsWith('.json'));
  return names.filter(name => readFileSync(resolve(directory, 'games', name)).equals(readFileSync(resolve(stockDirectory, 'games', name)))).length;
}
const RESPONSE_MEASURES = ['conquest', 'fullLength', 'endMedian', 'endedBefore80', 'leader60Won', 'leaderChanges', 'peakCities', 'thirdCityMedian', 'firstTechMedian', 'firstCityLostMedian'];
export function renderSweep(params: readonly SweepParam[], cells: readonly (SweepCell & { data: BalanceData; identical: number })[], command: string[]): string {
  const stock = cells.find(cell => cell.stock)!, config = stock.data.manifest.config;
  const rows = cells.map(cell => {
    const { checks, targets } = acceptance(cell.data.games, { players: config.players, mix: config.mix });
    const applicable = checks.filter(check => check.status !== 'n/a');
    return [cell.stock ? '**stock**' : '', ...params.map(param => String(cell.values[param.path])),
      ...RESPONSE_MEASURES.map(id => {
        const item = measure(id), value = estimate(cell.data.games, id);
        const change = cell.stock ? '' : ` (${formatDelta(delta(cell.data.games, stock.data.games, id), item.unit)})`;
        return `${formatValue(value.value, item.unit)}${change}`;
      }),
      `${applicable.filter(check => check.status === 'pass').length}/${applicable.length}`, `${targets.filter(check => check.status === 'pass').length}/${targets.length}`,
      cell.stock ? '—' : cell.identical === cell.data.games.length ? '**无影响**（逐局一致）' : `${cell.data.games.length - cell.identical}/${cell.data.games.length} 局记录不同`];
  });
  const headers = ['', ...params.map(param => `\`${param.path}\``), ...RESPONSE_MEASURES.map(id => measure(id).label), '§5 通过', '11 月目标', '与 stock 比'];
  return `# 参数扫描：${params.map(param => `\`${param.path}\` = ${param.values.join(' / ')}`).join('；')}

> 由 \`${command.join(' ')}\` 生成。gameplay v${config.gameplay}，${config.width}×${config.height} / ${config.rounds} 轮，${config.eras === 'simple' ? '精简' : '完整'}时代，种子 ${formatSeeds(config.seeds)}，${config.players} 方，${config.mix === 'same' ? '同性格' : '混合性格'}；每格 ${stock.data.games.length} 局，所有格子是同一批对局（同种子、同座位）。

括号里是相对 stock 的差值和 95% 区间（份额用 Newcombe，其余按种子配对 bootstrap）。"无影响"表示每一局都和 stock 逐字节一致：这个值在该版本的规则里没有被读到（或只在没发生的情况下才用到）。

| ${headers.join(' | ')} |
| ${headers.map(() => '---').join(' | ')} |
${rows.map(row => `| ${row.join(' | ')} |`).join('\n')}

每格的完整报告：\`node tools/balance-report.ts <格子目录> --baseline <stock 目录>\`。格子目录：
${cells.map(cell => `- ${cell.name}：\`${cell.data.directory}\``).join('\n')}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseSweepArgs(process.argv.slice(2)), root = resolve(args.out);
  if (existsSync(root)) throw new Error(`${root} already exists; use a new --out directory`);
  const cells = sweepCells(args.config, args.params);
  mkdirSync(resolve(root, 'cells'), { recursive: true });
  const command = ['node', 'tools/balance-sweep.ts', ...process.argv.slice(2)], started = Date.now();
  const prepared = cells.map(cell => ({ cell, directory: resolve(root, 'cells', cell.name),
    ...prepareRun(resolve(root, 'cells', cell.name), { preset: args.preset, config: args.config, workers: args.workers, command,
      patch: cell.patch ? { file: null, value: cell.patch } : null }) }));
  const jobs: BalanceJob[] = prepared.flatMap(item => item.jobs);
  console.log(`${cells.length} cells × ${prepared[0].jobs.length} games = ${jobs.length} games on ${args.workers} workers`);
  const timings = await runJobs(jobs, args.workers, (done, total, job, status) => { if (done % 10 === 0 || done === total || status !== 'completed') console.log(`${done}/${total} ${job.file} ${status}`); });
  let offset = 0;
  const manifests: BalanceManifest[] = prepared.map(item => {
    const slice = timings.slice(offset, offset + item.jobs.length);
    offset += item.jobs.length;
    return finalizeRun(item.directory, item.manifest, item.jobs, slice, Date.now() - started);
  });
  const stockDirectory = prepared[0].directory;
  const results = prepared.map(item => ({ ...item.cell, data: loadBalance(item.directory, false), identical: item.cell.stock ? 0 : identicalGames(item.directory, stockDirectory) }));
  writeFileSync(resolve(root, 'response.md'), renderSweep(args.params, results, command));
  writeFileSync(resolve(root, 'response.json'), JSON.stringify({ command, params: args.params, config: args.config, wallSeconds: Math.round((Date.now() - started) / 1000),
    cells: results.map(cell => ({ name: cell.name, values: cell.values, patch: cell.patch, identicalToStock: cell.stock ? null : cell.identical, games: cell.data.games.length,
      measures: Object.fromEntries(RESPONSE_MEASURES.map(id => [id, estimate(cell.data.games, id)])) })) }, null, 2) + '\n');
  console.log(resolve(root, 'response.md'));
  if (manifests.some(manifest => Object.keys(manifest.statuses ?? {}).some(status => status !== 'completed'))) process.exitCode = 1;
}
