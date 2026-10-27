# 宝可梦 × 文明：MVP 技术架构与开发规划

版本：**v0.6（M4；BL-04 类型同步）**，阶段 1 规划已收口，当前实施 M4。
依据：冻结 GDD v0.6、任务板 D1–D33；TypeScript + Canvas；个人学习项目。
当前实施对照冻结 GDD v0.6（689 行），SHA-256 `4cc9ed3138cc259a3f00a91c4f70f9914d13b28e03ce0fae07124884f39b5204`。任务板裁定优先；下文保留的 GDD v0.4 行号均为历史快照定位，当前规则以 v0.6 及已并入的决策为准；§10.2 保留规划收口时的历史结论。
默认规模：**24×16 六角格、100 轮**（D8）；开局可选 100/200/300 轮，小/标准/大图参数以 GDD 为准。内容目标为 7 种群系、1 名玩家与 1–3 个 AI、39 种宝可梦、12 个科技节点。
MVP 包含建城与经济、野生刷新与捕捉、进化、属性克制快速战斗、战争迷雾、征服胜利与回合上限计分。
图鉴、起源、冠军胜利与信仰系统后续实现；不做深度外交与实际联机。城邦替代物的玩法由策划定义，不照搬文明城邦。

**BL-04 / D32 类型落点**：物种身份使用完整 39 种 `SpeciesId`，`StarterId` 只约束开局三选一。单位 `ownerId: number | null` 中 null 表示野生；实际状态以 `location` 区分地图单位（`position: Hex`）和休养单位（`position: null`、`cityId`、`roundsLeft`），避免把休养单位投影成地图占用。`PlayerView.units` 保持为可见地图单位，己方休养状态另放 `recoveringUnits`。`src/content/species.ts` 的 `speciesDisplay` 提供物种简称与显示信息，界面不再假设只有三种物种。schema/rules 随模型变更升级，旧档明确拒绝；导出函数名与调用方式保持稳定。以上为 D32 已批准的兼容例外，属于 §3.1 模型和 §3.4 投影的实施说明。

**v0.6 同步**：D28 的通行权/移动消耗/落点过滤、D30 的科研储备/产出快照/工作分配、D31 的雪原迷你龙与海洋权重，落点见 §3.1、§3.5、§6、§10.1。仅同步已决规则。

**v0.5 变更对照表**（R4，仅同步任务板 D16–D19）：

| 审查编号 / 决策 | 技术同步 | 落点 |
| --- | --- | --- |
| F-01、F-02 / D16 Q02-R、D17 | 待出场独立于最多5项的队列；先按进入轮数/原订单ID重试，再最多完成1项；溢出结转，新等待者下轮重试；休养按单位ID落格 | §3.1、§3.2、§3.3、§3.5、§3.6、§6、§8 |
| F-01 / D16 Q03-R | 阶段6野生造成濒死直接初始化 roundsLeft=2，保留8阶段顺序 | §3.1、§3.5、§6、§8 |
| F-03 / D19 | 历史单位快照使用宝可梦/后勤判别联合，观察与记忆清理覆盖两类 | §3.1、§3.4、§6 |
| F-01、F-04 / D16 Q09-R、D18 | 单列30轮前终局数并从滚雪球分母排除；发布批次为固定样本烟测；输出点估计/n/独立种子数/Wilson区间，按阈值追加100新种子 | §5.2、§6、§8 |
| F-01 / D16–D19 | 三项剩余边界转入已决表，剩余0项 | §10.1–§10.3 |

**v0.4 变更对照表**（R3 历史记录；表内遗留项均已由上表及 §10.1 关闭）：

| 原编号 | GDD v0.4依据 | 技术同步与结论 |
| --- | --- | --- |
| Q01 | §3.2 L164–197 | §3.1/§3.5：七群系产出、观测者、城市固有中心收益、先到先得、分配排序、人口下限/增长/占城禁结算；关闭 |
| Q02 | §3.5 L235、§3.13 L389–391 | §3.1/§3.2：队列最多5、取消/重排/溢出、待出场、逐课题进度、出生降级；R3主体已答；R4待出场生产边界已由D16/D17关闭，见§10.1 |
| Q03 | §3.5 L231–236、§3.7 L268–274 | §3.1/§3.5：行动点、休养槽/恢复落点、后勤维护/击坠、城市反击归属；R3保留同轮首扣边界；R4已由D16关闭，见§10.1 |
| Q04 | §3.6 L244–250、§3.7 L263/279、§3.8 L286 | §3.1/§6：基础概率→观察→稀有、掩体优先、免疫并集、算例B修正；关闭 |
| Q05 | §3.12 L354–383 | §3.1：区域/判定/群系/物种/位置抽样顺序、空候选不回滚、初始生成、守卫ID平局；关闭 |
| Q06 | §3.10 L330–332、§3.5 L233 | §3.4：下个行动回合回应、逾期拒绝、不可撤销、达成时冻结冷却、外交全公开、登记与科技交集；关闭 |
| Q07 | §3.14 L404–413 | §3.1/§5.1：最后已知观察、排除休养、本场战争损失、15轮扩张/6格战区、扩张不主动宣战；关闭 |
| Q08 | §3.9 L305–316 | §3.3/§3.5：控制权转移→中立化→清单位→冻结，淘汰者仅排名；关闭 |
| Q09 | §5.5 L513–525 | §5.2：100种子复用，1v1互换200局+1v3共100局、0.5并列、指标分母；R3保留提前终局口径；R4已由D16/D18关闭，见§10.1 |
| D15 | 任务板D15、GDD§5.4 L503–505 | §6：60%上限已接受，新增物种全对全复算；不再列为待批准 |

## 1. 开发系统总表

按可独立说明职责的工程模块计数，**MVP 共 24 个开发系统（S01–S24）**，另列 3 个后续系统（F01–F03）。这不是类、进程或包的数量；多个系统可以共处一个小文件。网络预留是已有接口的约束，不计作独立 MVP 系统。

| ID | 系统 | 阶段 | 职责与边界 | 主要依赖 |
| --- | --- | --- | --- | --- |
| S01 | 内容配置与加载校验 | MVP | 物种、属性、群系、科技、建筑和规则常量；检查重复 ID、悬空引用、科技层级；不存运行状态 | 无 |
| S02 | 权威状态与命令入口 | MVP | 序列化状态、命令合法性、原子执行、事件返回；唯一权威写入口 | S01、S03 |
| S03 | 确定性随机数与 ID | MVP | 固定算法 RNG、持久化游标、递增实体 ID；禁止时间与系统随机数 | 无 |
| S04 | 回合、外交与胜负调度 | MVP | 行动方轮换、轮末结算、宣战/停战、大本营失守出局、征服/计分裁决；不等待动画 | S02、S06–S10 |
| S05 | 六角格数学与寻路 | MVP | 坐标换算、邻接、距离、移动代价与路径；不读相机 | S01 |
| S06 | 地图与野生生态 | MVP | 种子地图生成、群系、合法出生点、刷新和实体上限 | S01、S03、S05 |
| S07 | 城市、人口与经济 | MVP | 建城条件、领地/地块产出、人口、建筑与生产结算；不承担 UI | S01、S02、S05 |
| S08 | 单位与战斗 | MVP | 宝可梦/后勤移动、攻城、捕捉、经验进化、濒死休养；演出只输出事件 | S01–S03、S05 |
| S09 | 研究与解锁 | MVP | 科技进度、前置条件和能力查询；具体数值来自配置 | S01、S02、S07 |
| S10 | 视野与玩家观察 | MVP | 可见/已探索地块、历史地形记忆、玩家视角投影；不泄露敌方隐藏状态 | S02、S05 |
| S11 | AI 决策 | MVP | 在玩家观察上选择合法命令；固定搜索预算和稳定平局排序 | S05、S10、命令规则查询 |
| S12 | 本地应用调度 | MVP | 接收玩家/AI 意图，调用模拟入口，维护日志与表现队列 | S02、S04、S11、S18 |
| S13 | Canvas 场景与相机 | MVP | 画布、DPR、视口、平移缩放、地块及精灵图层 | S10、S15、S16 |
| S14 | 输入与选择 | MVP | 点击、拖拽、键盘、屏幕到格子命中、命令意图；不直接改游戏状态 | S05、S13、S17 |
| S15 | 资源加载 | MVP | 本地图片清单、加载缓存、失败占位图；加载结果不参与规则 | S01 的资源 ID |
| S16 | 动画与特效队列 | MVP | 消费可见事件、插值、快进/跳过；只维护表现状态 | S02 的事件类型、S15 |
| S17 | DOM UI | MVP | 城市面板、科技、命令栏、回合/胜负/存档界面；所有操作转成命令 | S10、S12 |
| S18 | 存读档与版本 | MVP | 存档封套、结构校验、显式版本迁移、JSON 导入导出 | S01、S02、S03 |
| S19 | 种子、日志与回放 | MVP | 初始配置、命令序列、规范化状态摘要、首个分歧定位 | S02、S03、S18 |
| S20 | 调试面板与诊断 | MVP | 状态检查、格子/视野/刷新覆盖层、显式作弊命令 | S10、S12、S19 |
| S21 | 规则与确定性测试设施 | MVP | 单元、回放、稳定序列化快照、小地图测试夹具 | S01–S11、S19 |
| S22 | 浏览器冒烟与端到端验证 | MVP | Canvas/DOM 启动、输入、存档及短局闭环测试 | S12–S18 |
| S23 | 无头平衡批量模拟 | MVP | AI 对 AI、固定种子组、多局统计和异常种子导出 | S01–S11、S19 |
| S24 | 开发构建与静态检查 | MVP | TS 类型、Vite 开发/构建、轻量 lint、统一验证入口 | 工程文件 |
| F01 | 联机传输与权威服务器 | 后续 | 身份认证、服务端验令、玩家视角同步、断线恢复 | S02、S10、S12、S19 |
| F02 | 高级资源与性能工具 | 后续 | 图集生成、离屏地图缓存、Worker 批量模拟；有测量需求再做 | S13、S15、S23 |
| F03 | 可视化内容编辑器/模组 | 后续 | 专用编辑器、插件沙箱、内容热重载协议 | S01、S18 |

