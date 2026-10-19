# 实验产物存储

Git 保存源码、实验配置、摘要、统计、数据集归档与原始录制缓存归档。大型逐样本结果使用 gzip 无损压缩；展开的 `results.json`、临时输出与包目录中的新增实验输出由 `.gitignore` 忽略。本次取消跟踪的五份展开文件仍保存在本机。

## 归档索引

下表路径相对于 `docs/conflict-guard/`，大小单位为字节。

| 目录 | 归档文件 | 展开大小 | 归档大小 |
|---|---|---:|---:|
| evidence/checkpoint-a-dev-report | results.json.gz | 39,397,772 | 1,752,988 |
| evidence/stage-4-dev-report | results.json.gz | 7,926,398 | 344,120 |
| experiment/v2/stage-A3/E1-human/base | results.json.gz | 121,010,301 | 5,904,420 |
| experiment/v2/stage-A3/E1-human/P4-no-four-state-typecheck | results.json.gz | 20,319,800 | 1,208,572 |
| experiment/v2/stage-A3/E1-human/P4 | results-expanded.json.gz | 22,454,906 | 1,341,411 |

五份文件合计由 211,109,177 字节压缩为 10,551,511 字节，解压内容与原文件逐字节一致。

`P4/results.json.gz` 是已有的另一份结果，其内容与本次展开文件不同，两份归档均保留。阶段 A3 的 E1 报告与相关测试读取 `P4/results-expanded.json.gz`。包目录中已跟踪的历史运行记录也继续保留。

## 压缩与恢复

在仓库根目录执行以下命令，可使用现有工具归档一个报告目录：

```sh
pnpm --filter @simplercp/conflict-guard data:artifacts --report ../../docs/conflict-guard/experiment/v2/stage-A3/E1-human/base
```

恢复该目录的展开文件：

```sh
pnpm --filter @simplercp/conflict-guard data:artifacts --report ../../docs/conflict-guard/experiment/v2/stage-A3/E1-human/base --restore
```

恢复 P4 的完整逐样本文件：

```sh
gzip -d -c docs/conflict-guard/experiment/v2/stage-A3/E1-human/P4/results-expanded.json.gz > docs/conflict-guard/experiment/v2/stage-A3/E1-human/P4/results.json
```

阶段 A3 的 E1 生成脚本同时写入展开文件与对应归档，报告脚本直接读取归档。历史命令或配置中记录的展开路径可以通过上述命令恢复，实验配置保持原有内容。

## Git 历史

当前分支的未推送历史已清除 `base/results.json`、`P4/results.json` 与 `P4-no-four-state-typecheck/results.json` 三份大型展开结果。已发布的历史、其他分支和当前文件内容保持一致，待推送历史中最大的文件为 8,985,945 字节。

提交号的对应关系保存在 [history-commit-map.txt](history-commit-map.txt)，实验材料中的原有提交号可以通过该文件查找。清理前的完整 Git 备份保存在本机已忽略的 `.test-workspaces/history-cleanup/before-cleanup.bundle`，验证结果保存在同目录的 `verification.json`。
