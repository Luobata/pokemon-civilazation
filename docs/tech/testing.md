# 测试分层：按改动范围选择检查（test plan）

`npm run check` 只跑本次改动需要的检查；`npm run check:full` 是原来的全量门槛。工具：`tools/test-plan.ts`（计划与执行）、`tools/test-plan-map.ts`（人工维护的映射表）、`tools/smoke-parallel.ts`（并行 district smoke + 与基线逐字节比较）。

```sh
npm run check:plan                           # 只打印计划：merge-base(main)..HEAD + 工作区
npm run check                                # 计划并执行
npm run check:full                           # 全量门槛（合入 main 前）
npm run check:release                        # 全量 + 打印 216 局平衡门槛步骤（发布）
node tools/test-plan.ts --commit <sha>       # 某个提交的计划；--range A..B、--base <ref>、--files a.ts b.css、--json
```

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
| district smoke | 改动落在 `tools/district-smoke.ts`、`src/core/step.ts`、`src/core/game.ts` 的运行时导入闭包内 | 版本见下；用 `tools/smoke-parallel.ts` 与基线逐字节比较 |
| 平衡 | **从不自动跑**。改了 `tools/balance-run.ts` 闭包内的规则 / AI 文件时，建议 `balance-sweep`（`sweep` 预设 54 局）和相关旋钮 | 216 局门槛只在 `--release` 时打印步骤，手动运行 |

### 为什么 smoke 可以跳过（可证明）

规则代码是“导入纯净”的：eslint `boundaries/pure-imports` 规定 `src/core`、`src/content`、`src/ai` 只能导入这三个目录，且禁用 `Date`、`performance`、`Math.random`，不能读文件。所以对局结果只取决于 smoke 入口的导入闭包（约 150 个文件）。闭包外的改动（UI、样式、文档、多数工具）不可能改变任何版本的对局字节，计划会打印这条理由并跳过 smoke 和平衡。

### smoke 跑哪些版本

- 默认：`tools/district-smoke.ts` 支持的**全部**版本（从它的版本列表读出，新增 v27 时自动包含）。规则文件大多按 `gameplayVersion` 分支，导入图分不出版本，所以除非证明，否则全跑。
- 收窄：只有 `VERSION_SCOPED` 表里的文件可以收窄（例如 `regional-dex.ts`、`stone-evolutions.ts`、`roster-v26-data.ts` → gameplay ≥ 25：它们只经 `units.ts` 的 v25/v26 内容构造进入规则，而 `contentFor` 只对 ≥ 25 选择这些内容）。每条记录列出经审阅的导入者；测试检查规则闭包里的实际导入者与之一致，新增导入者会让测试失败，需重新审阅。
- `depth-v26.ts` 这类按版本命名但**未证明**的文件仍跑全部版本（它的 `depth26Tuning(content)` 在旧内容上回退到默认值，31 个调用点是否都被 v26 开关挡住需要逐个审阅）。计划会提示 `--smoke-versions 26-26` 这个**未证明**的捷径；用了之后计划标注 `NOT PROVEN`。
- 比较：基线默认是 merge-base(main)，用 `git archive` 导出后同样运行，按提交缓存在 `~/.cache/pokemon-civilization/smoke/<sha>/v<N>`（机器上所有分支共用；干净工作区的结果也按 HEAD 缓存）。比 `LATEST_GAMEPLAY_VERSION` 新的版本（开发中）和 `--allow-diff` 列出的版本只报告差异；其他版本有差异即失败。

### Playwright 选哪些 spec

