# 测试分层：按改动范围选择检查（test plan）

`npm run check` 只跑本次改动需要的检查，smoke 用 **QUICK 抽样**（每个版本 8 / 48 局，不能作为合并依据）；`npm run check:merge` 同样的选择、smoke 跑满 48 局（合入 main 前必须通过）；`npm run check:full` 是原来的全量门槛（smoke 也是 48 局）。工具：`tools/test-plan.ts`（计划与执行）、`tools/test-plan-map.ts`（人工维护的映射表）、`tools/smoke-parallel.ts`（并行 district smoke + 与基线逐字节比较）、`tools/content-trace.ts`（内容读取追踪，用于证明版本收窄）。

```sh
npm run check:plan                           # 只打印计划：merge-base(main)..HEAD + 工作区
npm run check                                # 计划并执行；smoke = QUICK（8/48 局，not merge-proof）
npm run check:merge                          # 同上，smoke = 每个选中版本 48 局（合入 main 前必须通过）
npm run check:full                           # 全量门槛（配置 / 工具改动、默认值切换）
npm run check:release                        # 全量 + 打印 216 局平衡门槛步骤（发布）
node tools/test-plan.ts --commit <sha>       # 某个提交的计划；--range A..B、--base <ref>、--files a.ts b.css、--json、--merge
node tools/content-trace.ts --list           # 已存的内容读取追踪（按规则形状、版本）
```

| 层级 | smoke 局数 | 何时必须 |
| --- | --- | --- |
| `npm run check`（QUICK） | 选中版本 × 8 局（覆盖 4 个座次轮换 = 全部 7 位 smoke 领袖、4 个种子、3 种性格；smoke 只有 24×16 一种地图） | 开发过程中每次提交前。输出标明 `QUICK — not merge-proof` |
| `npm run check:merge` | 选中版本 × 48 局 | **合入 main 前必须通过**；字节一致的保证只来自这一层 |
| `npm run check:full` | 全部版本 × 48 局 + 全部其它检查 | 计划显示 `FULL GATE`（配置、依赖、测试工具改动）或切换全局默认值时，合入前用它代替 `check:merge` |
| `npm run check:release` | 同 full + 平衡门槛步骤 | 发布、默认玩法版本切换 |

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
| district smoke | 改动落在 `tools/district-smoke.ts`、`src/core/step.ts`、`src/core/game.ts` 的运行时导入闭包内 | 版本见下（`VERSION_SCOPED` 或内容读取追踪可证明收窄）；QUICK 8 局 / merge 48 局；用 `tools/smoke-parallel.ts` 与基线逐字节比较 |
| 平衡 | **从不自动跑**。改了 `tools/balance-run.ts` 闭包内的规则 / AI 文件时，建议 `balance-sweep`（`sweep` 预设 54 局）和相关旋钮 | 216 局门槛只在 `--release` 时打印步骤，手动运行 |

### 为什么 smoke 可以跳过（可证明）

规则代码是“导入纯净”的：eslint `boundaries/pure-imports` 规定 `src/core`、`src/content`、`src/ai` 只能导入这三个目录，且禁用 `Date`、`performance`、`Math.random`，不能读文件。所以对局结果只取决于 smoke 入口的导入闭包（约 150 个文件）。闭包外的改动（UI、样式、文档、多数工具）不可能改变任何版本的对局字节，计划会打印这条理由并跳过 smoke 和平衡。

### smoke 跑哪些版本

