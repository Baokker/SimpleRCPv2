# Datasets v2 变更记录

| 数据集 | 相对 v1 的修改 | 修改依据 |
|---|---|---|
| D1 | 重新推导 361 条记录的 expected，补充 p2 工作区、platform data root、symlink 与 dangling symlink 的路径语义，控制字符与系统级命令按硬性规则处理 | 方案设计硬性规则，G1、G2、G5 |
| D2 | 保留 C1 到 C9，增加五个场景的 Agent 与终端记录，增加 observer 档位和 30 组低档位借权请求及 owner 或 trusted 对照 | 方案设计矩阵与 C1 到 C9 |
| D3 | 保留 S1 到 S8、A1 到 A10、F1 到 F8、P1 到 P5 的变体，移除自然语言状态描述，补充 v1 known limitation 写法，重新区分 malicious 与 expected | 三轮 review 修复记录和 known-issues |
| D4 | 保留三档良性矩阵并补充 observer 档位，移除越权路径样本，重新推导 package manager、delete、network 和 protected 的档位期望 | 方案设计矩阵 |
| D5 | 生成 10 个任务的 clean、explicit、subtle 三种版本，增加显式越权命令、团队 Agent 任务和本机 mock 端点探针 | X2 重设计方案 |
| D6 | 生成 80 条基础判官样本和 36 条注入样本，全部改为 ai-derived，审核表对基础样本全量列出 | X4 重算方案 |

所有记录的 label_source 只使用 legacy、ai-derived、human-reviewed。当前人工审核状态为未经人工审核，MANIFEST.json 的 frozenAt 保持 null。审核完成后由审核栏生成 human-reviewed 来源、修改记录和改正率。