表内依赖包含数据类型依赖：S02 的状态/命令/事件类型放在基础 `model.ts`，规则系统只依赖这些类型，不导入 `step.ts`；由 `step.ts` 单向调用具体规则。S12 把事件推入表现队列，S16 不反向导入应用调度，避免循环。

游戏机制与上述工程系统不是一一对应：GDD 的 17 个 MVP 策划系统映射为这里的 24 个工程系统，基础外交由 S04/S17 承担。GDD §4 的霸主领地、巢穴、供奉不在 MVP；§3.9 的出局遗留中立营地则是 MVP 无主 CityState，不等同于城邦，不加独立 AI/经济。

## 2. 架构分层与依赖方向

下图箭头表示“导入/调用”，不是运行时事件传播方向。

```text
浏览器适配层                         无头工具适配层
Canvas / DOM / 输入 / 图片 / 存储     批量模拟 CLI / 回放 CLI
              |                               |
              v                               v
     应用层：GameSession / 命令调度 / 日志 / 保存协调
              |                 |
              v                 v
          AI 决策 -------> 核心公开查询接口
              |                 |
              +--------+--------+
                       v
       核心：step / 回合 / 城市 / 战斗 / 科技 / 视野
                       |
                       v
       基础：类型 / 六角格 / 整数运算 / RNG / 内容定义

       测试和工具可调用上述公开接口；核心不导入它们
```

- `core/` 不导入 DOM、Canvas、浏览器存储、网络、Node 文件系统、渲染、AI 或工具。核心运行不需要图片，也不读时钟。
- AI 只能从观察与规则查询选择命令，不能写 `GameState`，核心不反向调用 AI。应用层负责轮到 AI 时取命令并提交。
- 渲染与 UI 消费 `PlayerView` 和已过滤事件；不得拿到可变权威状态。调试观察器是开发模式下显式的独立入口。
- 配置只提供数据和类型，不包含回调、DOM 对象或运行时导入。最初通过静态 TS 对象与 `satisfies` 保持类型，暂不引入 schema 生成框架。
- 核心使用同步函数，应用层调用可以异步包装。禁止循环依赖；规则之间通过同一次结算上下文交换数据，不搭事件总线驱动权威规则。

高风险接口必须先写清约定：

| 接口 | 约定 | 错误的影响 |
| --- | --- | --- |
| `step(state, command, content)` | 同步、原子；成功返回新状态与事件，失败返回原因且不消费 RNG/ID/序号 | 非法输入污染存档或回放 |
| `observe(state, playerId)` | 返回只含已知信息的值对象；敌方隐藏单位、隐藏经济与 RNG 不可见 | UI 与 AI 穿透迷雾 |
| `projectEvents(before, after, events, playerId)` | 按行动前后视野裁剪事件，只暴露玩家可见片段；不能只按结束时可见性过滤 | 移动/攻击事件泄露隐藏路径 |
| `planNext(view, query)` | 相同观察得相同命令；固定候选数预算；无合法动作时结束行动 | AI 卡死或运行速度改变结果 |
| `save/load` | 保存权威状态与版本；加载后重建视野缓存，清空动画；不把图片/UI 对象入档 | 读档后规则或视觉错乱 |
| `resolveRoundEnd` | 固定顺序、每个阶段恰好一次，最后判定计分并开启下一轮 | 收益重复、胜负错位 |

MVP 推荐 `step` 先验证命令，再复制小规模状态并在副本上同步执行；只有执行完成才替换会话状态。默认 384 格的规模优先保证可理解的原子语义，性能出现证据后再优化局部复制。

## 3. 核心数据模型与确定性

### 3.1 MVP 状态和内容定义

以下为文档类型草图，不是工程代码。字段只承载已经存在的 MVP 行为；所有规则值来自对应 GDD 章节，不用零值或未来版本空结构占位。本轮边界裁定见 §10.1；球购买与消费已经固定为库存流程，不再保留直接付费捕捉分支。

```ts
type EntityId = number;
type PlayerId = number;
type DefId = string;
type TileId = number; // 行优先的固定索引，轴向坐标通过 hex 模块换算
type Hex = { q: number; r: number };
type Personality = 'expansion' | 'military' | 'conservative';
type StarterId = 'bulbasaur' | 'charmander' | 'squirtle';
type GameSetup = {
  seed: number; width: number; height: number; roundLimit: 100 | 200 | 300;
  players: { id: PlayerId; controller: 'human' | 'ai';
             starterId?: StarterId; personality?: Personality }[];
}; // 默认 width=24, height=16, roundLimit=100；人类指定starterId；AI省略并由种子RNG抽取，结果写入玩家状态/回放基准

type GameState = {
  schemaVersion: number; rulesVersion: string; contentVersion: string;
  setup: GameSetup; rng: { algorithm: 'xorshift32-v1'; value: number };
  nextEntityId: number; commandSeq: number; debugModified: boolean;
  round: number; activePlayerId: PlayerId; turnOrder: PlayerId[];
  phase: 'playing' | 'finished';
  map: { width: number; height: number; tiles: TileState[] };
  players: Record<PlayerId, PlayerState>;
  cities: Record<EntityId, CityState>; units: Record<EntityId, UnitState>;
  diplomacy: DiplomacyState[]; // 每对玩家仅一条；a < b，按 (a,b) 排序
  knowledge: Record<PlayerId, KnowledgeState>;
  outcome: null | { kind: 'conquest' | 'score'; winners: PlayerId[];
                    scores?: Record<PlayerId, number> }
                | { kind: 'playerDefeat'; defeatedPlayerId: PlayerId };
};
type PlayerState = {
  id: PlayerId; eliminated: boolean; starterId: StarterId;
  headquartersCityId: EntityId; // 初始城市 ID，城市易主后不重绑
  gold: number; ballInventory: Record<DefId, number>;
  registeredSpeciesIds: DefId[]; // 获得时登记，去重/稳定排序，不因移除丢失
  frozenScore: ScoreBreakdown | null; // 出局时冻结，仍参与终局排名
  research: { techId: DefId | null; progressByTech: Record<DefId, number>;
    unlockedIds: DefId[]; reserve: number }; // D30：储备科研初始0，切换课题不丢进度
  stats: { knockdownCount: number };
  lastSettlerProducedRound: number | null; // AI每15轮至多生产1开拓队的实际记录
};
type ScoreBreakdown = { cities: number; population: number; species: number;
  techs: number; knockdowns: number; total: number };
type DiplomacyState = {
  a: PlayerId; b: PlayerId; status: 'peace' | 'war'; changedAtRound: number;
  peaceCooldownUntilRound: number | null; // 达成时固定，之后科技变化不重算
  citiesLostSinceWar: Record<PlayerId, number>; // 该对文明开战时双方清零
  lastRejectedProposalRound: Partial<Record<PlayerId, number>>;
  pendingProposal: null | { proposerId: PlayerId; offeredAtRound: number };
};
type CityState = {
  id: EntityId; ownerId: PlayerId | null; position: Hex; hp: number; // null=中立营地
  population: number; food: number; buildingIds: DefId[];
  queue: ProductionOrder[]; // 最多5项，数组顺序即建造顺序
  pendingDeployments: PendingDeployment[]; // 独立待出场区，不占队列名额
  workedTileIds: TileId[]; lockedTileIds: TileId[];
  capturedAtRound: number | null; // 占城当轮不产出，下一轮末才结算
};
type ProductionOrder = {
  id: EntityId; progress: number; // 重排跟随订单，不与CityState共用一份进度
  item: { kind: 'building'; defId: DefId }
      | { kind: 'pokemon'; defId: DefId }
      | { kind: 'logistics'; defId: 'settler' };
};
type PendingDeployment = {
  enteredAtRound: number; sourceOrderId: EntityId;
  item: { kind: 'pokemon'; defId: DefId }
      | { kind: 'logistics'; defId: 'settler' };
}; // 已完成的单位订单，无progress/status或单位ID；按(enteredAtRound,sourceOrderId)重试
type PokemonUnit = {
  kind: 'pokemon'; id: EntityId; speciesId: DefId; ownerId: PlayerId | null;
  hp: number; xp: number; actionLeft: 0 | 1;
  location: { kind: 'map'; position: Hex }
          | { kind: 'recovering'; cityId: EntityId; roundsLeft: number }; // 0且未落格=恢复待出场
  enraged: boolean; // 下次攻击消耗，无按轮到期规则
  wildHome: Hex | null; // 野生守卫活动中心，不是 v2 巢穴
};
type LogisticsUnit = {
  kind: 'logistics'; id: EntityId; ownerId: PlayerId;
  role: 'settler'; hp: number; position: Hex; actionLeft: 0 | 1; // 初始HP30，无反击
};
type UnitState = PokemonUnit | LogisticsUnit;
type TileState = { position: Hex; biomeId: DefId; ownerId: PlayerId | null };
type LastKnownUnit =
  | { kind: 'pokemon'; speciesId: DefId; ownerId: PlayerId | null;
      position: Hex; lastSeenRound: number }
  | { kind: 'logistics'; role: 'settler'; ownerId: PlayerId;
      position: Hex; lastSeenRound: number };
type KnowledgeState = { exploredTileIds: TileId[];
  rememberedTiles: Record<TileId, { biomeId: DefId }>;
  lastKnownUnits: Record<EntityId, LastKnownUnit>;
  lastKnownCities: Record<EntityId, { ownerId: PlayerId | null; position: Hex;
    lastSeenRound: number }>;
}; // 仅保存曾观察到的信息，给AI估计，不读取隐藏实时状态

type SpeciesDef = {
  id: DefId; typeId: DefId; stage: 1 | 2 | 3; // 基础/一阶/二阶，MVP 单主属性
  maxHp: number; attack: number; defense: number; power: number;
  move: number; range: number; vision: number; spriteId: string;
  role: 'melee' | 'ranged' | 'fast' | 'siege' | 'scout' | 'naval' | 'air';
  movement: 'land' | 'water' | 'flying' | 'ghost';
  immunities: DefId[]; // 电免疫等；不写物种名特判
  rare: boolean; spawnBiomes: DefId[]; // 空数组为不刷新，权重在Content.spawnTables
  behavior: 'wander' | 'guard' | null; trainCost: number; upkeep: number;
  evolutions: { into: DefId; minXp: number; goldCost: number;
                requiredTechId?: DefId }[];
};
type Yield = { food: number; production: number; gold: number; research: number };
type BuildingDef = { id: DefId; cost: number | null; yieldBonus: Yield;
  trainedXpBonus: number }; // 大本营cost=null不可建；牧场只有+2食物
type TechDef = { id: DefId; tier: 1 | 2 | 3; cost: number;
  effectIds: DefId[] }; // 升层需上层任一科技；同层无互相前置

type Content = {
  version: string; species: Record<DefId, SpeciesDef>;
  spawnTables: Record<DefId, { speciesId: DefId; weight: number }[]>;
  typeChart: Record<DefId, Record<DefId, number>>; // 千分倍率
  biomes: Record<DefId, { yield: Yield; moveCost: number;
    workRequiresTechId?: DefId }>;
  techs: Record<DefId, TechDef>; buildings: Record<DefId, BuildingDef>;
  balls: Record<DefId, { goldCost: number; captureMultiplier: number;
    requiredTechId: DefId }>;
  starters: Record<StarterId, { speciesId: DefId;
    bonus: { effectId: DefId; bonusPermille: number } }>;
};
```

