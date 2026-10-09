# Agent 交互与任务意图检查

## 个人 Agent 与团队 Agent

My Agent 的会话、运行内容、推理文本、详情和轨迹下载按属主限制。HTTP 接口与 WebSocket 使用相同的可见范围。Chat 中的团队 Agent 任务供项目成员共同查看，问题由本次任务发起者回答。

个人会话标题提供删除按钮。删除操作会取消活动任务并保存会话删除状态，已经写入的文件保留。向同一会话发送新要求时，服务端按会话串行处理取消与创建，记录前后任务的中断关系。不同会话继续并发执行，Chat 对同一个团队 Agent 的连续要求也使用此处理。

OpenCode question 工具通过 SDK 的 `question.reply` 与 `question.reject` 连接到公共回答组件。问题支持选项、多选和自由输入。等待回答期间暂停任务计时，等待上限为五分钟。回复请求具有十秒期限；取消、删除和服务关闭都会清理待回答问题。

通用功能的文件清单与人工检查步骤见 [Agent 会话与交互](../foundation/agent-session-behavior.md)，对应独立的 `fix(agent)` 提交。

- `ddd0750`：个人会话可见范围、问题回答、会话删除与连续指令中断。
- `924cb05`：OpenCode question 工具配置与实际服务查询检查。

## 冲突预防面板

说明区使用“面板功能”和“将协作者之间的冲突分为三种等级”。每位成员可以在待了解列表、检查记录和页面提醒中点击“我已了解”。确认状态持久保存，其他成员独立确认；检查记录继续保留。

提醒内容指纹参与确认标识，内容变化会再次提醒。确认接口同时检查属主、修订号与内容指纹，过期请求返回 409。

## 任务与计划协商

任务开始、计划更新及实际范围变化都会检查其他活动 Agent 的任务。相同促销目标要求不同折扣时，规则识别明确目标冲突；full 模式同时使用 DeepSeek 检查任务与计划要求。跨属主冲突生成意图差异卡片，并在任务执行前或下一次写入审批时等待协商。双方采纳的方案进入后到任务的提示或审批回复。

同属主冲突等待关联任务结束，等待上限为两次。取消任务会释放协商等待；活动对手全部参与检查，每批并发上限为五个。模型失败通过通知提示，写入前检查继续执行。

具体流程见 [意图与属主仲裁](arbitration.md)。

## 验证范围

使用实际 HTTP、文件存储和两个浏览器上下文验证会话隔离、会话删除、提醒确认与刷新保持。问题处理测试覆盖答案校验、暂停计时、等待超时、回复期限和取消清理。意图检查测试覆盖折扣目标冲突、双方采纳、同属主等待、多个对手及取消处理。

本次验证不请求付费模型服务，不启动真实 Agent 任务。模型端到端的问题回答、任务中断和计划协商仍需按人工检查步骤验证。

| 验证项目 | 结果 |
|---|---|
| `pnpm -r build` | 通过 |
| conflict-guard 包完整测试 | 262 项通过 |
| 服务端完整测试 | 302 项通过，9 项按配置跳过 |
| OpenCode 实际工具查询 | 1 项通过，未发送模型任务 |
| 意图、问题与活动状态补充检查 | 15 项通过 |
| 新增双浏览器检查 | 2 项通过 |
| 已有说明、筛选、列表、横幅与面板检查 | 6 项通过 |
| `pnpm test:demo` | 2 项通过 |
| `pnpm test:collab` | off、observe、rules、full 各 2 项通过 |
| API Key 精确值检查 | 匹配计数 0 |

测试命令设置 `SIMPLERCP_LIVE_AGENT_TESTS=0`、`SIMPLERCP_SKIP_MODEL_REQUESTS=true`。浏览器会话与协作检查还设置 `SIMPLERCP_FAKE_AGENT_RUNTIME=false`，通过实际 HTTP 与浏览器操作验证。完整测试沿用仓库已有测试集合。

原始输出保存在本机忽略目录 `.test-workspaces/`：`agent-revision-package-final.log`、`agent-revision-server-complete.log`、`agent-revision-opencode-tools.log`、`agent-revision-final-focused.log`、`agent-revision-final-browser.log`、`agent-revision-conflict-browser.log`、`agent-revision-final-build-check.log`、`agent-revision-final-demo-check.log` 与 `agent-revision-collab-<模式>.log`。深浅主题的首屏截图与协作状态记录位于 `evidence/ui-information/`。