- 默认：`tools/district-smoke.ts` 支持的**全部**版本（从它的版本列表读出，新增 v27 时自动包含）。规则文件大多按 `gameplayVersion` 分支，导入图分不出版本，所以除非证明，否则全跑。
- 收窄一：`VERSION_SCOPED` 表里的文件（例如 `regional-dex.ts`、`stone-evolutions.ts`、`roster-v26-data.ts` → gameplay ≥ 25：它们只经 `units.ts` 的 v25/v26 内容构造进入规则，而 `contentFor` 只对 ≥ 25 选择这些内容）。每条记录列出经审阅的导入者；测试检查规则闭包里的实际导入者与之一致，新增导入者会让测试失败，需重新审阅。
- 收窄二：**只改了调参模块里的字面值**（`TRACED_MODULES`：`world24-tuning.ts`、`depth-v26.ts`，v27 合入后的 `pace-v27.ts`）时，用存下的**内容读取追踪**证明哪些版本读不到这些值，只跑读得到的版本（下一节）。证明不成立时（没有追踪、改了代码 / 键 / 数组长度、追踪显示读到了）回到全部版本，计划写明原因。
- `--smoke-versions` 手动收窄仍可用；跳过了证明集合里的版本时计划标注 `NOT PROVEN`。
- 比较：基线默认是 merge-base(main)，用 `git archive` 导出后同样运行，按提交缓存在 `~/.cache/pokemon-civilization/smoke/<sha>/v<N>`（机器上所有分支共用；干净工作区的结果也按 HEAD 缓存；QUICK 抽样另存 `v<N>-c0.5.15…`，完整的基线缓存也能直接用于 QUICK 比较）。`--commit` / `--range` 的计划用 `--head <sha>` 跑那个提交，而不是工作区。比 `LATEST_GAMEPLAY_VERSION` 新的版本（开发中）和 `--allow-diff` 列出的版本只报告差异；其他版本有差异即失败。

### 版本收窄的证明：内容读取追踪

调参值有两条到达规则的路：v24 / v25 / v26 内容对象上的拷贝（`content.world24` / `content.depth26` 和开关），以及 `depth26Tuning(content)`、`lateTuning(content)`、`world24Tuning(content)` 这类访问器——内容上没有这个块时，访问器**返回同一个常量**。所以旧版本只要走到一个没被 v26 开关挡住的调用点，就会读到被修改的值；而多数调用点的开关在调用者里（例如 `raids.ts` 只在 `content.raids` 时被 step 调用），静态检查访问器写法看不出来。

**为什么选运行时追踪，而不是静态检查**：静态检查只能确认“调用点所在函数里有开关”，跨函数的开关、回退到常量、加载时拷贝它都证明不了，能证明的调用点很少，还容易漏；运行时追踪直接记录 smoke 实际执行时读了哪些值，只要追踪的是**同一份代码上的同 48 局**，结论就是精确的。缩短的对局（几十轮）不行：raid 在第 90 轮才开始，短局读不到不代表 100 轮读不到。所以追踪就在 smoke 本身里做：

1. **记录**（`tools/content-trace.ts`）：每个 smoke worker 先加载被追踪模块，把导出对象 / 数组里每个基本类型的叶子原地换成 getter（键顺序、可枚举性、值都不变），读一次就记下规范键（`depth-v26#DEPTH26_TUNING.late.raidFirstRound`；别名如 `DEPTH26_TUNING.late === LATE_GAME_TUNING` 只有一个名字）。接着加载 `src/content/units.ts`，把它在加载时做的拷贝（各 stock 内容的 `world24` / `depth26` / `pace27` 块和开关）按所拷贝的名字同样插桩，然后才加载其余规则。直接读、经访问器回退读、`JSON.stringify`、展开、解构都要经过 getter。结果写在 smoke 结果旁（`trace-c<首局>.txt`，不是 `*.json`，不参与字节比较），跑完后按版本合并存进 `~/.cache/pokemon-civilization/trace/<规则形状>/v<N>/`。
2. **规则形状**（`tools/test-plan.ts` `ruleShape`）：smoke 入口的运行时导入闭包里每个文件的内容哈希，其中被追踪模块先把“导出 const 对象 / 数组字面量里的数字、字符串、布尔字面值”换成占位符并去掉注释和格式（`normalizeTraced`），再加上 node 版本、smoke 配置、追踪格式版本。形状相同 = smoke 执行的代码除这些调参值外完全相同。
3. **证明**（`provenUnobservable`）：基线和改动后形状相同（只改了值），对某个版本存在一份同形状、覆盖要跑的全部局（merge 48 局 / QUICK 8 局）的追踪，且它读到的键、加载时由其它文件读到的键（视为所有版本都读到）、无法插桩的路径都不包含“在追踪树、基线、改动后三者之间值不同”的键——那么这三棵树上该版本的每一步执行都相同（读到的值全都相同），smoke 字节必然一致，跳过。缺任一条件就跑。
4. **前提**（`traceSafety`，计划和测试都检查）：被追踪模块加载时只声明东西，不读自己或其它被追踪模块的对象（`checkTracedModule`）；它们导入的模块不导入被追踪模块（否则可能在插桩前被读到）；`units.ts` 里拷贝调参值的代码行与 `INIT_COPY_SITES`（`tools/test-plan-map.ts`）逐行一致——新增或改动拷贝（例如 v27 的 `pace27` 叠加层）要先审阅再更新这张表，否则计划不收窄、测试失败。
5. **数据从哪来**：任何带追踪的 smoke（`check`、`check:merge`、基线运行）都会存下它所跑的树的追踪，所以合入一个规则改动时跑的 `check:merge` 顺带就给新的 main 形状存了数据。新形状还没有数据时，计划回到全部版本并说明 `no stored trace`；想先补数据可以只跑一次带追踪的 smoke：`node tools/smoke-parallel.ts --head <基线 sha> --no-base --versions all`（与一次完整 smoke 同价，约 1 小时）。
6. **数据不会过期**：追踪按规则形状存取，代码一变形状就变，旧数据自然不再被使用。`tests/tools/test-plan.test.ts` 在已知提交 677b1af 上重新生成三局追踪（v23 / v24 / v26 各 30 轮）并与 `tests/tools/fixtures/content-trace-677b1af.json` 比较，追踪器本身的行为一变就失败；另有对形状归一化、前提检查、证明逻辑和 d9b778f 端到端选择的测试。

