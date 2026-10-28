# B5：第四轮平衡迭代方案

> 本文只设计实验与 AI 实现提案，不修改 GDD、正式数值或代码。共同底座为 J8（J6+D42）；K1–K6 的效果均为待模拟验证的假设。目标是保持征服 ≥40%，同时将三组性格配对拉回 40–60%。

## 1. 输入与第三轮结论

输入为同一 100 种子、300 局的 I1、J1–J8。原始数据在共享报告区 `reports/sim/m5-7-i1`、`m5-7-j1` … `m5-7-j8`；汇总证据为 `sim-balance-b4.md` 和 `m5-7-proof/`。

| 方案 | 征服 | 平均终局 | 1v3 | 好战对扩张 | 好战对保守 | 保守对扩张 |
|---|---:|---:|---:|---:|---:|---:|
| I1 | 27.33% | 89.15 | 95.33 | 45.45% | 47.06% | 12.12% |
| J1 | 29.00% | 88.12 | 94.31 | 45.45% | 51.47% | 15.15% |
| J2 | 29.00% | 88.12 | 94.31 | 45.45% | 51.47% | 15.15% |
| J3 | 30.67% | 87.41 | 93.79 | 50.00% | 48.53% | 12.12% |
| J6 | 33.67% | 86.22 | 92.47 | 50.00% | 52.94% | 16.67% |
| J7 = I1+D42 | 43.33% | 82.24 | 89.97 | 68.18% | 66.18% | 12.12% |
| J8 = J6+D42 | 46.33% | 79.98 | 88.12 | 69.70% | 69.12% | 16.67% |

J8−J6 增加 D42 后，征服 +12.67 个百分点，1v3 −4.35 轮，但两组好战胜率分别 +19.70、+16.18 个百分点。1v3 好战第三 HQ 席位 28→41，首夺到征服 31/74→43/77，说明目标连续性确实有效，也同时打破性格平衡。第四轮不能只撤掉 D42：J6 就是现成的关闭对照，征服仅 33.67%。

J1/J2 有 296/300 逐局一致，全部 300 局胜者、终局方式和轮数相同；J2 只多 2 次宣战。因此只能说主动宣战倍率 1500 与 2000 在本样本产生相同结果，不能泛化为所有军力门槛都无效。攻城倍率实验 J4 则与 I1 的 300 局逐字节一致，但没有攻城定位对城攻击，尚未形成实战暴露。

固定 100 种子仍是探索样本；最终发布候选必须按 D18 使用独立新种子。

## 2. 保守对扩张：真正的瓶颈在宣战之后

### 2.1 66 局专门漏斗

脚本 `/tmp/balance_m5_iter4_analysis.mjs` 只抽取保守/扩张配对，输出 `/tmp/balance_m5_iter4_analysis.json` 和 `.stdout.json`。进攻攻城、HQ 均按保守主动战争归因。

| 批次 | 保守胜 / 征服胜 | 宣战席位（次数） | 首宣战中位 | 攻城席位 | HQ 席位 | 宣战后无 HQ |
|---|---:|---:|---:|---:|---:|---:|
| I1 | 8 / 0 | 0（0） | — | 0 | 0 | 0 |
| J1 | 10 / 2 | 39（42） | 47 | 30 | 2 | 37/39 |
| J2 | 10 / 2 | 40（43） | 48.5 | 30 | 2 | 38/40 |
| J6 | 11 / 3 | 39（43） | 47 | 30 | 3 | 36/39 |
| J8 | 11 / 3 | 39（43） | 47 | 30 | 3 | 36/39 |

D41 不是未触发，也不是已经解决：它开放了路线，但 J8 仍有 36/39 个宣战席位没有 HQ。J8 的 226 次主动战争城市攻击只有 3 次 HQ 占领，瓶颈是宣战后的目标与攻城转化。

### 2.2 军力、接壤、已知 HQ 和攻城门槛分解

`/tmp/balance_m5_iter4_conservative_gates.mjs` 重放 J8 的 66 局，并在每条已接受命令前用 `observe` 重建保守视角。输出为 `/tmp/balance_m5_iter4_conservative_gates.json` 和 `.stdout.json`。决策点不是独立回合或独立样本，只用于比较门槛暴露。

| 条件 | 决策点 | 至少出现一次的席位 |
|---|---:|---:|
| 军力 2000 + 接壤 1，可主动宣战 | 43 | 39 |
| 军力 2000 + 接壤 5，可主动宣战 | 1223 | 49 |
| 军力 1500 + 接壤 5，可主动宣战 | 1311 | 50 |
| 战争中军力 2000 满足攻城 | 1577 | 39 |
| 战争中军力 1500 满足攻城 | 2028 | 39 |
| 其中 1500 相对 2000 的新增暴露 | 451 | 20 |
| 军力 2000 + 已知 HQ | 967 | 27 |
| 军力 1500 + 已知 HQ | 1335 | 27 |

