# 测试分层：按改动范围选择检查（test plan）

`npm run check` 只跑本次改动需要的检查，smoke 用 **QUICK 抽样**（v27 的 8 / 48 局，不能作为合并依据）；`npm run check:merge` 同样的选择、smoke 跑满 48 局（合入 main 前必须通过）；`npm run check:full` 是全量门槛（smoke 也是 48 局）。工具：`tools/test-plan.ts`（计划与执行）、`tools/test-plan-map.ts`（人工维护的映射表）、`tools/smoke-parallel.ts`（并行 district smoke + 与基线逐字节比较）。

```sh
npm run check:plan                           # 只打印计划：merge-base(main)..HEAD + 工作区
npm run check                                # 计划并执行；smoke = QUICK（8/48 局，not merge-proof）
npm run check:merge                          # 同上，smoke = 48 局（合入 main 前必须通过）
npm run check:full                           # 全量门槛（配置 / 工具改动、默认值切换）
npm run check:release                        # 全量 + 打印 216 局平衡门槛步骤（发布）
node tools/test-plan.ts --commit <sha>       # 某个提交的计划；--range A..B、--base <ref>、--files a.ts b.css、--json、--merge
```

| 层级 | smoke 局数 | 何时必须 |
| --- | --- | --- |
| `npm run check`（QUICK） | v27 × 8 局（覆盖 4 个座次轮换 = 全部 7 位 smoke 领袖、4 个种子、3 种性格；smoke 只有 24×16 一种地图） | 开发过程中每次提交前。输出标明 `QUICK — not merge-proof` |
| `npm run check:merge` | v27 × 48 局 | **合入 main 前必须通过**；字节一致的保证只来自这一层 |
| `npm run check:full` | v27 × 48 局 + 全部其它检查 | 计划显示 `FULL GATE`（配置、依赖、测试工具改动）或切换全局默认值时，合入前用它代替 `check:merge` |
| `npm run check:release` | 同 full + 平衡门槛步骤 | 发布 |

## 怎么决定（每层的依据）

计划尽量来自**导入图**（`typescript` 解析全部 `src/ server/ tools/ tests/` 与 html/css）：静态 `import` / `export from`、动态 `import()`、`vi.mock`、`new URL('…', import.meta.url)` 读的数据文件（模板字符串按目录前缀）、html 的 `<script src>` / `<link href>`、css 的 `@import`。`import type` / `export type` 在运行时被擦除，不算边；测试里写成字符串、在页面中 `import()` 的仓库路径（`'/src/browser/main.ts'`）只对浏览器 spec 算一层。导入图不能表达的部分才查映射表。

| 层 | 何时运行 | 选择方法 |
| --- | --- | --- |
| tsc（两个 tsconfig） | 改了任何脚本或 JSON | 全量（快，跨文件类型错误只能全量查） |
| eslint | 改了 `.ts/.js` | 只查改动的文件（规则都是单文件规则） |
| vite build | 改动落在五个 html 入口的导入闭包内（含 core，客户端会打包它）或 `public/` | — |
| vitest | 有测试的导入闭包包含改动文件 | 导入图 + `VITEST_TEXT_DEPENDENCIES`（用 fs 读源码文本的测试，如 civ-glossary.test 扫 `src/browser/*.ts`） |
| Playwright | 见下 | 导入图 ∪ `SPEC_RULES` 映射 ∪ 常跑三件套 |
| 生产构建 e2e | 改了 CSS、html、`PROD_TRIGGERS`（面板 / 浮层布局文件）或 `tests/browser-prod` 及其夹具 | — |
| district smoke | 改动落在 `tools/district-smoke.ts`、`src/core/step.ts`、`src/core/game.ts` 的运行时导入闭包内 | 单一 v27 基线；QUICK 8 局 / merge 48 局；用 `tools/smoke-parallel.ts` 与基线逐字节比较 |
| 平衡 | **从不自动跑**。改了 `tools/balance-run.ts` 闭包内的规则 / AI 文件时，建议 `balance-sweep`（`sweep` 预设 54 局）和相关旋钮 | 216 局门槛只在 `--release` 时打印步骤，手动运行 |

### 为什么 smoke 可以跳过（可证明）

规则代码是“导入纯净”的：eslint `boundaries/pure-imports` 规定 `src/core`、`src/content`、`src/ai` 只能导入这三个目录，且禁用 `Date`、`performance`、`Math.random`，不能读文件。所以对局结果只取决于 smoke 入口的导入闭包。闭包外的改动（UI、样式、文档、多数工具）不可能改变对局字节，计划会打印这条理由并跳过 smoke 和平衡。

