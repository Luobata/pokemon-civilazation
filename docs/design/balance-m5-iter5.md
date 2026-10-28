# B6：第五轮平衡迭代方案

> 本文只设计实验与 GDD 草案，不修改正式规则、默认值或代码。共同底座为 K6；L1–L6 的实战效果均为待模拟验证的假设。目标是征服 ≥40%，同时三组性格配对都在 40–60%，且不退化先手、滚雪球和节奏守护指标。

## 1. 输入与第四轮结论

输入为同一 100 种子、300 局的 J8、K1–K6 及 D43 实验。原始数据在共享报告区 `reports/sim/m5-8-*`，完整汇总为 `sim-balance-b5.md`。

| 方案 | 征服 | 1v3 终局 | 先手 | 好战对扩张 | 好战对保守 | 保守对扩张 |
|---|---:|---:|---:|---:|---:|---:|
| J8 | 46.33% | 88.12 | 53.00% | 69.70% | 69.12% | 16.67% |
| K1 | 29.00% | 93.10 | 50.75% | 42.42% | 46.32% | 16.67% |
| K3 | 48.67% | 89.07 | **55.50%** | 69.70% | 69.12% | 21.21% |
| K5 | 47.67% | 88.01 | 53.00% | 69.70% | 67.65% | 21.21% |
| **K6** | **29.33%** | **94.52** | **54.75%** | **40.91%** | **46.32%** | **27.27%** |

K6 是第四轮实验胜者，不是平衡通过：好战两组已经达标，但征服低 10.67 个百分点，保守对扩张低 12.73 个百分点，先手与 1v3 也靠近上限。D43 的 S1–S3、C1 没有改善这些目标，因此本轮全部显式关闭 D43，不把它混入 D44 的因子差分。

D44 已决定开放扩张型有条件攻城并提高科技计分权重。本轮只测试这两个新方向，不重新回调已经达标的好战参数。

## 2. K6 预分析：效果上限与风险

### 2.1 征服缺口应优先由“既有胜者提前清场”补足

`/tmp/balance_m5_iter5_score.mjs` 读取 K6 全 300 局，输出 `/tmp/balance_m5_iter5_score.json` 和 `.stdout.json`。K6 的 88 场征服中，好战 72 场、保守 16 场、扩张 0 场；扩张有 123 场胜利，全部是计分胜。

- 达到 40% 需要 `120−88=32` 场额外征服。
- 若扩张把既有 123 场计分胜中的 32 场转成征服，且最终胜者不变，转化率只需 `32/123=26.02%`，总征服即达到 40%，三组配对胜率完全不变。
- 反之，如果扩张攻城主要靠翻转原本输掉的 1v1，配对会退化。K6 扩张对好战已经 59.09%（39/66）；只要净翻转一场好战胜为扩张胜，就会变成 60.61%（40/66），越过上界。
- 保守对扩张需要至少再从 18 胜增加到 27 胜，即净增 9 场，才能达到 40.91%。扩张攻城本身没有让保守多胜的直接机制，不能把它当作这组配对的修复手段。

因此，本轮必须区分 **同种子、同性格胜者的计分胜→征服胜转化** 与 **最终胜者翻转**。前者是同时达标的可行路径，后者可能在提高征服的同时破坏性格平衡。

### 2.2 扩张攻城门槛：5 格有实质新增暴露，1500 主要延长窗口

`/tmp/balance_m5_iter5_expansion_gates.mjs` 重放 K6 全 300 局，在每条已接受扩张命令前用 `observe`、`knownCombatCount` 和 `knownCities` 重建视角。输出 `/tmp/balance_m5_iter5_expansion_gates.json` 和 `.stdout.json`。条件是：与对手处于战争、已观察己方战斗单位数满足倍率、至少一座已观察对方城市距己方单位不超过门槛。决策点不是独立回合或独立样本。

| 范围 | 战争席位 | 1500+1 格决策/席位 | 1500+5 格决策/席位 | 2000+1 格决策/席位 | 2000+5 格决策/席位 | 2000+5+已知 HQ 席位 |
|---|---:|---:|---:|---:|---:|---:|
| 全部 266 扩张席位 | 237 | 5351 / 101 | 18500 / 162 | 4797 / 95 | 16573 / 161 | 141 |
| 其中 1v3 | 126 | 2580 / 55 | 10086 / 85 | 2323 / 52 | 9318 / 85 | 73 |
| 1v1 对好战（66 席） | 62 | 1074 / 23 | 3821 / 38 | 1034 / 23 | 3488 / 38 | 32 |
| 1v1 对保守（66 席） | 49 | 1697 / 23 | 4593 / 39 | 1440 / 20 | 3767 / 38 | 36 |

