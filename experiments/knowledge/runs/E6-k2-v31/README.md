# E6 · K2 输入检查

分支 `experiment/r3-capture`，检查基于冻结提交 `f0c20bd431024cd900243f73c27b9bbdcccaf947`，拟采用配置 `formal-v3.json` 和模型 MiniMax-M3。历史来源为 `exp4-freeze-v31` 和 `exp4-ext-v33`，两个数据仓库提交分别为 `ea11a85ed344c522fe3b63288cd8577c94fa6498` 和 `2a50a3d090f45859c0c76d0a0f0539d35ea3f656`。

## 试跑与异常

两批均以各自的冻结数据路径设置 `KNOWLEDGE_BENCH_ROOT`。离线调用 K2 的 `episodes` 检查实际输入，两次都以 `ENOENT` 终止。主数据首次缺少 `raw/P01-T0-1/correction-applied.json`，扩展数据首次缺少 `raw/P07-T0-1/correction-applied.json`。本机可用的历史目录均缺少 `raw/`。日志保存在本地 `experiments/knowledge/.work/r3-capture/k2-preflight-main.log` 和 `k2-preflight-ext.log`。

```sh
export K4_SOURCE='/Users/baokker/.codex/worktrees/livememo/SimpleRCPv2/experiments/knowledge/runs/exp4-freeze-v31'
pnpm --filter @simplercp/experiments exec node --import tsx --input-type=module -e 'const {dataset} = await import("./common.ts"); const {episodes} = await import("./k2.ts"); await episodes(await dataset(), process.env.K4_SOURCE);'
```

扩展数据检查使用相同命令，`K4_SOURCE` 改为 `exp4-ext-v33` 的绝对路径。预定的模型试跑为下列命令，输入检查失败后未启动。

```sh
pnpm --filter @simplercp/experiments experiment k2 --config experiments/knowledge/formal-v3.json --source "$K4_SOURCE" --limit 1 --out experiments/knowledge/runs/E6-k2-v31/pilot
```

## 输入要求与结果

K2 用 Tb 行的 `row.artifacts` 寻找纠正证据。共享片段 K4 把该证据保存到同一行的 `episodeArtifacts`，且把 T0/T3 分别写成一行。恢复原始资料后，实验入口需要按 `episodeKey` 读取唯一片段，导入对应的纠正后工作区，并限定输入为这两批 RQ4 片段。冻结版按 `ta.actuallyTrapped` 筛选，原始两批有 31 个此类片段，按 Tb 行读取会重复为 62 行。K2 还会附加 52 个 S01/S02 脚本时刻。要覆盖全部 36 个 RQ4 纠正片段，入口需要保留另外 5 个 Ta 未踩坑的片段。试跑需选定一个 RQ4 片段，正式结果预计生成 108 份草稿。

| 草稿条件 | 实际生成 | 结构合法率 | 引用可解析率 | 兜底率 | 指定标识符覆盖率 | 长度 |
| --- | ---: | --- | --- | --- | --- | --- |
| `ordinary` | 0 | — | — | — | — | — |
| `server` | 0 | — | — | — | — | — |
| `agent-self` | 0 | — | — | — | — | — |

K2 已有 `mustMentionCovered`，按摘要及正文匹配预期标识符。草稿正文长度可从保存的响应统计。两份人工评分表预定为本目录的 `ratings-a.csv`、`ratings-b.csv`，每份仅收录可评价草稿。当前均未生成，有效评分条目为 0。字段为规则正确性、可检查性、适用范围、边界合理性和备注，均由标注者填写。三种草稿之间无可比较的观测值。

## 费用与时间

主数据与扩展数据输入检查墙钟时间分别为 2.842 秒和 2.037 秒。模型请求 0 次，新增模型费用 0 元。
