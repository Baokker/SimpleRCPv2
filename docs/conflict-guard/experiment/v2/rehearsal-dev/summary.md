# 开发集彩排（阶段 B3）

数据为 D1-v4 开发集，代码为 `feature/conflict-guard` 的 `4f2af80`（E1、E2）与 `f83d346`（E3）。模型缓存不入库，留在本地各目录的 `model-cache/` 中，供回放复核。

## 目录

| 目录 | 内容 | 复算命令（在本目录执行） |
|---|---|---|
| `configs/` | G1、G2-v5、G3a 研判配置与 E3 运行配置 | |
| `E2-grey/round-{1,2,3}/` | 灰区三轮配对录制，`round-1-replay/` 为第 1 轮按缓存回放 | `python3 analysis/e2_metrics.py E2-grey/round-*/*/results.json.gz` |
| `E1/main/` | P0、P1、P2、P3、P4、P* 回放，P4 使用第 1 轮 G3a 录制 | `python3 analysis/e1_analysis.py E1/main/results.json.gz E1/ablation/results.json.gz` |
| `E1/ablation/` | 去掉四状态类型检查，单独录制 | 同上 |
| `E4-performance/` | 索引全量与增量开销，k=2 | 见 `E4-performance/summary.md` |
| `E3-agent/` | 场景文件 `scenarios-v2.json`；`pass2-P0`、`pass2-P5` 为修正后的完整一遍；`pass1-*`、`smoke-*`、`timing-*` 为修正过程中的记录，不作为结果 | |
| `analysis/` | 分析脚本、三轮汇总 `e2-dev-3rounds.json`、E1 汇总 `e1-dev.json`、冻结统计截止时间 `freeze-cutoffs-dev.json` | |

## 结论摘要

E2 三轮平衡准确率均值为 G1 79.2%、G2-v5 86.1%、G3a 89.3%。E1 中 P4 的平衡准确率为 87.9%，与 P1、P2、P3 的差异在 Holm 校正后都显著。去掉四状态类型检查后质量不变，模型研判次数由 82 增至 105。E4 索引全量构建 p50 约 18 ms，增量更新 p50 约 9 ms。E3 修正后 A1 与 A0 各成功 5/6。详细数字见论文仓库 `projects/03-点二_语义冲突预防/进展.md`。

## 冻结前需要同步到正式材料的修改

1. `E3-agent/runtime-config.json` 的 `t1Strategy` 改为 G3a，`t2Reasoning` 改为 false，以 `configs/runtime-config-E3.json` 为准。
2. `E3-agent/scenarios.json` 以 `E3-agent/scenarios-v2.json` 替换。
3. E2 的 G1 配置 `t1Strategy` 改为 G2，G3a 配置开启推理，以 `configs/` 为准。
4. E2 第 2、3 轮的缓存目录按轮次分开。
5. 协议中的代码提交改为包含 `f83d346` 的提交。