目前数据显示的结构：v9–v23 不读任何被追踪值；v24 / v25 只读 `world24`（经各自内容上的拷贝）；v26 读 `depth26` 的全部键（每局用 `depthOverlay` 复制整块）。所以 `depth-v26.ts` 的调参只跑 v26（v27 合入后加 v27，如它继承这些值），`world24-tuning.ts` 的调参跑 v24 起。

**不能收窄的情况**：改了被追踪模块的代码、键、数组长度或基本类型的导出（`GYM_LATE_BADGES_FROM` 这类导出的值不能插桩，算形状）；同时改了任何其它规则文件；`--files` 计划（没有基线）；规则形状还没有追踪；AI、core、其它内容文件（不是调参模块，只能按导入图全跑）。

### Playwright 选哪些 spec

1. **导入图**：spec 直接或间接导入了改动文件（很多 spec 从 `src` 导入夹具和规则）。
2. **映射表** `SPEC_RULES`（`tools/test-plan-map.ts`）：源码 glob → spec glob，例如 `src/browser/render/**` → `map*`、`selection`、`combat-presentation`、`waypoints`、`performance` 等；`src/*.css` → 视觉 / 浮层 spec（另触发生产构建 e2e）；`src/guide/**` → `guide`、`civ-glossary`；各面板 → 各自的 spec；规则里在页面显示数字的模块（经济、战斗、科技、领袖、世界系统、兵种）→ 断言这些数字的 spec。`src/browser/main.ts`、`screens.ts`、`src/app/**`、`index.html` 是页面总装，映射到**全部** spec。
3. **常跑三件套** `ALWAYS_SPECS`：`entrypoints`（所有入口页加载）、`shell`（开局与各屏幕）、`turn-and-rail`（结束回合）。只要有任何 spec 要跑、或改了客户端 / 规则代码就带上。

没有映射的客户端文件（`src/browser`、`src/app`、`src/guide`、css、html、`public/`）会跑**全部** spec，计划里提示“add one”。

### 安全阀

- `package.json`、lockfile、`tsconfig*.json`、`eslint.config.js`、`vite.config.ts`、`playwright*.config.ts`、`tools/test-plan*.ts`、`tools/smoke-parallel.ts`、`tools/content-trace.ts` 改动 → 全量门槛。
- 不认识的路径（不在 `src/ server/ tools/ tests/ public/`、根目录脚本 / html、文档之外）→ 更宽的一层：全部 vitest、tsc、eslint、vite build 和常跑三件套；不会是“什么都不跑”。（smoke 仍可跳过：规则不能读到导入图之外的文件。）
- 只改文档（`docs/**`、`*.md`，但 `public/` 里被页面读取的不算）→ 不跑任何检查（项目没有配置 markdown 检查）。被代码读取的文档目录文件按数据处理。
- `--full` 强制全量。

