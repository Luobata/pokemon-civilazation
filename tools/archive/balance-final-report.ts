/** M5-11 analysis only. Usage: node tools/archive/balance-final-report.ts <sim-root> <proof> <report.md> */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { summarizeGames } from '../summary.ts';
import type { GameMetrics } from '../summary.ts';
import { assessD45 } from './b7-report.ts';
import { compareGames } from '../compare-games.ts';
import { parsePatch } from '../patch.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { ratio, winCredit } from '../statistics.ts';
import type { Ratio } from '../statistics.ts';
import { PERSONALITIES } from '../matches.ts';

const f = (n: number | null) => n === null ? '—' : n.toFixed(2);
const pct = (n: number | null) => n === null ? '—' : f(n * 100) + '%';
const stat = (s: Ratio) => pct(s.pointEstimate) + ` (${s.numerator}/${s.n}; 独立种子${s.independentSeeds}), 95%[`
  + (s.wilson95?.map(n => f(n * 100)).join(',') ?? '—') + ']';
const mark = (b: boolean | null) => b === true ? '达标' : b === false ? '未达标' : '不可算';
function summarize(id: string, games: GameMetrics[]) {
  const all = summarizeGames(games), four = summarizeGames(games.filter(g => g.mode === '1v3'));
  const values = { defect: all.defectGameCount, aborted: all.aborted.pointEstimate, conquest: all.conquest.pointEstimate,
    meanRound: all.meanEndRound.value, meanFourRound: four.meanEndRound.value, firstSeat: all.firstSeat.pointEstimate,
    snowball: all.snowball.pointEstimate, captures: all.captureAttemptsPerGame.value, neutral: all.withoutTypeAdvantage.pointEstimate };
  const contribution = PERSONALITIES.map(personality => ({ personality, ...ratio(games.filter(g => !g.aborted && !g.defect && g.kind === 'conquest').map(g => ({
    seed: g.seed, trials: 1, successes: g.personalities.reduce((sum, person, seat) => sum + (person === personality ? winCredit(g.winners, seat) : 0), 0),
  }))) }));
  return { id, all, four, values, pairs: all.pairwise, contribution, assessment: assessD45({ id, values, pairs: all.pairwise }) };
}
function readRun(root: string, directory: string) {
  const path = resolve(root, directory), raw = readFileSync(resolve(path, 'games.jsonl'), 'utf8');
  const games = raw.trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
  const summaries = { all: summarizeGames(games), oneVsOne: summarizeGames(games.filter(g => g.mode === '1v1')),
    oneVsThree: summarizeGames(games.filter(g => g.mode === '1v3')) };
  if (canonicalSerialize(summaries) !== canonicalSerialize(JSON.parse(readFileSync(resolve(path, 'summary.json'), 'utf8')))) throw new Error(directory + ' summary mismatch');
  return { directory, games, manifest: JSON.parse(readFileSync(resolve(path, 'manifest.json'), 'utf8')),
    sha256: createHash('sha256').update(raw).digest('hex') };
}
const decisions: Record<string, string> = {
  'balance.city.baseHp': 'D40数值迭代；D45收尾M2：100→50',
  'balance.city.capturedHp': 'D40/D45；M2从实验60恢复v0.6的50',
  'balance.effects.siegeMultiplier': 'D40实验；M5-11等价检验决定是否保留v0.6',
  'balance.score.cities': 'D40：100→80', 'balance.score.techs': 'D45不采用D44科技加权，保持20',
  'ai.aggressiveSettlerCities': 'D40数值迭代；D45选定M2的4',
  'ai.aggressiveWarStrength': 'D40：1500→1250', 'ai.aggressiveSiegeUnits': 'D40迭代；D45保留4',
  'ai.aggressiveSeekUnknownHq': 'D42：启用未知HQ寻找',
  'ai.aggressiveSiegeCaptureBonus': 'D43实验未采用，保持0',
  'ai.aggressiveSiegeTrainingBonus': 'D43实验未采用，保持0',
  'ai.conservativeSeekUnknownHq': 'D43实验未采用，保持false',
  'ai.conservativeStrength': 'D40数值迭代/D45；攻城军力2000→1500，不是宣战门槛',
  'ai.conservativeMayDeclareWar': 'D41：允许满足条件时主动宣战',
  'ai.conservativeDeclareStrength': 'D41：主动宣战军力2000',
  'ai.conservativeBorderDistance': 'D41接壤口径；D40迭代/D45选定5',
  'ai.conservativeSettlerInterval': 'D40数值迭代/D45：15→8',
  'ai.expansionMaySiege': 'D44：允许有条件攻城',
  'ai.expansionSiegeStrength': 'D44/D45：攻城军力2000',
  'ai.expansionBorderDistance': 'D44/D45：接壤距离5',
};
const laterFields: Record<string, string> = {
  aggressiveSeekUnknownHq: 'v0.6只推进已知HQ；无此开关',
  aggressiveSiegeCaptureBonus: 'v0.6无此加分字段', aggressiveSiegeTrainingBonus: 'v0.6无此加分字段',
  conservativeSeekUnknownHq: 'v0.6无未知HQ寻找开关',
  conservativeMayDeclareWar: 'v0.6从不主动宣战', conservativeDeclareStrength: 'v0.6不主动宣战，门槛不适用',
  conservativeBorderDistance: 'v0.6不主动宣战，距离不适用',
  expansionMaySiege: 'v0.6不主动攻城', expansionSiegeStrength: 'v0.6不主动攻城，门槛不适用',
  expansionBorderDistance: 'v0.6不主动攻城，距离不适用',
};
export function finalBalanceReport(root: string, proof: string, report: string) {
  const inputs = ['m5-10-m2', 'm5-10-validate', 'm5-11-append'].map(dir => readRun(root, dir));
  const comparison = compareGames(resolve(root, 'm5-10-m2'), resolve(root, 'm5-11-siege1500'));
  const equivalent = comparison.identical === 300 && comparison.mismatches.length === 0;
  const original = parsePatch(inputs[0].manifest.patch);
  if (inputs.some(run => run.manifest.patchSha256 !== original.sha256)) throw new Error('Three M2 batches must use the same patch');
  const finalPatch = parsePatch(JSON.parse(readFileSync(equivalent ? 'tools/patches/b7-m2-siege1500.json' : 'tools/patches/b7-m2.json', 'utf8')));
  const defaults = parsePatch({});
  const rows = [summarize('调参1–100', inputs[0].games), summarize('独立101–200', inputs[1].games), summarize('追加201–300', inputs[2].games),
    summarize('独立合并101–300', [...inputs[1].games, ...inputs[2].games]), summarize('全部合并1–300（含调参）', inputs.flatMap(run => run.games))];
  const parameters: { field: string; before: string | number | boolean; compatibilityDefault: number | boolean; final: number | boolean; decision: string }[] = [];
  for (const [group, entries] of Object.entries(finalPatch.content.balance)) for (const [key, value] of Object.entries(entries)) {
    const field = 'balance.' + group + '.' + key;
    const before = (defaults.content.balance[group as keyof typeof defaults.content.balance] as Record<string, number>)[key];
    parameters.push({ field, before, compatibilityDefault: before, final: value, decision: decisions[field] ?? '未改，沿用v0.6；无新增D40–D45调整' });
  }
  for (const [key, value] of Object.entries(finalPatch.ai)) {
    const before = defaults.ai[key as keyof typeof defaults.ai], field = 'ai.' + key;
    parameters.push({ field, before: laterFields[key] ?? before, compatibilityDefault: before, final: value,
      decision: decisions[field] ?? '未改，沿用v0.6；无新增D40–D45调整' });
  }
  const diagnostics = JSON.parse(readFileSync(resolve(proof, 'm2-diagnostics.json'), 'utf8'));
  const exposure = JSON.parse(readFileSync(resolve(proof, 'siege-exposure.json'), 'utf8')) as {
    game: string; commands: number; stateDifferences: number; finalOutcomesEqual: boolean;
    exposure: { round: number; seq: number; species: string; hp: number; hpAfter1750: number; hpAfter1500: number;
      at1750: { damage: number }; at1500: { damage: number } }[];
  };
  const out = ['# M5-11 最终候选与D18追加复验', '',
    `**M2追加201–300：${mark(rows[2].assessment.allTargets)}；独立合并101–300：${mark(rows[3].assessment.allTargets)}。**`, '',
    '追加失败项：' + (rows[2].assessment.failures.join('、') || '无') + '；独立合并失败项：' + (rows[3].assessment.failures.join('、') || '无') + '。未根据新样本换方案。', '',
    equivalent ? '**攻城倍率1500与1750在种子1–100的300局逐文件逐字节一致。** 按合同，最终候选采用1500，保持GDD v0.6的倍率。'
      : '**攻城倍率存在对局差异，不能宣布等价。** 本报告保留1750候选，差异交Hub判断，见siege-comparison.json。', '',
    '## 方案及参数清单', '',
    '最终候选补丁：' + (equivalent ? 'tools/patches/b7-m2-siege1500.json' : 'tools/patches/b7-m2.json') + '；canonical patch SHA-256：`' + finalPatch.sha256 + '`。正式默认值未修改。', '',
    '以下完整列出解析后的balance和ai字段，包括补丁未覆盖的默认项。v0.6证据固定为提交a2c55e7中的GDD（proof/gdd-v0.6.md），不读取design正在编辑的v0.7。后加实验字段在v0.6没有数值时写明不适用，另列现行兼容默认，避免把后来实现的关闭状态误写成v0.6条文。物种、建筑、科技成本、球、群系、移动成本及开拓队属性均未覆盖，沿用v0.6；地图24×16、轮上限100不变。', ''];
  const table = (headers: string[], data: (string | number | boolean)[][]) => {
    out.push('| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |');
    for (const row of data) out.push('| ' + row.join(' | ') + ' |');
    out.push('');
  };
  table(['字段', 'v0.6值/规则', '现行兼容默认', '最终候选值', '决策依据'], parameters.map(p => [p.field, p.before, p.compatibilityDefault, p.final, p.decision]));
  out.push('扩张仍不主动宣战，也不搜索未知HQ；攻城需要开关、与该对手交战、已观察军力达标、该对手已知城市距己方地图单位≤5。保守主动宣战门槛2倍与攻城门槛1.5倍是两个独立字段；保守的捕捉领地限制保留。D45只接受保守对扩张偏弱，其他硬条件不变。', '',
    '## 三批与合并指标', '',
    '三批全部使用M2原补丁（倍率1750），每批100种子/300局：1v1互换200局，1v3共100局。每批保持同一配对分配/性格轮转，仅种子分别加0/100/200。D18重判使用独立101–300的600局；1–300包含调参样本，只作补充。每项比率显示分子/分母、独立种子数和Wilson95%；互换局和同局击坠有相关性，区间只作描述。先手仅1v1；捕捉为尝试；滚雪球仅30轮末唯一领跑者。', '');
  const metricRows: (string | number | boolean)[][] = [];
  for (const [label, key] of [['征服≥40%', 'conquest'], ['先手≤55%', 'firstSeat'], ['无属性优势击坠>25%', 'withoutTypeAdvantage'],
    ['滚雪球≤75%', 'snowball'], ['aborted≤5%', 'aborted']] as const) metricRows.push([label, ...rows.map(r => stat(r.all[key]) + ' ' + mark(r.all[key].target.passes))]);
  for (const [label, key] of [['平均终局70–95', 'meanRound'], ['1v3终局≤95', 'meanFourRound'], ['捕捉3–10', 'captures'], ['defect=0', 'defect']] as const)
    metricRows.push([label, ...rows.map(r => f(r.values[key]) + ' ' + mark(r.assessment.checks.find(c => c.key === key)!.passes))]);
  metricRows.push(['迷雾拒绝', ...rows.map(r => r.all.fogRejectionCount)], ['30轮前终局', ...rows.map(r => r.all.earlyEndingBeforeRound30Count)]);
  for (const pair of rows[0].pairs) for (const side of pair.results) metricRows.push([pair.pair + '/' + side.personality,
    ...rows.map(r => { const s = r.pairs.find(p => p.pair === pair.pair)!.results.find(s => s.personality === side.personality)!;
      return stat(s) + (pair.pair === 'conservative/expansion' ? ' 观察项' : ' ' + mark(s.target.passes)); })]);
  table(['D45指标', ...rows.map(r => r.id)], metricRows);
  table(['批次', '满足硬条件', '失败项'], rows.map(r => [r.id, r.assessment.passed + '/11', r.assessment.failures.join('、') || '无']));
  out.push('## D18标记与征服贡献', '', '失败项或距适用比率边界不足5个百分点标记；恰好5个百分点不标记。保守对扩张不触发D45条件。按合同照实报告追加及合并失败项，不继续调参。', '');
  table(['批次', '标记指标', '结果', '原因'], rows.flatMap(r => r.assessment.checks.filter(c => c.needsAdditionalSeeds).map(c => [r.id, c.key, mark(c.passes), c.reason])));
  table(['批次/性格', '占该批全部征服的贡献'], rows.flatMap(r => r.contribution.map(c => [r.id + '/' + c.personality, stat(c)])));
  out.push('## 攻城倍率核对', '',
    `对比对局文件${comparison.games}个，字节一致${comparison.identical}个，差异${comparison.mismatches.length}个。覆盖命令、终局和已保存遥测；文件没有保存完整战斗事件和全部城HP，不能由字节一致推断全部运行状态一致。`, '',
    'M2原300局经重放核对的城市攻击分类：', '');
  table(['攻击分类', '次数'], Object.entries(diagnostics.cityAttackCategories).map(([category, value]) => [category, (value as { damage: { n: number } }).damage.n]));
  out.push('**纠正“倍率从未生效”的前提**：' + exposure.game + '的玩家1隆隆石确有投石改装后的城市攻击。以两档补丁重放相同命令得到：', '');
  table(['轮/命令seq', '1750伤害', '1500伤害', '1750攻击后城HP', '1500攻击后城HP'], exposure.exposure.map(e => [e.round + '/' + e.seq,
    e.at1750.damage, e.at1500.damage, e.hpAfter1750, e.hpAfter1500]));
  out.push(`该局${exposure.commands}条命令中，${exposure.stateDifferences}个命令后的完整状态不同；终局outcome相同：${exposure.finalOutcomesEqual}。故本轮只证明保存结果与命令轨迹等价，已经直接证实伤害和状态并非等价。详见siege-exposure.json。`, '');
  out.push('需同时满足攻城定位与已研究投石改装，1750倍率才用于城市伤害（src/core/combat-query.ts）。不能把没有该组合的实战攻击说成“所有攻城物种从不攻城”；真实次数以上表为准。', '',
    '字节等价证据只覆盖1–100；101–300按合同仍跑1750，不能直接宣称1500在所有种子或玩家使用场景全局等价。GDD保持1500属于本合同的条件结论，不表示1750的战斗效果已被验证或二者规则相同。', '',
    '## 证据与复算', '');
  table(['批次', '目录', 'patch SHA-256', 'games.jsonl SHA-256'], inputs.map(r => [r.manifest.seeds[0] + '–' + r.manifest.seeds.at(-1), r.directory, r.manifest.patchSha256, r.sha256]));
  out.push('倍率对照目录m5-11-siege1500，补丁hash见其manifest；两批新运行都保存三种子双跑并与保存结果匹配。siege-comparison.json为完整字节对比。comparison.json含完整指标、D45判定、参数与来源哈希。',
    '复算：node tools/archive/balance-final-report.ts <sim-root> <proof-directory> <report.md>。正式生产默认值、GDD修订和后续放行由Hub处理。', '');
  writeFileSync(resolve(proof, 'siege-comparison.json'), JSON.stringify(comparison, null, 2));
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ rows, inputs: inputs.map(({ directory, manifest, sha256 }) => ({ directory, manifest, sha256 })),
    parameters, finalPatch: finalPatch.patch, finalPatchSha256: finalPatch.sha256, equivalent, comparison, exposure }, null, 2));
  writeFileSync(report, out.join('\n'));
  return { appended: rows[2].assessment, independentCombined: rows[3].assessment, equivalent, finalPatchSha256: finalPatch.sha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/archive/balance-final-report.ts <sim-root> <proof> <report.md>');
  console.log(JSON.stringify(finalBalanceReport(process.argv[2], process.argv[3], process.argv[4])));
}
