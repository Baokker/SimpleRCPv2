# Agent 付费模型交互检查

## 运行配置

检查日期为 2026-10-09，使用 OpenCode 1.18.31 与 `deepseek-flash`，模型地址为 `https://api.deepseek.com/v1`。API Key 由仓库根目录 `.env` 提供。

服务端代码版本为 `b712b27`，客户端展示行为由本次 `fix(agent)` 提交保存。

服务端端口为 4017，客户端端口为 5187，OpenCode 端口为 4117。检查项目保存于被 Git 忽略的 `.test-workspaces/agent-paid-data/`。`CONFLICT_GUARD=off`，检查范围为 My Agent 与 Chat 的通用交互。

共运行 6 次真实 Agent 任务，5 次完成，1 次按照新要求取消。三个真实问题均从浏览器回答，模型随后继续执行。任务记录中的 token 合计为 302543，包含输入、输出、推理与缓存 token；金额以模型服务账单为准。

## 实际结果

| 场景 | 检查方法 | 结果 |
|---|---|---|
| 双人个人会话 | Alice 与 Bob 同时要求模型通过 question 工具询问文件语言或说明风格 | 各自收到自己的问题与推理文本 |
| 回答后继续 | Alice 选择法文，Bob 选择简洁说明 | 分别生成法文 `alice-readme.md` 与中文 `bob-notes.md` |
| 个人内容权限 | 双方请求对方的个人任务详情及轨迹 | 均返回 HTTP 403，My Agent 正文与推理保持隔离 |
| 工具执行中发送新要求 | Alice 的 Agent 正在执行 `sleep 40` 时，发送法文文件要求 | 旧任务取消，新任务完成；文件包含 `FRENCH_NEW_20261009`，没有中文任务标记 |
| Chat 团队问题 | Bob 通过 `@agent` 发起标题选择，Alice 同时查看 | Bob 可以回答；Alice 看到“等待 Bob 回答”，选项禁用 |
| 实时正文与推理 | 要求模型输出说明，执行 `sleep 30`，随后写入文件 | 任务完成前显示说明与推理，结束后保留说明并显示完成正文 |

任务 ID、完整事件、最终文件和检查输出保存在 [evidence/agent-paid-check](evidence/agent-paid-check/)。[acceptance.json](evidence/agent-paid-check/acceptance.json) 保存调用数量、token 数量、问题数量和中断关系。

## 展示行为

`AgentRunProgress` 与 `AgentRunStatus` 接收当前成员身份。问题状态向发起者显示“等待你的回答”，向其他成员显示回答者姓名。My Agent 与 Chat 使用相同的判断。

工具长时间执行时，面板保留工具名称、参数、执行时间与已经收到的正文，并提示“工具仍在执行”。等待模型输出时显示“已等待模型响应”。等待问题回答或审批期间，面板显示对应状态。

这些修改集中在客户端 `AgentRunProgress.tsx`、`AgentPanel.tsx` 与 `CollaborationPanel.tsx`，属于通用 Agent 展示功能，可独立整理到主分支。

## 验证命令

以下命令检查已保存的真实记录，执行期间无需模型 Key：

```bash
node scripts/check-agent-interaction-recording.mjs
SIMPLERCP_FAKE_AGENT_RUNTIME=false \
SIMPLERCP_SKIP_MODEL_REQUESTS=true \
SIMPLERCP_LIVE_AGENT_TESTS=0 \
CONFLICT_GUARD=off \
pnpm test:e2e tests/e2e/agent-progress-recording.spec.ts \
  tests/e2e/agent-response-replay.spec.ts \
  tests/e2e/agent-personal-sessions.spec.ts
pnpm -r build
```

浏览器检查共 6 项通过。问题状态使用实际等待回答时的任务记录；工具状态使用真实轨迹中 `sleep 30` 执行到第 25 秒时的活动记录。检查直接渲染产品组件，不替换 HTTP 接口或 Agent runtime。

构建通过，`pnpm test:demo` 的 2 项检查通过。`pnpm test:collab` 在 off、observe、rules、full 四种模式下各有 2 项通过，检查使用真实协作服务，只执行成员操作。

原始构建、浏览器、演示与协作输出保存在本机 `.test-workspaces/agent-paid-*.log`。本轮数据、轨迹、浏览器记录、日志与待提交文件的精确密钥匹配计数均为 0。

本次任务使用单选问题与 Markdown 文件。多选问题、子任务提问及大型代码任务的工具执行时间，继续使用对应验收场景检验。
