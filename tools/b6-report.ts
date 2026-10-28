/** M5-9 reporting only. Usage: node tools/b6-report.ts <sim-root> <proof-directory> <report.md> */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGames } from './summary.ts';
import type { GameMetrics } from './summary.ts';
import type { diagnoseB6 } from './b6-diagnostics.ts';
import { rankCandidates } from './b3-report.ts';
import { winCredit } from './statistics.ts';
import { parsePatch } from './patch.ts';
import { distribution } from './balance-diagnostics.ts';
import { PERSONALITIES } from './matches.ts';

const configs = [['K6', 'm5-9-k6'], ...Array.from({ length: 6 }, (_, i) => ['L' + (i + 1), 'm5-9-l' + (i + 1)])];
const comparisons: [string, [string, number][]][] = [
  ...['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map(id => [id + '−K6', [[id, 1], ['K6', -1]]] as [string, [string, number][]]),
  ...[['L2', 'L1'], ['L4', 'L3'], ['L5', 'L4'], ['L5', 'L1'], ['L6', 'L3'], ['L6', 'L2']].map(([a, b]) => [a + '−' + b, [[a, 1], [b, -1]]] as [string, [string, number][]]),
];
const f = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits);
const pct = (value: number | null) => value === null ? '—' : f(value * 100) + '%';
const mark = (passes: boolean | null) => passes === null ? '不可算' : passes ? '达标' : '未达标';
const fraction = (a: number, b: number) => a + '/' + b + ' (' + (b ? pct(a / b) : '—') + ')';
export function reportB6(simRoot: string, proof: string, report: string) {
  const runs = configs.map(([id, directory]) => {
    const path = resolve(simRoot, directory);
    const games = readFileSync(resolve(path, 'games.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
    const all = summarizeGames(games), four = summarizeGames(games.filter(game => game.mode === '1v3'));
    const diagnostics = JSON.parse(readFileSync(resolve(proof, id + '-diagnostics.json'), 'utf8')) as ReturnType<typeof diagnoseB6>;
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
    return { id, directory, games, all, four, diagnostics, manifest, determinism, values,
      pairs: all.pairwise.map(pair => pair.results.map(row => row.pointEstimate)) };
  });
  const selection = rankCandidates(runs.filter(run => run.id !== 'K6'));
  const deltas = comparisons.map(([name, terms]) => ({ name, values: Object.fromEntries(Object.keys(runs[0].values).map(key => {
    const rows = terms.map(([id, weight]) => ({ value: runs.find(run => run.id === id)!.values[key], weight }));
    return [key, rows.some(row => row.value === null) ? null : rows.reduce((sum, row) => sum + row.value! * row.weight, 0)];
  })) }));

  const out: string[] = ['# B6 / M5-9 第五轮实验', '',
    selection.winner ? '**本轮实验胜者：' + selection.winner + '**。' : '**全部实验被硬条件排除，没有合格胜者。**',
    '结果仅属于同100种子的探索样本；未修改正式默认值，未以确定性复验代替平衡验收。', '',
    selection.eligible.some(row => row.allTargets) ? '本探索批全部目标达标候选：' + selection.eligible.filter(row => row.allTargets).map(row => row.id).join('、') + '；仍未完成独立发布样本。'
      : '没有全部目标达标候选，胜者只表示本轮实验排序。', '',
    '## 本批结论', '',
    '六个新候选中的本轮实验胜者为L3（科技×30、扩张攻城关闭）：征服88/300（29.33%）、保守胜扩张18/66（27.27%），仍不达标。它保留两组好战配对；K6仅作对照，不参加候选排序。L3没有改善K6的主要缺口，滚雪球54.30%→55.02%，不能据此宣称优于K6。L4先手55.75%，触发硬排除。', '',
    'L1/L5征服121/300（40.33%），比K6净增33局，但扩张胜好战41/66（62.12%），越过60%；保守胜扩张分别13/66（19.70%）、14/66（21.21%）。L2/L6征服118/300（39.33%），扩张胜好战40/66（60.61%）仍越界，保守胜扩张19.70%。本轮没有同时满足征服与三组配对的候选。', '',
    'L1/L5扩张获得31场征服，其中30场是同一胜者由原计分胜转征服；L2/L6为27场，其中26场是同胜者转化。主要增量确实来自既有胜者提前清场，但少量额外胜者翻转已足以破坏配对。L1相对K6的1v1对好战为3场好战→扩张、1场扩张→好战，对保守为5场保守→扩张。', '',
    '按B6§2.4/§4，本批两个杠杆不足以完成全部目标：扩张征服路线得到实战证实，科技30/40仍不能补足保守对扩张。完成本合同后不自行继续同门槛微调，交Hub汇总科技实际产出、保守战争路线或非对称验收目标的方向选择。当前结论仅限同100种子探索，阈值附近与最终候选仍需D18追加/独立样本。', '',
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
  out.push('## 选择过程', '', '按§5依次检查硬条件、全目标、配对达标组数↓、征服率↓、最大区间距离↑、滚雪球↑。K6只作共同对照，不参与六组候选排序。相同排序键仅按输入顺序展示。', '');
  table(['候选', '硬排除', '达标配对数', '征服', '最大偏离pp', '滚雪球', '全部达标'], [...selection.eligible, ...selection.excluded].map(row => [
    row.id, row.reasons.join(',') || '无', row.pairedGroups, pct(row.values.conquest), f(row.maxDistance * 100), pct(row.values.snowball), mark(row.allTargets),
  ]));
  out.push('硬条件后排序：' + (selection.eligible.map(row => row.id).join(' > ') || '无') + '。', '',
    '好战的两组原已达标配对必须单列核对，不能用保守对扩张的改善抵消退化。D18追加标记保留在comparison.json；本轮未追加合同外种子，发布候选仍需独立新样本。', '');
  const all = (run: typeof runs[number]) => run.diagnostics.groups.find(group => group.mode === 'all')!.personalities;
  const four = (run: typeof runs[number]) => run.diagnostics.groups.find(group => group.mode === '1v3')!.personalities;
  const time = (s: { median: number | null; n: number }) => f(s.median) + '轮 (n=' + s.n + ')';
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
  out.push('## D44 扩张战争与攻城漏斗', '',
    '范围按全席位/1v3/1v1对手拆分。战争席位取实际参战事件；资格按每条已接受命令前的观察计数，属于决策点而非独立样本。各倍率的5格+HQ要求同一个合格交战对手的已知HQ。当前门槛资格即使开关关闭也计潜在值；启用列另计真正开启的资格。', '');
  const expansionSeats = (run: typeof runs[number], scope: string) => run.diagnostics.seats.filter(s => s.personality === 'expansion'
    && (scope === 'all' || (scope === '1v3' ? s.mode === '1v3' : s.mode === '1v1'
      && run.diagnostics.games.find(game => game.id === s.game)!.personalities.includes(scope as typeof PERSONALITIES[number]))));
  const scopes = ['all', '1v3', 'aggressive', 'conservative'];
  table(['批次/范围', '总/战争席位', '1500+1决策/席位', '1500+5', '2000+1', '2000+5', '1500+5+HQ', '2000+5+HQ'], runs.flatMap(run => scopes.map(scope => {
    const seats = expansionSeats(run, scope);
    return [run.id + '/' + scope, seats.length + '/' + seats.filter(s => s.wars.offensive.started + s.wars.defensive.started > 0).length,
      ...(['expansion1500d1', 'expansion1500d5', 'expansion2000d1', 'expansion2000d5', 'expansionHq1500d5', 'expansionHq2000d5'] as const)
        .map(key => seats.reduce((n, s) => n + s[key], 0) + '/' + seats.filter(s => s[key]).length)];
  })));
  out.push('阶段分别统计曾达到者，不假设已知HQ一定先于首次普通城攻；占城仅敌方城，HQ仅真实敌方HQ。当前条件/启用条件为决策点数及席位数；各时点只含达到者。扩张从不宣战，也没有未知HQ搜索。', '');
  table(['批次/范围', '当前条件决策/席位', '启用条件决策/席位', '已知HQ席位', '城攻次数/席位', '占城次数/席位', 'HQ次数/席位', '征服席位', '首次条件/城攻/HQ中位'], runs.flatMap(run => scopes.map(scope => {
    const seats = expansionSeats(run, scope);
    const attacks = (s: typeof seats[number]) => s.wars.offensive.attacks + s.wars.defensive.attacks;
    const captures = (s: typeof seats[number]) => s.wars.offensive.captures + s.wars.defensive.captures;
    return [run.id + '/' + scope, seats.reduce((n, s) => n + s.expansionCurrentGate, 0) + '/' + seats.filter(s => s.expansionCurrentGate).length,
      seats.reduce((n, s) => n + s.expansionEnabledGate, 0) + '/' + seats.filter(s => s.expansionEnabledGate).length,
      seats.filter(s => s.expansionKnownHq).length, seats.reduce((n, s) => n + attacks(s), 0) + '/' + seats.filter(s => attacks(s)).length,
      seats.reduce((n, s) => n + captures(s), 0) + '/' + seats.filter(s => captures(s)).length,
      seats.reduce((n, s) => n + s.hqs.length, 0) + '/' + seats.filter(s => s.hqs.length).length, seats.filter(s => s.wonConquest).length,
      time(distribution(seats.flatMap(s => s.firstExpansionGate === null ? [] : [s.firstExpansionGate]))) + '/'
        + time(distribution(seats.flatMap(s => s.firstCityAttack === null ? [] : [s.firstCityAttack]))) + '/'
        + time(distribution(seats.flatMap(s => s.hqs.length ? [s.hqs[0].round] : [])))];
  })));
  out.push('## 各性格征服胜利与同局转化', '',
    '征服贡献按实际胜者性格归属；占全部征服局和占该性格全部胜利分别列分母。计分并列按现有winCredit口径折算，征服局为唯一胜者。', '');
  const conquests = (run: typeof runs[number], personality: string) => run.games.filter(g => g.kind === 'conquest' && g.winners.some(id => g.personalities[id] === personality)).length;
  table(['批次/性格', '征服局', '占全部征服', '占该性格全部胜利信用', '占该性格席位'], runs.flatMap(run => PERSONALITIES.map(personality => {
    const n = conquests(run, personality), totalWins = run.games.reduce((sum, g) => sum + g.personalities.reduce((n, p, id) => n + (p === personality ? winCredit(g.winners, id) : 0), 0), 0);
    return [run.id + '/' + personality, n, fraction(n, run.all.conquest.numerator), fraction(n, totalWins), fraction(n, run.diagnostics.seats.filter(s => s.personality === personality).length)];
  })));
  const baseline = runs[0], sameSet = (a: number[], b: number[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const winnerLabel = (g: GameMetrics) => g.winners.map(id => g.personalities[id] + '#' + id).sort().join('+');
  const transitions = runs.slice(1).map(run => {
    const rows = run.games.map(g => {
      const before = baseline.games.find(b => b.id === g.id)!;
      return { id: g.id, mode: g.mode, beforeKind: before.kind, afterKind: g.kind, beforeWinners: before.winners, afterWinners: g.winners,
        beforeLabel: winnerLabel(before), afterLabel: winnerLabel(g), sameWinners: sameSet(before.winners, g.winners),
        samePersonalities: JSON.stringify(before.winners.map(id => before.personalities[id]).sort()) === JSON.stringify(g.winners.map(id => g.personalities[id]).sort()),
        expansionConquest: g.kind === 'conquest' && g.winners.some(id => g.personalities[id] === 'expansion') };
    });
    const flips = rows.filter(row => !row.sameWinners), directions: Record<string, number> = {};
    for (const row of flips) { const key = row.mode + ': ' + row.beforeLabel + ' → ' + row.afterLabel; directions[key] = (directions[key] ?? 0) + 1; }
    return { id: run.id, rows, directions, scoreToConquestSameWinner: rows.filter(r => r.beforeKind === 'score' && r.afterKind === 'conquest' && r.sameWinners).length,
      expansionScoreToConquestSameWinner: rows.filter(r => r.beforeKind === 'score' && r.expansionConquest && r.sameWinners).length,
      scoreToConquestSamePersonality: rows.filter(r => r.beforeKind === 'score' && r.afterKind === 'conquest' && r.samePersonalities).length,
      flips: flips.length, expansionNewConquests: conquests(run, 'expansion') - conquests(baseline, 'expansion'),
      aggressiveLostConquests: rows.filter(r => r.beforeKind === 'conquest' && r.beforeLabel.startsWith('aggressive#')
        && (r.afterKind !== 'conquest' || !r.afterLabel.startsWith('aggressive#'))).length,
      conservativeLostConquests: rows.filter(r => r.beforeKind === 'conquest' && r.beforeLabel.startsWith('conservative#')
        && (r.afterKind !== 'conquest' || !r.afterLabel.startsWith('conservative#'))).length,
      aggressiveConquestDelta: conquests(run, 'aggressive') - conquests(baseline, 'aggressive'), conservativeConquestDelta: conquests(run, 'conservative') - conquests(baseline, 'conservative'),
      netConquestDelta: run.all.conquest.numerator - baseline.all.conquest.numerator };
  });
  for (const t of transitions) if (t.expansionNewConquests + t.aggressiveConquestDelta + t.conservativeConquestDelta !== t.netConquestDelta)
    throw new Error('Conquest accounting mismatch: ' + t.id);
  out.push('按相同对局ID（种子/模式/换位）比较。胜者保持指玩家ID集合完全相同，另列仅性格集合相同（1v3重复性格可能换席）。翻转包含并列集合变化；旧征服流失指原为该性格征服、如今不再是该性格征服的对局，另列净差以区分被新增征服抵消的损失；正负征服差值相加应等于净增，K6到40%的原缺口为32局。', '');
  table(['候选−K6', '同胜者计分→征服', '其中扩张', '同性格计分→征服', '最终胜者翻转', '扩张新增征服', '好战征服Δ/旧征服流失', '保守征服Δ/旧征服流失', '净征服Δ/距120局缺口'], transitions.map(t => [
    t.id, t.scoreToConquestSameWinner, t.expansionScoreToConquestSameWinner, t.scoreToConquestSamePersonality, t.flips, t.expansionNewConquests,
    t.aggressiveConquestDelta + '/' + t.aggressiveLostConquests, t.conservativeConquestDelta + '/' + t.conservativeLostConquests, t.netConquestDelta + '/' + Math.max(0, 120 - baseline.all.conquest.numerator - t.netConquestDelta)]));
  table(['候选', '模式/胜者方向（性格#席位）', '局数'], transitions.flatMap(t => Object.entries(t.directions).map(([direction, n]) => [t.id, direction, n])));
  out.push('## 科技权重的计分和排名影响', '',
    '每个实际运行分别固定终局计分项和淘汰状态，以科技20/30/40重算；保留联盟规章逐人倍率和取整、总分→城市→人口→科技→击坠平分规则，仅存活者可获计分胜。征服胜者/轮数保持，轮30领先者用当轮计分项和当轮联盟状态重算。当前权重重算已逐局核对实际完整排名/胜者/轮30领先者。', '');
  const rescored = runs.flatMap(run => [20, 30, 40].map(weight => {
    const games = run.games.map(g => {
      const counter = run.diagnostics.games.find(d => d.id === g.id)!.counterfactuals.find(c => c.techWeight === weight)!;
      return { ...g, winners: counter.winners, outcome: g.outcome ? { ...g.outcome, winners: counter.winners, ranking: counter.ranking } : null,
        telemetry: { ...g.telemetry, round30Leader: counter.round30Leader } };
    });
    const summary = summarizeGames(games);
    return { id: run.id, weight, summary, winnerChanges: games.filter((g, i) => !sameSet(g.winners, run.games[i].winners)).length,
      rankingOrderChanges: games.filter((g, i) => JSON.stringify(g.outcome?.ranking.map(s => s.playerId)) !== JSON.stringify(run.games[i].outcome?.ranking.map(s => s.playerId))).length };
  }));
  table(['固定时间线/科技权重', '胜者变动局', '排名顺序变动局', '征服', '先手', '滚雪球', '好战胜保守', '好战胜扩张', '保守胜扩张'], rescored.map(r => [r.id + '/' + r.weight, r.winnerChanges, r.rankingOrderChanges,
    pct(r.summary.conquest.pointEstimate), pct(r.summary.firstSeat.pointEstimate), pct(r.summary.snowball.pointEstimate), ...r.summary.pairwise.map(p => pct(p.results[0].pointEstimate))]));
  table(['实际批次/配对差方向', '城市项差', '科技项差', '其他项差', '实际总分差'], runs.flatMap(run => [['aggressive', 'conservative'], ['aggressive', 'expansion'], ['conservative', 'expansion']].map(([a, b]) => {
    const seats = run.diagnostics.seats.filter(s => s.mode === '1v1' && s.personality === a && run.diagnostics.games.find(g => g.id === s.game)!.personalities.includes(b as typeof PERSONALITIES[number]));
    const weights = parsePatch(run.manifest.patch ?? {}).content.balance.score;
    const diffs = seats.map(s => { const other = run.diagnostics.seats.find(o => o.game === s.game && o.personality === b)!, first = s.finalScoreBreakdown!, second = other.finalScoreBreakdown!;
      return [(first.cities - second.cities) * weights.cities, (first.techs - second.techs) * weights.techs,
        (first.population - second.population) * weights.population + (first.species - second.species) * weights.species + (first.knockdowns - second.knockdowns) * weights.knockdowns, first.total - second.total]; });
    return [run.id + '/' + a + '−' + b, ...[0, 1, 2, 3].map(i => f(distribution(diffs.map(d => d[i])).mean))];
  })));
  table(['K6固定时间线/科技权重/差方向', '城市项差', '科技项差', '实际总分差'], [20, 30, 40].flatMap(weight =>
    [['aggressive', 'conservative'], ['aggressive', 'expansion'], ['conservative', 'expansion']].map(([a, b]) => {
      const games = baseline.diagnostics.games.filter(g => g.mode === '1v1' && g.personalities.includes(a as typeof PERSONALITIES[number]) && g.personalities.includes(b as typeof PERSONALITIES[number]));
      const diffs = games.map(g => { const ranking = g.counterfactuals.find(c => c.techWeight === weight)!.ranking;
        const first = ranking.find(s => g.personalities[s.playerId] === a)!, second = ranking.find(s => g.personalities[s.playerId] === b)!;
        return [(first.cities - second.cities) * 80, (first.techs - second.techs) * weight, first.total - second.total]; });
      return ['K6/×' + weight + '/' + a + '−' + b, ...[0, 1, 2].map(i => f(distribution(diffs.map(d => d[i])).mean))];
    })));
  out.push('城市/科技/其他分项列未乘联盟倍率；实际总分列包含联盟取整，分项列不能直接相加替代实际总分差。', '');
  table(['实际批次−K6同权重固定命令', '征服pp', '先手pp', '滚雪球pp', '平均轮数Δ', '1v3轮数Δ', '好战胜保守pp', '好战胜扩张pp', '保守胜扩张pp'], runs.slice(1).map(run => {
    const weight = parsePatch(run.manifest.patch).content.balance.score.techs, fixed = rescored.find(r => r.id === 'K6' && r.weight === weight)!.summary;
    return [run.id + '/×' + weight, f((run.all.conquest.pointEstimate! - fixed.conquest.pointEstimate!) * 100), f((run.all.firstSeat.pointEstimate! - fixed.firstSeat.pointEstimate!) * 100),
      f((run.all.snowball.pointEstimate! - fixed.snowball.pointEstimate!) * 100), f(run.all.meanEndRound.value! - fixed.meanEndRound.value!), f(run.four.meanEndRound.value! - baseline.four.meanEndRound.value!),
      ...run.all.pairwise.map((p, i) => f((p.results[0].pointEstimate! - fixed.pairwise[i].results[0].pointEstimate!) * 100))];
  }));
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ runs, selection, deltas, transitions, rescored }, null, 2));
  out.push('### 攻城物种获取与使用', '',
    '各列为事件次数/涉及席位，登记为不同物种登记总数/席位；训练为生产完成数（含待部署，以订单去重）。只计主动攻击事件，不含反击。各阶段独立统计，不要求先训练才可作战（捕捉也提供单位）。有科技对城要求同一攻击时已研究投石改装。', '');
  table(['批次/性格', '席位', '登记', '捕捉尝试/成功', '训练完成', '训练下单', '对单位攻击', '对城攻击', '有科技对城', '科技席位/登记且科技'], runs.flatMap(run => PERSONALITIES.map(personality => {
    const seats = run.diagnostics.seats.filter(s => s.personality === personality);
    const value = (key: 'siegeTrained' | 'siegeTrainingOrders' | 'siegeUnitAttacks' | 'siegeCityAttacks' | 'siegeTechCityAttacks') =>
      seats.reduce((n, s) => n + s[key], 0) + '/' + seats.filter(s => s[key]).length;
    return [run.id + '/' + personality, seats.length, seats.reduce((n, s) => n + s.siegeRegistered.length, 0) + '/' + seats.filter(s => s.siegeRegistered.length).length,
      seats.reduce((n, s) => n + s.siegeCaptureAttempts, 0) + '/' + seats.reduce((n, s) => n + s.siegeCaptureSuccesses, 0),
      value('siegeTrained'), value('siegeTrainingOrders'), value('siegeUnitAttacks'), value('siegeCityAttacks'), value('siegeTechCityAttacks'),
      seats.filter(s => s.hasSiegeTech).length + '/' + seats.filter(s => s.registeredAndTech).length];
  })));
  out.push('## 条件因子差值', '',
    '比例用百分点，其余原单位。L1/L2测扩张攻城1500/2000，L3/L4测科技30/40；L5=L1攻城+L4科技，L6=L2攻城+L3科技。L5−L4/L6−L3是各科技权重下的条件攻城差；L5−L1/L6−L2是各攻城条件下的科技差。不是完整统一因子设计，不计算统一交互残差。', '');
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
  out.push('默认和K6分别300/300字节一致，见compare-base.json和compare-k6.json。L1–L6完整补丁逐字匹配设计文档，三个新字段全部保留且通过parsePatch，无字段映射，见patch-validation.json。',
    '复算：node tools/b6-diagnostics.ts <run-directory> <proof>/<ID>-diagnostics.json；node tools/b6-report.ts <sim-root> <proof> <report.md>。',
    '全局指标来自games.jsonl；新诊断需games/*.json的命令与轮末快照，并按各自补丁重放；全部重放终局经canonical比较。', '');
  writeFileSync(report, out.join('\n'));
  return selection;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/b6-report.ts <sim-root> <proof-directory> <report.md>');
  const result = reportB6(process.argv[2], process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ winner: result.winner, ranking: result.eligible.map(row => row.id), excluded: result.excluded.map(row => ({ id: row.id, reasons: row.reasons })) }));
}
