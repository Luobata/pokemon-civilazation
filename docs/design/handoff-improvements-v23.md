# 交接：地块改良升级（候选 gameplay v23）

- 状态：**未开工，等用户确认方向**。2026-11-09 用户要求把它整理成交接文档，换新会话继续。
- 来源：用户 2026-11-07 问“可改良地块是怎么处理的？”。Hub 按代码梳理了现状和与《文明 6》的差距（见下），给出三项最值得补的方向，用户还没选。
- 起点：`main` = 1267143（v22 新局默认）。v22 规格 `docs/design/world-v22.md`。

## 1. 现状（以代码为准）

数据 `src/content/improvements.ts`，规则 `src/core/improvements.ts`，AI `src/ai/improvement-plan.ts`，产出 `src/core/city.ts`（`tileImprovementYield`），界面 `src/browser/unit-panel.ts`、`unit-action-bar.ts`（改良 I 键 / 菜单）、`tile-yields.ts`。

| 改良 | 地形 | 基础 | 科技加成 | 熟练工属性（只在 v≤17 有用） |
| --- | --- | --- | --- | --- |
| 树果田 `berryFarm` | 草原、森林 | 食物 +1 | 树果培育 再 +1 食物 | 草、虫、妖精 |
| 矿坑 `mine` | 山地、荒漠、火山 | 生产 +1 | 碎石工艺 再 +1 生产 | 岩石、地面、格斗、钢 |
| 渔场 `fishery` | 近岸海洋（站相邻陆地施工） | 食物 +1、金币 +1 | 驯化 再 +1 金币 | 水、冰 |
| 观测站 `observatoryCamp` | 雪原、山地、火山 | 科研 +1 | 野外观察 再 +1 科研 | 超能、电、冰 |

- 条件（`improvementBlocker`，权威 / 界面 / AI 共用）：己方领土内（城市工作半径）、不是城市中心、不在设施区、一格一个改良、单位站在格上（渔场相邻即可）、格子当前可见。
- v≤17：任何宝可梦施工，每次行动加工作点（熟练工 2、其他 1，满 3 完成；小刚和方针卡另加点）。
- **v18 起（含 v22）：只有工匠（搬运小匠）能建**，一次行动直接建成，消耗 1 次次数；默认 3 次，用完消失（同《文明 6》）。v22 研究「城市规划」后新训练的工匠 4 次。
- 建成的改良永久存在、看见后对所有人公开、不管哪座城耕作都给产出；施工中的进度只有自己看得见。
- 关联：设施区相邻加成读“已完成矿坑”（`src/content/districts.ts`）；每 2 个自己修的改良 +1 联盟点（`policies.ts` `leaguePointsPerRound`）；开局目标「第一块良田」、图鉴发现（树果培育、碎石工艺）；AI 在“未改良的耕作格多于现有工匠剩余次数”时训练工匠。
- 地图上的资源和改良**无关**：树果丛 / 进化石矿脉是“走上去采集”（`HarvestResource`，有次数和再生），稀有树果是“城市耕作该格即拥有”（`src/core/rare-berries.ts`），领袖、时代能力也没有专属改良。

## 2. 与《文明 6》的差距

1. 种类少，而且不跟资源挂钩（原作多数改良对应资源：种植园、牧场、营地、采石场……）。
2. 不能掠夺，也就没有修复。
3. 不能砍伐 / 清除地貌换一次性产出。
4. 没有道路、领袖专属改良、改良之间的相邻加成。
5. **宝可梦身份断了**：v18 起一次建成，“熟练工属性”不再起作用，改良和宝可梦属性没有任何联系了。

## 3. 建议的方向（Hub 推荐 A + B + C，作为 v23）