1. **导入图**：spec 直接或间接导入了改动文件（很多 spec 从 `src` 导入夹具和规则）。
2. **映射表** `SPEC_RULES`（`tools/test-plan-map.ts`）：源码 glob → spec glob，例如 `src/browser/render/**` → `map*`、`selection`、`combat-presentation`、`waypoints`、`performance` 等；`src/*.css` → 视觉 / 浮层 spec（另触发生产构建 e2e）；`src/guide/**` → `guide`、`civ-glossary`；各面板 → 各自的 spec；规则里在页面显示数字的模块（经济、战斗、科技、领袖、世界系统、兵种）→ 断言这些数字的 spec。`src/browser/main.ts`、`screens.ts`、`src/app/**`、`index.html` 是页面总装，映射到**全部** spec。
3. **常跑三件套** `ALWAYS_SPECS`：`entrypoints`（所有入口页加载）、`shell`（开局与各屏幕）、`turn-and-rail`（结束回合）。只要有任何 spec 要跑、或改了客户端 / 规则代码就带上。

没有映射的客户端文件（`src/browser`、`src/app`、`src/guide`、css、html、`public/`）会跑**全部** spec，计划里提示“add one”。

### 安全阀

- `package.json`、lockfile、`tsconfig*.json`、`eslint.config.js`、`vite.config.ts`、`playwright*.config.ts`、`tools/test-plan*.ts`、`tools/smoke-parallel.ts` 改动 → 全量门槛。
- 不认识的路径（不在 `src/ server/ tools/ tests/ public/`、根目录脚本 / html、文档之外）→ 更宽的一层：全部 vitest、tsc、eslint、vite build 和常跑三件套；不会是“什么都不跑”。（smoke 仍可跳过：规则不能读到导入图之外的文件。）
- 只改文档（`docs/**`、`*.md`，但 `public/` 里被页面读取的不算）→ 不跑任何检查（项目没有配置 markdown 检查）。被代码读取的文档目录文件按数据处理。
- `--full` 强制全量。

## 扩展映射

- **新增 spec**：在 `SPEC_RULES` 里把它加到相关条目（或新增条目）。`tests/tools/test-plan.test.ts` 检查每个 spec 都能由某条非“全部”映射或常跑集合选中，否则失败。
- **新增客户端模块**：在 `SPEC_RULES` 加一条 `files → specs`；否则它的改动会跑全部 spec。
- **新的按版本数据文件**（如 v27 的 `pace-v27.ts`）：确认规则只经 `contentFor` 的 ≥ N 分支（或只在 v ≥ N 才开启的开关下）读取后，加入 `VERSION_SCOPED`，写清 `importers` 和理由。
- **用 fs 读源码文本的测试**：加入 `VITEST_TEXT_DEPENDENCIES`。
- 测试同时检查表里每个 glob 都匹配现有文件、`VITEST_INCLUDE` 与 `vite.config.ts` 一致、`smoke-parallel` 与 `district-smoke.ts` 的配置一致。
- 改映射表本身属于“改了 test-plan 工具”，计划走全量。

## 什么时候必须跑全量 / 发布门槛

- `npm run check:full`：合入 main 之前；改了配置 / 依赖 / 测试工具（计划会自动升级为全量）；切换默认玩法版本（`LATEST_GAMEPLAY_VERSION`）或默认渲染 / 主题等全局默认值。
- `npm run check:release`：发布。全量之外按打印的步骤手动跑 216 局平衡门槛（`node tools/balance-run.ts --preset gate …` + `balance-report`），默认玩法版本切换时同样需要。
- 规则 / AI 改动：`check` 会跑所需版本的 smoke，并建议 54 局 `balance-sweep`；结论只看门槛档。

## 耗时（共享 64 核机器，负载约 90 时）

- vitest 全量：122 个文件，16 个 worker 墙钟约 122 s（单文件耗时合计 715 s）。
- 一局 smoke（24×16 / 100 轮）30–110 s；一个版本 48 局；16 个 worker 下一个版本（含基线）约 6 分钟，全部 18 个版本约 2 小时（基线命中缓存时减半）。
- Playwright 默认 4 个 worker（原来默认 32 个，在共享机器上会超时）：`--pw-workers N` 调整。

计划末尾的 `estimate` 行用 `COST`（`tools/test-plan-map.ts`）粗估，只用于比较量级。
