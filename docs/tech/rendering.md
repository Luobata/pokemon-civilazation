# 地图渲染架构

2026-11-04 起，地图渲染拆成三部分，位于 `src/browser/render/`：

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `scene.ts` | `buildScene(input)`：根据 PlayerView 和界面状态（选中、行动模式、设施区选址、图层开关）决定**画什么**。输出世界坐标下的实体列表，单位带稳定的 `key`（`unit:12`）。 | 只依赖 content/core 和 `camera.ts` 的六角格数学，不碰 DOM，可以在 Node 里测试 |
| `animation.ts` | `Timeline` 与轨道（Track）：把权威事件变成一段时间内的视觉覆盖（单位走到半路的位置、伤害数字等）。 | 纯函数，Node 可测 |
| `canvas2d.ts` | Canvas 2D 后端：按固定图层顺序把场景和动画帧画出来，并缓存很少变化的图层。 | DOM / Canvas |
| `index.ts` | `createMapRenderer(canvas)`：每块画布一个渲染器（缓存归它所有），`render({ view, camera, animation, ... })`。 | |

游戏规则（`src/core`）从不接触画布；渲染器只读取玩家有权知道的 PlayerView。

## 一帧的流程

```
主循环 frame(now)
  timeline.advance(now)                 结束到时的轨道（回调里写“结果提示”）
  队列空闲时取下一个事件 → presentationTrack(event) → timeline.add
  animation = timeline.sample(now, { unitPosition })
  renderer.render({ view, camera, animation, selected, ... })
     buildScene(input)                   决定画什么（纯）
     canvas2d.render(scene, camera, animation)
```

事件按顺序播放（上一个结束，下一个才开始）：移动每格 180 ms，捕捉 600 ms，进化 450 ms，战斗 600–900 ms（见下文“战斗表现”）。别人的行动如果完全在视口外，不加轨道、不占播放时间，只更新通知、日志和提示；自己的行动总是播放。`Timeline` 本身支持多条轨道同时播放，顺序播放只是主循环的选择。

## 战斗表现（2026-11，`docs/design/handoff-combat-presentation.md`）

- `battleTrack(spec)` 用一条轨道画完一场战斗，全程不超过 900 ms（`BATTLE_MAX_MS`）。0–150 ms 攻击方前冲（近战 0.3 格、远程 0.12 格，写进 `frame.poses`）；远程在 100–270 ms 发出属性色弹道（`projectile`，世界坐标，用 `nearestCopy` 走接缝的短路）；命中时间是近战 150 ms、远程 270 ms：白闪、属性色圆环和粒子（`impact`），伤害数字和效果拔群 / 效果不佳 / 没有效果（`number`）；反击在命中后 180 ms 落到攻击方；被击倒的单位用 `poses` 的 `alpha` / `grey` 画成残影，下沉、变灰、淡出（450 ms），挂“休养”（文明的宝可梦）或“击倒”；占城时旧阵营横幅撕下落下（`banner`），新阵营颜色按离城距离一圈圈扫过领土（`sweep`）。
- 这些外观只从事件和 PlayerView 推出（`src/browser/battle-presentation.ts`：攻击方物种 → 属性，距离 → 远程，属性相克，谁被击倒，占城前的城主），不改事件，也不重算伤害。有击倒记录时，推出的相克倍率和权威记录一致（浏览器测试会比对）。
- 数字用深色描边（`strokeText`，不用 `shadowBlur`），弹出、上浮、淡出；单位 HP 未满时在底部画 3 px 血条（`SceneUnit.hp`，只有看得见的单位）。
- 震屏是 `AnimationFrame.shake`（CSS 像素，2–6 px，200 ms 衰减）。渲染器把它取整成设备像素，`blit` 和直接绘制共用同一个平移；相机和缓存键都不变，所以震屏帧照样命中 `base` / `fog` 缓存。夜晚每帧只压暗一次（以前每个地图副本各压一次），并多画 8 px 边距，盖住震屏露出的边。
- 粒子用一张固定的 14 方向表，用 `fillRect` 画方块；所有地图副本合计每帧最多 `PARTICLE_CAP`（180）个。白闪只在命中的前 45% 用 `lighter` 合成；残影的灰度 `filter` 只作用于单个单位标记。
- `prefers-reduced-motion`：不前冲、不飞弹道、不出粒子、不下沉、不震屏，只保留白闪、数字和淡出。关掉“移动动画”时，事件照旧立即结算。
- 音效跟着轨道走：发起攻击时按属性家族播放 `attack:<家族>`（18 个属性归成 6 个家族，见 `src/browser/audio/sfx.ts`），效果拔群时再叠一段上行琶音；命中时由 `Track.cues` 播放 `hit` 或 `knockdown`。没有轨道时（关掉动画、屏幕外）这些声音在出队时一起播放。
- v16 自动选中下一个待命单位时，相机要等这次行动的动画播完再移过去。
- `tests/browser/performance.spec.ts` 在 dense 场景加测一组“四场战斗同时进行”的帧（`src/browser/render/benchmark.ts`：远程互射、击倒残影、占城扫色），平面地图和东西环绕各测一次。

