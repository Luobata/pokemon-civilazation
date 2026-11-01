# 模拟与统计工具

从仓库根目录执行；使用支持直接运行 TypeScript 的 Node.js（本轮验证为 v25.8.1），先 `npm ci`。正式默认值为 GDD v0.7、rules `m5-v1`；发布验收不传补丁。

## 长期入口

| 文件 | 用途与调用方式 |
| --- | --- |
| `simulate.ts` | 快速冒烟：`npm run sim -- --seeds 10`，输出到 stdout；程序接口 `simulateMatch(match, 100, options?)` 支持指定编排。冒烟不等于发布验收。 |
| `explore.ts` | 完整探索批次：`npm run sim:explore -- --seeds 100 --out /tmp/pokemon-explore`；输出逐局 JSON、紧凑 JSONL、schedule、summary、manifest 和重复种子证明。使用新的输出目录，避免覆盖或混入旧局。 |
| `matches.ts` | `explorationMatches(count)` 生成双局换座的 1v1 与轮换座位的 1v3；`matchSetup(match, 100)` 转为开局配置，默认 24×16。 |
| `patch.ts` | 实验补丁解析：`parsePatch(json)`；CLI 使用 `npm run sim:explore -- --seeds 10 --patch tools/patches/city-hp.json --out /tmp/pokemon-experiment`。范围和历史补丁说明见 [patches/README.md](patches/README.md)。 |
| `summary.ts` | `compactResult(result)` 压缩单局记录；`summarizeGames(games)` 汇总胜率、轮数、捕捉和缺陷等指标。下方发布脚本给出实际调用。 |
| `statistics.ts` | 底层统计函数：`wilson95(50, 100)`、`mean([{seed: 1, value: 80}])`、`ratio([{seed: 1, successes: 1, trials: 1}])`、`threshold(0.5, 0.4, 0.6, true)`、`winCredit([0, 1], 0)`。供 summary 和报告复用。 |
| `compare-games.ts` | `node tools/compare-games.ts /path/to/baseline /path/to/candidate`；要求两边 `games/*.json` 文件集合相同，逐字节比较，不归一化版本或 JSON。差异时非零退出。 |
| `telemetry.ts` | 模拟器内部使用 `createTelemetry(state)`、`collectTelemetry(data, before, after, command, events)` 记录活动和战斗；`roundSnapshot(state, round)`、`uniqueScoreLeader(snapshot)` 记录第 30 轮领先者。无独立 CLI。 |
| `rejections.ts` | 模拟器内部调用 `classifyRejection(state, command, reason, content?)`，区分迷雾下合法尝试被拒与缺陷。无独立 CLI。 |

## M6 发布批次复现

发布数据为种子 1–100、101–200、201–300 三批，每批 300 局（200 局 1v1、100 局 1v3），24×16、100 轮、全部 AI、无补丁。每批复用 `explorationMatches(100)` 的性格和换座安排，只平移 seed/id。不能用 `explorationMatches(300)` 代替，也不能把 `--seeds 3` 的编排当成 100 种子批次的前三个种子。

下面在一个**不存在的新目录**生成三批逐局数据、紧凑记录、编排、汇总和运行版本；数据写入临时目录，不覆盖历史证据。完整 900 局耗时较长。

```sh
node --input-type=module - /tmp/pokemon-release-repro <<'JS'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { explorationMatches } from './tools/matches.ts';
import { simulateMatch } from './tools/simulate.ts';
import { compactResult, summarizeGames } from './tools/summary.ts';

const root = resolve(process.argv[2]);
mkdirSync(root); // 拒绝覆盖已有结果
for (const offset of [0, 100, 200]) {
  const out = resolve(root, `${offset + 1}-${offset + 100}`);
  mkdirSync(resolve(out, 'games'), { recursive: true });
  const matches = explorationMatches(100).map(m => ({
    ...m, seed: m.seed + offset, id: `${m.mode}-${m.seed + offset}-${m.leg}`,
  }));
  const manifest = {
    node: process.version, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    started: new Date().toISOString(), patch: null, width: 24, height: 16, roundLimit: 100,
    seeds: [...new Set(matches.map(m => m.seed))], games: matches.length,
  };
  writeFileSync(resolve(out, 'schedule.json'), JSON.stringify(matches, null, 2));
  const games = [];
  for (const match of matches) {
    const result = simulateMatch(match, 100);
    const compact = compactResult(result);
    games.push(compact);
    writeFileSync(resolve(out, 'games', `${match.id}.json`), JSON.stringify(result));
    appendFileSync(resolve(out, 'games.jsonl'), JSON.stringify(compact) + '\n');
    if (result.defect || result.aborted || result.exception || !result.outcome) {
      throw new Error(`Inspect saved game: ${match.id}`);
    }
    if (games.length % 15 === 0) console.log(out, games.length, '/', matches.length);
  }
  const summary = {
    all: summarizeGames(games),
    oneVsOne: summarizeGames(games.filter(g => g.mode === '1v1')),
    oneVsThree: summarizeGames(games.filter(g => g.mode === '1v3')),
  };
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify({
    ...manifest, versions: games[0].telemetry.versions, finished: new Date().toISOString(),
  }, null, 2));
}
JS
```

