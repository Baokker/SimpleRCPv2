# freeze-v3 执行审查

## 冻结状态

当前标签 knowledge-exp-freeze-v3 指向 `76ed3f8757a999c7c58c9a65596552fcee5e0148`。实验实现、数据、提示词、阈值、判定器和配置保持冻结。模型服务与调度器已停止。实验一报告与实验二补算不依赖新的模型调用，均已完成；实验三保存43条判定结果，实验四尚未启动。

项目 package.json、pnpm-lock.yaml、openCodeProcess.ts 的 OPEN_CODE_VERSION 和实验 runtime-status.json 均使用 OpenCode 1.18.31。该记录没有显示运行二进制发生变化，版本事实本身不构成重新运行已完成任务的依据。

## 实验四的入口与证据

无模型复现命令，在平台目录执行：

```sh
pnpm --filter @simplercp/experiments experiment verify --shared-episode
```

结果为 ERR_PARSE_ARGS_UNKNOWN_OPTION，退出码1。formal-run.ts:10 使用 --shared-episode，cli.ts:14 只声明 sharedEpisode。formal-run.ts:10 的 EXP4 count 为54，而 k4.ts:294 只按两个条件写入结果，18个片段最终为36条。

k4.ts:198 在 Ta 前调用 capture/disable；server-routes.ts:75 调用 capture.dispose。captureService.ts:126 在 disposed 时直接结束 feed，processNow 中的 agentRunChanges 无法记录。server-routes.ts:185、196 要求从该记录核验纠正前文件；缺少 expectedBefore 时请求失败。该流程同时无法观察 naturallyTriggered。

k4.ts:230 附近每片段调用 teamRun 启动纠正 Agent。六份 correction.json 均为 revise、atSeconds=0；本轮指定流程可在 Ta 完成判定后直接使用 Yjs 更新参考文件并发送纠正原文，再调用 recap-from-episode。该接口支持省略 correctionRunId。

## 成员身份与统计

k4.ts:283 使用新项目 members[0] 发起 Tb；server-routes.ts:43 将导入卡片的 ownerMemberId 改为请求成员，:45、46同时改写作者和确认人。provider.ts:262 只在卡片属主与任务发起人不同的情况下记录 firstInjectedByOtherAt。当前流程不能得到要求的跨成员首次注入指标。

analysis/analyze.py:46 按 task、condition 聚合重复。共享片段比较需要使用 pair、repetition 组成的片段编号，保留每个 Ta 的资格与T0/T3配对结果。

## 实验三的调度与费用

k3.ts:99 的 wait 允许返回 failed，:106随后直接写入 completed 结果，没有把额度中断传给调度器。common.ts:142 的 pool 只在处理函数抛出异常时停止取出新组合，并等待其他工作完成，没有取消另一正在运行的任务。当前批次没有额度失败，所需中断行为尚未通过验证。

provider.ts:167 的重排 onResponse 回调没有保存响应，用量与费用缺少依据。已知43条完成记录加一个 completed 未收集任务的 Agent 估算费用为19.89174516元；取消任务用量与重排费用未知。完整状态见 [实验三报告](exp3/report.md)。

## 已授权的执行范围

用户已确认修复下列问题，建立 `knowledge-exp-freeze-v3.1`，并独立执行完整实验三和实验四。正式协议见 [freeze-v3.1.md](freeze-v3.1.md)。

以下修改需要新的冻结版本：

1. CLI 支持正式的 --shared-episode 参数；EXP4 完成检查使用36条 Tb 结果，并另行核验18个共享片段。
2. Ta 保留捕获服务；在 Ta 完成并判定后执行 Yjs 纠正、聊天说明与复盘，省略额外纠正 Agent；检查修改后的项目行为。
3. 在独立 Tb 项目中保存甲、乙、纠正者、属主和确认者的映射，由乙发起 Tb。确认时间保持来自共享片段，首次注入时间来自乙的 trace。
4. 片段级统计使用 pair 与 repetition，分别报告 Ta 实际踩坑子集和全部18个片段；保存草稿结构、引用、确认修改与成本记录。
5. 额度中断时保存证据、停止调度并取消当前任务；恢复时不把取消状态当作完成组合跳过。
6. 保存重排模型响应的用量与估算费用；每次重排请求保持失败直接采用 BM25、不重试的规则。
7. 完成真实接口、命令与调度测试，执行数据校验、pnpm build、pnpm test 和实验工具测试；记录代码与配置哈希后创建 knowledge-exp-freeze-v3.1。

检索参数、卡片、数据、任务提示和判定规则保持固定。已有43条记录与中断证据保留，新版本独立执行198次实验三。
