# 交接：战斗表现（11 月评审推进顺序第 3 步）

- 状态：**未开工**。原计划在 UI P0 之后做，被用户 2026-11-07 的新要求（v22：地图环绕、科技树、时代献礼）插队；v22 已完成（1267143）。2026-11-09 用户要求整理成交接文档，换新会话继续。
- 依据：`docs/design/review-2026-11/3-audio-visual.md`（完整评审，编号 V1–V16、A1–A8 都出自那里）。本文件只写**要做的范围、今天核对过的现状、v22 带来的新约束和验收方式**。
- 起点：`main` = 1267143。这一步**只改表现层，不改规则**，不需要新的玩法版本。
- 和「地块改良 v23」（`docs/design/handoff-improvements-v23.md`）是两件独立的事，用户还没定先做哪个；新会话开头先问。

## 1. 范围

评审第 6 节的第一、二批，即 11 月评审 README 里写的“描边伤害数字、地图血条、命中震屏、属性颜色弹道与命中、击倒动画、攻城换旗、按属性的攻击音效”。

| 批次 | 编号 | 内容 | 成本 |
| --- | --- | --- | --- |
| 1 | V1 | 伤害数字深色描边、放大、弹出后上浮淡出；**反击数字画在攻击方**（现在画在目标格） | S |
| 1 | V2 | 单位血条（HP 未满时显示；`SceneUnit` 加 hp / maxHp；只对看得见的单位） | S |
| 1 | V4 | 命中震屏：整帧平移（`blit` 和直接绘制共用偏移），**不改相机**，否则缓存失效 | S |
| 1 | V7 | 屏幕外、非己方的事件不占播放时间（只出声音 / 通知），或可选“跟随战斗”运镜 | S |
| 1 | A1 | 补缺失音效：占城、失城、换时代、胜利 / 失败、天气、形态变化、商路、奇观被抢、警报、结束回合；修 `UnitPromoted` 不判断归属 | S |
| 2 | V3 | 战斗轨道重做：攻击方前冲 → 远程属性色弹道 → 命中属性色粒子 + 白闪 → 数字；效果拔群 / 不佳提示 | M |
| 2 | V5 | 击倒动画：残影下沉、变灰、淡出，挂“休养”标签 | S–M |
| 2 | V6 | 占城：约 900 ms，旧横幅撕下、新阵营颜色沿领土扫过；配占城 / 失城音效 | M |
| 2 | A2 | 按属性的攻击音效（18 属性归约 6 个声音家族），效果拔群叠上行琶音 | M |

第三批（V8–V11、A3、A5：大事件地图脉冲、时代形态特效、奇观揭幕运镜、昼夜过渡、战争音乐分层、开局 / 结局音乐）留到之后；V12–V16、A4、A6–A8 更晚，先确认帧预算。

## 2. 今天核对过的现状（2026-11-09，main = 1267143）

- `src/browser/render/animation.ts`：`battleTrack(key, position, damage, counterDamage)` 仍只有目标格一个位置；`moveTrack` 已在 v22 用 `nearestCopy` 跨接缝。
- `src/browser/render/canvas2d.ts` `drawEffects`（约第 576 行）：反击 `反击 −N` 仍画在目标格；没有描边。
- `src/browser/render/scene.ts`：只有城市有 `hp`，单位没有。
- `src/core/model.ts` `KnockdownRecord` 已有 `effectiveness`（可直接用于效果拔群提示）；`BattleResolved` 事件没有攻击属性字段。
- `src/browser/audio/`：`sfx.ts` 约 180 行、19 个音效；`index.ts` 有音乐 / 音效总线和 ducking。

## 3. v22 之后的新约束

- **地图东西环绕**：`canvas2d` 会按 `copyShifts(scene, camera, …)` 画出所有可见的地图副本。所有新特效（弹道、粒子、数字、血条、占城扫色）都必须在每个可见副本上画，或者锚定在离视口中心最近的副本（`nearestCopy`，战斗浮卡已这样做）。弹道从攻击方到目标要走跨接缝的短路径。
- **v20 战斗力**：伤害来自双方战斗力差值，预览（`src/core/preview.ts` / `strength.ts`）里有完整加成列表；浮动战斗卡在 `src/browser/combat-preview.ts`。表现层不要重算伤害，只读事件。
- **事件字段**：V3 需要攻击属性。优先在浏览器里从视图推出（攻击方物种 → 属性，`view.units` / `knownUnitLabels`）；如果必须给 `BattleResolved` 加字段，注意事件会进入回放校验和冒烟输出——要么只在新玩法版本里加，要么先跑 `tools/district-smoke.ts 22` 前后 `cmp` 证明不变。
- UI P0 之后的界面：右下角单位操作栏、右侧通知栏、左上开局目标卡、目标旁的浮动战斗卡；新的屏幕特效不要盖住这些控件的可点区域（`tests/browser/interaction-review.spec.ts`、`screen-scroll.spec.ts` 是现成的检查方式）。
- 关掉“移动动画”或 `prefers-reduced-motion` 时不加新的持续动画（`tapTrack` 已这样处理）；关掉动画时事件仍要立即结算。

## 4. 性能（来自评审第 5 节）

- 基准：105 个可见单位直接绘制 p95 2.9 ms（M2 Pro，DPR 2）。目标：叠加战斗特效后 p95 ≤ 4 ms。
- 不用 `shadowBlur` / 大面积 `filter`；粒子用对象池和 `fillRect`，全图上限约 150–200；战斗整体 ≤ 900 ms。
- 在 `tests/browser/performance.spec.ts` 的 dense 场景加一组“带战斗特效的帧”。v22 环绕会多画副本，要在环绕地图上测。

## 5. 验收

- 每项一个浏览器测试（真实输入或真实 AI 对局夹具；读档会做权威重放，不能手改状态；结束回合用 Shift+点击）：数字有描边且反击在攻击方、受伤单位有血条、震屏不改相机且缓存命中、屏幕外 AI 战斗不阻塞、击倒残影、占城动画、属性音效被调用（音频可用 spy 检查 `audio.play` 参数）。
- 截图人工看一遍（评审时的做法：用真实渲染器在单位格上画出特效）。
- 因为不改规则：`tools/district-smoke.ts 22` 前后应 49/49 一致（顺手确认没有误改权威代码）。
- 门禁：`npm run build && npm run lint && npm run lint:tools && npx vitest run`，再 `npx playwright test`（现 663 / 157）。

## 6. 建议做法

- 第一批改动集中在 `canvas2d.ts` / `scene.ts` / `animation.ts` / `sfx.ts` / `main.ts`，一个人做比并行快（文件重叠多）。
- 第二批可以拆成两支并行：画面（V3 / V5 / V6，`render/`）和声音（A2，`audio/`），合并时只在 `main.ts` 的 `presentationTrack` / `soundFor` 交汇。
