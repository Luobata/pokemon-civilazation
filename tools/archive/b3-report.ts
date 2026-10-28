/** M5-6 factor report. Reads preserved runs and balance-diagnostics output; never reruns AI or edits runs.
 * Usage: node tools/archive/b3-report.ts <sim-root> <proof-directory> <report.md>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGames } from '../summary.ts';
import type { GameMetrics } from '../summary.ts';
import type { diagnoseBalance } from './balance-diagnostics.ts';
import { PERSONALITIES } from '../matches.ts';

type Values = Record<string, number | null>;
export type Candidate = { id: string; values: Values; pairs: (number | null)[][] };
const guards: [string, number | null, number | null, boolean?][] = [
  ['defect', 0, 0], ['aborted', 0, 0.05], ['firstSeat', null, 0.55], ['snowball', null, 0.75],
  ['captures', 3, 10], ['neutral', 0.25, null, true], ['meanRound', 70, 95], ['meanFourRound', 70, 95],
];
export function rankCandidates(candidates: Candidate[]) {
  const rows = candidates.map(candidate => {
    const reasons = guards.filter(([key, min, max, strict]) => {
      const value = candidate.values[key];
      return value == null || (min !== null && (strict ? value <= min : value < min)) || (max !== null && value > max);
    }).map(([key]) => key);
    if (candidate.values.conquest == null || candidate.pairs.length !== 3
      || candidate.pairs.some(pair => pair.length !== 2 || pair.some(value => value === null))) reasons.push('missing-primary-metric');
    const pairedGroups = candidate.pairs.filter(pair => pair.every(value => value !== null && value >= 0.4 && value <= 0.6)).length;
    const maxDistance = Math.max(...candidate.pairs.flat().map(value => value === null ? Infinity : Math.max(0.4 - value, value - 0.6, 0)));
    const allTargets = !reasons.length && pairedGroups === 3 && candidate.values.conquest! >= 0.4;
    return { ...candidate, reasons, pairedGroups, maxDistance, allTargets };
  });
  const eligible = rows.filter(row => !row.reasons.length).sort((a, b) =>
    Number(b.allTargets) - Number(a.allTargets)
    || (a.allTargets && b.allTargets ? a.maxDistance - b.maxDistance
      : b.pairedGroups - a.pairedGroups || b.values.conquest! - a.values.conquest! || a.maxDistance - b.maxDistance)
    || a.values.snowball! - b.values.snowball!);
  return { winner: eligible[0]?.id ?? null, eligible, excluded: rows.filter(row => row.reasons.length) };
}

const configs = [
  ['base', 'm5-4-base'], ['A', 'm5-4-plan-a'], ['B', 'm5-4-plan-b'],
  ...Array.from({ length: 6 }, (_, i) => ['I' + (i + 1), 'm5-6-i' + (i + 1)]),
];
const comparisons: [string, [string, number][]][] = [
  ['I1−B', [['I1', 1], ['B', -1]]], ['I1−I3', [['I1', 1], ['I3', -1]]],
  ['I2−B', [['I2', 1], ['B', -1]]], ['I2−I3', [['I2', 1], ['I3', -1]]],
  ['B−I3', [['B', 1], ['I3', -1]]], ['I4−I3', [['I4', 1], ['I3', -1]]],
  ['I5−I3', [['I5', 1], ['I3', -1]]], ['I6−I4', [['I6', 1], ['I4', -1]]],
  ['I6−I5', [['I6', 1], ['I5', -1]]], ['I6−I4−I5+I3', [['I6', 1], ['I4', -1], ['I5', -1], ['I3', 1]]],
];
const f = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits);
const pct = (value: number | null) => value === null ? '—' : f(value * 100) + '%';
const mark = (passes: boolean | null) => passes === null ? '不可算' : passes ? '达标' : '未达标';
export function buildB3Report(simRoot: string, proof: string, report: string) {
  const runs = configs.map(([id, directory]) => {
    const path = resolve(simRoot, directory);
    const games = readFileSync(resolve(path, 'games.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
    const all = summarizeGames(games), four = summarizeGames(games.filter(game => game.mode === '1v3'));
    const diagnostics = JSON.parse(readFileSync(resolve(proof, id + '-diagnostics.json'), 'utf8')) as ReturnType<typeof diagnoseBalance>;
    const manifest = JSON.parse(readFileSync(resolve(path, 'manifest.json'), 'utf8'));
    const determinism = JSON.parse(readFileSync(resolve(path, 'determinism.json'), 'utf8')) as { seed: number; equal: boolean; equalsRecorded: boolean }[];
    const values: Values = { conquest: all.conquest.pointEstimate, meanRound: all.meanEndRound.value, meanFourRound: four.meanEndRound.value,
      firstSeat: all.firstSeat.pointEstimate, neutral: all.withoutTypeAdvantage.pointEstimate, snowball: all.snowball.pointEstimate,
      captures: all.captureAttemptsPerGame.value, aborted: all.aborted.pointEstimate, defect: all.defectGameCount,
      fog: all.fogRejectionCount, early: all.earlyEndingBeforeRound30Count };
    for (const pair of all.pairwise) for (const row of pair.results) values[pair.pair + ':' + row.personality] = row.pointEstimate;
    const conservativeExpansion = games.filter(game => !game.aborted && !game.defect && game.mode === '1v1'
      && game.personalities.includes('conservative') && game.personalities.includes('expansion'));
    const gaps = conservativeExpansion.map(game => {
      const score = (personality: 'conservative' | 'expansion') => game.outcome!.ranking.find(row => row.playerId === game.personalities.indexOf(personality))!;
      const c = score('conservative'), e = score('expansion');
      return { cities: c.cities - e.cities, techs: c.techs - e.techs, total: c.total - e.total };
    });
    const ce = { games: gaps.length, conquests: conservativeExpansion.filter(game => game.kind === 'conquest').length,
      cityGap: gaps.reduce((sum, row) => sum + row.cities, 0) / gaps.length,
      techGap: gaps.reduce((sum, row) => sum + row.techs, 0) / gaps.length,
      scoreGap: gaps.reduce((sum, row) => sum + row.total, 0) / gaps.length };
    for (const [key, value] of Object.entries(ce)) values['conservativeVsExpansion:' + key] = value;
    const groups = diagnostics.groups.find(group => group.mode === 'all')!.personalities;
    for (const group of groups) {
      for (const [key, value] of Object.entries(group.final)) values[group.personality + ':' + key] = value.mean;
      for (const [key, value] of Object.entries(group.counts)) values[group.personality + ':' + key] = value;
      for (const key of ['firstCombat3', 'firstCombat4', 'firstCityAttack', 'firstEnemyCapture', 'attacksPerCapture'] as const) {
        values[group.personality + ':' + key] = group[key].median;
        values[group.personality + ':' + key + ':n'] = group[key].n;
      }
    }
    const hq = PERSONALITIES.map(personality => {
      const seats = diagnostics.seats.filter(seat => seat.mode === '1v3' && seat.personality === personality);
      const captors = seats.filter(seat => seat.headquartersCaptures > 0);
      const conquests = captors.filter(seat => games.some(game => game.id === seat.game && game.kind === 'conquest' && game.winners.includes(seat.playerId)));
      return { personality, seats: seats.length, captorSeats: captors.length, captorGames: new Set(captors.map(seat => seat.game)).size,
        hqCaptures: seats.reduce((sum, seat) => sum + seat.headquartersCaptures, 0), conquestSeats: conquests.length,
        conversion: captors.length ? conquests.length / captors.length : null };
    });
    for (const row of hq) for (const key of ['hqCaptures', 'captorSeats', 'conquestSeats', 'conversion'] as const) values[row.personality + ':hq:' + key] = row[key];
    return { id, directory, all, four, diagnostics, manifest, determinism, values, hq, ce,
      pairs: all.pairwise.map(pair => pair.results.map(row => row.pointEstimate)) };
  });
  const selection = rankCandidates(runs.filter(run => run.id.startsWith('I')));
  const deltas = comparisons.map(([name, terms]) => ({ name, values: Object.fromEntries(Object.keys(runs[0].values).map(key => {
    const numbers = terms.map(([id, weight]) => ({ value: runs.find(run => run.id === id)!.values[key], weight }));
    return [key, numbers.some(row => row.value == null) ? null : numbers.reduce((sum, row) => sum + row.value! * row.weight, 0)];
  })) }));
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ runs, selection, deltas }, null, 2));
  const out: string[] = ['# M5-6 / B3 因子实验', '',
    selection.winner ? '本轮实验胜者：**' + selection.winner + '**。' : '**六组均被硬条件排除，本轮无可选胜者。**',
    '这不是“平衡通过”。同一100种子用于探索，未以调参样本替代发布验收。所有正式默认值及 AI/core 保持不变。', '',
    'Hub 12:50 合约补充：I1 标为下一轮研究候选，不能绕过1v3终局硬条件视为合格胜者。I1有2组配对达标，其余实验只有1组；I1的1v3均值95.33>95、征服27.33%<40%、保守对扩张12.12%均仍需解决。', '',
    'I2/I3并非全部过程相同：297/300逐局文件字节一致，差异在1v3种子20/74/85，均出现宣战命令分歧。300局的终局类型、轮数、赢家相同；完整outcome仅299局一致，seed85击坠计分改变。无属性优势击坠52.5712%→52.5158%。因此只能说本样本未改变胜负/终局轮数，不能说宣战倍率没有任何作用。证据：i2-i3-differences.json。', '',
    '## 主要解释', '',
    '先看I1–I3：撤回好战经济放行（I1相对B）使其后续开拓队656→282、城市均值4.78→3.68，对扩张胜率68.18%→45.45%、对保守73.53%→47.06%，征服31.67%→27.33%。经济门槛是明显的失衡放大因素。单独将攻城4兵改3兵（B相对I3）使好战攻城席位161→193、首次攻城中位37→28轮、HQ占领171→213，征服提升6.33个百分点；这是可分离的攻城因子证据。I1/I3不能作同样单因子归因。', '',
    '再看I4–I6：I4相对I3把保守开拓队231→305、城市均值1.88→2.02，但科技均值不变；保守对扩张城市差缩小0.33、总分差缩小30.56，胜率仅8/66→9/66。I5相对I3把保守攻城席位48→53，HQ占领仍18，对好战胜率20/68→21/68；对扩张66局逐字节不变。I6相对I4的保守/扩张66局同样字节不变。反攻放宽在这批没有战争触发的配对中不起作用。', '',
    '组合交互I6−I4−I5+I3：征服、三组配对胜率及保守对扩张总分差的交互均为0；保守城市均值交互为−0.0112。没有证据把组合提升归为额外协同。I1只保留为研究起点，后续应聚焦保守路线与1v3清场，不把好战重新加强当作解决保守失衡的证据。', '',
    '## 指标与口径', '',
    '每组100种子、300局（1v1互换200局，1v3共100局），轮上限100。达标仅指点估计；配对每组66/68局来自33/34独立种子，互换局相关，Wilson区间是未校正相关性的描述区间。先手只统计1v1；滚雪球仅统计轮30末唯一领跑者；捕捉是尝试次数。', '',
    '| 指标（目标） | ' + runs.map(run => run.id).join(' | ') + ' |', '| --- | ' + runs.map(() => '---').join(' | ') + ' |'];
  const ratioRow = (label: string, key: 'conquest' | 'firstSeat' | 'withoutTypeAdvantage' | 'snowball' | 'aborted') =>
    out.push('| ' + label + ' | ' + runs.map(run => { const row = run.all[key]; return pct(row.pointEstimate) + ' (' + row.numerator + '/' + row.n + ') ' + mark(row.target.passes); }).join(' | ') + ' |');
  ratioRow('征服 ≥40%', 'conquest');
  for (const [label, value] of [
    ['平均终局70–95', (run: typeof runs[number]) => run.all.meanEndRound],
    ['1v3终局70–95', (run: typeof runs[number]) => run.four.meanEndRound],
    ['每局捕捉3–10', (run: typeof runs[number]) => run.all.captureAttemptsPerGame],
  ] as const) out.push('| ' + label + ' | ' + runs.map(run => f(value(run).value) + ' ' + mark(value(run).target.passes)).join(' | ') + ' |');
  ratioRow('先手 ≤55%', 'firstSeat'); ratioRow('无属性优势击坠 >25%', 'withoutTypeAdvantage');
  ratioRow('滚雪球 ≤75%', 'snowball'); ratioRow('aborted ≤5%', 'aborted');
  out.push('| defect=0 | ' + runs.map(run => run.all.defectGameCount + ' ' + mark(run.all.defectGameCount === 0)).join(' | ') + ' |');
  for (const [label, key] of [['迷雾拒绝', 'fogRejectionCount'], ['30轮前终局', 'earlyEndingBeforeRound30Count']] as const)
    out.push('| ' + label + ' | ' + runs.map(run => run.all[key]).join(' | ') + ' |');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const pair = runs[0].all.pairwise[i], person = pair.results[j].personality;
    out.push('| ' + pair.pair + ' / ' + person + '胜40–60% | ' + runs.map(run => {
      const row = run.all.pairwise[i].results[j];
      return pct(row.pointEstimate) + ' (' + row.numerator + '/' + row.n + '), 95%[' + row.wilson95!.map(x => f(x * 100)).join(',') + '] ' + mark(row.target.passes);
    }).join(' | ') + ' |');
  }
  out.push('', '保守对扩张的专门经济对照：差值为每局保守减扩张，终局计分项均值；不能用全性格均值替代。', '',
    '| 批次 | 局数 | 征服局 | 城市差 | 科技差 | 总分差 |', '| --- | --- | --- | --- | --- | --- |');
  for (const run of runs) out.push('| ' + [run.id, run.ce.games, run.ce.conquests, f(run.ce.cityGap), f(run.ce.techGap), f(run.ce.scoreGap)].join(' | ') + ' |');
  out.push('', '## 排除与选择', '', '只在 I1–I6 中选本轮候选；base/A/B 是对照。严格依 §4：先硬排除，再优先全达标；否则依次按配对达标组数↓、征服率↓、最大区间距离↑、滚雪球↑。相同排序键保留原编号顺序，不把它当作优胜证据。', '',
    '| 候选 | 硬排除原因 | 配对达标组数 | 征服 | 最大区间距离(pp) | 滚雪球 | 全目标达标 |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of [...selection.eligible, ...selection.excluded]) out.push('| ' + [row.id, row.reasons.join(', ') || '无', row.pairedGroups, pct(row.values.conquest), f(row.maxDistance * 100), pct(row.values.snowball), mark(row.allTargets)].join(' | ') + ' |');
  out.push('', '合格候选排序：' + (selection.eligible.map(row => row.id).join(' > ') || '无') + '。', '',
    'D18：本轮不追加合同外种子。comparison.json 保留各指标 needsAdditionalSeeds；失败项或比例距阈值不足5个百分点均需后续独立样本，研究候选仅用于下一轮实验。', '',
    '## 性格诊断', '',
    '来源：games/*.json 的轮末遥测和接受命令重放，使用每批 manifest 中自己的补丁。games.jsonl 不含轮末快照/命令，不能单独重建这些诊断。首次3/4兵取轮末地图宝可梦数；中位数仅包含达到者。终局城市/科技为胜利计分项（淘汰者冻结），维护/军力为真正终局状态，包含休养单位维护，淘汰席位仍在分母。', '',
    '| 批次/性格 | 席位 | 后续开拓队 | 城市均值 | 科技均值 | 维护均值 | 场上宝可梦均值 |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const run of runs) for (const group of run.diagnostics.groups.find(row => row.mode === 'all')!.personalities)
    out.push('| ' + [run.id + '/' + group.personality, group.seats, group.counts.settlersProduced, f(group.final.finalCities.mean), f(group.final.finalTechs.mean), f(group.final.finalUpkeep.mean), f(group.final.finalCombat.mean)].join(' | ') + ' |');
  out.push('', '| 批次/性格 | 首达3兵 | 首达4兵 | 首次攻城 | 首次占敌城 |', '| --- | --- | --- | --- | --- |');
  for (const run of runs) for (const group of run.diagnostics.groups.find(row => row.mode === 'all')!.personalities)
    out.push('| ' + [run.id + '/' + group.personality, ...(['firstCombat3', 'firstCombat4', 'firstCityAttack', 'firstEnemyCapture'] as const).map(key => f(group[key].median) + '轮 (' + group[key].n + '/' + group.seats + ')')].join(' | ') + ' |');
  out.push('', '攻城攻击段：占领者在同一城市当前归属期间累计攻击数，允许间隔；任意归属变化重置。只含成功占城，包含中立营地，不含失败攻击段。首次攻城也包含中立。', '',
    '| 批次/性格 | 敌城攻击/中立攻击 | 普通敌城/HQ/中立占领 | 成功攻击段中位数(n) | 城市反击击坠 |',
    '| --- | --- | --- | --- | --- |');
  for (const run of runs) for (const group of run.diagnostics.groups.find(row => row.mode === 'all')!.personalities) {
    const c = group.counts;
    out.push('| ' + [run.id + '/' + group.personality, c.enemyCityAttacks + '/' + c.neutralCityAttacks, c.ordinaryCaptures + '/' + c.headquartersCaptures + '/' + c.neutralCaptures,
      f(group.attacksPerCapture.median) + ' (' + group.attacksPerCapture.n + ')', c.cityCounterKnockdowns].join(' | ') + ' |');
  }
  out.push('', '1v3 HQ清场转化按席位归因：分母为该性格至少夺取一个HQ的席位，分子为其中最终征服获胜的席位。重复性格的两席分别计数；无HQ捕获者记—，不能视为0%。', '',
    '| 批次/性格 | HQ占领数 | 捕获席位/全部席位 | 最终征服席位 | 清场转化 |', '| --- | --- | --- | --- | --- |');
  for (const run of runs) for (const row of run.hq)
    out.push('| ' + [run.id + '/' + row.personality, row.hqCaptures, row.captorSeats + '/' + row.seats, row.conquestSeats, pct(row.conversion)].join(' | ') + ' |');
  out.push('', '## 因子差值', '',
    '均按行名左项减右项；比例以百分点，轮数/捕捉以原单位。I1−I3同时改变开拓队门槛和攻城兵数，属于混杂对比，不能按文档文字归因为单独3兵因素。I1−B是撤回经济放行，I2−B是撤回军事两项，I2−I3是撤回宣战倍率放宽，B−I3是单独放宽攻城4→3。I4/I5相对I3及I6差分与交互项按原设计计算。', '',
    '| 对比 | 征服pp | 总轮数 | 1v3轮数 | 好战胜扩张pp | 好战胜保守pp | 保守胜扩张pp | 滚雪球pp |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const delta of deltas) out.push('| ' + [delta.name, ...['conquest', 'meanRound', 'meanFourRound', 'aggressive/expansion:aggressive', 'aggressive/conservative:aggressive', 'conservative/expansion:conservative', 'snowball']
    .map(key => f(delta.values[key] === null ? null : delta.values[key]! * (key.includes('Round') ? 1 : 100)))].join(' | ') + ' |');
  out.push('', '| 对比/性格 | 城市均值Δ | 科技均值Δ | 维护均值Δ | 首次攻城中位Δ | 攻城达到席位Δ | HQ占领Δ |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const delta of deltas) for (const person of PERSONALITIES) out.push('| ' + [delta.name + '/' + person,
    ...['finalCities', 'finalTechs', 'finalUpkeep', 'firstCityAttack', 'firstCityAttack:n', 'headquartersCaptures'].map(key => f(delta.values[person + ':' + key]))].join(' | ') + ' |');
  out.push('', '其余全局指标、全部六向配对、开拓队、军力、占城次数、3/4兵时点和HQ转化差值完整保存在 comparison.json 的 deltas；任何项无样本时差值为null，不补零。时点中位数差对应不同达到者集合，仅作诊断。', '',
    '## 证据', '',
    '| 批次 | 目录 | patch SHA-256 | 确定性 |', '| --- | --- | --- | --- |');
  for (const run of runs) out.push('| ' + [run.id, run.directory, run.manifest.patchSha256 ?? '无补丁', run.determinism.every(row => row.equal && row.equalsRecorded) ? '1/50/100双跑一致' : '失败'].join(' | ') + ' |');
  out.push('', '复算：node tools/archive/balance-diagnostics.ts <run-directory> <proof>/<ID>-diagnostics.json；随后 node tools/archive/b3-report.ts <sim-root> <proof> <report.md>。',
    '六份JSON逐字匹配文档的证据见 patch-validation.json；原始summary由本脚本从games.jsonl重新计算，comparison.json保留完整指标、Wilson、诊断、排序与差值。旧批次不覆盖。', '');
  writeFileSync(report, out.join('\n'));
  return selection;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/archive/b3-report.ts <sim-root> <proof-directory> <report.md>');
  const result = buildB3Report(process.argv[2], process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ winner: result.winner, ranking: result.eligible.map(row => row.id), excluded: result.excluded.map(row => ({ id: row.id, reasons: row.reasons })) }));
}
