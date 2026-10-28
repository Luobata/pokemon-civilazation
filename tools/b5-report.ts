/** M5-8 reporting only. Usage: node tools/b5-report.ts <sim-root> <proof-directory> <report.md> */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGames } from './summary.ts';
import type { GameMetrics } from './summary.ts';
import type { diagnoseB5 } from './b5-diagnostics.ts';
import { rankCandidates } from './b3-report.ts';
import { distribution } from './balance-diagnostics.ts';
import { PERSONALITIES } from './matches.ts';

const configs = [['J8', 'm5-8-j8'], ...['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'S1', 'S2', 'S3', 'C1'].map(id => [id, 'm5-8-' + id.toLowerCase()])];
const comparisons: [string, [string, number][]][] = [
  ...['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'S1', 'S2', 'S3', 'C1'].map(id => [id + '−J8', [[id, 1], ['J8', -1]]] as [string, [string, number][]]),
  ['K6−K1−K2−K3−K4−K5+4J8', [['K6', 1], ['K1', -1], ['K2', -1], ['K3', -1], ['K4', -1], ['K5', -1], ['J8', 4]]],
  ['S3−S1−S2+J8', [['S3', 1], ['S1', -1], ['S2', -1], ['J8', 1]]],
];
const f = (value: number | null, digits = 2) => value === null ? '—' : value.toFixed(digits);
const pct = (value: number | null) => value === null ? '—' : f(value * 100) + '%';
const mark = (passes: boolean | null) => passes === null ? '不可算' : passes ? '达标' : '未达标';
const fraction = (a: number, b: number) => a + '/' + b + ' (' + (b ? pct(a / b) : '—') + ')';
export function reportB5(simRoot: string, proof: string, report: string) {
  const runs = configs.map(([id, directory]) => {
    const path = resolve(simRoot, directory);
    const games = readFileSync(resolve(path, 'games.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as GameMetrics);
    const all = summarizeGames(games), four = summarizeGames(games.filter(game => game.mode === '1v3'));
    const diagnostics = JSON.parse(readFileSync(resolve(proof, id + '-diagnostics.json'), 'utf8')) as ReturnType<typeof diagnoseB5>;
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
  const selection = rankCandidates(runs.filter(run => run.id !== 'J8'));
  const deltas = comparisons.map(([name, terms]) => ({ name, values: Object.fromEntries(Object.keys(runs[0].values).map(key => {
    const rows = terms.map(([id, weight]) => ({ value: runs.find(run => run.id === id)!.values[key], weight }));
    return [key, rows.some(row => row.value === null) ? null : rows.reduce((sum, row) => sum + row.value! * row.weight, 0)];
  })) }));
  writeFileSync(resolve(proof, 'comparison.json'), JSON.stringify({ runs, selection, deltas }, null, 2));
  const out: string[] = ['# B5 / M5-8 第四轮实验', '',
    selection.winner ? '**本轮实验胜者：' + selection.winner + '**。' : '**全部实验被硬条件排除，没有合格胜者。**',
    '结果仅属于同100种子的探索样本；未修改正式默认值，未以确定性复验代替平衡验收。', '',
    '## 本批结论', '',
    'K6按既定排序成为本轮实验胜者：两组好战配对达标，保守对扩张27.27%，征服88/300（29.33%）。这不是最终平衡通过；没有任何候选同时满足征服≥40%和全部配对40–60%。K3征服48.67%最高，但先手55.5%超过55%的硬条件，必须排除。', '',
    'K1将攻城/搜索资格一起从3兵提高到4兵，恢复两组好战配对，却把征服降至29%。K6叠加另外四个因素后也只有29.33%；不能把两个共同触发效果拆开归因。K2、K4和C1没有解决保守对扩张，K3/K5各为21.21%，仍离40%下限很远。', '',
    'S2与J8为300/300局字节一致；S1/S3分别与J8为296/300局字节一致，S1与S3彼此300/300一致。相同征服率或配对胜率不代表行为全部相同；详见factor-byte-comparison.json和compare-s1-s3.json。加分保留原goal顺序，捕捉候选仍排在军事候选之后。', '',
    '按B5§2.3的条件性结论：在当前征服/计分条件和现有AI下，保守定位尚无与扩张型相称的稳定胜利路线。这不是逻辑上的不可能性证明；本批证据不足以支持继续微调同一组门槛。交Hub汇总后决定是否向用户提出科技转化为经济/军事产出、重新设计战争推进，或接受非对称强度/调整验收目标；本轮不擅改这些规则。', '',
    'S1/S2/S3好战攻城物种均为2次捕捉尝试、0成功/登记、0训练、0对城攻击；训练加分缺少前置登记。C1在保守对扩张有211次符合搜索方向的移动，但宣战39席→攻城31席→宣战后曾知HQ27席→占HQ3席→征服3席，胜率15.15%，未改善路线。阶段分别计数，不把已知目标误当实际攻击。', '',
    'K3把保守对扩张宣战席位39→49、HQ/征服3→6；K5保持39个宣战席位、HQ/征服增至5；K6为49个宣战席位、HQ/征服7。好战攻城定位对城攻击在K1/K6分别出现8/18次，K6有32只训练完成，但十一组仍没有任何攻城定位在投石改装后的对城攻击，1750倍率仍未被这批实战检验。', '',
    '所有数值仍来自同100种子；K3先手、K6先手/1v3等靠近阈值，D18追加与独立发布样本需求保留，未超出本合同另跑新种子。', '',
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
  out.push('## 选择过程', '', '按§5依次检查硬条件、全目标、配对达标组数↓、征服率↓、最大区间距离↑、滚雪球↑。J8只作共同对照，不参与十组候选排序。S1/S2/S3排序键相同，展示顺序沿用输入次序，不代表优劣。', '');
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
  out.push('## B5 搜索、经济与攻城漏斗', '',
    '搜索决策数为每条已接受命令前满足搜索资格的次数；方向移动为其中Move恰好缩短到D42选定目标的距离，不断言它最终由哪个重叠候选选中。HQ转化只计首次方向移动之后的HQ占领，非因果估计。', '');
  table(['批次/性格', '搜索决策/席位', '方向移动/席位', '首方向移动中位', '搜索后HQ席位', '搜索后征服席位', '和平完成开拓队', '人口均值'], runs.flatMap(run => PERSONALITIES.map(personality => {
    const seats = run.diagnostics.seats.filter(s => s.personality === personality);
    const movers = seats.filter(s => s.firstSearchMove !== null);
    const hqs = movers.filter(s => s.hqs.some(hq => hq.seq > s.firstSearchSeq!));
    return [run.id + '/' + personality, seats.reduce((n, s) => n + s.searchDecisions, 0) + '/' + seats.filter(s => s.searchDecisions).length,
      seats.reduce((n, s) => n + s.searchMoves, 0) + '/' + movers.length,
      time(distribution(movers.map(s => s.firstSearchMove!))), hqs.length, hqs.filter(s => s.wonConquest).length,
      seats.reduce((n, s) => n + s.peaceSettlers, 0), f(distribution(seats.map(s => s.finalPopulation)).mean)];
  })));
  out.push('### 保守对扩张（66局）', '',
    '门槛暴露按每条已接受命令前是否至少存在一个满足条件的对手计数；2000/1500均只比较战争中的观察军力，已知HQ列再要求同一对手的已知HQ。宣战距离1/5反事实固定宣战军力2000，合法和平、冷却结束、对手存活；不代表实际开启。', '');
  const pairSeats = (run: typeof runs[number]) => run.diagnostics.seats.filter(s => s.personality === 'conservative' && s.mode === '1v1'
    && run.diagnostics.games.find(game => game.id === s.game)!.personalities.includes('expansion'));
  const count = (seats: typeof runs[number]['diagnostics']['seats'], key: 'declarationDistance1' | 'declarationDistance5' | 'siege2000' | 'siege1500' | 'siege1500Only' | 'knownHq2000' | 'knownHq1500') =>
    seats.reduce((n, s) => n + s[key], 0) + '/' + seats.filter(s => s[key]).length;
  table(['批次', '距离1决策/席位', '距离5决策/席位', '攻城2000', '攻城1500', '仅1500', '军力2000+HQ', '军力1500+HQ'], runs.map(run => {
    const seats = pairSeats(run); return [run.id, ...(['declarationDistance1', 'declarationDistance5', 'siege2000', 'siege1500', 'siege1500Only', 'knownHq2000', 'knownHq1500'] as const).map(key => count(seats, key))];
  }));
  out.push('漏斗以实际宣战席位为起点；后续攻城/已知HQ分别统计宣战后曾达到者，二者不是严格先后包含关系。HQ为宣战后占领，征服为这些HQ占领者中的最终征服胜者。首时点只含达到者。另列所有HQ攻击，避免把无攻击与无目标混同。', '');
  table(['批次/范围', '潜在宣战席位', '实际宣战席位/次数', '首宣战', '宣战后攻城', '宣战后已知HQ', '宣战后HQ/征服', 'HQ攻击数/席位', '保守−扩张城市/科技/人口/分数'], runs.flatMap(run => ['all', 'conservative/expansion'].map(scope => {
    const seats = scope === 'all' ? run.diagnostics.seats.filter(s => s.personality === 'conservative') : pairSeats(run), declared = seats.filter(s => s.declarations.length);
    const captors = declared.filter(s => s.hqs.some(hq => hq.seq > s.declarations[0].seq));
    const diff = (key: 'finalCities' | 'finalTechs' | 'finalPopulation' | 'finalScore') => distribution(seats.map(s => s[key]
      - run.diagnostics.seats.find(other => other.game === s.game && other.personality === 'expansion')![key])).mean;
    return [run.id + '/' + scope, seats.filter(s => s.eligibleDeclarationPairs).length, declared.length + '/' + declared.reduce((n, s) => n + s.declarations.length, 0),
      time(distribution(declared.map(s => s.declarations[0].round))), declared.filter(s => s.firstCityAttackAfterDeclaration !== null).length,
      declared.filter(s => s.firstKnownHqAfterDeclaration !== null).length, captors.length + '/' + captors.filter(s => s.wonConquest).length,
      seats.reduce((n, s) => n + s.hqAttacks, 0) + '/' + seats.filter(s => s.hqAttacks).length,
      scope === 'all' ? '—' : (['finalCities', 'finalTechs', 'finalPopulation', 'finalScore'] as const).map(key => f(diff(key))).join('/')];
  })));
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
  out.push('## 因子差值与交互', '',
    '比例用百分点，其余原单位。K1同时控制攻城和D42搜索资格，不能拆分贡献；K2为开拓门槛，K3接壤，K4和平开拓间隔，K5独立攻城倍率。K6残差是五因素总交互，不可拆成两两贡献。S1/S2为捕捉/训练加分，S3残差为两者交互，C1为保守搜索。', '');
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
  out.push('默认和J8分别300/300字节一致，见compare-base.json和compare-j8.json。K1–K6逐字匹配文档；S1/S2/S3/C1按合同从J8加字段，无字段映射，见patch-validation.json。',
    '复算：node tools/b5-diagnostics.ts <run-directory> <proof>/<ID>-diagnostics.json；node tools/b5-report.ts <sim-root> <proof> <report.md>。',
    '全局指标来自games.jsonl；新诊断需games/*.json的命令与轮末快照，并按各自补丁重放；全部重放终局经canonical比较。', '');
  writeFileSync(report, out.join('\n'));
  return selection;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node tools/b5-report.ts <sim-root> <proof-directory> <report.md>');
  const result = reportB5(process.argv[2], process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ winner: result.winner, ranking: result.eligible.map(row => row.id), excluded: result.excluded.map(row => ({ id: row.id, reasons: row.reasons })) }));
}
