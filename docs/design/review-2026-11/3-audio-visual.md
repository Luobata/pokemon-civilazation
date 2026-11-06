# 评审 3：音乐、渲染与攻击特效（2026-11）

范围：`src/browser/render/`（scene / animation / canvas2d / index）、`terrain.ts`、`map-icons.ts`、`building-art.ts`、`sprites.ts`、`src/browser/audio/`、`main.ts` 中的 `presentationTrack` / `soundFor` / `syncMusic`，以及 `docs/tech/rendering.md`。
方法：读代码；在 dev server 上用 Playwright 截图，用真实渲染器在单位格上画出 battle / capture / evolve 三种特效（截图放在 `/tmp/av-review/`，没有进仓库）。

## 1. 结论

- **渲染架构扎实，表现层很薄。** scene → Timeline → Canvas2D 三层拆得干净，迷雾安全有测试，`base`/`fog` 缓存让 105 个可见单位的 p95 停在 2.9 ms。扩展点（`MapEffect`、`Track`、`duration: Infinity`）都已经留好，但实际只用了 4 条事件轨道和 1 条点击涟漪。
- **攻击特效是最大的短板。** 一次战斗只有：目标格白闪 300 ms，加上一个浅色、没有描边的 `−32`。攻击方不动，没有弹道，没有属性色，没有震屏，没有击倒动画。反击数字还画在**目标格**上。地图上不画单位血条（v20 已经是 100 HP 的数值战斗）。
- **音频完成度比画面高。** 原创 Web Audio 合成：3 首曲子、19 个音效、交叉淡入淡出、大音效时压低音乐（ducking）、压缩器、标签页隐藏时暂停、设置可持久化。不足在于量：每首曲子 44–64 秒一循环、不跟时代变化、战斗没有分层、攻击不区分属性、没有叫声和环境音，约 20 种事件没有声音。

## 2. 现状清单

| 模块 | 已有 | 观察 |
| --- | --- | --- |
| 渲染管线 | `buildScene`（纯函数）→ `Timeline.sample` → `createCanvas2DRenderer`，12 个固定图层 | `base`/`fog` 缓存为设备像素位图，相机移动时不建缓存；接口允许以后换 Pixi 后端 |
| 地形 | `terrain.ts`：7 种生物群系的程序化像素格，有缓存 | 全部静态：水面、熔岩、雪不动；没有地形过渡和装饰物变化 |
| 精灵 | `sprites.ts`：PokeAPI 第 3–9 世代（159 张），启动时一次性加载；第 6–9 世代平滑缩放并保持比例 | 第 3–5 世代像素图和第 6–9 世代平滑插画混在同一张地图上，风格不统一 |
| 图标 | `map-icons.ts`：像素图标（产出、资源、改良、设施区、标记）+ 像素数字 | 质量好，风格统一 |
| 建筑 | `building-art.ts`：城市格里画 5 种 SVG 建筑 | 只有 5 种；奇观在地图上只显示横幅计数 |
| 静态标记 | 敌对红圈、暴走 `!`、形态徽章（M / 极 / 晶 / Z）、晋升 V 字、可晋升箭头、商路金色虚线、天气着色 + 中心标、夜晚整图压暗 | 都是“状态标签”，切换时没有过渡 |
| 事件轨道 | `moveTrack`（每格 180 ms）、`battleTrack` / `captureTrack`（600 ms）、`evolveTrack`（450 ms）、`tapTrack`（260 ms，非阻塞） | 严格串行；相机不跟随，屏幕外的事件照样占时间 |
| DOM 表现 | 传说降临全屏卡、toast 滑入、面板金色闪烁 | 传说卡和地图没有联动，不会运镜到城市 |
| 音频引擎 | `audio/index.ts`：音乐总线 → 暖音滤波 → duck → master → 压缩器；音效总线；60 ms 同 ID 冷却 | 架构好；只有 master / music / sfx 三个滑杆 |
| 音乐 | peace（F 大调 90 BPM，约 64 s 一循环）、war（D 小调 132 BPM，约 44 s）、menu | `menu` 只在对局结束时响（`syncMusic` 判断 `outcome`），开局和领袖选择时不会用到 |
| 音效 | 19 个：click / select / move / attack / hit / knockdown / capture / captureFail / evolve / cityFounded / production / research / turn / war / peace / promotion / wonder / error / notify | 所有按钮共用 `click`；建筑、设施区、训练单位、商路共用 `production` |

### 事件覆盖（✓ 有，— 无）

