/** M5-7 reporting only. Usage: node tools/b4-report.ts <sim-root> <proof-directory> <report.md> */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGames } from './summary.ts';
import type { GameMetrics } from './summary.ts';
import type { diagnoseB4 } from './b4-diagnostics.ts';
import { rankCandidates } from './b3-report.ts';
import { PERSONALITIES } from './matches.ts';

const configs = [['I1', 'm5-7-i1'], ...Array.from({ length: 8 }, (_, i) => ['J' + (i + 1), 'm5-7-j' + (i + 1)])];
const comparisons: [string, [string, number][]][] = [
  ['J1−I1', [['J1', 1], ['I1', -1]]], ['J2−J1', [['J2', 1], ['J1', -1]]],
  ['J3−I1', [['J3', 1], ['I1', -1]]], ['J4−I1', [['J4', 1], ['I1', -1]]], ['J5−I1', [['J5', 1], ['I1', -1]]],
  ['J6−I1', [['J6', 1], ['I1', -1]]], ['J7−I1', [['J7', 1], ['I1', -1]]],
  ['J8−J6', [['J8', 1], ['J6', -1]]], ['J8−J7', [['J8', 1], ['J7', -1]]],
  ['J6−J1−J3−J4−J5+3I1', [['J6', 1], ['J1', -1], ['J3', -1], ['J4', -1], ['J5', -1], ['I1', 3]]],
  ['J8−J6−J7+I1', [['J8', 1], ['J6', -1], ['J7', -1], ['I1', 1]]],
];
const f = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits);
const pct = (value: number | null) => value === null ? '—' : f(value * 100) + '%';
const mark = (passes: boolean | null) => passes === null ? '不可算' : passes ? '达标' : '未达标';
const fraction = (a: number, b: number) => a + '/' + b + ' (' + (b ? pct(a / b) : '—') + ')';
export function reportB4(simRoot: string, proof: string, report: string) {
  const runs = configs.map(([id, directory]) => {
    const path = resolve(simRoot, directory);
    const games = readFileSync(resolve(path, 'games.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
    const all = summarizeGames(games), four = summarizeGames(games.filter(game => game.mode === '1v3'));
    const diagnostics = JSON.parse(readFileSync(resolve(proof, id + '-diagnostics.json'), 'utf8')) as ReturnType<typeof diagnoseB4>;
    const manifest = JSON.parse(readFileSync(resolve(path, 'manifest.json'), 'utf8'));
    const determinism = JSON.parse(readFileSync(resolve(path, 'determinism.json'), 'utf8')) as { equal: boolean; equalsRecorded: boolean }[];
    const values: Record<string, number | null> = {
      conquest: all.conquest.pointEstimate, meanRound: all.meanEndRound.value, meanFourRound: four.meanEndRound.value,
      firstSeat: all.firstSeat.pointEstimate, neutral: all.withoutTypeAdvantage.pointEstimate, snowball: all.snowball.pointEstimate,
      captures: all.captureAttemptsPerGame.value, aborted: all.aborted.pointEstimate, defect: all.defectGameCount,
      fog: all.fogRejectionCount, early: all.earlyEndingBeforeRound30Count,
    };
    for (const pair of all.pairwise) for (const row of pair.results) values[pair.pair + ':' + row.personality] = row.pointEstimate;
    const conservativeExpansion = games.filter(game => game.mode === '1v1' && game.personalities.includes('conservative') && game.personalities.includes('expansion'));
    values.conservativeExpansionConquests = conservativeExpansion.filter(game => game.kind === 'conquest').length;
    values.conservativeExpansionConservativeConquests = conservativeExpansion.filter(game => game.kind === 'conquest'
      && game.winners.includes(game.personalities.indexOf('conservative'))).length;
    for (const group of diagnostics.groups) for (const person of group.personalities) {
      const prefix = group.mode + ':' + person.personality + ':';
      for (const [key, value] of Object.entries(person)) if (typeof value === 'number') values[prefix + key] = value;
      for (const key of ['firstDeclaration', 'firstCombat3', 'firstCombat4', 'firstCityAttack', 'firstEnemyCapture', 'firstHq', 'attacksPerCapture', 'cities', 'techs', 'upkeep'] as const) {
        values[prefix + key + ':median'] = person[key].median; values[prefix + key + ':mean'] = person[key].mean;
      }
      person.hqCounts.forEach((count, i) => { values[prefix + 'hq' + (i + 1)] = count; });
      person.hqGaps.forEach((gap, i) => { values[prefix + 'hqGap' + (i + 1)] = gap.median; });
    }
    return { id, directory, all, four, diagnostics, manifest, determinism, values,
      pairs: all.pairwise.map(pair => pair.results.map(row => row.pointEstimate)) };
  });
  // Stable source order chooses J1 (2000) ahead of J2 (1500) only on otherwise equal ranking keys.
  const selection = rankCandidates(runs.filter(run => run.id.startsWith('J')));
  const deltas = comparisons.map(([name, terms]) => ({ name, values: Object.fromEntries(Object.keys(runs[0].values).map(key => {
    const rows = terms.map(([id, weight]) => ({ value: runs.find(run => run.id === id)!.values[key], weight }));
    return [key, rows.some(row => row.value === null) ? null : rows.reduce((sum, row) => sum + row.value! * row.weight, 0)];
  })) }));
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ runs, selection, deltas }, null, 2));
  const out: string[] = ['# B4 / M5-7 第三轮实验', '',
    selection.winner ? '**本轮实验胜者：' + selection.winner + '**。' : '**全部实验被硬条件排除，没有合格胜者。**',
    '结果仅属于同100种子的探索样本；未修改正式默认值，未以确定性复验代替平衡验收。', '',
    '## 本批结论', '',
    'J6保留两组好战配对达标，征服101/300（33.67%）、1v3平均92.47轮；保守对扩张11/66（16.67%）。征服和保守配对仍未达标，没有全目标候选。J4/J5因1v3平均超过95轮被硬排除。', '',
    'D42在J7/J8把征服提高到43.33%/46.33%，但两组好战配对都超过60%，达标配对数降为0，按既定规则排在J6之后。1v3好战夺取第三个HQ的席位由I1的22增至J6的28、J7的38、J8的41；未征服且首夺后无后续HQ攻击的席位由19变为14/14/12。', '',
    'D41并非几乎未触发：J1/J6保守实际宣战164/163次，首宣战中位均为26轮，涉及125/123席位；但保守对扩张仅新增2/3局征服。J1/J2有296/300局逐字节一致，全部300局的胜者、终局方式和轮数一致；4局命令或计分等细节有差异，不能称完全相同。J2多2次宣战，未改变本批胜负。', '',
    'J4与I1为300/300局逐字节一致。全部九组“已研究投石改装且攻城定位”的对城攻击次数为0，因此本批没有检验该倍率作用的实战暴露，不能据此泛化为倍率无效。J5的1v3重复占领从26降至22，但1v3平均仍为95.42轮。', '',
    'J6四因素总交互残差为征服+1.33pp、1v3轮数−0.39；J8与J6/D42的交互为征服−3.33pp、1v3轮数+1.01。这些是同样本的描述差分，不能拆成具体两因子的因果贡献。逐字节证据见factor-byte-comparison.json，九组汇总和重放遥测核对见analysis-validation.json。', '',
    '## 全指标', '',
    '每组300局：200局1v1互换、100局1v3。先手只统计1v1；捕捉为尝试数；滚雪球仅含轮30末唯一领跑者。配对66/68局来自33/34独立种子，Wilson95%未校正互换局相关性，只作描述区间。', ''];
  const table = (headers: string[], rows: (string | number)[][]) => {
    out.push('| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |');
    for (const row of rows) out.push('| ' + row.join(' | ') + ' |');
    out.push('');
  };
  const metricRows: (string | number)[][] = [];
  for (const [label, key] of [['征服≥40%', 'conquest'], ['先手≤55%', 'firstSeat'], ['无属性优势击坠>25%', 'withoutTypeAdvantage'],
    ['滚雪球≤75%', 'snowball'], ['aborted≤5%', 'aborted']] as const) metricRows.push([label, ...runs.map(run => {
    const s = run.all[key]; return pct(s.pointEstimate) + ' (' + s.numerator + '/' + s.n + ') ' + mark(s.target.passes);
  })]);
  for (const [label, key] of [['平均终局70–95', 'meanEndRound'], ['捕捉3–10', 'captureAttemptsPerGame']] as const)
    metricRows.push([label, ...runs.map(run => f(run.all[key].value) + ' ' + mark(run.all[key].target.passes))]);
  metricRows.push(['1v3终局70–95', ...runs.map(run => f(run.four.meanEndRound.value) + ' ' + mark(run.four.meanEndRound.target.passes))],
    ['defect=0', ...runs.map(run => run.all.defectGameCount + ' ' + mark(run.all.defectGameCount === 0))],
    ['迷雾拒绝', ...runs.map(run => run.all.fogRejectionCount)], ['30轮前终局', ...runs.map(run => run.all.earlyEndingBeforeRound30Count)]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) metricRows.push([
    runs[0].all.pairwise[i].pair + ' / ' + runs[0].all.pairwise[i].results[j].personality + '胜40–60%',
    ...runs.map(run => { const s = run.all.pairwise[i].results[j]; return pct(s.pointEstimate) + ' (' + s.numerator + '/' + s.n + '), 95%['
      + s.wilson95!.map(value => f(value * 100)).join(',') + '] ' + mark(s.target.passes); }),
  ]);
  table(['指标', ...runs.map(run => run.id)], metricRows);
  out.push('## 选择过程', '', '按§5依次检查硬条件、全目标、配对达标组数↓、征服率↓、最大区间距离↑、滚雪球↑。若J1/J2排序键相同，优先J1的2000；1500只可作为研究候选，不能替代D41正式文字。', '');
  table(['候选', '硬排除', '达标配对数', '征服', '最大偏离pp', '滚雪球', '全部达标'], [...selection.eligible, ...selection.excluded].map(row => [
    row.id, row.reasons.join(',') || '无', row.pairedGroups, pct(row.values.conquest), f(row.maxDistance * 100), pct(row.values.snowball), mark(row.allTargets),
  ]));
  out.push('硬条件后排序：' + (selection.eligible.map(row => row.id).join(' > ') || '无') + '。', '',
    '好战的两组原已达标配对必须单列核对，不能用保守对扩张的改善抵消退化。D18追加标记保留在comparison.json；本轮未追加合同外种子，发布候选仍需独立新样本。', '');
  const all = (run: typeof runs[number]) => run.diagnostics.groups.find(group => group.mode === 'all')!.personalities;
  const four = (run: typeof runs[number]) => run.diagnostics.groups.find(group => group.mode === '1v3')!.personalities;
  const time = (s: { median: number | null; n: number }) => f(s.median) + '轮 (n=' + s.n + ')';
  out.push('## D41 主动宣战与主动/被动战争', '',
    '满足门槛次数按“每条已接受命令前、可合法宣战的和平对手”计数：冷却结束、对手存活、观察军力和接壤条件满足；关闭开关也计潜在机会。它不是独立回合数，也不含被拒命令前的额外决策。enabled为其中开关打开的机会。实际次数是接受的DeclareWar；攻城/HQ按攻击当时战争发起方归类。', '');
  table(['批次', '潜在机会/enabled', '实际宣战', '首宣战', '首攻城', '首HQ', '保守/扩张征服局', '其中保守征服'], runs.map(run => {
    const p = all(run).find(p => p.personality === 'conservative')!;
    return [run.id, p.eligibleDeclarationPairs + '/' + p.enabledDeclarationPairs, p.declarations, time(p.firstDeclaration), time(p.firstCityAttack),
      time(p.firstHq), run.values.conservativeExpansionConquests!, run.values.conservativeExpansionConservativeConquests!];
  }));
  table(['批次/保守战争', '战争次数/首开战', '攻城次数', '占城/HQ', '首攻城', '首HQ'], runs.flatMap(run => {
    const p = all(run).find(p => p.personality === 'conservative')!;
    return (['offensive', 'defensive'] as const).map(war => [run.id + '/' + war, p.wars[war].started + '/' + time(p.wars[war].firstWar), p.wars[war].attacks,
      p.wars[war].captures + '/' + p.wars[war].hqs, time(p.wars[war].firstAttack), time(p.wars[war].firstHq)]);
  }));
  out.push('## 按性格的经济、军力门槛和攻城', '',
    '城市/科技取终局计分项（淘汰者冻结），维护取实际终局单位含休养；淘汰席位保留在分母。3/4兵为轮末首次达到；时点只统计达到者。成功占城攻击段允许跨轮，任意归属变化清零，包含中立城，不包含失败段。', '');
  table(['批次/性格', '席位', '开拓队', '城市/科技/维护均值', '首3兵/首4兵', '首攻城', '攻击段中位(n)'], runs.flatMap(run => all(run).map(p => [
    run.id + '/' + p.personality, p.seats, p.settlersProduced, [p.cities.mean, p.techs.mean, p.upkeep.mean].map(value => f(value)).join('/'),
    time(p.firstCombat3) + '/' + time(p.firstCombat4), time(p.firstCityAttack), f(p.attacksPerCapture.median) + ' (' + p.attacksPerCapture.n + ')',
  ])));
  out.push('## 1v3 首夺后的连续转化', '',
    'HQ序列按席位实际夺取顺序；间隔为相邻夺取轮数差。后续HQ攻击不含首次夺取那一击。无后续攻击不等于没有目标：目标观察仅在首夺后自己的EndTurn前采样，统计已知交战敌HQ，未看到对手隐藏状态。“始终无目标”分母为至少有一次此类采样的首夺席位，不把零采样席位算无目标。', '');
  table(['批次/性格', '首/二/三HQ席位', '一→二/二→三转化', '间隔中位1/2', '首夺→征服', '后续城/HQ攻击', '无后续HQ攻击总/未征服席位', '始终无目标/采样席位', '曾无目标席位'],
    runs.flatMap(run => four(run).map(p => [run.id + '/' + p.personality, p.hqCounts.join('/'),
      fraction(p.hqCounts[1], p.hqCounts[0]) + '/' + fraction(p.hqCounts[2], p.hqCounts[1]),
      p.hqGaps.map(gap => f(gap.median)).join('/'), fraction(p.conquestCaptors, p.hqCounts[0]),
      p.postHqCityAttacks + '/' + p.postHqEnemyHqAttacks, p.noSubsequentHqAttack + '/' + p.noSubsequentHqAttackNonConquest,
      p.neverKnownFollowupHq + '/' + p.postTurnObservedSeats, p.everNoKnownFollowupHq])));
  out.push('## 科技/攻城定位与重复占领', '',
    '攻击分类为攻击当时是否攻城定位×是否已解锁投石改装。伤害含最后一击溢出；攻击段列仅统计成功占城段中该分类的攻击数量，不是完整混合段长度。同一段可含多个分类，分类段数不能相加当作占城总数。', '');
  table(['批次/分类', '攻击次数', '伤害均值', '含该类的成功段数', '该类每段攻击中位'], runs.flatMap(run => Object.entries(run.diagnostics.cityAttackCategories).map(([category, d]) =>
    [run.id + '/' + category, d.damage.n, f(d.damage.mean), d.segmentAttacks.n, f(d.segmentAttacks.median)])));
  out.push('同城重复占领计该局第2次及之后所有占领；回防攻击定义为攻击一座己方曾拥有、现已失去的城市（含初始城市），不能泛化为所有防御战。', '');
  table(['批次/性格', '重复占领次数', '回防攻击次数', '1v3重复占领次数'], runs.flatMap(run => all(run).map(p => [
    run.id + '/' + p.personality, p.repeatedCaptures, p.recaptureAttacks, four(run).find(row => row.personality === p.personality)!.repeatedCaptures,
  ])));
  out.push('## 因子差值与交互', '',
    '比例用百分点，其余原单位。J1−I1为D41，J2−J1仅宣战倍率，J3/J4/J5分别为HP/攻城科技倍率/占城恢复，J7−I1为D42。J6残差仅表示四因素总交互，不能拆成两两交互；J8−J6−J7+I1是D42与J6组合的交互。', '');
  table(['对比', '征服pp', '总轮数', '1v3轮数', '好战胜扩张pp', '好战胜保守pp', '保守胜扩张pp', '滚雪球pp'], deltas.map(delta => [
    delta.name, ...['conquest', 'meanRound', 'meanFourRound', 'aggressive/expansion:aggressive', 'aggressive/conservative:aggressive', 'conservative/expansion:conservative', 'snowball']
      .map(key => f(delta.values[key] === null ? null : delta.values[key]! * (key.includes('Round') ? 1 : 100))),
  ]));
  table(['对比/性格', '城市均值Δ', '科技均值Δ', '维护均值Δ', '1v3第二HQ席位Δ', '第三HQ席位Δ', '始终无目标席位Δ'], deltas.flatMap(delta => PERSONALITIES.map(person => [
    delta.name + '/' + person, ...['all:' + person + ':cities:mean', 'all:' + person + ':techs:mean', 'all:' + person + ':upkeep:mean',
      '1v3:' + person + ':hq2', '1v3:' + person + ':hq3', '1v3:' + person + ':neverKnownFollowupHq'].map(key => f(delta.values[key])),
  ])));
  out.push('完整指标和诊断差值见comparison.json；缺失时点为null，不补0。', '', '## 运行证据', '');
  table(['批次', '目录', 'patch SHA-256', '确定性'], runs.map(run => [run.id, run.directory, run.manifest.patchSha256 ?? '无',
    run.determinism.every(row => row.equal && row.equalsRecorded) ? '1/50/100双跑及保存结果一致' : '失败']));
  out.push('默认和I1分别300/300字节一致，见compare-base.json和compare-i1.json。J1–J6字段无需映射且逐字匹配文档；J7=I1+D42，J8=J6+D42，见patch-validation.json。',
    '复算：node tools/b4-diagnostics.ts <run-directory> <proof>/<ID>-diagnostics.json；node tools/b4-report.ts <sim-root> <proof> <report.md>。',
    '全局指标来自games.jsonl；新诊断需games/*.json的命令与轮末快照，并按各自补丁重放；全部重放终局经canonical比较。', '');
  writeFileSync(report, out.join('\n'));
  return selection;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/b4-report.ts <sim-root> <proof-directory> <report.md>');
  const result = reportB4(process.argv[2], process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ winner: result.winner, ranking: result.eligible.map(row => row.id), excluded: result.excluded.map(row => ({ id: row.id, reasons: row.reasons })) }));
}
