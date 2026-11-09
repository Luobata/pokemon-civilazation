/**
 * Markdown report for a `balance-run` directory (docs/design/review-2026-11/4-balance.md §3.2, §5):
 *
 *   node tools/balance-report.ts /tmp/balance/gate-v23 --anchor /tmp/balance/gate-v22 --out docs/design/balance/gate-v23.md
 *
 * `--baseline` = the previous version, `--anchor` = a frozen reference; each adds a delta column with a 95% interval.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMBAT_ROLES } from './telemetry.ts';
import type { BalanceManifest } from './balance-run.ts';
import { formatSeeds, splitFlags } from './balance-run.ts';
import { acceptance, BOOTSTRAP_RESAMPLES, CURVE_FIELDS, curveTable, delta, estimate, leaderTable, measure, outcomeTable, personalityTable, roleShares } from './balance-metrics.ts';
import type { Check, CurveRow, Delta, Estimate, GameMetrics, OutcomeKind } from './balance-metrics.ts';
import { newcombeInterval } from './balance-metrics.ts';

export type BalanceData = { directory: string; manifest: BalanceManifest; games: GameMetrics[]; curves: CurveRow[] };
const readJsonl = <T>(file: string): T[] => readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as T);
export function loadBalance(directory: string, withCurves = true): BalanceData {
  const root = resolve(directory);
  return { directory: root, manifest: JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as BalanceManifest,
    games: readJsonl<GameMetrics>(resolve(root, 'metrics.jsonl')), curves: withCurves ? readJsonl<CurveRow>(resolve(root, 'curves.jsonl')) : [] };
}

const OUTCOME_NAMES: Record<OutcomeKind, string> = { conquest: '征服', score: '积分（打满轮数）', pokedex: '图鉴', contest: '华丽大赛', faith: '信仰', championship: '冠军赛', origin: '起源', playerDefeat: '玩家失败' };
const PERSONALITY_NAMES: Record<string, string> = { expansion: '扩张', aggressive: '好战', conservative: '保守' };
const LEADER_NAMES: Record<string, string> = { oak: '大木', lance: '渡', jenny: '君莎', joy: '乔伊', brock: '小刚', misty: '小霞', steven: '大吾', jasmine: '小椿', giovanni: '坂木' };
const ROLE_NAMES: Record<string, string> = { ranged: '远程', melee: '近战', scout: '侦察', fast: '快速', siege: '攻城', naval: '水面', air: '飞行' };
const CURVE_NAMES: Record<string, string> = { cities: '城市', population: '人口', food: '粮', production: '产', gold: '金', research: '研', techs: '科技', army: '军队', score: '分数' };

export function formatValue(value: number | null, unit: 'share' | 'round' | 'number'): string {
  if (value === null || Number.isNaN(value)) return '—';
  if (value === Infinity) return '∞';
  if (unit === 'share') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'round') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value.toFixed(2).replace(/\.00$/, '');
}
const formatInterval = (interval: [number, number] | null, unit: 'share' | 'round' | 'number') =>
  interval ? `[${formatValue(interval[0], unit)}, ${formatValue(interval[1], unit)}]` : '';
export function formatDelta(change: Delta | null, unit: 'share' | 'round' | 'number'): string {
  if (!change || change.value === null) return '—';
  const sign = (value: number) => value === Infinity ? '+∞' : value === -Infinity ? '−∞' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${unit === 'share' ? (Math.abs(value) * 100).toFixed(1) : unit === 'round' ? Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1) : Math.abs(value).toFixed(2)}`;
  const body = `${sign(change.value)}${unit === 'share' ? ' pp' : ''}`;
  return change.interval ? `${body} [${sign(change.interval[0])}, ${sign(change.interval[1])}]` : body;
}
const STATUS_TEXT = { pass: '✓ 通过', fail: '✗ 未通过', 'n/a': '— 不适用' } as const;
const confidenceText = (check: Check) => check.confidence === 'marginal' ? '边缘（区间跨线）' : check.confidence === 'clear' ? '明确' : '';
function unitOf(check: Check): 'share' | 'round' | 'number' {
  return check.measure ? measure(check.measure).unit : 'share';
}
function checkValue(check: Check): string {
  if (check.measure) return `${formatValue(check.value, unitOf(check))} ${formatInterval(check.interval, unitOf(check))}`.trim();
  if (check.id === 'health') return String(check.value);
  return check.interval ? `${formatValue(check.interval[0], 'share')} – ${formatValue(check.interval[1], 'share')}` : '—';
}

type References = { baseline: BalanceData | null; anchor: BalanceData | null };
function deltaCells(id: string, data: BalanceData, refs: References): string[] {
  const unit = measure(id).unit;
  return [refs.baseline, refs.anchor].filter((ref): ref is BalanceData => ref !== null).map(ref => formatDelta(delta(data.games, ref.games, id), unit));
}
function refHeaders(refs: References): string[] {
  return [refs.baseline ? 'Δ 基线' : null, refs.anchor ? 'Δ 锚点' : null].filter((value): value is string => value !== null);
}
function table(headers: string[], rows: string[][], align?: string[]): string {
  return [`| ${headers.join(' | ')} |`, `| ${(align ?? headers.map(() => '---')).join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
}
function describe(data: BalanceData): string {
  const { manifest } = data, config = manifest.config;
  return `gameplay v${config.gameplay}，${config.width}×${config.height} / ${config.rounds} 轮，${config.eras === 'simple' ? '精简' : '完整'}时代，种子 ${formatSeeds(config.seeds)}，${config.players} 方，${config.mix === 'same' ? '同性格' : '混合性格'}，${manifest.games} 局${manifest.patch ? `，补丁 ${manifest.patch.sha256.slice(0, 12)}` : ''}`;
}
function comparable(data: BalanceData, ref: BalanceData): string | null {
  const a = data.manifest.config, b = ref.manifest.config;
  const differences = (['width', 'height', 'rounds', 'eras', 'players', 'mix'] as const).filter(key => a[key] !== b[key]).map(key => `${key} ${String(b[key])} → ${String(a[key])}`);
  if (formatSeeds(a.seeds) !== formatSeeds(b.seeds)) differences.push(`种子 ${formatSeeds(b.seeds)} → ${formatSeeds(a.seeds)}（不配对）`);
  return differences.length ? differences.join('，') : null;
}

function seedStability(data: BalanceData): string {
  const seeds = [...new Set(data.games.map(game => game.seed))].sort((a, b) => a - b);
  const half = Math.ceil(seeds.length / 2);
  const groups: [string, GameMetrics[]][] = [
    ...seeds.map(seed => [`种子 ${seed}`, data.games.filter(game => game.seed === seed)] as [string, GameMetrics[]]),
    ...(seeds.length >= 4 ? [[`前半 ${formatSeeds(seeds.slice(0, half))}`, data.games.filter(game => seeds.slice(0, half).includes(game.seed))],
      [`后半 ${formatSeeds(seeds.slice(half))}`, data.games.filter(game => seeds.slice(half).includes(game.seed))]] as [string, GameMetrics[]][] : []),
    ['只看轮换 0（district-smoke / v23 验收的抽法）', data.games.filter(game => game.rotation === 0)],
    ['全部', data.games],
  ];
  const ids = ['firstTechMedian', 'thirdCityMedian', 'thirdCityReachedMedian', 'neverThirdCity', 'endMedian'];
  const perSeed = ids.map(id => seeds.map(seed => estimate(data.games.filter(game => game.seed === seed), id).value).filter((value): value is number => value !== null));
  const spread = perSeed.map((values, index) => values.length ? `${formatValue(Math.min(...values), measure(ids[index]).unit)} – ${formatValue(Math.max(...values), measure(ids[index]).unit)}` : '—');
  return table(['对局组', '局数', ...ids.map(id => measure(id).label)], [...groups.map(([label, games]) =>
    [label, String(games.length), ...ids.map(id => formatValue(estimate(games, id).value, measure(id).unit))]), ['单种子值的范围', '', ...spread]]);
}

export function renderBalanceReport(data: BalanceData, refs: References, command: string[] = []): string {
  const { manifest, games } = data, config = manifest.config;
  const { checks, targets } = acceptance(games, { players: config.players, mix: config.mix });
  const headers = refHeaders(refs);
  const checkRow = (check: Check) => [check.label, check.line, checkValue(check), STATUS_TEXT[check.status], confidenceText(check),
    ...(check.measure ? deltaCells(check.measure, data, refs) : headers.map(() => '')), check.detail];
  const measureRows = (ids: string[]) => ids.map(id => {
    const item = measure(id), result: Estimate = estimate(games, id);
    return [item.label, `${formatValue(result.value, item.unit)}${result.successes !== undefined ? `（${result.successes}/${result.n}）` : ''}`,
      formatInterval(result.interval, item.unit), ...deltaCells(id, data, refs)];
  });
  const outcomes = outcomeTable(games), refOutcomes = [refs.baseline, refs.anchor].filter((ref): ref is BalanceData => ref !== null).map(ref => outcomeTable(ref.games));
  const passed = checks.filter(check => check.status === 'pass').length, applicable = checks.filter(check => check.status !== 'n/a').length;
  const marginal = [...checks, ...targets].filter(check => check.confidence === 'marginal').length;
  const warnings = [refs.baseline, refs.anchor].flatMap((ref, index) => {
    if (!ref) return [];
    const difference = comparable(data, ref);
    return difference ? [`${index === 0 ? '基线' : '锚点'}与本批设置不同：${difference}。差值只作参考。`] : [];
  });
  const curves = curveTable(data.curves), roles = roleShares(games);
  const leaders = leaderTable(games), personalities = personalityTable(games);
  const fair = 1 / config.players;
  return `# 平衡门槛报告：${describe(data)}

> 由 \`${command.length ? command.join(' ') : 'node tools/balance-report.ts'}\` 生成。数据目录 \`${data.directory}\`（逐局 JSON 不入库）。
> git ${manifest.gitHead?.slice(0, 10) ?? '未知'}${manifest.gitDirty ? '（有未提交改动）' : ''}，Node ${manifest.node}，内容 ${manifest.contentVersion}，编排 SHA-256 \`${manifest.scheduleSha256.slice(0, 16)}…\`，${manifest.workers} 个子进程，墙钟 ${manifest.wallSeconds ?? '—'} 秒（CPU ${manifest.cpuSeconds ?? '—'} 秒）。
${refs.baseline ? `> 基线：${describe(refs.baseline)}（\`${refs.baseline.directory}\`，git ${refs.baseline.manifest.gitHead?.slice(0, 10) ?? '未知'}）。\n` : ''}${refs.anchor ? `> 锚点：${describe(refs.anchor)}（\`${refs.anchor.directory}\`，git ${refs.anchor.manifest.gitHead?.slice(0, 10) ?? '未知'}）。\n` : ''}${warnings.map(line => `> ⚠ ${line}\n`).join('')}
## 结论速览

- 运行健康：${checks.find(check => check.id === 'health')!.detail}。
- 11 月目标：${targets.filter(check => check.status === 'pass').length}/${targets.length} 通过（${targets.map(check => `${check.label.replace(/（.*）/, '')} ${formatValue(check.value, unitOf(check))} ${check.status === 'pass' ? '✓' : '✗'}`).join('，')}）。
- §5 验收线：${passed}/${applicable} 通过；${marginal} 项的 95% 区间跨线（边缘）。

区间说明：份额用 Wilson 区间；中位数、平均数和差值用按种子整组重抽的 bootstrap（${BOOTSTRAP_RESAMPLES} 次，固定随机种子，同种子集合时配对）。同一种子的所有对局共用地图，所以按种子重抽，而不是按局。通过 / 未通过只看点估计；"边缘"表示区间跨过了线，再加种子才能下结论。

## 11 月固定目标

${table(['目标', '线', '值 [95% 区间]', '结果', '置信', ...headers, '口径'], targets.map(checkRow))}

口径（精确定义）：
- **第一项科技 ≤ 8**：所有完成对局里的每个文明（${config.players} × 局数），取"回合结束时已研究出 ≥ 1 项科技"的第一轮；从未研究出记为 ∞；取中位数。
- **第三城 ≤ 22**：每个文明"回合结束时拥有 ≥ 3 座城（自建或占领）"的第一轮；从未达到（包括先被消灭、对局先结束）记为 ∞，**不剔除**，所以达不到的文明会把中位数往后推，而不是从分母里消失；取中位数。旧口径"只算达到的文明"和"从未达到的比例"在下面的节奏表里单列。
- **中位结束轮 130–160**：完成对局的最终轮次的中位数（偶数个时取中间两个的平均）。

## §5 验收线

${table(['项目', '线', '值 [95% 区间]', '结果', '置信', ...headers, '说明'], checks.map(checkRow))}

领袖 / 性格的线按公平份额 1/${config.players} = ${(fair * 100).toFixed(1)}% 缩放（4 方时即 15–35% / 20–45%）。

## 结局

${table(['方式', '局数', '份额 [Wilson 95%]', ...headers], outcomes.map(row => [OUTCOME_NAMES[row.kind], String(row.count), `${formatValue(row.share, 'share')} ${formatInterval(row.interval, 'share')}`,
    ...refOutcomes.map(reference => {
      const ref = reference.find(item => item.kind === row.kind);
      if (!ref || !row.n || !ref.n) return '—';
      return formatDelta({ value: row.count / row.n - ref.count / ref.n, interval: newcombeInterval(row.count, row.n, ref.count, ref.n) }, 'share');
    })]))}

## 结束轮与节奏

${table(['指标', '值', '95% 区间', ...headers], measureRows(['endP10', 'endMedian', 'endP90', 'endMean', 'endedBy100', 'endedBefore80', 'fullLength',
    'firstTechMedian', 'secondCityMedian', 'thirdCityMedian', 'thirdCityReachedMedian', 'fourthCityMedian', 'neverSecondCity', 'neverThirdCity',
    'era1Median', 'era2Median', 'era2Reached', 'firstWarMedian', 'firstCityAttackMedian', 'firstCityLostMedian', 'peakCities', 'peakCitiesExpansion', 'eliminatedPerGame']))}

"首次攻打 / 失城"只算文明之间（不含中立营地）；每局取最早一次，从未发生记为 ∞。世代按开局所在世代为第一世代计。

## 滚雪球

${table(['指标', '值', '95% 区间', ...headers], measureRows(['leader30Won', 'leader60Won', 'leader100Won', 'leaderChanges', 'decidedBy60', 'decidedBy100', 'gini']))}

领先者 = 回合结束时分数唯一最高的存活文明（并列不算）；只统计在该轮之后还在进行的对局。更替次数按每轮的唯一领先者序列计（跳过并列轮）。"已决出" = 唯一胜者从该轮起每轮都领先。

## 兵种峰值占比

${roles ? table(COMBAT_ROLES.map(role => ROLE_NAMES[role] ?? role), [COMBAT_ROLES.map(role => formatValue(roles[role], 'share'))]) : '—'}

每个文明各兵种的峰值数量相加后求占比。

## 曲线（每 10 轮，存活文明，均值 [P10–P90]）

${table(['轮', '对局', '文明', ...CURVE_FIELDS.map(field => CURVE_NAMES[field])], curves.map(row => [String(row.round), String(row.games), String(row.civs),
    ...CURVE_FIELDS.map(field => { const cell = row.fields[field]; return cell.mean === null ? '—' : `${cell.mean.toFixed(1)} [${cell.p10!.toFixed(0)}–${cell.p90!.toFixed(0)}]`; })]))}

产出是该轮结束时所有城市的每轮产出之和（未扣维护费）；只统计还在进行的对局，所以后期的行是"打得久的对局"的幸存者样本。

## 领袖（按出场次数折算胜率，公平份额 ${(fair * 100).toFixed(1)}%）

${table(['领袖', '出场', '胜率 [Wilson 95%]', '扩张', '好战', '保守', '平均分', '平均名次', '峰值城', '第三城中位', '被消灭'], leaders.map(row => [
    `${LEADER_NAMES[row.key] ?? row.key}（${row.key}）`, String(row.appearances), `${formatValue(row.rate, 'share')} ${formatInterval(row.interval, 'share')}`,
    ...(['expansion', 'aggressive', 'conservative'] as const).map(personality => formatValue(row.byPersonality[personality].rate, 'share')),
    formatValue(row.meanScore, 'number'), formatValue(row.meanRank, 'number'), formatValue(row.peakCities, 'number'), formatValue(row.thirdCity, 'round'), String(row.eliminated)]))}

## 性格

${table(['性格', '文明', '胜率', '本组局数', '本组中位结束', '本组结局', '峰值城', '第三城中位', '第一科技中位'], personalities.map(row => [
    PERSONALITY_NAMES[row.key] ?? row.key, String(row.appearances), formatValue(row.rate, 'share'), String(row.games), formatValue(row.endMedian, 'round'),
    Object.entries(row.outcomes).map(([kind, count]) => `${OUTCOME_NAMES[kind as OutcomeKind]} ${count}`).join('、') || '—',
    formatValue(row.peakCities, 'number'), formatValue(row.thirdCity, 'round'), formatValue(row.firstTech, 'round')]))}

${config.mix === 'same' ? '同性格局里按性格分组的胜率没有意义（同桌各方性格相同，胜率恒为公平份额）；看"本组"三列。' : '混合性格局：胜率即 §5 的"每种性格在混合局里的胜率"。'}

## 测量稳定性

${seedStability(data)}

同一批规则下，只取一个种子（${config.players === 4 ? 27 : '每种子'} 局）或只取轮换 0（${config.seeds.length * 3} 局）得到的目标值和全部 ${games.length} 局的值之差，就是小样本验收会看到的摆动；门槛只用全部对局的值和区间下结论。"只算达到的文明"的口径分母随对局组变化，所以与"达不到记 ∞"分开列出。
`;
}

const REPORT_USAGE = 'Usage: node tools/balance-report.ts <run-directory> [--baseline <run-directory>] [--anchor <run-directory>] [--out <file.md>]';
export function parseReportArgs(args: readonly string[]): { directory: string; baseline: string | null; anchor: string | null; out: string | null } {
  const [directory, ...rest] = args;
  if (!directory || directory.startsWith('--')) throw new Error(REPORT_USAGE);
  const { flags } = splitFlags(rest, ['--baseline', '--anchor', '--out'], REPORT_USAGE);
  return { directory, baseline: flags['--baseline'] ?? null, anchor: flags['--anchor'] ?? null, out: flags['--out'] ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseReportArgs(process.argv.slice(2));
  const markdown = renderBalanceReport(loadBalance(args.directory), {
    baseline: args.baseline ? loadBalance(args.baseline, false) : null, anchor: args.anchor ? loadBalance(args.anchor, false) : null,
  }, ['node', 'tools/balance-report.ts', ...process.argv.slice(2)]);
  if (args.out) writeFileSync(resolve(args.out), markdown);
  else process.stdout.write(markdown);
}