## 大事件、时代形态、奇观揭幕、昼夜过渡（第三批，评审 V8–V11）

- **V8 大事件脉冲** `pulseTrack`（900 ms，`blocking: false`）：建城（阵营色 + 星）、设施区完成（设施区颜色 + 名称）、晋升（金色 V 字上升）、石头进化、野生刷新 / 巢穴出动 / 暴走袭城（红色 `!`）；商路建立用 `routeTrack`，金色短线沿商路跑一次（`nearestCopy` 走接缝短路）再在终点脉冲。事件到轨道的映射在 `src/browser/event-tracks.ts`，只读事件和 PlayerView。脉冲不阻塞事件队列，也不让按钮变灰：队列一空，面板立刻刷新（`panelsBusy`），脉冲结束后再刷新一次。屏幕外照 V7 规则不加轨道。
- **V9 时代形态** `formTrack`（900 ms，跟随单位实时位置，和进化一样按顺序播放）：Mega = 白闪 + 旋转彩虹环 + 粒子；极巨化 = 单位在 `poses` 里放大到 1.5 倍（`UnitPose.scale`）+ 脉动红色光环；太晶化 = 太晶属性色的六面晶体成形、流光、碎裂；Z 招式 = 金色光柱落下。减少动态效果时极巨化不放大。音效仍是 A1 的 `formChange`。
- **V10 奇观揭幕** `wonderRevealTrack`：只给自己的奇观（别人的奇观视图里没有城市）。城市在视口外时先 400 ms 平滑运镜到城市（`frame.camera`，主循环应用；这是唯一会移动相机的轨道），再 800 ms 金色光柱 + 粒子，号角在光柱开始时由轨道 cue 播放，光柱结束后才弹出传说卡；关闭卡片时相机回到玩家原来的位置。城市在视口内时只有光柱；减少动态效果时不运镜（城市在屏幕外就不播光柱）；关掉移动动画或点“跳过”时直接出卡，号角照响。揭幕轨道是 `paced`：主线程卡顿超过 100 ms 的帧间隔按一帧计，运镜不会被跳过。
- **V11 昼夜和天气过渡** `AmbientTransitions`（`src/browser/ambient-transitions.ts`）：每帧比较 PlayerView，昼夜或天气场变化时加 1.2 s 的非阻塞渐变轨道，`frame.night`（0–1）缩放夜晚遮罩（仍是每帧一次整图遮罩），`frame.weather` 让天气场淡入，已结束的天气场按最后看到的样子淡出。读档、新局、回放这类跳变不渐变；减少动态效果或关掉移动动画时直接切换。
- 帧预算：`tests/browser/performance.spec.ts` 的 dense 场景另测一组 `eventEffects`（`benchmark.ts` 的 `eventBenchmarkFrames`：四个脉冲、极巨化 + Mega、奇观光柱和夜晚渐变，环绕地图）。光柱用一个线性渐变 `fillRect`，粒子共用 `PARTICLE_CAP`，没有 `shadowBlur` / `filter`。

## 图层顺序与缓存

顺序：`base`（地形、格线、海岸、领土边界）→ 改良、信仰、资源徽章、设施区、施工标记 → 城市 → 地块产出与耕作标记 → 天气、夜晚 → 单位（动画中的单位画在动画位置）→ 城市横幅 → 移动范围、攻击/捕捉目标、设施区选址 → `fog`（记忆地形斜线）→ 选中圈、光标 → 调试层 → 特效。

`base` 和 `fog` 两层缓存为设备像素图片：

- 键包含画布尺寸、DPR、相机，以及该层的输入（地形与领土边界；迷雾格列表）。
- **相机在动时不建缓存，直接画**。每帧都重建缓存再拷贝，比直接画慢 4–5 倍（实测拖动时 p95 从约 2.5 ms 涨到 9–13 ms）。相机停下后的第一帧建缓存，之后的帧直接复用。
- 动画期间相机通常不动，所以动画帧都命中缓存；以后加持续动画（水面、天气粒子）也是这种情况。
- `createMapRenderer(canvas, { cacheLayers: false })` 关闭缓存，每层直接画，可作为参考输出。

