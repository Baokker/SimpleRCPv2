# 阶段 1：语义冲突预防地基

更新时间：2026-10-05

`@simplercp/conflict-guard` 提供来源编辑模型、字符范围变换、编辑批次、活跃变更集、内存光标和轨迹回放校验。服务端接入 `CONFLICT_GUARD=off|observe|rules|full`；`off` 不创建 tracker、不取 Git 提交号、不监听 Yjs，也不创建轨迹文件。`rules` 和 `full` 当前复用 observe 行为并写启动提示。

文本镜像发生不一致时，服务端更新镜像和 tracker，并写入包含替换全文的 `mirror_resync` 事件。回放校验把该事件作为文件的新起点，继续检查后续 edit。观察器、光标回调和轨迹写入都在边界处记录错误并继续协作路径。敏感文件 `.env`、`.env.*`、`*.pem` 和 `*.key` 只写 `doc_open` 的跳过记录；其他文件只按服务端已知的精确密钥值脱敏，普通代码字符串不会触发替换。脱敏文件在后续事件中标记 `redacted: true`，校验结果列出 `redactedFiles`；敏感文件列出 `skippedFiles`。

变更集在首个文件加入后发出 `change_set_opened`，文件因空闲或停用移出时发出 `change_set_file_closed`。只有参与者没有任何打开批次时，变更集才变为 `settled`。光标在服务端内存中保留每个成员最近一次位置，状态接口返回这些光标；写入轨迹的光标事件按 200 毫秒窗口节流。轨迹序列跨服务会话继续递增，`validateTrace` 按多个 `session_start` 继续校验整份文件。

## 测试结果

包内范围、批次、光标和轨迹回放测试共 16 项通过。服务端冲突防护集成测试共 5 项通过，覆盖具体范围、文件系统回灌、敏感模式和服务重启后的整份轨迹校验；实时消息测试覆盖光标回调异常时仍广播。

真实浏览器双上下文观察原始记录位于 `evidence/stage-1-manual/`。两名成员通过 Playwright CLI 加入同一 demo 项目，交替编辑 `src/index.js`；记录包含 state 返回的批次范围、最终文件内容、轨迹下载和 `validateTraceDetailed` 的校验结果。`observe-integration.json` 是服务端集成测试的独立记录。