## 扩展映射

- **新增 spec**：在 `SPEC_RULES` 里把它加到相关条目（或新增条目）。`tests/tools/test-plan.test.ts` 检查每个 spec 都能由某条非“全部”映射或常跑集合选中，否则失败。
- **新增客户端模块**：在 `SPEC_RULES` 加一条 `files → specs`；否则它的改动会跑全部 spec。
- **新的按版本数据文件**：整份文件只经 `contentFor` 的 ≥ N 分支进入规则的，加入 `VERSION_SCOPED`，写清 `importers` 和理由。
- **新的调参模块**（导出调参对象、旧版本经访问器回退到常量的，如 `pace-v27.ts`）：加入 `TRACED_MODULES`（`blocks` 写内容上的块名 → 导出名，`flags` 写开关导出名）；它必须满足 `checkTracedModule`。`units.ts` 若新增拷贝（如 `pace27: JSON.parse(JSON.stringify(PACE27_TUNING))`），确认拷贝进的是同名块、目标是 stock 内容或由它展开得到，再把这些行加入 `INIT_COPY_SITES`。`pace-v27.ts` 已预先列入，v27 合入时只需审阅拷贝行。
- **用 fs 读源码文本的测试**：加入 `VITEST_TEXT_DEPENDENCIES`。
- 测试同时检查表里每个 glob 都匹配现有文件、`VITEST_INCLUDE` 与 `vite.config.ts` 一致、`smoke-parallel` 与 `district-smoke.ts` 的配置一致。
- 改映射表本身属于“改了 test-plan 工具”，计划走全量。

## 什么时候必须跑哪一层

- `npm run check`：开发中每次提交前。smoke 是 QUICK 抽样（每版本 8 局），输出标 `QUICK — not merge-proof`，计划末尾给出 `check:merge` 要跑的版本和耗时。
- `npm run check:merge`：**合入 main 之前必须通过**。与 `check` 选同样的检查和版本，smoke 每个版本跑满 48 局并与基线逐字节比较；字节一致的保证只来自这一层（或 full / release）。
- `npm run check:full`：计划显示 `FULL GATE` 时（改了配置 / 依赖 / 测试工具）合入前用它代替 `check:merge`；切换默认玩法版本（`LATEST_GAMEPLAY_VERSION`）或默认渲染 / 主题等全局默认值时。
- `npm run check:release`：发布。全量之外按打印的步骤手动跑 216 局平衡门槛（`node tools/balance-run.ts --preset gate …` + `balance-report`），默认玩法版本切换时同样需要。
- 规则 / AI 改动：`check` 会跑所需版本的 QUICK smoke，并建议 54 局 `balance-sweep`；结论只看门槛档。

## 耗时（共享 64 核机器，负载约 90 时）

- vitest 全量：122 个文件，16 个 worker 墙钟约 122 s（单文件耗时合计 715 s）。
- 一局 smoke（24×16 / 100 轮）30–110 s；一个版本 48 局；16 个 worker 下一个版本（含基线）约 6 分钟，全部 18 个版本约 2 小时（基线命中缓存时减半）。
- 2026-11-20 实测（负载约 100）：带追踪的全部 18 个版本 × 48 局只跑 head（补追踪数据）32 分钟（平均 35 s/局，旧版本更快）；d9b778f 的 merge 层 smoke（v26 × 48 局，基线已缓存）5 分钟，QUICK（v26 × 8 局）约 1.5 分钟；整个 merge 计划（tsc、114 个 vitest 文件、52 个 spec、smoke）15 分钟，QUICK 计划不含 Playwright 时 3 分钟。追踪本身不改变结果：带追踪的 v26 与 6ac8e59 不带追踪的缓存 49/49 文件逐字节一致。
- QUICK smoke 用 1 局一个任务（延迟低），大批量用 4 局一个任务（`smokeChunk`）。
- Playwright 默认 4 个 worker（原来默认 32 个，在共享机器上会超时）：`--pw-workers N` 调整。

计划末尾的 `estimate` 行用 `COST`（`tools/test-plan-map.ts`）粗估，只用于比较量级。
