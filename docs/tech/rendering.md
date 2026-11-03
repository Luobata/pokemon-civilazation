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

事件按顺序播放（和以前一样：上一个结束，下一个才开始），时长不变：移动每格 180 ms，战斗、捕捉 600 ms，进化 450 ms。`Timeline` 本身支持多条轨道同时播放，顺序播放只是主循环的选择。

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
