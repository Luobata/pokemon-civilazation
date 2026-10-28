# 历史实验工具

这些工具保留 M5 平衡迭代的诊断和报告逻辑。它们依赖当时的数据目录、manifest、补丁和规则版本，不是当前发布验收入口；长期工具及正式默认值的复现见 [../README.md](../README.md)。从仓库根目录运行，具体参数见各文件头部和 Usage。

| 归档文件 | 历史用途 |
| --- | --- |
| `diagnose-capture.ts` | 早期 AI 捕捉诊断，只支持对应的默认内容重放 |
| `reclassify.ts` | 按 D38 重新分类旧记录的命令拒绝，只支持对应的默认内容重放 |
| `balance-diagnostics.ts` | 早期平衡诊断，后续 B4–B6 复用其分布统计 |
| `b3-report.ts` | I 组候选报告及当时的排名规则 |
| `b4-diagnostics.ts` / `b4-report.ts` | J 组诊断与报告 |
| `b5-diagnostics.ts` / `b5-report.ts` | K/S/C 组诊断与报告 |
| `b6-diagnostics.ts` / `b6-report.ts` | L 组诊断与报告 |
| `b7-report.ts` | M 组报告、D45 评估和排名；`assessD45` 也曾被 M6 证明脚本导入 |
| `balance-final-report.ts` | M5-11 历史收尾报告，包含当时的候选选择逻辑 |

原 `tools/<文件>.ts` 路径统一改为 `tools/archive/<文件>.ts`，例如：

```sh
node tools/archive/b4-diagnostics.ts /path/to/historical-run /path/to/diagnostics.json
node tools/archive/b7-report.ts /path/to/sim-root /path/to/proof /path/to/report.md
```

历史报告里“最终候选”“正式默认值未修改”等表述只描述当时的实验阶段。尤其 `balance-final-report.ts` 根据保存的逐局结果是否一致选择 1500 的旧逻辑，不能代表后续 D46 决策：中间攻城伤害曾出现差异，最终正式采用的是已验证的 **1750**，不是 1500。归档保留历史逻辑，不重写过去的实验结论。

归档模块会导入当前 core/AI；移动目录不会自动冻结旧引擎。若要重放早期实验，应使用匹配的历史代码版本和原 manifest，部分字段补丁继承的新默认值可能已不同。只读取旧统计数据的报告也可能有当时专用的目录命名和阈值。

`tests/tools/archive/b3-report.test.ts` 与 `b7-report.test.ts` 保留原断言，仍参与全量测试。共享报告中的旧脚本不在此次修改范围内；在新版本使用时需要同步其导入路径，或回到生成证据时的代码版本运行。