`createGame` 按GDD §3.13初始化：1城含大本营、人口2、金币50、食物10、空队列/生产0、各科技进度0、无球；御三家和开拓队经验0。出生城市草原/森林、距边缘≥2，文明间距从≥8失败后降至≥6、再≥4，仍无解则拒绝该种子/参数组合。人类选择御三家，AI由种子RNG抽取；御三家先过滤不可进入地形，从相邻格开始逐圈搜索最近空格，按索引破平、不限相邻6格；开拓队在城格（D28）。新城按§3.2人口1/食物0/空队列/HP100，无大本营建筑。研究进度存progressByTech，切换只改当前techId。

D28 通行与消耗分开：海洋消耗1、火山2；水系/飞行可进入海洋，火系/飞行可进入火山，飞行仍支付群系消耗。海军物种仅海洋，其他水系两栖但不能进入火山；龙系不额外取得海洋通行权（D31）。己方城市可进入/穿过/停留，仍不堆叠；他方城市阻挡移动，占领通过攻击完成。所有最近空格先过滤通行权；生产与休养仍只查相邻6格，没有合法空格就等待。

内容仍以§5.2为唯一物种数值来源：P10、rare布尔、immunities、训练成本floor((HP+A+D)/8)、三阶段预算150–170/210–240/280–320；进化100/250xp与30/80金，二阶需特训法。可训练集合为registeredSpeciesIds与科技门槛的交集，初始集合包含所选御三家基础形态；高速系另需骑行驯服。御三家加成分别为每城食物×1100/1000、经验×1150/1000、城市反击A=floor(30×1150/1000)=34，玩家只存选择ID。科技成本20/40/70；野外观察+10百分点；联盟规章终局总分×1200/1000且影响停战达成时冷却。

D30 轮末先冻结所有城市的四类产出，阶段1–4共用快照；新人口/建筑/分配从下一轮产出。维护按阶段3实际单位计算，阶段2新部署当轮付费。科研：有课题时进度加储备和本轮产出、储备清零；无课题时产出入储备。完成进度封顶、解锁并清空课题，溢出进入储备；每文明每轮最多完成1项。

经济采用§3.2七群系产出表：草原(2,1,0,0)、森林(1,2,0,0)、山地(0,2,0,1)、海洋(2,0,1,0)、荒漠(0,1,1,0)、雪原(1,0,0,1)、火山(0,2,0,2)，顺序为食物/生产/金币/科研。所有城市中心格固有(2,1,1,0)，不占工作人口，大本营不再提供收益。未分配人口每个1科研。城市最大HP=100+20×非大本营建筑；每人口耗粮2，增长阈值20+10n且每轮最多增长1，饥荒人口下限1；占城当轮完全不结算，包括不耗粮。

工作地块先到先得，已有他城占用的不参与分配；候选按(食物,生产,金币,科研)字典序降序，同值按(r,q)升序。城市易主释放工作格/锁定，锁定格超半径也解除。已分配关系保存在各城workedTileIds，重算时先保留有效既有分配，再处理待分配城市，避免覆盖先到先得结果。D30 自动分配仅用于开局/建城填满、增长分配新增1人、占领重新分配；手动少分配与失效工作格留下的观测者不自动补位。饥荒先释放排序最差的未锁定格，无未锁定格才释放最差锁定格。

队列最多5，订单有稳定ID与独立progress：取消首项作废其进度不退款，重排与取消非首项不丢其他订单进度。按D16/D17，阶段2每城先按(enteredAtRound升序,sourceOrderId升序)逐个重试独立的pendingDeployments，每个取城市相邻最近空格，同距取格子索引小者；有几个空格就可出几个，不设出场数量上限。再推进队列，每城每轮最多完成1项订单；完成项离队，溢出全额给下一项，即使足够也不能同轮再完成，队列空则丢弃溢出。新完成单位若无空格，记录进入轮数/原订单ID并排到待出场区队尾，下一轮才重试，不占5项名额、不阻塞后续生产。出场前不生成单位ID、不计单位数/维护/行动；队列调整命令不操作已离队的待出场记录。

宝可梦归零进入目标城休养槽，HP1，行动阶段初始化roundsLeft=3，不占格、不阻挡、不参与战斗；不能行动，维护照付，可被赤字解散。每轮末含进入当轮扣1，归零恢复floor(maxHP×250/1000)后取该城相邻最近空格、索引破平；无空格继续留槽、roundsLeft保持0并每轮末重试，不能重复扣成负数或反复加25%HP。恢复成功后按阶段5执行领地回血。宿主城失守移除；阶段6野生导致新休养时直接初始化roundsLeft=2，等价于提前计入当轮扣减（D16），不追加阶段。阶段5多个单位解除休养或等待落格时按单位实体ID升序落格（D17）。后勤只有开拓队，HP30、维护0、无反击；按GDD相邻交战攻击消灭的例外处理，不进入宝可梦休养。

行动点为0或1，移动/攻击/捕捉/进化任一成功即耗1；新训练/新捕捉/进化完成者当回合0，下一回合正常。激怒enraged在下次攻击伤害×1200/1000后清除，无按轮过期。球先在己方城购买20/45金入库存，捕捉只扣一枚库存。概率严格分两次floor：基础=floor((maxHP-HP)×60×球倍率/(maxHP×1000))；p=floor((基础+观察加成)×稀有修正/1000)，观察0或10、稀有修正1000或500。卡比兽HP20/130配超级球和观察：floor((76+10)×500/1000)=43%。伤害先判字段免疫或E0，再判地形：防方森林/山地T80优先，其次山地居高临下T120，否则T100。

野生刷新按§3.12五步组织：①区域升序与数量检查；②不足2才roll[0,99]<5；③按区域各群系地块数做群系轮盘；④按选中群系做物种轮盘（rare权重floor(weight×250/1000)）；⑤收集位置并抽下标。位置同时满足选中群系、spawnBiomes、物种可进入、无单位/城市、距初始出生点≥3，按(r,q)排序。空候选放弃且不回滚已消耗RNG，不消耗位置随机数；满区不耗任何RNG，判定失败不继续抽样。初始每区尝试两次③–⑤，跳过概率判定，允许不足2。区域计数按当前位置，全局上限2×区域数；初始出生点由headquartersCityId对应原城坐标取得。

D31 迷你龙只在雪原刷新；海洋删除其原始权重10，不重新分配。海洋稀有折减后权重为鲤鱼王55、杰尼龟25、乘龙2，总82；位置候选继续校验物种通行权。

