# E5 纠正迁移（K4）

## 研究问题

确认纠正卡片后，另一成员的 Agent 能否在后续任务中得到同一条团队知识，并减少重复陷阱。

## 条件与运行

v2.1 正式路径使用平台 `k4`，统一 `minimax / MiniMax-M3`。冻结标签 `knowledge-exp-freeze-v2.1`，平台提交 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`，数据提交 `ea11a85ed344c522fe3b63288cd8577c94fa6498`。manifest 哈希 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`，配置哈希 `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。

核心矩阵为6对、T0/T1/T3、两种时间变体、3次重复，共108组合。主表只使用 Ta 功能通过且实际踩坑的组合，另报告全体及条件间 Ta 结果不一致的清单。M3 校准36次中33次功能通过、23次功能通过且踩坑，P06-Ta三次均避开陷阱，见 `preparation-v21.md`。该校准不属于正式样本。

T0 不向 Tb 提供纠正知识。T1 使用固定注入的 context 卡片，正文包含完整纠正原文和真实 Ta diff 的增删行摘要，总计最多800字符。T3 由真实服务端复盘生成草稿，确认采用冻结的 `review-rules.json`：指定标识符缺失或草稿兜底时使用 gold 的标题、摘要、类型和正文；适用文件不全时补充范围。每次记录修改字段与增删字符数量。这个主对比评价预设确认规则下的纠正迁移，真实成员的编辑行为由 pilot 单独观察。

每个组合中 Ta 由甲通过团队 Agent 执行，纠正成员修改代码并在同一团队会话提交纠正原文，Tb 由乙的个人 Agent 执行。`same-session` 表示卡片确认后立即执行 Tb，乙使用自己的个人会话；`delayed` 等待固定60秒。卡片从确认到首次提供给乙的时间来自 reuse 记录。

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E5-core E5-core
```

正式目录为 `experiments/knowledge/runs/E5-k4-core-formal-v21-m3/`，在 E4 第一批完成并检查后执行。

## v2 试跑（MiniMax-M2）

v2 试跑使用 P01、P03，各运行 T0 与 T3 delayed，各1次。T3 通过 `recap-from-episode` 直接记录纠正建议，结果包含 `captureBypassed: true` 与 `naturallyTriggered`。

```sh
pnpm --filter @simplercp/experiments experiment k4 \
  --config experiments/knowledge/.work/e4-config.json \
  --pilot --variants delayed \
  --out experiments/knowledge/runs/E5-k4-pilot-v2
```

## 结果

| 组合 | Ta 功能 | Ta 踩坑 | Tb 功能 | Tb 避开陷阱 | 目标卡片注入 | 自然触发 |
|---|---|---|---|---|---|---|
| P01-T0 | 通过 | 是 | 通过 | 是 | 否 | — |
| P01-T3 | 通过 | 是 | 通过 | 是 | 是（lexical） | 否 |
| P03-T0 | 失败 | 否 | 通过 | 否 | 否 | — |
| P03-T3 | 通过 | 是 | 通过 | 否 | 是（lexical） | 是 |

T3 的目标卡片均为团队作用域，迁移链路中的卡片确认、注入和 reuse 记录保存在原始目录。P03 的 Tb 即使收到卡片仍然复犯，说明送达和遵守需要分开统计。当前样本只有 4 个组合，不能报告统计检验。

## 路径修复记录

冻结数据使用 `correction.revision.referencePatch`，平台工具已支持该字段并在 `experiments/knowledge/k4.ts` 中检查路径类型。旧的四对读取限制已改为按目录加载 P01–P06。