K6 扩张对城攻击和 HQ 攻击都为 0，所以这些是反事实资格暴露，不是预计占领数。可得到两条有边界的假设：

1. **距离取 5**：1500 下从 1→5 格增加 61 个有资格席位，2000 下增加 66 个；1v1 两组也分别从 23 增至 38/39。5 格与现行好战、K6 保守的距离口径一致。1 格会丢掉大量已有暴露，本轮不再消耗一个因子名额。
2. **军力测 1500 与 2000**：固定 5 格，1500 相对 2000 只多 1 个全样本席位，决策点增加 1927（11.63%）；对好战席位同为 38，对保守为 39 对 38。因此 1500 更可能增加既有席位的攻城窗口，而非创造完全不同的战争覆盖。它可能更快转化计分胜，也更容易造成配对翻转；2000 是较保守的对照。

### 2.3 科技分差：提高通用权重并不能普遍补偿保守

同一计分脚本按 K6 终局计分项复算。下表均为每局差值再取均值，方向为行名左项减右项；城市分使用 K6 的 ×80，科技分使用当前 ×20，均未另乘联盟规章。

| 配对方向 | 城市数差 | 城市项分差 | 科技数差 | 科技项分差 | 其他项分差 | 实际总分差 |
|---|---:|---:|---:|---:|---:|---:|
| 好战−保守 | +0.57 | +45.88 | −0.65 | −12.94 | +7.59 | +40.53 |
| 好战−扩张 | −0.88 | −70.30 | −1.29 | −25.76 | −29.17 | −125.23 |
| 保守−扩张 | −1.58 | −126.06 | −0.26 | −5.15 | −50.79 | −182.00 |

保守对扩张的科技差为负。固定其他实际终局项，以 −182 分为基准，使差值归零的科技权重为 `20−(−182)/(−0.257575…)=−686.59`；合法的非负权重无解。权重 30/40 的线性均值差反而约为 −184.58/−187.15。也就是说，不能声称“科技越高分就必然补保守对扩张”。

脚本进一步只改终局科技权重，保留原命令、时间线和征服结果，按现有总分→城市→人口→科技→击坠规则决定终局胜者；滚雪球仍按工具的“轮 30 总分唯一领先”口径。20 的复算与 K6 汇总逐项一致。

| 固定命令反事实 | 征服 | 好战对保守 | 好战对扩张 | 保守对扩张 | 先手 | 滚雪球 |
|---|---:|---:|---:|---:|---:|---:|
| 科技 ×20（K6） | 29.33% | 46.32% | 40.91% | 27.27% | 54.75% | 54.30% |
| 科技 ×30 | 29.33% | 46.32% | 40.91% | 27.27% | 54.75% | 55.02% |
| 科技 ×40 | 29.33% | 44.85% | 40.91% | 28.79% | **55.75%** | 55.38% |

- ×30 没翻转三组配对，滚雪球仅 +0.72 个百分点；×40 各翻转好战/保守、保守/扩张一局，但保守对扩张仍远低于 40%。
- 两档都不改变征服，故科技单因子不可能独立补到 40%。
- ×40 的先手为 55.75%，已触发硬排除警告。实际组合会改变城市、科技和终局，所以仍须实跑，不能拿此反事实替代模拟。

### 2.4 怎样才可能同时达标

需要同时满足以下算术条件，而不是只看总征服：

1. 扩张攻城至少贡献 32 场净新增征服，最好主要来自既有 123 场扩张计分胜的胜者保持转化；若有好战/保守征服减少，所需扩张新增量还要相应增加。
2. 扩张对好战不能净增加哪怕 1 场完整胜局，否则从 59.09% 越过 60%；对保守也不能继续明显翻转，否则保守缺口扩大。
3. 保守对扩张还需净增至少 9 胜。×40 固定命令只增加 1 胜，×30 为 0；因此目前证据不支持两个 D44 杠杆必然完成第三项。
4. 先手 ≤55%、1v3 ≤95 和全部守护指标仍须通过。K6 已分别为 54.75%、94.52，不能用征服收益抵消退化。

若组合只完成第 1 项而第 2/3 项失败，应判定这些杠杆不足，不继续无依据微调。尤其保守对扩张仍失败时，需要回到科技实际产出、保守战争路线或调整非对称验收目标的用户方向选择。

## 3. 共同底座与第五轮补丁