| 事件 | 地图动画 | 音效 | 备注 |
| --- | --- | --- | --- |
| Moved | ✓ | ✓（仅己方） | |
| BattleResolved | 弱 | ✓ hit / knockdown | 见第 3 节 |
| BattleResolved.capturedCity（占城） | — | —（只有 hit） | 城市颜色瞬间换掉 |
| 击倒 / UnitRecovering | — | knockdown | 轨道开始时状态已经是最终状态，被击倒的单位直接消失，数字飘在空格上 |
| Captured / Evolved | ✓ | ✓ | WorldStoneEvolution 只有声音 |
| CityFounded | — | ✓ | |
| DistrictCompleted / BuildingCompleted / UnitTrained | — | production（共用） | |
| LegendWonderCompleted | —（DOM 卡） | wonder 号角 | LegendWonderLost 没有任何表现 |
| UnitPromoted | — | promotion | `soundFor` 不判断归属，看到 AI 晋升也会响 |
| EraAbilityUsed（超级进化 / 极巨化 / 太晶化 / Z 招式） | — | — | 只有徽章字母 |
| WeatherSummoned / 昼夜切换 | — | — | 着色瞬间出现或消失 |
| EraAgeBegan | — | notify（通用） | 换时代没有专属音乐提示 |
| TradeRouteEstablished | — | production（共用） | 虚线静止 |
| CityDefected / CityConverted / WildSpawned / WorldRampageStruckCity / CivilizationEliminated | — | — | |
| GameEnded | — | 切到 menu | 没有胜利或失败的音乐 |

## 3. 不足（按玩家感知排序）

1. **战斗看不清。** `canvas2d.ts` 的 `drawEffects`：伤害文字颜色是 `#F4E0DB`，`centeredText` 不描边，在草地和雪地上几乎看不见（截图里 `−32` 被城市横幅和单位压住）。攻击方没有任何反馈。反击 `反击 −12` 画在目标格（`positions[1]`），应该画在攻击方（`positions[0]`）。
2. **地图上没有单位血条。** `unitMark` 不读 `hp`，玩家只能点开单位或看预览才知道剩余 HP。Civ 式的数值战斗离不开血条。
3. **击倒和占城没有表现。** 渲染时状态已经是最终状态：被击倒的单位在伤害数字出现前就消失了；占城时边界和横幅颜色瞬间换掉。这是战争里最重要的两个时刻。
4. **属性没有体现在画面和声音上。** 攻击不分属性：没有属性色、没有弹道、`attack` / `hit` 只有一种声音。效果拔群 / 效果不佳（`KnockdownRecord.effectiveness` 已经有这个数据）没有提示。
5. **大事件没有地图反馈。** 建城、设施区、奇观、晋升、超级进化 / 极巨化 / 太晶化、天气、换时代都只有 toast 或声音，地图上没有一个脉冲。传说降临卡不会把镜头带到城市。
6. **屏幕外事件浪费时间。** AI 回合里屏幕外的战斗照样每场阻塞 600 ms，相机不跟随，也不会跳过。
7. **音乐重复。** 64 秒 / 44 秒的循环在 200 轮的对局里听几百遍；不随时代变化；战争曲只有开和关两档，没有强度分层。
8. **世界是静止的。** 没有待机动作、水面波动、天气粒子、昼夜渐变、迷雾揭开时的淡出；`frame()` 只在 `busy()` 或 `animating` 时请求帧，所以现在也没有持续动画的循环。
9. **精灵风格割裂。** 像素精灵（第 3–5 世代）和平滑插画（第 6–9 世代）并排出现。
10. **声音细节少。** 没有宝可梦叫声、环境音、悬停 / 打开界面 / 切换标签的界面音，没有结束回合的专属音效。

## 4. 建议

成本：S ≤ 半天，M 1–3 天，L > 3 天。

### 4.1 战斗与反馈（先做）

