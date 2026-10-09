# Agent 会话与交互

My Agent 展示当前成员自己的会话、任务、实时活动与推理文本。个人任务详情、轨迹读取和轨迹下载只允许属主访问，WebSocket 也按成员发送。Chat 中的团队 Agent 任务供项目成员共同查看。

每个个人会话页签提供关闭按钮。确认删除后，服务端取消该会话的活动任务，页面移除会话。已经写入的文件继续保留，任务记录与轨迹留在项目元数据中，供审计使用。

向同一会话发送新要求时，服务端取消之前的活动任务，记录中断关系，再调度新要求。新任务使用当前文件内容继续执行。不同会话保持并发执行。Chat 中再次提及同一个团队 Agent，也会中断该 Agent 当前的任务。

OpenCode 的 `question.asked` 会在 My Agent 或对应 Chat 任务中显示问题、选项和补充回答输入框。任务发起者可以发送回答或跳过问题；其他团队成员可以看到等待状态。问题支持单选、多选及自由输入，以 OpenCode 提供的字段为准。等待回答期间暂停任务超时计时。问题等待上限为五分钟，取消任务、删除会话和关闭服务时也会结束待回答的问题。

集成使用 OpenCode 1.18.31 的 `question.reply`、`question.reject` 和 `session.abort`。请求通过已安装 SDK 发出。

## 人工检查

1. Alice 与 Bob 在两个浏览器中加入同一项目，各启动一个个人任务。My Agent 仅显示自己的运行内容；在 Chat 提及团队 Agent 时，团队任务仍共同可见。
2. 在同一个个人会话中发送“用中文编写 README”，随即发送“改为使用法文”。第一项任务显示中断，新任务按法文要求继续。已经完成的文件修改继续保留。
3. 让 Agent 在修改前使用 question 工具询问一项选择。点击选项并发送回答，确认任务继续；也可以跳过问题或取消任务。
4. 点击会话标题旁的关闭按钮并确认。刷新页面后，该会话不再显示，已经写入的文件仍然存在。

## 验证

`agentPrivacy.test.ts` 通过真实 HTTP、文件存储与服务重启检查个人任务详情、轨迹下载权限及会话删除状态。`agentQuestions.test.ts` 检查回答校验、计时暂停、问题超时和取消清理。验证不请求模型服务。

这些功能属于通用 Agent 交互，可独立整理到主分支。相关文件为 `agentVisibility.ts`、`agentQuestions.ts`、`agentSessionStore.ts`、`agentSessionAccess.ts`、`agentRunManager.ts`、`openCodeRuntime.ts`、`agentRoutes.ts`、`realtime.ts`，以及客户端 `AgentPanel.tsx`、`AgentQuestions.tsx`、`AgentRunProgress.tsx` 和 `CollaborationPanel.tsx`。
