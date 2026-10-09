# Agent 交互检查

## 交互行为

- My Agent 与 Chat 的 Agent 卡片使用 `AgentResponse` 展示实时助手正文。文本按照 OpenCode 的 part ID 保存，完整消息更新替换对应片段，文本增量追加到该片段。用户提示和推理文本分别处理。取消、失败和完成后保留已接收的内容。
- My Agent 直接接收 WebSocket 的任务状态，工具和问题状态随服务端更新显示。会话列表每五秒刷新。
- 个人会话分别保存尚未发送的提示与文件选择，切换会话或 Chat 后保持。发送请求只清理提交时的草稿，新输入继续保留。中文输入法的确认操作不会发送任务。
- 消息列表在阅读较早内容时保持当前位置，在列表末尾时跟随新输出。
- OpenCode 连接准备期间接收取消操作，发送提示前检查取消状态。
- 待回答问题的状态发布与问题拒绝分别执行。状态文件写入失败会记录诊断，清理过程继续完成。回答和跳过分别显示确认提示。

## 文件与函数

| 功能 | 文件与函数 |
|---|---|
| 正文保存与增量处理 | `apps/server/src/agent/agentProgress.ts`：`createAgentProgress` |
| 正文展示 | `apps/client/src/components/AgentResponse.tsx`：`AgentResponse` |
| 草稿、实时任务与阅读位置 | `apps/client/src/components/AgentPanel.tsx`：`AgentPanel`；`CollaborationPanel.tsx`：`CollaborationPanel` |
| 任务更新 | `apps/client/src/App.tsx`：`agent_run_updated` 处理 |
| 发送前取消 | `apps/server/src/agent/openCodeRuntime.ts`：`run`、`cancel` |
| 问题清理 | `apps/server/src/agent/agentQuestions.ts`：`dispose` |
| 问题确认文字 | `apps/client/src/components/AgentQuestions.tsx`：`QuestionForm` |

这些功能属于通用 Agent 交互，使用独立的 `fix(agent)` 提交，供以后整理到主分支。

## 验证

正文检查使用 `evidence/round2-dual-agent/run-UlCzhJhKE5Dl.jsonl` 中已经保存的真实 OpenCode 轨迹。测试分别验证增量期间的部分正文、完整更新后的内容、用户提示隔离，以及浏览器中的公共正文组件。

OpenCode 集成检查启动本机安装的 1.18.31，通过 SDK 创建会话并立即取消发送操作，检查会话消息列表为空。模型请求地址限定为不可用的本机端口，没有发送付费模型请求。问题清理检查使用实际文件写入失败与本地 OpenCode SDK。

浏览器会话检查通过实际 HTTP 服务验证会话隔离、删除、草稿切换及中文输入确认。测试未使用接口拦截或新增模拟运行时。

| 检查 | 结果 |
|---|---|
| `pnpm -r build` | 通过 |
| 服务端完整测试 | 305 项通过，9 项按配置跳过 |
| 冲突预防协调测试 | 33 项通过 |
| 会话与真实正文回放浏览器检查 | 3 项通过 |
| `pnpm test:demo` | 2 项通过 |
| `pnpm test:collab` | off、observe、rules、full 各 2 项通过 |

服务端测试设置 `SIMPLERCP_LIVE_AGENT_TESTS=0` 与 `SIMPLERCP_SKIP_MODEL_REQUESTS=true`；浏览器检查同时设置 `SIMPLERCP_FAKE_AGENT_RUNTIME=false`。

原始输出保存在本机忽略目录 `.test-workspaces/`：`agent-review-server.log`、`agent-review-coordination.log`、`agent-review-browser-verified.log`、`agent-review-build-verified.log`、`agent-review-demo.log` 与 `agent-review-collab-<模式>.log`。

本轮没有真实模型任务。模型生成问题后的完整回答流程和运行中工具的中断行为，仍以人工检查材料规定的步骤验证。
