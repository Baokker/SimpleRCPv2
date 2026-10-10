# 检查点 C 冻结准备

日期：2026-10-10。协议：`checkpoint-c-v2`。状态：准备受阻，等待有效快判录制与阈值校准；`protocol.json` 保持 `awaiting-human-confirmation`。正式 X1 至 X7、保留集策略评价均未执行。

当前源码、数据与证据提交为 `ec8bd54c2f4a4e46397ab077581b852fe97190b4`。协议与测试记录引用该提交；完整冻结生成时还需核验对应的代码哈希。

Jev 的真实诊断请求返回 HTTP 451：`Typesafe is not available in your region.` 当前环境未取得有效快判结果。推荐阈值为 `null`，完整冻结材料、调用预算估计和 20% 标签抽检导出尚未重新生成。`freeze.json`、`budget.json`、模型配置及 label-audit 的完整导出，需要在校准完成后由 `experiment:freeze` 生成并验证。

当前代码和实验入口见 [protocol.json](protocol.json)，修复、测试与数字证据见 [实验前报告](../review-fix-preexperiment.md)。正式入口检查准备状态和人工确认状态，当前会终止执行。

## 已准备的数据与配置

| 内容 | 当前值 | 证据 |
|---|---|---|
| D1 | d1-v3，240 关系组，开发 115、保留 125 | [data-check.json](../evidence/preexperiment/data-check.json) |
| 开发灰区安全补充 | 40 个 allow 关系组，标签来自四状态可执行探针 | [data-check.json](../evidence/preexperiment/data-check.json) |
| 保留集 | 程序与标签逐项核验相同，未执行策略评价 | [data-check.json](../evidence/preexperiment/data-check.json) |
| D2 | 51 条来源案例，6 个独立演示场景 | 仓库内 manifest 与真实来源夹具 |
| D3 | 13 任务对，其中跨属主 10、同属主 3 | 仓库内 manifest 与任务验收程序 |
| 深判与 MiniMax Agent | MiniMax-M3，国内站 https://api.minimaxi.com/v1 | [MiniMax 探测](../evidence/minimax-probe/selection.json)、[Agent 冒烟](../evidence/minimax-agent-smoke/verification.json) |
| 快判 | jev-1.13.0，当前返回地区限制 | [Jev 诊断](../evidence/preexperiment/jev-diagnostic.json) |
| 统计 | Wilson 95%；关系组 McNemar；Holm；bootstrap 2000 次、种子 20261007 | [指标与统计](metrics-and-statistics.md) |
| 级联阈值 | 等待有效快判结果，recommended=null | [校准状态](../evidence/preexperiment/calibration/calibration.json) |

MiniMax 价格日期为 2026-10-10，国内站标准档每百万 token 输入 CNY 2.1、输出 CNY 8.4、缓存命中 CNY 0.42。原币种费用单列，预算换算使用 CNY 7 = USD 1。已有录制与模型响应归档保留。

## 完整冻结的完成条件

取得有效 Jev 开发集结果后，复用身份一致的已有 MiniMax 缓存，完成一次开发集阈值校准及级联验证。校准只使用开发集，保留集不参与。

源码和实验入口提交后，在 `protocol.json` 中登记对应 `codeCommit`，准备状态登记为 `ready`。随后生成代码、数据、配置、提示词、指标、价格、预算与标签抽检的全部哈希，并执行完整性验证。协议继续等待人工确认。

```sh
pnpm --filter @simplercp/conflict-guard experiment:freeze
pnpm --filter @simplercp/conflict-guard experiment:freeze --verify
pnpm --filter @simplercp/conflict-guard experiment:verify
node scripts/verify-evidence-secrets.mjs
```

准备状态受阻时，生成命令会终止。人工确认前不执行正式实验。