游荡候选为空就不动且不取RNG；否则抽合法邻格，不进入城市工作半径。守卫多目标取最小实体ID、无目标不动；守卫中心wildHome是刷新点而非巢穴。RNG中群系/物种候选按定义ID稳定排序，避免对象插入顺序改变轮盘结果。

### 3.2 命令和原子合法性

所有运行中命令使用同一封套；创建新局、加载和保存是应用操作，不能混作回合中的规则命令。队列/工作调整用完整目标列表表达，足以支持增删重排，无须为每个按钮另建事件总线。

```ts
type Target = { kind: 'unit' | 'city'; id: EntityId };
type Command = { actorId: PlayerId; expectedSeq: number; action:
  | { type: 'Move'; unitId: EntityId; to: Hex }
  | { type: 'Attack'; unitId: EntityId; target: Target }
  | { type: 'Capture'; unitId: EntityId; targetUnitId: EntityId; ballId: DefId }
  | { type: 'BuyBall'; cityId: EntityId; ballId: DefId; quantity: number }
  | { type: 'FoundCity'; unitId: EntityId }
  | { type: 'SetProductionQueue'; cityId: EntityId; orders: { orderId?: EntityId; item: ProductionOrder['item'] }[] }
  | { type: 'AssignWork'; cityId: EntityId; workedTileIds: TileId[];
      lockedTileIds: TileId[] }
  | { type: 'SetResearch'; techId: DefId }
  | { type: 'Evolve'; unitId: EntityId; intoSpeciesId: DefId }
  | { type: 'DeclareWar'; targetPlayerId: PlayerId }
  | { type: 'MakePeace'; targetPlayerId: PlayerId } // 提议，不等于已停战
  | { type: 'RespondPeace'; targetPlayerId: PlayerId; accept: boolean }
  | { type: 'EndTurn' }
};
```

共同校验activePlayer、未结束/未出局、expectedSeq、所有权、目标可见性及行动点；RespondPeace也必须在接收者自己的行动回合，不能由非行动方插入。单位四种行动成功后actionLeft=0，失败不扣点。SetProductionQueue校验最多5项，命令只提交已有orderId的排列及新增item，不允许客户端传progress或待出场状态；核心按取消/重排/新增规则保留或作废进度。AssignWork校验工作容量、半径、可工作科技和跨城独占。

Capture只允许非休养宝可梦针对相邻野生、合法科技/球且库存≥1，不能捕文明单位。BuyBall校验己方城、科技、正整数数量、足额金币，原子扣金币加库存；捕捉不再次扣金。Attack显式区分单位/城市，文明目标需战争，中立营地无需宣战且不反击。FoundCity只允许己方开拓队、合法非水格及距现有城≥4，成功消耗开拓队。训练/研究/进化共用内容查询，UI/AI不另写规则。

### 3.3 事件与统计的最小集合

事件封套草图为 `type GameEvent = { seq: number; index: number; payload: EventPayload }`；`EventPayload` 是下表各事件的带 `type` 判别字段联合。下表是当前 MVP 需求的完整语义枚举，表中一行的每个名字是独立联合分支，避免只定义捕捉成功而遗漏失败。缺规则若引入新行为，应同步更新该表；不因表格完整而声称未决玩法已闭合。读档/UI 点击/未来图鉴记录不伪造游戏事件。

| 事件名 | 必需 payload / 触发点 |
| --- | --- |
| GameCreated | setup、规则/内容版本；建立回放基准 |
| Moved | unitId、逐格 path、移动原因 player/wild；可见投影只保留授权片段 |
| AttackResolved | source（unit 或 city）、target、是否 counter、A/D/P/E/T/R、damage、hpBefore/hpAfter；一次攻击与反击各一条 |
| UnitKnockedDown | source、creditedPlayerId 或 null、targetUnitId、targetOwnerId 或 null、目标kind、speciesId/stage（后勤为null）、是否反击；后勤击坠不给额外经验 |
| UnitWithdrawn | unitId、from、cityId、hp=1、休养轮数；D7 |
| RecoveryProgressed / UnitRecovered | unitId、cityId、剩余轮数 / 恢复HP、落点；0轮仍堵格则继续留槽 |
| UnitRemoved | unitId、ownerId、reason=wildKnockdown/settlerDefeated/deficitDisbanded/recoveryCityCaptured/eliminated；普通文明战斗不走死亡移除 |
| CaptureAttempted / CaptureSucceeded / CaptureFailed | actor、unitId、targetUnitId、ballId、库存前后、p、roll；成功附新owner，失败附enraged变化 |
| BallsPurchased | playerId、cityId、ballId、quantity、gold前后、库存前后；BuyBall成功 |
| AngerChanged | unitId、before/after、reason=failedCapture/consumed |
| SpeciesRegistered | playerId、speciesId、source=initial/trained/captured/evolved；新增历史登记时 |
| ExperienceChanged / UnitEvolved | unitId、经验增减及原因 / 原物种、新物种、金币成本、HP 前后 |
| CityFounded / CityCaptured | cityId、建城者及消耗开拓队 / oldOwner、newOwner、captureRound、HP |
| HeadquartersLost / PlayerEliminated | playerId、headquartersCityId、占领方；冻结ScoreBreakdown与清理原因 |
| CityNeutralized | cityId、oldOwner、HP=50；原文明出局，ownerId=null |
| WarDeclared / PeaceProposed / PeaceRejected / PeaceMade | 双方playerId、proposerId、round、响应结果；只有PeaceMade改变关系为和平 |
| ProductionQueueChanged / WorkAssigned | cityId、核心计算后的订单列表（含进度）或工作/锁定集合 |
| ResearchSelected / ResearchCompleted | playerId、techId、progress 或完成 round |
| CityYieldSettled / PopulationGrown / PopulationStarved | cityId、四项产出、食物/生产前后值 / 人口前后及增长或饥荒原因 |
| BuildingCompleted / ProductionWaiting / UnitTrained | cityId、orderId、definitionId、消费/溢出进度；等待事件附enteredAtRound/sourceOrderId，无unitId；实际出场才附新单位ID/位置/XP与actionLeft=0 |
| GoldSettled | playerId、income、upkeep、解散返计维护、gold前后；临时负数只在结算事务内部 |
| UnitHealed | unitId、amount、hpAfter、来源，不能复用为伤害 |
| WildSpawned | unitId、speciesId、区域/出生格；数量/权重来自 GDD |
| TurnChanged / RoundEnded / GameEnded | 行动方与 round / 已完成轮数 / outcome 含多胜者 |

计分读取权威结果，表现事件按视角投影。registeredSpeciesIds包含所选初始形态与训练/捕捉/进化获得的物种，移除不删；knockdownCount包含野生击倒、敌方宝可梦濒死及消灭后勤，含反击，不含解散/失守清理。后勤被消灭不给额外击坠经验，但攻击造成非零伤害的10经验仍有；城市反击的击坠归城市所属文明，任何单位不获经验（GDD§3.7）。不能用移除事件总数代替击坠。

淘汰事务先转移大本营控制权，再中立化余城、清除单位，最后生成frozenScore，此时城市/人口计分为0；该快照只用于排名，不参加轮上限胜者选取，也不再乘第二次科技倍率。城市占领同时更新本场战争的citiesLostSinceWar，用于停战接受条件。

`GameEvent` 是表现和统计摘要，命令日志才是回放输入；不是完整事件溯源。野生刷新、轮末结算及濒死等内部变化属于已接受命令的同一确定性事务，用 `(seq,index)` 保证顺序。非法命令不产生规则事件、不扣球/金币、不消耗 RNG/ID。

### 3.4 外交状态机与观察

开局全部和平、peaceCooldownUntilRound=null。DeclareWar要求actor当前行动方、双方存活/非自身、关系peace、冷却已过，无金币/科技门槛；进入war时changedAtRound=round并将该关系双方citiesLostSinceWar清零。和平可进对方领地但不可进城市格，不可攻击文明单位/城市；中立营地可免宣战攻击。

MakePeace在提出方行动回合，战争持续≥5轮、距上次对该文明提议被拒≥5轮且无待回应提议时生效；只创建pendingProposal，不改变战争关系且不可撤销。对方在**下一个自己的行动回合**必须RespondPeace：AI按性格立即回应，人类显示强制选择；未处理就EndTurn按逾期拒绝落日志，禁止非行动方即时插入回应。EndTurn的逾期检查使用当前接收者的所有pendingProposal，不依赖墙上时钟；拒绝记录提议者与round，之后5轮不得重提。

接受时检查双方当下科技：任一方有联盟规章则冷却5，否则10，将peaceCooldownUntilRound固定为当前round+时长；之后科技变化不重算。关系变peace并清提议；拒绝保持war并清提议。扩张/好战在本场战争已损失≥1城时接受，保守总接受合法提议。公开关系不意味着公开兵力/金币。

GDD§3.10规定所有文明两两的战争/和平关系全员公开；PlayerView投影全部关系状态。提议/库存/研究细节仍按参与者/所有者显示，不披露无授权内部状态。对隐藏单位和城市只返回本玩家曾观察到的快照，用于GDD§3.14的“最后已知”估计；不得用权威实时值更新历史观察。历史单位快照保留kind判别字段：宝可梦携speciesId，后勤携role=settler，两者都保存ownerId/position/lastSeenRound；不伪造speciesId，也不另加开拓队特判（D19）。重新看见原格为空或实体被已观察事件移除时，两类都清理相应记忆，渲染迷雾外不画动态敌方单位。

