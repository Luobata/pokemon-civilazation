/** M5-10/D45 reporting only; reads saved runs, never changes AI or simulation data.
 * Usage: node tools/b7-report.ts <sim-root> <proof-directory> <report.md>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { summarizeGames } from './summary.ts';
import type { GameMetrics } from './summary.ts';
import { PERSONALITIES } from './matches.ts';
import { ratio, threshold, winCredit } from './statistics.ts';
import type { Ratio } from './statistics.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';

type Candidate = { id: string; values: Record<string, number | null>;
  pairs: { pair: string; results: { personality: string; pointEstimate: number | null }[] }[] };
const guards: [string, number | null, number | null, boolean, boolean?][] = [
  ['defect', 0, 0, false], ['aborted', null, 0.05, true], ['conquest', 0.4, null, true],
  ['meanRound', 70, 95, false], ['meanFourRound', null, 95, false], ['firstSeat', null, 0.55, true],
  ['snowball', null, 0.75, true], ['captures', 3, 10, false], ['neutral', 0.25, null, true, true],
];
const requiredPairs = ['aggressive/expansion', 'aggressive/conservative'];
export function assessD45(candidate: Candidate) {
  const checks = guards.map(([key, lower, upper, isRatio, strict]) => ({ key,
    ...threshold(candidate.values[key] ?? null, lower, upper, isRatio, strict) }));
  const deviations: number[] = [];
  for (const key of requiredPairs) {
    const pair = candidate.pairs.find(row => row.pair === key);
    const expected = key.split('/');
    const complete = pair?.results.length === 2 && expected.every(person => pair.results.some(row => row.personality === person));
    const sides = expected.map(person => threshold(complete ? pair!.results.find(row => row.personality === person)!.pointEstimate : null, 0.4, 0.6, true));
    for (const person of expected) {
      const value = complete ? pair!.results.find(row => row.personality === person)!.pointEstimate : null;
      deviations.push(value === null ? Infinity : Math.abs(value - 0.5));
    }
    checks.push({ key, passes: sides.every(row => row.passes === true), needsAdditionalSeeds: sides.some(row => row.needsAdditionalSeeds !== false),
      reason: sides.some(row => row.passes !== true) ? 'outside-target-or-missing' : sides.some(row => row.needsAdditionalSeeds) ? 'within-five-percentage-points' : 'inside-target' });
  }
  return { ...candidate, checks, passed: checks.filter(row => row.passes === true).length,
    failures: checks.filter(row => row.passes !== true).map(row => row.key),
    allTargets: checks.every(row => row.passes === true), maxDeviation: Math.max(...deviations) };
}
export function rankD45(candidates: Candidate[]) {
  const rows = candidates.map(assessD45), qualifying = rows.filter(row => row.allTargets);
  const ranked = qualifying.length ? qualifying.sort((a, b) => a.maxDeviation - b.maxDeviation
    || (a.values.snowball ?? Infinity) - (b.values.snowball ?? Infinity))
    : [...rows].sort((a, b) => b.passed - a.passed || (b.values.conquest ?? -1) - (a.values.conquest ?? -1));
  return { winner: ranked[0]?.id ?? null, qualified: qualifying.length > 0, ranked, rows };
}

function readRun(root: string, id: string, directory: string) {
  const path = resolve(root, directory), raw = readFileSync(resolve(path, 'games.jsonl'), 'utf8');
  const games = raw.trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
  const summaries = { all: summarizeGames(games), oneVsOne: summarizeGames(games.filter(game => game.mode === '1v1')),
    oneVsThree: summarizeGames(games.filter(game => game.mode === '1v3')) };
  if (canonicalSerialize(summaries) !== canonicalSerialize(JSON.parse(readFileSync(resolve(path, 'summary.json'), 'utf8')))) throw new Error(id + ' summary mismatch');
  const manifest = JSON.parse(readFileSync(resolve(path, 'manifest.json'), 'utf8'));
  const determinism = JSON.parse(readFileSync(resolve(path, 'determinism.json'), 'utf8')) as { seed: number; equal: boolean; equalsRecorded: boolean }[];
  if (determinism.length !== 3 || determinism.some(row => !row.equal || !row.equalsRecorded)) throw new Error(id + ' determinism failed');
  return { ...summarizeRun(id, games), directory, manifest, determinism,
    gamesSha256: createHash('sha256').update(raw).digest('hex'), games };
}
function summarizeRun(id: string, games: GameMetrics[]) {
  const all = summarizeGames(games), four = summarizeGames(games.filter(game => game.mode === '1v3'));
  const values = { defect: all.defectGameCount, aborted: all.aborted.pointEstimate, conquest: all.conquest.pointEstimate,
    meanRound: all.meanEndRound.value, meanFourRound: four.meanEndRound.value, firstSeat: all.firstSeat.pointEstimate,
    snowball: all.snowball.pointEstimate, captures: all.captureAttemptsPerGame.value, neutral: all.withoutTypeAdvantage.pointEstimate };
  const contribution = ['all', '1v1', '1v3'].flatMap(mode => {
    const valid = games.filter(game => !game.defect && !game.aborted && game.kind !== null && (mode === 'all' || game.mode === mode));
    const conquests = valid.filter(game => game.kind === 'conquest');
    return PERSONALITIES.map(personality => ({ mode, personality, validGames: valid.length,
      ...ratio(conquests.map(game => ({ seed: game.seed, trials: 1,
        successes: game.personalities.reduce((sum, person, seat) => sum + (person === personality ? winCredit(game.winners, seat) : 0), 0) }))) }));
  });
  return { id, all, four, values, pairs: all.pairwise, contribution, assessment: assessD45({ id, values, pairs: all.pairwise }) };
}
const f = (value: number | null) => value === null ? '—' : value.toFixed(2);
const pct = (value: number | null) => value === null ? '—' : f(value * 100) + '%';
const stat = (row: Ratio) => pct(row.pointEstimate) + ` (${row.numerator}/${row.n}; 独立种子${row.independentSeeds}), 95%[`
  + (row.wilson95?.map(value => f(value * 100)).join(',') ?? '—') + ']';
const mark = (value: boolean | null) => value === true ? '达标' : value === false ? '未达标' : '不可算';
export function reportB7(root: string, proof: string, report: string) {
  const configs = [['L1', 'm5-9-l1'], ['L2', 'm5-9-l2'], ...Array.from({ length: 6 }, (_, i) => ['M' + (i + 1), 'm5-10-m' + (i + 1)])];
  const runs = configs.map(([id, directory]) => readRun(root, id, directory));
  const selection = rankD45(runs), selected = runs.find(row => row.id === selection.winner)!;
  const validation = existsSync(resolve(root, 'm5-10-validate', 'summary.json')) ? readRun(root, '独立复验', 'm5-10-validate') : null;
  if (validation && validation.manifest.patchSha256 !== selected.manifest.patchSha256) throw new Error('Validation patch differs from selected candidate');
  if (validation && validation.games.some(game => game.seed < 101 || game.seed > 200)) throw new Error('Validation seed outside101–200');
  const combined = validation ? summarizeRun('合并（含调参）', [...selected.games, ...validation.games]) : null;
  const out = ['# B7 / M5-10 收尾微调与独立复验', '',
    `**调参批次${selection.qualified ? '全部硬条件达标胜者' : '最接近候选（未全部达标）'}：${selection.winner}。**`, '',
    validation ? `独立种子101–200：${mark(validation.assessment.allTargets)}。未达标项：${validation.assessment.failures.join('、') || '无'}。`
      : '独立种子复验待运行；当前只锁定调参批次候选，不能宣布复验通过。', '',
    '依据D45，科技计分保持×20；仅好战对扩张、好战对保守两组双方胜率40–60%用于验收。保守对扩张仍完整披露，但不影响排序或放行。未修改正式默认值。', '',
    '## 口径与方案', '',
    '初始每组100种子、300局（200局1v1互换，100局1v3）。L1/L2复用M5-9已保存数据，M1–M6使用相同1–100种子与编排。独立批次只将种子整体加100，保持配对分配和性格轮转：101–133扩张/好战，134–166扩张/保守，167–200好战/保守，每种子交换席位。', '',
    '比率同时显示点估计、分子/分母、实际独立种子数及Wilson95%。互换局及同局多次击坠有相关性，Wilson仅为描述区间，不是额外放行条件。先手仅含1v1；捕捉为尝试数；滚雪球仅含30轮末唯一领跑者。分母为0记不可算。', '',
    'M1=L2扩张门槛2500；M2=L2城市HP50；M3=M1城市HP50；M4=L2好战开拓队门槛3；M5=M4城市HP50；M6=L1好战开拓队门槛3。M2/M3/M5的capturedHp同步60→50，故城市改动是基础/占领HP的组合，不是纯baseHp单因子。其余字段原样保留，见各manifest的m5_10Adjustment。', ''];
  const table = (headers: string[], rows: (string | number)[][]) => {
    out.push('| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |');
    for (const row of rows) out.push('| ' + row.join(' | ') + ' |');
    out.push('');
  };
  const metricsTable = (group: ReturnType<typeof summarizeRun>[]) => {
    const rows: (string | number)[][] = [];
    for (const [label, key] of [['征服≥40%', 'conquest'], ['先手≤55%', 'firstSeat'], ['无属性优势击坠>25%', 'withoutTypeAdvantage'],
      ['滚雪球≤75%', 'snowball'], ['aborted≤5%', 'aborted']] as const) rows.push([label, ...group.map(run => stat(run.all[key]) + ' ' + mark(run.all[key].target.passes))]);
    for (const [label, key] of [['平均终局70–95', 'meanRound'], ['1v3平均终局≤95', 'meanFourRound'], ['捕捉3–10', 'captures'], ['defect=0', 'defect']] as const)
      rows.push([label, ...group.map(run => f(run.values[key]) + ' ' + mark(run.assessment.checks.find(check => check.key === key)!.passes))]);
    rows.push(['迷雾拒绝', ...group.map(run => run.all.fogRejectionCount)], ['30轮前终局', ...group.map(run => run.all.earlyEndingBeforeRound30Count)]);
    for (const pair of group[0].pairs) for (const side of pair.results) rows.push([pair.pair + '/' + side.personality + (requiredPairs.includes(pair.pair) ? '胜40–60%' : '胜率（观察项）'),
      ...group.map(run => { const row = run.pairs.find(p => p.pair === pair.pair)!.results.find(p => p.personality === side.personality)!;
        return stat(row) + (requiredPairs.includes(pair.pair) ? ' ' + mark(row.target.passes) : ' 不参与放行'); })]);
    table(['指标', ...group.map(run => run.id)], rows);
  };
  out.push('## 调参总表', ''); metricsTable(runs);
  out.push('## 选择过程', '',
    '共11项硬条件：九项全局指标与两组配对（每组双方同时满足）。1v3按本合同只要求≤95。全达标候选按两组好战配对距50%的最大偏差升序，再按滚雪球升序；无全达标者按满足条件数降序，再按征服率降序。相同排序键只按L1、L2、M1…M6输入顺序展示，不声称统计优胜。', '');
  table(['候选', '满足/11', '失败项', '最大50%偏差pp', '征服', '滚雪球', '全达标'], selection.rows.map(row => [row.id, row.passed,
    row.failures.join('、') || '无', f(row.maxDeviation * 100), pct(row.values.conquest), pct(row.values.snowball), mark(row.allTargets)]));
  out.push('候选展示顺序：' + selection.ranked.map(row => row.id).join(' > ') + '。', '');
  const first = selection.ranked[0];
  const tied = selection.ranked.filter(row => selection.qualified
    ? row.maxDeviation === first.maxDeviation && row.values.snowball === first.values.snowball
    : row.passed === first.passed && row.values.conquest === first.values.conquest);
  if (tied.length > 1) out.push(tied.map(row => row.id).join('、') + '的全部排序键相同，按稳定输入顺序锁定' + selection.winner + '；不据此声称它优于同分方案。', '');
  out.push('## 独立复验与合并结果', '');
  if (validation && combined) {
    out.push('先锁定候选，再使用101–200新种子运行；不根据复验结果重选本轮候选。合并结果按D18提供，但包含用于调参的1–100种子，不能冒充独立验证。是否仍满足全部条件由独立批次单独判定。', '');
    metricsTable([selected, validation, combined]);
    out.push('### D18标记', '', '失败项或距适用比率阈值不足5个百分点标记；恰好5个百分点不标记。轮数/捕捉只在失败时标记。保守对扩张为观察项，不触发D45追加要求。本合同只授权101–200复验；下表不代表已运行更多种子或已完成最终放行。', '');
    table(['批次', '指标', '结果', '标记原因'], [selected, validation, combined].flatMap(run => run.assessment.checks
      .filter(check => check.needsAdditionalSeeds).map(check => [run.id, check.key, mark(check.passes), check.reason])));
    out.push('独立批次失败项：' + (validation.assessment.failures.join('、') || '无') + '；合并失败项：' + (combined.assessment.failures.join('、') || '无') + '。', '');
  }
  out.push('## 各性格征服贡献', '', '分子为该性格征服胜场权重，分母为该分组全部征服终局；并列沿用项目胜利权重。另列有效局数，勿把贡献占比当作该性格席位胜率。', '');
  const allRuns = validation ? [...runs, validation] : runs;
  table(['批次/模式/性格', '有效局', '征服贡献（Wilson）'], allRuns.flatMap(run => run.contribution.map(row => [run.id + '/' + row.mode + '/' + row.personality, row.validGames, stat(row)])));
  out.push('## 可复算证据', '');
  table(['批次', '目录', 'patch SHA-256', '双跑种子'], allRuns.map(run => [run.id, run.directory, run.manifest.patchSha256, run.determinism.map(row => row.seed).join('/') ]));
  out.push('所有摘要由games.jsonl重新计算并与保存的summary.json核对。comparison.json含完整摘要、排序、D18标记和输入哈希；selection.json为复验前候选锁定记录。确定性双跑同时匹配已保存对局。', '',
    '复算：node tools/b7-report.ts <sim-root> <proof-directory> <report.md>。复验使用现有simulateMatch与原300局编排，执行脚本保存在proof目录；无游戏代码改动。', '');
  const compact = ({ games, ...run }: typeof runs[number]) => { void games; return run; };
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ runs: runs.map(compact), selection,
    validation: validation && compact(validation), combined }, null, 2));
  const selectionRecord = { winner: selection.winner, qualified: selection.qualified, patch: selected.manifest.patch,
    patchSha256: selected.manifest.patchSha256, selection, inputs: runs.map(run => ({ id: run.id, gamesSha256: run.gamesSha256 })) };
  if (!existsSync(resolve(proof, 'selection.json'))) writeFileSync(resolve(proof, 'selection.json'), JSON.stringify(selectionRecord, null, 2));
  else if (canonicalSerialize(JSON.parse(readFileSync(resolve(proof, 'selection.json'), 'utf8'))) !== canonicalSerialize(selectionRecord)) throw new Error('Locked selection or inputs changed');
  writeFileSync(report, out.join('\n'));
  return { winner: selection.winner, qualified: selection.qualified, validation: validation?.assessment ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/b7-report.ts <sim-root> <proof-directory> <report.md>');
  console.log(JSON.stringify(reportB7(process.argv[2], process.argv[3], process.argv[4])));
}