- 接壤 1→5 有明确的新增暴露：潜在宣战席位 39→49，值得单测 K3。
- 在接壤 5 下，宣战倍率 2000→1500 只增加 1 个潜在席位；重复测试 `conservativeDeclareStrength` 的优先级低。
- `conservativeStrength` 是另一个字段。降到 1500 在 20 席增加 451 个攻城决策点，但“军力+已知 HQ”席位仍为 27，所以它更可能增加已有目标的攻击窗口，而非解决目标缺失。
- 39 个宣战席位只有 15 个实际攻击过 HQ；HQ 攻击 80 次、普通城市攻击 146 次。17 席曾满足军力 2000 但没有已知 HQ，610 个军力满足决策点缺少已知 HQ。保守型也存在目标发现问题，不能直接照搬好战 D42 而不验证。

### 2.3 当前定位没有稳定的科技或计分补偿

J8 保守对扩张的终局差值（保守−扩张）：

| 城市 | 科技 | 人口 | 物种 | 维护 | 总分 |
|---:|---:|---:|---:|---:|---:|
| -2.44 | -0.53 | -6.26 | -2.12 | -5.85 | -276.76 |

“科技 > 经济 > 防御军事”没有产生科技领先。科技每点 20 分，单靠增加科技补 276.76 分需要 +13.84 点，超过整棵 12 节点科技树；扩张也会继续研究。尤其在科技差为负时，直接提高通用科技分权重会扩大而非缩小差距。

**条件性结论**：若 K3–K6 仍不能把保守对扩张带入 40–60%，应明确判定：在当前征服/计分条件和现有 AI 下，保守定位没有与扩张型相称的稳定胜利路线。它不是逻辑上的 0%——D41 已有 3/66 征服胜——但继续微调同一组门槛不能被视为可行解法。

届时由用户选择方向，而不是暗中改规则：

1. **让科技真正转化为经济/军事产出**，先形成实际科技领先，再评估通用科技计分权重；若给保守专属科技分或专属产出，属于性格与计分规则改动。
2. **补保守型的战争目标寻找/持续推进**，例如已宣战且满足攻城条件但没有已知 HQ 时探索目标。D42 只批准好战型，保守版本需另行裁定。
3. **接受非对称强度**，修改“所有配对 40–60%”验收目标；这只能由用户决定。

## 3. 攻城定位零对城攻击的原因

### 3.1 不是“没有训练或没有用于任何战斗”

`/tmp/balance_m5_iter4_siege.mjs` 重放 J8 全部 300 局，逐事件核对捕捉、登记、训练、进化和攻击，终局 canonical 全部一致。输出为 `/tmp/balance_m5_iter4_siege.json`、`.stdout.json`。

| 性格 | 席位 | 登记攻城物种 | 捕捉尝试/成功 | 训练数（席位） | 对单位攻击 | 对城攻击 | 投石科技席位 | 登记+科技席位 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 好战 | 267 | 0 | 2 / 0 | 0（0） | 0 | 0 | 22 | 0 |
| 保守 | 267 | 3 | 12 / 3 | 0（0） | 7 | 0 | 1 | 0 |
| 扩张 | 266 | 20 | 48 / 20 | 40（10） | 141 | 0 | 5 | 0 |
| 合计 | 800 | 23 | 62 / 23 | 40（10） | 148 | 0 | 28 | 0 |

300 局初始野生攻城物种 235 只、后续刷新 154 只，不是地图完全不提供。实际结论是 **攻城定位有登记、有训练、有对单位战斗，但对城攻击为 0**：

- 好战型是首要断点：267 席没有登记任何攻城物种，只有 2 次捕捉尝试且全失败，所以即使 22 席研究投石改装也没有载体。
- 扩张型登记 20 席、训练 40 只，证明现有训练公式并非永远排除攻城物种；但其规则是不主动攻城，自然没有对城攻击。
- 保守型只登记 3 席且没有训练，样本太小，不能据此归因全部保守败因。
- 没有任何席位同时“已登记攻城物种+完成投石改装”。即使先制造出对城攻击，也必须区分有/无科技，不能立刻宣称 1750 倍率有效。

现有训练收益为 `A+D−成本`。小拳石为 99，是基础物种最高值；大岩蛇 140、隆隆石 136、隆隆岩 178 也靠前排。扩张型实际训练与此一致。因此只改训练不能解决好战型零登记，必须同时处理获取。

