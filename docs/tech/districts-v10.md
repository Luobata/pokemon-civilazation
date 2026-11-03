# 设施区 v10 实现与 UI 接口

依据：冻结规格 `docs/design/districts-v10.md`（fff3417）及 coder-p3-2 合同 A1–A5。此批只交付规则和接口，完整 UI 由 design 接入。

## 版本与状态

`GameplayVersion` 接受 10；`LATEST_GAMEPLAY_VERSION` 暂留 9（Hub 决定）。显式 v10 使用 schema 5 / rules `districts-v10`；旧版本保持 schema 4 / `m5-v1`。存档封套、命令日志、回放和联机房间均依据显式 setup，不静默升级。v≤9 不初始化 district 状态或生成 district AI 候选。

- `src/content/districts.ts`：`DISTRICTS`、字典序 `DISTRICT_IDS`、`DistrictId`，五类的名称、科技、地形、成本、基础与相邻规则。
- `state.expansion.districts.tiles[tileIndex] = { cityId, kind, tileIndex, builtAtRound }`。
- 生产项：`{ kind: 'district', defId: DistrictId, tileIndex: number }`；沿用生产订单 ID、进度、取消、溢出、每城每轮最多完成一项及大赛馆分流。
- 完工事件：`{ type: 'DistrictCompleted', playerId, cityId, orderId, tileIndex, kind, cost, overflow }`。事件按既有私有经济事件规则发送所有者，地图完工特征按下述投影公开。

## 合同补充裁定

- D-P3-1（A3 修订）：目标格的公开 `territoryOwnerIds` 含任一他国即返回 `contested-territory`；中立城市不算。本文明多城工作重叠允许下单，释放所有本文明城市对该格的工作与锁定，不自动改派。取消仅释放预订。已完成设施区不再校验领地、距离、科技、人口，后来形成重叠领地也不改变所属城市；所有城市均不能工作或改良该格。
- D-P3-2（A2）：同一个纯函数分别接收真实地图和 PlayerView 已知地图。未知邻格省略，`incomplete=true`，仅列坐标索引，不含隐藏地形或改良。预览可能低估实际效果；全部邻格信息已知时相等。
- D-P3-3（A4）：“开拓队不获得经验”仅指道馆区不增加开拓队经验。原有建筑、教义经验保持不变。
- D-P3-4（A5）：己方完工设施区和订单始终作为己方城市信息完整投影，不受当前视野影响，不刷新地形、单位、相邻改良。新所有者立即获得完整记录；原所有者从此只保留普通地图记忆。他国完工设施区仅在可见或记忆中投影，所有他国队列私有。设施区地图记忆只在实际可见时刷新，不把“探索过地形”当作看到了后来隐藏的施工。

## 结算路径

`districtBlocker` 是权威下单、预览和 AI 的共同校验。入队即预订；完工记录替代预订。已存在订单用 orderId 保留进度与位置，不能借 orderId 改换格子。捕获和淘汰事务清除未完工设施区订单，保留其他队列既有行为；羁绊脱离仍按旧规则清空队列。完工记录始终绑定 cityId。

`cityDistrictEffects` 用当前相邻地图重算效果，完工轮不计入本轮资源和羁绊，下轮启用；中立与占领当轮为零。资源在 cityYield 原有倍率和加法之后直接相加，避免再乘御三家/建筑/政策/领袖/信仰系数。道馆经验只在宝可梦成功出场时相加；待出场记录不预先存储经验。花园加入 bondPressure 的“花园 +1”分项，总部和和谐教义沿用旧优先级。

## UI 接口

全部玩家查询从 `src/core/districts.ts` 导入，只接受 PlayerView，不向 UI 提供权威状态。

```ts
previewDistrict(view: PlayerView, cityId: number, kind: DistrictId, tileIndex: number): DistrictSite;
districtSites(view: PlayerView, cityId: number, kind: DistrictId): DistrictSite[];
cityDistrictDetails(view: PlayerView, cityId: number): Array<ObservedDistrict & {
  active: boolean;
  effects: DistrictBreakdown;
}>;
```

`districtSites` 按 tileIndex 列出全图，包含不合法项；高亮只取 `reason === null`，其他项用于禁用原因。仅在当前城市、类型、view 发生变化时重算即可。`cityDistrictDetails` 返回已知/己方完整记录，按 cityId、tileIndex、kind 排序；`active=false` 时 total 全零。对己方城市可判断占领当轮，对他国记忆记录显示的是已知状态，不能视为实时权威信息。

