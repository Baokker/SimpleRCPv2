# Agent 人工验收

适用分支：`main`。My Agent 与 Chat 共用 OpenCode 1.18.31 的会话、事件、问题回答和停止接口。

## 启动

在仓库根目录执行：

```bash
cp .env.example .env
```

在 `.env` 填写以下配置，API Key 使用自己的密钥：

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-flash
SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3
SIMPLERCP_AGENT_WAITING_MS=20000
SIMPLERCP_AGENT_STALLED_MS=60000
```

```bash
pnpm install
pnpm dev:stable
```

打开 `http://127.0.0.1:5173`。`dev:stable` 的服务端运行期间保持当前代码，修改代码后需要重新启动。日常开发可以使用 `pnpm dev`，服务端会随代码变化重新启动。重新启动期间出现连接错误时，等待启动日志出现后刷新页面。

## My Agent

使用两个独立浏览器加入同一项目，分别命名为 Alice 与 Bob。

1. 两人在 My Agent 中各自添加会话并发送任务。每个人只看到自己的正文、推理、问题和文件列表。Chat 的团队任务供项目成员共同查看。
2. 在个人会话中发送“用中文编写 README”，任务运行期间发送“改为使用法文”。任务记录显示前一项已经中断，新要求使用当前文件继续执行。已经完成的修改继续保留。
3. 点击任务的停止按钮。状态变为已取消，工具停止后不会继续执行后面的修改。
4. 要求 Agent 使用 question 工具询问文件语言。选择选项或填写补充回答，点击“发送回答”，确认任务继续执行。也可以跳过问题。
5. 点击会话标题旁的关闭按钮并确认。刷新后会话保持删除状态，已经写入的文件继续保留。
6. 使用中文输入法输入任务，按 Enter 确认候选文字，任务保持未发送状态。
7. 展开“工作详情”，查看推理和工具操作。模型提供推理文本时逐步显示；没有推理文本时显示相应说明。等待模型与工具执行分别显示持续时间。

## Chat Agent

1. 发送 `@agent 为项目编写中文使用说明`。对应聊天消息下面显示任务、正文、工具和文件结果。
2. 任务运行时点击“停止任务”。停止请求发送期间按钮显示“正在停止”。
3. 任务运行时再次发送 `@agent 修改要求：请使用法文编写说明`。旧任务中断，新任务继续执行；两人都能查看中断记录。
4. 要求 Agent 使用 question 工具询问文档语言。发起者可以回答，另一位成员看到回答者姓名与等待状态。
5. 中文输入法确认候选文字时，消息保持未发送状态。

## 失败处理

失败任务显示操作建议，错误详情包含阶段、请求位置、HTTP 状态或网络错误编号以及最后成功事件。网络错误允许重试；密钥、模型名称或服务地址错误需要修改配置。失败和取消后已经登记的文件变化继续显示。服务重新启动中断的任务会转为失败状态并提供重试提示。

个人任务的重试继续使用原会话。Chat 任务的重试创建关联聊天消息，保留团队可见性。

## 真实验证记录

2026-10-09 使用真实 DeepSeek-flash 与两个 Chromium 浏览器完成检查。当前检查目录共保存 11 次真实任务，包含调试任务：6 次完成、5 次取消；任务记录的 token 合计为 250001，包含缓存与推理统计，费用以模型服务账单为准。

[acceptance.json](evidence/main-agent-check/acceptance.json) 中的个人隐私、两种输入框的输入法处理、个人中断、会话删除、Chat 停止、Chat 中断、问题回答、共享进度、正文和推理检查全部通过。完整任务与事件保存在同一目录。

- [个人任务实时活动](evidence/main-agent-check/01-personal-live.png)
- [Chat 问题回答](evidence/main-agent-check/02-chat-question.png)
- [Chat 新指令中断](evidence/main-agent-check/03-chat-interrupted.png)

这些截图通过浏览器保存，验证使用 DOM、HTTP 权限结果与最终文件内容。

真实检查命令需要配置 API Key，并产生模型费用：

```bash
pnpm --filter @simplercp/server exec tsx ../../scripts/verify-agent-acceptance.mjs
```

回归结果：全部工作区构建通过；服务端 110 项通过，9 项付费检查按显式开关跳过；浏览器 23 项通过，8 项按运行条件跳过；演示检查 2 项通过。浏览器回归包含双人协作、会话删除、输入法、真实记录中的正文与工作详情。

```bash
pnpm -r build
pnpm --filter @simplercp/server test
SIMPLERCP_FAKE_AGENT_RUNTIME=false \
SIMPLERCP_LIVE_AGENT_TESTS=0 \
SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e
pnpm test:demo
```

模型没有保证每次都调用指定工具。验收脚本在任务完成前未出现预期工具时直接报告失败，不将文字回复算作文件操作完成。

## 当前范围

正文、推理、问题、工具状态、中断和取消通过 OpenCode 接口实现。已完成的工具修改保留；共享目录中的全文覆盖风险见 [已知问题](../product/known-issues.md#ki-013-agent-与-agent-在共享目录中并发写可能互相覆盖)。本轮真实任务覆盖单选问题与 Markdown 文件；多选、子会话提问和大型项目继续使用相应场景验证。
