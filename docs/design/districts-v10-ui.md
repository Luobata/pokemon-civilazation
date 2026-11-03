# 设施区 v10 UI 交互方案

- 状态：仅交互与接口方案，不包含实现代码。
- 依据：冻结产品规格 `docs/design/districts-v10.md`、技术接口 `docs/tech/districts-v10.md`、D-P3-0 至 D-P3-4。
- 原则：复用城市生产页、现有地图选格/键盘光标、队列和侧栏，不新增独立面板、资源或命令类型。

## 1. 版本与裁定采用

1. 只在 `view.expansion?.districts` 存在时显示设施区入口、地图标记和小节；v≤9 的 DOM、地图和生产行为不变。
2. **默认版本冲突**：产品规格 §1.1 写 `LATEST_GAMEPLAY_VERSION` 升 10，技术文档写暂留 9。采用技术文档与 D-P3-0：本轮只支持显式 v10 存档/房间，不新增版本选择器，等 UI 验收后再由 Hub 升级默认值。
3. **多城耕作**：采用 D-P3-1，而不是产品规格中只释放下单城市的旧表述。预览和下单提示都使用 `releasedCityIds` 展示所有将被释放工作与锁定的己方城市。
4. **未知相邻**：采用 D-P3-2。预览只称“当前已知合计”，`incomplete=true` 时明确实际效果可能更高，不把未知格显示成无加成。
5. **经验显示**：采用 D-P3-3。道馆区只给宝可梦增加出场经验；不得隐藏或改写建筑、教义给开拓队的既有经验。
6. **视野**：采用 D-P3-4。己方完工和在建记录始终完整显示；他国只显示可见/记忆记录，且只更新实际看见设施区的轮次。

## 2. 入口与完整下单流程

### 2.1 入口

在城市面板「生产」页的生产类别中增加「设施区」标签，与“建造建筑 / 训练宝可梦 / 训练开拓队”并列。点击后显示五类卡片和既有生产队列；不增加侧栏入口。

每张卡片显示：

- `DISTRICTS[kind].name`、`mark`、`cost`。
- 可建地形；港口另写“须临岸”。
- 基础效果、解锁科技名称。
- 科技锁定、同类上限、每城上限及队列满 5 项的禁用原因。

科技从 `view.economy.player.research.unlockedIds` 读取；槽位由 `cityDistrictDetails(view, city.id)` 与 `view.expansion.districts.projects` 合并计数；队列长度读 `city.queue.length`。不另写一套资格判断。

### 2.2 选类型与地图高亮

1. 点击可用类型进入 `districtPlacement = { cityId, kind, tileIndex?: number }`，保留当前城市并跳转/聚焦地图。
2. 调用一次 `districtSites(view, cityId, kind)`，按 `tileIndex` 建索引；只在城市、类型或 `view` 改变时重算。
3. `reason === null` 的格子使用金色实线高亮；其他格子用低对比红色斜线/叉号。非法格不是隐藏，以便玩家理解选址限制。
4. 悬停、键盘光标或窄屏点选格子时，直接从已计算的 `DistrictSite` 显示预览；非法格显示原因且没有确认按钮。
5. 切换城市、类型、读档、新局、重放、续跑或结束回合时取消未确认选址；`Esc` 和再次点击已选类型也只取消选址，不改变队列。

### 2.3 预览

预览标题为“{设施区名} · 地块 {tileIndex}（{q},{r}）”，内容固定为：

1. 当前地形：`view.map.tiles[tileIndex]` + `BIOME_DISPLAY`。
2. 基础效果：`site.effects.base` 的非零项。
3. 逐项相邻来源：遍历 `site.effects.adjacency`，显示 `label`、`effect`、`value` 和 `cap`；可附“已知来源 {tileIndices.length} 格”，但只列已知来源，不显示隐藏信息。
4. 合计：`site.effects.total` 的非零项，标题写“当前已知合计”。
5. 未知提示：`site.effects.incomplete` 时显示“部分相邻格未知（{unknownAdjacentTileIds.length}），实际效果可能更高”。未知 ID 只用于计数。
6. 耕作提示：`site.releasesWork` 时显示“下单后，城市 {releasedCityIds} 将释放该格工作与锁定；对应人口成为观测者，不自动改派”。
7. 非法原因：`site.reason` 按 §7 文案表显示；即使非法也可以展示基础/相邻效果用于比较，但不得发命令。