### 3.2 AI 实现规则提案：“攻城筹备”

**提案**：当好战型已经以敌方 HQ 为军事目标（包括 D42 的寻找目标状态）时，在当前合法候选上增加定位偏好：

1. 对位于现有 `aggressiveCaptureRadius` 内、已可见且原本可捕捉的攻城定位野生，捕捉及向其移动的候选增加 `aggressiveSiegeCaptureBonus`。不改变捕捉概率、球消耗或迷雾信息。
2. 对已经登记的攻城物种，军事训练候选增加 `aggressiveSiegeTrainingBonus`。没有登记仍不能训练，不生成免费单位，也不绕过科技和产能。
3. 新增两个整数补丁字段，默认 0，保证旧批次逐字节复现。先分别测试 `(100,0)`、`(0,100)`，再测 `(100,100)`，以分离获取与训练；它们不放入本轮 K1–K6，避免新旧字段混杂。
4. 必报好战登记→训练→对单位→对城→有科技对城漏斗。若仍无投石科技暴露，再单独评估研究优先级，不在本提案预先加第三个杠杆。

§3.14 规定性格目标与时机，没有规定具体训练物种；本提案只调整 AI 在现有合法候选间的排序，属于 **AI 实现细节，Hub 可裁定**，不需要用户新增玩法授权。若改成玩家规则“任何文明必须优先攻城兵种”或修改捕捉/训练规则，则超出本提案并需要用户决定。

## 4. 共同底座与第四轮补丁

六个补丁都显式保留 J8 及其默认保守门槛：

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 3,
    "aggressiveSiegeUnits": 3,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 1,
    "conservativeStrength": 2000,
    "conservativeSettlerInterval": 15
  }
}
```

本轮只使用已实现字段，不使用 §3.2 的新提案字段，也不改物种或 D15。机器补丁为 `/tmp/balance_m5_iter4_patches.json`，六份均通过完整 `parsePatch`；结果和 SHA-256 在 `/tmp/balance_m5_iter4_patch_validation.json`。J6 作为 D42 关闭的已有对照，J8 为共同对照，不重复消耗一个补丁编号。

### K1：好战攻城与 D42 触发回到 4 兵

假设：推迟普通攻城和未知 HQ 搜索，可将两组好战胜率拉回 40–60%，同时保留足够 D42 清场收益。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 3,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 1,
    "conservativeStrength": 2000,
    "conservativeSettlerInterval": 15
  }
}
```

对比：K1−J8 只差 `aggressiveSiegeUnits` 3→4。现有实现让该字段同时控制普通攻城和 D42 搜索资格，因此这是一个“攻城/搜索共同触发”因子，不能再把差值拆成二者各自贡献。

### K2：好战开拓队门槛提高到 4 城

假设：减少好战后续经济扩张和军力补充，可降低其胜率而不直接关闭 D42。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 3,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 1,
    "conservativeStrength": 2000,
    "conservativeSettlerInterval": 15
  }
}
```

对比：K2−J8 只差 `aggressiveSettlerCities` 3→4；需同时报告开拓队、城市、维护、3/4 兵时点，不能把间接军力变化当作直接 D42 调整。

### K3：保守接壤距离放宽到 5

假设：增加主动宣战席位和战争覆盖，能改善保守对扩张；重点看新增宣战是否转化为 HQ，而非只看命令数。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 3,
    "aggressiveSiegeUnits": 3,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 2000,
    "conservativeSettlerInterval": 15
  }
}
```

对比：K3−J8 只差 `conservativeBorderDistance` 1→5；宣战倍率仍 2000。

### K4：保守和平开拓间隔缩短到 8

假设：提高和平期城市与科研供给，缩小计分差距并增加军力承载；战争期仍禁止保守开拓，不能假设所有阶段都加速。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 3,
    "aggressiveSiegeUnits": 3,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 1,
    "conservativeStrength": 2000,
    "conservativeSettlerInterval": 8
  }
}
```

对比：K4−J8 只差 `conservativeSettlerInterval` 15→8。B3 的旧样本已证明单独经济加速收益有限，本轮只检验 D41+D42 新上下文，不预设它能独立达标。

### K5：保守攻城军力倍率降到 1500

假设：扩大已经宣战后的攻城窗口，提高城市/HQ 转化；它不改变主动宣战条件。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 3,
    "aggressiveSiegeUnits": 3,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 1,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 15
  }
}
```