```ts
type DistrictEffects = {
  food: number; production: number; gold: number; research: number;
  trainedXp: number; bondPressure: number;
};
type DistrictBreakdown = {
  base: DistrictEffects;
  adjacency: Array<{
    id: string; label: string; effect: keyof DistrictEffects;
    tileIndices: number[]; perTile: number; cap: number; value: number;
  }>;
  total: DistrictEffects;
  incomplete: boolean;
  unknownAdjacentTileIds: number[];
};
type DistrictSite = {
  cityId: number; kind: DistrictId; tileIndex: number;
  reason: string | null;
  releasesWork: boolean; releasedCityIds: number[];
  effects: DistrictBreakdown;
};
```

相邻 `tileIndices` 包括全部合格已知来源（可多于上限），`value` 是封顶后的实际增量。`releasesWork` 和 `releasedCityIds` 包括同文明其他城市，供 UI 提示“这些人口将成为观测者”。对不合法格也返回效果供说明，但不得将其发为下单命令。`incomplete` 提示“部分相邻格未知”，不要把合计当作完整权威预测。

原因码：`districts-unavailable`、`unknown-district`、`city-unavailable`、`district-tech-locked`、`unknown-tile`、`city-center`、`outside-city-territory`、`wrong-biome`、`harbor-needs-coast`、`district-tile-occupied`、`tile-improved-or-under-construction`、`rare-berry-deposit`、`contested-territory`、`district-kind-limit`、`district-city-limit`。核心命令延续 `invalid-production` 总体拒绝码，重叠领地单独返回 `contested-territory`；UI 详细原因使用查询。

```ts
const sites = districtSites(view, city.id, 'researchDistrict');
const site = sites.find(item => item.tileIndex === selectedTile);
if (site?.reason === null) {
  session.issue({
    type: 'SetProductionQueue', cityId: city.id,
    orders: [
      ...city.queue.map(order => ({ orderId: order.id, item: order.item })),
      { item: { kind: 'district', defId: site.kind, tileIndex: site.tileIndex } },
    ],
  });
}
```

追加队列还需沿用已有 5 项队列上限；取消订单也用 SetProductionQueue 并保留其余 orderId，不添加退款接口。

PlayerView 新增的可选结构（v≤9 不出现）：

```ts
view.expansion?.districts = {
  tiles: [{ cityId, kind, tileIndex, builtAtRound, ownerId, lastSeenRound }],
  projects: [{ cityId, kind, tileIndex, orderId, progress }],
};
```

`tiles` 合并己方完整记录与他国可见/记忆记录，`projects` 只含己方订单。己方记录的 lastSeenRound 是当前获知城市信息轮次，不代表该格当前可见。可见判断仍使用 `visibleTileIds`。

A1 临时浏览器兼容只改 `economy-panel.ts`：保留三个旧生产标签；显式 v10 存档的 district 队列显示名称与进度，无图像和交互。`audit.ts` 没有 district 构造入口且能通过编译，因此未改。完整 v10 选址、地图图标及取消交互留给 design。

## AI 与工具

`src/ai/district-plan.ts` 只读 PlayerView；完整实现规格 §5 的分数项，按 score 降序、cityId/tileIndex/类型升序排序。每个空队列城市仅加入最高分设施区候选，保留既有目标优先级，未调优数值。帝国同类数量依据当前己方城市记录，不把已丢失城市的旧记忆计作己方资产。

- `node tools/leader-balance.ts --expansion true --eras simple --gameplay 10 --seeds 1 --round-limit 100`。
- `node tools/simulate.ts --seeds 1 --gameplay 10`：显式玩法版本启用扩展和精简时代；不传版本保持旧入口行为。
- `node tools/district-smoke.ts 9 <目录>` / `10 <目录>`：固定种子31–34，每种子三种性格×rotation 0–3，48局；不是九领袖全轮换平衡批次。每个结果独立 JSON。v10 添加 DistrictCompleted 事件计数 `districtCompletions`，v9 不添加字段以便逐字节比较。

测试与本轮模拟结果见共享报告 `reports/coder.md`；此文不声称 UI 已完成或默认已升级。