### A. 改良与地图资源挂钩
- 资源格上建对应改良才能“开发”资源：例如树果丛 → 树果园（持续产出代替一次性采集）、进化石矿脉 → 石矿（按周期产出进化石）、稀有树果格 → 果园（保留“耕作即拥有”）。
- 可以新增 2–3 种改良，覆盖现在空着的格子（例如草原牧场、森林营地），每种挂一项 v22 科技树上的科技（`src/content/tech-tree.ts` 已有“解锁”表，改良加进去即可）。
- 要决定：采集（`HarvestResource`）在 v23 是保留、改成只对无主资源、还是由改良取代。

### B. 掠夺与修复
- 交战中的敌方单位站在改良上可以掠夺：改良变成“损坏”（不产出），掠夺者得到一次性奖励（按改良类型给食物 / 生产 / 金币 / 科研）。
- 工匠修复：消耗 1 次次数（或不消耗、只花一次行动，按《文明 6》是不消耗次数）。
- AI：交战时掠夺边境改良；有损坏改良时安排修复。
- 要注意：预览 / 权威一致、迷雾（损坏状态是公开地图信息，和改良本身一样“看见后公开”）。

### C. 找回宝可梦身份：随行属性
- 参照 v17 开拓队“随行宝可梦”的做法（`src/content/city-network.ts` `ESCORT_BONUSES`、`economy-panel.ts` `escortSelectMarkup`）：训练工匠时可以选一只随行宝可梦，按属性给工匠一个特长。
- 例如：草/虫/妖精 → 树果田 +1 食物；岩石/地面/格斗/钢 → 矿坑多 1 次不耗次数；水/冰 → 渔场可在 2 格外施工；超能/电 → 观测站 +1 科研；火 → 可清除森林得生产（对应差距 3）。复用现有 `crewTypes`，让表格重新有意义。

### 不建议现在做
- 道路（需要移动规则大改）、改良相邻加成（和设施区相邻重叠）、领袖专属改良（领袖平衡被用户暂缓）。

## 4. 新会话开工前要问用户的
1. A / B / C 全做，还是只做其中几项？
2. 新改良种类和名称（是否新增牧场 / 营地类）——可以先出提案表让用户选。
3. 采集是否保留。
4. 修复是否消耗工匠次数。

## 5. 实施约束（沿用项目惯例）
- 新玩法版本 v23：`src/core/versions.ts`（schema 18 / `rulesVersion` 新名）、`src/core/model.ts` 联合类型、`src/content/eras.ts`（类型、`isGameplayVersion`、`LATEST_GAMEPLAY_VERSION`）、`src/content/units.ts`（新内容表 + 标记 + `STOCK_CONTENTS`）、`tools/district-smoke.ts` / `simulate.ts` / `leader-balance.ts` 范围、`tests/core/district-versions.test.ts`、`tests/tools/district-cli.test.ts`。照 d9f7c8c（v22 脚手架）做。
- **v≤22 逐字节不变**：先在干净 worktree 跑 `node --experimental-strip-types tools/district-smoke.ts 22 <dir>` 做基线，改完 `cmp` 必须 49/49；v23 跑两次 49/49；结局变化 ≤ 20 个百分点；另测 40×26 / 200 轮大地图（11 月评审三目标：第一项科技 ≤ 8、第三城 ≤ 22、中位结束 130–160，v22 已全部达到，不能退化）。
- v22 地图东西环绕：所有距离 / 相邻用 `hexDistance(a, b, map)` / `neighbors(hex, map)`（地图参数必填）。
- 权威与视图分离、迷雾不泄露、浮点不进权威、摆放用 `stableSeed` 不用 `state.rng`。
- 手册（`src/guide/sections.ts` 的 improvements 章节、`systems.ts` 总览行、`tables.ts` 生成表）、审计（`src/audit/catalog.ts` / `inspect.ts`）、规格文档、核心测试、浏览器测试（夹具来自真实 AI 对局；结束回合用 Shift+点击）。
- 门禁：`npm run build && npm run lint && npm run lint:tools && npx vitest run`，再 `npx playwright test`（现 663 / 157）。