共同底座完整保留 K6，并显式关闭 D43 与扩张攻城。科技 ×20、扩张军力 2000 是未启用因子的占位值，不改变关闭状态。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 20 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": false,
    "expansionSiegeStrength": 2000,
    "expansionBorderDistance": 5
  }
}
```

六组采用交叉组合，而不是“双低”和“双高”组合：L5=L1 的攻城 + L4 的科技，L6=L2 的攻城 + L3 的科技。这样可以分别比较 `L5−L4`、`L6−L3` 的条件攻城效果，以及 `L5−L1`、`L6−L2` 的条件科技效果。它不是完整 2×2 因子设计，不能计算一个统一交互残差，也不能把组合差值全部称为协同。

### L1：扩张 1500 + 5 格

假设：利用更长的攻城窗口，把部分扩张既有计分胜提前转成征服；重点检查对好战是否净翻转超过上限、对保守是否继续扩大差距。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 20 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": true,
    "expansionSiegeStrength": 1500,
    "expansionBorderDistance": 5
  }
}
```

对比：L1−K6 只开启扩张攻城并设军力 1500，距离固定 5。

### L2：扩张 2000 + 5 格

假设：用几乎相同的席位覆盖但较少的重复窗口，检验更严格军力能否保留征服转化并降低翻转风险。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 20 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": true,
    "expansionSiegeStrength": 2000,
    "expansionBorderDistance": 5
  }
}
```

对比：L2−L1 只差扩张军力 2000 对 1500；不主动宣战、不开放未知 HQ 搜索。

### L3：科技 ×30

假设：在配对不变的基线反事实附近提供较温和的科技补偿；预期只可能改变计分终局，不独立增加征服。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 30 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": false,
    "expansionSiegeStrength": 2000,
    "expansionBorderDistance": 5
  }
}
```

对比：L3−K6 只差 `balance.score.techs` 20→30；扩张攻城关闭。

### L4：科技 ×40

假设：检验更高科技权重能否实质改善保守计分路线；固定命令已显示先手 55.75%，所以它也是守护边界实验，不是预设推荐值。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 40 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": false,
    "expansionSiegeStrength": 2000,
    "expansionBorderDistance": 5
  }
}
```

对比：L4−L3 只差科技权重 30→40；若实跑先手越界，按硬条件排除，不用配对的小幅改善抵消。

### L5：扩张 1500 + 科技 ×40

假设：测试较低攻城门槛与高科技分共存时，征服转化是否足以覆盖科技 40 的先手风险，以及扩张是否反而过强。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 40 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": true,
    "expansionSiegeStrength": 1500,
    "expansionBorderDistance": 5
  }
}
```

对比：`L5−L4` 是科技 40 下开启 1500 攻城；`L5−L1` 是 1500 攻城下科技 20→40。两个差值的条件不同，不合并成无主次的“组合收益”。

### L6：扩张 2000 + 科技 ×30

