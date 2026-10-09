# knowledge-exp-freeze-v2

## 快照

- 时间：2026-10-10（Asia/Shanghai）
- Git 提交：`f43cdab89286a9fa8cb115f453a85d0c66a7bf85`
- 标签：`knowledge-exp-freeze-v2`
- 数据仓库提交：`f53efe3`
- `knowledge-bench/manifest.json` SHA-256：`4d7961ef30d07afecd1878fe409528299e3707eef4faf362067e3c3450a32133`
- manifest 校验文件数：1949
- Node.js：`v24.7.0`
- pnpm：`9.0.0`
- OpenCode：`1.18.31`
- 服务端模型：provider `minimax`，model `MiniMax-M2`

## 配置哈希

| 配置 | SHA-256 |
|---|---|
| `experiments/knowledge/.work/e4-config.json` | `cd04d898d57d6c340d999a729993e94a7165dbbc7bbf05db635110a1ed916ad5` |
| `experiments/knowledge/.work/k4-config.json` | `7e3180a8d3769bc76a5cf52c8c14326ade35d48b6efbe60df50fe592d54c73a6` |
| `experiments/knowledge/.work/online-config.json` | `d8a476d36aa00309c5f02a760aeaa36ec9df1734dd3733450ab7df486abc7d09` |

## 冻结前检查

以下命令在标签创建前完成：

```sh
cd /Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench
node tools/validate.mjs

cd /Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2
pnpm build
pnpm test
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
```

数据校验、平台构建、server 159 项测试、knowledge 159 项测试、demo 2 项测试和实验工具 15 项测试均通过。

## 数据规模记录

当前冻结数据包含 10 个陷阱任务、4 个对照任务和 6 对迁移任务。方案目标为 16 个陷阱任务与 6 个对照任务，陷阱任务和对照任务数量仍未达到目标。标签用于保存当前可复现快照，正式结论只使用实际存在的任务，并在报告中标出样本量与外部效度限制。冻结后不修改实验代码、数据和配置；需要补齐任务时创建新的冻结标签。

## 运行规则

每个结果目录保存 `configuration.json`、`results.jsonl`、运行命令和原始证据。结果使用 provider、model、Git 提交和 manifest 哈希关联。API key 只由服务端读取，不写入结果、日志和文档。

E1、E2、E3 和 E5 的已保存试跑在冻结标签前生成，结果文件中的提交为 `e5c453f0`；E4 当前试跑使用冻结提交 `f43cdab8`。冻结提交只包含实验加载器读取全部迁移对和团队级项目兜底筛选的修复，E1、E2、E3 的离线输入与指标计算不受这两处变化影响。论文中的正式表格应在需要严格提交一致性时按本标签续跑。