效果键统一映射：`food=食物`、`production=生产`、`gold=金币`、`research=科研`、`trainedXp=宝可梦出场经验`、`bondPressure=每轮羁绊压力`。

### 2.4 确认入队

1. 桌面端点击合法格即确认；窄屏第一次点选只预览，再点同一格或“确认入队”按钮确认，避免无悬停设备误下单。
2. 确认前再调用 `previewDistrict(view, cityId, kind, tileIndex)`，必须得到 `reason === null`，且 `city.queue.length < 5`；否则只刷新原因，不发命令。
3. 使用既有 `SetProductionQueue`：保留 `city.queue` 中每项 `orderId/item`，追加 `{ item: { kind:'district', defId:kind, tileIndex } }`。联机走同一个 action，经现有 `send` 发送，不新增网络协议。
4. 成功后退出选址并回到城市生产页，提示“{设施区名}已加入城市 {cityId} 队列；格子已预订”。工作释放以新 `PlayerView` 为准，不在本地猜测人口。
5. 若核心返回 `invalid-production`，提示“订单未通过最新规则校验，请重新选择”；若返回 `contested-territory`，使用 §7 对应文案。不能用 UI 预览代替权威命令。

### 2.5 队列与取消

- 设施区队列项显示图标、名称、格子坐标、`order.progress/DISTRICTS[kind].cost` 和进度条。
- 与其他订单一样支持上移、下移和取消；移除 coder 临时兼容层中“district 不显示操作按钮”的限制。
- 取消仍用 `SetProductionQueue` 保留其余 `orderId/item`，不退款、不拆除完工设施区。
- 取消提示“已取消{设施区名}，地块预订已释放；原耕作人口不会自动改派”。
- 完工后以 `view.expansion.districts.projects` 消失和 `tiles` 出现为准，不根据本地计时伪造完工。

## 3. 地图表现

### 3.1 图标与颜色

| 类型 | 标记 | 建议色 |
| --- | --- | --- |
| 研究所区 | 研 | 科研蓝 `#83BCD0` |
| 道馆区 | 馆 | 战斗红 `#E07A6D` |
| 港口 | 港 | 海洋青 `#4FA3B8` |
| 发电厂 | 电 | 金色 `#E6B85C` |
| 花园 | 园 | 草绿 `#72C99E` |

统一使用圆角方形底和浅色描边，与改良的圆形标记、稀有树果的粉色资源标记区分。道馆区用红色方形“馆”，属性道馆继续使用既有精华色/城市信息，不改变其视觉语义；两者不得共用一个图标。

### 3.2 状态与层级

1. **己方完工**：实心类型色 + 白色单字，即使格子当前不可见也完整显示；不得因此补画隐藏地形、改良、单位或相邻效果。
2. **己方在建**：同类型色空心方框 + 单字，底部显示 `progress/cost` 百分比；只读取 `districts.projects`，他国项目不创建任何绘制记录。
3. **他国当前可见**：使用 `ownerId` 的文明色外圈 + 类型色底；可叠文明编号小角标。
4. **他国记忆**：降低饱和度并加记忆斜线，提示“第 {lastSeenRound} 轮所见”；不把旧记录当作当前状态。
5. **中立/停用**：`ownerId === null` 时灰色底并标“停”，地图提示写“当前停用”。
6. **选址高亮**：位于所有设施区图标之上；待确认格使用更粗描边，不与攻击红虚线或捕捉球标记共用形状。

绘制顺序建议：地形/领地 → 改良与资源 → 设施区完工/在建 → 城市与单位 → 记忆雾与斜线 → 选址高亮。记忆雾可以淡化他国旧记录，但己方记录保持可读；设施区不得覆盖城市中心或单位主标记。

### 3.3 地图提示

悬停/光标指向设施区时显示类型、所属 `cityId`、格子坐标、启用/停用状态和他国记忆轮次。需要效果明细时调用 `cityDistrictDetails(view, record.cityId)` 并匹配 `tileIndex/kind`；展示 `active`、`effects.base/adjacency/total/incomplete`，不另读权威状态。

## 4. 城市面板信息

在“生产”页队列上方增加“设施区 {已完成与订单合计}/2”小节：