假设：以较保守的两个剂量寻找最小行为扰动；若 L1/L4 分别过强，这组用于检验 2000 与 30 能否保留部分收益并守住配对和先手。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80, "techs": 30 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "aggressiveSiegeCaptureBonus": 0,
    "aggressiveSiegeTrainingBonus": 0,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8,
    "conservativeSeekUnknownHq": false,
    "expansionMaySiege": true,
    "expansionSiegeStrength": 2000,
    "expansionBorderDistance": 5
  }
}
```

对比：`L6−L3` 是科技 30 下开启 2000 攻城；`L6−L2` 是 2000 攻城下科技 20→30。

机器补丁为 `/tmp/balance_m5_iter5_patches.json`。当前 `parsePatch` 尚未实现三个 D44 扩张字段，六份完整补丁都预期在 `patch.ai.expansionMaySiege: unknown field` 处失败；不得因此运行剥离字段版。`/tmp/balance_m5_iter5_validate_patches.mjs` 另外只移除这三个新字段做静态检查，六份均通过，K6 其他内容/AI 保持不变，科技权重分别为 20/30/40。完整补丁 canonical SHA-256 和校验结果在 `/tmp/balance_m5_iter5_patch_validation.json`、`.stdout.json`；字段实现后必须重跑完整校验并全部通过。

## 4. 运行、诊断与胜者选择

1. 先实现 `expansionMaySiege`（默认 false）、`expansionSiegeStrength` 和 `expansionBorderDistance`。默认关闭时，新代码上的 K6 必须与已有 K6 全 300 局逐字节一致；否则停止跨版本比较。六份完整补丁通过 `parsePatch` 后才能运行。
2. 六组均跑同一 100 种子、300 局，保留 manifest、patch SHA、逐局命令与遥测；同 patch 双跑验证确定性。固定样本仍是探索批，最终候选另跑 D18 独立新种子。
3. 除 B5 全部指标外，必报：
   - 扩张按对手性格拆分的“战争→军力+5 格→已知 HQ→首次城攻→首次 HQ→征服”漏斗，1500/2000 各自暴露；决策点不得当作独立样本。
   - 同种子相对 K6 的 **胜者保持计分胜→征服胜** 数、扩张新增征服数、最终胜者翻转数及方向；另列好战/保守征服减少数，核对 32 场净缺口。
   - 扩张对好战、扩张对保守的胜率变化，不能只报三组中表现最好的配对。
   - 科技 30/40 的终局城市项、科技项和总分差，以及与 §2.3 固定命令反事实的差；先手、滚雪球、1v3 和平均终局必须单列。
   - 攻城定位登记/训练/对城/投石后对城分类。扩张已有攻城物种训练，开放攻城后才可能形成真实暴露，但仍不得预设 1750 倍率已验证。
4. **沿用 B5 §5**：先排除 defect、aborted 和守护指标退化；全部目标达标优先，否则依次按配对达标组数、征服率、配对最大偏差、滚雪球排序。征服 <40% 或任一组配对越界都不能写成最终平衡通过。
5. 好战两组已达标，不允许用保守或征服改善抵消其重新越界；科技 40 若先手 >55% 必须硬排除。没有全目标候选时只输出“下一轮实验胜者”。
6. 若扩张攻城提高征服却主要翻转好战/保守胜者，应明确判为配对失败，而非视作 §2.1 的推荐转化。若所有组合仍无法改善保守对扩张，则停止同门槛微调并提交方向选择。

## 5. GDD v0.7 草案（不写入 mvp-gdd.md）

### 5.1 §3.14：D41、D42 与 D44

数值待 L1–L6 与独立样本决定。下表把 K6 当前实验值写成占位，不代表已经通过发布验收。

| 维度 | 性格 | 新文字草案 |
|---|---|---|
| 宣战时机 | 保守 | 与目标接壤（至少一座已观察对方城市距己方单位 ≤5 格）且已观察对方战斗单位数 ×2 ≤ 己方时，可以主动宣战；被宣战后正常作战 |
| 攻城时机 | 保守 | 与目标处于战争且已观察军力 ≥ 对方 1.5× 时攻城；主动宣战仍须满足宣战时机条件 |
| 攻城时机 | 好战 | 战斗单位达到 4 即向最近已知的敌方大本营推进；满足攻城条件但没有已知敌方大本营时，向最近的未探索区域或最后已知的敌方城市探索推进，寻找下一个大本营（D42） |
| 宣战时机 | 扩张 | 从不主动宣战；被宣战后正常作战（D44 不改变此行） |
| 攻城时机 | 扩张 | 被宣战后，若已观察己方战斗单位数 ≥ 对方 ×S/1000，且至少一座已观察对方城市距己方单位 ≤D 格，则可以对该交战方攻城并向最近已知的敌方大本营推进；不因此获得未知大本营搜索能力（D44） |

S 从 1500/2000 选择，D 当前实验为 5。所有军力、城市与 HQ 目标仍只来自当前可见和历史观察，休养不计入战斗单位数；最近目标与平局按现有确定性实现处理。

### 5.2 D43：当前不采用，保留条件文字

S1–S3 与 C1 未改善目标，L1–L6 又全部关闭 D43，所以当前 v0.7 草案 **不纳入 D43**。只有后续最终候选显式启用并验证胜出时，才补入以下文字：

- 好战型已经以敌方 HQ 为军事目标（含 D42 搜索）时，在现有合法候选中优先捕捉范围内可见的攻城定位野生，并优先训练已登记攻城物种；不改变捕捉概率、科技、产能、迷雾信息或单位生成规则。
- 保守型处于战争且满足攻城军力条件、但没有已知交战敌 HQ 时，按 D42 同一观察口径探索寻找下一个大本营。

### 5.3 §3.9：D44 科技计分

| 计分项 | 分值草案 | 定义 |
|---|---:|---|
| 完成科技 | ×W（W 从 30/40 选择） | 终局时刻已解锁科技数；淘汰者沿用定格快照 |

只替换科技权重，其他计分项、总分后联盟规章 ×1200/1000 取整、平分顺序与“胜者只在存活文明中产生”均不变。×40 在 K6 固定命令反事实中先手为 55.75%，不得在用户确认草案时预设它优于 ×30；若两组实跑都不合格，则保留 ×20 并报告 D44 科技方向未解决平衡，而不是暗中选择更高权重。

## 6. 授权边界

1. D44 允许扩张在战争中有条件攻城，不允许它主动宣战，也不自动批准未知 HQ 搜索、专属科技分或科技产出改动。
2. D43 当前不采用；本轮三个字段保持 0/false，避免与 D44 混杂。
3. 具体 S、D、W 只有在实验与独立样本达标后才写入正式 GDD，交用户确认；本方案不修改 `mvp-gdd.md`、AI/core、正式默认值或技术文档。
4. 当前完整补丁的新字段校验失败是预期阻塞前置，不是允许省略字段运行的理由；实现后需重新验证全部六份补丁。
