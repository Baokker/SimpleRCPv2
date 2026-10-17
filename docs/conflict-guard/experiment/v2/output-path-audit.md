# 阶段 A3 输出路径核查

核查范围为未跟踪目录 `packages/conflict-guard/docs/conflict-guard/experiment/v2/stage-A3/` 与正式目录 `docs/conflict-guard/experiment/v2/stage-A3/`。

包目录中的 `pair-v5/G3a-final/config.json` 与正式目录同名文件字节相同，已删除重复副本。以下文件与正式目录不同，或只存在于包目录，均保留原样供追溯：

| 文件 | 结果 |
|---|---|
| `pair-v5/G3a-final/command.txt` | 与正式命令不同，保留 |
| `pair-v5/G3a-final/calls.jsonl` | 与正式调用记录不同，保留 |
| `pair-v5/G3a-final/results.json.gz` | 与正式结果不同，保留 |
| `pair-v5/G3a/calls.jsonl` | 仅包目录存在，保留 |
| `pair-v5/G3a-retry/calls.jsonl` | 仅包目录存在，保留 |
| `pair-v5/G3a-rerun/calls.jsonl` | 仅包目录存在，保留 |

包目录副本不是阶段 B 的正式结果。正式材料只引用 `docs/conflict-guard/experiment/v2/` 下的文件。`stage-a-evaluate.ts` 现在拒绝把输出写到包目录的 `docs/conflict-guard/experiment` 路径；后续命令必须传入仓库根目录下的正式输出路径。

审查时仍能看到 `packages/conflict-guard/docs/` 下的六个未跟踪文件。它们与正式目录中的调用记录不同，作为历史追溯材料保留，不属于冻结输入，也不会被任何 v2 命令引用。输出保护使用规范化路径和目录边界判断，后续阶段的命令统一写入仓库根目录下的 `docs/conflict-guard/experiment/v2/`。
