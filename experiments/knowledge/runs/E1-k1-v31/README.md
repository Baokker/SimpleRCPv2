# E1 · K1 离线回放

分支 `experiment/r3-capture`，运行提交 `f0c20bd431024cd900243f73c27b9bbdcccaf947`（`knowledge-exp-freeze-v3.1`）。数据为 `feature/knowledge-exp-v21` 的 `ea11a85ed344c522fe3b63288cd8577c94fa6498`，入口校验了 2,207 个文件。配置为 `formal-v3.json`，配置和 manifest 哈希见 [configuration.json](configuration.json)。pnpm 在此工作区使用 Node.js v24.7.0，pnpm 版本为 9.0.0。

## 命令

在新 worktree 根目录执行。临时目录位于 Git 忽略的工作区目录。

```sh
mkdir -p .test-artifacts/r3
export TMPDIR="$PWD/.test-artifacts/r3" TMP="$PWD/.test-artifacts/r3" TEMP="$PWD/.test-artifacts/r3"
export KNOWLEDGE_BENCH_ROOT='/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench'
git -C "$KNOWLEDGE_BENCH_ROOT" rev-parse HEAD
pnpm install --frozen-lockfile
pnpm --filter @simplercp/shared --filter @simplercp/knowledge build
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments experiment verify --config experiments/knowledge/formal-v3.json
pnpm --filter @simplercp/experiments experiment k1 --config experiments/knowledge/formal-v3.json --out experiments/knowledge/runs/E1-k1-v31
```

## 触发结果

两段会话各 26 个正例，共 52 个。按触发类型与时间窗口进行一对一匹配。总体比例由合计的 TP、FP、FN 计算。

| 触发类型 | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 总体 | 52 | 12 | 0 | 81.25% | 100% | 89.66% |
| `agent.corrected` | 4 | 0 | 0 | 100% | 100% | 100% |
| `agent.interrupted` | 4 | 0 | 0 | 100% | 100% | 100% |
| `agent.retried` | 4 | 0 | 0 | 100% | 100% | 100% |
| `agent.revised` | 4 | 0 | 0 | 100% | 100% | 100% |
| `agent.toolRecovered` | 8 | 0 | 0 | 100% | 100% | 100% |
| `chat.dense` | 4 | 4 | 0 | 50.00% | 100% | 66.67% |
| `dependency.changed` | 8 | 0 | 0 | 100% | 100% | 100% |
| `edit.overwritten` | 4 | 0 | 0 | 100% | 100% | 100% |
| `magicNumber.added` | 4 | 8 | 0 | 33.33% | 100% | 50.00% |
| `rollback.detected` | 4 | 0 | 0 | 100% | 100% | 100% |
| `todo.cleared` | 4 | 0 | 0 | 100% | 100% | 100% |

| 会话 | 讨论定位 Top-1 | 讨论定位 Top-3 | 干扰窗口误触发数 | 平均发现延迟 | 发现延迟中位数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S01 | 1/26 | 24/26 | 0/10 | 4.615 秒 | 0 秒 |
| S02 | 7/26 | 22/26 | 0/10 | 4.615 秒 | 0 秒 |
| 合计 | 8/52（15.38%） | 46/52（88.46%） | 0/20 | 4.615 秒 | 0 秒 |

定位命中要求候选与标注指向同一文件，且行区间相交。发现延迟从触发条件满足时刻计算。48 个命中的延迟为 0 秒，另外 4 个均为 `chat.dense`（60 秒）。冻结标签中的 20 个干扰窗口均为单个时间点。

## v2.1 逐项核对

与 `E1-k1-formal-v21-m3/results.jsonl`（平台 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`）逐段核对。两个 JSONL 的逐行对象仅 `commit` 字段不同，触发混淆计数、延迟数组、干扰命中列表以及 Top-1 和 Top-3 比例逐项相同。两次运行的配置及 manifest 哈希一致。标签之间的 `experiments/knowledge/k1.ts`、`packages/knowledge/src/capture` 和 `packages/knowledge/src/anchor` 内容一致。同期变更涉及 BM25、检索排序和 LLM 客户端。

```sh
git diff knowledge-exp-freeze-v2.1 knowledge-exp-freeze-v3.1 -- packages/knowledge
```

## 脚本与标注

S01 以 R1 库存业务为背景，S02 以 R2 聊天和历史记录为背景。每段由三名脚本角色、448 个动作、26 个正例、10 个干扰时间点组成，脚本时长 2,390 秒。数据仓库 Git 记录署名 Baokker。按该记录，脚本和标注规则由 Baokker 提交，未能确认有独立标注者参与。

数据仓库 `scripts/generate-session.mjs` 写有业务场景、讨论原文和预设触发类型，基于夹具源码生成编辑、Agent diff 和两段会话的标注。每个正例使用 `[conditionAt, conditionAt + 90]` 秒，讨论对象的代码行范围由 TypeScript AST 取得。规则见数据仓库 `scripts/README.md`，标签见 `scripts/sessions/S01/labels.json` 和 `scripts/sessions/S02/labels.json`。同一个生成器构造输入并生成标注，且构造时使用平台默认触发参数。0/20 只覆盖指定时间点，12 条窗口外的误触发计入总体精确率。

## 异常、费用与时间

首次实验包构建失败，原因是新 worktree 还未生成 `@simplercp/knowledge` 的编译输出。构建工作区依赖后通过。首次主数据验证因 `tsx` 的 Unix socket 路径超过长度上限而终止，改用工作区根目录下较短的临时目录后通过。失败日志分别保留在本地的 `experiments/knowledge/.work/r3-capture/build.log` 和 `verify-main.log`。

正式 K1 回放成功，墙钟时间 1.665 秒，模型请求 0 次，模型费用 0 元。首次安装 7.757 秒，工作区依赖构建 3.418 秒，实验包成功构建 4.623 秒，主数据成功验证 2.547 秒。[逐段结果](results.jsonl)