### 3.5 回合、濒死、经济与胜负

一轮内每存活文明各有一个行动回合，轮末仍为GDD§3.11固定8阶段：

| 阶段 | 固定ID | 对应GDD行号 | 结算规则 |
| --- | --- | --- | --- |
| 1 | cityFood | 339 | 食物收支/增长/饥荒；每轮最多+1、最低1；中立及当轮被占城完全不结算 |
| 2 | production | 340 + D16/D17 | 每城先按(进入轮数,原订单ID)升序重试待出场，相邻最近空格/索引破平，出场数不限；再推进队列，每城最多完成1项，离队并结转溢出；新待出场者下轮重试 |
| 3 | goldAndUpkeep | 341 | 收入减维护，负数按维护降序、同维护ID降序解散并加回维护；开拓队0 |
| 4 | research | 342（历史）；D30 | 快照科研与reserve计入课题；无课题则存reserve；每文明至多完成1项，封顶并结转溢出，切换不丢进度 |
| 5 | unitStatus | 343 + D17 | 休养计数/25%恢复/落点重试；多个恢复者按单位实体ID升序取相邻最近空格、索引破平；然后领地内非休养单位+5/+10回血 |
| 6 | wild | 344 + D16 | 五步刷新协议与野生行动；野生攻击造成濒死直接初始化roundsLeft=2；不进入turnOrder |
| 7 | vision | 345 | 更新当前可见集合和已观察记忆 |
| 8 | roundLimit | 346 | 到上限则计分，否则下一轮并刷新行动点 |

城市与单位按ID稳定顺序，城内待出场按D17的(进入轮数,原订单ID)顺序，工作分配不覆盖已占用地块。独立待出场记录不是单位，不参与维护与兵力；休养槽内单位仍收费、可被解散；开拓队维护0不会缓解赤字。解散不返训练成本、不濒死、不计击坠。金币提交状态不为负。

伤害原子链内，文明宝可梦HP0后记录击坠，撤到六角距离最近己方城、同距最小cityId，不取RNG，HP1，行动阶段休养初值3，不占地图格；不能因濒死后HP1就继续触发该次战斗反击。GDD要求进入当轮末也扣计数；行动阶段进入者阶段5执行3→2。若在阶段6被野生击倒，按D16初始化roundsLeft=2，相当于当轮扣减已提前计入；该轮不再扣一次，下一轮阶段5才执行2→1，8个阶段顺序不变。归零恢复HP后无空格继续留槽等待；宿主城失守直接清理。

大本营失守事务按GDD§3.9：①初始大本营控制权转移；②余城ownerId=null/HP50，不产出/增长/反击；③原文明所有单位含休养移除；④冻结计分（城市数与人口为0），只用于排名。后续占领中立营地按普通占城规则，当轮不结算。只剩一文明立刻征服，无需再占无主营地；人类失守outcome.kind=playerDefeat，全AI局继续至全局终局。

第8阶段默认第100轮在存活文明中计算 `100*城市+10*人口+5*历史物种+20*科技+2*击坠`，联盟规章总和后×1200/1000取整。平分城市→人口→科技→击坠，仍同则并列；已淘汰者只列frozenScore排名，不可获胜。已经结束的征服/人类失败不再被计分覆盖。

### 3.6 确定性约束

1. **RNG**：固定 xorshift32-v1，左 13/无符号右 17/左 5，最后 `>>> 0`；零种子映射 `0x6d2b79f5`。保存当前 RNG 状态，用整数拒绝采样得到指定区间。地图、战斗、捕捉、野生仅从显式 RNG 取样；休养目的城市和平局排序不用随机。
2. **顺序**：玩家按 turnOrder；城市/单位数值 ID；格子 r 后 q；定义 ID 按 ASCII；外交按玩家对升序；邻居六方向固定。队列顺序显式保存；待出场显式按(进入轮数,原订单ID)升序，覆盖通用实体ID排序；阶段5恢复落格仍按单位实体ID升序（D17）。禁止 localeCompare/对象插入顺序/异步完成顺序决定规则。
3. **整数**：HP/经验/产出/概率整数；倍率存千分比。GDD E=200/T=100/R=85 对应 2000/1000/850，伤害分母相应为 `D * 1_000_000_000`；伤害按公式一次floor（免疫先返回0，反击R固定）；捕捉按GDD§3.6明确的两次floor，不能用附录通则合并取整步骤。中间值不得超过 MAX_SAFE_INTEGER。禁止核心时钟、Math.random、浮点插值。
4. **输入**：记录 setup、规则/内容/schema 版本、基准档、所有接受的命令（含 AI 与 debug）。AI 平局稳定，预算按候选数而不是毫秒；回放直接用已记录命令，不再调用 AI。表现时钟与相机不参与规则。
5. **校验**：规范化 JSON 排序键与集合（队列等有序数组不得重排），逐命令比较状态；存读后继续、快进和无动画结果一致；Node/Chromium 共用小局夹具。日志摘要定位分歧，不当安全签名。规则/内容版本不同不承诺同一回放。

可见性遵循 §2 投影接口：规划只读已知地形，实际移动逐格校验；隐藏阻挡停在最后合法格，不通过错误文案或事件泄露隐藏实体。当前视野/路径是派生值；记忆地形、最后已观察实体快照、休养状态入档。快照不随隐藏实体移动而更新，也不直接渲染为动态敌军。

## 4. 渲染与交互方案

推荐 Canvas2D 绘制地图，原生 DOM/CSS 实现文字密集面板。六角格用尖顶轴向坐标，生成时用矩形偏移坐标转轴向以得到默认 24×16 的边界；规则始终用同一轴向表示。`hexToWorld` 和 `worldToHex` 是纯函数，屏幕点先应用相机逆变换再 cube-round，边缘命中制定固定平局规则并测试。

从底至顶绘制：群系底色/地形 → 领地边界 → 城市与地图设施 → 单位 → 可见范围内的移动/攻击提示 → 迷雾遮罩 → 选择圈/允许显示的特效。未探索格完全遮挡，已探索但不可见格只画记忆地形；不先画隐藏单位再依赖半透明遮罩“遮住”。提示和特效也按玩家观察过滤。

**MVP 使用一个地图 Canvas，活动时全帧重绘；静止时只在状态、相机或 UI 选择变化后请求一帧。** 每帧只画视口内格子，图片通过浏览器缓存复用。默认 384 格先用可读方案；暂不做脏矩形、离屏瓦片缓存、Worker 或 WebGL。设置 CSS 大小与 DPR 对应的缓冲区尺寸，DPR 可封顶 2；窗口 resize 重新计算。单独 DOM 面板不随 Canvas 帧循环重建。

动画流程：`step` 完成权威状态 → 应用层取得已过滤事件及所需前态表现片段 → 队列播放移动/受击/捕捉 → 渲染最终状态。表现片段只包含该玩家可见信息。动画使用独立 `presentationTime` 和临时位置/血量；不能把中间帧写回状态。动画未结束时本地输入仅允许相机/快进，避免用户对过渡画面下达含糊命令；AI 批量运行直接跳过队列。读档、重开或切换观察者会清空队列并立即展示当前权威状态。

演出先限于位置插值、闪烁、数字和捕捉图标，资源未就绪画带物种简称的色块。缺图不阻止规则结算。开发时测量目标场景（默认 384 格及标准图 600 格，约 100 个可见单位）下帧耗时；记录设备、浏览器与 DPR 后再讨论 16.7ms 帧预算，当前文档不作性能通过承诺。

## 5. 调试与工具

- **调试面板**：显示 seed、round、activePlayer、commandSeq、RNG 状态、版本、最近命令及拒绝原因、动画队列长度、帧耗时。开发者可显式切换玩家视角或上帝视角，不能影响正常 AI 输入。
- **状态检查器**：点格子查看坐标、群系、产出、占用、所属、可见方；选单位/城市查看规则字段及派生计算明细。仅展示只读 JSON，不提供任意字段编辑器。
- **回放**：导出初始配置/基准档 + 命令 JSON；逐命令执行并定位首个状态差异。先提供重头回放与“停在序号 N”，暂不做逆向时间轴或每步全量存档。
- **作弊指令**：开发模式独立 `DebugCommand` 支持加资源、生成单位、解锁科技和揭图；仍经原子入口与日志。对局标记 `debugModified`，平衡结果排除这类局。正常游戏命令类型不混入通用 `setState`。
- **覆盖层**：格子索引/代价、视野边界、野生候选刷新格、群系分布、AI 目标。刷新调试只展示候选与已记录结果，不额外抽取 RNG 预测下一次结果。

### 5.1 AI 候选、性格约束与固定场景验证

AI从PlayerView与公开合法性查询生成候选，提交一条后重读观察。候选按命令类型、己方ID、目标ID/格子稳定排序；预算按候选数，保留各允许目标代表与EndTurn。先按GDD§3.14资格过滤，再按性格优先级元组及收益/成本整数评分选取，权重不能绕过规则。

