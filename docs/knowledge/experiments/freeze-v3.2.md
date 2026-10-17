# knowledge-exp-freeze-v3.2

## 版本与数据

| 项目 | 固定值 |
|---|---|
| 冻结标签 | `knowledge-exp-freeze-v3.2` |
| T2 实现提交 | `1b9cf09fa13988839ac4d2c958509a226a380972` |
| 上一冻结提交 | `f0c20bd431024cd900243f73c27b9bbdcccaf947` |
| 数据提交 | `ea11a85ed344c522fe3b63288cd8577c94fa6498` |
| manifest SHA-256 | `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137` |
| `formal-v3.json` SHA-256 | `a5b41fa275d6380c964038cb3c1e2337f225aa61e304f9aa8c91f78077659d0a` |
| Agent 与知识模型 | `minimax / MiniMax-M3` |
| Node / pnpm | `v24.7.0 / 9.0.0` |
| OpenCode runtime | `1.18.31`（由 `openCodeProcess.ts` 强制核验） |
| 记录时间 | `2026-10-18` |

## 变更范围

本冻结只增加 K4 的 T2 入口：读取 `runs/exp4-freeze-v31/raw/<episode>/recap-quality.json` 的 `modelDraft` 对应保存卡片草稿，调用实验专用原样确认接口，不修改 `type`、`title`、`summary`、`content` 或 `appliesTo`。确认后通过团队升级接口，再在独立 Tb 项目中使用与 T3 相同的 BM25 候选、MiniMax-M3 重排和 top-5 字符预算。每条 T2 结果记录 `draftHasRequiredTokens`、`changedFields`、注入来源、重排来源、运行用量和判定结果。

T0、T3 的 runner 分支、已有结果目录和已有冻结标签均未修改。T2 的输入结果目录由命令行 `--source experiments/knowledge/runs/exp4-freeze-v31` 固定，启动前检查18个 episode 都同时存在 T0 与 T3 结果。

## 冻结前检查

| 检查 | 结果 |
|---|---|
| 数据仓库 `node tools/validate.mjs` | 通过，数据提交与 manifest 哈希一致 |
| `pnpm --filter @simplercp/experiments build` | 通过 |
| `pnpm --filter @simplercp/experiments test` | 23 项通过 |
| T2 原稿字段检查 | 代码在确认响应后逐字段核验五个模型生成字段保持不变 |

## 运行命令

```sh
pnpm --filter @simplercp/experiments experiment k4 \
  --config experiments/knowledge/formal-v3.json \
  --source experiments/knowledge/runs/exp4-freeze-v31 \
  --conditions T2 --shared-episode \
  --out experiments/knowledge/runs/exp4-t2-freeze-v31
```

结果目录只允许新增 T2 结果；T0、T3 结果仍以 `runs/exp4-freeze-v31/` 为准。冻结后不修改 T2 入口、提示词、阈值、判定器、数据和配置。