| # | 建议 | 成本 | 改哪里 |
| --- | --- | --- | --- |
| V1 | 修正现有战斗文字：深色描边（`strokeText`，2–3 px）、放大到约 0.8 倍格半径、弹出缩放后上浮淡出；反击数字改画在 `positions[0]` | S | `canvas2d.ts` `drawEffects` / 新增 `outlinedText` |
| V2 | 单位血条：HP 未满时在单位底部画 2–3 px 的条（颜色同城市血条）；`SceneUnit` 增加 `hp` / `maxHp` | S | `scene.ts` `SceneUnit`、`canvas2d.ts` `unitMark` |
| V3 | 重做 `battleTrack(attacker, target, attackType, effectiveness, …)`，分四段：0–150 ms 攻击方向目标前冲 0.3 格（`frame.poses`）；远程单位（射程 > 1）150–300 ms 发出属性色弹道；300 ms 命中，在格上爆出属性色粒子并白闪；数字随后弹出。效果拔群时显示金色“效果拔群”，效果不佳时显示灰色。事件里补 `attackType` / `effectiveness`（可选字段，旧存档回放不受影响）；`TYPE_COLORS` 从 `src/guide/tables.ts` 移到 content 层共用 | M | `animation.ts`、`MapEffect` 新增 `projectile` / `impact`、`core/combat.ts` 事件字段、`main.ts` `presentationTrack` |
| V4 | 震屏：`AnimationFrame` 增加 `shake: Point`，按伤害幅度设 2–6 px，200 ms 内衰减。**做成整帧平移（`blit` 和直接绘制都加偏移），不要改相机**，否则缓存键变化，每帧都会退回直接绘制 | S | `animation.ts`、`canvas2d.ts` `render` / `blit` |
| V5 | 击倒动画 `knockdownTrack`：用 `KnockdownRecord` 或事件里的单位身份画一个“残影”姿态，下沉、变灰、淡出，挂一个“休养”标签；配 `knockdown` 音效 | S–M | `animation.ts`（`poses` 已支持画不在场景里的单位）、`main.ts` |
| V6 | 占城：`capturedCity` 时播放约 900 ms 的 `cityCaptureTrack`：旧阵营横幅撕下，新阵营颜色从城市格向外扫过领土边；新增 `cityCaptured`（己方占领）和 `cityLost`（己方失城）音效 | M | `animation.ts`、`canvas2d.ts` `cityBanner`、`sfx.ts` |
| V7 | 屏幕外事件：不在视口内且不是己方行动时，只播声音和 toast，不占时间；或者加“跟随战斗”选项，用 250 ms 平滑运镜过去 | S | `main.ts` `frame` / `presentationTrack` |

### 4.2 大事件与世界

| # | 建议 | 成本 | 改哪里 |
| --- | --- | --- | --- |
| V8 | 通用 `pulseTrack(position, color, label, icon?)`，一条轨道覆盖：建城、设施区完成（设施区颜色）、晋升（金色 V 字上升）、商路建立（虚线流动一次）、WorldStoneEvolution、野生刷新 / 暴走（红色警示） | S | `animation.ts`、`main.ts` |
| V9 | 时代形态专属特效：超级进化 = 彩虹环 + 闪光；极巨化 = 精灵放大 1.5 倍 + 红色光晕；太晶化 = 太晶属性色的晶面；Z 招式 = 金色光柱。对应 `EraAbilityUsed`，补一个 `formChange` 音效 | M | `animation.ts`、`canvas2d.ts` `drawEffects`、`sfx.ts` |
| V10 | 奇观揭幕：先运镜到城市（400 ms），金色光柱 + 粒子（800 ms），再弹出 DOM 卡；号角对齐光柱 | M | `main.ts`（`legendArrivals` 改成在轨道 `onFinish` 后弹出）、`animation.ts` |
| V11 | 昼夜和天气过渡：`night` 由开关改成 1.2 s 透明度插值；天气出现和消失时淡入淡出 | S | `animation.ts` 渐变轨道 + `drawWeather` 读 `frame` |
| V12 | 天气粒子（雨、雪、沙暴、日照光斑）：`duration: Infinity` 环境轨道，按可见天气格生成，全图粒子上限 150 | M | `animation.ts`、`drawWeather`、`main.ts` 环境帧循环（见第 5 节） |
| V13 | 迷雾揭开淡出：缓存键变化时保留上一张 `fog` 图，用 300 ms 交叉淡化 | M | `canvas2d.ts` `layer` / `fog` 缓存 |
| V14 | 待机呼吸：只给**选中单位**加 1–2 px、1.6 s 周期的上下浮动（全单位开启会让 100 单位场景持续重绘） | S | 环境轨道往 `poses` 写偏移 |
| V15 | 精灵风格统一：第 6–9 世代先画到 64 px 离屏画布（最近邻），再放大，得到像素化效果；或者所有精灵统一加 1 px 深色描边 | S–M | `sprites.ts` |
| V16 | 水面、熔岩微动 | L（往后放） | 不能放进 `base` 缓存，需要单独的低帧率覆盖层；更适合等换成 Pixi 后用着色器做 |

### 4.3 音频

