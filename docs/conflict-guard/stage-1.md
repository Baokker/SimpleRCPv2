# 阶段 1：语义冲突预防地基

更新时间：2026-10-05。修复基线：`36c3ba7`。本轮修改尚未推送。

## 观察行为

`@simplercp/conflict-guard` 提供编辑来源、字符范围变换、编辑批次、活跃变更集、内存光标和轨迹校验。服务端支持 `CONFLICT_GUARD=off|observe|rules|full`；`off` 不创建 tracker、执行 Git、监听 Yjs 或创建轨迹文件。`rules` 和 `full` 当前使用 observe 行为并输出启动提示。启用观察时，服务启动读取一次提交编号。

镜像不一致时，服务端使用 `fast-diff` 生成 filesystem 编辑操作交给 tracker，已有批次和活跃文件范围继续保留并随差异移动。服务端写入带有替换全文的 `mirror_resync`；回放继续检查后续编辑。文件系统回灌通过 `applyTextDelta` 更新 Yjs，修改来源为 `filesystem`。`revisionAfter` 使用 collaborativeDocuments 写入后的真实 revision。观察器、光标处理与轨迹写入错误会记录并让 guard 进入降级状态，协作继续运行。

`.env`、`.env.*`、`*.pem`、`*.key` 文件只登记 `{ file, skipped: "sensitive" }`。其他文本按服务端已知的精确敏感值脱敏，`loadConfig` 收集 `DEEPSEEK_API_KEY` 和 `TYPESAFE_API_KEY`。文件的任意编辑出现这些值后，后续该文件事件持续带有 `redacted: true`；服务重启从现有轨迹恢复这个状态。`validateTraceDetailed` 返回 `redactedFiles` 和 `skippedFiles`，脱敏文件跳过文本操作和哈希核验。普通代码标识符保持原文。

`change_set_opened` 包含首个文件；文件停止活动时登记 `change_set_file_closed`。参与者的全部批次关闭后变更集状态为 `settled`，新编辑使状态成为 `editing`。state 接口保留成员最近一次光标；cursor trace 每 200 毫秒窗口登记最后一个位置。`/ws` 完成广播后保存有效光标，缺字段消息继续广播。state、trace 和 done 接口检查成员身份与项目存在情况。

轨迹序列跨服务会话继续递增。`session_start` 保留文本、批次、变更集和脱敏状态，整份轨迹按连续 `seq` 校验。包构建只输出产品文件。

## 自动测试

阶段 1 的原始验收记录见 [self-acceptance/README.md](evidence/self-acceptance/README.md)；第二轮错误隔离、resync、轨迹脱敏与 revision 修复的测试结果见 [review-fix-round2.md](review-fix-round2.md)。当前分支的完整检查命令与结果记录在阶段 2 报告。

范围测试核验插入、范围内部与边界删除、替换、多操作的累计位置变化、光标切换文件、双方交替编辑的具体范围。轨迹测试核验跨会话状态、普通代码、首次 edit 脱敏、敏感文件、resync、交换事件顺序和篡改编辑内容。服务端 `conflictGuardApi.integration.test.ts` 的 9 项测试核验真实 Yjs 与 WebSocket 路径，包括每人 3 个批次、精确字符范围、前方插入后的精确位移、filesystem 回灌、逐字符输入敏感值、`/ws` 光标窗口与缺字段广播、重启后的整份轨迹、语义错误降级与轨迹写入重试。`conflictGuardOff.test.ts` 经 `loadConfig` 配置 off，并让 Git 不可用，服务仍正常启动且没有轨迹文件。

## 双浏览器观察

以 `CONFLICT_GUARD=observe`、`PORT=4201`、`SIMPLERCP_TERMINAL_ENABLED=false` 启动服务端，数据目录为仓库下 `.test-workspaces/observe-acceptance`；客户端使用 `VITE_SIMPLERCP_API_ORIGIN=http://127.0.0.1:4201`、端口 5176。两个独立 Playwright CLI 会话通过键盘交替编辑 `src/index.js`，成员为 Observe Alice 和 Observe Bob。采集命令：`node scripts/verify-conflict-guard-evidence.mjs 84385647-c90e-4213-8780-e1a6f88274be`。

首末 human edit 相隔 170929 毫秒。每名成员形成 3 个关闭批次，关闭原因均为 `idle`。字符范围采用左闭右开区间，行号按采集时文本换算；换行符也属于对应范围。

| 成员 | 批次数 | 范围 | 对应行号 |
| --- | --- | --- | --- |
| Observe Alice | 3 | `[0,22)`、`[42,64)`、`[84,106)` | 1–2、3–4、5–6 |
| Observe Bob | 3 | `[22,42)`、`[64,84)`、`[106,126)` | 2–3、4–5、6–7 |

state 中两个变更集均为 `settled`，保留各自三个范围和最新光标。`validateTraceDetailed` 返回 `{ valid: true, redactedFiles: [], skippedFiles: [] }`，回放文本与磁盘最终文件完全一致。原始 state、trace、批次与行号、最终全文分别保存于 `self-acceptance/browser-state.json`、`browser-trace.jsonl` 和 `browser-observation.json`，命令输出为 `browser.log`。服务与客户端输出保存在同目录的 `observe-server.log` 和 `observe-client.log`。完整启动命令与键盘操作见该目录 README。`stage-1-manual/` 保留另外一份双浏览器及服务端集成记录。
