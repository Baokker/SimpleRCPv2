# 冲突预防界面修复复核

日期：2026-10-08。分支：`feature/conflict-guard`。审查范围：`9365ee9` 至 `111e492`，以及本次修复。人工步骤见 [manual-acceptance.md](manual-acceptance.md)。

## 当前行为与验证位置

| 项目 | 当前行为 | 代码与测试 |
|---|---|---|
| 同声明四状态检查 | 远距离修改仍检查基线、单方与合并状态。只有合并出现的重复变量错误触发黑区。独立、共享和先后编辑文本均可构造四状态。 | `routing/typecheck.ts`、`rules/declaration-body-unrelated.ts`；`comment-body.test.ts` 的独立与共享文本用例；服务端重复变量集成用例 |
| 推断返回类型 | 函数、方法、变量与类属性中的函数表达式通过真实 TypeChecker 比较返回类型。数字返回值改为字符串时保持黑区。 | `routing/typecheck.ts`；`comment-body.test.ts` 的函数、类属性 ArrowFunction 与 FunctionExpression 用例 |
| JavaScript 文件 | `.mjs`、`.cjs` 与其他受支持扩展名能够执行四状态检查。 | `routing/typecheck.ts`；两项扩展名用例 |
| 注释与代码混合修改 | 累计修改按完整本人文本计算语义范围。代码与逐字符注释、成对块注释、长注释同时修改时，变化的代码 token 决定范围。 | `semantic/trivia.ts`、`semantic/changes.ts`、`tracking/tracker.ts`；包内混合修改用例及服务端内容保存、回放检查 |
| 有效代码被注释禁用 | 函数内部有效语句被注释时保留语义变化。整个声明被注释时记录该成员的符号删除，仍然存在的调用触发黑区保护。 | `semantic/changes.ts`、`tracking/tracker.ts`；整个声明被注释的包内与服务端用例 |
| 全文替换归属 | 同一次替换按实际文本变化计算范围，普通插入与删除保留原操作位置。范围外的声明删除只归属于执行删除的成员。 | `tracking/textDiff.ts`、`tracking/tracker.ts`、`semantic/changes.ts`；包内全文替换删除归属用例及服务端混合注释用例 |
| T0 | 批次从空白或暂时无法解析的文本开始，后续有效代码仍可在批次结束前收到一次提示。 | `coordination/session.ts`；服务端两项 T0 用例，检查提示序号与回放一致性 |
| Agent T3 | T2 与 T3 保留实际语义修改范围。T3 根据当前共享文本移动位置，并保留删除符号与 `changedSymbols` 限定。服务端与回放历史保存范围对应的文本。 | `coordination/agentGuard.ts`、`replay/agents.ts`、服务端 `projectAgentGuard.ts`；`agentGuard.test.ts` 的 T2/T3 一致性用例 |
| 轨迹验证 | Agent API 测试等待对应 run 的 `run_completed` 事件，然后检查完整事件、连续序号与下载结果。通知测试分别检查摘要、建议、来源与文件。 | 服务端 `agentRunApi.integration.test.ts`；`adjudication/warnings.test.ts` |

语义范围使用 TypeScript AST 与现有 `diffArrays`。字符串、正则、JSX 文字及自动分号插入引起的语法变化继续参与检查。修改行范围合并重复项，普通范围仍用于保存与撤回。全文替换按文本前后的实际差异维护归属，原始操作保留在轨迹中；服务端混合注释测试包含一次全文替换与另一成员的后续编辑。

## 验证

服务端新增时序用例使用 `idleMs=1500` 与默认 300ms 磁盘写入延迟。新增验证使用真实 TypeScript、Yjs、`createApp` 与浏览器 DOM。原有测试按仓库配置执行。

| 检查 | 本次最终验证 |
|---|---|
| `pnpm -r build` | 通过 |
| conflict-guard 常规包测试 | 24 个文件、249 项通过 |
| 离线 CLI 订阅录放测试 | 1 项通过，包含三轮跨进程结果一致性；另一项长时间 CLI 用例没有在最终代码上重复执行 |
| 服务端回归 | 45 个文件、282 项通过；排除两个真实端点测试文件 |
| `pnpm test:demo` | 2 项通过 |
| 浏览器回归 | 15 项通过，覆盖阶段三清单、协作干预、幽灵成员回放与界面布局 |
| 四种模式协作 | `off`、`observe`、`rules`、`full` 各 2 项通过，共 8 项 |
| 新轨迹回放 | 判定、写入闸门、文件写入、冻结均无差异；`errors=[]` |
| 密钥精确值扫描 | 匹配计数为 0，包含压缩日志内容 |

测试命令、数量与压缩日志见 [验证记录](evidence/ui-round1-review/verification.json)。浏览器回归更新了 `checkpoint-a-manual/` 的截图与 `stage-4-ui/trace.jsonl`。判定、写入闸门、文件写入和冻结的 `replay:check` 无差异。

类型检查保护的反向检查覆盖三项用例，全部能够检测保护条件缺失。新增类属性返回类型、成对注释、T3 范围和整个声明被注释的用例也分别验证了预期行为。

## 配置与使用范围

继续使用 `routing-ui-1` 与 `CONFLICT_GUARD_BODY_ADJACENT_LINES=3`。本次没有新增环境变量。远距离修改的灰区警告要求四状态检查完成、公开接口与推断返回类型保持不变；暂时无法解析或检查超时时保留同声明黑区保护。

阶段七已有 40 次真实 Agent 运行记录。本次排除 `agentRunApi.integration.test.ts` 与 `openCodeRuntime.integration.test.ts`，合计 9 项真实端点用例。Agent API 的完成事件等待条件已按真实 WebSocket 消息结构核验，修改后的真实端点用例尚未重复执行。阶段五真实模型与阶段七真实 Agent 浏览器验收也没有在本次重复执行。

正式实验配置需要在人工确认后重新冻结。本次仅执行开发集离线回归，没有执行保留集或正式实验。