对比：K5−J8 只差 `conservativeStrength` 2000→1500；`conservativeDeclareStrength` 保持 2000。需单列已知 HQ 条件，避免把增加的无目标攻城窗口误报为有效征服路线。

### K6：好战回调 + 保守三杠杆组合

假设：若 K1/K2 能保留足够征服并降低好战胜率，K3–K5 又能改善保守路线，组合才可能全达标；它不是单因子证据。

```json
{
  "balance": {
    "city": { "baseHp": 60, "capturedHp": 60 },
    "effects": { "siegeMultiplier": 1750 },
    "score": { "cities": 80 }
  },
  "ai": {
    "aggressiveSettlerCities": 4,
    "aggressiveSiegeUnits": 4,
    "aggressiveWarStrength": 1250,
    "aggressiveSeekUnknownHq": true,
    "conservativeMayDeclareWar": true,
    "conservativeDeclareStrength": 2000,
    "conservativeBorderDistance": 5,
    "conservativeStrength": 1500,
    "conservativeSettlerInterval": 8
  }
}
```

对比：K6 精确叠加 K1–K5，总交互残差为 `K6−K1−K2−K3−K4−K5+4×J8`。残差只表示五项合并未被主效应解释的部分，不能拆成任意两因素的贡献。

## 5. 运行与胜者选择

1. 六组均跑同一 100 种子、300 局，保留 manifest、patch SHA、逐局命令与遥测；同 patch 双跑验证确定性。J8 在新代码上应与已有 J8 一致，否则停止跨版本比较。
2. 除 B4 全部指标外，必报：
   - K1/K2：好战开拓队、城市/维护、首次 3/4 兵、D42 搜索次数与后续 HQ 转化。
   - K3：按 §2.2 口径的潜在/实际宣战席位、首次宣战、已知 HQ 席位及 HQ 占领，不用宣战次数替代胜率。
   - K4：和平期开拓队、城市/科技/人口及保守对扩张计分差。
   - K5：2000/1500 的可攻城暴露、已知 HQ 暴露、实际 HQ 攻击与占领。
   - 所有组：保守对扩张的宣战→攻城→HQ→征服漏斗，以及攻城定位的登记/训练/对城分类，确认 1750 是否终于有暴露。
3. 沿用 B4 §5：先排除 defect、aborted 和守护指标退化；全部目标达标优先，否则按配对达标组数、征服率、配对最大偏差、滚雪球排序。征服 <40% 或任一组配对越界都不能写成最终平衡通过。
4. 不得因组合组总分或征服最高而忽略好战两组重新越界；也不得用保守的小幅改善抵消征服跌回 40% 以下。
5. 没有全目标候选时只输出“下一轮实验胜者”。若保守仍失败，采用 §2.3 的条件性结论并提交用户方向选择，不继续无依据微调。
6. 阈值附近按 D18 追加新种子；最终候选另跑独立发布样本。

## 6. GDD v0.7 §3.14 草案（不写入 mvp-gdd.md）

D41 沿用 B4 §6；D42 补入好战攻城单元格。具体兵数、距离和倍率待 K1–K6 与独立样本决定。

| 维度 | 性格 | 新文字草案 |
|---|---|---|
| 宣战时机 | 保守 | 与目标接壤（已观察的对方城市距己方单位 ≤1 格）且已观察的对方战斗单位数 ×2 ≤ 己方时，可以主动宣战；被宣战后正常作战 |
| 攻城时机 | 保守 | 与目标处于战争且已观察军力 ≥ 对方 2× 时攻城；主动宣战仍须满足宣战时机条件 |
| 攻城时机 | 好战 | 战斗单位达到门槛即向最近已知的敌方大本营推进；满足攻城条件但没有已知敌方大本营时，向最近的未探索区域或最后已知的敌方城市探索推进，寻找下一个大本营 |

目标搜索仍只使用当前可见与历史观察，不读取未探索格或隐藏 HQ；最近目标与平局按现有确定性实现处理。K3 的 5 格、K5 的 1.5 攻城倍率不预写进 D41 草案。

## 7. 授权边界

1. §3.2 的两个攻城筹备字段是 AI 排序实现提案，默认 0；由 Hub 按实现细节裁定，不在 K1–K6 中隐式启用。
2. 保守版未知 HQ 搜索不在 D42 授权内；若 K3/K5 证明“已宣战但无目标”仍是主阻点，需另派方案与裁定。
3. 科技专属计分、科技产出规则、接受保守较弱或修改 40–60% 目标，均需用户决定。
4. 本轮不采用物种补丁、保守捕捉范围或新计分结构；不修改 `mvp-gdd.md`、AI/core 或正式默认值。