与 M6 原始证据比较（本机 GSB 目录示例；其他环境需提供相同历史数据）：

```sh
sim_root=/Users/bytedance/.local/state/gsb-local/pokemon-civilazation/reports/sim
node tools/compare-games.ts "$sim_root/m5-12-final-1-100" /tmp/pokemon-release-repro/1-100
node tools/compare-games.ts "$sim_root/m5-12-final-101-200" /tmp/pokemon-release-repro/101-200
node tools/compare-games.ts "$sim_root/m6-release-201-300" /tmp/pokemon-release-repro/201-300
```

汇总时可将三批 `games.jsonl` 解析并合并后调用 `summarizeGames`，同时保留每批结果。`summary.pairwise` 会报告全部性格配对；D45 仅把好战对扩张、好战对保守的 40–60% 作为验收条件，保守对扩张仅供参考。比例阈值附近的追加种子信号不能与“已达标”混为一谈。M6 的具体发布结论和 D18 追加复验依据保存在共享 `reports/release-m6.md`。

归档后仍可从 `tools/archive/b7-report.ts` 导入 `assessD45` 复算当时的 11 项条件。共享 `reports/sim/m6-proof/report.mjs` 等历史脚本若仍导入 `tools/b7-report.ts`，在当前代码上使用时需把导入路径改成 `tools/archive/b7-report.ts`；其余历史输入和口径也需匹配，不能把 B7 报告 CLI 当成通用发布报告入口。

## 领袖受控对局

```sh
npm run sim:leaders -- --seeds 10 --round-limit 100 --out /tmp/pokemon-leaders.json
```

每个种子按三种 AI 性格分组，每组四局轮换四位领袖的座位。每局四方使用相同性格，记录胜利份额、终局分数、开局条件、缺陷与迷雾拒绝。支持 100/200/300 轮；样本数等于种子数 ×12。输出包括逐局数据、版本和源码哈希；不修改生产数值。[120 局诊断报告](../docs/design/leader-balance-report.md)说明了观测相关性和样本边界。

新增 `--expansion true --eras simple` 启用精简时代，`--eras full` 启用完整世代；`--eras none` 或省略保持原规则。报告新增真实城市/HQ 攻击和占领、战争段和停战、攻城科技与首次攻击轮次、角色构成、实际时代到达轮次。`early/middle/late` 的科技数量诊断分段独立于正式时代，不能当作完整模式的时代统计。城市占领包含中立营地，需结合 `cityEvents[].defenderId` 区分敌方城市；HQ 占领只统计原拥有者的总部。每局城市详细事件最多 2000 条，超过时 `cityEventLogTruncated=true`，汇总计数继续完整记录。

```sh
node tools/leader-balance.ts --seeds 4 --seed-start 21 --expansion true --eras simple --round-limit 100 --out /tmp/pokemon-era-simple.json
```

## 归档与验证

B3–B7 报告、诊断及早期一次性工具移到 [archive/](archive/README.md)，对应测试移到 `tests/tools/archive/`，仍由 `npm test -- --run` 执行。仅调整位置、导入和命令提示；通用模拟模块、历史补丁 JSON 与游戏规则不变。

```sh
npm run build
npm run lint
npm run lint:tools
npx tsc --noEmit
npm test -- --run
```
