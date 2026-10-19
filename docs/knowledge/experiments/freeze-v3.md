# knowledge-exp-freeze-v3

## 冻结对象

- 标签：`knowledge-exp-freeze-v3`
- 平台实现提交：`0db27ba275862f9e112c176a05dd89ac8d7d5f9e`
- 数据提交：`ea11a85ed344c522fe3b63288cd8577c94fa6498`
- 数据 `manifest.json` SHA-256：`3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`
- 数据规模：16 个陷阱任务、6 个对照任务、6 对迁移任务、2 段脚本
- Agent：`minimax / MiniMax-M3`
- 知识模型：`minimax / MiniMax-M3`
- Node.js：`v24.7.0`
- pnpm：`9.0.0`
- OpenCode runtime：`1.18.31`（项目依赖、启动版本校验与实验服务状态一致）
- 冻结时间：`2026-10-16T12:21:13Z`

实验使用 `experiments/knowledge/formal-v3.json`。配置解析后的 SHA-256 为
`1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。
运行服务使用 HTTP 4203、OpenCode 4205、并发 2、三次重复、种子
20261007、单次运行等待 600000 毫秒。C2 使用 BM25 召回和 MiniMax-M3
重排；M3 请求失败时使用同一批 BM25 顺序，实验结果记录
`rankingSource` 与回退原因。

## 冻结前检查

| 检查 | 结果 | 记录 |
|---|---|---|
| 数据 `node tools/validate.mjs` | 通过，34 个任务和全部参考补丁通过 | 数据仓库 `.judge-work/validate-last.json` |
| `pnpm build` | 通过 | 平台构建输出 |
| `pnpm test` | 通过，server 164、knowledge 162、demo 2 | 平台测试输出 |
| 实验工具构建 | 通过 | `pnpm --filter @simplercp/experiments build` |
| 实验工具测试 | 通过，22 项 | `pnpm --filter @simplercp/experiments test` |

冻结后不修改实验代码、数据、提示词、阈值、判定器和配置。实验一、实验二
读取已经保存的 E2、E3 结果；实验三输出到
`experiments/knowledge/runs/exp3-freeze-v3/`；实验四输出到
`experiments/knowledge/runs/exp4-freeze-v3/`。

## 执行入口

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP3 EXP3
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP4 EXP4
```

两条命令都要求当前提交等于 `knowledge-exp-freeze-v3` 标签，并且会跳过已经
写入 `results.jsonl` 的完成组合。
