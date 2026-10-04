# Provider 运行观察

`scripts/verify-opencode-concurrent-diff.mjs` 使用本地 `.env` 配置启动 OpenCode runtime，并在两个 session 中执行不同文件和同一文件修改。原始输出保存在 `../stage-0-session-diff.json`，输出中没有密钥。两个场景的 `session.diff` 都返回空数组，工作区文件仍然产生修改；因此归属判断使用工具台账和工作区快照。

浏览器双上下文的 DeepSeek 观察已完成三个场景：不同文件并发写入、同一文件并发写入、成员在 Agent 运行期间编辑文件。原始 run、工具完成事件、最终文件内容、`agent_overlap` 和 `concurrent_change` 位于 `deepseek-browser.json`。同一文件场景最终保留了双方新增函数；成员编辑场景记录了 `concurrent_change`，最终文件以 Agent 的写入结果为准。
