# 模拟数值补丁

```sh
npm run sim:explore -- --seeds 10 --patch tools/patches/city-hp.json --out /tmp/city-hp-experiment
npm run sim:explore -- --seeds 10 --out /tmp/city-hp-control
node tools/compare-games.ts /path/to/baseline /path/to/candidate
```

补丁只作用于本次运行，正式 `CONTENT` 不变。带补丁的 manifest 明示「这是实验数据，不是正式内容」，保存补丁内容、SHA-256 和散列格式。散列使用 `canonicalSerialize(patch)` 的 UTF-8 字节（对象键排序、数组顺序保留），与 JSON 缩进和对象键顺序无关。重复种子验证使用同一份补丁；`games/*.json` 保持原格式。复现时必须携带 manifest 补丁和相同代码版本，不可单独按默认内容重放命令。现有 `diagnose-capture.ts` / `reclassify.ts` 是历史默认内容诊断工具，不支持补丁重放。

只填写需要覆盖的字段，其余保留默认。除明确标注的布尔开关外，允许的叶子都是整数；未知字段、错误类型、非整数与越界值报出完整字段路径。ID 必须已存在，不支持新增物种、建筑、科技或字段。`PATCH_SCHEMA`（`tools/patch.ts`）是实际范围定义。

| 路径 | 允许字段与闭区间 |
| --- | --- |
| `species.<id>` | `maxHp` 4–1000；`attack/defense` 1–1000；`power` 1–100；`move/vision/range` 1–12；`trainCost` 1–10000；`upkeep` 0–100 |
| `species.<id>.evolution` | 仅已有进化节点：`xp/gold` 0–1000 |
| `settler` | `move/vision` 1–12；`trainCost` 1–10000；`upkeep` 0–100 |
| `buildings.<id>` | `cost` 1–10000（大本营不可建造，不允许覆盖 null）；`trainedXp` 0–1000；`yields.food/production/gold/research` 各 0–1000 |
| `techs.<id>` | `cost` 1–10000 |
| `balls.<id>` | `goldCost` 1–10000 |
| `biomes.<id>` | `food/production/gold/research` 各 0–1000 |
| `moveCosts.<id>` | 1–12 |
| `balance.city` | `baseHp` 50–1000；`capturedHp` 1–1000 且不超过合并后 `baseHp`；`buildingHp` 0–1000；`defense` 1–1000；`counterAttack/squirtleCounterAttack` 0–1000 |
| `balance.effects` | `siegeMultiplier/leagueScoreMultiplier` 0–5000（千分比）；`meteorologyResearch` 0–1000 |
| `balance.score` | `cities/population/species/techs/knockdowns` 各 0–1000 |
| `ai` | 见下表 |

城市基础 HP 下限 50 保证固定的中立化 HP50 不超过上限；物种 HP 下限 4 保证 25% 休养恢复至少为1。攻击/防御/成本/移动消耗保留正值以维持现有公式前提。数值范围用于限制实验输入，不表示符合正式 GDD 平衡预算。物种训练成本与 HP/A/D 独立覆盖，不按正式预算公式自动重算；物种修改同步用于单位移动、训练和维护。建筑加 HP 与上限使用同一 `buildingHp`。

| AI 字段 | 默认值 | 范围 |
| --- | ---: | --- |
| `aggressiveSettlerCities` | 3 | 1–100 |
| `aggressiveWarStrength` | 1500 | 0–10000，千分比 |
| `aggressiveBorderDistance` | 5 | 1–24 |
| `aggressiveSiegeUnits` | 4 | 1–100 |
| `aggressiveCaptureRadius` | 6 | 1–24 |
| `aggressiveSeekUnknownHq` | false | true / false；D42，无已知可攻HQ时推进探索 |
| `conservativeStrength` | 2000 | 0–10000，千分比；独立攻城门槛 |
| `conservativeMayDeclareWar` | false | true / false；D41，启用主动宣战及主动战争中的攻城 |
| `conservativeDeclareStrength` | 2000 | 0–10000，主动宣战千分比 |
| `conservativeBorderDistance` | 1 | 1–24，已观察城市到己方单位距离 |
| `conservativeSettlerInterval` | 15 | 1–300 |
| `conservativeCaptureTerritoryOnly` | true | 仅 true / false；false 允许尝试领地外野生捕捉，不绕过核心捕捉规则 |
| `peaceCitiesLost` | 1 | 1–100，扩张/好战停战接受与提议 |
| `expansionCaptureHpPercent` | 50 | 1–100，严格小于 |

性格优先级、攻城/宣战条件、捕捉偏好和攻击/移动限制集中在 `src/ai/strategies.ts` 的只读表；表内门槛引用上述字段，默认值在 `src/ai/thresholds.ts`，对应 GDD §3.14（D40 前）。

不支持：身份/属性/角色/稀有度/免疫/通行与刷新群系列表、科技层级/解锁结构、AI 优先级/其余行为开关/候选评分/预算。D41 开启后，保守主动/被动战争均按 `conservativeStrength` 判断攻城；宣战倍率不会覆盖攻城倍率。D42 仅为满足攻城条件且无已知交战敌HQ的好战宝可梦提供探索移动，按距离、格索引确定性选取可接近的未知区域或未再观察到的敌城，不读取隐藏状态。扩张型只保留一个在产或在途开拓队的机制不改；外交合法性冷却不当作 AI 自由门槛。地图生成、野生刷新、属性表、伤害/捕捉公式与球倍率、经验倍率、休养/回血、城市增长/半径/中心产出、开局资源与余城中立化 HP50 等硬编码规则保持原样；只有攻击占城恢复 HP 使用 `capturedHp`。本轮只将城市战斗、联盟计分、气象科研效果抽成配置，未统一重写各科技/御三家效果。

示例只把城市基础 HP 从100改为60；它不修改占城后HP50、非大本营建筑每座+20、单位数值或 AI。10种子与100种子批次的性格分组不同，因此示例应与另一个同为10种子的默认批次比较，不能直接拿100种子的前30局作对照。小批次只证明实验生效，不是平衡结论。

B5 / D43: `aggressiveSiegeCaptureBonus` and `aggressiveSiegeTrainingBonus` are integers 0–10000 (default 0). They add benefit within the existing goal order only when an eligible enemy HQ is known or D42 search is enabled and siege-ready. Capture/movement bonuses require a visible siege species within the existing city-based aggressiveCaptureRadius; existing legality and inventory checks remain. Training still requires registration and all existing production gates. `conservativeSeekUnknownHq` is boolean (default false): reuse D42 exploration while at war and satisfying the separate siege strength threshold.
