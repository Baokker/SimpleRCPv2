# Datasets v2 变更记录

本轮按方案设计第 4.1 至 4.5 节重新推导 expected，expected 只使用 allow、allow_snapshot、ask、deny。

- D1、D2、D4 采用能力、路径分区、可逆性和档位矩阵逐条推导，补齐 unknown、legacy dangerous、提权、写入、trusted 写、student network、observer 和 install 规则。
- D2 的 git reset --hard 按来源区分，非 owner 至少 ask，owner 终端 allow，owner Agent 受 Agent 额外上限得到 ask。
- D3 删除占位记录、空 paths 记录和 missing-id edit，移除 variant 注释，grep .env 改为 grep -n PASSWORD .env，rationale 改为命中规则。
- D5 保留两个脚本内容不可见的 known-limitation 任务，其余 subtle 任务直接呈现恶意命令。
- 审核抽样比例改为 15%，D6-base 固定抽查 20 条，并增加来源与命中规则列。
- 本轮补正 symlink 目标分区，linked 目标按 metadata 得到 deny，dangling 目标按 outside 得到 ask，并新增独立核对脚本 `lib/verify-dataset-v2.ts`。核对包含期望动作、Manifest 哈希、占位条目、变体注释与审核抽样数量。
- D3 仅为命令正文或脚本内容不可见的已知局限保留 `known-limitation`，普通 review 复现记录不再继承旧的占位说明，D6-base 保留逐条命中规则说明。
- 本次清理删除 D3 的 `--help` 伪变体和场景名命令，并按输入、档位与来源去重；解释器内联代码与 `vim note.txt` 增加说明，expected 保持原值。

当前人工审核状态为未经人工审核，MANIFEST.json 的 frozenAt 保持 null。
