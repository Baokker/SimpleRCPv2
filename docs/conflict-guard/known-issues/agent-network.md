# Agent 网络错误诊断

2026-10-08 的原始 run `_3IyfXyObhle` 以 `fetch failed` 结束，历史记录没有保存 HTTP 状态、请求目标或 error cause。因此无法确定该次失败来自模型服务、本机 OpenCode HTTP 连接或网络中断。空 reasoning 文本与 session busy 状态不能用于确定网络错误来源。

当前失败记录保存 phase、source、errorType、statusCode 或 errno、请求目标和最后成功事件序号。`local-runtime` 指向服务端访问本机 OpenCode 的请求，`model-provider` 指向 OpenCode 返回的模型服务错误，`server` 指向服务端执行错误。请求目标移除认证信息和查询参数。

401、403 提示检查 API key 与 DEEPSEEK_BASE_URL；400、404 提示检查模型名称与端点。连接中断、超时、429 和服务端暂时不可用允许重新发起任务，已归属的文件修改继续保留。任务失败后仍执行可用的 T3 检查，并在 run 记录中保存执行结果。

本轮环境检查还发现 HTTP 客户端会拒绝 4190 端口，cause 为 `bad port`。人工验收使用 4195 端口通过。端口问题可通过 `/api/agent/status` 查询，不需要发起模型任务。默认 OpenCode 端口为 4096。历史 run 缺少 cause，无法将其归因于此端口问题。