1. 完工列表来自 `cityDistrictDetails(view, cityId)`，按返回顺序显示名称、格子、基础效果、逐项相邻、当前已知合计。
2. `active=false` 时显示“停用”，数值按接口返回的全零展示，不自行恢复效果。
3. `effects.incomplete` 使用与选址相同的“部分相邻格未知”提示。
4. 在建列表来自 `districts.projects` 并匹配 `cityId`，显示进度；完工与在建合并用于 2 槽和同类限制。
5. 道馆区经验加入现有宝可梦训练预览的“出场经验构成”，值取本城 `cityDistrictDetails(...).effects.total.trainedXp`；不应用到开拓队。
6. 花园继续由核心羁绊明细展示；城市小节可显示 `bondPressure`，但不另写一份羁绊合计替代 `bondPressure` 的权威分项。
7. 城市易主后，新主立即使用完整 `tiles/projects`；原主只保留普通地图记忆，不继续显示城市私有详情。

## 5. 键盘与 390px 窄屏

### 键盘

- 进入选址后焦点移到现有 `#map`；方向键移动 `keyboardIndex`，逐格显示预览/原因。
- `Enter` 在合法格确认入队，非法格只显示原因；`Esc` 取消选址。
- `+/-` 缩放、`F` 居中沿用现有行为；`Tab` 仍可回到城市面板和队列按钮。
- 不用 Tab 自动跳过非法格，避免玩家失去理解禁用原因的能力。

### 390px

1. 类型卡片保持现有生产控件纵向排列，确认/取消按钮至少 44px 高，不新增横向布局。
2. 点击类型后通过既有「地图」导航回地图；第一次点选只预览，再次点同格或点“确认入队”完成。
3. 预览放在现有 `#action-notice`/行动对象区域，使用可换行文本，不在 Canvas 上固定长文本。
4. 返回城市时使用「行动」或现有侧栏导航；成功入队后自动回到生产页。
5. 预览和确认区不得被 `#end-turn-float` 遮挡；390px 下无横向溢出。

## 6. 界面到接口对照

| 界面元素 | 查询与字段 |
| --- | --- |
| 类型名称/图标/成本/科技/地形 | `DISTRICT_IDS`、`DISTRICTS[kind].name/mark/cost/requiredTech/biomes/coastal`；科技状态读 `view.economy.player.research.unlockedIds` |
| 全图合法/非法格 | `districtSites(view, cityId, kind)[].tileIndex/reason` |
| 选址预览 | 同次 `districtSites` 结果的 `effects`、`releasesWork`、`releasedCityIds`；确认前用 `previewDistrict` 重验 |
| 基础与相邻明细 | `DistrictBreakdown.base/adjacency[].label/effect/tileIndices/perTile/cap/value` |
| 当前已知合计 | `DistrictBreakdown.total` |
| 未知相邻提示 | `incomplete`、`unknownAdjacentTileIds.length` |
| 多城释放耕作 | `releasesWork`、`releasedCityIds` |
| 入队与取消 | `city.queue` + `SetProductionQueue`；追加 district item 或保留其余 `orderId/item` |
| 队列进度 | `city.queue[].progress` 与 `DISTRICTS[kind].cost`；在建集合同时可读 `districts.projects` |
| 城市完工明细 | `cityDistrictDetails(view, cityId)[].active/effects` |
| 地图完工/记忆 | `districts.tiles[].cityId/kind/tileIndex/builtAtRound/ownerId/lastSeenRound`；当前可见性只用 `visibleTileIds` |
| 地图在建 | `districts.projects[].cityId/kind/tileIndex/orderId/progress`，只含己方 |
| 地形名称 | `view.map.tiles[tileIndex]` + `BIOME_DISPLAY` |
| v≤9 隐藏 | `view.expansion?.districts === undefined` |

## 7. 原因码文案表

| 原因码 | 中文提示 |
| --- | --- |
| `districts-unavailable` | 当前对局未启用设施区，需要显式 gameplay v10。 |
| `unknown-district` | 未知的设施区类型，请重新选择。 |
| `city-unavailable` | 请先选择一座当前可下单的己方城市。 |
| `district-tech-locked` | 尚未研究「{所需科技}」，完成后即可建造。 |
| `unknown-tile` | 只能选择当前可见且已知的地块。 |
| `city-center` | 城市中心格不能建造设施区。 |
| `outside-city-territory` | 目标格必须在所选城市的当前领地与工作距离内。 |
| `wrong-biome` | 地形不符合要求：{设施区名}需要{允许地形}。 |
| `harbor-needs-coast` | 港口必须放在至少相邻一个陆地格的海洋格。 |
| `district-tile-occupied` | 该格已有设施区或设施区订单。 |
| `tile-improved-or-under-construction` | 地块改良与设施区不能共用一格，请选择其他地块。 |
| `rare-berry-deposit` | 稀有树果矿点必须保留，不能建造设施区。 |
| `contested-territory` | 目标格属于其他文明领地，不能在这里下单。 |
| `district-kind-limit` | 每座城市每种设施区最多一个，包含队列中的订单。 |
| `district-city-limit` | 每座城市最多两个设施区，包含队列中的订单。 |

