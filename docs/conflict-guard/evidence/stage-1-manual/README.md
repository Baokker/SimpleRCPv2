# 阶段 1观察记录

记录由真实 Yjs WebSocket provider、服务端 observe 模式和两个独立浏览器会话产生。两名成员交替编辑同一个文件，随后读取 state 接口和 trace 下载接口，并使用 `validateTraceDetailed` 校验整份轨迹。`browser-state.json` 与 `browser-trace.jsonl` 是浏览器观察的原始接口输出，`browser-observation.json` 保存范围、最终文件内容和校验摘要；`observe-integration.json` 保存服务端集成测试的独立记录。记录中没有密钥。

提交 `0cd88f6` 的双浏览器验收记录位于 [self-acceptance](../self-acceptance/README.md)，包含完整命令、配置、原始接口输出和行号。该次首末编辑相隔 170929 毫秒，每名成员形成 3 个关闭批次，轨迹回放通过并与磁盘全文一致。
