# RQ4 · T1 输入检查与历史条件配对

分支 `experiment/r3-capture`，检查基于冻结提交 `f0c20bd431024cd900243f73c27b9bbdcccaf947`。主数据提交 `ea11a85ed344c522fe3b63288cd8577c94fa6498`，扩展数据提交 `2a50a3d090f45859c0c76d0a0f0539d35ea3f656`。使用 `formal-v3.json` 的入口分别验证两个 manifest，共检查 2,207 和 2,525 个文件。

## T1 状态

T1 正式样本为 0/36。冻结版 `k4 --shared-episode` 仅接受 T0/T3。常规 `k4 --conditions T1` 的 `--source` 只记录输入结果哈希，T1 仍执行本条件的 Ta，无法与历史三个条件共用 Ta 片段。历史 T2 的读取入口首次出现在 `1b9cf09fa13988839ac4d2c958509a226a380972`，该入口专用于从已保存草稿执行 T2。

本机可用的 `exp4-freeze-v31` 和 `exp4-ext-v33` 均缺少 `raw/`。T1 需要从原始记录恢复每个片段的纠正原文和真实 Ta diff，并与历史结果的 `episodeKey` 和 `ta.runId` 核对。实验入口可参照历史 T2，读取已保存片段，在独立的 Tb 项目中复用冻结版 `correctionContext`，创建团队卡片并用 `fixedCardIds` 注入。Tb 使用同一任务、行为检查器和 MiniMax-M3。该方案需要修改实验入口。

```sh
pnpm --filter @simplercp/experiments experiment verify --config experiments/knowledge/formal-v3.json
git show 1b9cf09f:experiments/knowledge/k4.ts
```

## 历史条件结果

对 `exp4-freeze-v31`、`exp4-ext-v33` 及对应的两批 T2 结果按 `episodeKey` 配对，逐项核对任务、重复编号、Ta run ID、Ta 是否踩坑、配置与 manifest 哈希。两批 T2 的 `source.json` 均与各自 T0/T3 结果匹配。三条件各有 36 个历史片段，其中 31 个 Ta 实际踩坑。

| 样本 | 条件 | Tb 功能通过 | Tb 避开陷阱 | Tb 联合成功 | 目标卡片送达 | 注入字符总数 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 全部 | T0 | 34/36 | 3/36 | 3/36 | 0/36 | 0 |
| 全部 | T1 | — | — | — | — | — |
| 全部 | T2 | 33/36 | 6/36 | 6/36 | 8/36 | 10,544 |
| 全部 | T3 | 34/36 | 21/36 | 21/36 | 27/36 | 18,213 |
| Ta 实际踩坑 | T0 | 29/31 | 0/31 | 0/31 | 0/31 | 0 |
| Ta 实际踩坑 | T1 | — | — | — | — | — |
| Ta 实际踩坑 | T2 | 29/31 | 3/31 | 3/31 | 4/31 | 5,247 |
| Ta 实际踩坑 | T3 | 29/31 | 16/31 | 16/31 | 22/31 | 14,282 |

T1 列留空表示没有观察值。历史 `P13-T0-3` 的 Tb 运行状态为 `failed`，保留在分母内。原始六对的 T0/T3 平台提交是 `f0c20bd4`，T2 是 `33787ee0`。新增六对的 T0/T2/T3 使用 `d2e15217`。出处及哈希见 [historical-summary.json](historical-summary.json)，逐片段结果见 [paired-episodes.csv](paired-episodes.csv)。

## 异常、费用与时间

扩展数据首次验证遇到 `tsx` 的 Unix socket 路径长度限制，失败日志保存在本地 `experiments/knowledge/.work/r3-capture/verify-ext.log`。采用较短的工作区内临时目录后通过，墙钟时间 2.823 秒。历史配对用时 0.366 秒。T1 没有正式运行耗时，模型请求 0 次，新增模型费用 0 元。