UI 本地补充：`city.queue.length >= 5` 显示“生产队列已满 5 项，请先完成或取消订单”；核心 `invalid-production` 显示“订单未通过最新规则校验，请重新选择”。未知的新原因码回退为“当前不可建造（{reason}）”，不显示空白按钮。

## 8. 接口缺口

**没有发现阻断实现的接口缺口。**

- 队列满 5 项可直接读 `city.queue.length`，不需要核心新增 `queue-full` 原因码。
- 地形、科技、成本、图标和城市队列已有字段足够，不需要新增查询。
- 他国记忆通过 `ownerId/lastSeenRound/visibleTileIds` 足够区分；己方完整记录与他国项目私有边界已经明确。
- `DistrictSite.reason` 当前是 `string`，UI 必须保留未知原因码回退文案；若以后需要编译期穷尽检查，可把原因码升级为联合类型，但这属于可选加固，不是开工前置。

## 9. 预计实现文件与 E2E

### 文件

- `src/browser/district-panel.ts`（新增）：类型卡片、选址预览、城市小节和原因文案。
- `src/browser/economy-panel.ts`：接入生产标签、设施区小节、完整队列操作和训练经验构成；实施前需由 Hub 再次确认写入权已从 coder 交回。
- `src/browser/main.ts`：选址状态、鼠标/键盘流程、命令与地图参数。
- `src/browser/multiplayer.ts`：复用同一选址状态与 `SetProductionQueue`，不新增网络协议。
- `src/browser/canvas.ts`：完工/在建/记忆图标、迷雾与选址层级。
- `src/styles.css`：卡片、预览、窄屏和队列样式。
- `tests/browser/districts.spec.ts`（新增）：下述用例；v10 夹具由真实命令轨迹生成，不修改 coder fixtures。

### E2E 用例

1. 五类卡片科技/地形/成本显示，v≤9 无入口、无图标、无小节。
2. 研究所区完整流程：选类型 → 合法高亮 → 基础/逐项相邻/合计 → 入队 → 队列排序/取消 → 完工 → 下轮城市效果。
3. `releasesWork` 覆盖同文明两城释放，`releasedCityIds` 全部出现；取消后不自动改派。
4. `incomplete` 显示未知数量与“可能更高”，不泄露隐藏地形/改良；全部已知后提示消失。
5. 所有 §7 原因码至少在 UI 映射测试中出现；重点 E2E 覆盖科技锁、城市中心、错误地形、非临岸港口、改良/树果互斥、同类/两槽/队列满、`contested-territory`。
6. 己方视野外完工/在建仍完整；他国记忆淡化并显示 `lastSeenRound`；他国订单不出现；中立显示停用。
7. 键盘方向键/Enter/Esc 与 390px 两段点选，确认区无溢出、无悬浮结束回合遮挡。
8. 道馆区只增加宝可梦经验，开拓队既有经验路径不变；花园只显示核心返回的羁绊分项。
9. 联机使用同一 helper 的选址/取消流程；若无实时房间 spec，至少覆盖共享命令生成和 multiplayer 入口，不以单机测试冒称实时联机验证。

## 10. 简短线框

```text
城市 1 / 生产
[建造建筑] [训练宝可梦] [训练开拓队] [设施区]
设施区 1/2
[研 研究所区 60] [馆 道馆区 70] [港 港口 50]
[电 发电厂 60]   [园 花园 40]

地图选格：研究所区 · Esc 取消
研 研究所区 · 地块 42（6,7）
地形：山地
基础：科研 +2
相邻：山地/雪原/火山 科研 +2（封顶 2）
      已完成观测站 科研 +1（封顶 1）
当前已知合计：科研 +5
部分相邻格未知（1），实际效果可能更高
下单后，城市 1、3 将释放该格工作与锁定；人口成为观测者
[确认入队]  /  非法格仅显示原因，无确认按钮

生产队列 2/5
1. 研究所区（6,7）  12/60  [上移][下移][取消]
```