| 目标 | 候选与评分 |
| --- | --- |
| 扩张/经济 | 开拓队订单、合法城址移动/建城、建筑队列/AssignWork；比较已知地块产出、距离与威胁，排除重复设置 |
| 研究/进化/训练 | 课题选择、合法进化、登记∩科技门槛内训练；比较完成轮数、剩余局长、克制与维护压力；保留换课题进度 |
| 捕捉 | 无球时在己方城BuyBall；合法相邻野生Capture或压血/靠近；按已定概率、球成本、激怒风险和性格地点限制排序 |
| 战斗/攻城 | 已见合法攻击、移动防御点、向已知敌方大本营推进；评估伤害/反击/休养损失；中立营地无需宣战 |
| 外交 | DeclareWar/MakePeace，收到提议则在下个己方行动回合RespondPeace；不以高评分越过冷却/战争轮数 |
| 探索/结束 | 已知边界格/EndTurn；无收益动作则结束，非合法命令不循环试探 |

对方兵力/城市仅来自当前可见加最后已知快照，不读隐藏实时状态；己方和已知休养者不计战斗数，观察到撤回事件时将其从在地图上的兵力记忆移除。关系内citiesLostSinceWar在开战时清零、该战争丢城时累加；不再用本局总丢城数。lastSettlerProducedRound用于保守型的15轮间隔；候选生成还检查已有在产/待出场开拓队，避免多个城市绕过同一性格节奏。

| 性格 | GDD§3.14的候选资格/目标优先级 |
| --- | --- |
| 扩张 | 建城>经济>捕捉>军事；保持1个在产/在途开拓队；从不主动宣战、不主动攻城，被宣战后正常战斗；本场战争丢城≥1接受停战；野生HP<50%即尝试 |
| 好战 | 军事训练>捕捉>建城；城市≥3才生产开拓队；已知敌城距己方单位≤5、己方战斗数≥已知对方1.5倍才宣战；战斗数≥4向最近已知敌首都推进；本场战争丢城≥1接受停战；优先距己方任一城市≤6的战区野生 |
| 保守 | 科技>经济>防御；无战争每15轮至多生产1开拓队；从不主动宣战，被宣战且己方军力≥已知对方2倍才反攻；总接受合法停战；仅捕捉己方领地野生 |

整数比较用2×己方≥3×已知对方表示1.5倍，避免浮点误差。观察不变则决策不变，历史信息不被更新为隐藏真值。同一观察下命令被核心拒绝记为AI缺陷，最多重读一次再安全结束并标invalid；不要用随机命令掩盖问题。

固定场景：扩张/保守不主动宣战，扩张不主动攻城；好战3/4战斗单位边界；已知与隐藏兵力改变但PlayerView相同时决策不变；本场战争丢城计数重置；保守第14/15轮间隔；战区距离6/7；扩张HP49%/50%；合法提议必须在接收者下一行动回合回应、EndTurn未答自动拒绝；休养/待出场无行动、无库存不Capture、余下重复设置就EndTurn。

### 5.2 无头模拟批次与输出

Node+tsx串行共用createGame/observe/planNext/step，无浏览器依赖。输入种子/地图/玩家数/性格/版本/上限，AI御三家按种子RNG选择。输出逐局JSONL和汇总CSV：版本/种子/席位/性格/御三家、轮数/终局原因/胜者/分项分数、各轮城市/人口/科技/资源/维护、捕捉尝试与成功、物种使用/击坠/进化/濒死/休养/解散、外交和大本营失守、异常与命令日志；耗时不反馈模拟。

| 批次 | GDD§5.5及D18规定 | 工具执行 |
| --- | --- | --- |
| 缺陷发现 | 10种子冒烟→100种子探索 | M3/M4规则或数值改变后使用；不当平衡验收 |
| 发布验收（固定样本烟测） | **100种子**：1v1每种子2局互换席位=200局；1v3每种子1局=100局；两批复用种子 | 初始总300次对局；分列100独立种子与300局，不能称300独立种子；追加规则见下文 |
| 非默认参数 | 指标按24×16/100轮默认局校准 | 200/300轮、标准/大图另作参数烟测，不宣称其平衡已验收 |

1v1可把三个异型配对固定分为33/33/34个种子，各自互换席位，得到66/66/68局；只是复现实验安排，不新增GDD未要求的同型/四人组合配额。1v3记录各性格整局胜者分布，不混进1v1两两/先手胜率。

统计遵循GDD L514–516及D16/D18：aborted从胜率分母剔除但单列，`aborted/attempted>5%`不通过；同一300局计划中15/300=5%不触发该条，16/300触发。并列者各记0.5胜（按GDD原值，不改成1/N）。种子无效/崩溃/非法命令另报告invalid，不偷偷替换种子或记作计分。保留失败重跑历史及分母。

对照六指标（L520–525）：征服≥40%、平均70–95轮、先手≤55%及两两40–60%（后二者仅1v1）、无属性击坠占比>25%、第30轮唯一得分领先者最终胜率≤75%、每局捕捉3–10次。按D16，输出earlyEndingBeforeRound30Count（第30轮前终局的局数）；这些局不进入滚雪球指数分子/分母，其余指标照常统计。滚雪球分母仅含有第30轮末快照且唯一领先的有效终局，第30轮并列领先样本仍剔除；不以终局胜者回填缺失快照。

按D18，100种子/300局是**固定样本烟测，不是置信结论**。每个比率指标（含aborted比例）同时输出点估计、样本量n、实际涉及的独立种子数、Wilson 95%区间；保留分子/分母定义，并列按0.5记胜。1v1互换席位的两局来自同一种子、两局相关，不算两个独立样本；复用到1v3也不新增独立种子。Wilson区间是描述性输出，不消除这种相关性，不把区间落在阈值内作为额外放行条件。n=0时点估计/区间记为不可计算，不伪造0%或100%。

放行按点估计判定：只有满足各指标阈值才通过。某项点估计不达标，或比率点估计离适用阈值不到5个百分点，就为涉及的配对或指标追加100个新的独立种子，保留相同对局安排并与原样本合并后重新判定，仍不达标则不放行；双侧阈值取距最近一侧的距离，恰好5个百分点不触发接近条件。轮数、捕捉次数等非比率指标不套百分点，但不达标仍触发追加。报告分列初始/追加种子与合并结果，独立种子去重；通过也只称固定样本烟测通过，不升级为置信结论。不引入CI集群或分布式模拟，只在现有串行批量模拟器上加统计输出。

## 6. 测试策略与推荐工具链

建议 Vite + TypeScript strict，Vitest 承担核心与工具测试，Playwright 承担少量真实浏览器流程，ESLint 使用 TypeScript 推荐规则。DOM UI 先不用框架，绘制不用引擎，配置不用额外运行时 schema 库；`tsx` 只用于无头脚本。依赖及版本在 M0 选择并锁定，本阶段不安装任何依赖。

| 层级 | 重点与最小证据 | 不承担的职责 |
| --- | --- | --- |
| 单元测试 | 六邻居/距离/坐标往返；有障碍路径；伤害整数舍入与免疫；捕捉边界；产出增长；科技前置；淘汰/轮末/计分边界 | 不为每个 getter 或 UI 样式写镜像测试 |
| 命令集成 | 非法命令保持状态/RNG/ID 不变；占城与进化的连带变化；视野更新；结束回合只结算一次 | 不依赖浏览器 |
| 确定性回放 | 同种子同命令两跑逐步比较；中途存读后结果一致；快进/有动画一致；Node 与 Chromium 共用同一小局夹具 | 不以“同 seed”代替命令和版本固定 |
| 状态快照 | 少量小地图在关键命令后的规范化状态、玩家观察；审查可读差异 | 不快照整个大局每一步，不机械更新基线 |
| 渲染冒烟 | Playwright 启动后 Canvas 有非空像素、无运行错误、资源失败有占位图、缩放点击对应正确格子；固定测试图查看图层与迷雾 | 不把跨平台字体/抗锯齿像素差异当规则错误 |
| 端到端 | 固定小地图：新游戏 → 移动/捕捉 → 城市生产/科技 → AI 回合 → 保存/加载 → 征服或计分；两种胜利各有短夹具 | 不把几十回合完整 UI 漫游当每次修改必跑项 |
| 无头统计 | 合法完整终局、无非法状态、异常局可重放；记录平衡指标 | 不宣称 AI 胜率等于人类体验 |

**版本化规则夹具**以冻结GDD v0.6物种表与公式为输入并记录哈希，独立整数复算期望：火恐龙→妙蛙草R85/100为17/21，卡咪龟反击火恐龙10，电打小拳石0，烈焰马高地打豪力R85为14；卡比兽HP20/130超级球+观察43%。地形同时满足掩体/高地时T80，免疫字段∪克制E0。捕捉的两次floor必须保留，不能从“统一取整”通则合并。

内容检查包括39物种预算/唯一成本公式、11主属性、8种rare、全表P10、七群系产出/刷新引用。D15已接受60%克制上限；新增物种必须全对全复算，不再列待确认或沿用55%。

聚焦夹具：队列第5/6项、取消首项与重排进度、溢出/待出场不计维护、研究切换保存进度；先到先得工作格与(r,q)平局、锁定释放、人口下限1/每轮只增1、占城不耗粮；四种行动耗点、新单位0点；休养不占格/归零堵格重试/宿主城失守；开拓队维护0及击坠无额外经验；城市反击归所属文明且单位无经验；本场战争损失清零、双方任一科技冻结冷却、下一行动回合强制回应和逾期拒绝；淘汰事务后快照0城市/人口且仅存活者参选。D16–D19新增固定夹具见下表（实现阶段执行，本轮仅定义期望）。