| # | 建议 | 成本 | 改哪里 |
| --- | --- | --- | --- |
| A1 | 补齐缺失音效：`cityCaptured`、`cityLost`、`eraChange`（3–4 s 小号角）、`victory` / `defeat`、`weather`、`formChange`、`tradeRoute`、`legendLost`、`alarm`（暴走、野生刷新、己方城市被攻击）、`endTurn`。在 `soundFor` 里接上，同时修 `UnitPromoted` 不判断归属的问题 | S | `sfx.ts`、`main.ts` `soundFor` |
| A2 | 按属性的攻击音效：18 个属性归成约 6 个声音家族（火 = 低通扫频噪声，水 = 气泡 + 带通，电 = 方波电击，草 / 虫 = 沙沙声，超能 / 幽灵 = 颤音正弦，格斗 / 岩石 / 地面 = 重击），用 `attackSfx(type)` 生成；效果拔群时叠一个上行琶音 | M | `sfx.ts`（`SOUND_EFFECTS` 允许带参数的条目，或注册 `attack:fire` 这类 ID） |
| A3 | 战争强度分层：`SongPlayer` 按声部（lead / arp / bass / drums）各自开增益；强度 0–3 由“本轮己方参与的战斗数、己方城市是否受攻击”决定；和平曲在开战前一轮先加入鼓组做预警 | M | `sequencer.ts`、`audio/index.ts` 新增 `setIntensity`、`main.ts` |
| A4 | 时代音乐：便宜做法是同一主题按时代换调、换速度、换配器（S–M）；完整做法是每个时代写一段 8 小节的 B 段并轮换（L）。换时代时用 A1 的 `eraChange` 号角做过渡 | M / L | `music-*.ts`、`song.ts`、`syncMusic` |
| A5 | 开局和选领袖时用 `menu` 曲；结束画面按胜负换成胜利曲或安静的失败尾声 | S | `main.ts` `syncMusic` / `renderLeaderSetup` |
| A6 | 程序合成的原创叫声：按图鉴编号做种子，生成 2–3 段音高轮廓 + 共振峰，选中、进化、击倒时播放。**不要下载官方叫声**（受版权保护的资源） | M | `sfx.ts` 新增 `cry(dex)`、`main.ts` 选中处 |
| A7 | 环境音床：按镜头中心的生物群系播放风、海浪、鸟鸣（噪声合成）；新增“环境”音量滑杆 | M | `audio/index.ts` 新总线、`settings.ts` |
| A8 | 界面音细分：打开 / 关闭界面、切换标签、悬停（很轻）、结束回合各用一个声音；替换现在“所有按钮都是 click”的做法 | S | `main.ts` 第 846 行附近、`screens` |

## 5. 性能约束

- 基准（`docs/tech/rendering.md`，M2 Pro，DPR 2）：105 个可见单位，直接绘制 p95 2.9 ms，缓存命中 1.5 ms。建议预算：100 单位场景叠上战斗特效和天气粒子后 p95 ≤ 4 ms；移动端每帧 ≤ 8 ms（超过就是换 Pixi 的信号）。
- **事件特效不影响缓存**：播放时相机不动，`base`/`fog` 都命中缓存。震屏必须做成 `blit` 和直接绘制共用的偏移（V4），不能改相机。
- **持续动画（V12 / V14 / V13）会让帧循环一直跑**：只重画地图，不调用 `controls()`；只有环境轨道时限制到 30 fps；`document.hidden` 时暂停；`prefers-reduced-motion` 或关掉“移动动画”时不添加环境轨道（`tapTrack` 已经这样处理）。
- Canvas 2D 里不要用 `shadowBlur` 和大面积 `filter`（每次调用都很贵）；粒子用对象池和 `fillRect`，全图上限约 150–200；`globalCompositeOperation = 'lighter'` 只在命中闪光时短暂使用。
- 待机动作只给选中单位或屏幕内少于 30 个的单位；100 单位都浮动，相当于每帧都按直接绘制的成本重画。
- 建议在 `tests/browser/performance.spec.ts` 的 dense 场景里加一组“带战斗特效 + 天气粒子的帧”，和现有三组数据一起记录。
- 并行轨道：战斗与反击、击倒与占城可以在同一帧 `timeline.add`；事件队列仍然串行，所以总时长要控制（战斗整体 ≤ 900 ms，AI 回合建议只给可见战斗做全套动画）。

## 6. 建议顺序

1. **第一批（约 2 天，影响最大）**：V1、V2、V4、V7、A1。修掉看不清的数字，加血条、震屏，跳过屏幕外事件，补齐缺失音效。
2. **第二批（约 1 周）**：V3、V5、V6、A2。属性弹道和命中、击倒、占城，加上按属性的攻击音效，让战斗“有手感”。
3. **第三批**：V8、V9、V10、V11、A3、A5。大事件的地图反馈和音乐分层。
4. **之后**：V12–V16、A4、A6–A8。氛围层面的投入，先确认第 5 节的帧预算再做。
