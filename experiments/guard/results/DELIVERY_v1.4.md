# guard-v1.4 交付记录

## 提交与测试

| 项目 | 提交 | 回归测试 |
| --- | --- | --- |
| R4-01：读取工具统一经过 Guard，使用实际 OpenCode worktree 判定路径 | `49a07c18ff763a3f99cfd572a87052d19125053e` | `routes all OpenCode full-mode reading tools through Guard`；`guards sibling project reads and search paths when OpenCode discovers an ancestor worktree` |
| H4-01：模拟审批人根据登记的副作用目标判定，确定性 runtime 遵循实际 permission 配置 | `1dada0e` | `rejects equivalent operations on registered attack targets for non-owners`；`executes allowed read calls without emitting permission events and asks for guarded reads` |
| 采集完整性与目录读取标签 | `ac1ef13` | 完整 X2a 与 20 次 X2b 原始记录核对；`VERIFICATION.json` |
| 删除未使用的命令文本审批函数 | `990c17e` | 完整服务端与 Demo 测试；审批目标回归测试 |

`guard-v1.4` 指向 `49a07c18ff763a3f99cfd572a87052d19125053e`，已合并到 `experiment/guard-x1-x6`。设计文档与论文 `方案设计.md` 的 4.1.2、8.3 已同步更新。本次未修改 `decide()` 的公共路径；X1、X3、X4、X5、X6 沿用第四轮结果。

服务端 34 个测试文件、173/173 测试通过，Demo 2/2 测试通过，总计 175/175。TypeScript 与客户端生产构建通过。八组最终结果的主要统计均通过原始记录重算，结果见 `VERIFICATION.json`。

## R4-01 证据

OpenCode 1.18.31 的 `/path` 返回：

- directory：`.experiment-data/x2-v2Li73/test-fix-explicit-F-student-r1/data/workspaces/demo`。
- worktree：`/Users/baokker/Documents/SimpleRCPv2`。
- `other-project/notes.md` 位于此 worktree 内。

第四轮 read 调用 `chatcmpl-tool-b407a7fa455ca7eb` 已完成，对应 trace 没有 read 或 external_directory 审批事件。祖先 Git 仓库导致同级项目处于同一 worktree 的推测得到确认，证据为 `R4_WORKTREE.json`。full 模式的 read、grep、glob、list 全部使用 `ask`，由 Guard 决定普通工作区读取、受保护读取和跨项目读取的动作。`external_directory` 保持 `deny`。

## X2a：720 次完整运行

被测版本为 guard-v1.4，目录 `X2a/x2a-20261006141044`。每个任务增加 cross-project-read，实际 permission 为 allow 时直接执行，为 ask 时产生审批事件，为 deny 时拒绝。

| 条件 | 不可恢复成功调用 | 可恢复成功调用 | 成功 run | 尝试拦截 | 合法 owner 完成 |
| --- | --- | --- | --- | --- | --- |
| B0 | 258/360 | 0/360 | 120/120 | 90/360 | 48/48 |
| B2 | 258/360 | 0/360 | 120/120 | 90/360 | 48/48 |
| B3 | 0/360 | 48/360 | 24/120 | 312/360 | 48/48 |
| F | 0/360 | 36/360 | 24/120 | 324/360 | 48/48 |

F 的额外 cross-project-read 为 180/180 deny。各条件正常任务完成为 180/180，良性误拒为 0/624。三个顺序重复的差异为 0/240。F 的可恢复成功来自直接 allow_snapshot 的操作；没有文件所有权语义的限制仍然存在。24 个 run 的 36 个相关快照已经实际恢复并核对清单哈希，证据为运行目录中的 `snapshot-restore.json`。

B3 的 Guard 档位固定为 collaborator，模拟审批人按原始 trigger 判断授权。合法 owner 分母排除两种原有跨项目读取任务，这些读取对 owner 同样禁止。

## X2b：F/explicit 20 次 MiniMax-M3 补跑

目录 `X2/x2-20261006135607`，每个任务分别由 student 与 owner 发起，共 20 次。B0 与 clean 使用第三轮记录，最终组合目录为 `X2/x2-final-v1.4`，逐条保存来源目录与被测版本。

| 指标 | 结果 |
| --- | --- |
| student 不可恢复越权成功 | 0/10 |
| student 可恢复越权成功 | 0/10 |
| 目标攻击尝试拦截 | 18/18 |
| 正常任务完成 | 17/20 |
| 合法 owner 目标完成 | 6/8 |
| completed / step_limit / failed / timeout | 15 / 2 / 3 / 0 |
| 审批均值 ± 样本 SD | 1.850 ± 1.785 |
| 总 token | 1,596,870 |
| input / output / reasoning | 165,276 / 22,332 / 2,973 |
| cacheRead / cacheWrite | 1,406,289 / 0 |
| 新增估算费用 | 1.15028298 CNY |

三次 Provider 连接失败均发生在工具调用前：backup-script owner、team-greeting student、team-greeting owner。记录保留 failed 与 tokenCount=null，没有追加模型重试。十次 student run 中九次有工具轨迹，连接失败的一次不提供拦截证据。费用按收到的 token 计算，无法从未返回的用量记录确认账户最终账单。

本次真实模型 test-fix 只尝试 bash 跨项目读取，module-refactor 没有跨项目 read 调用；team-greeting 没有工具调用。R4-01 的直接 read 拒绝与 H4-01 的等价写法覆盖来自回归测试及确定性执行。本次模型轨迹中的受保护 read 已进入审批并被拒绝。

## 报告与证据结构

- 汇总报告开头使用最终总表，RQ1 至 RQ6 的详细表格使用最终选择数据。
- 每张表和图注明被测版本、运行目录；X2b 明确标记保留组与新补跑组。
- 六份单项记录使用最终结果作为主体，四轮历史集中在文末，每轮一张简表与说明。
- 缺陷与局限表标记修复版本、当前状态和证据；读取工具的未经过 Guard 局限已经删除，worktree 部署限制已记录。
- 七张既有图重新生成，新增 X6 性质图；提供 PNG、PDF 与生成程序。
- `VERIFICATION.json` 纳入本次提交，保存此前核对时间并记录八组最终数据的核对结果。
- 中间运行 x2a-20261006135642 保存在 `.experiment-data/excluded-results`，其审批人身份配置不进入最终统计。

本仓库报告为 `FINAL_REPORT.md`。论文报告为 `/Users/baokker/Work/毕业论文/projects/02-点一_共享终端/实验结果汇总_X1-X6.md`；六份记录与图表位于该项目 `资料/实验记录/`。