| 规则 | 固定输入与预期 |
| --- | --- |
| D16 Q02-R 离队/溢出 | 队列5项，首项本轮完成且相邻6格全占：完成项进入独立待出场区、队列剩4项、单位数/维护不增加；溢出即使够下一项也只结转其progress，本轮完成数仍为1；空队列溢出丢弃 |
| D17 重试顺序/数量 | 待出场记录(轮10,订单20)、(轮11,订单10)，仅1空格时前者出场；进入轮相同则订单ID小者先出；有2空格时两者同轮出场，按空格索引依次占用。事件顺序先待出场重试、后队列完成；本轮新加入者本轮不再尝试 |
| D17 休养落格 | 同城单位ID7/9同时归零且仅1空格，7先落格，9保持roundsLeft=0；再释放一格后9可落格且不重复恢复25%HP。阶段2先用掉的格子在阶段5不可复用 |
| D16 Q03-R 阶段6濒死 | 行动阶段濒死初始化3，阶段5后为2；阶段6野生击倒另一单位直接为2，本轮不重复扣；两者下一轮阶段5都变1，阶段总数仍为8 |
| D19 历史观察 | 同时观察宝可梦和开拓队后失去视野：前者kind=pokemon/speciesId，后者kind=logistics/role=settler且无speciesId，均保留ownerId/position/lastSeenRound。隐藏移动不刷新快照；重新见原格为空、观察到移除事件两种清理路径都分别覆盖两类；observe/projectEvents不得泄露隐藏实时状态 |
| D16 Q09-R 滚雪球分母 | 三局分别在29轮终局、30轮末唯一领先且最终获胜、30轮末并列领先：earlyEndingBeforeRound30Count=1，滚雪球n=1、点估计100%；其余指标仍按各自口径计入早终局。无合格快照时n=0、区间不可计算 |
| D18 区间/追加 | 固定100局中50胜、来自50个互换席位种子：点估计50%、n=100、独立种子50、Wilson 95%约[40.38%,59.62%]，标注两局相关。两两胜率阈值40–60%下，45%距下界恰5个百分点不追加，44%或39%均追加100新种子；按互换安排合并后重算n和独立种子数，仍低于40%不放行；均值类不达标同样追加 |

野生RNG夹具覆盖满区0次调用、刷新失败只耗判定、无位置耗判定/群系/物种但不耗位置、成功四次、初始跳过判定、游荡无合法格不取RNG、守卫多目标最小ID。以可审查的固定序列测试抽样消耗，不能只比较最终数量。默认开局fixture为24×16/100，出生≥8→6→4及拒绝无解，AI御三家可重放；第99→100轮验证8阶段之后计分，另测200/300边界。保存/加载包含订单progress、独立pendingDeployments及其enteredAtRound/sourceOrderId、两类历史单位快照、progressByTech、冷却截止轮、pendingProposal、历史观察、休养槽和冻结排名。

计划中的统一命令：`npm run dev`、`npm run build`（含 `tsc --noEmit`）、`npm run lint`、`npm test -- --run`、`npm run test:e2e`、`npm run sim -- --seeds ...`、`npm run replay -- ...`。这些是未来脚本名称，当前仓库没有实现，不作为本次已执行证据。

改规则时运行对应单元/集成与回放；改渲染/输入运行构建和相关浏览器冒烟；里程碑运行其闭环验证。发布可玩版本前跑一次完整套件与 §5.2 发布批次（初始100种子、300局，触发D18时追加100新种子并合并重判），探索批次不替代验收批次。不设测试覆盖率百分比门槛、不引入 CI 集群或复杂预提交链。

## 7. 工程目录草案

```text
src/
  core/
    model.ts              # 状态、命令、事件、观察类型
    step.ts               # 原子命令入口
    rng.ts / hex.ts / pathfinding.ts
    map.ts / economy.ts / combat.ts / research.ts
    turn.ts / victory.ts / diplomacy.ts / vision.ts
    content.ts            # 内容类型与有限引用校验
  content/
    species.ts / types.ts / biomes.ts / techs.ts / buildings.ts
    rules.ts              # 经策划确认的初始数值与版本
  ai/
    planner.ts            # 只读观察 -> 命令
  app/
    session.ts / replay.ts / save.ts
  browser/
    main.ts / input.ts / ui.ts / storage.ts
    render/
      canvas.ts / camera.ts / layers.ts / animation.ts / assets.ts
    debug.ts
  styles.css
public/assets/            # 图片与资源清单；规则不依赖文件存在
tools/
  simulate.ts / replay.ts / summarize.ts
tests/
  core/ / replay/ / browser/ / fixtures/
docs/
  design/mvp-gdd.md
  tech/mvp-architecture.md
```

小模块可以先合并，不按列表预先造空文件。`PlayerView` 是类型与纯投影结果；地图绘制接口不用把核心 `GameState` 到处传递。浏览器存储适配器与核心序列化分离，未来服务端可替换外围 I/O 而不搬写规则。

## 8. 里程碑与关键路径

共 **7 个里程碑（M0–M6）**。每步都交付可观察结果，内容数量先少后多。时间估计等第一条闭环完成再给，避免用大而全的系统表直接推算工期。

| 里程碑 | 交付范围 / 前置 | 可观察完成条件 | 验证方法 |
| --- | --- | --- | --- |
| M0 骨架与可复现种子 | 无前置；最小 TS/Vite，纯核心入口，S03/S05 基础 | 浏览器显示固定种子的六角格；同种子创建相同地图状态；核心能在 Node 独立导入 | 构建；RNG 测试向量；坐标单测；Node 同种子状态比较 |
| M1 命令与玩家视角闭环 | M0；单单位、移动、回合、视野、相机/输入、事件队列 | 点击移动正确扣行动；迷雾不显示隐藏单位；结束行动轮换；跳过动画结果相同 | 合法/非法命令测试；视野投影夹具；浏览器点击冒烟；保存命令后重放 |
| M2 城市经济与最小存档 | M1；开局/工作/队列/科技/球库存 | 七群系经济、观测者、队列5项、研究切换和存读可复现 | 工作独占/排序、人口边界、取消/重排/溢出、库存夹具；D16/D17独立待出场、重试顺序与每轮至多完成1项夹具 |
| M3 宝可梦战斗闭环 | M2；战斗/捕捉/进化/休养/野生协议 | 行动点与概率顺序正确，休养槽/待出场不阻挡，后勤/城市击坠归属正确 | 整数oracle、43%捕捉、RNG消耗序列、休养落点；D16阶段6濒死直接roundsLeft=2夹具 |
| M4 完整对局与AI | M3；公开外交/强制回应/性格/终局 | 接收者下一行动回合回应、冷却固定、已知信息决策；淘汰后冻结且不可胜 | 外交时机、15轮/6格AI边界、四步淘汰、100轮与人类失败夹具；10种子冒烟 |
| M5 内容覆盖与平衡初调 | M4；7群系/39物种/12科技 | 内容引用/成本/产出与D15全对全验证；10→100种子探索数据可比较 | 内容与整数规则检查、濒死/维护/捕捉趋势、策划试玩；记录实际缺陷而非声称发布通过 |
| M6 MVP可玩交付 | M5；交互/版本/回归 | 可存读完整局；初始100种子复用，1v1互换200局+1v3共100局，按D18追加重判；aborted>5%不通过 | 构建/lint/测试、跨端回放、终局E2E、GDD六指标（D16排除早终局滚雪球样本、D18统计输出与追加种子重判）、帧耗时 |

关键路径为 **M0 → M1 → M2 → M3 → M4 → M5 → M6**：先有确定性状态和命令，才加入经济/战斗；胜负与 AI 可跑后再扩内容和平衡。资源占位图允许美术整理独立推进；基础规则确定后可准备其测试和配置，但不能凭未批准的策划规则开始完整内容制作。

里程碑按冻结GDD v0.6及任务板裁定验证，§10.2记录规划收口的历史结论；M6发布批次按D18定性为固定样本烟测。各里程碑完成情况仍需各轮实际运行证据，元数据同步不代表工程验收。

## 9. 增量扩展、存档与联机预留

**数据驱动到内容差异为止。** 新物种、建筑和科技尽量只加定义；新胜利条件仍写显式规则函数。MVP 不做规则脚本语言、通用触发器编辑器或插件容器。

- **系统注册**：先用固定、可读的轮末阶段数组与胜利判定数组，阶段 ID 唯一且顺序显式。只有确有第二种可选机制时再抽出小型注册表；不做动态依赖拓扑、自动发现、热插拔。MVP 不保存永远为 false 的 v2/v3/v4/faith 开关；对应版本实际引入可选规则时再增加开局开关、入档并写迁移，且不允许局中切换（D13）。
- **v2 图鉴**：增加持久化发现/捕获记录与图鉴 UI；通过捕捉/观察规则同步更新，由新胜利判定读取。记录属于权威状态，不能仅靠表现事件累计。胜利冲突优先级由版本规则明确。
- **v3 起源**：增加石板地图实体、持有/交付记录和相关命令；复用地图交互与观察投影。新增记录采用独立命名字段，避免塞进任意键值 `extras`。
- **v4 冠军**：增加联盟大会资格/进度与裁决；若需要独立比赛战场，届时单独设计该子流程，不预留一个未经需求验证的“万能战斗场景”。
- **信仰**：是后续系统而非胜利条件；与经济、地图交互的关系另立规则。MVP 不添加虚拟信仰数值或空 UI。资源层、巢穴位、圣所、teamId、wonder 同样到其版本才增加（D13），不能借“预留”进入当前类型；事件仅记录 MVP 已发生行为，不承诺自动补齐未来图鉴历史。