### smoke 基线比较

- 当前引擎收敛为单一规则基线 `v27`（历史版本存档在 git tag `archive/v0-v27-legacy`）。
- 基线默认是 merge-base(main)，用 `git archive` 导出后同样运行，按提交缓存在 `~/.cache/pokemon-civilization/smoke/<sha>/v27`（机器上所有分支共用；干净工作区的结果也按 HEAD 缓存；QUICK 抽样另存 `v27-c0.5.15…`，完整的基线缓存也能直接用于 QUICK 比较）。`--commit` / `--range` 的计划用 `--head <sha>` 跑那个提交，而不是工作区。

### Playwright 选哪些 spec

1. **导入图**：spec 直接或间接导入了改动文件（很多 spec 从 `src` 导入夹具和规则）。
2. **映射表** `SPEC_RULES`（`tools/test-plan-map.ts`）：源码 glob → spec glob，例如 `src/browser/render/**` → `map*`、`selection`、`combat-presentation`、`waypoints`、`performance` 等；`src/*.css` → 视觉 / 浮层 spec（另触发生产构建 e2e）；`src/guide/**` → `guide`、`civ-glossary`；各面板 → 各自的 spec；规则里在页面显示数字的模块（经济、战斗、科技、领袖、世界系统、兵种）→ 断言这些数字的 spec。`src/browser/main.ts`、`screens.ts`、`src/app/**`、`index.html` 是页面总装，映射到**全部** spec。
3. **常跑三件套** `ALWAYS_SPECS`：`entrypoints`（所有入口页加载）、`shell`（开局与各屏幕）、`turn-and-rail`（结束回合）。只要有任何 spec 要跑、或改了客户端 / 规则代码就带上。

没有映射的客户端文件（`src/browser`、`src/app`、`src/guide`、css、html、`public/`）会跑**全部** spec，计划里提示“add one”。

### 安全阀

- `package.json`、lockfile、`tsconfig*.json`、`eslint.config.js`、`vite.config.ts`、`playwright*.config.ts`、`tools/test-plan*.ts`、`tools/smoke-parallel.ts` 改动 → 全量门槛。
- 不认识的路径（不在 `src/ server/ tools/ tests/ public/`、根目录脚本 / html、文档之外）→ 更宽的一层：全部 vitest、tsc、eslint、vite build 和常跑三件套；不会是“什么都不跑”。
- 只改文档（`docs/**`、`*.md`，但 `public/` 里被页面读取的不算）→ 不跑任何检查。
- `--full` 强制全量。

## 扩展映射

- **新增 spec**：在 `SPEC_RULES` 里把它加到相关条目（或新增条目）。`tests/tools/test-plan.test.ts` 检查每个 spec 都能由某条非“全部”映射或常跑集合选中，否则失败。
- **新增客户端模块**：在 `SPEC_RULES` 加一条 `files → specs`；否则它的改动会跑全部 spec。
- **用 fs 读源码文本的测试**：加入 `VITEST_TEXT_DEPENDENCIES`。
- 测试同时检查表里每个 glob 都匹配现有文件、`VITEST_INCLUDE` 与 `vite.config.ts` 一致、`smoke-parallel` 与 `district-smoke.ts` 的配置一致。
- 改映射表本身属于“改了 test-plan 工具”，计划走全量。

## 什么时候必须跑哪一层

- `npm run check`：开发中每次提交前。smoke 是 QUICK 抽样（8 局），输出标 `QUICK — not merge-proof`。
- `npm run check:merge`：**合入 main 之前必须通过**。与 `check` 选同样的检查，smoke 跑满 48 局并与基线逐字节比较；字节一致的保证只来自这一层（或 full / release）。
- `npm run check:full`：计划显示 `FULL GATE` 时（改了配置 / 依赖 / 测试工具）合入前用它代替 `check:merge`；切换默认渲染 / 主题等全局默认值时同样需要。
- `npm run check:release`：发布。全量之外按打印的步骤手动跑 216 局平衡门槛（`node tools/balance-run.ts --preset gate …` + `balance-report`）。
- 规则 / AI 改动：`check` 会跑 QUICK smoke，并建议 54 局 `balance-sweep`；结论只看门槛档。

## 耗时参考

- QUICK smoke 用 1 局一个任务（延迟低），大批量用 4 局一个任务（`smokeChunk`）。
- Playwright 默认 4 个 worker（在共享机器上控制并发）：`--pw-workers N` 调整。
- 计划末尾的 `estimate` 行用 `COST`（`tools/test-plan-map.ts`）粗估，只用于比较量级。
