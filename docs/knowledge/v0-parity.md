# Knowledge v0 parity

本报告记录旧 `open-collaboration-knowledge` 与新 `@simplercp/knowledge` 的确定性回放。旧结果来自 `code/experiment_artifacts/automated_experiments_summary_2026-07-14.md` 和旧仓库报告，新结果来自 `packages/knowledge/bench/results/`。

## 确定性指标

| 实验 | 旧结果 | 新结果 | 说明 |
| --- | --- | --- | --- |
| 锚点 336 案例，range-only | 25.0% | 24.65% | 新基准从当前仓库收集 48 个样本，样本文件集合不同 |
| 锚点 336 案例，snapshot-only | 50.0% | 49.65% | 同上 |
| 锚点 336 案例，multi-strategy | 91.7% | 91.32% | 同上；新结果为 263/288 个可定位案例 |
| 触发阈值 240 案例，六类最小 F1 | 1.000 | 1.000 | 阈值与边界保持一致 |
| 检索 Lexical Recall@1 | 24.2% | 30.83% | 新词法分数增加精确 token 优先级，已在阶段报告记录 |
| 检索 File-only Recall@1 | 100% | 100% | 构造语料的活动文件命中 |
| 检索 Type-only Recall@1 | 60.8% | 58.33% | 新 schema 与排序 tie-breaker 产生差异 |
| 检索 File+Type Recall@1 | 100% | 100% | 活动文件命中保持 |
| 错误文件+类型 Recall@1/@3 | 0% / 63.3% | 0% / 62.5% | 错误活动文件仍会影响排序 |
| 缓存陈旧结果 | 0/20 | 0/3 | 新回放使用 20 张卡、3 次试验；内容指纹失效保持 |
| 状态门控 Recall@1 | 首次运行 | 82.5% → 85.83% | `reviewed-only` 相对未过滤结果；不安全卡曝光率 71.67% → 0% |

计时结果只用于描述当前机器：锚点 p50/p95、检索 p50/p95、规模构建与查询耗时、缓存耗时均写在对应 `summary.json` 中。

## 行为差异

新包去除了协议文件系统与旧 AI SDK，改为显式 `cards[]` 或工作区目录，LLM 改为 `LlmClient`。schema 从 v2 升级到 v3，v1/v2 通过纯函数迁移；卡片可为空锚点，确认、作用域和复用门控由 `confirmCard`、`isReusable` 提供。词法分数保留旧命中权重与活动文件加分，并增加精确 token 的轻微优先级，以保证规模实验中带编号 token 的目标卡稳定排在首位。