存档封套至少含 schema/rules/content 版本、对局设置、权威 `GameState` 与可选回放基准/命令日志。MVP 在命令完成边界手动保存，并每轮末覆盖一个自动档；浏览器 `localStorage` 足够作首版小档存储，提供 JSON 导入导出避免仅依赖浏览器持久性。长命令日志单独导出，不无限追加进自动档；写入失败保留旧档并提供导出。动画、相机、悬停等不入权威档。

加载顺序：解析封套 → 检查版本 → 执行已实现的 `vN -> vN+1` 纯迁移 → 验证实体引用与关键数值 → 重建派生数据 → 恢复会话。MVP 只有 v1 时不编造迁移步骤；第一次字段变更再加一条迁移及旧档夹具。未知未来 schema 显示不支持且不覆盖原档。规则/内容版本不同不能保证旧回放；默认拒绝作为同版本回放执行，存档若需兼容须有明确映射和版本说明，不静默套用新公式。不承诺永远兼容所有旧档。

联机现在保留四个接口条件：

1. 通过单一 `step` 提交可序列化命令，附 actor 与 expectedSeq；未来服务器认证后绑定 actor 并复用校验，不信任客户端自报身份或伤害。
2. 纯核心和固定 RNG 让服务器可以无头运行；命令序号用于顺序检查与状态对齐，未来传输层再补幂等请求 ID 和重连策略。
3. `observe/projectEvents` 作为玩家视角出口，未来服务器仅发送授权视角；本地 MVP 的整个状态在浏览器，迷雾不是防作弊安全边界。
4. 状态与命令版本有明确定义，日志可诊断分歧；版本不兼容可拒绝加入，跨端一致性有固定夹具可验证。

**当前不实现** WebSocket、服务器、账号/匹配、房间、网络消息协议、预测回滚、重连、锁步或反作弊。未来优先服务端权威的回合命令模式：客户端接收视角快照/事件，确定性用于复现和诊断。由于战争迷雾，不建议把完整状态和 RNG 广播给所有客户端来做公开锁步。接口预留能减少规则重写，不能消除未来服务器与权限工作的成本。

## 10. 关键取舍与待决策项

| 选择 | 推荐 | 理由与代价 / 何时重看 |
| --- | --- | --- |
| 普通对象模型 vs ECS | 普通可序列化对象 + 纯查询/规则函数 | 数百格、小规模单位无需组件调度框架；便于存档和学习。单位行为组合大量增长且出现重复逻辑时再评估 ECS |
| Canvas2D vs Pixi/WebGL | 原生 Canvas2D | 六角格与简单演出足够，依赖少、调试直接；图集/粒子规模导致实测瓶颈时再评估引擎 |
| 同步状态转换 vs 完整事件溯源 | 命令转换状态，事件服务表现；命令日志重放 | 避免为每个字段变更维护事件 schema；代价是回放需要对应版本规则 |
| DOM 面板 vs Canvas 画全部 UI | Canvas 地图 + 原生 DOM/CSS 面板 | 文本、滚动、焦点和表单用原生能力；代价是要管理两套坐标边界，但命令入口统一 |
| 全帧绘制 vs 脏区 | 活动时视口全帧，静止按需请求帧 | 简单且无失效区域维护；若实测过慢，先缓存静态地形而不是直接换引擎 |
| 启发式 AI vs 搜索/学习框架 | 确定性启发式评分与固定候选预算 | 能形成可玩闭环、便于诊断；不追求拟人或最优，平衡统计需承认策略偏差 |
| 单线程 vs Web Worker | MVP 单线程，工具串行批量 | 减少消息/状态同步；AI 单次决策影响交互或批次太慢时再把已有纯接口搬进 Worker |

### 10.1 已决定规则与 Q01–Q09 处理结论

| 原项 | GDD v0.4历史快照章节/行号或任务板决策 | 已决定内容与技术落点 | 结论 |
| --- | --- | --- | --- |
| Q01 经济/领地 | §3.2 L164–197 | 七群系产出与观测者恢复；所有城市固有中心收益；先到先得/字典序/rq平局/锁定失效；人口下限1、每轮最多+1、占城不结算；§3.1/§3.5 | 关闭 |
| Q02 队列/建局 | §3.5 L235、§3.13 L389–391 | 队列5项/取消首项进度作废/重排保留/溢出结转；待出场；初值/研究保存/出生降级；订单progress、独立pendingDeployments、progressByTech | 关闭；边界见Q02-R |
| Q03 行动/休养/后勤 | §3.5 L231/236、§3.7 L268–274 | 四种行动耗1点、新单位0点；槽不占格、恢复25%并落格重试；后勤维护0/击坠计数但无额外XP；城市反击归文明无单位经验 | 关闭；边界见Q03-R |
| Q04 公式组合 | §3.6 L244–250、§3.7 L263/279、§3.8 L286 | 捕捉基础取整→观察→稀有取整；掩体优先；免疫并集；反击算例10；§3.1/§6 | 关闭 |
| Q05 野生协议 | §3.12 L354–383 | 当前位置区域计数、判定/群系/物种/位置顺序、空候选不回滚、初始跳过判定、无路不动/守卫最小ID；§3.1/§6 | 关闭 |
| Q06 外交/训练 | §3.10 L330–332、§3.5 L233 | 下个行动回合回应/逾期拒绝/不可撤销；达成时任一方科技取短冷却并冻结；外交全公开；登记∩科技门槛；§3.2/§3.4 | 关闭 |
| Q07 AI度量 | §3.14 L404–413 | 当前可见+最后已知；休养不计数；战争丢城重置；15轮低速、6格战区、扩张从不主动宣战；§3.1/§5.1 | 关闭 |
| Q08 终局快照 | §3.9 L305–316 | 转移大本营→中立余城→清单位→冻结0城快照；淘汰者只排名、胜者仅存活者；§3.3/§3.5 | 关闭 |
| Q09 验收 | §5.5 L513–525 | 100种子复用、200个1v1+100个1v3；两两/先手仅1v1、并列0.5、唯一领先样本；§5.2 | 关闭；边界见Q09-R/D18 |
| D15 | 任务板D15、§5.4 L503–505 | 60%克制上限已获Hub接受；新增物种同脚本全对全校验；§6 | 已决定，不再待批准 |
| Q02-R 待出场/生产 | D16 Q02-R、D17 | 独立待出场区不占5项名额；阶段2按(进入轮数,原订单ID)重试且出场数不限，再每城最多完成1项、结转溢出；新等待者下轮重试；阶段5按单位ID恢复落格；§3.1/§3.5/§6 | 关闭 |
| Q03-R 野生阶段濒死 | D16 Q03-R | 阶段6初始化roundsLeft=2，相当于已计入当轮扣减，8阶段不变；§3.1/§3.5/§6 | 关闭 |
| Q09-R 提前终局 | D16 Q09-R | 第30轮前终局单独计数，不进入滚雪球分母，其他指标照常；§5.2/§6 | 关闭 |
| D18 发布统计 | 任务板D18 | 固定样本烟测，点估计/n/独立种子数/Wilson 95%；相关席位声明及追加100新种子、合并重判；§5.2/§6 | 已决定 |
| D19 历史观察 | 任务板D19 | 宝可梦/后勤判别联合及共同快照字段；观察投影与清理覆盖两类；§3.1/§3.4/§6 | 已决定 |
| D28 移动与落点 | GDD v0.6 §3.1/§3.5/§3.7/§3.13 | 通行权和消耗分离；己方城市可进/他方阻挡；先筛地形再距离/索引，初始不限环、生产与恢复限相邻6格；§3.1 | 已决定 |
| D30 经济结算 | GDD v0.6 §3.2/§3.4/§3.11 | reserve与每轮1科技、阶段1–4产出快照、阶段3实际维护；限定自动分配触发、观测者保留与饥荒释放；§3.1/§3.5 | 已决定 |
| D31 迷你龙刷新 | GDD v0.6 §3.12/§5.2 | 仅雪原刷新且无海洋通行权；海洋折减后轮盘55:25:2总82；§3.1/§6 | 已决定 |

### 10.2 仍未封闭的规则

剩余条目数：**0项**。R3保留的Q02-R/Q03-R/Q09-R共3项已由D16裁定，D17补足待出场/恢复排序；均移入§10.1，不再作为未决规则或实现前置问题。

### 10.3 原疑点关闭依据

- Q02-R：GDD v0.4 L235/L340的待出场与产能边界由D16/D17补足，正文已采用独立待出场区与先重试后生产的确定性顺序。
- Q03-R：GDD v0.4 L270/L343–344/L383的同轮首扣顺序由D16明确为阶段6初始化2，不移动或追加阶段。
- Q09-R：GDD v0.4 L516/L524的早终局口径由D16覆盖为排除滚雪球样本、单列局数；D18补足统计输出与追加种子规则。

D16–D19 已并入 GDD v0.5；BL-03 已采用 GDD v0.6 并补齐 D28、D30、D31；本次 BL-04 补齐 D32 类型落点，依据统一为 D1–D33，不新增设计。规划收口结论见 reports/review-r4.md；M0 及后续里程碑的实际实现和验证证据分别记录，不以规划文档代替工程验收。
