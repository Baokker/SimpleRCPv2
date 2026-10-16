# 阶段 A 工程修复与结果核查

日期：2026-10-17。分支：`feature/conflict-guard`。

## 当前实现

| 项目 | 当前行为 | 验证材料 |
|---|---|---|
| 服务端候选保留 | 服务端与轨迹使用同一个 `pairRevisionMode`，编辑中的半成品暂时失去语义关系时保留候选，批次结束后执行判定。 | `conflictGuardPending.integration.test.ts` 使用真实 Yjs 文档；初次判定及关闭过程通过轨迹回放核验。 |
| 变量声明证据 | 从 TypeScript AST 保存原始声明前缀，向模型提供完整变量声明；箭头函数和函数表达式的结构化签名排除函数体，保留变量类型标注。 | `declarations.test.ts` 覆盖十项，包括 const、let、var、数组、多变量、新增、删除和未完成初始化。 |
| Jev 错误分类 | 无效 JSON 统一记为 `invalid-json`；代理连接错误记为 `proxy-*`。批量录制只在代理连接故障时终止。 | 使用 `Response.json()` 产生真实解析异常；真实 fetch 验证代理连接拒绝及 MiniMax 直连。 |
| 候选关闭原因 | `PairRecord.closeReason` 与 `pair_closed` 事件记录关闭原因；同时取消该候选的排队工作与进行中的研判。 | 服务端测试覆盖语义修改消失、关系消失、变更结束；全部开发集离线回放保存在 `review-validation.json`。 |
| 灰区统计范围 | 同时提供共同 61 个轨迹、新增 6 个轨迹和全部 67 个轨迹的质量统计。预先登记的选择仍使用共同样本。 | `selection-final.json` 的 `qualitySubsets`；`stage-a-verify.ts` 从原始录制独立核对分子与分母。 |

关闭原因包括 `no-semantic-change`、`relation-removed`、`change-set-closed`、`candidate-filtered`。直接使用底层候选协调器时，缺少会话信息的关闭记为 `candidate-removed`。这些标识用于轨迹与调试。

`d1-0066-safe` 的最终修改仅包含注释与空白。离线回放记录的关闭原因是 `no-semantic-change`；原始模型录制保持不变。

## 开发集结果

| 所选 Jev 策略的统计范围 | 判定一致 | 漏阻断 | 安全误拦 | 安全提醒 |
|---|---:|---:|---:|---:|
| 共同灰区 | 31/61 | 7/12 | 1/49 | 22/49 |
| 新增灰区 | 2/6 | 2/3 | 0/3 | 2/3 |
| 全部灰区 | 33/67 | 9/15 | 1/52 | 24/52 |

这些数字来自已有真实录制。所选提示词仍为 `pair-v1`，级联对照阈值仍为 `0.2`，进入 P4 的灰区策略仍为 Jev 单独快判。选择规则文件保持原始内容。

灰区质量尚未达到要求。工程验证通过只能说明本轮修复能够按预期运行；模型质量由对应输入的真实响应决定。

## 输入与录制兼容性

当前代码离线回放 119 个开发集轨迹，得到 194 份唯一输入，其中 70 份声明完整、124 份语法不完整。186 份输入可以直接对应已有录制，8 份输入的内容有变化。差异来自变量声明前缀和结构化签名，逐项 JSON 差异保存在 `review-validation.json` 的 `missingInputs`。

变化的输入中，3 份声明完整，涉及 `d1-0021-conflict`、`d1-0066-safe`、`d1-0117-conflict`；另有 5 份语法不完整，继续遵循等待和编辑结束后提醒的处理方式。当前代码的模型质量需要补充这 3 份完整输入对应的响应。原始质量表继续描述录制时的配置。

原始 `prepared.json.gz`、模型缓存及各条件的 `results.json.gz` 保留录制时的内容与源码哈希。`review-validation.json` 单独保存当前代码的核查结果；缺少录制的输入不会计作新的模型质量结果。

本轮新增模型调用 0 次，新增 Agent run 0 次，新增模型费用 0。重新冻结、保留集和 Agent 场景等待阶段确认。

## 验证命令

| 检查 | 结果 |
|---|---|
| 全部项目构建 | 通过 |
| conflict-guard 包测试 | 35 个测试文件、301 项通过 |
| 服务端全部测试 | 310 项通过，9 项真实接口测试按配置跳过 |
| 演示测试 | 2 项通过 |
| 四种模式协作浏览器测试 | 每种模式 2 项通过，共 8 项 |
| 阶段 A 脚本 TypeScript 检查 | 通过 |
| 原始录制离线核验 | 通过，核对 350 条级联响应及三个灰区子集统计 |
| 当前代码开发集核查 | 119 个轨迹无回放异常，全部关闭事件包含原因 |

在仓库根目录执行：

```sh
pnpm -r build
pnpm --filter @simplercp/conflict-guard test
SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm --filter @simplercp/server test
pnpm test:demo
CONFLICT_GUARD=off SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab
CONFLICT_GUARD=observe SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab
CONFLICT_GUARD=rules SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab
CONFLICT_GUARD=full SIMPLERCP_FAKE_AGENT_RUNTIME=false SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-summary.ts --phase final
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-review.ts
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-write-report.ts
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-verify.ts
```

本机日志保存在已忽略的 `.test-workspaces/review-fix-*.log`。机器可读的实验核查结果保存在 `verification.json` 与 `review-validation.json`。