精度：`base` 缓存与直接绘制逐像素一致。`fog` 是半透明层，先画到离屏再合成，和直接绘制有不超过 3/255 的取整差，肉眼不可见。

实测（M2 Pro、Chromium、DPR 2、上帝视角全图，p95）：

| 场景 | 直接绘制 | 相机静止（缓存命中） | 拖动中 |
| --- | --- | --- | --- |
| 小图 384 格，47 单位 | 2.4 ms | 1.8 ms | 2.3 ms |
| 标准图 600 格 | 1.5 ms | 0.8 ms | 1.3 ms |
| 大图 1040 格 | 2.0 ms | 1.0 ms | 1.8 ms |
| 105 个可见单位 | 2.9 ms | 1.5 ms | 2.6 ms |

`tests/browser/performance.spec.ts` 每次全量 e2e 都会记录这三组数据。

## 测试

- `tests/core/render-scene.test.ts`（Node）：在真实的 50 轮 v10 对局里，每个玩家的场景中，单位只出现在当前可见格，其他标记只出现在已知格，单位集合与 PlayerView 完全一致；产出图层开关；Timeline 的插值、并行、按 key 替换、持续轨道和跳过。
- `tests/browser/map.spec.ts`、`districts.spec.ts`、`diplomacy.spec.ts`：拦截真实的 Canvas 调用，检查迷雾下不会画出隐藏的阵营徽章或边界。
- `tests/browser/presentation-batch3.spec.ts`：真实 v23 AI 对局夹具（完整时代进程），V8 建城脉冲不阻塞、V9 时代形态（含四种形态的参考截图）、V10 奇观运镜 / 光柱 / 号角 / 出卡 / 复原相机（含减少动态效果）、V11 夜晚渐变且每帧一次遮罩；`tests/core/presentation-batch3.test.ts` 测纯函数部分。
- `tests/browser/combat-presentation.spec.ts`：真实 v22 AI 对局夹具（东西环绕地图），每项战斗表现一个测试（描边数字和反击位置、血条、震屏不动相机且命中缓存、屏幕外 AI 战斗不占时间、弹道和粒子的属性色、击倒残影、占城扫色、按属性的音效）；效果截图保存在 `docs/design/review-2026-11/shots-combat/`。
- 重构时用 26 个固定场景做了逐像素对比（见提交说明）。

## 怎么扩展

### 新的事件动画（例如攻击时的弹道）

1. 在 `animation.ts` 写一个返回 `Track` 的函数：`key`、`duration`、`sample(elapsed, context, frame)`。`sample` 往 `frame.poses` 放单位位置覆盖，往 `frame.effects` 放特效。
2. 如果需要新的特效种类，扩展 `MapEffect`，并在 `canvas2d.ts` 的 `drawEffects` 里画出来。
3. 在 `main.ts` 的 `presentationTrack` 里把事件映射到这个轨道。
4. 想让几个动画同时播放（例如攻击和反击），在同一帧 `timeline.add` 多条轨道即可。

### 持续动画（水面、天气粒子、选中单位呼吸）

- 用 `duration: Infinity` 的轨道。它不计入 `timeline.busy`，所以不会挡住事件队列，也不会让“结束回合”变灰；`timeline.animating` 会是 true。
- 现在主循环只在 `busy()` 时请求下一帧。加第一个持续动画时，需要让主循环在 `timeline.animating` 时也继续请求帧（只重画地图，不刷新面板），并在 `prefers-reduced-motion` 或关闭“移动动画”时不添加这类轨道。
- 需要按时间变化的图层，在 `AnimationFrame` 里加一个字段（例如 `time`），不要放进 `base`：`base` 的缓存键里没有时间。

### 新图层

在 `scene.ts` 的 `MapScene` 里加数据（只从 PlayerView 取），在 `canvas2d.ts` 里加一个 `drawXxx(d)` 并放进图层顺序。很少变化、绘制又贵的图层，可以照 `base`/`fog` 的方式用 `layer(cache, key, paint)` 缓存。

### 换成 PixiJS（WebGL）

只需要再写一个后端，实现和 `createCanvas2DRenderer` 相同的接口：`render(scene, camera, frame)`、`invalidate()`。场景、动画、游戏逻辑、面板和迷雾测试都不用改。点击判定在 `camera.ts`（纯六角格数学），与后端无关。值得换的信号：大量持续动画、远大于 40×26 的地图、手机上帧时间超过约 8 ms、需要着色器效果。
