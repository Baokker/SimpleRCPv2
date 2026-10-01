# 轻量身份验证报告

## 自动验证

当前分支在 `2026-10-01` 完成以下结果：

- `pnpm build`：通过。
- `pnpm test`：21 个 Vitest 文件、82 项通过；Demo 测试 2 项通过。
- `pnpm test:e2e`：14 项通过、2 项跳过。跳过项是录制用例与 Agent Key 未配置时的终端禁用流程；终端禁用单独命令通过。
- `pnpm test:e2e:terminal-disabled`：1 项通过。

新增测试覆盖成员 ID 创建与恢复、Role 保存、未知项目成员头返回 401、HTTP 聊天归属、WebSocket 身份绑定、终端输入归属和聚合、同名成员 session 隔离、旧目录迁移重跑、子进程环境白名单、trace/activity/chat 脱敏。

## 6.2 手工验证

使用 `pnpm dev:demo` 等价开发配置启动服务，浏览器通过 DOM、HTTP 与真实 WebSocket 完成验证，结果保存在本地 `.test-workspaces/manual-results.json`。

1. 两个浏览器上下文分别加入。一个 Role 为 `student`，另一个留空。两次刷新后的成员 ID 保持不变，成员列表显示 `student`；文件协作、聊天、终端和 Agent run 均完成。
2. 终端输入记录归属于 `Manual Student`，聚合次数为 212；聊天记录归属于 `Manual Student`；两个 Agent run 的 `initiatorMemberId` 和 `initiatorRole` 与请求者一致。
3. 终端 `env | grep -i -E 'key|token|secret'` 输出为空且退出码为 1；`ls ..` 只有 `demo`；`cat ../chat.json` 返回 `No such file or directory`。
4. Agent 运行 `env` 与读取 `../chat.json`，输出确认 `DEEPSEEK_API_KEY_PRESENT=true`、`METADATA_READ_ALLOWED=false`。这是 OpenCode bash 继承 Agent 环境的已知局限。
5. 检查 5 个 trace、activity 和 chat 文件，未找到模型 Key 明文。

当前 `pnpm dev` 已验证启动，地址为 `http://127.0.0.1:5176`；验证进程随后已停止。
