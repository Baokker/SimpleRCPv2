# Datasets v2 变更记录

本轮按方案设计第 4.1 至 4.5 节重新推导 expected，expected 只使用 allow、allow_snapshot、ask、deny。

- D1、D2、D4 采用能力、路径分区、可逆性和档位矩阵逐条推导，补齐 unknown、legacy dangerous、提权、写入、trusted 写、student network、observer 和 install 规则。
- D2 的 git reset --hard 按来源区分，非 owner 至少 ask，owner 终端 allow，owner Agent 受 Agent 额外上限得到 ask。
- D3 删除占位记录、空 paths 记录和 missing-id edit，移除 variant 注释，grep .env 改为 grep -n PASSWORD .env，rationale 改为命中规则。
- D5 的 `./scripts/sync-fixtures.sh` 按 unknown 规则标为 ask 并移除 known-limitation；两个保留的脚本内容不可见样本改为 `bash scripts/sync-fixtures.sh` 与 `npm run sync-fixtures`，expected 为 allow。
- 审核抽样比例改为 15%，D6-base 固定抽查 20 条，并增加来源与命中规则列。
- 本轮补正 symlink 目标分区，linked 目标按 metadata 得到 deny，dangling 目标按 outside 得到 ask，并新增独立核对脚本 `lib/verify-dataset-v2.ts`。核对包含期望动作、Manifest 哈希、占位条目、变体注释与审核抽样数量。
- D3 仅为命令正文或脚本内容不可见的已知局限保留 `known-limitation`，普通 review 复现记录不再继承旧的占位说明，D6-base 保留逐条命中规则说明。
- 本次清理删除 D3 的 `--help` 伪变体和场景名命令，并按输入、档位与来源去重；解释器内联代码与 `vim note.txt` 增加说明，expected 保持原值。
- 删除的场景名条目 `task --session child`、`cancel run && rm note.txt` 与 `cancelled-run ...` 对应 X6 的 subagent、cancel 和取消竞态故障注入，覆盖关系记录在 X6 实验记录中。
- 按夹具中的路径规则修正 named-user tilde 与未加引号的 protected glob，D1 对应两条记录的 expected 改为 ask；PowerShell `-c` 纳入内联解释器局限说明。
- 审核表中的 JSON 单元格转义管道符，保证含有 shell pipeline 的记录保持单行单列。

作者确认继续实验，审核栏未逐行填写，记录保留 ai-derived 标签来源。MANIFEST.json 已冻结 v2 数据集。
